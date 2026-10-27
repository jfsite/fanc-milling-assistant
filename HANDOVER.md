# 交接说明 HANDOVER

> 给「新工作区 / 新任务」读的。看完这一份 + `docs/history/` 就能接上，不需要翻旧对话。
>
> 最后更新：2026-10-27 19:20　｜　代码版本：v1.14.1（`app.html` 1.40 MB / 1,482,465 字节，11 个面板，316 项断言）　｜　**已发布上线 v1.12.2**（见 §6）　｜　**已托管 GitHub 私有仓库**（标签到 v1.12.2，见 §9.5）

---

## 1. 这是什么

《数控铣削编程与加工（FANUC系统）》配套的教学工具，面向江苏联合职业技术学院惠山中专办学点 522142 / 522143 班。

- **形态**：应用本体是一个 `app.html`（零构建、零依赖，双击即用；AI 与位图识别需联网），外面套一个 1 KB 的 `index.html` 做入口转发（见 §1.5）
- **用途**：教师上课演示、作业批量批改、学生自查与练习
- **自包含**：说明文档与 11 张截图都以 base64 内嵌，拷一个文件到任何电脑都能完整使用

---

## 1.5 目录里为什么有两个 HTML（v1.6.2 起）

| 文件 | 大小 | 会不会变 | 作用 |
|---|---|---|---|
| `index.html` | 1 KB | **永不变** | 入口：把 `?sharecode=…` 原样转给 `app.html` |
| `app.html` | ~1.3 MB | 每次发版都变 | 应用本体 |

原因：平台边缘缓存按**完整 URL** 长期缓存，根路径一旦缓住旧副本，重新发布也刷不掉（实测 `EO-Cache-Status: HIT`、`Age` 上千秒仍在命中，`Cache-Control: no-cache` 也不被遵守）。
把「会变的东西」挪到 `app.html` 后，入口那 1 KB 即使被缓存旧了也无害（它本来就只做转发），链接永远不用换。

**对外分发的固定链接**：`https://fanuc-milling-w.app.workbuddy.host/app.html?sharecode=OTD3JQJQPI`

兜底：应用加载后会比对 `version.json`（30 分钟一次，带 `?ts=` 绕缓存），发现线上版本更高就在右下角弹「线上已更新到 vX · 刷新到新版」，点击用 `?_=<时间戳>` 跳转——即使某个节点的 `app.html` 缓存顽固，用户也能一键自愈。

## 1.6 在新会话里接手时

- **不要整读 `app.html`**：已 1.3 MB，整读一次约 40 万字符，直接吃掉小半上下文。
  用 `grep -n "function xxx"` 定位、再 `sed -n "起,止p"` 局部读。
- 先读本文件 + `.workbuddy/memory/` 最近一天，再动代码；不要翻旧对话。
- 改完必跑 `node tests/run-tests.js`（249 项，0 失败才算完成）。
- **一次会话只做一个主题**；收尾时更新本文件对应小节 + 当天 memory。主题混着做，上下文会比代码更快爆。

## 2. 常用命令

```bash
# 本地预览（改完刷新即可）
python -m http.server 8765 --bind 127.0.0.1

# 回归测试：277 项断言，必须 0 失败才算完成
node tests/run-tests.js

# 改完文档 / 换完截图后，把内容写回 app.html 的帮助面板
node tools/sync-doc.js --embed

# 版本号：查看一致性 / 递增（自动同步 app.html + 使用说明 + HANDOVER + CHANGELOG + 帮助面板）
node tools/version.js
node tools/version.js --bump minor

# 发版：查版本一致性 → 跑回归 → 存快照 → 提交 → 打 tag
node tools/release.js

# 界面改版后重截说明书配图（无头 Edge → 1000 宽 + 128 色，再 sync-doc --embed）
node tools/shoot-panel.js template
```

线上 AI 冒烟（改过 AI 相关代码才需要）：

```bash
node tools/smoke-ai.js "https://fanuc-milling-w.app.workbuddy.host/?sharecode=OTD3JQJQPI"
```

---

## 2.5 版本号：单一数据源 + 自动同步

**唯一能手改的地方**：`app.html` 第 10 行 `const APP_VERSION = "1.5.0";`

页面徽标（`#app-ver`）、标签页标题、导出讲义落款都在运行时从它取；文档侧由脚本写：

| 位置 | 写法 | 谁写 |
|---|---|---|
| `app.html` | `const APP_VERSION = "x.y.z"` | **手改（唯一源）** |
| `docs/使用说明.md` | `> 版本 vx.y.z ｜ …` | `version --bump` |
| `HANDOVER.md` | `代码版本：vx.y.z` | `version --bump` |
| `CHANGELOG.md` | `## [x.y.z] — 日期` | `version --bump`（插入空条目，内容手补） |
| `help-md` 内嵌块 | 同 `docs/使用说明.md` | `version --bump` 自动跑 `sync-doc --embed` |

递增规则：`major` 大改 / `minor` 加功能块（新面板）/ `patch` 修 bug 改文案。

