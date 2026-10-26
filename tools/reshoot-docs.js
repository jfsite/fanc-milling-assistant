#!/usr/bin/env node
/**
 * 按使用说明的配图口径，重拍 11 张面板截图（docs/img/panel-*.png）
 *
 * 用法：node tools/reshoot-docs.js
 *
 * 和 tools/shoot-panel.js 的分工：
 *   shoot-panel     —— 单张，贴一段固定流程（可选 --svg/--gen），适合只改了一个面板
 *   reshoot-docs    —— 一次性把带数据的 11 张全拍完：搜 G4、点模板、算不锈钢、
 *                      解释/校验/刀轨/批改/找错都跑一遍，最后 Pillow 缩到 1000 宽 + 128 色
 *
 * 注意：docs/img/gaps-real.png（图 12 断口红圈）是真实识别结果，不在这里重拍。
 */
const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.dirname(__dirname);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PY = 'C:\\Users\\wzp\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
const PORT = 9300 + Math.floor(Math.random() * 250);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const GOOD = `O0002;
G21 G90 G17 G40 G49 G80;
G54 G00 X0 Y0;
M06 T01;
G43 H01 Z50 M03 S2500;
G00 X-20 Y-20;
Z5;
G01 Z-3 F150;
G41 D01 X0 Y0 F300;
Y50;
X50;
Y0;
X0;
G40 X-20 Y-20;
G00 Z50;
M05;
M09;
G91 G28 Z0;
M30;`;

const BAD = `O0010;
G21 G90 G17 G40 G49 G80;
G54 G00 X0 Y0;
M06 T01;
G43 H01 Z50 M03 S2500;
G00 X-20 Y-20;
G01 Z-3 F150;
G41 X0 Y0 F300;
Y50;
X50;
Y0;
X0;
G00 Z50;
M05;
M30;`;

const STUDENT = GOOD.replace('\nX50;', '\nX48;');

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-re-'));
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); page = (await r.json()).find(t => t.type === 'page'); } catch (_) {}
    await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const errs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
  });

  const shrink = (raw, dst) => execFileSync(PY, ['-c', `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
w, h = im.size
im = im.resize((1000, max(1, round(h * 1000 / w))), Image.LANCZOS)
im = im.quantize(colors=128, method=Image.MEDIANCUT)
im.save(dst, optimize=True)
print('saved %s %s' % (dst, Image.open(dst).size))
`, raw, dst], { encoding: 'utf8' });

  const shot = async (name, clip) => {
    await ev("document.activeElement && document.activeElement.blur()");
    await ev("window.scrollTo(0,0)");
    await sleep(400);
    const params = { format: 'png', captureBeyondViewport: true };
    if (clip) params.clip = clip;
    const s = await send('Page.captureScreenshot', params);
    const raw = path.join(os.tmpdir(), `re-${name}.png`);
    fs.writeFileSync(raw, Buffer.from(s.result.data, 'base64'));
    const dst = path.join(ROOT, 'docs', 'img', `panel-${name}.png`);
    console.log(shrink(raw, dst).trim());
  };

  const setVal = `(id,v)=>{const el=document.getElementById(id);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}`;
  const nav = p => ev(`document.querySelector('#nav button[data-p="${p}"]').click()`);
  const js = s => ev(`(${s})`);

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'app.html').replace(/\\/g, '/') });
  await sleep(1200);
  for (let i = 0; i < 40; i++) { if (await ev("!!document.querySelector('#nav button')") === true) break; await sleep(300); }

  // 图 1 · G/M 代码速查：搜索 G4
  await nav('gcode');
  await ev(`(${setVal})('gcode-search','G4')`);
  await sleep(300);
  await shot('gcode');

  // 图 2 · 程序编辑器：点第一个模板
  await nav('template');
  await js(`document.querySelectorAll('.tpl-item')[0].click()`);
  await shot('template');

  // 图 3 · 参数计算：不锈钢 / 硬质合金 / D16 / ap3 / ae8
  await nav('calc');
  await js(`(()=>{const s=${setVal};
    s('c-mat','不锈钢'); s('c-d','16'); s('c-z','4'); s('c-fz','0.05');
    s('c-ap','3'); s('c-ae','8'); s('c-vc','60');
    document.getElementById('btn-calc').click();})()`);
  await shot('calc');

  // 图 4 · 程序解释
  await nav('explain');
  await ev(`(${setVal})('explain-input',${JSON.stringify(GOOD)})`);
  await js(`document.getElementById('btn-explain').click()`);
  await sleep(500);
  await shot('explain');

  // 图 5 · 程序校验：错误列表 + 第一条展开
  await nav('check');
  await ev(`(${setVal})('check-input',${JSON.stringify(BAD)})`);
  await js(`document.getElementById('btn-check').click()`);
  await sleep(500);
  await js(`(()=>{const d=document.querySelector('#check-result .rd'); if(d) d.open=true;})()`);
  await shot('check');

  // 图 6 · 刀轨演示：生成 + 选中某一段
  await nav('path');
  await ev(`(${setVal})('path-input',${JSON.stringify(GOOD)})`);
  await js(`document.getElementById('btn-path').click()`);
  await sleep(700);
  await js(`(()=>{const rows=document.querySelectorAll('.code-row'); if(rows[10]) rows[10].click();})()`);
  await shot('path');

  // 图 7 · 尺寸核对：填图纸尺寸 → 核对 → 只截这张卡
  await ev(`(${setVal})('d-x','50')`);
  await ev(`(${setVal})('d-y','50')`);
  await js(`document.getElementById('btn-dim-fill').click()`);
  await js(`document.getElementById('btn-dim').click()`);
  await sleep(500);
  const box = await ev(`(()=>{const el=document.getElementById('dim-result').closest('.card');
    const r=el.getBoundingClientRect();
    return {x:r.x+window.scrollX, y:r.y+window.scrollY, width:r.width, height:r.height};})()`);
  await shot('dim', Object.assign({ scale: 1 }, box));

  // 图 8 · 批量批改：两份作业 + 标准答案 → 点第一行
  await nav('batch');
  await ev(`(${setVal})('b-input',${JSON.stringify(STUDENT + '\n====\n' + BAD)})`);
  await ev(`(${setVal})('b-ref',${JSON.stringify(GOOD)})`);
  await js(`document.getElementById('btn-batch').click()`);
  await sleep(900);
  await js(`(()=>{const tr=document.querySelector('#batch-result tbody tr'); if(tr) tr.click();})()`);
  await sleep(600);
  await shot('batch');

  // 图 9 · 找错练习：生成病灶 → 交卷
  await nav('train');
  await js(`document.getElementById('btn-train-gen').click()`);
  await sleep(500);
  await js(`document.getElementById('btn-train-check').click()`);
  await sleep(500);
  await shot('train');

  // 图 11 · 帮助
  await nav('help');
  await sleep(1200);
  await shot('help');

  // 图 13 · 刀具库
  await nav('tools');
  await shot('tools');

  console.log('JS 异常:', errs.length ? JSON.stringify(errs.slice(0, 3)) : '无');
  child.kill();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
