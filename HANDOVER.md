# 交接说明 HANDOVER

> 给「新工作区 / 新任务」读的。看完这一份 + `docs/history/` 就能接上，不需要翻旧对话。
>
> 最后更新：2026-10-23 23:58　｜　代码版本：v1.5.1（`index.html` 858 KB，10 个面板）　｜　**已发布上线**（见 §6）

---

## 1. 这是什么

《数控铣削编程与加工（FANUC系统）》配套的教学工具，面向江苏联合职业技术学院惠山中专办学点 522142 / 522143 班。

- **形态**：单个 `index.html`，零构建、零依赖，双击即用（仅「AI 生成程序」需要联网）
- **用途**：教师上课演示、作业批量批改、学生自查与练习
- **自包含**：说明文档与 11 张截图都以 base64 内嵌，拷一个文件到任何电脑都能完整使用

---

## 2. 常用命令

```bash
# 本地预览（改完刷新即可）
python -m http.server 8765 --bind 127.0.0.1

# 回归测试：163 项断言，必须 0 失败才算完成
node tests/run-tests.js

# 改完文档 / 换完截图后，把内容写回 index.html 的帮助面板
node tools/sync-doc.js --embed

# 版本号：查看一致性 / 递增（自动同步 index.html + 使用说明 + HANDOVER + CHANGELOG + 帮助面板）
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

**唯一能手改的地方**：`index.html` 第 10 行 `const APP_VERSION = "1.5.0";`

页面徽标（`#app-ver`）、标签页标题、导出讲义落款都在运行时从它取；文档侧由脚本写：

| 位置 | 写法 | 谁写 |
|---|---|---|
| `index.html` | `const APP_VERSION = "x.y.z"` | **手改（唯一源）** |
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
| git tag | `v1.0.0` `v1.4.0` `v1.4.1` `v1.5.0` … | 代码级回溯，`git show <tag>:index.html` 精确取出 |
| 单文件快照 | `releases/v1.5.0.html` 等 | 直接拷给学生 / 拷 U 盘 / 存档，不依赖 git |

```bash
# 看有哪些版本
node tools/release.js --list

# 回滚到 v1.4.0（先备份当前？当前版已由 v1.5.0 快照与 tag 覆盖，不必另存）
git show v1.4.0:index.html > index.html
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

## 3. 现状：10 个面板

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
| 9 | AI 生成程序 | 云端 LLM 流式生成 | `initCloud()` `aiGenerate()` |
| 10 | 帮助 | 内嵌完整说明 + 目录 + 搜索 | `renderHelp()` + `tools/sync-doc.js` |

跨面板能力：大屏模式 `togglePresent()`、本地自动保存 `autosave()` / `restoreAll()`、导出讲义 `exportHandout()`。

---

## 4. 代码结构

`index.html` 里按顺序有三个脚本块，**顺序不能乱**：

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
5. 加测试到 `tests/run-tests.js`，跑通全部断言（当前 163 项）
6. 更新 `docs/使用说明.md` 并 `node tools/sync-doc.js --embed`

---

## 5. 必须守住的约定

这些是踩过坑之后定下来的，改动前先看：

1. **文档单一数据源**：`docs/使用说明.md` 是唯一手改的地方，`index.html` 里的 `help-md` / `help-img` 块由 `sync-doc --embed` 生成，**不要手改那两个 script 块**。
2. **刀补偏置是示意，不是仿真**：偏移按段自身法向 + 拐点角平分线；**建立刀补那一段的起点保持编程点**；**G40 段不做偏置**（所以橙线与蓝线角点差一个刀半径是正常的）。界面上必须保留「示意」字样。
3. **包围盒有两种口径**，不要混：
   - 指标卡「包围盒（含进刀）」= `res.bbox`，所有轨迹
   - 尺寸核对用「轮廓闭环」= `contourBBox()`，**自动排除 G01 进刀**；无闭环才回退 `bboxCut`
4. **片段模式**：无 O 号且无 M30 时按指令片段校验（I06），不报头尾结构错误。
5. **子程序抑制**：进入子程序定义后不做 W04「主轴未启动」检查，否则模板会误报。
6. **找错练习的变异必须能被校验器检出**——测试逐条验证，新增变异时在 `tests/run-tests.js` 里补断言。
7. **测试全绿才算完成**：163 项，0 失败。
8. **不引入外部依赖**（AI 模块的 CDN SDK 除外），保持单文件可拷贝。

---

## 6. 发布状态（已解决，2026-10-23）

**已发布上线**，走的是之前判定可行的「路径 B 新工作区」。

| 项 | 值 |
|---|---|
| 工作区 | `D:\WorkBuddy\fanc-milling-app`（新目录，无历史应用登记） |
| 分享链接 | `https://fanuc-milling-w.app.workbuddy.host/?sharecode=OTD3JQJQPI` |
| 应用 ID | `wbapp_5TAJvvE8eVrSjSP13oJroH`（marker 文件 `.wbapp_5TAJvvE8eVrSjSP13oJroH.genie`） |
| 线上内容 | 858,355 字节 = 本地 `index.html` 字节数完全一致，标题「FANUC 铣削编程助手（W版）」 |
| 二维码 | `qrcode.png` 已重生成（492×630），编码带 sharecode 的完整链接 |

