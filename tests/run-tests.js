// FANUC 铣削编程助手（W版）回归测试
// 用法: node tests/run-tests.js
// 直接从 index.html 抽取内联脚本，用轻量 DOM 桩在 Node 中执行后断言。
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const appMatch = html.match(/<script id="app-js">([\s\S]*?)<\/script>/);
if (!appMatch) { console.error('app.html 中找不到 <script id="app-js">'); process.exit(1); }
const js = appMatch[1];

// 版本号唯一数据源在页头的第一个 script 里（不在 app-js 内），抽取后注入全局，
// 让 renderVersion() 在桩环境也能跑，同时供第 10 节做一致性断言。
const verMatch = html.match(/const APP_VERSION = "(\d+\.\d+\.\d+)";/);
const APP_VER = verMatch ? verMatch[1] : null;
global.APP_VERSION = APP_VER;

function El(){
  return {
    value: '', textContent: '', innerHTML: '', className: '', disabled: false,
    style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, appendChild(){}, removeChild(){},
    onclick: null, oninput: null, onchange: null
  };
}
const store = {};
global.document = {
  getElementById(id){ if(!store[id]) store[id] = El(); return store[id]; },
  querySelector(){ return El(); },
  querySelectorAll(){ return []; },
  createElement(){ return El(); },
  addEventListener(){},
  body: El()
};
global.window = { addEventListener(){}, devicePixelRatio: 1 };
global.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
global.navigator = {};

const modPath = path.join(os.tmpdir(), 'fanuc-w-mod-' + process.pid + '.js');
fs.writeFileSync(modPath,
  js + '\nmodule.exports = {mEval, lintProgram, runMacro, runExplain, renderLint, renderMacro,'
     + ' tokenize, gname, mname, describeAddr, explainMacro, TEMPLATES,'
     + ' buildPath, arcCenterByR, arcSweep, segPoints, compRuns, splitBySep, maxDeviation,'
     + ' issuesHtml, RULE_DOC, niceStep, fmtTime, distToSeg, measuredDims, contourBBox, makeTrain, MUTATIONS,'
     + ' parseSvgIR, irToNC, dwgCheck, dwgExtractJson, dwgArea, dwgPathPolys, checkUpdate,'
     + ' dwgBBox, dwgPrimsToSvg, dwgNormPrim, dwgPrimPt, dwgPrimLen, dwgSelfIntersect, dwgDimsCheck,'
     + ' dwgFitCircle, dwgFitArcs, dwgParsePoints, dwgArcFrom2Pts, dwgPointsToPrims, dwgPrimToRaw};');
const M = require(modPath);

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if(cond) pass++;
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ->  ' + JSON.stringify(extra) : '')); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
const catchErr = fn => { try { fn(); return null; } catch(e) { return e.message; } };

console.log('--- 1. 宏表达式求值 ---');
ok('3+2=5', M.mEval('3+2') === 5);
ok('#1+2=5', M.mEval('#1+2', {'1':3}) === 5);
ok('优先级 2+3*4=14', M.mEval('2+3*4') === 14);
ok('括号 (2+3)*4=20', M.mEval('(2+3)*4') === 20);
ok('SIN[30]=0.5', near(M.mEval('SIN[30]'), 0.5, 1e-12));
ok('COS[60]=0.5', near(M.mEval('COS[60]'), 0.5, 1e-12));
ok('ATAN[1]=45', near(M.mEval('ATAN[1]'), 45, 1e-9));
ok('SQRT[16]=4', M.mEval('SQRT[16]') === 4);
ok('ROUND[2.6]=3', M.mEval('ROUND[2.6]') === 3);
ok('FIX[-2.7]=-2', M.mEval('FIX[-2.7]') === -2);
ok('FUP[2.1]=3', M.mEval('FUP[2.1]') === 3);
ok('ABS[-5]=5', M.mEval('ABS[-5]') === 5);
ok('10 MOD 3=1', M.mEval('10 MOD 3') === 1);
ok('[#1 LT 5] 真', M.mEval('[#1 LT 5]', {'1':3}) === 1);
ok('[#1 GE 5] 假', M.mEval('[#1 GE 5]', {'1':3}) === 0);
ok('AND 组合', M.mEval('[#1 GT 1] AND [#1 LT 9]', {'1':3}) === 1);
ok('#[#1] 间接引用', M.mEval('#[#1]', {'1':100, '100':7}) === 7);
ok('除零报错', catchErr(() => M.mEval('1/0')) !== null);
ok('SQRT 负数报错', catchErr(() => M.mEval('SQRT[-1]')) !== null);
ok('未知函数报错', catchErr(() => M.mEval('FOO[1]')) !== null);

console.log('--- 2. 词法分析 ---');
const t1 = M.tokenize('N10 G01 X0 Y0 G41 D01 F300 (建立刀补)');
ok('地址字 7 个', t1.words.length === 7, t1.words);
ok('括号注释提取', t1.comment === '建立刀补', t1.comment);
ok('G1 归一为 G01', M.gname('1') === 'G01');
ok('G50.1 保留小数', M.gname('50.1') === 'G50.1');
ok('M6 归一为 M06', M.mname(6) === 'M06');
const t2 = M.tokenize('O0001;');
ok('分号截断', t2.words.length === 1 && t2.words[0].letter === 'O');
ok('宏赋值不产生地址字', M.tokenize('#1=10;').words.length === 0);

