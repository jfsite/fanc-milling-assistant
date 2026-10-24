// 文档同步工具：让 docs/使用说明.md 与 index.html 里的「帮助」面板保持一致
//
//   node tools/sync-doc.js --embed     用 docs/使用说明.md + docs/img/*.png 更新 app.html
//   node tools/sync-doc.js --extract   从 app.html 反向导出 docs/使用说明.md
//
// 约定：
//   - 文档里图片写成 ![说明](img/panel-x.png)，嵌进 HTML 时自动转成 img:panel-x
//   - 图片以 base64 内嵌，保证 app.html 始终是「一个文件拷走就能用」
//   - 修改流程：改 md 或换图 → 跑 --embed → 刷新页面即可看到
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'app.html');
const MD = path.join(ROOT, 'docs', '使用说明.md');
const IMGDIR = path.join(ROOT, 'docs', 'img');

const TAG_MD = '<script type="text/markdown" id="help-md">';
const TAG_IMG = '<script type="application/json" id="help-img">';
const TAG_END = '</script>';

function blockRange(html, open){
  const a = html.indexOf(open);
  if(a < 0) throw new Error('app.html 里找不到 ' + open);
  const b = html.indexOf(TAG_END, a + open.length);
  if(b < 0) throw new Error('找不到 ' + open + ' 的结束标签');
  return { innerStart: a + open.length, innerEnd: b };
}

function replaceBlock(html, open, body){
  const r = blockRange(html, open);
  return html.slice(0, r.innerStart) + body + html.slice(r.innerEnd);
}

function readBlock(html, open){
  const r = blockRange(html, open);
  return html.slice(r.innerStart, r.innerEnd);
}

function embed(){
  const md = fs.readFileSync(MD, 'utf8').replace(/\]\(img\/([\w.-]+)\.png\)/g, '](img:$1)');
  const files = fs.readdirSync(IMGDIR).filter(f => /\.png$/i.test(f)).sort();
  const map = {};
  let bytes = 0;
  files.forEach(f => {
    const key = f.replace(/\.png$/i, '');
    const buf = fs.readFileSync(path.join(IMGDIR, f));
    bytes += buf.length;
    map[key] = 'data:image/png;base64,' + buf.toString('base64');
  });

  let html = fs.readFileSync(HTML, 'utf8');
  html = replaceBlock(html, TAG_IMG, JSON.stringify(map));
  html = replaceBlock(html, TAG_MD, '\n' + md.trim() + '\n');
  fs.writeFileSync(HTML, html);

  const missing = (md.match(/img:([\w.-]+)/g) || [])
    .map(s => s.slice(4))
    .filter(k => !(k in map));
  console.log('已嵌入：' + md.split('\n').length + ' 行文档、' + files.length + ' 张图（' + Math.round(bytes / 1024) + ' KB 原图）');
  if (missing.length) console.log('⚠ 文档引用了不存在的图：' + Array.from(new Set(missing)).join(', '));
}

function extract(){
  const html = fs.readFileSync(HTML, 'utf8');
  const md = readBlock(html, TAG_MD).trim().replace(/\]\(img:([\w.-]+)\)/g, '](img/$1.png)');
  fs.writeFileSync(MD, md + '\n');
  console.log('已导出：' + md.split('\n').length + ' 行到 docs/使用说明.md');
}

const arg = process.argv[2];
try {
  if (arg === '--embed') embed();
  else if (arg === '--extract') extract();
  else {
    console.log('用法：node tools/sync-doc.js --embed | --extract');
    console.log('  --embed    把 md + 图片写进 index.html 的帮助面板');
    console.log('  --extract  从 index.html 导出 md');
  }
} catch (e) {
  console.error('失败：' + e.message);
  process.exit(1);
}