**注意：链接必须带 `?sharecode=OTD3JQJQPI`**，裸域名 `https://fanuc-milling-w.app.workbuddy.host/` 返回 403。

### 与旧版切割核对（2026-10-23 复核，全部通过）

| 检查点 | 结果 |
|---|---|
| `index.html` 里旧域名 / 旧 appId / 旧 key | **0 处**（`grep -c` 为 0） |
| `index.html` 出现的 `workbuddy` 域名 | 只有 2 个：新发布域名 + 统一 OAuth Relay |
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
  entryHtml = index.html
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

`index.html` 第 9–13 行的 `__CLOUD_CONFIG__` 已换成本应用自己的云服务配置：

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
| 高 | 刀具库 | T 号 / 直径 / 刃数 / 半径补偿值，与刀补、参数、刀轨联动，替掉现在手填刀半径 | 中 |
| 中 | 2D 材料去除 | 毛坯矩形减扫掠区域，看过切/欠切 | 中高 |
| 中 | 宏程序 → 普通 G 代码展开 | 逐行展开结果，讲宏程序最直观 | 中高 |
| 中 | G68 旋转作用于轨迹 | 现在只解释文字，图形不转 | 中 |
| 低 | 按真实进给回放 | 时间轴 + 倍速，配合已有工时估算 | 中 |
| 低 | 一键生成课堂幻灯 | 每页代码 + 刀轨 + 要点，导出 HTML/PPTX | 中 |

---

## 8. 会重复踩的坑

| 坑 | 表现 | 正确做法 |
|---|---|---|
| 往 HTML 注入探针 | `html.replace('</body>', ...)` 会命中 `exportHandout` 字符串里的 `</body>`，把脚本插进 JS 字面量中间 → `Invalid or unexpected token` | 用 `rpartition('</body>')` 从末尾插 |
| 提取主脚本 | 按「最大的内联 script」取会被 659 KB 的图片 JSON 抢走 | 按 `id="app-js"` 取 |
| 直出 base64 | 11 张原图 725 KB → base64 后接近 1 MB | 先 Pillow 缩到 1000px、128 色量化（降到 494 KB） |
| 改名目录 | `mv` 报 `Device or resource busy` | 先停掉占用目录的 `http.server`（TaskStop） |
| 找错练习注入 | 变异匹配到程序头的初始化 `G40/G49/G80` 会造出假错误 | 变异正则用行首匹配 `^\s*G40\b` |
| 圆弧整圆 | 终点=起点被「零位移」判断跳过 | 仅当无 I/J 时才跳过 |

---

## 9. 文件清单

```
fanc-milling-app/
├─ index.html            858 KB，应用本体（10 面板 + 内嵌文档 + 11 图）
├─ qrcode.png            二维码（指向当前线上链接，含 sharecode）
├─ CHANGELOG.md          版本更新日志（tools/version.js 维护）
├─ HANDOVER.md           本文
├─ .wbapp_5TAJvvE8….genie 发布标记（appId / localDir / entryHtml，勿删）
├─ docs/
│  ├─ 使用说明.md         918 行，文档唯一手改处
│  ├─ img/               11 张截图（panel-*.png）
│  └─ history/           历史工作日志
├─ tests/run-tests.js    163 项断言，Node 直接跑，无需浏览器
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

## 10. 历史档案

- `CHANGELOG.md` —— 面向使用者的版本变更记录（v1.0 → 当前），发版前看一眼有没有漏记
- `docs/history/2026-10-13.md` —— 教材蒸馏成 skill 包、首版应用发布、云服务开通与 AI 面板接入
- `docs/history/2026-10-23.md` —— 纳入 git、v1.1 五项补齐、v1.2 教师侧能力、刀补偏置 bug、v1.3 联动/尺寸/找错、v1.4 帮助面板、两次发布受阻、**第三次换新工作区发布成功**

这两份是原始日志的副本，按时间倒序读也行，按主题跳读也行。新任务里如果要回忆某个决策的细节，优先查这两份，比翻对话快。