console.log('--- 3. 程序校验规则 ---');
const good = `O0002;
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
const r1 = M.lintProgram(good, {pitch:1.5, nmax:8000});
ok('合格程序 0 错误', r1.issues.filter(x=>x.lv==='error').length === 0, r1.issues.filter(x=>x.lv==='error'));
ok('统计 19 段', r1.stats.seg === 19, r1.stats);
ok('G41 缺 D → E06', M.lintProgram(good.replace('G41 D01','G41')).issues.some(x=>x.rule==='E06'));
ok('刀补未取消 → E03', M.lintProgram(good.replace('G40 X-20 Y-20;','X-20 Y-20;')).issues.some(x=>x.rule==='E03'));
ok('缺 M30 → E02', M.lintProgram(good.replace('M30;','')).issues.some(x=>x.rule==='E02'));
ok('G43 缺 H → E05', M.lintProgram(good.replace('G43 H01','G43')).issues.some(x=>x.rule==='E05'));
ok('G90 G91 同段 → E07', M.lintProgram('O0009;\nG90 G91 G00 X0;\nM30;').issues.some(x=>x.rule==='E07'));

const g84bad = `O0010;
G21 G90 G17 G40 G49 G80;
G54 G00 X0 Y0;
M06 T01;
G43 H01 Z50 M03 S500;
G00 X0 Y0;
Z5;
G84 X0 Y0 Z-15 R2 F300;
G80;
G00 Z50;
M30;`;
const r84 = M.lintProgram(g84bad, {pitch:1.5, nmax:8000});
ok('G84 F 与螺距不符 → E09', r84.issues.some(x=>x.rule==='E09'), r84.issues.filter(x=>x.lv==='error'));
const r84b = M.lintProgram(g84bad.replace('F300','F750'), {pitch:1.5, nmax:8000});
ok('G84 F=750 校验通过 → I03', r84b.issues.some(x=>x.rule==='I03'));
ok('G84 F=750 不再报 E09', !r84b.issues.some(x=>x.rule==='E09'));
ok('圆弧缺 R/IJ → E10', M.lintProgram('O0011;\nG21 G90 G17 G40 G49 G80;\nG01 X10 F100;\nG02 X20 Y0;\nM30;').issues.some(x=>x.rule==='E10'));
ok('固定循环未取消 → E12', M.lintProgram('O0012;\nG21 G90 G80;\nM03 S800;\nG81 X0 Y0 Z-5 R2 F100;\nX20;\nM30;').issues.some(x=>x.rule==='E12'));
ok('END 与 DO 不配对 → E15', M.lintProgram('O0013;\nG21 G90;\n#1=0;\nWHILE [#1 LT 3] DO 1;\n#1=#1+1;\nEND 2;\nM30;').issues.some(x=>x.rule==='E15'));
ok('DO 无 END → E13', M.lintProgram('O0014;\nG21 G90;\nWHILE [#1 LT 3] DO 1;\n#1=#1+1;\nM30;').issues.some(x=>x.rule==='E13'));
ok('宏表达式语法错 → E16', M.lintProgram('O0015;\nG21 G90;\n#1=SIN[30;\nM30;').issues.some(x=>x.rule==='E16'));
ok('子程序未定义 → W11', M.lintProgram('O0016;\nG21 G90;\nM98 P8888;\nM30;').issues.some(x=>x.rule==='W11'));
ok('切削时主轴未开 → W04', M.lintProgram('O0017;\nG21 G90 G17;\nG00 X0 Y0;\nG01 X10 F100;\nM30;').issues.some(x=>x.rule==='W04'));
ok('结束前 Z 未抬 → E18', M.lintProgram('O0018;\nG21 G90 G17;\nM03 S1000;\nG00 X0 Y0;\nG01 Z-5 F100;\nM30;').issues.some(x=>x.rule==='E18'));
ok('指令片段不报结构错', !M.lintProgram('G68 X0 Y0 R45;\nG01 X10 F100;\nG69;').issues.some(x=>x.lv==='error'));

console.log('--- 4. 宏程序试算 ---');
const rw = M.runMacro('#1=0;\nWHILE [#1 LT 5] DO 1;\n#1=#1+1;\nEND 1;', '');
ok('WHILE 循环结果 #1=5', rw.vars['1'] === 5, rw.vars);
ok('WHILE 执行 17 步', rw.steps === 17, rw.steps);
const rgs = M.runMacro('#1=0;\nN10 #1=#1+1;\nIF [#1 LT 3] GOTO 10;\n#2=#1*10;', '');
ok('带 N 标号的累加 #1=3', rgs.vars['1'] === 3, rgs.vars);
ok('IF GOTO 后 #2=30', rgs.vars['2'] === 30, rgs.vars);
ok('初始变量传入', M.runMacro('#2=#1*2;', '#1=7').vars['2'] === 14);
ok('死循环 2000 步截断', M.runMacro('N10 GOTO 10;', '').steps === 2000);
ok('跳转目标缺失报错', !!M.runMacro('GOTO 99;', '').error);
const rnest = M.runMacro('#1=0;\n#2=0;\nWHILE [#1 LT 2] DO 1;\n#1=#1+1;\nWHILE [#2 LT 3] DO 2;\n#2=#2+1;\nEND 2;\nEND 1;', '');
ok('嵌套循环 #1=2', rnest.vars['1'] === 2, rnest.vars);
ok('嵌套循环 #2=3', rnest.vars['2'] === 3, rnest.vars);

console.log('--- 5. 解释与渲染 ---');
ok('D 解释为半径补偿号', M.describeAddr({letter:'D', str:'01'}, {gset:new Set(['G41'])}).indexOf('半径补偿号') >= 0);
ok('G02 的 R 解释为圆弧半径', M.describeAddr({letter:'R', str:'5'}, {gset:new Set(['G02'])}).indexOf('圆弧半径') >= 0);
ok('G81 的 R 解释为 R 平面', M.describeAddr({letter:'R', str:'2'}, {gset:new Set(['G81'])}).indexOf('R 平面') >= 0);
ok('G84 的 F 提示螺距', M.describeAddr({letter:'F', str:'750'}, {gset:new Set(['G84'])}).indexOf('螺距') >= 0);
ok('WHILE 语句解释', M.explainMacro('WHILE [#1 LT 5] DO 1').ins.indexOf('WHILE') >= 0);
ok('IF GOTO 语句解释', M.explainMacro('IF [#1 EQ 1] GOTO 10').ins.indexOf('N10') >= 0);

store['explain-input'] = Object.assign(El(), {value:'O0001;\nG41 D01 X0 Y0 F300\n#1=SIN[30]*100;'});
M.runExplain();
ok('解释面板有输出', store['explain-result'].innerHTML.length > 200);
ok('解释含地址字说明', store['explain-result'].innerHTML.indexOf('半径补偿号') >= 0);

console.log('--- 6. 刀轨引擎 ---');
const p1 = M.buildPath('O1;\nG21 G90;\nG00 X0 Y0;\nG01 X10 Y0 F100;\nG01 Y10;\nM30;', {toolR:0});
ok('两条直线 → 2 段', p1.segs.length === 2, p1.segs.length);
ok('切削长度 20mm', near(p1.lenCut, 20, 1e-6), p1.lenCut);
ok('包围盒 10×10', p1.bbox && near(p1.bbox.maxX-p1.bbox.minX, 10) && near(p1.bbox.maxY-p1.bbox.minY, 10), p1.bbox);
ok('工时 0.2 分', near(p1.tCut, 0.2, 1e-6), p1.tCut);

const p2 = M.buildPath('O2;\nG90;\nG01 X10 F100;\nG02 X0 Y0 R5;\nM30;', {toolR:0});
ok('R5 半圆 → 圆弧段', p2.segs.filter(s=>s.kind==='arc').length === 1, p2.segs.map(s=>s.kind));
ok('半圆弧长 ≈ π×5', near(Math.abs(p2.segs[1].sweep)*p2.segs[1].r, Math.PI*5, 0.02), Math.abs(p2.segs[1].sweep)*p2.segs[1].r);
ok('G02 顺时针 sweep 为负', p2.segs[1].sweep < 0, p2.segs[1].sweep);

const p3 = M.buildPath('O3;\nG90;\nG01 X10 F100;\nG03 X0 Y0 R5;\nM30;', {toolR:0});
ok('G03 逆时针 sweep 为正', p3.segs[1].sweep > 0, p3.segs[1].sweep);

const pFull = M.buildPath('O4;\nG90;\nG00 X10 Y0;\nG02 X10 Y0 I-10 J0 F100;\nM30;', {toolR:0});
ok('整圆 I/J 不被零位移跳过', pFull.segs.filter(s=>s.kind==='arc').length === 1, pFull.segs.length);
ok('整圆弧长 ≈ 2πr', near(pFull.lenCut, 2*Math.PI*10, 0.05), pFull.lenCut);

const pArcBad = M.buildPath('O5;\nG90;\nG01 X10 F100;\nG02 X0 Y0 R2;\nM30;', {toolR:0});
ok('R 过小有提示', pArcBad.notes.length > 0, pArcBad.notes);

const pComp = M.buildPath('O6;\nG90;\nG01 X10 F100;\nG41 D01 Y10;\nG40 X0;\nM30;', {toolR:5});
ok('G41 段记录补偿状态', pComp.segs.some(s=>s.comp === 'G41'), pComp.segs.map(s=>s.comp));
ok('偏置层生成 1 组', M.compRuns(pComp, 5).length === 1, M.compRuns(pComp, 5).length);
const run0 = M.compRuns(pComp, 5)[0];
ok('建立刀补段起点不偏置', near(run0.pts[0][0], 10, 1e-6), run0.pts[0]);
ok('建立刀补段终点偏置到左侧 x=5', near(run0.pts[1][0], 5, 1e-6), run0.pts[1]);
ok('偏置层 y 覆盖 0→10', near(run0.pts[0][1], 0, 1e-6) && near(run0.pts[run0.pts.length-1][1], 10, 1e-6), run0.pts);

const sqProg = 'O10;\nG90;\nG00 X-20 Y-20;\nG01 Z-3 F150;\nG41 D01 X0 Y0 F300;\nY50;\nX50;\nY0;\nX0;\nG40 X-20 Y-20;\nM30;';
const sqPts = M.compRuns(M.buildPath(sqProg, {toolR:5}), 5)[0].pts;
ok('偏置方形左上角 = (-5,55)', near(sqPts[2][0], -5, 1e-6) && near(sqPts[2][1], 55, 1e-6), sqPts[2]);
ok('偏置方形右上角 = (55,55)', near(sqPts[3][0], 55, 1e-6) && near(sqPts[3][1], 55, 1e-6), sqPts[3]);
ok('偏置方形右下角 = (55,-5)', near(sqPts[4][0], 55, 1e-6) && near(sqPts[4][1], -5, 1e-6), sqPts[4]);
ok('左边不进斜（两顶点 x 相同）', near(sqPts[1][0], sqPts[2][0], 1e-9), [sqPts[1][0], sqPts[2][0]]);
ok('左边 x 恒为 -5', near(sqPts[2][0], -5, 1e-6) && near(sqPts[1][0], -5, 1e-6), [sqPts[1][0], sqPts[2][0]]);
ok('进刀段起点取自编程点', near(sqPts[0][0], -20, 1e-6) && near(sqPts[0][1], -20, 1e-6), sqPts[0]);

const pHole = M.buildPath('O7;\nG90;\nM03 S800;\nG81 X0 Y0 Z-5 R2 F100;\nX20 Y0;\nG80;\nM30;', {toolR:0});
ok('固定循环识别 2 个孔', pHole.holes.length === 2, pHole.holes.length);
ok('孔位坐标正确', near(pHole.holes[1].x, 20), pHole.holes[1].x);

const pSub = M.buildPath('O1000;\nG90;\nG00 X0 Y0;\nM98 P2000;\nM30;\nO2000;\nG01 X10 F100;\nG01 Y10;\nM99;', {toolR:0});
ok('子程序展开 2 段', pSub.segs.length === 2, pSub.segs.length);
ok('展开后切削长 20', near(pSub.lenCut, 20, 1e-6), pSub.lenCut);

const pSubMulti = M.buildPath('O1;\nG91;\nM98 P2 L3;\nM30;\nO2;\nG01 X5 F100;\nM99;', {toolR:0});
ok('M98 L3 重复 3 次', near(pSubMulti.lenCut, 15, 1e-6), pSubMulti.lenCut);

const pInc = M.buildPath('O8;\nG91;\nG01 X10 F100;\nG01 X10;\nM30;', {toolR:0});
ok('G91 增量累加 → 20mm', near(pInc.lenCut, 20, 1e-9), pInc.lenCut);

const pRapid = M.buildPath('O9;\nG90;\nG00 X50 Y0;\nG01 X100 F1000;\nM30;', {toolR:0, rapid:20000});
ok('快移长度 50', near(pRapid.lenRapid, 50, 1e-9), pRapid.lenRapid);
ok('快移时间 0.0025 分', near(pRapid.tRapid, 0.0025, 1e-9), pRapid.tRapid);

ok('圆弧半径求解 R=5', near(M.arcCenterByR(0,0,10,0,5,true).r, 5, 1e-9));
ok('R 为负取优弧', Math.abs(M.arcCenterByR(0,0,6,0,-5,true).sweep) > Math.PI, M.arcCenterByR(0,0,6,0,-5,true));
ok('R 过小返回错误', !!M.arcCenterByR(0,0,10,0,2,true).err);

console.log('--- 7. 批量批改与讲义 ---');
ok('按 ==== 分份', M.splitBySep('O1;\nM30;\n====\nO2;\nM30;').length === 2);
ok('无分隔符视为 1 份', M.splitBySep('O1;\nM30;').length === 1);
const same = M.maxDeviation(p1, p1);
ok('自身对比偏差 0', same && near(same.max, 0, 1e-9), same);
const shifted = M.buildPath('O1;\nG90;\nG01 X10 Y1 F100;\nG01 X0 Y10;\nM30;', {toolR:0});
ok('偏移后有正偏差', M.maxDeviation(shifted, p1).max > 0.5);

ok('issuesHtml 含教学解释', M.issuesHtml(M.lintProgram('O1;\nG21 G90;\nM30;').issues).indexOf('为什么 / 怎么改') >= 0);
ok('RULE_DOC 覆盖全部错误码', Object.keys(M.RULE_DOC).length >= 30, Object.keys(M.RULE_DOC).length);
ok('每条规则都有 why/fix', Object.keys(M.RULE_DOC).every(k=>M.RULE_DOC[k].why && M.RULE_DOC[k].fix));
ok('fmtTime 格式化', M.fmtTime(1.5).indexOf('1 分') === 0, M.fmtTime(1.5));
ok('niceStep 自适应', M.niceStep(100) <= 10, M.niceStep(100));


console.log('--- 8. 代码联动 / 尺寸核对 / 找错练习 ---');
ok('包围盒含 G00，切削包围盒不含', (function(){
  const r = M.buildPath('O1;\nG90;\nG00 X-30 Y-30;\nG00 X0 Y0;\nG01 X10 Y0 F100;\nM30;', {toolR:0});
  return near(r.bbox.minX, -30, 1e-9) && near(r.bboxCut.minX, 0, 1e-9);
})());

ok('点到直线的距离', near(M.distToSeg(5, 3, {kind:'line', x0:0, y0:0, x1:10, y1:0}), 3, 1e-9));
ok('点在直线延长线外取端点', near(M.distToSeg(-5, 0, {kind:'line', x0:0, y0:0, x1:10, y1:0}), 5, 1e-9));
const arcSeg = {kind:'arc', x0:10, y0:0, x1:0, y1:10, cx:0, cy:0, r:10, sweep:Math.PI/2};
ok('点在圆弧上距离为 0', near(M.distToSeg(Math.cos(Math.PI/4)*10, Math.sin(Math.PI/4)*10, arcSeg), 0, 1e-9));
ok('点在弧外按半径差', near(M.distToSeg(15, 0, arcSeg), 5, 1e-9));
ok('点在弧端点外取端点距离', near(M.distToSeg(0, -10, arcSeg), Math.hypot(10, 10), 1e-9));

const sqProg2 = 'O2;\nG90;\nG00 X-20 Y-20;\nG01 X0 Y0 F100;\nG01 Y50;\nG01 X50;\nG01 Y0;\nG01 X0;\nM30;';
const sqRes = M.buildPath(sqProg2, {toolR:0});
const loop = M.contourBBox(sqRes);
ok('识别到闭合轮廓', !!loop, loop);
ok('闭环尺寸 50×50', loop && near(loop.maxX-loop.minX, 50, 1e-9) && near(loop.maxY-loop.minY, 50, 1e-9), loop);
const md = M.measuredDims(sqRes);
ok('实测尺寸排除进刀 = 50', near(md.w, 50, 1e-9) && near(md.h, 50, 1e-9) && md.byLoop, md);

const openRes = M.buildPath('O3;\nG90;\nG01 X10 F100;\nG01 Y10;\nM30;', {toolR:0});
ok('非闭合轮廓不产生闭环', M.contourBBox(openRes) === null);
ok('非闭合时回退全部切削范围', near(M.measuredDims(openRes).w, 10, 1e-9), M.measuredDims(openRes));

const seqRnd = (()=>{ let i=0; const seq=[0.1,0.9,0.3,0.7,0.5,0.2]; return ()=>seq[(i++)%seq.length]; })();
const trainBase = 'O1;\nG21 G90 G17 G40 G49 G80;\nG54 G00 X0 Y0;\nM06 T01;\nG43 H01 Z50 M03 S2500;\nG01 Z-3 F150;\nG41 D01 X0 Y0 F300;\nY50;\nX50;\nY0;\nG40 X-20 Y-20;\nM30;';
const tr = M.makeTrain(trainBase, 3, seqRnd);
ok('注入 1~3 处且不超上限', tr.faults.length >= 1 && tr.faults.length <= 3, tr.faults.length);
ok('错误行号互不重复', (function(){
  const ls = tr.faults.map(f=>f.line);
  return new Set(ls).size === ls.length;
})(), tr.faults.map(f=>f.line));
ok('注入后程序确实变了', tr.text !== trainBase);
const tl = M.lintProgram(tr.text, {pitch:1.5, nmax:8000});
ok('注入的错误全部被校验器检出', tr.faults.every(f=>tl.issues.some(x=>x.rule === f.rule)),
   tr.faults.map(f=>[f.rule, tl.issues.some(x=>x.rule === f.rule)]));
ok('行号能对上实际内容', tr.faults.every(f=>{
  const line = tr.text.split('\n')[f.line-1];
  return line !== undefined && line === f.after;
}), tr.faults.map(f=>[f.line, f.after]));

const mutBase = 'O1;\nG21 G90 G17 G40 G49 G80;\nG54 G00 X0 Y0;\nM06 T01;\nG43 H01 Z50 M03 S2500;\nG01 Z-3 F150;\nG41 D01 X0 Y0 F300;\nG02 X20 Y0 R10;\nG81 X0 Y0 Z-5 R2 F100;\nG84 X10 Y0 Z-15 R2 F750 S500;\nG80;\nG40 X-20 Y-20;\nM30;';
M.MUTATIONS.forEach(m=>{
  const lines = mutBase.split('\n');
  const idx = lines.findIndex(l=>m.find.test(l) && (!m.need || m.need.test(l)));
  ok('变异 '+m.rule+' 能找到目标行', idx >= 0, m.desc);
  if(idx < 0) return;
  const after = m.edit(lines[idx]);
  ok('变异 '+m.rule+' 确实改动了内容', after !== lines[idx], m.desc);
  lines[idx] = after;
  const lr = M.lintProgram(lines.join('\n'), {pitch:1.5, nmax:8000});
  ok('变异 '+m.rule+' 被校验器检出', lr.issues.some(x=>x.rule === m.rule),
     {after:after, rules:lr.issues.map(x=>x.rule)});
});

console.log('--- 9. 内置模板误报检查 ---');
M.TEMPLATES.forEach(t=>{
  const r = M.lintProgram(t.code, {pitch:1.5, nmax:8000});
  const errs = r.issues.filter(x=>x.lv==='error');
  ok('模板「'+t.t+'」0 错误', errs.length === 0, errs);
});

console.log('--- 10. 版本号一致性 ---');
const readDoc = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch(e) { return ''; }
};
const verIn = (src, re) => { const m = re.exec(src); return m ? m[1] : null; };
ok('APP_VERSION 存在且为 x.y.z', !!APP_VER, APP_VER);
ok('CHANGELOG 顶部条目与 APP_VERSION 一致',
   verIn(readDoc('CHANGELOG.md'), /^## \[(\d+\.\d+\.\d+)\]/m) === APP_VER);
ok('使用说明.md 版本与 APP_VERSION 一致',
   verIn(readDoc('docs/使用说明.md'), /> 版本 v(\d+\.\d+\.\d+)/) === APP_VER);
ok('HANDOVER.md 代码版本与 APP_VERSION 一致',
   verIn(readDoc('HANDOVER.md'), /代码版本：v(\d+\.\d+\.\d+)/) === APP_VER);
ok('页面徽标跟随 APP_VERSION',
   store['app-ver'] && store['app-ver'].textContent === 'v' + APP_VER, store['app-ver'] && store['app-ver'].textContent);
ok('应用内帮助的 md 块同一版本',
   new RegExp('> 版本 v' + String(APP_VER).replace(/\./g, '\\.')).test(html));


console.log('--- 11. 图纸 → 轮廓 → 程序 ---');
const SVG_SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50"><rect x="0" y="0" width="50" height="50" fill="none" stroke="#000"/></svg>';
const DR1 = M.parseSvgIR(SVG_SQUARE);
ok('SVG 方形解析成功', DR1.ok === true, DR1.error);
ok('SVG 方形尺寸 50×50', DR1.ok && near(DR1.ir.size.w, 50, 1e-6) && near(DR1.ir.size.h, 50, 1e-6), DR1.ok && DR1.ir.size);
ok('SVG 方形 1 条外轮廓', DR1.ok && DR1.ir.contours.length === 1 && DR1.ir.contours[0].role === 'outer');

const SVG_HOLE = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">'
  + '<rect x="0" y="0" width="100" height="60"/><circle cx="20" cy="30" r="5"/><circle cx="80" cy="30" r="4"/></svg>';
const DR2 = M.parseSvgIR(SVG_HOLE);
ok('矩形 + 2 孔：1 轮廓 2 孔', DR2.ok && DR2.ir.contours.length === 1 && DR2.ir.holes.length === 2);
ok('孔径按直径记录', DR2.ok && near(DR2.ir.holes[0].d, 10, 1e-6), DR2.ok && DR2.ir.holes);

// 大圆应当被当成外轮廓，而不是孔
const SVG_ROUND = '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20"/></svg>';
const DR3 = M.parseSvgIR(SVG_ROUND);
ok('整圆零件识别为外轮廓', DR3.ok && DR3.ir.contours.length === 1 && DR3.ir.holes.length === 0);

// 含 group transform 的图：外框 0..20 平移 10 后仍在原点归一化
const SVG_G = '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">'
  + '<g transform="translate(10 10)"><rect x="0" y="0" width="20" height="20"/></g></svg>';
const DR4 = M.parseSvgIR(SVG_G);
ok('g transform 生效且归一化', DR4.ok && near(DR4.ir.size.w, 20, 1e-6) && near(DR4.ir.size.h, 20, 1e-6), DR4.ok && DR4.ir.size);

// 无单位：按 96dpi 折算并给出警告
const SVG_PX = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96"/></svg>';
const DR5 = M.parseSvgIR(SVG_PX);
ok('px 图纸按 96dpi 折算为 25.4mm', DR5.ok && near(DR5.ir.size.w, 25.4, 1e-6), DR5.ok && DR5.ir.size);

// 路径：M + 弧 A（半圆），应离散成多点
const DPOLYS = M.dwgPathPolys('M0 0 A10 10 0 0 1 20 0 Z', 0.05);
ok('path 弧段被离散', DPOLYS.length === 1 && DPOLYS[0].length > 6, DPOLYS.length && DPOLYS[0].length);
ok('path 闭合回到起点', DPOLYS.length === 1 && near(DPOLYS[0][0][0], DPOLYS[0][DPOLYS[0].length-1][0], 1e-6));

// 解析失败要给明确原因
ok('空内容报错', M.parseSvgIR('').ok === false);
ok('非 SVG 报错', M.parseSvgIR('<html><body>x</body></html>').ok === false);
ok('无图元报错', M.parseSvgIR('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"></svg>').ok === false);

// --- 程序生成 ---
const DOPT = {mat:'45钢', toolNo:'01', toolD:10, flutes:2, ap:1, depth:3, safeZ:10, holeCycle:'auto'};
const DG1 = M.irToNC(DR1.ir, DOPT);
const DCODE1 = DG1.code;
ok('生成程序有程序号与 M30', /^O1001/m.test(DCODE1) && /M30/.test(DCODE1));
ok('生成程序有刀补建立与取消', /G41 D01/.test(DCODE1) && /G40/.test(DCODE1));
ok('深度 3 / ap 1 = 3 层', DG1.meta.nPass === 3 && (DCODE1.match(/OUTER PASS/g) || []).length === 3);
ok('主轴与进给已算出', DG1.meta.sp > 0 && DG1.meta.feed > 0, DG1.meta);
ok('含安全高度与回参考点', /G00 Z10/.test(DCODE1) && /G91 G28 Z0/.test(DCODE1));
ok('外轮廓从最高点切入（Y=50）', new RegExp('G41 D01 X[\\d.]+ Y50').test(DCODE1), DCODE1.split('\n').filter(l=>/G41/.test(l)));

// 方向：外轮廓必须为顺时针（G41 + 顺铣），用 y 递减段验证第一个角点
const DG2 = M.irToNC({contours:[{role:'outer', pts:[[0,0],[50,0],[50,50],[0,50]], closed:true}], holes:[], size:{w:50,h:50}}, DOPT);
const DPTS2 = (DG2.code.match(/G41 D01 X([\d.]+) Y([\d.]+)/) || []).slice(1).map(Number);
ok('逆时针输入被翻转为顺时针起点', near(DPTS2[1], 50, 1e-6), DPTS2);

// 孔：直径匹配走 G81；不匹配走铣圆 G02
const DG3 = M.irToNC(DR2.ir, Object.assign({}, DOPT, {toolD:10}));
ok('Ø10 孔匹配刀具走 G81、Ø8 孔改用铣圆', /G81/.test(DG3.code) && /G02 X[\d.]+ Y[\d.]+ I-4/.test(DG3.code), DG3.code.match(/G8[01][^\n]*|G02 X[^\n]*/g));
const DG4 = M.irToNC(DR2.ir, Object.assign({}, DOPT, {toolD:10, holeCycle:'mill'}));
ok('强制铣圆时出现整圆 G02 I-J', /G02 X[\d.]+ Y[\d.]+ I-/.test(DG4.code));

// --- 可加工性检查 ---
const DCHK = {toolD:10, blankW:200, blankH:200};
ok('正常图纸无错误', M.dwgCheck(DR2.ir, DCHK).filter(x=>x.lv==='error').length === 0);
const DNARROW = {contours:[{role:'inner', pts:[[0,0],[4,0],[4,40],[0,40]], closed:true}], holes:[], size:{w:4,h:40}};
ok('内轮廓窄于刀具报 D03', M.dwgCheck(DNARROW, DCHK).some(x=>x.code === 'D03' && x.lv === 'error'));
ok('无轮廓报 D01', M.dwgCheck({contours:[], holes:[]}, DCHK).some(x=>x.code === 'D01'));
ok('超毛坯报 D05', M.dwgCheck(DR2.ir, {toolD:10, blankW:50, blankH:50}).some(x=>x.code === 'D05'));

// --- 生成结果必须能过自己的校验器 ---
const DLR = M.lintProgram(DCODE1, {pitch:1.5, nmax:8000});
ok('生成的程序 0 错误', DLR.issues.filter(x=>x.lv === 'error').length === 0, DLR.issues.filter(x=>x.lv==='error'));
const DLR4 = M.lintProgram(DG4.code, {pitch:1.5, nmax:8000});
ok('铣圆版本 0 错误', DLR4.issues.filter(x=>x.lv === 'error').length === 0, DLR4.issues.filter(x=>x.lv==='error'));

// --- 模型回复 JSON 抽取 ---
ok('围栏 JSON 可解析', (M.dwgExtractJson('```json\n{"a":1}\n```') || {}).a === 1);
ok('夹在文字里也能解析', (M.dwgExtractJson('结果如下 {"a":2} 完毕') || {}).a === 2);
ok('非法 JSON 返回 null', M.dwgExtractJson('抱歉，我无法识别') === null);
ok('多个 JSON 块时取含 contours 的那个',
   (M.dwgExtractJson('先说明 {"note":"x"} 然后 {"contours":[{"points":[[0,0],[1,0],[1,1]]}],"holes":[]}') || {}).contours !== undefined);
ok('JSON 后有解释文字也能取',
   (M.dwgExtractJson('{"contours":[],"holes":[{"x":1,"y":2,"d":3}]}\n以上是识别结果，请核对。') || {}).holes.length === 1);
ok('字符串里带花括号不打断平衡扫描',
   (M.dwgExtractJson('{"notes":"图上写着 {R6} 和 (90\u00b0)","contours":[],"holes":[]}') || {}).notes.indexOf('R6') > 0);
ok('围栏 + 后缀说明可解析',
   (M.dwgExtractJson('\u597d\u7684\uff1a\n```json\n{"contours":[],"holes":[]}\n```\n\u4ee5\u4e0a') || {}).contours !== undefined);

ok('无 location 环境（Node/测试）下版本自检不报错', catchErr(()=>{ M.checkUpdate(); }) === null);

// --- 12. 图纸 → 图元 → SVG ---
const RECT4 = [
  {type:'line', x1:0,  y1:0,  x2:80, y2:0},
  {type:'line', x1:80, y1:0,  x2:80, y2:40},
  {type:'line', x1:80, y1:40, x2:0,  y2:40},
  {type:'line', x1:0,  y1:40, x2:0,  y2:0}
];
const ps1 = M.dwgPrimsToSvg(RECT4);
ok('四条直线合成 SVG', ps1.ok === true, ps1.error);
ok('矩形轮廓闭合', ps1.closed === true && ps1.closeGap === 0, ps1.closeGap);
ok('SVG 尺寸 80×40', near(ps1.size.w, 80, 1e-6) && near(ps1.size.h, 40, 1e-6), ps1.size);

const back1 = M.parseSvgIR(ps1.svg);
ok('SVG 能被自己的解析器读回', back1.ok === true, back1.error);
ok('读回后尺寸仍为 80×40', near(back1.ir.size.w, 80, 1e-6) && near(back1.ir.size.h, 40, 1e-6), back1.ir.size);
ok('读回后是 1 条闭合轮廓', back1.ir.contours.length === 1);

// 乱序图元也要能串起来
const SHUFFLED = [RECT4[2], RECT4[0], RECT4[3], RECT4[1]];
const ps2 = M.dwgPrimsToSvg(SHUFFLED);
ok('乱序图元自动串接成闭合', ps2.closed === true && ps2.gaps.length === 0, {closed:ps2.closed, gaps:ps2.gaps});

// 半圆 + 直径：验证圆弧角度与 Y 翻转
const HALF = [
  {type:'arc', cx:0, cy:0, r:10, a0:0, a1:180},
  {type:'line', x1:-10, y1:0, x2:10, y2:0}
];
const ps3 = M.dwgPrimsToSvg(HALF);
ok('半圆 + 直径闭合', ps3.ok && ps3.closed, ps3.closeGap);
ok('半圆外形 20×10', near(ps3.size.w, 20, 1e-6) && near(ps3.size.h, 10, 1e-6), ps3.size);
const back3 = M.parseSvgIR(ps3.svg);
const area3 = back3.ok ? Math.abs(M.dwgArea(back3.ir.contours[0].pts)) : 0;
ok('半圆面积≈157（πr²/2）', near(area3, Math.PI*100/2, 2), area3);
ok('弧长≈31.4（πr）', near(M.dwgPrimLen(M.dwgNormPrim(HALF[0])), Math.PI*10, 1e-6));

// 缺口要报出来
const GAPPED = [
  {type:'line', x1:0, y1:0, x2:80, y2:0},
  {type:'line', x1:80, y1:0, x2:80, y2:40},
  {type:'line', x1:80, y1:40, x2:0, y2:40}
];
const ps4 = M.dwgPrimsToSvg(GAPPED);
ok('开口轮廓标记未闭合', ps4.closed === false && ps4.closeGap > 39, ps4.closeGap);

// 0.3mm 的接缝要能焊上，且合成后仍是 1 条轮廓
const WELDED = [
  {type:'line', x1:0, y1:0, x2:80, y2:0},
  {type:'line', x1:80, y1:0.3, x2:80, y2:40},
  {type:'line', x1:80, y1:40, x2:0, y2:40},
  {type:'line', x1:0, y1:40, x2:0, y2:0.3}
];
const psW = M.dwgPrimsToSvg(WELDED);
ok('0.3mm 接缝被焊上并判为闭合', psW.closed === true && psW.welded.length === 1, {closed:psW.closed, gaps:psW.gaps});
ok('焊接后只有一个子路径', (psW.svg.match(/M/g) || []).length === 1, psW.svg.slice(0, 120));
ok('焊接后解析仍为 1 条轮廓', M.parseSvgIR(psW.svg).ir.contours.length === 1);

// 圆孔：circle 图元 → SVG 圆 → 解析成孔
const ps5 = M.dwgPrimsToSvg(RECT4.concat([{type:'circle', cx:40, cy:20, r:4, role:'hole'}]));
const back5 = M.parseSvgIR(ps5.svg);
ok('圆孔被识别为 Ø8', back5.ok && back5.ir.holes.length === 1 && near(back5.ir.holes[0].d, 8, 1e-6),
   back5.ok && back5.ir.holes);

// 自交检测
ok('矩形不自交', M.dwgSelfIntersect([[0,0],[80,0],[80,40],[0,40]]) === 0);
ok('蝴蝶形检出 1 处自交', M.dwgSelfIntersect([[0,0],[10,10],[10,0],[0,10]]) > 0);

// 尺寸一致性
const irRect = {size:{w:80,h:40}};
ok('标注 80 与外形相符时不告警', M.dwgDimsCheck(irRect, [{text:'80',value:80}]).length === 0);
ok('标注 60 与外形不符时告警', M.dwgDimsCheck(irRect, [{text:'60',value:60}]).some(x=>x.code === 'S03'));
ok('明显是别的尺寸（R100）不打扰', M.dwgDimsCheck(irRect, [{text:'R100',value:100}]).length === 0);

// --- 13. 折线 → 圆弧拟合 ---
const circlePts = (cx, cy, r, n)=>{
  const out = [];
  for(let i=0;i<n;i++){ const a = 2*Math.PI*i/n; out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]); }
  return out;
};
const fitC = M.dwgFitCircle(circlePts(0, 0, 20, 40));
ok('圆拟合出正确半径', fitC && near(fitC.r, 20, 0.01), fitC && fitC.r);
ok('圆拟合残差极小', fitC && fitC.err < 0.01, fitC && fitC.err);

const segC = M.dwgFitArcs(circlePts(0, 0, 20, 60), 0.02);
ok('整圆拟合为 1 段圆弧', segC.length === 1 && segC[0].kind === 'arc', segC.map(s=>s.kind));
ok('拟合半径正确', segC[0] && near(segC[0].r, 20, 0.05), segC[0] && segC[0].r);

const segSq = M.dwgFitArcs([[0,0],[40,0],[40,40],[0,40],[0,0]], 0.02);
ok('方形全判为直线', segSq.every(s=>s.kind === 'line'), segSq.map(s=>s.kind));

// 用圆的轮廓生成程序：应出现 G02/G03，而不是几十个 G01
const irCircle = {contours:[{role:'outer', pts:circlePts(50, 50, 20, 60), closed:true}], holes:[], size:{w:40,h:40}};
const ncC = M.irToNC(irCircle, {mat:'45钢', toolD:10, depth:2, ap:1, safeZ:10});
ok('圆轮廓输出 G02/G03', /G0[23] /.test(ncC.code), ncC.code.slice(0, 200));
ok('圆轮廓不再是一堆 G01', (ncC.code.match(/G01 X/g)||[]).length < 10, (ncC.code.match(/G01 X/g)||[]).length);
ok('圆弧用 I/J 表示', /G0[23] X[\d.-]+ Y[\d.-]+ I-?[\d.]+ J-?[\d.]+/.test(ncC.code), ncC.code.split('\n').filter(l=>/G0[23] /.test(l)).slice(0,2));
ok('拟合后的程序仍 0 错误',
   M.lintProgram(ncC.code, {pitch:1.5, nmax:8000}).issues.filter(x=>x.lv === 'error').length === 0,
   M.lintProgram(ncC.code, {pitch:1.5, nmax:8000}).issues.filter(x=>x.lv==='error'));

// --- 14. 基点坐标 → 轮廓 ---
const bpText = 'A: (-50.00, -53.02)\nB: (-38.65, -27.52)\nC（-12.57，-32.66）\n-22.90, -35.53';
const bp = M.dwgParsePoints(bpText);
ok('四种写法都解析出来', bp.length === 4, bp);
ok('点名称与坐标正确',
   bp[0].name === 'A' && near(bp[0].x, -50, 1e-9) && near(bp[0].y, -53.02, 1e-9), bp[0]);
ok('中文括号也认', bp.length > 2 && near(bp[2].x, -12.57, 1e-9), bp[2]);
ok('无名称的行也能收', bp.length === 4 && near(bp[3].y, -35.53, 1e-9), bp[3]);
ok('空行与乱写不产生点', M.dwgParsePoints('\n\nabc\n1,2\n').length === 1);

// 两点 + 半径 → 圆弧
const arc1 = M.dwgArcFrom2Pts(0, 0, 20, 0, 15, 1);
ok('给定 R 生成圆弧', !!arc1 && arc1.type === 'arc', arc1);
ok('圆心到两端点都是 R',
   arc1 && near(Math.hypot(0-arc1.cx, 0-arc1.cy), 15, 1e-6)
        && near(Math.hypot(20-arc1.cx, 0-arc1.cy), 15, 1e-6), arc1);
ok('R 小于半弦长时返回 null', M.dwgArcFrom2Pts(0, 0, 20, 0, 5, 1) === null);

// 4 个基点 → 4 段直线（默认）
const square = [{x:0,y:0},{x:50,y:0},{x:50,y:40},{x:0,y:40}];
const linePrims = M.dwgPointsToPrims(square, null);
ok('默认全用直线', linePrims.length === 4 && linePrims.every(p=>p.type === 'line'), linePrims.map(p=>p.type));
const svgBox = M.dwgPrimsToSvg(linePrims);
ok('基点围成 50×40 闭合轮廓', svgBox.closed && near(svgBox.size.w, 50, 1e-6) && near(svgBox.size.h, 40, 1e-6), svgBox.size);

// 指定某段为圆弧
const rawLine = {type:'line', x1:0, y1:0, x2:10, y2:0};
ok('原始格式原样返回', M.dwgPrimToRaw(rawLine) === rawLine);
ok('归一化格式转回原始', (M.dwgPrimToRaw({kind:'arc', cx:1, cy:2, r:3, a0:10, sw:20}) || {}).type === 'arc');

const arcPrims = M.dwgPointsToPrims(square, [{kind:'arc', r:40, side:1}, {kind:'line'}, {kind:'line'}, {kind:'line'}]);
ok('指定段变成圆弧', arcPrims[0].type === 'arc', arcPrims.map(p=>p.type));
ok('混合图元仍闭合', M.dwgPrimsToSvg(arcPrims).closed === true);

// 生成结果仍要能过 43 条校验
const ps6 = M.dwgPrimsToSvg(RECT4);
const ir6 = M.parseSvgIR(ps6.svg).ir;
const nc6 = M.irToNC(ir6, {mat:'45钢', toolD:10, depth:3, ap:1, safeZ:10});
ok('图元链生成的程序 0 错误',
   M.lintProgram(nc6.code, {pitch:1.5, nmax:8000}).issues.filter(x=>x.lv === 'error').length === 0);

fs.unlinkSync(modPath);
console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