```bash
node tools/version.js                          # 查一致性，不一致退码 1
node tools/version.js --bump patch --note "修复 xx"   # 递增并在 CHANGELOG 记一行
node tools/version.js --set 2.0.0              # 直接指定
```

**版本号漂移会被测试拦住**：`tests/run-tests.js` 第 10 节断言 6 条 —— `APP_VERSION` 格式、CHANGELOG 顶部条目、使用说明、HANDOVER、页面徽标渲染结果、内嵌 help-md 全部一致。改了版本却漏同步某处 → 测试红。

> 坑：`APP_VERSION` 在页头第一个 `<script>` 里，不在 `id="app-js"` 内，测试只抽 app-js，所以 `run-tests.js` 会先把它注入 `global.APP_VERSION` 再 require，否则 `renderVersion()` 报 `not defined`。

---

## 2.6 版本回溯（回滚）

**平台侧没有“版本列表 / 一键回滚”**，发布永远是覆盖同一个应用。所以回滚只有一条路：**把旧版代码重新发布一次**，链接和二维码都不变，线上内容退回那一版。

可回溯的东西有两套，互为备份：

| 资产 | 位置 | 用途 |
|---|---|---|
| git tag | `v1.0.0` … `v1.6.2` | 代码级回溯，`git show <tag>:app.html` 精确取出（v1.6.1 及更早是 `index.html`） |
| 单文件快照 | `releases/v1.5.0.html` 等 | 直接拷给学生 / 拷 U 盘 / 存档，不依赖 git |

```bash
# 看有哪些版本
node tools/release.js --list

# 回滚到 v1.4.0（先备份当前？当前版已由 v1.5.0 快照与 tag 覆盖，不必另存）
git show v1.6.2:app.html > app.html          # v1.6.2 起应用在 app.html
git show v1.4.0:index.html > index.html      # 更早的 tag 仍是 index.html
node tests/run-tests.js          # 确认该版本自身是好的（应为 157 项全过）
# 然后让助手发布一次
```

发版流程（顺序不能颠倒）：

```bash
node tools/version.js --bump minor --note "新增 xxx"   # 1. 定版本
# 2. 写完 CHANGELOG 的条目、跑通测试
node tools/release.js                                  # 3. 快照 + tag
# 4. 让助手发布 → 链接不变
```

`release.js` 有三道闸门：版本号四处不一致 → 停；测试有失败 → 停；**工作区不干净 → 停**（版本快照必须对应一个确定提交，不能把半成品封成版本）。

> 注意：`v1.4.0` / `v1.4.1` / `v1.0.0` 三个快照是从 git 历史导出的，行尾被仓库规范成 LF，比当时实际发布的文件小 ~900 字节，**内容等价**，浏览器无感。`v1.5.0` 起的快照直接拷贝工作区文件，与线上逐字节一致（858,871 字节）。

---

## 3. 现状：11 个面板

| # | 面板 | 职责 | 主要实现 |
|---|---|---|---|
| 1 | G/M 代码速查 | 51 条指令（39 G + 12 M），搜索 + 10 个筛选标签 | `GCODES` `MCODES` `renderTable()` |
| 2 | 程序编辑器 | 6 个模板（模板库）+ 编辑器（插入头尾 / 复制 / 解释） | `TEMPLATES` `HEADER` `TAIL` |
| 3 | 参数计算 | n / F / Q / Pc / Pm，材料联动，超转速折算 | `MATERIALS` `doCalc()` `calcSyncVc()` |
| 4 | 程序解释 | 逐行翻译，地址字按上下文释义，宏语句单列 | `tokenize()` `describeAddr()` `explainMacro()` `runExplain()` |
| 5 | 程序校验 | 43 条规则（21 E / 16 W / 6 I）+ 宏程序试算器 | `lintProgram()` `RULE_DOC` `issuesHtml()` `runMacro()` |
| 6 | 刀轨演示 | 2D 轨迹、分步、刀补偏置、代码双向联动、尺寸核对 | `buildPath()` `drawPath()` `setCur()` `contourBBox()` `checkDims()` |
| 7 | 批量批改 | 多份打分、问题清单、刀轨对比、CSV | `runBatch()` `maxDeviation()` `drawCompare()` `exportCSV()` |
| 8 | 找错练习 | 10 种变异自动注入 + 交卷对答案 | `MUTATIONS` `makeTrain()` `showTrainAnswer()` |
| 9 | 刀具库 | T 号 / 直径 / 刃数 / 补偿半径一处录入，参数计算·刀轨·图纸三处联动 | `toolNorm()` `toolListNorm()` `toolFindByD()` `toolSummary()` `renderToolLib()` |
| 10 | AI 智能编程 | 图纸生成（SVG 解析 / 位图识别 → 轮廓 → 程序，SVG 一键演示 + PNG 示例图纸下载）+ 文字描述生成（两个演示案例填参） | `parseSvgIR()` `irToNC()` `dwgCheck()` `initCloud()` `aiGenerate()` |
| 11 | 帮助 | 内嵌完整说明 + 目录 + 搜索 | `renderHelp()` + `tools/sync-doc.js` |

