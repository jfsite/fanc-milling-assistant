#!/usr/bin/env node
/**
 * 重新截取某个面板的说明书配图（docs/img/panel-*.png）
 *
 * 用法：
 *   node tools/shoot-panel.js template               # 截「程序编辑器」→ docs/img/panel-template.png
 *   node tools/shoot-panel.js help --out docs/img/panel-help.png
 *   node tools/shoot-panel.js ai --svg docs/samples/part-60x40.svg --gen
 *        # 先上传示例图纸并点「生成程序」，再截带结果的画面
 *
 * 流程：无头 Edge 打开本地 app.html → 点对应导航 → 全页截图 → Pillow 缩到 1000 宽 + 128 色量化
 * （与既有 11 张配图规格一致）。截图后记得跑 node tools/sync-doc.js --embed 写回应用。
 */

const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.dirname(__dirname);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PY = 'C:\\Users\\wzp\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
const PORT = 9400 + Math.floor(Math.random()*400); // 随机端口，避免上次未退出的实例占坑
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const panel = args[0] && !args[0].startsWith('-') ? args[0] : null;
if (!panel) {
  console.error('用法: node tools/shoot-panel.js <panelId> [--out 路径]');
  process.exit(1);
}
const outIdx = args.indexOf('--out');
const out = outIdx > -1 ? args[outIdx + 1] : path.join('docs', 'img', `panel-${panel}.png`);
const svgIdx = args.indexOf('--svg');
const svgPath = svgIdx > -1 ? path.resolve(args[svgIdx + 1]) : null;
const doGen = args.includes('--gen');

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-shot-'));
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`, 'about:blank',
  ], { stdio: 'ignore' });

  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      page = (await r.json()).find((t) => t.type === 'page');
    } catch (_) { /* 等启动 */ }
    await sleep(300);
  }
  if (!page) { child.kill(); throw new Error('DevTools 未就绪'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 2, mobile: false,
    });
    const fileUrl = 'file:///' + path.join(ROOT, 'app.html').replace(/\\/g, '/');
    await send('Page.navigate', { url: fileUrl });
    await sleep(2200);

    const clicked = await send('Runtime.evaluate', {
      expression: `(()=>{const b=document.querySelector('#nav button[data-p="${panel}"]');
        if(!b) return 'no-nav'; b.click(); return 'ok';})()`,
      returnByValue: true,
    });
    if (clicked.result?.result?.value !== 'ok') throw new Error('找不到导航项 data-p=' + panel);
    await sleep(900); // 等画布 / 帮助面板懒加载

    if (svgPath) {
      await send('DOM.enable');
      const doc = await send('DOM.getDocument', { depth: -1 });
      const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#dwg-file' });
      await send('DOM.setFileInputFiles', { files: [svgPath], nodeId: q.result.nodeId });
      for (let i = 0; i < 40; i++) {
        const r = await send('Runtime.evaluate', {
          expression: "document.getElementById('btn-dwg-gen') && !document.getElementById('btn-dwg-gen').disabled",
          returnByValue: true,
        });
        if (r.result.result.value === true) break;
        await sleep(300);
      }
      if (doGen) {
        await send('Runtime.evaluate', { expression: "document.getElementById('btn-dwg-gen').click()" });
        await sleep(900);
      }
    }
    await sleep(300);

    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
    });
    const rawPath = path.join(os.tmpdir(), `shot-${panel}-${process.pid}.png`);
    fs.writeFileSync(rawPath, Buffer.from(shot.result.data, 'base64'));

    execFileSync(PY, ['-c', `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
w, h = im.size
im = im.resize((1000, max(1, round(h * 1000 / w))), Image.LANCZOS)
im = im.quantize(colors=128, method=Image.MEDIANCUT)
im.save(dst, optimize=True)
print('saved %s %s' % (dst, Image.open(dst).size))
`, rawPath, path.join(ROOT, out)], { stdio: 'inherit' });

    fs.unlinkSync(rawPath);
    console.log('完成后记得: node tools/sync-doc.js --embed');
  } finally {
    child.kill();
  }
})().catch((e) => {
  console.error('截图失败：' + e.message);
  process.exitCode = 2;
});
