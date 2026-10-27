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
     + ' tokenize, gname, mname, describeAddr, explainMacro, TEMPLATES, SNIPPETS, snippetInsert, headerBlock, BATCH_DEMO_REF, BATCH_DEMO_WORKS, pathLabelPoints, coordText, fmtDur, aiPickModels, AI_MODEL_PREF, AI_MODEL_SKIP, aiFoldTail, aiNormalize,'
     + ' buildPath, arcCenterByR, arcSweep, segPoints, compRuns, splitBySep, maxDeviation,'
     + ' issuesHtml, RULE_DOC, niceStep, fmtTime, distToSeg, measuredDims, contourBBox, makeTrain, MUTATIONS,'
     + ' parseSvgIR, irToNC, dwgCheck, dwgExtractJson, dwgArea, dwgPathPolys, checkUpdate,'
     + ' dwgBBox, dwgPrimsToSvg, dwgNormPrim, dwgPrimPt, dwgPrimLen, dwgSelfIntersect, dwgDimsCheck,'
     + ' dwgStartMid, LEAD_ANG, dwgTopIdx, dwgRotate, dwgDedupe,'
     + ' dwgFitCircle, dwgFitArcs, dwgParsePoints, dwgArcFrom2Pts, dwgPointsToPrims, dwgPrimToRaw, dwgOpenIR,'
     + ' toolNorm, toolListNorm, toolRadius, toolDNo, toolSummary, toolFindByD, toolCsv, toolAt, toolSeed, TOOL_SEED,'
     + ' renderToolLib, renderToolPicks, TOOL_MAX, DWG_DEMO_SVG, AI_DEMOS, aiDemoFill};');
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
ok('外轮廓从最高边中点切入（Y=50）', new RegExp('G41 D01 X[\\d.]+ Y50').test(DCODE1), DCODE1.split('\n').filter(l=>/G41/.test(l)));

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
  {type:'line', x1:0, y1:0, x2:40, y2:0},
  {type:'line', x1:40, y1:0, x2:80, y2:0},
  {type:'line', x1:80, y1:0.3, x2:80, y2:40},
  {type:'line', x1:80, y1:40, x2:40, y2:40},
  {type:'line', x1:40, y1:40, x2:0, y2:40},
  {type:'line', x1:0, y1:40, x2:0, y2:0.3}
];
const psW = M.dwgPrimsToSvg(WELDED);
ok('断口不补线：0.3mm 也判为开口', psW.closed === false && psW.open === true && psW.gaps.length === 1,
   {closed:psW.closed, open:psW.open, gaps:psW.gaps});
ok('断口处另起子路径', (psW.svg.match(/M/g) || []).length === 2, psW.svg.slice(0, 160));
ok('断口后切成 2 段', psW.fragments.length === 2, psW.fragments.map(f=>f.length));
ok('断口位置被记录（用于刀轨标红）', psW.gapMarks.length === 1 && near(psW.gapMarks[0].x, 80, 1e-6) && near(psW.gapMarks[0].d, 0.3, 1e-3), psW.gapMarks);
ok('断口 → IR 全是开放轮廓',
   M.dwgOpenIR(psW).contours.length === 2 && M.dwgOpenIR(psW).contours.every(c=>c.open === true));

// 开放段生成程序：不补闭合线，注释标 OPEN，G40 沿末段延长
const irOpen = {contours:[{role:'outer', open:true, pts:[[0,0],[50,0],[50,40]]}], holes:[], size:{w:50,h:40}};
const ncOpen = M.irToNC(irOpen, {mat:'45钢', toolD:10, depth:1, ap:1, safeZ:10});
ok('开放段注释标 OPEN', /CONTOUR 1 OUTER OPEN/.test(ncOpen.code), ncOpen.code.split('\n').filter(l=>/CONTOUR/.test(l)));
ok('开放段不回到起点', !/G01 X0 Y0/.test(ncOpen.code), ncOpen.code.split('\n').filter(l=>/G01 /.test(l)));
ok('开放段每段都抬到安全高度', /G00 Z10/.test(ncOpen.code));

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

// 方向判定必须以拟合圆心为参照（v1.13.1 修）。用相对原点的叉积时，
// 开折线隐含一条闭合弦，符号随弧的位置变，右下→左上的 90° 顺弧会被判成逆时针，
// 生成 G03 扫 270°，预览里画成一整个圆——图纸演示案例当初就是这么露馅的。
const quarterArc = (cx, cy, r, a0, a1, n)=>{
  const out = [];
  for(let i=0;i<=n;i++){ const a = a0 + (a1-a0)*i/n; out.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]); }
  return out;
};
const Q_CW = M.dwgFitArcs(quarterArc(50, 50, 10, -Math.PI/2, -Math.PI, 18), 0.02);
ok('顺弧方向不被圆心位置带偏', Q_CW.length === 1 && Q_CW[0].kind === 'arc' && Q_CW[0].ccw === false,
   Q_CW.map(s=>s.kind + ':' + s.ccw));
const Q_CCW = M.dwgFitArcs(quarterArc(50, 50, 10, 0, Math.PI/2, 18), 0.02);
ok('逆弧方向不被圆心位置带偏', Q_CCW.length === 1 && Q_CCW[0].ccw === true, Q_CCW.map(s=>s.kind + ':' + s.ccw));
const Q_FAR = M.dwgFitArcs(quarterArc(200, 150, 20, Math.PI/2, 0, 20), 0.02);
ok('远原点顺弧仍判为顺时针', Q_FAR.length === 1 && Q_FAR[0].ccw === false, Q_FAR.map(s=>s.kind + ':' + s.ccw));

// 闭合轮廓：拟合必须补到首点，否则最后一段圆弧在闭合处被截断（多出一小段 G01 补线）。
// 用演示图纸（100×80 圆角板，首尾隐式闭合，和真实上传的 SVG 一样）当样本。
const BOX_PTS = M.parseSvgIR(M.DWG_DEMO_SVG).ir.contours[0].pts;
const segBox = M.dwgFitArcs(BOX_PTS, 0.02, 5, true);
const segBoxN = M.dwgFitArcs(BOX_PTS, 0.02, 5, false);
ok('闭合拟合弧/线总数正确（4 弧 + 4 线）',
   segBox.filter(s=>s.kind === 'arc').length === 4 && segBox.filter(s=>s.kind === 'line').length === 4,
   segBox.map(s=>s.kind));
ok('闭合拟合末段回到首点', near(segBox[segBox.length-1].x2, BOX_PTS[0][0], 1e-6)
   && near(segBox[segBox.length-1].y2, BOX_PTS[0][1], 1e-6), segBox[segBox.length-1]);
ok('不声明闭合时末段会截断（差异确认）',
   !(near(segBoxN[segBoxN.length-1].x2, BOX_PTS[0][0], 1e-6)
     && near(segBoxN[segBoxN.length-1].y2, BOX_PTS[0][1], 1e-6)), segBoxN[segBoxN.length-1]);