跨面板能力：大屏模式 `togglePresent()`、本地自动保存 `autosave()` / `restoreAll()`、导出讲义 `exportHandout()`、刀具库统一取刀（`#c-toolpick` / `#p-toolpick` / `#dw-toolpick` 三个下拉）。

---

## 4. 代码结构

`app.html` 里按顺序有三个脚本块，**顺序不能乱**：

```html
<script type="application/json" id="help-img">{...}</script>   <!-- 11 张图的 base64，由 sync-doc 生成 -->
<script type="text/markdown"  id="help-md">...</script>        <!-- 说明正文，由 sync-doc 生成 -->
<script id="app-js"> ... </script>                             <!-- 主脚本 -->
```

主脚本内部分区（从上到下）：

```
数据层        GCODES / MCODES / ALL / TEMPLATES / EXPLAIN
导航与表格    nav 监听 / renderTable
编辑器与模板
参数计算      MATERIALS / doCalc / calcSyncVc
解释          esc / gname / mname / stripComments / tokenize / describeAddr / explainMacro
宏求值        mLex / mEval / fmtv
校验          lintProgram / RULE_DOC / issuesHtml / renderLint
宏试算        runMacro / renderMacro
存储          LSK / lsGet / lsSet / autosave / restoreAll / applyToEditor
刀轨引擎      parseProgramUnits / arcSweep / arcCenterByR / buildPath / segPoints / compRuns
刀轨渲染      fitView / distToSeg / canvasCtx / drawPath / setCur / genPath
批量          splitBySep / sampleCutPoints / maxDeviation / runBatch / renderBatch / exportCSV
讲义          download / exportHandout
大屏          togglePresent
联动与尺寸    renderCodeList / highlightCodeLine / contourBBox / measuredDims / checkDims
找错          MUTATIONS / shuffled / makeTrain / genTrain / showTrainAnswer
帮助          helpInline / helpCols / helpIsBlock / renderHelp
初始化        renderTable(); restoreAll(); renderCodeList();
```

### 加一个新面板的步骤

1. `<nav>` 里加 `<button data-p="xxx">名称</button>`
2. 加 `<section class="panel" id="panel-xxx">`（放在 AI 面板之前）
3. 需要样式就加到 `<style>` 末尾
4. 在 `// ===== 初始化 =====` 之前写逻辑与按钮接线
5. 加测试到 `tests/run-tests.js`，跑通全部断言（当前 277 项）
6. 更新 `docs/使用说明.md` 并 `node tools/sync-doc.js --embed`

---

## 4.5 图纸生成器的固定口径（v1.6.0）

改 `irToNC()` 之前先看这几条，它们是教学口径，不是随手定的：

1. **一律用 G41 + D 号按轮廓编程**，不让本地代码做多边形偏置（偏置遇自交就崩），半径交给刀补。
2. **外轮廓顺时针、内轮廓逆时针**，配合 G41 都是顺铣；输入方向反了会被 `dwgArea` 判向翻转。
3. **外轮廓起刀点取最长边的中点、25° 斜向引刀**：引刀点在零件外上方（法向 R+2、切向再退 R+2 的 1/tan25°），`G41` 就在这条斜线上建立刀补；内轮廓仍沿"最高点 → 形心"方向在槽内下刀。垂直切入会让刀补建立段的终点沿轮廓偏一个刀半径，在切入点多切一个月牙坑。
4. **层数按 ⌈总深/ap⌉ 均分**，各层等深，最后一层不留余量（教学上先说清，再讲精加工）。
5. **注释全用 ASCII**（`(CONTOUR 1 OUTER PASS 2/3 Z-2)`），中文括号在部分 FANUC 系统上会报警。
6. **孔按直径逐个判断**：|孔径−刀具直径| ≤ max(0.3, 8%·D) 才用 G81，否则用当前刀具铣整圆 `G02 I- J0`。
7. **圆孔直径取真实半径**，禁止用离散后的多边形包围盒凑数（内接多边形会小 1~2%，钻头下不去）。
8. 生成的程序必须能过自己的 43 条校验：测试里有 `lintProgram(生成的程序)` 0 错误断言，改生成器后先跑这条。

## 4.6 样式与响应式约定（v1.11.0 起）

样式集中在 `app.html` 的**第一个 `<style>`**，约 470 行，分「设计令牌 → 基础 → 布局 → 卡片 → 表单 → 按钮 → 表格 → 小元件 → 深色代码块 → 画布 → 帮助 → 图纸 → 版本条 → 大屏 → 响应式」十四段。

1. **只用令牌，不散写颜色**：`--brand / --brand-bg / --line / --line2 / --sub / --txt / --danger / --warn / --accent / --mono` 等旧名**必须保留**——HTML 里大量内联样式（`style="...var(--line)"`）和画布图例直接引用它们。
   当前是 **方案 C 靛紫**：`--brand #4f46e5 / --brand-strong #4338ca / --brand-bg #eef0fe / --accent #0f766e / --bg #fafafb / 代码块 #101322`；版心 `948px` 单列。
