#!/usr/bin/env node
/**
 * 页面底色候选对比：把 app.html 复制成多份、只替换 --bg 值，逐个无头截图，
 * 再生成 tmp/bg-compare/compare.html 供对比挑选。不改动 app.html 本体。
 *
 * 用法：node tools/shoot-bg-variants.js
 */
const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.dirname(__dirname);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT_DIR = path.join(ROOT, 'tmp', 'bg-compare');
const PORT = 9800 + Math.floor(Math.random() * 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 候选：名称 / 底色 / 说明
const VARIANTS = [
  { id: 'a-current', bg: '#fafafb', name: '现状（v1.18.3）', note: '近白偏冷，卡片与底几乎同色' },
  { id: 'b-old', bg: '#f5f6f8', name: 'A · 旧版浅灰', note: 'v1.9 及更早版本的底色，白卡片重新有层次' },
  { id: 'c-mid', bg: '#f2f4f7', name: 'B · 中性灰', note: '比旧版再深一点，层次最明显' },
  { id: 'd-white', bg: '#ffffff', name: 'C · 纯白', note: '底=卡片纯白，只靠阴影分层' },
  { id: 'e-cool', bg: '#f6f7fb', name: 'D · 淡蓝灰', note: '带一点冷调，接近旧版但更亮' },
  { id: 'f-warm', bg: '#f7f7f5', name: 'E · 暖浅灰', note: '偏中性暖调，长时间看不刺眼' },
];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const src = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  if (!src.includes('--bg:#fafafb')) throw new Error('app.html 里找不到 --bg:#fafafb，脚本需同步');

  // 1) 生成各变体文件
  for (const v of VARIANTS) {
    const html = v.id === 'a-current' ? src : src.replace('--bg:#fafafb', `--bg:${v.bg}`);
    fs.writeFileSync(path.join(OUT_DIR, v.id + '.html'), html);
  }

  // 2) 逐个截图
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-bg-'));
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--force-color-profile=srgb',
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
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });

    for (const v of VARIANTS) {
      const fileUrl = 'file:///' + path.join(OUT_DIR, v.id + '.html').replace(/\\/g, '/');
      await send('Page.navigate', { url: fileUrl });
      await sleep(1200);
      for (let i = 0; i < 40; i++) {
        const ready = await send('Runtime.evaluate', {
          expression: "!!document.querySelector('#nav button')", returnByValue: true,
        });
        if (ready.result?.result?.value === true) break;
        await sleep(300);
      }
      // 切到「程序编辑器」面板（和用户截图同一屏），并把吸顶导航还原成静态
      await send('Runtime.evaluate', {
        expression: `(()=>{const b=document.querySelector('#nav button[data-p="template"]')||document.querySelector('#nav button');
          if(b) b.click(); window.scrollTo(0,0);
          var n=document.getElementById('nav'); if(n) n.style.position='static'; return 1;})()`,
        returnByValue: true,
      });
      await sleep(700);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT_DIR, v.id + '.png'), Buffer.from(shot.result.data, 'base64'));
      console.log('截图完成', v.id, v.bg);
    }
  } finally {
    child.kill();
  }

  // 3) 生成对比页
  const cards = VARIANTS.map((v) => `
    <section class="v">
      <header><b>${v.name}</b><code>${v.bg}</code></header>
      <p>${v.note}</p>
      <img src="${v.id}.png" alt="${v.name}">
    </section>`).join('\n');

  fs.writeFileSync(path.join(OUT_DIR, 'compare.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>页面底色候选对比</title>
<style>
  body{margin:0;padding:28px;background:#e9e9ee;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#15151f}
  h1{font-size:20px;margin:0 0 6px}
  .lead{color:#5b5b6b;font-size:13px;margin:0 0 20px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
  @media(max-width:1200px){.grid{grid-template-columns:repeat(2,1fr)}}
  .v{background:#fff;border-radius:14px;padding:12px;box-shadow:0 8px 24px rgba(21,21,31,.10)}
  .v header{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:2px}
  .v b{font-size:14px}
  .v code{font-size:11.5px;color:#4338ca;background:#eef0fe;padding:1px 7px;border-radius:6px}
  .v p{margin:0 0 8px;font-size:12px;color:#6b6b7b;line-height:1.5}
  .v img{width:100%;display:block;border-radius:8px;border:1px solid #ececf1}
</style></head><body>
<h1>页面底色候选（其余样式完全一致，只改 --bg）</h1>
<p class="lead">截图 1440×900，同一面板「模板库 / 程序编辑器」，已锁定 sRGB 色彩配置。挑一个我就落到 app.html。</p>
<div class="grid">${cards}</div>
</body></html>`);

  console.log('对比页：' + path.join(OUT_DIR, 'compare.html'));
  fs.rmSync(ud, { recursive: true, force: true });
})().catch((e) => {
  console.error('失败：' + e.message);
  process.exitCode = 2;
});
