#!/usr/bin/env node
/**
 * 发版工具 —— 把「当前代码」固定成一个可回溯的版本。
 *
 * 用法：
 *   node tools/release.js            发版：查版本一致性 → 跑回归 → 存快照 → 提交 → 打 tag
 *   node tools/release.js --list     列出所有已发版本（tag + 快照 + 大小）
 *   node tools/release.js --check    只做检查，不写任何东西
 *
 * 产物：
 *   releases/vX.Y.Z.html             当时发布的单文件快照（可直接拷给学生）
 *   git tag vX.Y.Z                   指向含该快照的提交
 *
 * 前提：工作区必须干净（除 releases/ 外没有未提交改动），否则拒绝执行 ——
 * 版本快照必须对应一个确定的提交，不能混着半成品。
 *
 * 回滚某一版（链接不变，覆盖式重新发布）：
 *   git show v1.6.2:app.html > app.html      （v1.6.2 起应用在 app.html）
 *   git show v1.4.0:index.html > index.html  （更早的版本仍是 index.html）
 *   node tests/run-tests.js && 发布
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.dirname(__dirname);
const SHOT_DIR = path.join(ROOT, 'releases');
const NODE = process.execPath;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

function git(args, opts) {
  return run('git', args, opts);
}

function version() {
  const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  const m = /const APP_VERSION = "(\d+\.\d+\.\d+)";/.exec(html);
  if (!m) throw new Error('app.html 里找不到 APP_VERSION');
  return m[1];
}

const steps = [];
function step(name, fn) {
  process.stdout.write(`  ${name} … `);
  try {
    const out = fn();
    steps.push(true);
    console.log(out || 'ok');
  } catch (e) {
    steps.push(false);
    console.log('失败');
    throw e;
  }
}

function check() {
  const v = version();
  step('版本一致性', () => {
    try {
      run(NODE, [path.join(ROOT, 'tools', 'version.js')], { stdio: 'pipe' });
      return 'ok';
    } catch (e) {
      throw new Error('版本号不一致，先跑 node tools/version.js 查看');
    }
  });
  step('回归测试', () => {
    let out;
    try {
      out = run(NODE, [path.join(ROOT, 'tests', 'run-tests.js')], { stdio: 'pipe' });
    } catch (e) {
      throw new Error('测试未通过：\n' + (e.stdout || '').split('\n').filter((l) => /FAIL|failed/.test(l)).join('\n'));
    }
    return (out.match(/=====.*=====/) || ['?'])[0];
  });
  return v;
}

function dirty(exceptPath) {
  const out = git(['status', '--porcelain']).trim();
  if (!out) return [];
  return out.split('\n')
    .map((l) => l.slice(3).trim())
    .filter((p) => !(exceptPath && p.replace(/\\/g, '/').startsWith(exceptPath)));
}

function list() {
  const tags = git(['tag', '-l', 'v*', '--sort=-v:refname']).trim().split('\n').filter(Boolean);
  if (!tags.length) {
    console.log('还没有任何版本 tag');
    return;
  }
  console.log('已发版本：');
  for (const t of tags) {
    const file = path.join(SHOT_DIR, `${t}.html`);
    const size = fs.existsSync(file) ? (fs.statSync(file).size / 1024).toFixed(0) + ' KB' : '（无快照）';
    let when = '';
    try { when = git(['log', '-1', '--format=%ad', '--date=short', t]).trim(); } catch (_) {}
    console.log(`  ${t.padEnd(10)} ${when.padEnd(12)} ${size}`);
  }
  console.log('\n回滚某版：git show <tag>:app.html > app.html  （v1.6.2 起；更早的 tag 用 index.html，快照在 releases/<tag>.html）');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) return list();

  console.log('发版检查：');
  const v = check();
  const tag = 'v' + v;
  const shot = path.join(SHOT_DIR, tag + '.html');

  if (args.includes('--check')) {
    console.log(`\n检查通过，可发版 ${tag}`);
    return;
  }

  const bad = dirty('releases/');
  if (bad.length) {
    console.log('\n工作区不干净，拒绝发版（版本快照必须对应确定提交）：');
    bad.forEach((p) => console.log('  M ' + p));
    console.log('\n先 git add -A && git commit，再跑本命令。');
    process.exitCode = 1;
    return;
  }

  console.log(`\n发版 ${tag}：`);
  step('写 version.json', () => {
    const file = path.join(ROOT, 'version.json');
    fs.writeFileSync(file, JSON.stringify({v, built: new Date().toISOString()}, null, 2) + '\n');
    return 'v' + v;
  });

  step('写快照', () => {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'app.html'), shot);
    return `releases/${tag}.html（${(fs.statSync(shot).size / 1024).toFixed(0)} KB）`;
  });

  step('提交快照', () => {
    git(['add', path.relative(ROOT, shot), 'version.json']);
    if (git(['diff', '--cached', '--name-only']).trim()) {
      git(['commit', '-q', '-m', `release: ${tag} 快照`]);
      return 'ok';
    }
    return '无改动，跳过';
  });

  step('打 tag', () => {
    if (git(['tag', '-l', tag]).trim()) return '已存在，跳过';
    git(['tag', '-a', tag, '-m', `发布 ${tag}`]);
    return tag;
  });

  console.log(`\n完成。线上发布请再让助手执行 deploy（同一目录 → 链接不变）。`);
}

try {
  main();
} catch (e) {
  console.error('\n发版中止：' + e.message);
  process.exitCode = 2;
}