2. **画布颜色不在 CSS 里**（改色必须五处一起改，否则图例和线条对不上）：
   | 元素 | 值 | 出现位置 |
   |---|---|---|
   | 切削线 / 学生程序 | `#4f46e5` | `drawPath` / `drawCompare` / `dwgDrawPath` / `.legend` 内联 |
   | 刀补偏置 | `#b45309` | `drawPath` 点线 + 图例 |
   | 孔位 / 标准答案 | `#0f766e` | `drawPath` 十字 + 图例 + 对比图 |
   | 当前段 / 当前刀具 | `#db2777` | `drawPath` 粗线 + 刀具圆 + `.code-row.active` |
   | 断口红圈 | `#b42318` | `dwgDrawPath`（**故意与品红分开**，别统一） |
3. **宽表格必须进 `.tbl-scroll`**：容器负责横滑 + 边缘淡阴影（`background-attachment:local` 那套），表再给 `min-width`（手机断点里）。直接把表 `display:block` 会把列压扁（试过，名称输入框只剩 10px）。
4. **grid 子项一律 `minmax(0,1fr)`**：`.help-wrap` / `.path-split` 曾用 `1fr`，帮助面板里的长表格把整页撑宽 2000px。`min-width:auto` 是 grid 的默认值，是坑。
5. **断点只有四个**：1100 / 900 / 720 / 420。720 是"单列手机"，900 是"堆叠平板"。
6. **按钮与输入统一 40px 高**（手机 44px），新增控件跟着走，不要自带 padding。
7. **`.notice` 是全局固定 toast**（顶部居中，2s 消失），页面里只有这一个元素，不要挪进卡片。
8. **标题图标是代码注入的**：`decorateHeadings()` 按 `HICO_RULES` 里的正则给 `.card h2/h3` 插内联 SVG（23 个字形，`stroke` 走 `currentColor`，禁止引图标库/CDN）。新增标题时确认关键词能命中，否则会退回 `dot`；动态插入的卡片由 `MutationObserver`（40ms 防抖）自动补。h2 带浅底方块 28px/圆角 9，h3 无底 16px。
8. **改完样式必须重拍配图**：`node tools/reshoot-docs.js` 一次拍完带数据的 11 张；单张用 `node tools/shoot-panel.js <panel>`。
   `docs/img/gaps-real.png` 是真实识别结果，不重拍。
9. **长图截图前必须 `window.scrollTo(0,0)`**：导航是 `position:sticky`，`captureBeyondViewport` 会把它按当前滚动位置画在长图中间（AI 那张就这样翻过车）。两个截图脚本已内置。

## 5. 必须守住的约定

这些是踩过坑之后定下来的，改动前先看：

1. **文档单一数据源**：`docs/使用说明.md` 是唯一手改的地方，`app.html` 里的 `help-md` / `help-img` 块由 `sync-doc --embed` 生成，**不要手改那两个 script 块**。
2. **刀补偏置是示意，不是仿真**：偏移按段自身法向 + 拐点角平分线；**建立刀补那一段的起点保持编程点**；**G40 段不做偏置**（所以橙线与蓝线角点差一个刀半径是正常的）。界面上必须保留「示意」字样。
3. **包围盒有两种口径**，不要混：
   - 指标卡「包围盒（含进刀）」= `res.bbox`，所有轨迹
   - 尺寸核对用「轮廓闭环」= `contourBBox()`，**自动排除 G01 进刀**；无闭环才回退 `bboxCut`
4. **片段模式**：无 O 号且无 M30 时按指令片段校验（I06），不报头尾结构错误。
5. **子程序抑制**：进入子程序定义后不做 W04「主轴未启动」检查，否则模板会误报。
6. **找错练习的变异必须能被校验器检出**——测试逐条验证，新增变异时在 `tests/run-tests.js` 里补断言。
7. **测试全绿才算完成**：316 项，0 失败。
8. **不引入外部依赖**（AI 模块的 CDN SDK 除外），保持单文件可拷贝。
9. **刀具参数只有一处真相**：直径 / 刃数 / 补偿半径都存在刀具库，参数计算、刀轨、图纸只通过下拉取值，不再各自维护一套默认值。
10. **样式改动只动令牌与断点**：不要在 HTML 里追加新的内联颜色/圆角；确需特例（如截图脚本要用的尺寸）写进 `<style>` 并注释原因。

---

## 6. 发布状态（已解决，2026-10-23）

**已发布上线**，走的是之前判定可行的「路径 B 新工作区」。

