const fs = require('fs');
let s = fs.readFileSync('app.html', 'utf8');

const a = `function dwgExtractJson(text){
  if(!text) return null;
  let s = String(text).trim();
  const fence = /\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i.exec(s);
  if(fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if(a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b+1)); } catch(e) { return null; }
}`;
const b = `// 从模型回复里抠出 JSON：模型经常夹解释、多个代码块、或只输出半个对象，
// 所以按「平衡括号」把所有候选片段都取出来，从最长的开始逐个试。
function dwgExtractJson(text){
  if(!text) return null;
  const src = String(text);
  const cands = [];

  // 1) 优先取 ``` 围栏里的内容
  const fence = /\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/gi;
  let f;
  while((f = fence.exec(src))){
    const t = f[1].trim();
    try { cands.push(JSON.parse(t)); } catch(e){ /* 留待后续片段解析 */ }
    cands.push(t);
  }

  // 2) 扫所有平衡花括号片段
  const push = (str)=>{
    let depth = 0, start = -1, inStr = false, esc = false;
    for(let i = 0; i < str.length; i++){
      const ch = str[i];
      if(inStr){
        if(esc) esc = false;
        else if(ch === '\\\\') esc = true;
        else if(ch === '"') inStr = false;
        continue;
      }
      if(ch === '"'){ inStr = true; continue; }
      if(ch === '{'){ if(depth === 0) start = i; depth++; }
      else if(ch === '}'){ if(depth > 0){ depth--; if(depth === 0 && start >= 0) cands.push(str.slice(start, i + 1)); } }
    }
  };
  push(src);

  // 3) 从长到短试解析，第一个含 contours/holes/error 的才算数
  const texts = cands.filter(x=>typeof x === 'string')
    .sort((p,q)=>q.length - p.length);
  const objs = cands.filter(x=>x && typeof x === 'object');
  for(const o of objs){
    if(o.contours || o.holes || o.error) return o;
  }
  for(const t of texts){
    let o;
    try { o = JSON.parse(t); } catch(e){ continue; }
    if(o && (o.contours || o.holes || o.error)) return o;
  }
  // 兜底：任何能解析的对象
  for(const t of texts){
    try { return JSON.parse(t); } catch(e){ /* 继续 */ }
  }
  return null;
}`;
if (!s.includes(a)) throw new Error('提取器锚点未命中');
s = s.replace(a, b);
fs.writeFileSync('app.html', s);
console.log('JSON 提取器已强化');
