#!/usr/bin/env node
/**
 * 版本号工具 —— 唯一数据源是 index.html 里的 `const APP_VERSION`。
 *
 * 用法：
 *   node tools/version.js                      查看当前版本 + 各处是否一致
 *   node tools/version.js --bump patch         1.5.0 → 1.5.1（默认动词）
 *   node tools/version.js --bump minor         1.5.0 → 1.6.0
 *   node tools/version.js --bump major         1.5.0 → 2.0.0
 *   node tools/version.js --set 1.7.3          直接指定
 *
 * 改版本时会自动同步：
 *   index.html   const APP_VERSION
 *   docs/使用说明.md  「> 版本 vX.Y.Z」
 *   HANDOVER.md  「代码版本：vX.Y.Z」
 *   CHANGELOG.md 顶部插入新条目（已存在则跳过）
 * 最后自动跑一次 `node tools/sync-doc.js --embed`，把带版本号的说明写回应用。
 * 回归测试不自动跑 —— 发布前请单独执行 `node tests/run-tests.js`。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.dirname(__dirname);
const P = {
  html: path.join(ROOT, 'index.html'),
  doc: path.join(ROOT, 'docs', '使用说明.md'),
  handover: path.join(ROOT, 'HANDOVER.md'),
  changelog: path.join(ROOT, 'CHANGELOG.md'),
};

const RE = {
  // 每个正则都必须是「(前缀)(版本)」两组，swap() 靠第一组做拼接
  html: /(const APP_VERSION = ")(\d+\.\d+\.\d+)/,
  // 文档里历史写法可能只有两段（v1.4），一并兼容
  doc: /(> 版本 v)(\d+(?:\.\d+)*)/,
  handover: /(代码版本：v)(\d+(?:\.\d+)*)/,
  changelog: /^## \[(\d+\.\d+\.\d+)\]/m,
};

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function current() {
  const m = RE.html.exec(read(P.html) || '');
  // 命名组不统一（有的两组、changelog 一组），版本号恒为最后一个捕获组
  if (!m) throw new Error('index.html 里找不到 const APP_VERSION = "x.y.z";');
  return m[m.length - 1];
}

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error('版本号必须形如 1.5.0：' + v);
  return m.slice(1).map(Number);
}

function bump(v, kind) {
  let [a, b, c] = parse(v);
  if (kind === 'major') { a += 1; b = 0; c = 0; }
  else if (kind === 'minor') { b += 1; c = 0; }
  else if (kind === 'patch') { c += 1; }
  else throw new Error('--bump 只接受 patch / minor / major：' + kind);
  return `${a}.${b}.${c}`;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 把某个文件里第一处「前缀+旧版本」换成新版本；返回是否改动 */
function swap(file, re, next) {
  const src = read(file);
  if (src == null) return 'missing';
  if (!re.test(src)) return 'no-pattern';
  const out = src.replace(re, (_, pre) => pre + next);
  if (out === src) return 'same';
  fs.writeFileSync(file, out);
  return 'ok';
}

function insertChangelog(next, note) {
  const src = read(P.changelog);
  if (src == null) return 'missing';
  const has = new RegExp(`^## \\[${next.replace(/\./g, '\\.')}\\]`, 'm').test(src);
  if (has) return 'exists';
  const head = `## [${next}] — ${today()}\n\n- ${note || '（待补充）'}\n\n`;
  const idx = src.search(/^## /m);
  const out = idx === -1 ? src.replace(/\s*$/, '\n\n') + head : src.slice(0, idx) + head + src.slice(idx);
  fs.writeFileSync(P.changelog, out);
  return 'ok';
}

function report() {
  const cur = current();
  const rows = [
    ['index.html', RE.html, P.html],
    ['docs/使用说明.md', RE.doc, P.doc],
    ['HANDOVER.md', RE.handover, P.handover],
    ['CHANGELOG.md', RE.changelog, P.changelog],
  ].map(([name, re, file]) => {
    const src = read(file);
    const m = src && re.exec(src);
    return { name, found: m ? m[m.length - 1] : null, ok: m ? m[m.length - 1] === cur : false };
  });

  console.log('当前版本 index.html: v' + cur);
  for (const r of rows) {
    const mark = r.found == null ? '✗ 无记录' : r.ok ? '✓ 一致' : '✗ ' + r.found;
    console.log(`  ${r.name.padEnd(20)} ${mark}`);
  }
  const bad = rows.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} 处不一致 —— 需要同步` : '\n全部一致');
  return bad === 0;
}

function apply(next, note) {
  swap(P.html, RE.html, next);
  const a = swap(P.doc, RE.doc, next);
  const b = swap(P.handover, RE.handover, next);
  const c = insertChangelog(next, note);
  console.log(`版本 → v${next}`);
  console.log(`  index.html        ok`);
  console.log(`  使用说明.md       ${a}`);
  console.log(`  HANDOVER.md       ${b}`);
  console.log(`  CHANGELOG.md      ${c}`);

  // 说明文档变了，必须回写进 index.html 的 help-md，否则应用内帮助仍是旧版本号
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sync-doc.js'), '--embed'], {
      cwd: ROOT, stdio: 'pipe',
    });
    console.log('  sync-doc --embed  ok（应用内帮助已同步）');
  } catch (e) {
    console.error('  sync-doc --embed  失败：' + (e.stderr ? e.stderr.toString().trim() : e.message));
    process.exitCode = 1;
  }
}

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] || null);
};

try {
  if (args.includes('--set')) {
    const v = get('--set');
    parse(v); // 先校验格式，不合法直接抛错
    apply(v, get('--note') || '（待补充）');
  } else if (args.includes('--bump')) {
    apply(bump(current(), get('--bump') || 'patch'), get('--note') || '（待补充）');
  } else {
    process.exitCode = report() ? 0 : 1;
  }
} catch (e) {
  console.error('错误：' + e.message);
  process.exitCode = 3;
}
