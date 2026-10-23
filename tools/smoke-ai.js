#!/usr/bin/env node
/**
 * AI 面板线上冒烟测试（真实浏览器 + 真实 Origin）
 *
 * 为什么不能本地测：云服务密钥按 Origin 精确匹配，只有在发布域名下才鉴权通过。
 * 做法：启动无头 Edge → 打开线上分享链接 → 用 CDP 在页面上下文里跑一次
 *       models.list() + 一次极短的流式 chat 调用，把结果回传。
 *
 * 用法：
 *   node tools/smoke-ai.js "https://xxx.app.workbuddy.host/?sharecode=XXXX"
 */

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const URL_ARG = process.argv[2];
if (!URL_ARG) {
  console.error('用法: node tools/smoke-ai.js "<线上分享链接>"');
  process.exit(1);
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-smoke-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('DevTools 端口未就绪');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(new Error('WS 连接失败')));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else if (msg.method) {
      events.push(msg.method);
    }
  });
  return {
    ready,
    send(method, params = {}) {
      const myId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(myId, { resolve });
        ws.send(JSON.stringify({ id: myId, method, params }));
        setTimeout(() => {
          if (pending.has(myId)) { pending.delete(myId); reject(new Error(method + ' 超时')); }
        }, 60000);
      });
    },
    hasEvent: (name) => events.includes(name),
    close: () => ws.close(),
  };
}

const EXPR = `(async () => {
  // 顶层 const 不挂在 window 上，直接按标识符取
  const cfg = (typeof __CLOUD_CONFIG__ !== 'undefined') ? __CLOUD_CONFIG__ : window.__CLOUD_CONFIG__;
  if (!cfg) return { ok:false, err:'页面没有 __CLOUD_CONFIG__' };
  if (!window.WorkBuddyCloud) return { ok:false, err:'SDK 未加载（CDN 不可达？）' };
  const c = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: cfg.endpoint,
    oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
    publishableKey: cfg.publishableKey,
  });
  const models = await c.llm.models.list();
  const m = models.find(x => x.disabled !== true);
  if (!m) return { ok:false, err:'没有可用模型', modelCount: models.length };
  const ac = new AbortController();
  let text = '', frames = 0;
  try {
    for await (const ch of c.llm.chat.completions.create({
      model: m.id,
      messages: [
        { role:'system', content:'你是数控编程助手，回答极简。' },
        { role:'user', content:'只回复两个字：收到' },
      ],
      stream: true,
      signal: ac.signal,
    })) {
      frames++;
      const d = ch.choices && ch.choices[0] && ch.choices[0].delta;
      if (d && d.content) { text += d.content; if (text.length >= 8) { ac.abort(); break; } }
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') {
      const info = e.error || {};
      return {
        ok: false,
        err: info.code || e.message,
        status: e.status,
        type: info.type,
        msg: info.message,
        modelCount: models.length,
      };
    }
  }
  return { ok:true, model: m.id, modelCount: models.length, frames, text };
})()`;

(async () => {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: 'ignore', detached: false });

  let result;
  try {
    const page = await waitForDevtools();
    const c = cdp(page.webSocketDebuggerUrl);
    await c.ready;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Page.navigate', { url: URL_ARG });

    // 等 load 事件（最多 30s），再给 SDK 自初始化留 1.5s
    for (let i = 0; i < 100 && !c.hasEvent('Page.loadEventFired'); i++) await sleep(300);
    await sleep(1500);

    const r = await c.send('Runtime.evaluate', {
      expression: EXPR, awaitPromise: true, returnByValue: true,
    });
    result = r.result && r.result.result && r.result.result.value;
    if (!result) result = { ok: false, err: JSON.stringify(r).slice(0, 400) };
    c.close();
  } finally {
    child.kill();
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result && result.ok ? 0 : 2);
})().catch((e) => {
  console.error('冒烟失败:', e.message);
  process.exit(3);
});