| 项 | 值 |
|---|---|
| 工作区 | `D:\WorkBuddy\fanc-milling-app`（新目录，无历史应用登记） |
| 分享链接（对外分发用这个） | `https://fanuc-milling-w.app.workbuddy.host/?sharecode=OTD3JQJQPI&v=1.6.0` |
| 裸链接（会命中旧缓存，别发） | `https://fanuc-milling-w.app.workbuddy.host/?sharecode=OTD3JQJQPI` |
| 应用 ID | `wbapp_5TAJvvE8eVrSjSP13oJroH`（marker 文件 `.wbapp_5TAJvvE8eVrSjSP13oJroH.genie`） |
| 线上内容（v1.12.2） | 1,496,543 字节 = 本地 `app.html` 完全等长，徽标 `v1.12.2`；`version.json` 同为 1.12.2（需带 sharecode 才能取到） |
| 二维码 | `qrcode.png`（492×630）编码 `…/app.html?sharecode=OTD3JQJQPI`，副标题显示「11 个模块 · v1.12.2」，由 `tools/make-qrcode.py` 自动生成 |

**注意：链接必须带 `?sharecode=OTD3JQJQPI`**，且**对外分发要再带 `&v=<版本>`**。原因见下。

### 边缘缓存：裸链接发布后会长期停在旧版（v1.6.0 实测）

- 发布成功后，裸链接（`?sharecode=…`）响应头是 `EO-Cache-Status: HIT`，`Last-Modified` 还停在上一版，`Age` 超过 1100 秒仍不刷新；**重新发布一次也清不掉**。
- 带任意额外参数（`&cb=随机` 或 `&v=1.6.0`）立刻 `MISS` 并返回新内容。
- **`Cache-Control: no-cache` 请求头不被遵守，Ctrl+F5 也无效**（曾经误判为"硬刷新可绕过"）。全新浏览器配置同样拿到旧版，所以这不是客户端缓存。
- 判定方法：`curl -s -D - -o /dev/null "<链接>" | grep -i "EO-Cache-Status\|Last-Modified"`，HIT + 旧时间戳即为缓存命中。
- **规矩**：发布后验证一律加 `&cb=随机`；对外发的链接一律用 `&v=<APP_VERSION>`。
- `tools/make-qrcode.py` 已自动读取 `app.html` 的 `APP_VERSION` 并追加 `&v`，所以每次发版只需重跑一次二维码脚本。

裸域名 `https://fanuc-milling-w.app.workbuddy.host/` 不带 sharecode 时返回 403。

### 与旧版切割核对（2026-10-23 复核，全部通过）

| 检查点 | 结果 |
|---|---|
| `app.html` 里旧域名 / 旧 appId / 旧 key | **0 处**（`grep -c` 为 0） |
| `app.html` 出现的 `workbuddy` 域名 | 只有 2 个：新发布域名 + 统一 OAuth Relay |
| `tools/` `tests/` 里旧标识 | 0 处 |
| `.workbuddy/applications.yaml` | 只登记 `wbapp_5TAJvvE8eVrSjSP13oJroH` |
| `.wbapp_*.genie` | 只有新应用一个 marker，`localDir` 指向本目录 |
| `qrcode.png` | 与新链接的二维码图形**像素级一致**，与旧链接图形差异 6.4 万像素 |
| `docs/history/` 里的旧域名 / 旧 appId | 保留（历史档案，**不参与运行**，别当残留删掉） |
| 旧工作区 `D:\WorkBuddy\对话\fanc-milling-app` | 仍在磁盘上，是独立旧副本；已不再使用，建议归档（不要在此发布） |
| 旧线上链接 `fanuc-milling-assistant…` | 属另一账号，无法下线，仍是 10-13 旧版；已从所有入口移除 |

发布命令（在本目录新任务里执行即可）：

```
workbuddy_sites_deploy
  directory = D:\WorkBuddy\fanc-milling-app
  language  = static
  entryHtml = app.html
  appName   = FANUC铣削编程助手
  domainPrefix = fanuc-milling-w
```

以后再改内容，**只在本目录发布一次即可**（同一目录 → 同一应用 → 链接不变）。

### 历史：为什么旧目录发不出去（存档，别再试）

- 旧目录 `D:\WorkBuddy\对话\fanc-milling-app` 绑定的应用 `wbapp_MgjnWjuikhj17T9RBXsxU8` 属于**另一个账号**
- 发布返回 `SITES_ACCOUNT_MISMATCH`（`retryable: false`），上传前就被拦下
- **试过且无效**：改 `appName`、改 `domainPrefix`、把目录改名到新路径（仍返回同一个 appId）
- 原因：绑定跟着**工作区**走，记录在 `D:\WorkBuddy\对话\.workbuddy\applications.yaml`，与目录路径无关
- 结论已验证：把项目**拷到新目录 + 在该目录新建任务**，才能创建本账号的新应用。旧目录不要再试。

旧链接 `https://fanuc-milling-assistant.app.workbuddy.host` 仍是 10 月 13 日旧版（27,786 字节，5 个面板），已废弃。

### AI 面板：已修复（云服务已绑定新域名）

`app.html` 第 9–13 行的 `__CLOUD_CONFIG__` 已换成本应用自己的云服务配置：

```js
const __CLOUD_CONFIG__ = {
  endpoint: "https://fanuc-milling-w.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_5TAJvvE8eVrSjSP13oJroH_..."
};
```

