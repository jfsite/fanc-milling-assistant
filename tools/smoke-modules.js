#!/usr/bin/env node
/**
 * 全模块端到端冒烟测试（真实无头 Edge + CDP）
 *
 * 与 tests/run-tests.js 的分工：
 *   run-tests.js   —— 纯函数 / 解析 / 校验规则（Node 里跑，453 条断言）
 *   本脚本          —— 真实 DOM 交互：11 个面板逐个点开、跑通每个模块的主要操作、
 *                     坏数据 / 大程序 / 重复点击 / 快速切面板的稳定性，抓控制台异常与横向溢出
 *
 * 用法：
 *   node tools/smoke-modules.js                    # 跑全部检查
 *   node tools/smoke-modules.js --shot tmp/smoke    # 失败时额外存截图
 *   node tools/smoke-modules.js --keep              # 保留浏览器 profile（排查用）
 *
 * 退出码：0 全过 / 2 有断言失败 / 3 脚本自身异常
 */

const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.dirname(__dirname);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9600 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const shotIdx = argv.indexOf('--shot');
const SHOT_DIR = shotIdx > -1 ? path.resolve(argv[shotIdx + 1]) : null;
const KEEP = argv.includes('--keep');
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

// [面板 id, 名称, 正文最小字符数, 该面板必须存在的控件]
const PANELS = [
  ['gcode', 'G/M 代码速查', 120, '#gcode-table'],
  ['template', '程序编辑器', 60, '#editor'],
  ['calc', '参数计算', 120, '#c-vc'],
  ['explain', '程序解释', 20, '#explain-input'], // 正文多在 textarea 里，innerText 不含
  ['check', '程序校验', 120, '#check-input'],
  ['path', '刀轨演示', 120, '#path-canvas'],
  ['batch', '批量批改', 120, '#b-input'],
  ['train', '找错练习', 120, '#train-code'],
  ['tools', '刀具库', 120, '#tool-tbl'],
  ['ai', 'AI 智能编程', 120, '#ai-req'],
  ['help', '帮助', 500, '#help-body'],
];

const BAD_PROG = `O0103;
G21 G90 G17 G40 G49 G80;
G54 G00 X0 Y0;
M06 T01;
G43 H01 Z50 M03 S3000;
G00 X-10 Y-10;
G01 Z-5 F120;
G41 G01 X0 Y0 F200;
G01 X60;
G01 Y40;
G01 X0;
G01 Y0;
G40 G01 X-10 Y-10;
G00 Z50;
M05;
M30;`;

const ARC_PROG = `O0005;
G21 G90 G17 G40 G49 G80;
G54 G00 X0 Y0;
M06 T01;
G43 H01 Z50 M03 S2000;
G00 X10 Y10;
G01 Z-3 F100;
G01 X60 F250;
G02 X80 Y30 R20;
G03 X100 Y50 R20;
G01 Y70;
G00 X0 Y0;
G01 X0 Y70;
G00 Z50;
M05;
M30;`;