ok('闭合后所有圆弧同向（4 个角都是 G02）',
   segBox.filter(s=>s.kind === 'arc').every(s=>s.ccw === false),
   segBox.filter(s=>s.kind === 'arc').map(s=>s.ccw));

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

// ===== 12. 刀具库 =====
console.log('\n--- 12. 刀具库 ---');

// 面板与联动入口确实存在（防止后续重构把面板摘掉）
ok('刀具库面板已注册', html.indexOf('id="panel-tools"') > 0 && html.indexOf('data-p="tools"') > 0);
ok('三处选用刀具下拉都在',
   html.indexOf('id="c-toolpick"') > 0 && html.indexOf('id="p-toolpick"') > 0 && html.indexOf('id="dw-toolpick"') > 0);
ok('刀具库有独立存储键', html.indexOf("tools:'fanucW.tools'") > 0);

// toolNorm：规范化与兜底
const tn1 = M.toolNorm({t:'1', d:10, z:4});
ok('T 号补零 / 半径缺省为 D/2',
   tn1.t === '01' && tn1.r === 5 && tn1.d === 10 && tn1.z === 4, tn1);
ok('名称缺省按直径生成', tn1.name === 'Φ10 铣刀', tn1.name);
const tn2 = M.toolNorm({t:'T07', d:5});
ok('T 号带字母也认', tn2.t === '07' && tn2.z === 2 && tn2.r === 2.5, tn2);
ok('T 号越界回落 01', M.toolNorm({t:150, d:5}).t === '01');
ok('直径非法返回 null',
   M.toolNorm({t:'01', d:0}) === null && M.toolNorm({t:'01', d:-3}) === null
   && M.toolNorm({t:'01', d:'abc'}) === null && M.toolNorm(null) === null);
ok('直径 >200 视为填错', M.toolNorm({t:'01', d:250}) === null);
ok('补偿半径大于刀半径时回落 D/2', M.toolNorm({t:'01', d:10, r:12}).r === 5);
ok('刃数下限 2 / 上限 12',
   M.toolNorm({t:'01', d:10, z:0}).z === 2 && M.toolNorm({t:'01', d:10, z:40}).z === 12);

// toolListNorm：去重 / 掉非法 / 上限
const ln1 = M.toolListNorm([{t:'01', d:10}, {t:'1', d:12}]);
ok('同 T 号后者覆盖前者', ln1.length === 1 && ln1[0].d === 12, ln1);
const ln2 = M.toolListNorm([{t:'01', d:0}, {t:'02', d:8}, 'x', null]);
ok('非法项被剔除', ln2.length === 1 && ln2[0].t === '02', ln2);
const many = Array.from({length:25}, (_, i)=>({t:i+1, d:5 + i}));
ok('刀具库上限 ' + M.TOOL_MAX + ' 把', M.toolListNorm(many).length === M.TOOL_MAX);

// 派生值
ok('半径 / D 号 / 摘要',
   M.toolRadius({t:'03', d:6}) === 3 && M.toolDNo({t:'03', d:6}) === 'D03'
   && M.toolSummary({t:'03', d:6, z:3}) === 'T03 Φ6 3刃 补偿R3',
   M.toolSummary({t:'03', d:6, z:3}));
ok('非法刀具半径按 0 处理', M.toolRadius(null) === 0 && M.toolRadius({t:'01', d:-1}) === 0);

// 按直径找刀：0.05mm 内算同一把，超出不硬凑
const seed = M.TOOL_SEED;
ok('直径命中 T01', (M.toolFindByD(seed, 10) || {}).t === '01');
ok('差 0.03 仍算同一把', (M.toolFindByD(seed, 9.97) || {}).t === '01');
ok('差 0.1 不硬凑', M.toolFindByD(seed, 9.9) === null);
ok('自定义容差生效', (M.toolFindByD(seed, 9.9, 0.15) || {}).t === '01');

// CSV 导出
const csv = M.toolCsv(seed).split('\n');
ok('CSV 表头与行数', csv[0] === 'T号,名称,直径,刃数,补偿半径(D值)' && csv.length === seed.length + 1, csv.length);
ok('CSV 名称带引号封装', csv[1].indexOf('"Φ10 立铣刀"') > 0, csv[1]);
ok('CSV 引号转义', M.toolCsv([{t:'01', d:10, name:'带"引号"的刀'}]).split('\n')[1].indexOf('""') > 0);

// SVG 上传分支必须把解析结果写回 DWG（v1.9.0 曾漏写，导致「生成程序」永远不可用）
const svgBranch = js.slice(js.indexOf('if(isSvg){'), js.indexOf('} else {', js.indexOf('if(isSvg){')));
ok('SVG 分支写回 DWG.ir', /DWG\.ir\s*=\s*r\.ir/.test(svgBranch));
ok('SVG 分支写回 DWG.baseIR', /DWG\.baseIR\s*=\s*JSON\.parse/.test(svgBranch));

// 下拉取值：空串必须是"手填"，不能误取第 0 把
ok('空选择不取刀', M.toolAt('') === null && M.toolAt(null) === null);
ok('下标越界返回 null', M.toolAt('99') === null);
M.renderToolLib();
const opts = store['c-toolpick'].innerHTML;
ok('三个下拉都按刀具库渲染',
   (opts.match(/<option/g) || []).length === M.TOOL_SEED.length + 1
   && store['p-toolpick'].innerHTML.indexOf('T01') > 0
   && store['dw-toolpick'].innerHTML.indexOf('T01') > 0, opts);

// --- 15. AI 模块演示案例 ---
ok('演示图纸是合法 SVG', /<svg\b[^>]*>/.test(M.DWG_DEMO_SVG));
const DEMO_IR = M.parseSvgIR(M.DWG_DEMO_SVG);
ok('演示图纸解析成功', DEMO_IR.ok, DEMO_IR.error);
ok('演示图纸 = 1 条外轮廓 + 2 个孔',
   DEMO_IR.ok && DEMO_IR.ir.contours.length === 1 && DEMO_IR.ir.holes.length === 2,
   DEMO_IR.ok ? {c: DEMO_IR.ir.contours.length, h: DEMO_IR.ir.holes.length} : DEMO_IR.error);
ok('演示图纸尺寸 100×80',
   DEMO_IR.ok && Math.abs(DEMO_IR.ir.size.w - 100) < 0.1 && Math.abs(DEMO_IR.ir.size.h - 80) < 0.1,
   DEMO_IR.ok ? DEMO_IR.ir.size : null);
ok('演示图纸孔径 φ10', DEMO_IR.ok && DEMO_IR.ir.holes.every(h => Math.abs(h.d - 10) < 0.05), DEMO_IR.ok ? DEMO_IR.ir.holes : null);