云服务环境：`wbcs_iQq6E9QTTnajqDSOG25Mzd`（`billingStatus=normal`、`provisionStatus=assigned`），与本应用共用同一 identity。

**线上已实测通过**（`tools/smoke-ai.js`，无头 Edge 在发布域名下跑真实调用）：

```
{ ok: true, model: "auto", modelCount: 34, frames: 57, text: "收到" }
```

密钥按 **Origin 精确匹配**，所以只有在该发布域名下才鉴权通过；`file://` 或本地 `http://127.0.0.1:8765` 打开时 AI 面板仍会失败，属正常（其余 9 个模块不受影响）。改代码后想复验：

```bash
node tools/smoke-ai.js "https://fanuc-milling-w.app.workbuddy.host/?sharecode=OTD3JQJQPI"
```

偶发上游 `HTTP 525`（网关握手失败）是瞬时的，重跑即可。

<details>
<summary>历史记录：修复前的旧配置（仅存档）</summary>

```js
endpoint: "https://fanuc-milling-assistant.app.workbuddy.host",
publishableKey: "wbpk_MgjnWjuikhj17T9RBXsxU8_..."
```
</details>

二维码生成（脚本已固化，`qrcode` + `Pillow` 装在 `C:/Users/wzp/.workbuddy/binaries/python/versions/3.13.12`）：

```bash
python tools/make-qrcode.py "https://fanuc-milling-w.app.workbuddy.host/?sharecode=OTD3JQJQPI"
# → qrcode.png 492x630，二维码 + 标题 + 折行网址
```

---

## 7. 待办（按性价比排序）

| 优先级 | 项 | 说明 | 难度 |
|---|---|---|---|
| 高 | 题库 + 自动判分 | 按知识点出题，学生交程序自动判分定位；题目内容需手写 20~30 道 | 中（难在内容） |
| 中 | 2D 材料去除 | 毛坯矩形减扫掠区域，看过切/欠切 | 中高 |
| 中 | 宏程序 → 普通 G 代码展开 | 逐行展开结果，讲宏程序最直观 | 中高 |
| 中 | G68 旋转作用于轨迹 | 现在只解释文字，图形不转 | 中 |
| 低 | 按真实进给回放 | 时间轴 + 倍速，配合已有工时估算 | 中 |
| 低 | 一键生成课堂幻灯 | 每页代码 + 刀轨 + 要点，导出 HTML/PPTX | 中 |

---

## 7.5 图纸识别的准确度现状（v1.6.3 实测）

用两张真实教材图做过基线：

| 图 | 基线（v1.6.2） | 问题 |
|---|---|---|
| T3-1「外轮廓铣削实例」（80 毛坯 + 78 曲线轮廓 + R100/R19/R13.5/R9） | 4 秒识别，2 条轮廓，confidence 0.62 | **把 80×80 毛坯当成了加工轮廓**，真正的零件轮廓被当成内腔；尺寸靠猜；圆弧全退化成折线 |
| 2-87「练习图三」（书页照片，R20+R6+90°，2mm 深） | **>200 秒无返回** | 照片 + 大图导致请求超时，且当时**没有超时保护**，用户只能干等 |

据此做的三件事（v1.6.3）：

1. **提示词加"毛坯 vs 零件"规则**：外框标 80、内轮廓标 78 这类差值图，外框必须放进 `blank`、不得作为 contours；轴测立体图/侧视图/剖视图一律忽略，只取俯视图。
2. **后处理 `dwgNormalizeRaster`**：按 `blank` 剔除毛坯外框 → 平移原点 → 按 `dims` 标注总长总宽**等比校准**；长宽比差 >8% 时告警。
3. **90 秒超时**（`DWG_LLM_MS`）+ 更明确的超时文案；另加「零件长/宽」手动校准输入，教师可随时纠正比例。

**实测对比（同一台机器，2026-10-24）**：

| 图 | v1.6.2 基线 | v1.6.5 现在 |
|---|---|---|
| T3-1（80 毛坯 + 78 曲线轮廓） | 2 条轮廓（80 毛坯被当零件）、尺寸 80×80、4 秒 | **1 条轮廓**（毛坯已剔除）、**78×78**、校准倍率 ×1.000、10~27 秒 |
| 2-87（书页照片，无总长标注） | >200 秒无返回 | 87 秒成功、1 条轮廓、**明确报告"未读到标注，尺寸按像素估算"**（不再编尺寸） |

仍存的短板（按影响排序）：

1. **圆弧没有拟合回 G02/G03** —— R100、R20 这类仍是一串 G01 点，程序长且不可读，几何精度取决于模型描点密度。
2. **轮廓形状保真度不稳定** —— T3-1 第二次识别时模型给的轮廓长宽比 66:44（正确应为 78:78），虽然尺寸校准拦住了，但形状本身不对。
3. **书页照片**靠得更远：透视、旋转、书脊阴影都会影响，87 秒才出结果。
4. 模型读标注数值仍会出错（v1.6.4 曾编出 49.92×49.89），现在靠"必须引用图上原文"兜住。

## 7.6 图纸模块的两条自救路径（v1.8.0）