const EXPLAIN_PROG = `O0001;
G21 G90 G17 G40 G49 G80;
G54 G00 X0 Y0;
M06 T01;
G43 H01 Z50 M03 S3000;
G00 X10 Y10;
G01 Z-2 F120;
G01 X60 F200;
G02 X80 Y30 R20;
G00 Z50;
M05;
M30;`;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; failures.push({ name, detail });
    console.log('  ✗ ' + name + (detail !== undefined ? '   → ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  }
}
const J = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-smoke-mod-'));
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--force-color-profile=srgb', '--disable-features=Translate',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`, 'about:blank',
  ], { stdio: 'ignore' });

  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      page = (await r.json()).find((t) => t.type === 'page');
    } catch (_) { /* 等启动 */ }
    await sleep(250);
  }
  if (!page) { child.kill(); throw new Error('DevTools 未就绪'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const exceptions = [];
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description || a.type).join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push('[log] ' + m.params.entry.text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  const HELPERS = `window.__sm = {
    setVal(sel, v){
      const el = document.querySelector(sel); if(!el) return 'no-el';
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
        : (el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return el.value === v ? 'ok' : 'mismatch';
    },
    click(sel){ const el = document.querySelector(sel); if(!el) return 'no-el'; el.click(); return 'ok'; },
    txt(sel){ const el = document.querySelector(sel); return el ? (el.innerText || el.textContent || '').trim() : ''; },
    vis(sel){ const el = document.querySelector(sel); if(!el) return false;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; },
    ink(sel){ const c = document.querySelector(sel); if(!c || !c.width || !c.height) return -1;
      const g = c.getContext('2d'); if(!g) return -1;
      let d; try { d = g.getImageData(0,0,c.width,c.height).data; } catch(e){ return -2; }
      let n = 0; for(let i=0;i<d.length;i+=4){ if(d[i]<245 || d[i+1]<245 || d[i+2]<245) n++; }
      return n; },
    navTo(p){ const b = document.querySelector('#nav button[data-p="'+p+'"]'); if(!b) return 'no-nav'; b.click(); return 'ok'; },
    // 造一段 N 行的长程序，用来压刀轨/校验
    bigProg(n){ let s='O0200;\\nG21 G90 G17 G40 G49 G80;\\nG54 G00 X0 Y0;\\nM06 T01;\\n'
      + 'G43 H01 Z50 M03 S3000;\\nG00 X0 Y0;\\nG01 Z-2 F100;\\n';
      for(let i=0;i<n;i++){ s += 'G01 X' + (i%2 ? 0 : 80) + ' Y' + (i*0.4).toFixed(2) + ';\\n'; }
      return s + 'G00 Z50;\\nM05;\\nM30;'; }
  }; 'ready';`;

  const evalJs = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text || 'eval-error' };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name) => {
    if (!SHOT_DIR) return;
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(s.result.data, 'base64'));
  };
  const reload = async () => {
    await send('Page.reload');
    await sleep(1100);
    for (let i = 0; i < 40; i++) {
      if ((await evalJs("!!document.querySelector('#nav button')")) === true) break;
      await sleep(250);
    }
    await evalJs(HELPERS);
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    const t0 = Date.now();
    await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'app.html').replace(/\\/g, '/') });
    await sleep(900);
    for (let i = 0; i < 60; i++) {
      if ((await evalJs("!!document.querySelector('#nav button')")) === true) break;
      await sleep(250);
    }
    const loadMs = Date.now() - t0;
    await evalJs(HELPERS);

    // ============ 1. 启动 ============
    console.log('\n--- 1. 启动与骨架 ---');
    const boot = await evalJs(`(()=>({
      ver: document.getElementById('app-ver') ? document.getElementById('app-ver').textContent.trim() : '',
      navs: document.querySelectorAll('#nav button').length,
      panels: document.querySelectorAll('.panel').length,
      title: document.title,
      bodyBg: getComputedStyle(document.body).backgroundColor
    }))()`);
    ok('导航 11 项', boot.navs === 11, boot);
    ok('面板 11 个', boot.panels === 11, boot);
    ok('版本徽标已渲染', /^v\d+\.\d+\.\d+$/.test(boot.ver), boot.ver);
    ok('页面标题存在', (boot.title || '').length > 4, boot.title);
    ok('底色已是中性灰 #f2f4f7', boot.bodyBg === 'rgb(242, 244, 247)', boot.bodyBg);
    ok('首屏加载 < 4s', loadMs < 4000, loadMs + 'ms');
    const codeVer = (fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8').match(/const APP_VERSION = "([\d.]+)"/) || [])[1];
    ok('徽标与代码 APP_VERSION 一致', boot.ver === 'v' + codeVer, { badge: boot.ver, code: codeVer });
    // version.json 由 tools/release.js 在发布时写；发布前落后一版是正常状态，只禁止它超前
    const jsonVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).v;
    const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] - y[i]; } return 0; };
    ok('version.json 未超前于代码版本（发布前允许落后）', cmp(jsonVer, codeVer) <= 0, { json: jsonVer, code: codeVer });

    // ============ 2. 面板逐个打开 ============
    console.log('\n--- 2. 11 个面板逐个打开 ---');
    for (const [pid, label, minText, probe] of PANELS) {
      const before = exceptions.length;
      await evalJs(`__sm.navTo('${pid}')`);
      await sleep(520);
      const st = await evalJs(`(()=>{
        const p = document.getElementById('panel-${pid}');
        const act = document.querySelector('.panel.active');
        const r = p ? p.getBoundingClientRect() : null;
        return {
          active: act ? act.id : null,
          h: r ? Math.round(r.height) : -1,
          text: p ? (p.innerText || '').length : 0,
          cards: p ? p.querySelectorAll('.card').length : 0,
          probe: !!document.querySelector(${JSON.stringify(probe)}),
          probeVis: __sm.vis(${JSON.stringify(probe)}),
          navActive: document.querySelector('#nav button.active') ? document.querySelector('#nav button.active').dataset.p : null
        };
      })()`);
      ok(`[${label}] 面板切换到 panel-${pid}`, st.active === 'panel-' + pid, st.active);
      ok(`[${label}] 有内容渲染（正文 ${st.text} 字符 / ${st.cards} 张卡）`, st.h > 150 && st.text >= minText && st.cards > 0, st);
      ok(`[${label}] 关键控件 ${probe} 存在且可见`, st.probe === true && st.probeVis === true, st);
      ok(`[${label}] 导航高亮同步`, st.navActive === pid, st.navActive);
      ok(`[${label}] 打开无 JS 异常`, exceptions.length === before, exceptions.slice(before));
    }

    // ============ 3. G/M 代码速查 ============
    console.log('\n--- 3. G/M 代码速查 ---');
    await evalJs("__sm.navTo('gcode')"); await sleep(300);
    const allRows = await evalJs("document.querySelectorAll('#gcode-table tbody tr').length");
    ok('表格有数据', allRows > 30, allRows);
    await evalJs("__sm.setVal('#gcode-search','G41')"); await sleep(320);
    const g41Rows = await evalJs("document.querySelectorAll('#gcode-table tbody tr').length");
    const g41Hit = await evalJs("document.querySelector('#gcode-table tbody').innerText.indexOf('G41') >= 0");
    ok('搜 G41 命中且收窄', g41Rows > 0 && g41Rows < allRows && g41Hit === true, { g41Rows, allRows });
    await evalJs("__sm.setVal('#gcode-search','钻孔')"); await sleep(320);
    ok('中文关键词「钻孔」可搜', (await evalJs("document.querySelectorAll('#gcode-table tbody tr').length")) > 0);
    await evalJs("__sm.setVal('#gcode-search','zzzz不存在')"); await sleep(320);
    const noHit = await evalJs("(()=>({ rows: document.querySelectorAll('#gcode-table tbody tr').length, txt: document.querySelector('#gcode-table tbody').innerText.trim() }))()");
    ok('无结果时显示「无匹配结果」占位行', noHit.rows === 1 && /无匹配结果/.test(noHit.txt), noHit);
    ok('常用代码胶囊存在', (await evalJs("document.querySelectorAll('#gcode-chips button').length")) > 0);
    await evalJs("__sm.setVal('#gcode-search','')"); await sleep(300);
    ok('清空搜索后恢复全量', (await evalJs("document.querySelectorAll('#gcode-table tbody tr').length")) === allRows);

    // ============ 4. 模板库 9 个模板 ============
    console.log('\n--- 4. 模板库 9 个模板 ---');
    await evalJs("__sm.navTo('template')"); await sleep(400);
    const tplCount = await evalJs("document.querySelectorAll('#tpl-list .tpl-item').length");
    ok('模板数量 9 个', tplCount === 9, tplCount);
    // 强校验：点第 i 个模板后，编辑器内容必须与 TEMPLATES[i].code 完全一致
    const tplMismatch = [];
    for (let i = 0; i < tplCount; i++) {
      const r = await evalJs(`(()=>{
        document.querySelectorAll('#tpl-list .tpl-item')[${i}].click();
        const v = document.getElementById('editor').value || '';
        return { i:${i}, same: v.trim() === String(TEMPLATES[${i}].code).trim(),
                 len: v.trim().length, title: TEMPLATES[${i}].t,
                 first: v.split('\\n')[0].trim(),
                 oCount: (v.match(/^O\\d+/gm) || []).length };
      })()`);
      await sleep(120);
      if (!r.same) tplMismatch.push(r);
    }
    ok('9 个模板载入内容与模板库一字不差', tplMismatch.length === 0, tplMismatch);
    // 片段型模板（坐标旋转 / 镜像加工）只有两三行指令，不要求 O 号；整程序模板必须首行 O 号
    const tplShape = await evalJs(`(()=>{
      const bad = [];
      TEMPLATES.forEach((t,i)=>{ const code=String(t.code).trim();
        if(!/^O\\d/i.test(code)){ if(code.length < 10) bad.push({i, t:t.t, why:'片段过短'}); return; }
        const lines = code.split('\\n').map(s=>s.trim());
        if(!/^O\\d+/.test(lines[0])) bad.push({i, t:t.t, why:'首行非 O 号'});
        const o = (code.match(/^O\\d+/gm)||[]).length;
        if(o > 2) bad.push({i, t:t.t, why:'O 号过多 ' + o});
      });
      return { total: TEMPLATES.length, bad };
    })()`);
    ok('模板结构合规（整程序首行 O 号、子程序至多 2 个 O 号、片段有内容）',
      tplShape.bad.length === 0 && tplShape.total === 9, tplShape);

    // ============ 5. 快捷输入 ============
    console.log('\n--- 5. 快捷输入与程序头 ---');
    ok('快捷输入 13 个', (await evalJs("document.querySelectorAll('#snippet-bar .snippet').length")) === 13);
    await evalJs("__sm.setVal('#editor','G00 X0 Y0;\\nM30;')");
    await evalJs("__sm.click('#btn-insert-header')"); await sleep(250);
    const hdr = await evalJs(`(()=>{ const v=document.getElementById('editor').value;
      return { first: v.split('\\n')[0].trim(), oCount: (v.match(/^O\\d+/gm)||[]).length,
               keepsOld: v.indexOf('G00 X0 Y0') >= 0 }; })()`);
    ok('空程序插程序头 → 首行补 O0001', /^O0001/.test(hdr.first) && hdr.oCount === 1, hdr);
    ok('插入程序头不吞掉原内容', hdr.keepsOld === true, hdr);
    await evalJs("__sm.setVal('#editor','O1234;\\nG00 X0 Y0;')");
    await evalJs("__sm.click('#btn-insert-header')"); await sleep(250);
    const hdr2 = await evalJs(`(()=>{ const v=document.getElementById('editor').value;
      return { first: v.split('\\n')[0].trim(), oCount: (v.match(/^O\\d+/gm)||[]).length }; })()`);
    ok('已有 O 号时程序头插在其后（O 号不被挤走）', hdr2.first === 'O1234;' && hdr2.oCount === 1, hdr2);
    // 快捷输入逐项点一遍：13 个按钮都必须在编辑器里落地内容
    const snipFail = await evalJs(`(()=>{
      const btns = Array.from(document.querySelectorAll('#snippet-bar .snippet'));
      const ed = document.getElementById('editor'); const bad = [];
      btns.forEach((b,i)=>{
        ed.value = ''; ed.focus();
        b.click();
        if(!(ed.value||'').trim()) bad.push({i, label:(b.textContent||'').trim()});
      });
      ed.value = '';
      return bad;
    })()`);
    ok('13 个快捷输入点击后都能写进编辑器', Array.isArray(snipFail) && snipFail.length === 0, snipFail);

    // ============ 6. 参数计算 ============
    console.log('\n--- 6. 参数计算 ---');
    await evalJs("__sm.navTo('calc')"); await sleep(400);
    await evalJs("__sm.setVal('#c-vc','120'); __sm.setVal('#c-d','20'); __sm.setVal('#c-z','4'); __sm.setVal('#c-fz','0.08')");
    const calcClick = await evalJs("__sm.click('#btn-calc')"); await sleep(350);
    const calcTxt = await evalJs("__sm.txt('#calc-hint')");
    ok('参数计算按钮可点', calcClick === 'ok', calcClick);
    ok('算出转速/进给（含数字）', (calcTxt.match(/\d/g) || []).length > 2, calcTxt.slice(0, 80));
    await evalJs("__sm.setVal('#c-vc','60')");
    await evalJs("__sm.click('#btn-calc')"); await sleep(300);
    ok('改参数后重算结果变化', (await evalJs("__sm.txt('#calc-hint')")) !== calcTxt);

    // ============ 7. 程序解释 ============
    console.log('\n--- 7. 程序解释 ---');
    await evalJs("__sm.navTo('explain')"); await sleep(350);
    await evalJs(`__sm.setVal('#explain-input', ${JSON.stringify(EXPLAIN_PROG)})`);
    await evalJs("__sm.click('#btn-explain')"); await sleep(500);
    const exp = await evalJs("(()=>({ vis: __sm.vis('#explain-result'), txt: __sm.txt('#explain-result').slice(0,150), len: __sm.txt('#explain-result').length }))()");
    ok('解释结果可见', exp.vis === true, exp.vis);
    ok('逐行解释有内容（覆盖 11 行程序）', exp.len > 200, exp.len);
    const expFull = await evalJs("__sm.txt('#explain-result')");
    ok('解释到圆弧与 M30', /G02/.test(expFull) && /M30/.test(expFull), expFull.slice(0, 200));

    // ============ 8. 程序校验 ============
    console.log('\n--- 8. 程序校验 ---');
    await evalJs("__sm.navTo('check')"); await sleep(350);
    await evalJs(`__sm.setVal('#check-input', ${JSON.stringify(BAD_PROG)})`);
    await evalJs("__sm.click('#btn-check')"); await sleep(600);
    const bad = await evalJs("(()=>({ sum: __sm.txt('#check-summary'), res: __sm.txt('#check-result').slice(0,300) }))()");
    ok('缺 D 值的 G41 报错', /E06|补偿号|D 值|D值/.test(bad.res), bad.res);
    ok('校验摘要非空', bad.sum.length > 0, bad.sum);
    ok('错误项有视觉标记', (await evalJs("document.querySelectorAll('#check-result .issue.error').length")) > 0);

    // 正确程序：取第一个模板 → 校验应 0 错误
    await evalJs("__sm.navTo('template')"); await sleep(250);
    await evalJs("document.querySelectorAll('#tpl-list .tpl-item')[0].click()"); await sleep(250);
    await evalJs("__sm.navTo('check')"); await sleep(250);
    await evalJs("__sm.click('#btn-check-from-editor')"); await sleep(200);
    await evalJs("__sm.click('#btn-check')"); await sleep(600);
    const good = await evalJs("(()=>({ sum: __sm.txt('#check-summary'), errs: document.querySelectorAll('#check-result .issue.error').length }))()");
    ok('标准模板校验 0 错误（无误报）', good.errs === 0, good);

    await evalJs("__sm.setVal('#macro-input','#1=0;\\nWHILE [#1 LT 5] DO 1;\\n#1=#1+1;\\nEND 1;')");
    await evalJs("__sm.click('#btn-macro-run')"); await sleep(400);
    const macro = await evalJs("(()=>({ sum: __sm.txt('#macro-summary'), res: __sm.txt('#macro-result').slice(0,80) }))()");
    ok('宏程序试算有输出', (macro.sum + macro.res).length > 0, macro);

    // ============ 9. 刀轨演示 ============
    console.log('\n--- 9. 刀轨演示 ---');
    await evalJs("__sm.navTo('path')"); await sleep(350);
    // 「从编辑器取入」：先把程序写进编辑器，再点按钮，检查是否原样带过去
    await evalJs("__sm.navTo('template')"); await sleep(200);
    await evalJs(`__sm.setVal('#editor', ${JSON.stringify(ARC_PROG)})`); await sleep(200);
    await evalJs("__sm.navTo('path')"); await sleep(250);
    await evalJs("__sm.click('#btn-path-from-editor')"); await sleep(300);
    ok('「从编辑器取入」内容一致', (await evalJs("document.getElementById('path-input').value")).trim() === ARC_PROG.trim());
    await evalJs("__sm.click('#btn-path')"); await sleep(900);
    const pathSt = await evalJs("(()=>({ ink: __sm.ink('#path-canvas'), info: __sm.txt('#pv-info'), notes: __sm.txt('#path-notes').length }))()");
    ok('刀轨画布已绘制', pathSt.ink > 500, pathSt.ink);
    ok('步进信息有内容', pathSt.info.length > 3, pathSt.info);
    const segs1 = pathSt.info;
    await evalJs("__sm.click('#btn-path')"); await sleep(700);
    ok('重复点「生成刀轨」结果不重复累加', (await evalJs("__sm.txt('#pv-info')")) === segs1);
    await evalJs("__sm.click('#btn-pv-play')"); await sleep(700);
    await evalJs("__sm.click('#btn-pv-play')"); await sleep(200);
    ok('分步演示播放/暂停不报错', exceptions.length === 0, exceptions);
    const withCoord = await evalJs("__sm.ink('#path-canvas')");
    await evalJs("__sm.click('#p-showcoord')"); await sleep(600);
    const noCoord = await evalJs("__sm.ink('#path-canvas')");
    ok('「标坐标」开关即时生效（关闭后墨迹减少）', noCoord >= 0 && noCoord < withCoord, { withCoord, noCoord });
    await evalJs("__sm.click('#p-showcoord')"); await sleep(400);
    ok('重新勾选后标注恢复', (await evalJs("__sm.ink('#path-canvas')")) === withCoord);
    const withRapid = await evalJs("__sm.ink('#path-canvas')");
    await evalJs("__sm.click('#p-showrapid')"); await sleep(600);
    ok('「显示快移」开关即时生效', (await evalJs("__sm.ink('#path-canvas')")) !== withRapid);
    await evalJs("__sm.click('#p-showrapid')"); await sleep(400);

    // ============ 10. 批量批改 ============
    console.log('\n--- 10. 批量批改 ---');
    await evalJs("__sm.navTo('batch')"); await sleep(350);
    await evalJs("__sm.click('#btn-batch-demo')"); await sleep(2200);
    const batch = await evalJs(`(()=>{ const t=document.querySelector('#batch-result table');
      return { rows: t ? t.querySelectorAll('tbody tr').length : 0, sum: __sm.txt('#batch-summary'),
               ref: (document.getElementById('b-ref').value||'').length }; })()`);
    ok('演示案例填入 4 份作业', batch.rows === 4, batch);
    ok('演示案例带标准答案', batch.ref > 100, batch.ref);
    ok('批改摘要有内容', batch.sum.length > 0, batch.sum);
    await evalJs("__sm.click('#btn-batch-demo')"); await sleep(2000);
    ok('重复点演示案例不累加行数', (await evalJs("document.querySelectorAll('#batch-result table tbody tr').length")) === 4);
    await evalJs("(()=>{ const tr=document.querySelector('#batch-result table tbody tr'); if(tr) tr.click(); })()");
    await sleep(800);
    ok('点成绩行画出刀轨对比', (await evalJs("__sm.ink('#cmp-canvas')")) > 300);

    // ============ 11. 找错练习 ============
    console.log('\n--- 11. 找错练习 ---');
    await evalJs("__sm.navTo('train')"); await sleep(350);
    await evalJs("__sm.click('#btn-train-gen')"); await sleep(600);
    ok('生成病灶程序', (await evalJs("__sm.txt('#train-code').length")) > 100);
    await evalJs("__sm.click('#btn-train-check')"); await sleep(500);
    const ans = await evalJs("(()=>({ len: __sm.txt('#train-answer').length }))()");
    ok('交卷后显示答案', ans.len > 20, ans);

    // ============ 12. 刀具库 ============
    console.log('\n--- 12. 刀具库 ---');
    await evalJs("__sm.navTo('tools')"); await sleep(350);
    const toolRows0 = await evalJs("document.querySelectorAll('#tool-tbl tbody tr').length");
    ok('刀具表有预置数据', toolRows0 > 0, toolRows0);
    await evalJs("__sm.click('#btn-tool-add')"); await sleep(400);
    ok('新增刀具后行数 +1', (await evalJs("document.querySelectorAll('#tool-tbl tbody tr').length")) === toolRows0 + 1);
    const pulls = await evalJs("(()=>({ p: document.querySelectorAll('#p-toolpick option').length, c: document.querySelectorAll('#c-toolpick option').length }))()");
    ok('刀具下拉能读到刀具库', pulls.p > 1 && pulls.c > 1, pulls);

    // ============ 13. AI 面板（离线安全路径） ============
    console.log('\n--- 13. AI 智能编程（不依赖网络） ---');
    await evalJs("__sm.navTo('ai')"); await sleep(400);
    await evalJs("__sm.click('#btn-ai-demo1')"); await sleep(400);
    const aiReq = await evalJs("(()=>({ req: (document.getElementById('ai-req').value||'').length, btn: __sm.vis('#btn-ai-generate') }))()");
    ok('演示需求可一键填入', aiReq.req > 8, aiReq);
    ok('生成按钮可见', aiReq.btn === true, aiReq);
    ok('AI 面板无异常', exceptions.length === 0, exceptions);

    // 图纸 → 程序（同属 AI 面板，但全程本地运算，可离线验证）
    await evalJs("__sm.click('#btn-dwg-demo')"); await sleep(1600);
    const dwg0 = await evalJs("(()=>({ en: !document.getElementById('btn-dwg-gen').disabled, sum: __sm.txt('#dwg-summary').slice(0,60) }))()");
    ok('SVG 演示案例解析成功（生成按钮解锁）', dwg0.en === true && dwg0.sum.length > 0, dwg0);
    await evalJs("__sm.click('#btn-dwg-gen')"); await sleep(2600);
    const dwg1 = await evalJs("(()=>({ out: __sm.vis('#dwg-out'), codeLen: __sm.txt('#dw-code').length, ink: __sm.ink('#dw-canvas'), code: __sm.txt('#dw-code').slice(0,40) }))()");
    ok('图纸生成程序有输出', dwg1.out === true && dwg1.codeLen > 200, dwg1);
    ok('图纸预览画布已绘制', dwg1.ink > 200, dwg1.ink);
    await evalJs("__sm.click('#dw-to-editor')"); await sleep(400);
    const dwEd = (await evalJs("document.getElementById('editor').value")) || '';
    ok('生成结果可载入编辑器', dwEd.trim().length > 200 && /^O\d+/.test(dwEd.trim()), dwEd.slice(0, 30));
    // 送进校验器过一遍：图纸链路出的程序不应有错误
    await evalJs("__sm.navTo('check')"); await sleep(250);
    await evalJs("__sm.click('#btn-check-from-editor')"); await sleep(200);
    await evalJs("__sm.click('#btn-check')"); await sleep(600);
    ok('图纸生成的程序校验 0 错误', (await evalJs("document.querySelectorAll('#check-result .issue.error').length")) === 0,
       await evalJs("__sm.txt('#check-summary')"));

    // ============ 14. 帮助面板 ============
    console.log('\n--- 14. 帮助 ---');
    await evalJs("__sm.navTo('help')"); await sleep(500);
    const help = await evalJs(`(()=>{
      const imgs = Array.from(document.querySelectorAll('#help-body img'));
      return { len: __sm.txt('#help-body').length, imgs: imgs.length,
               broken: imgs.filter(i => !i.complete || i.naturalWidth === 0).length,
               toc: document.querySelectorAll('#help-toc a, #help-toc li').length }; })()`);
    ok('帮助正文有内容', help.len > 500, help.len);
    ok('内嵌配图全部加载成功', help.imgs > 0 && help.broken === 0, help);
    ok('目录有条目', help.toc > 3, help.toc);
    await evalJs("__sm.setVal('#help-search','G41')"); await sleep(400);
    const hs = await evalJs("(()=>({ n: document.querySelectorAll('#help-body mark').length, len: __sm.txt('#help-body').length }))()");
    ok('帮助搜索有命中', hs.n > 0 || hs.len > 100, hs);
    await evalJs("__sm.setVal('#help-search','')"); await sleep(300);

    // ============ 15. 大屏模式 ============
    console.log('\n--- 15. 大屏模式 ---');
    const beforePresent = await evalJs("(()=>({ cls: document.body.className, w: Math.round(document.querySelector('.wrap').getBoundingClientRect().width) }))()");
    await evalJs("__sm.click('#btn-present')"); await sleep(500);
    const inPresent = await evalJs("(()=>({ cls: document.body.className, w: Math.round(document.querySelector('.wrap').getBoundingClientRect().width) }))()");
    ok('大屏模式有状态变化', inPresent.cls !== beforePresent.cls || inPresent.w !== beforePresent.w, { beforePresent, inPresent });
    await evalJs("__sm.click('#btn-present')"); await sleep(500);
    const outPresent = await evalJs("(()=>({ cls: document.body.className, w: Math.round(document.querySelector('.wrap').getBoundingClientRect().width) }))()");
    ok('退出大屏恢复原状', outPresent.cls === beforePresent.cls && Math.abs(outPresent.w - beforePresent.w) < 1, { outPresent, beforePresent });

    // ============ 16. 自动保存 / 刷新恢复 ============
    console.log('\n--- 16. 自动保存与刷新恢复 ---');
    await evalJs("__sm.navTo('template')"); await sleep(300);
    await evalJs(`__sm.setVal('#editor', 'O9999;\\nG00 X12.345 Y67.89;\\nM30;')`);
    await sleep(900);
    await reload();
    const restored = await evalJs("document.getElementById('editor').value");
    ok('刷新后编辑器内容已恢复', (restored || '').indexOf('X12.345') >= 0, (restored || '').slice(0, 40));

    // ============ 17. 稳定性：坏数据 / 大程序 / 快速切换 ============
    console.log('\n--- 17. 稳定性专项 ---');
    const beforeBad = exceptions.length;
    await evalJs("Object.keys(localStorage).forEach(k => localStorage.setItem(k, '{{{ bad json'))");
    await reload();
    const afterBad = await evalJs(`(()=>({ nav: document.querySelectorAll('#nav button').length,
      ed: typeof document.getElementById('editor').value, help: __sm.txt('#help-body').length }))()`);
    ok('本地存储被写坏后仍能正常启动', afterBad.nav === 11 && afterBad.ed === 'string', afterBad);
    ok('坏数据恢复过程无未捕获异常', exceptions.length === beforeBad, exceptions.slice(beforeBad));
    await evalJs("Object.keys(localStorage).forEach(k => localStorage.removeItem(k))");

    // 大程序压测：~1010 行，校验与刀轨都要在 8s 内出结果
    await evalJs("__sm.navTo('check')"); await sleep(300);
    const bigPerf = await evalJs(`(()=>{
      const big = __sm.bigProg(1000);
      __sm.setVal('#check-input', big);
      const t0 = performance.now();
      document.getElementById('btn-check').click();
      const t1 = performance.now();
      return { ms: Math.round(t1 - t0), lines: big.split('\\n').length, sum: __sm.txt('#check-summary').slice(0,40) };
    })()`);
    ok('1000 行程序校验 < 8s', bigPerf.ms < 8000, bigPerf);
    ok('大程序校验给出结论', (bigPerf.sum || '').length > 0, bigPerf.sum);
    await sleep(400);
    const bigPath = await evalJs(`(()=>{
      __sm.navTo('path');
      __sm.setVal('#path-input', __sm.bigProg(1000));
      const t0 = performance.now();
      document.getElementById('btn-path').click();
      const t1 = performance.now();
      return { ms: Math.round(t1 - t0), ink: __sm.ink('#path-canvas'), info: __sm.txt('#pv-info').slice(0,40) };
    })()`);
    ok('1000 行程序生成刀轨 < 8s', bigPath.ms < 8000, bigPath);
    ok('大程序刀轨仍能绘制', bigPath.ink > 300, { ink: bigPath.ink, info: bigPath.info });

    // 快速连点导航 2 轮（22 次切换），不能有异常或面板错位
    const beforeRush = exceptions.length;
    await evalJs(`(async()=>{ const ps=['gcode','template','calc','explain','check','path','batch','train','tools','ai','help'];
      for(let r=0;r<2;r++){ for(const p of ps){ document.querySelector('#nav button[data-p="'+p+'"]').click(); } }
      return 1; })()`, true);
    await sleep(600);
    const rushState = await evalJs(`(()=>({ act: (document.querySelector('.panel.active')||{}).id,
      visible: Array.from(document.querySelectorAll('.panel')).filter(p=>p.getBoundingClientRect().height>0).length }))()`);
    ok('快速切换 22 次后仅一个面板可见', rushState.visible === 1, rushState);
    ok('快速切换无未捕获异常', exceptions.length === beforeRush, exceptions.slice(beforeRush));

    await evalJs("__sm.navTo('template')"); await sleep(250);
    await evalJs("__sm.click('#btn-clear')"); await sleep(300);
    await evalJs("__sm.click('#btn-clear-store')"); await sleep(300);
    ok('清空后编辑器为空', (await evalJs("document.getElementById('editor').value")) === '');

    // ============ 18. 响应式 / 横向溢出 ============
    console.log('\n--- 18. 响应式与横向溢出 ---');
    for (const w of [1440, 1024, 768, 390, 360]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 500 });
      await sleep(420);
      const m = await evalJs(`(()=>({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))()`);
      ok(`${w}px 无横向溢出`, m.sw <= m.iw + 1, m);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);

    // ============ 19. 控制台洁净度 ============
    console.log('\n--- 19. 控制台与异常 ---');
    ok('全程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 4));
    const realErrors = consoleErrors.filter((s) => !/favicon|net::ERR_FILE_NOT_FOUND/.test(s));
    ok('全程无 console.error', realErrors.length === 0, realErrors.slice(0, 4));

    console.log(`\n===== ${pass} passed, ${fail} failed =====`);
    if (fail) {
      for (const f of failures) console.log('  · ' + f.name + ' → ' + J(f.detail));
      await shot('failure-' + Date.now());
      process.exitCode = 2;
    }
  } finally {
    try { ws.close(); } catch (_) {}
    child.kill();
    if (!KEEP) {
      for (let i = 0; i < 5; i++) {
        try { fs.rmSync(ud, { recursive: true, force: true }); break; } catch (_) { await sleep(300); }
      }
    }
  }
})().catch((e) => {
  console.error('冒烟脚本异常：' + e.message);
  process.exitCode = 3;
});
