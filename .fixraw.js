const fs = require('fs');
let s = fs.readFileSync('app.html', 'utf8');
const a = `function dwgPrimToRaw(p){
  if(p.kind === 'line') return {type:'line', x1:p.x1, y1:p.y1, x2:p.x2, y2:p.y2};`;
const b = `function dwgPrimToRaw(p){
  if(!p) return p;
  if(p.type) return p;   // 已经是原始格式（基点建模生成的），直接用
  if(p.kind === 'line') return {type:'line', x1:p.x1, y1:p.y1, x2:p.x2, y2:p.y2};`;
if (!s.includes(a)) throw new Error('锚点未命中');
s = s.replace(a, b);
fs.writeFileSync('app.html', s);

// 测试：raw 与 normalized 都能转
let t = fs.readFileSync('tests/run-tests.js', 'utf8');
t = t.replace("dwgParsePoints, dwgArcFrom2Pts, dwgPointsToPrims};'", "dwgParsePoints, dwgArcFrom2Pts, dwgPointsToPrims, dwgPrimToRaw};'");
const anchor = "// 混合图元仍闭合";
if (!t.includes(anchor)) throw new Error('测试锚点未命中');
t = t.replace(anchor, `const rawLine = {type:'line', x1:0, y1:0, x2:10, y2:0};
ok('原始格式原样返回', M.dwgPrimToRaw(rawLine) === rawLine);
ok('归一化格式转回原始', (M.dwgPrimToRaw({kind:'arc', cx:1, cy:2, r:3, a0:10, sw:20}) || {}).type === 'arc');

// 混合图元仍闭合`);
fs.writeFileSync('tests/run-tests.js', t);
console.log('已修复并加断言');