模型给的图元经常"差一点"（S01 缺口 0.1~1mm），以前一拦就卡死。现在有两条路：

1. **图元可编辑**：清单里每个参数都是输入框，改完「应用修改并重新合成」→ 重跑 S01/S02/S03。
2. **基点坐标**：粘贴 `A: (-50.00, -53.02)` 形式的点表 → 逐段选直线/圆弧(R+凸凹) → 合成。**不经模型，精度最高**。

两者最终都走 `dwgRecompose()`：图元 → `dwgPrimsToSvg` → SVG → `parseSvgIR` → 校验，与原链路完全一致。

## 7.7 断口策略：不补线、抬刀再跳（v1.9.0）

以前 ≤1mm 的缺口会被"焊"上（画一条直线跨过去），>1mm 直接阻断生成。两个都不对：
前者等于替用户补线改了零件形状，后者让人卡死。

现在统一为：**任何断口都不补线**，链在断口处切成多段 → `dwgOpenIR()` 直接造 IR（每段 `open:true`），
`irToNC` 对开放段不写闭合回程、按首/末段方向延长做引刀退刀，段前一律 `G00 Z安全高度` 再 `G00 X Y`。
注释加 `OPEN` 标记，界面把断口列为"注意"而不阻断；刀轨图用红圈标出断口位置与缺口大小（`DWG.gapMarks` → `dwgDrawPath`）。

坑：`irToNC` 重排轮廓时会丢自定义字段，`open` 必须在 map 里显式透传；
另外 `parseSvgIR` 会丢掉"零高度/零宽度"的退化形状（一条直线），所以开放段不能再走 SVG 解析，要直接造 IR。

## 7.8 刀具库的口径（v1.10.0）

1. **补偿半径 = 机床刀补表里 D 号的那个半径值**，不是刀半径的别名。默认取 `直径/2`，用户可手改（留量、修磨）。
2. **改直径时只自动跟随"自动值"**：若补偿半径正好等于旧 `D/2`，改直径后自动变成新 `D/2`；已被手改过就不动。
   （实现见 `toolBody.oninput`，判据 `Math.abs(prevR - prevD/2) < 1e-9`）
3. **规范化在失焦时做**（`toolClean()`）：补 T 号零、直径非法整行丢弃、同 T 号后者覆盖、上限 20 把。
   打字过程中只存不重绘，否则会抢焦点。
4. **三个下拉都留「— 手填 —」且默认选中**：刀具库是便利用具，不是强制数据源，`toolAt('')` 必须返回 `null`（曾差点误取第 0 把）。
5. **T 号同时是 H 号与 D 号**，与图纸生成的既有口径一致（`G43 H01` / `G41 D01`）。
6. 存储键 `fanucW.tools`；已并入「清本地保存」的清除范围（`Object.keys(LSK)` 遍历）。

## 8. 会重复踩的坑

| 坑 | 表现 | 正确做法 |
|---|---|---|
| 往 HTML 注入探针 | `html.replace('</body>', ...)` 会命中 `exportHandout` 字符串里的 `</body>`，把脚本插进 JS 字面量中间 → `Invalid or unexpected token` | 用 `rpartition('</body>')` 从末尾插 |
| 提取主脚本 | 按「最大的内联 script」取会被 659 KB 的图片 JSON 抢走 | 按 `id="app-js"` 取 |
| 直出 base64 | 11 张原图 725 KB → base64 后接近 1 MB | 先 Pillow 缩到 1000px、128 色量化（降到 494 KB） |
| 改名目录 | `mv` 报 `Device or resource busy` | 先停掉占用目录的 `http.server`（TaskStop） |
| 找错练习注入 | 变异匹配到程序头的初始化 `G40/G49/G80` 会造出假错误 | 变异正则用行首匹配 `^\s*G40\b` |
| 圆弧整圆 | 终点=起点被「零位移」判断跳过 | 仅当无 I/J 时才跳过 |
| 分支漏写共享状态 | SVG 上传后按钮永远灰：`DWG.ir` 一直是 `null`，报 `Cannot read properties of null (reading 'contours')` | 分支里除了 checks 还要写回 `DWG.ir` / `baseIR`；测试里加了源码契约断言 |
| sticky + 长图截图 | 导航被画在长图中途，像"页面中间又出现一条导航"；当前项还会上下错位 | 截图前 `window.scrollTo(0,0)` **并把 `nav.style.position` 改成 `static`** |
| 静态资源要带 sharecode | `fetch('version.json')` 这类相对路径会丢掉页面 URL 的查询串，线上返回「链接不完整」HTML → 版本自检静默失效 | 请求时显式拼 `location.search`（`version.json?sharecode=…&ts=`） |
| 工具读错版本源 | `make-qrcode.py` 从 `index.html` 取版本号，v1.6.2 起那里没有版本号 → 卡片副标题空着 | 工具一律从 `app.html` 读 `APP_VERSION` |
| 圆弧方向随位置翻转 | 90° 圆弧被判成逆时针，输出 `G03` 扫 270°，预览画成一个整圆（v1.13.1 前） | 判顺逆要用**相对拟合圆心**的有向面积；相对原点的叉积会掺进隐式闭合弦的贡献 |
| 闭合轮廓最后一段弧被截断 | 圆弧停在 (8.05, 79.81) 再补一条 `G01`：闭合是隐式的（`dwgDedupe` 删掉了与首点重合的尾点），拟合窗口取不到首点 | `dwgFitArcs(pts, tol, minPts, **closed**)` 传 `true`（`irToNC` 已按 `!open` 传）；末点已到起点时不再补零长度 `G01` |
| 位图圆角镜像成凹角 | 图元合成 SVG 时 `sweep` 写成了 1，Y 翻转后每个圆弧被镜像，凸 R10 变成向内挖 3mm 的凹角 | 数学逆时针 + Y 翻转 = 屏幕顺时针，`sweep` 必须写 **0**；测试用 CCW/CW 两种输入的图元各验一遍四角圆心是否落在内侧 |
| 垂直引刀过切一个月牙 | 从轮廓正上方垂直切入时，刀补建立段的终点被偏到「垂直走刀方向」的一侧，而垂直切入的垂直方向正好沿轮廓，等于在起点多切一个刀半径 | 外轮廓改成 25 度斜向引刀、起刀点取最长边中点；引刀点法向 R+2、切向再退 (R+2)/tan25 |