// 演示图纸生成的程序必须 0 错误（与上传图纸同一套 irToNC + lintProgram）
if(DEMO_IR.ok){
  const DGDEMO = M.irToNC(DEMO_IR.ir, DOPT);
  const DLRDEMO = M.lintProgram(DGDEMO.code, {pitch:1.5, nmax:8000});
  ok('演示图纸生成程序 0 错误', DLRDEMO.issues.filter(x=>x.lv === 'error').length === 0,
     DLRDEMO.issues.filter(x=>x.lv==='error'));
  ok('演示图纸程序带刀补与孔循环', /G41 D01/.test(DGDEMO.code) && /G81/.test(DGDEMO.code));

  // 案例与轨迹必须对得上：100×80 连接板四角 R10，每层就是 4 段 90° 顺弧，方向全部一致
  const DEMO_ARCS = DGDEMO.code.split('\n').filter(l=>/^G0[23] /.test(l));
  ok('每层 4 段圆弧、共 12 段', DEMO_ARCS.length === 12, DEMO_ARCS.length);
  ok('四角圆弧全为 G02（顺铣外轮廓）', DEMO_ARCS.every(l=>/^G02 /.test(l)),
     DEMO_ARCS.filter(l=>!/^G02 /.test(l)));
  ok('四角圆弧半径均为 R10', DEMO_ARCS.every(l=>{
    const m = /I(-?[\d.]+) J(-?[\d.]+)/.exec(l);
    return m && Math.abs(Math.hypot(+m[1], +m[2]) - 10) < 0.02;
  }), DEMO_ARCS[0]);
  ok('闭合处圆弧未被截断（不再出现 8.05 补线）', !/X8\.05/.test(DGDEMO.code),
     DGDEMO.code.split('\n').filter(l=>/X8\.05/.test(l)));
  ok('轮廓闭合后无零长度 G01', !/G01 X10 Y80\s*\nG40/.test(DGDEMO.code));
}

// --- 位图链路：图元 → SVG 的圆弧 sweep 标志 ---
// 写反会把每个圆角镜像成凹角（凸 R10 变成向内挖 3mm 的缺口），模型按顺时针/逆时针报都出过
const BITMAP_PRIMS = [
  {type:'line', x1:10, y1:0, x2:90, y2:0},
  {type:'arc', cx:90, cy:10, r:10, a0:270, a1:360},
  {type:'line', x1:100, y1:10, x2:100, y2:70},
  {type:'arc', cx:90, cy:70, r:10, a0:0, a1:90},
  {type:'line', x1:90, y1:80, x2:10, y2:80},
  {type:'arc', cx:10, cy:70, r:10, a0:90, a1:180},
  {type:'line', x1:0, y1:70, x2:0, y2:10},
  {type:'arc', cx:10, cy:10, r:10, a0:180, a1:270},
  {type:'circle', cx:25, cy:40, r:5, role:'hole'},
  {type:'circle', cx:75, cy:40, r:5, role:'hole'}
];
const BITMAP_PRIMS_CW = BITMAP_PRIMS.map(p=> p.type === 'arc'
  ? Object.assign({}, p, {a0:p.a1, a1:p.a0}) : p);
[['逆时针', BITMAP_PRIMS], ['顺时针', BITMAP_PRIMS_CW]].forEach(pair=>{
  const tag = pair[0], prims = pair[1];
  const irB = M.parseSvgIR(M.dwgPrimsToSvg(prims).svg).ir;
  const arcsB = M.dwgFitArcs(irB.contours[0].pts, 0.02, 5, true).filter(s=>s.kind === 'arc');
  const centers = arcsB.map(a=>[Math.round(a.cx), Math.round(a.cy)]);
  ok('位图图元（' + tag + '）四角还原成凸圆角（圆心在内侧，不是镜像凹角）',
     JSON.stringify(centers) === JSON.stringify([[90,10],[90,70],[10,70],[10,10]]), centers);
});
const IR_BMP = M.parseSvgIR(M.dwgPrimsToSvg(BITMAP_PRIMS).svg).ir;
const NC_BMP = M.irToNC(IR_BMP, DOPT).code;
const ARCS_BMP = NC_BMP.split('\n').filter(l=>/^G0[23] /.test(l));
ok('位图链路四角圆弧全为 G02（与 SVG 链路同一结果）',
   ARCS_BMP.length === 12 && ARCS_BMP.every(l=>/^G02 /.test(l)), ARCS_BMP.filter(l=>!/^G02 /.test(l)));
ok('位图链路孔位孔径与图元一致',
   IR_BMP.holes.length === 2 && IR_BMP.holes.every(h=>Math.abs(h.d - 10) < 0.05)
   && near(IR_BMP.holes[0].x, 25, 0.05) && near(IR_BMP.holes[1].x, 75, 0.05),
   IR_BMP.holes);

// --- 斜向引刀（不再从正上方垂直切入）---
ok('起刀点取最长边中点（长度并列时取靠上的那条）',
   JSON.stringify(M.dwgStartMid([[0,0],[50,0],[50,20],[0,20]])[0]) === '[25,20]',
   M.dwgStartMid([[0,0],[50,0],[50,20],[0,20]])[0]);
if(DEMO_IR.ok){
  const L = M.irToNC(DEMO_IR.ir, DOPT).code.split('\n');
  const iG = L.findIndex(l=>/^G41 D01 /.test(l));
  const g = /^G41 D01 X(-?[\d.]+) Y(-?[\d.]+)/.exec(L[iG]);
  let lead = null;
  for(let i=iG;i>=0;i--){ const mm = /^G00 X(-?[\d.]+) Y(-?[\d.]+)/.exec(L[i]); if(mm){ lead = mm; break; } }
  ok('起刀落在顶边中点 (50,80)', g && near(+g[1], 50, 1e-6) && near(+g[2], 80, 1e-6), g && [g[1], g[2]]);
  ok('引刀点在零件外上方（不在轮廓线上）', lead && +lead[2] > 80 + 5, lead && [lead[1], lead[2]]);
  const ang = lead ? Math.abs(Math.atan2(Math.abs(+g[2] - +lead[2]), Math.abs(+g[1] - +lead[1])) * 180/Math.PI) : 0;
  ok('引刀角 ≈25°（斜向切入，不是垂直扎下去）', Math.abs(ang - 25) < 2, ang);
  ok('引刀点到起刀点的距离 = 刀半径 + 余量',
     lead && near(Math.hypot(+g[1] - +lead[1], +g[2] - +lead[2]), 7/Math.sin(M.LEAD_ANG), 0.02),
     lead && Math.hypot(+g[1] - +lead[1], +g[2] - +lead[2]));
  ok('G40 退刀回同一引刀点', lead && L.some(l=> new RegExp('^G40 X' + lead[1] + ' Y' + lead[2] + '$').test(l)));
}

// 文字演示案例：填表后各字段值正确
const AITYPE = document.getElementById('ai-type');
M.aiDemoFill(0);
ok('演示案例 1 填入平面铣削参数',
   AITYPE.value === '平面铣削' && document.getElementById('ai-material').value === '45钢'
   && document.getElementById('ai-d').value === 10
   && document.getElementById('ai-req').value === M.AI_DEMOS[0].req,
   {t:AITYPE.value, d:document.getElementById('ai-d').value});
