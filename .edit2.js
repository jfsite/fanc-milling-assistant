const fs = require('fs');
let s = fs.readFileSync('app.html', 'utf8');

const a = `    const rows = prims.map((p,i)=>'<tr><td class="n">' + (i+1) + '</td><td>' + p.kind
      + '</td><td style="font-family:var(--mono);font-size:12px">' + esc(dwgPrimText(p)) + '</td>'
      + '<td class="n">' + dwgPrimLen(p).toFixed(2) + '</td></tr>').join('');
    h += '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:13px;color:var(--sub);padding:4px 0">'
      + '图元清单（' + prims.length + ' 条，逐条核对 R 值与坐标）</summary>'
      + '<div style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:8px">'
      + '<table><thead><tr><th style="width:44px">#</th><th style="width:72px">类型</th><th>参数</th><th style="width:72px">长度</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div></details>';`;

const b = `    const rows = prims.map((p,i)=>'<tr><td class="n">' + (i+1) + '</td><td>' + p.kind
      + '</td><td>' + dwgPrimInputs(p, i) + '</td>'
      + '<td class="n">' + dwgPrimLen(p).toFixed(2) + '</td></tr>').join('');
    h += '<details id="dw-prims-box" style="margin-top:10px" open><summary style="cursor:pointer;font-size:13px;color:var(--sub);padding:4px 0">'
      + '图元清单（' + prims.length + ' 条，可直接改数值）</summary>'
      + '<div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:8px">'
      + '<table><thead><tr><th style="width:40px">#</th><th style="width:60px">类型</th><th>参数（可改）</th><th style="width:66px">长度</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>'
      + '<div class="row" style="margin-top:8px"><button class="ghost" id="dw-apply-prims">应用修改并重新合成</button>'
      + '<span class="hint" style="align-self:center">改完点这里，会重算闭合/自交/尺寸</span></div></details>';`;

if (!s.includes(a)) throw new Error('图元表锚点未命中');
s = s.replace(a, b);

// 渲染输入框的辅助函数 + 绑定按钮
const helper = `
// A：把一条图元渲染成可编辑的输入框
function dwgPrimInputs(p, i){
  const f = (k, v, w)=>{
    const step = (k === 'a0' || k === 'a1') ? '1' : '0.01';
    return '<input class="dw-pf" data-i="' + i + '" data-k="' + k + '" type="number" step="' + step
      + '" style="width:' + (w || 74) + 'px" value="' + (+v).toFixed(2) + '">';
  };
  const tip = (t)=>' <span style="font-size:11px;color:var(--tertiary,#94a3b8)">' + t + '</span>';
  if(p.kind === 'line'){
    return tip('X1') + f('x1', p.x1) + tip('Y1') + f('y1', p.y1)
         + tip('X2') + f('x2', p.x2) + tip('Y2') + f('y2', p.y2);
  }
  if(p.kind === 'circle'){
    return tip('X') + f('cx', p.cx) + tip('Y') + f('cy', p.cy) + tip('R') + f('r', p.r);
  }
  return tip('X') + f('cx', p.cx) + tip('Y') + f('cy', p.cy) + tip('R') + f('r', p.r)
       + tip('起角') + f('a0', p.a0, 62) + tip('终角') + f('a1', p.a0 + p.sw, 62);
}
`;
const anchor2 = '// A：图元可编辑 ---';
if (!s.includes(anchor2)) throw new Error('A 段锚点未命中');
s = s.replace(anchor2, helper.trim() + '\n\n' + '// --- A：图元可编辑 ---');

// 在 dwgRenderSummary 末尾绑定"应用修改"
const a3 = `  const btn = document.getElementById('dw-get-svg');
  if(btn) btn.onclick = ()=>{`;
const b3 = `  const applyBtn = document.getElementById('dw-apply-prims');
  if(applyBtn) applyBtn.onclick = ()=>{
    const edited = dwgReadPrimEdits();
    DWG.dims = [];
    dwgRecompose(edited);
  };

  const btn = document.getElementById('dw-get-svg');
  if(btn) btn.onclick = ()=>{`;
if (!s.includes(a3)) throw new Error('summary 尾锚点未命中');
s = s.replace(a3, b3);

fs.writeFileSync('app.html', s);
console.log('图元表已改为可编辑');