---

## 9. 文件清单

```
fanc-milling-app/
├─ app.html            1.45 MB，应用本体（11 面板 + 内嵌文档 + 13 图）
├─ index.html          1 KB 入口转发层（永不变，别往里加东西）
├─ version.json        当前线上版本，应用用它做版本自检
├─ qrcode.png            二维码（指向当前线上链接，含 sharecode）
├─ CHANGELOG.md          版本更新日志（tools/version.js 维护）
├─ HANDOVER.md           本文
├─ .wbapp_5TAJvvE8….genie 发布标记（appId / localDir / entryHtml，勿删）
├─ docs/
│  ├─ 使用说明.md         918 行，文档唯一手改处
│  ├─ img/               11 张截图（panel-*.png）
│  ├─ samples/           图纸示例（part-60x40.svg）
│  ├─ proposals/         界面方案对比（ui-schemes.html，三套配色/布局）
│  └─ history/           历史工作日志
├─ tests/run-tests.js    277 项断言，Node 直接跑，无需浏览器
├─ releases/             每次发布的单文件快照（v1.0.0 / v1.4.0 / v1.4.1 / v1.5.0）
├─ tools/
│  ├─ sync-doc.js        文档 ↔ 应用双向同步
│  ├─ version.js         版本号查一致性 / 递增 / 同步
│  ├─ release.js         发版：检查 + 快照 + tag（三道闸门）
│  ├─ shoot-panel.js     重截某个面板的说明书配图
│  ├─ make-qrcode.py     生成发布链接二维码卡片
│  └─ smoke-ai.js        线上 AI 模块冒烟（CDP 驱动无头 Edge）
└─ .git                  提交 63a00fa（首版）/ v1.4 / v1.5.0
```

---

## 9.5 代码托管（GitHub，2026-10-24 起）

| 项 | 值 |
|---|---|
| 远端 | `git@github.com:jfsite/fanc-milling-assistant.git`（**私有**仓库） |
| 分支 | `main` |
| 标签 | 每个**已发布**版本一个 `vX.Y.Z`；v1.0.0 ~ v1.9.2 与 v1.12.1、v1.12.2 已推。v1.10.0 ~ v1.12.0 只在本机迭代、从未发布，因此没有 tag |
| 认证 | 本机 SSH 公钥（`~/.ssh/id_rsa.pub`，已在 GitHub 登记为 `jfsite`） |

日常推送：

```bash
git add -A && git commit -m "..." && git push
node tools/release.js && git push --tags   # 发版后别忘了推 tag
```

注意：

- **私有仓库不提供 GitHub Pages**（免费账号只对 public 开放），所以线上入口仍是 WorkBuddy 分享链接；
  若哪天转 public，先处理 `releases/`（21 MB 快照）与文档里的分享链接/appId。
- 换机器时只需：登记 SSH 公钥 → `git clone` → 装 Node/Python（跑 tests 与 tools 需要）。

## 10. 历史档案

- `CHANGELOG.md` —— 面向使用者的版本变更记录（v1.0 → 当前），发版前看一眼有没有漏记
- `docs/history/2026-10-13.md` —— 教材蒸馏成 skill 包、首版应用发布、云服务开通与 AI 面板接入
- `docs/history/2026-10-23.md` —— 纳入 git、v1.1 五项补齐、v1.2 教师侧能力、刀补偏置 bug、v1.3 联动/尺寸/找错、v1.4 帮助面板、两次发布受阻、**第三次换新工作区发布成功**

这两份是原始日志的副本，按时间倒序读也行，按主题跳读也行。新任务里如果要回忆某个决策的细节，优先查这两份，比翻对话快。