M.aiDemoFill(1);
ok('演示案例 2 填入孔加工参数',
   AITYPE.value === '孔加工' && document.getElementById('ai-material').value === '铝合金'
   && document.getElementById('ai-d').value === 8
   && document.getElementById('ai-req').value === M.AI_DEMOS[1].req,
   {t:AITYPE.value, d:document.getElementById('ai-d').value});
ok('演示案例引用的加工类型/材料都存在于下拉选项', M.AI_DEMOS.every(d =>
   html.indexOf('value="' + d.type + '"') > 0 && html.indexOf('value="' + d.material + '"') > 0));

// 源码契约：演示按钮必须走与上传相同的入口
ok('图纸演示按钮绑定 dwgDemo', /btn-dwg-demo[\s\S]{0,40}onclick\s*=\s*dwgDemo/.test(js)
   || /dwgDemo/.test(js.slice(js.indexOf("btn-dwg-demo") - 200, js.indexOf("btn-dwg-demo") + 200)));
ok('dwgDemo 构造 File 后调 dwgHandleFile', /new File\(\[new Blob\(\[DWG_DEMO_SVG\]/.test(js)
   && /dwgHandleFile\(f\)/.test(js.slice(js.indexOf('function dwgDemo'), js.indexOf('function dwgDemo') + 400)));
ok('文字演示按钮绑定 aiDemoFill',
   /btn-ai-demo1'\)\.onclick\s*=\s*\(\)\s*=>\s*aiDemoFill\(0\)/.test(js)
   && /btn-ai-demo2'\)\.onclick\s*=\s*\(\)\s*=>\s*aiDemoFill\(1\)/.test(js));

// 位图演示：下载一张现画的 PNG，再由用户拖回上传区
ok('面板有 PNG 演示按钮', /id="btn-dwg-demo-png"/.test(html));
ok('PNG 演示按钮绑定 dwgDemoPng',
   /getElementById\('btn-dwg-demo-png'\)/.test(js) && /\.onclick\s*=\s*dwgDemoPng/.test(js));
ok('dwgDemoPng 导出 image/png 且文件名带 .png',
   /toBlob\([\s\S]{0,600}?'image\/png'\)/.test(js) && /a\.download\s*=\s*'[^']*\.png'/.test(js));
ok('上传区 accept 含 image/png（下载的图能直接选回来）',
   /id="dwg-file"[^>]*accept="[^"]*image\/png/.test(html));

// --- 16. 模板库三个工艺样例 ---
// 不只是"能跑通"：样例要能直接送进刀轨演示，刀心轨迹必须不过切
const TPL = {};
M.TEMPLATES.forEach(t=>{ TPL[t.t] = t; });
['平面铣削样例', '外轮廓加工样例', '内轮廓加工样例'].forEach(name=>{
  ok('模板库有「' + name + '」', !!TPL[name], Object.keys(TPL));
});
ok('三个样例都打了「样例」标记',
   ['平面铣削样例','外轮廓加工样例','内轮廓加工样例'].every(n=>TPL[n] && TPL[n].tag === '样例'));
ok('样例渲染时输出 sample 标签', /t\.tag \? `<span class="tag sample">/.test(js));

// 平面铣削：行切
const TPL_FACE = TPL['平面铣削样例'] ? TPL['平面铣削样例'].code : '';
ok('平面铣削样例 6 行往复行切', (TPL_FACE.match(/G01 X(135|-15) F240/g) || []).length === 6,
   (TPL_FACE.match(/G01 X(135|-15) F240/g) || []).length);
ok('平面铣削样例行距 16（0.8D）', /Y-6;/.test(TPL_FACE) && /Y10;/.test(TPL_FACE)
   && /Y26;/.test(TPL_FACE) && /Y42;/.test(TPL_FACE) && /Y58;/.test(TPL_FACE) && /Y72;/.test(TPL_FACE));
// 6 行里有 5 次行间抬刀（最后一行直接抬到 Z50）
ok('平面铣削行间抬刀后再横移（不划伤已加工面）',
   (TPL_FACE.match(/G00 Z2;/g) || []).length === 5, (TPL_FACE.match(/G00 Z2;/g) || []).length);
ok('平面铣削两端各切出毛坯 15mm', /X-15/.test(TPL_FACE) && /X135/.test(TPL_FACE));
const TPL_FACE_PATH = M.buildPath(TPL_FACE, {toolR:10});
ok('平面铣削刀轨覆盖毛坯全宽 0~80',
   TPL_FACE_PATH.bboxCut && TPL_FACE_PATH.bboxCut.minY <= -6 + 1e-6 && TPL_FACE_PATH.bboxCut.maxY >= 72,
   TPL_FACE_PATH.bboxCut);
ok('平面铣削不用刀补（面铣直接走刀心）', !/G4[12]/.test(TPL_FACE));

// 外轮廓：顺时针 + G41，切线引入
const TPL_OUT = TPL['外轮廓加工样例'] ? TPL['外轮廓加工样例'].code : '';
ok('外轮廓样例顺时针走刀配 G41', /G41 D01 X0 Y0/.test(TPL_OUT)
   && /G01 Y80;/.test(TPL_OUT) && /X100;/.test(TPL_OUT) && /Y0;/.test(TPL_OUT) && /X0;/.test(TPL_OUT));
ok('外轮廓沿同一条线引入与退出（无斜插尖刺）',
   /G00 X0 Y-18;/.test(TPL_OUT) && /G40 X0 Y-18;/.test(TPL_OUT));
const TPL_OUT_COMP = M.compRuns(M.buildPath(TPL_OUT, {toolR:6}), 6);
ok('外轮廓刀补产生 1 组偏置', TPL_OUT_COMP.length === 1, TPL_OUT_COMP.length);
ok('外轮廓刀心全在工件外侧（不切入 100×80 内部）',
   TPL_OUT_COMP.length === 1 && TPL_OUT_COMP[0].pts.every(p=> !(p[0] > 0.01 && p[0] < 99.99 && p[1] > 0.01 && p[1] < 79.99)),
   TPL_OUT_COMP.length ? TPL_OUT_COMP[0].pts.filter(p=>p[0]>0.01&&p[0]<99.99&&p[1]>0.01&&p[1]<79.99).slice(0,3) : null);
ok('外轮廓刀心包住工件（X -6..106、顶边 86）',
   TPL_OUT_COMP.length === 1 && (()=>{
     const xs = TPL_OUT_COMP[0].pts.map(p=>p[0]), ys = TPL_OUT_COMP[0].pts.map(p=>p[1]);
     return Math.abs(Math.min(...xs)+6) < 0.01 && Math.abs(Math.max(...xs)-106) < 0.01
         && Math.abs(Math.max(...ys)-86) < 0.01 && Math.min(...ys) <= -6 + 1e-6;
   })(), TPL_OUT_COMP.length ? TPL_OUT_COMP[0].pts.map(p=>p.map(v=>+v.toFixed(2))) : null);

// 内轮廓：逆时针 + G41，圆弧切入
const TPL_IN = TPL['内轮廓加工样例'] ? TPL['内轮廓加工样例'].code : '';
ok('内轮廓样例逆时针走刀配 G41', /G41 D01 X38 Y32/.test(TPL_IN)
   && /G01 X80;/.test(TPL_IN) && /G01 Y60;/.test(TPL_IN) && /G01 X20;/.test(TPL_IN) && /G01 Y20;/.test(TPL_IN));
ok('内轮廓用圆弧切入（避免角点直插留下的过切）', /G03 X50 Y20 I12 J0;/.test(TPL_IN));
ok('内轮廓退刀回腔中心再取消刀补', /G40 X50 Y40;/.test(TPL_IN));
const TPL_IN_COMP = M.compRuns(M.buildPath(TPL_IN, {toolR:6}), 6);
ok('内轮廓刀补产生 1 组偏置', TPL_IN_COMP.length === 1, TPL_IN_COMP.length);
// 型腔 60×40（X20~80 / Y20~60），φ12 → 刀心必须留在偏置轨迹 26~74 / 26~54 内
ok('内轮廓刀心全在偏置轨迹内（不啃腔壁）',
   TPL_IN_COMP.length === 1 && TPL_IN_COMP[0].pts.every(p=> p[0] >= 26-0.01 && p[0] <= 74+0.01 && p[1] >= 26-0.01 && p[1] <= 54+0.01),
   TPL_IN_COMP.length ? TPL_IN_COMP[0].pts.filter(p=>p[0]<26-0.01||p[0]>74+0.01||p[1]<26-0.01||p[1]>54+0.01).slice(0,3) : null);
ok('内轮廓刀心贴满腔壁（26..74 / 26..54）',
   TPL_IN_COMP.length === 1 && (()=>{
     const xs = TPL_IN_COMP[0].pts.map(p=>p[0]), ys = TPL_IN_COMP[0].pts.map(p=>p[1]);
     return Math.abs(Math.min(...xs)-26) < 0.01 && Math.abs(Math.max(...xs)-74) < 0.01
         && Math.abs(Math.min(...ys)-26) < 0.01 && Math.abs(Math.max(...ys)-54) < 0.01;
   })());
ok('内/外轮廓刀补方向相反（外 CW+G41、内 CCW+G41）', (()=>{
  const shoelace = pts => { let a = 0; for(let i=0;i<pts.length;i++){ const q=pts[i], r=pts[(i+1)%pts.length]; a += q[0]*r[1] - r[0]*q[1]; } return a; };
  const outSeq = [[0,0],[0,80],[100,80],[100,0]];
  const inSeq = [[50,20],[80,20],[80,60],[20,60],[20,20]];
  return shoelace(outSeq) < 0 && shoelace(inSeq) > 0 && /G41/.test(TPL_OUT) && /G41/.test(TPL_IN);
})());

// --- 17. 快捷输入按钮组 ---
ok('编辑器上有快捷输入按钮容器', /id="snippet-bar"/.test(html));
ok('快捷输入共 13 项（程序号 + 12 个代码段）', M.SNIPPETS.length === 13, M.SNIPPETS.length);
ok('第一项是程序号', M.SNIPPETS[0].t === '程序号', M.SNIPPETS[0]);
ok('程序号代码是 O__;', M.SNIPPETS[0].code === 'O__;', M.SNIPPETS[0].code);
ok('快捷输入每项都有标题与代码', M.SNIPPETS.every(s=>s.t && s.code), M.SNIPPETS.map(s=>s.t));
ok('快捷输入按钮绑定 snippetInsert', /\.onclick\s*=\s*\(\)\s*=>\s*snippetInsert/.test(js));

// 关键片段内容
const SNIP = {}; M.SNIPPETS.forEach(s=>{ SNIP[s.t] = s.code; });
ok('程序头含标准初始化', /G21 G90 G17 G40 G49 G80/.test(SNIP['程序头'] || ''));
ok('直线是 G01 模态', /^G01 /.test(SNIP['直线'] || ''));
ok('顺圆弧R 用 G02 + R', /^G02 .* R__/.test(SNIP['顺圆弧R'] || ''));
ok('逆圆弧R 用 G03 + R', /^G03 .* R__/.test(SNIP['逆圆弧R'] || ''));
ok('顺圆弧IJK 用 G02 + I/J', /^G02 .* I__ J__/.test(SNIP['顺圆弧IJK'] || ''));
ok('刀补建立是 G41 + D', /^G41 D__/.test(SNIP['刀补建立'] || ''));
ok('刀补取消是 G40', /^G40 /.test(SNIP['刀补取消'] || ''));
ok('长度补偿是 G43 + H + Z50', /^G43 H__ Z50/.test(SNIP['长度补偿'] || ''));
ok('钻孔循环是 G81 + Z- + R2', /^G81 .* Z-__ R2/.test(SNIP['钻孔循环'] || ''));
ok('攻丝是 G84', /^G84 /.test(SNIP['攻丝'] || ''));
ok('子程序调用是 M98 + P + L', /^M98 P__ L__/.test(SNIP['子程序调用'] || ''));
ok('程序结束含 M30', /M30;/.test(SNIP['程序结束'] || ''));

// snippetInsert 行为：光标处插入、自成一行、选中第一个占位符
function mkEd(v, s, e){ return { value:v, selectionStart:s, selectionEnd:e, sa:0, sb:0,
  focus(){}, setSelectionRange(a,b){ this.sa=a; this.sb=b; }, dispatchEvent(){} }; }
let ed1 = mkEd('G21 G90;', 9, 9);
M.snippetInsert(ed1, SNIP['直线']);
ok('光标处插入且自成一行', ed1.value === 'G21 G90;\nG01 X__ Y__ F__;', ed1.value);
ok('选中第一个占位符（__）', ed1.value.slice(ed1.sa, ed1.sb) === '__',
   {sa: ed1.sa, sb: ed1.sb, got: ed1.value.slice(ed1.sa, ed1.sb)});
let ed2 = mkEd('G21 G90;\n', 9, 9);
M.snippetInsert(ed2, SNIP['直线']);
ok('行首插入不再多补换行', ed2.value === 'G21 G90;\nG01 X__ Y__ F__;', ed2.value);
let ed3 = mkEd('', 0, 0);
M.snippetInsert(ed3, SNIP['程序头']);
ok('空编辑器直接插入程序头', /^G21 G90 G17/.test(ed3.value));
let ed4 = mkEd('G01 X10;\nG01 X20;', 8, 8);
M.snippetInsert(ed4, SNIP['程序结束']);
ok('光标后有内容时，插入片段与后文之间补换行',
   ed4.value === 'G01 X10;\nG00 Z50;\nM05;\nM09;\nG91 G28 Z0;\nM30;\nG01 X20;', ed4.value);
ok('多行片段无占位符时光标在片段末尾',
   (()=>{ const e2 = mkEd('O0001;', 6, 6); M.snippetInsert(e2, SNIP['程序结束']);
     return e2.sa === e2.value.indexOf('M30;') + 4 && e2.sa === e2.sb; })());

// 程序号必须在第一行：光标在中间也不能插到中间
const SNO = M.SNIPPETS[0];
let ed5 = mkEd('G01 X10 Y20;', 5, 5);
M.snippetInsert(ed5, SNO.code, SNO);
ok('程序号顶到第一行（不受光标位置影响）', ed5.value === 'O__;\nG01 X10 Y20;', ed5.value);
ok('程序号插入后选中 __', ed5.value.slice(ed5.sa, ed5.sb) === '__',
   {sa: ed5.sa, sb: ed5.sb, got: ed5.value.slice(ed5.sa, ed5.sb)});
let ed6 = mkEd('O0001;\nG21 G90;', 0, 0);
M.snippetInsert(ed6, SNO.code, SNO);
ok('已有程序号时替换而不是重复', ed6.value === 'O__;\nG21 G90;', ed6.value);
let ed7 = mkEd('', 0, 0);
M.snippetInsert(ed7, SNO.code, SNO);
ok('空编辑器插入程序号', ed7.value === 'O__;', ed7.value);
ok('只有程序号按钮是 atStart 语义',
   M.SNIPPETS.filter(s=>s.atStart).length === 1, M.SNIPPETS.filter(s=>s.atStart).map(s=>s.t));

// 插入程序头：第一行先带程序号
ok('空编辑器插入程序头 → 首行 O0001', /^O0001;\nG21 G90 G17/.test(M.headerBlock('')), M.headerBlock(''));
ok('程序头首行程序号后再跟 4 行标准初始化',
   M.headerBlock('').split('\n').length === 5, M.headerBlock('').split('\n'));
ok('首行已有程序号时不再重复加',
   (M.headerBlock('O1234;\nG01 X10;').match(/O\d+;/g) || []).length === 0,
   M.headerBlock('O1234;\nG01 X10;'));
ok('已有 O 号时头部仍是 4 行标准初始化',
   M.headerBlock('O1234;').split('\n').length === 4, M.headerBlock('O1234;').split('\n'));
ok('首行是注释、程序号在第二行时仍会补程序号',
   /^O0001;/.test(M.headerBlock('(示例零件)\nO1234;\nG01 X10;')),
   M.headerBlock('(示例零件)\nO1234;\nG01 X10;'));
ok('插入程序头绑定 headerBlock 并派发 input',
   /btn-insert-header'\)\.onclick[\s\S]{0,400}headerBlock\(v\)/.test(js)
   && /btn-insert-header'\)\.onclick[\s\S]{0,600}dispatchEvent\(new Event\('input'/.test(js));
// 已有程序号时不能把程序头拼在最前面——那样 O 号会被挤到第 5 行，校验器直接报 E01
ok('已有 O 号时程序头插在程序号之后（O 号仍在第 1 行）',
   /if\(\/\^O\\d\+\/i\.test\(first\)\)\{[\s\S]{0,240}lines\.splice\(1,\s*0/.test(js));
ok('headerBlock 对空值不补多余空行（尾部无空行）',
   !/\n$/.test(M.headerBlock('')), JSON.stringify(M.headerBlock('')));

// --- 18. 批量批改演示案例 ---
ok('批量面板有演示按钮', /id="btn-batch-demo"/.test(html));
ok('演示按钮绑定 batchDemo', /btn-batch-demo'\)\.onclick\s*=\s*batchDemo/.test(js));
ok('演示作业 4 份', M.BATCH_DEMO_WORKS.length === 4, M.BATCH_DEMO_WORKS.length);
ok('演示文本按 ==== 能切出 4 份',
   M.splitBySep(M.BATCH_DEMO_WORKS.join('\n====\n')).length === 4);
ok('标准答案本身 0 错误',
   M.lintProgram(M.BATCH_DEMO_REF, {pitch:1.5, nmax:8000}).issues.filter(x=>x.lv==='error').length === 0);

const BOPT = {toolR:6, rapid:20000};
const BREF = M.buildPath(M.BATCH_DEMO_REF, BOPT);
const BW = M.BATCH_DEMO_WORKS.map(t=>{
  const lr = M.lintProgram(t, {pitch:1.5, nmax:8000});
  const pr = M.buildPath(t, BOPT);
  return {txt:t, lr, pr, e:lr.issues.filter(x=>x.lv==='error').length,
          w:lr.issues.filter(x=>x.lv==='warn').length,
          dev:M.maxDeviation(pr, BREF)};
});
ok('① 满分作业 0 错误 0 警告', BW[0].e === 0 && BW[0].w === 0, BW[0].lr.issues);
ok('① 满分作业与标准答案偏差 0', BW[0].dev && BW[0].dev.max < 0.01, BW[0].dev);
ok('② 忘取消刀补 → 检出 E03', BW[1].e === 1 && BW[1].lr.issues.some(x=>x.rule === 'E03'),
   BW[1].lr.issues.map(x=>x.rule));
ok('③ G41 漏 D → 检出 E06', BW[2].e === 1 && BW[2].lr.issues.some(x=>x.rule === 'E06'),
   BW[2].lr.issues.map(x=>x.rule));
// 第 4 份是演示的关键：语法全对，机器查不出错，但刀轨偏 5mm
ok('④ 尺寸抄错作业语法上 0 错误', BW[3].e === 0 && BW[3].w === 0, BW[3].lr.issues);
ok('④ 尺寸抄错作业刀轨偏差 5mm', BW[3].dev && Math.abs(BW[3].dev.max - 5) < 0.05, BW[3].dev);
ok('④ 只有刀轨叠加能发现（校验器 0 问题但偏差 > 4.9）',
   BW[3].e === 0 && BW[3].dev.max > 4.9);
ok('四份作业都带程序号（不误报 E01）',
   BW.every(r=>!r.lr.issues.some(x=>x.rule === 'E01')), BW.map(r=>r.lr.issues.map(x=>x.rule)));
ok('四份作业带学生名字注释（张三/李四/王五/赵六）',
   ['张三','李四','王五','赵六'].every((n,i)=>BW[i].txt.includes(n)),
   BW.map(r=>r.txt.split('\n')[1]));
ok('演示会选中第 4 份（刀轨叠加直接可见）', /batchSel = BATCH_DEMO_WORKS\.length - 1/.test(js));

// --- 19. 刀轨图起终点与坐标标注 ---
ok('刀轨面板有「标坐标」开关', /id="p-showcoord"[^>]*checked/.test(html));
ok('标注逻辑抽成纯函数 pathLabelPoints', /function pathLabelPoints\(segs\)/.test(js));

const LABP = M.buildPath('O1;\nG21 G90;\nG54 G00 X-30 Y-30;\nG01 Z-5 F100;\n'
  + 'G01 X-20 Y-10 F300;\nG01 X-20 Y10;\nG01 X20 Y10;\nG01 X20 Y-10;\nG01 X-20 Y-10;\nG00 Z50;\nM30;', {toolR:0});
const LAB = M.pathLabelPoints(LABP.segs);
ok('切削起点 = 第一条切削段的起点（不是 G00 定位点）',
   LAB.start && Math.abs(LAB.start[0] + 30) < 1e-6 && Math.abs(LAB.start[1] + 30) < 1e-6, LAB.start);
ok('切削终点 = 最后一条切削段的终点',
   LAB.end && Math.abs(LAB.end[0] + 20) < 1e-6 && Math.abs(LAB.end[1] + 10) < 1e-6, LAB.end);
ok('矩形轮廓共 5 个标注点（闭合处不重复标）', LAB.pts.length === 5,
   LAB.pts.map(p=>[p.x, p.y]));
ok('快移段（G00 定位）不参与标注',
   LAB.pts.every(p=>!(Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6)),
   LAB.pts.map(p=>[p.x, p.y]));
ok('同一坐标只标一次（分层铣多层 XY 相同不会叠成一团）',
   (()=>{ const lay = M.buildPath('O2;\nG21 G90;\nG54 G00 X0 Y0;\n'
     + 'G01 Z-2 F200;\nG01 X10 Y0;\nG01 Y10;\nG01 X0;\nG01 Y0;\n'
     + 'G01 Z-4 F200;\nG01 X10 Y0;\nG01 Y10;\nG01 X0;\nG01 Y0;\nM30;', {toolR:0});
     // 两层轮廓的 XY 完全相同 → 去重后仍是 4 个角点
     return M.pathLabelPoints(lay.segs).pts.length === 4; })());
ok('只有快移段时不报错，起点终点取首末段',
   (()=>{ const r = M.pathLabelPoints([{kind:'line', x0:0, y0:0, x1:5, y1:5, rapid:true}]);
     return r.start[0] === 0 && r.end[0] === 5 && r.pts.length === 2; })());
ok('空段返回空标注', (()=>{ const r = M.pathLabelPoints([]);
   return r.start === null && r.end === null && r.pts.length === 0; })());

ok('坐标文字整数不写小数', M.coordText(-20, 10) === 'X-20 Y10', M.coordText(-20, 10));
ok('坐标文字非整数留 2 位', M.coordText(3.25, -1.5) === 'X3.25 Y-1.5', M.coordText(3.25, -1.5));
ok('坐标文字吸附浮点误差（3.0000001 → 3）', M.coordText(3.0000001, 0.004) === 'X3 Y0',
   M.coordText(3.0000001, 0.004));
ok('起点绿点、终点红点有对应画法',
   /drawPathMarker\(ctx, view, lab\.start, '#16a34a', '起点'/.test(js)
   && /drawPathMarker\(ctx, view, lab\.end, '#dc2626', '终点'/.test(js));
// 闭合加工常回到引刀点，起终点同坐标时必须合并，否则两个圆两行字叠在一起
ok('起终点重合时合并为一个标记',
   /const same = Math\.hypot\(lab\.start\[0\]-lab\.end\[0\]/.test(js) && /'起点\/终点'/.test(js));
ok('重合判定用几何距离而非对象引用', /same \? /.test(js) || /if\(same\)\{/.test(js));
ok('标注受「标坐标」开关控制', /coordBox\.checked/.test(js)
   && /if\(\(!coordBox \|\| coordBox\.checked\) && lab\.pts\.length\)/.test(js));

// --- 20. AI 生成时的自动计时 ---
ok('计时格式化：60 秒内按秒', M.fmtDur(0) === '0s' && M.fmtDur(12000) === '12s' && M.fmtDur(59000) === '59s',
   [M.fmtDur(0), M.fmtDur(12000), M.fmtDur(59000)]);
ok('计时格式化：超过 1 分钟用 分:秒 并补零',
   M.fmtDur(65000) === '1:05' && M.fmtDur(600000) === '10:00', [M.fmtDur(65000), M.fmtDur(600000)]);
ok('计时格式化：负数按 0 处理', M.fmtDur(-5000) === '0s', M.fmtDur(-5000));

// 计时器必须成对清理，否则停止后还在跑（会覆盖结果框）
ok('计时器 setInterval 与 clearInterval 成对',
   /const timer = setInterval/.test(js) && /clearInterval\(timer\)/.test(js));
ok('等待首字时把计时写在结果框', /resultEl\.textContent = '正在生成\.\.\. ' \+ fmtDur/.test(js),
   'requires 正在生成... + fmtDur');
ok('开始出字后计时改到状态栏（不污染程序文本）',
   /if\(content\)\{\s*statusEl\.textContent = '生成中 ' \+ fmtDur/.test(js)
   || /生成中 ' \+ fmtDur/.test(js));
ok('等待超过 10 秒给出「还在跑」提示', /s >= 10/.test(js) && /停止生成/.test(js));
ok('生成完成后状态栏显示用时与行数',
   /'用时 ' \+ fmtDur\(Date\.now\(\) - t0\) \+ ' · ' \+ content\.split\('\\n'\)\.length \+ ' 行 · ' \+ usedModel/.test(js));
ok('中止时状态栏显示已用时', /已停止 · 用时/.test(js));

// --- 21. AI 选模型（生成速度）---
// 实测：列表首项 `auto` 是路由模型，首字 >150s；deepseek-v4.1-flash 首字 1.4s、5.5s 出 50 行 0 错误
const MODEL_LIST = [
  { id:'auto' }, { id:'hy3' }, { id:'hy4-preview' }, { id:'glm-5.3' },
  { id:'glm-5.3-flash' }, { id:'minimax-m3' }, { id:'kimi-k2-thinking' },
  { id:'deepseek-v4-flash' }, { id:'deepseek-v4.1-flash' }, { id:'deepseek-v4-pro' },
  { id:'hunyuan-image-alpha' }, { id:'kling-video-v3' }, { id:'step-5-preview' },
  { id:'space-bunny' }, { id:'glm-5v-turbo' }, { id:'minimax-m3.1-flash' },
];
const PICK = M.aiPickModels(MODEL_LIST).map(m=>m.id);
ok('选模型：第一选择是实测最快的 deepseek-v4.1-flash', PICK[0] === 'deepseek-v4.1-flash', PICK.slice(0,4));
ok('选模型：auto（路由模型）排到最后', PICK[PICK.length-1] === 'auto', PICK[PICK.length-1]);
ok('选模型：跳过视频/图像/思考/预览类模型',
   !PICK.some(id=>/video|image|kling|thinking|preview/i.test(id)),
   PICK.filter(id=>/video|image|kling|thinking|preview/i.test(id)));
ok('选模型：flash 类整体排在非 flash 之前',
   (()=>{ const f = PICK.filter(id=>/flash/i.test(id));
     const lastFlash = Math.max(...f.map(id=>PICK.indexOf(id)));
     const firstPlain = Math.min(...PICK.filter(id=>!/flash/i.test(id)).map(id=>PICK.indexOf(id)));
     return f.length >= 3 && lastFlash < firstPlain; })(), PICK);
ok('选模型：候选里至少 3 个可用（够回落重试）', PICK.length >= 3, PICK.length);
ok('选模型：disabled 的模型被排除',
   M.aiPickModels([{id:'deepseek-v4.1-flash', disabled:true}, {id:'deepseek-v4-flash'}]).map(m=>m.id).join() === 'deepseek-v4-flash');
ok('选模型：空列表返回空数组（不抛异常）',
   M.aiPickModels([]).length === 0 && M.aiPickModels(null).length === 0);
ok('选模型：列表里只有 auto 时仍然可用',
   M.aiPickModels([{id:'auto'}]).map(m=>m.id).join() === 'auto');

ok('模型列表进面板就预取（省一次往返）',
   /if\(p === 'ai'\) aiPrimeModels\(\)/.test(js));
ok('生成时优先用预取的缓存，没有再拉',
   /const models = aiModelCache \|\| await aiPrimeModels\(\)/.test(js));
ok('首选模型失败自动换下一个（最多 2 个）',
   /const tries = Math\.min\(2, cands\.length\)/.test(js) && /无响应，换 /.test(js));
ok('用户点停止不会触发换模型重试',
   /e\.name === 'AbortError'\) throw e/.test(js));

// --- 22. M30 之后的说明折叠成注释 ---
const TAIL_TXT = 'O0001;\nG21 G90 G17 G40 G49 G80;\nG54 G00 X0 Y0;\nG01 X10 F200;\nM30\n\n# 参数说明：\n# 转速 S1800 r/min\n# 行距 8 mm';
const FOLD = M.aiFoldTail(TAIL_TXT);
ok('M30 后的 Markdown 说明被折叠', FOLD.folded === 3, FOLD.folded);
ok('折叠后 M30 是最后一行', /\nM30\s*$/.test(FOLD.text), JSON.stringify(FOLD.text.slice(-40)));
ok('折叠后的说明变成括号注释（一行一条）',
   /^\(参数说明：\)$/m.test(FOLD.text) && /^\(转速 S1800 r\/min\)$/m.test(FOLD.text), FOLD.text);
ok('折叠后不再有 # 开头的裸行', !/^#/m.test(FOLD.text), FOLD.text.split('\n').filter(s=>s.startsWith('#')));
ok('折叠结果过校验器 0 警告（W15 消失）',
   M.lintProgram(FOLD.text, {pitch:1.5, nmax:8000}).issues.filter(x=>x.rule==='W15').length === 0,
   M.lintProgram(FOLD.text, {pitch:1.5, nmax:8000}).issues.map(x=>x.rule));
ok('提示文字里的括号被清掉，不会破坏注释语法',
   (()=>{ const r = M.aiFoldTail('O1;\nM30\n# 见 (图1) 说明');
     return !/\(见 \(图1\)/.test(r.text); })());
ok('尾部像程序段（G/M/O 开头）时不折叠',
   M.aiFoldTail('O1;\nM30\nO2;\nG01 X10;').folded === 0);
ok('M30 后没有内容时原样返回', (()=>{ const r = M.aiFoldTail('O1;\nM30'); return r.folded === 0 && r.text === 'O1;\nM30'; })());
ok('没有 M30 的程序原样返回', (()=>{ const r = M.aiFoldTail('G01 X10;'); return r.folded === 0; })());

// M30 常带行尾注释（`M30 (程序结束)`），正则必须容忍，否则整段匹配不到、尾部 end 留在后面报 W15
const M30C = 'O1;\nG21 G90;\nS1200 M03\nG01 X10 F200;\nM30 (程序结束)\nend';
ok('M30 带行尾注释时仍能识别', M.aiFoldTail(M30C).text !== M30C, JSON.stringify(M.aiFoldTail(M30C).text));
ok('M30 后的纸带结束符 end 被删掉', (()=>{ const t = M.aiFoldTail(M30C).text;
  return !/\bend\b/i.test(t) && /M30 \(程序结束\)\s*$/.test(t); })(), M.aiFoldTail(M30C).text);
ok('删掉 end 后不再报 W15',
   M.lintProgram(M.aiFoldTail(M30C).text, {pitch:1.5, nmax:8000}).issues.filter(x=>x.rule==='W15').length === 0,
   M.lintProgram(M.aiFoldTail(M30C).text, {pitch:1.5, nmax:8000}).issues.map(x=>x.rule));
ok('M30 后的 % 纸带符也删掉',
   !/%/.test(M.aiFoldTail('O1;\nM30\n%').text), M.aiFoldTail('O1;\nM30\n%').text);
ok('M30 带注释 + 后面有说明 → 说明折成注释、注释保留',
   (()=>{ const r = M.aiFoldTail('O1;\nG21 G90;\nM30 (结束)\n# 转速 S1200');
     return r.folded === 1 && /\(转速 S1200\)\nM30 \(结束\)\s*$/.test(r.text); })(),
   M.aiFoldTail('O1;\nG21 G90;\nM30 (结束)\n# 转速 S1200').text);

// --- 23. 生成结果规范化（模型输出姿势不稳定，统一收拾）---
ok('没有程序号时补 O0001',
   M.aiNormalize('(说明)\nG21 G90;\nM30').text.startsWith('O0001;'),
   M.aiNormalize('(说明)\nG21 G90;\nM30').text.split('\n')[0]);
ok('程序号被注释挡在后面时提到首行，注释顺延',
   (()=>{ const L = M.aiNormalize('(说明)\nO0002;\nG21 G90;\nM30').text.split('\n');
     return L[0] === 'O0002;' && L[1] === '(说明)'; })(),
   M.aiNormalize('(说明)\nO0002;\nG21 G90;\nM30').text.split('\n').slice(0,2));
ok('剥掉 Markdown 代码围栏',
   (()=>{ const r = M.aiNormalize('```gcode\nO0003;\nG21 G90;\nM30\n```');
     return !/```/.test(r.text) && r.text.startsWith('O0003;') && /M30\s*$/.test(r.text); })(),
   M.aiNormalize('```gcode\nO0003;\nG21 G90;\nM30\n```').text);
ok('结尾重复的 M30 只留一个',
   (()=>{ const r = M.aiNormalize('O1;\nG21 G90;\nM30\nM30\nM30');
     return (r.text.match(/^M30/gm) || []).length === 1; })(),
   M.aiNormalize('O1;\nG21 G90;\nM30\nM30\nM30').text);
ok('规范化后过校验器 0 错误（无 O 号 + 重复 M30）',
   M.lintProgram(M.aiNormalize('(说明)\nG21 G90;\nS1200 M03\nG01 X10 F200;\nM30\nM30').text,
     {pitch:1.5, nmax:8000}).issues.filter(x=>x.lv==='error').length === 0);
ok('规范化内部接上了 M30 后的说明折叠',
   M.aiNormalize('O1;\nG21 G90;\nM30\n# 参数：S1200').folded === 1);
ok('生成结束时调用规范化并回写结果框',
   /const norm = aiNormalize\(content\)/.test(js) && /content = norm\.text; resultEl\.textContent = content/.test(js));
ok('状态栏会提示折叠了多少行说明', /行说明已折成注释/.test(js));

fs.unlinkSync(modPath);
console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
