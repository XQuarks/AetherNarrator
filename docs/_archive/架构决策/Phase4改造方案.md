# Phase 4 知识图谱改造方案

> 状态：✅ **已落地（2026-07-20）** —— 黎总确认范围 = A（UI 图谱增强）+ A1（自动建实体节点），不动召回引擎，零回归风险。

## 一、现状核对（已读代码确认，非脑补）
- 图谱入口：`src/lore-ui.js` 的 `mountGraphNow()`（force-graph 主路径）+ `buildGraph()`（手写 canvas 兜底，仅当 force-graph 库加载失败时启用）。
- 当前**节点**：每个 snippet 一个节点，按 `category` 着色（`LORE_CATEGORY_COLORS`）。
- 当前**边**：只画 `s.links`（片段间反向链接，relation ∈ causal/related/explains/contains，对应 `store.js` 的 `LINK_RELATION_LABELS` = 因果/相关/解释/包含）。
- **Phase 3 已落地的 `s.relations` 三元组（`[{from, relation, to}]`，实体名）目前完全没进图谱** —— 这正是 Phase 4 要补的"实体-关系"那一半。
- 图谱面板：`renderGraphPane()` 提供 canvas 容器 + 缩放/复位按钮 + `graphStats` / `graphLegend` / `graphInfo` / `graphPreview`。
- 架构脑暴文档原 Phase 4 描述："snippet 增加结构化 entities/relations；召回增加图遍历；UI 图谱直接读 KG"。其中"UI 图谱"是确定要做、零回归的部分；"召回图遍历"触及核心召回引擎，风险更高，列为可选增强。

## 二、Phase 4 v1 目标
把知识库从"片段列表 + 片段间链接"升级为可见的**实体-关系知识图谱（KG）**：
1. 把 `s.relations` 三元组画成**类型化关系边**（敌对 / 属于 / 位于 / 领导 / 盟友 / 师徒 / 发生于 / 掌控 …）。
2. 关系里提到的、**知识库还没收录成独立片段的实体**，自动建成**实体节点**，连成完整关系网。
3. 图例区分"链接边"与"关系边"两类；点击实体节点给只读预览卡。
4. **默认不动召回引擎（RAG）**，零回归风险。RAG 图遍历作为可选增强（见第五节）。

## 三、范围选项（请黎总确认）
- **A（推荐·完整 v1）**：类型化关系边 + 实体节点 + 图例区分 + 点击预览；不动召回引擎。
- **B（完整 v1 + 召回图遍历）**：在 A 基础上，RAG 召回时"命中实体沿关系扩展到邻居"。更强但触及核心召回，有回归风险，需更多测试。
- **C（轻量版）**：仅把 relations 画成边（from/to 都能对应到现有片段才画，不匹配的忽略），不建实体节点。

> 未匹配实体的处理（仅 A / B 涉及，C 无意义）：
> - **A1（推荐）**：自动建实体节点（关系网最完整）。
> - **A2**：连到"说出该关系的那条片段"本身（from/to 不匹配时，边连到声明此关系的 snippet）。
> - **A3**：直接跳过不匹配的关系（只画两端都能对应现有知识的边）。

## 四、推荐方案（A + A1）详述
### 4.1 共享图模型
新增 `buildGraphModel(snippets)`，统一被 `mountGraphNow` 与 `buildGraph` 复用，避免两条路径逻辑分叉：
- **片段节点**：`{ id: s.id, label: s.title, category: s.category, color, kind: "snippet" }`。
- **名称→节点解析 `resolveName(name)`**：
  - 先匹配 `s.id`；再匹配规范化（去空格 / 小写）后的 `s.title`；
  - 都不中 → 返回合成实体节点 `entity:<name>`（同实体多次提及合并为一个节点），`{ id:"entity:<name>", label:name, category:"实体", color:ENTITY_COLOR, kind:"entity" }`。
- **两类边**：
  - 链接边：`{ source:s.id, target:l.target, kind:"link", relation:l.relation }`（沿用现有）。
  - 关系边：`{ source:resolveName(r.from), target:resolveName(r.to), kind:"relation", relation:r.relation }`（新增）。

### 4.2 边样式区分
- 链接边：实线，颜色取 `REL_COLORS`（causal/related/explains/contains）。
- 关系边：虚线（`linkLineDash([4,2])`），颜色按 relation 文本稳定取色（hue 哈希或固定调色板循环），不同中文关系不同色。
- force-graph：
  - `.linkColor(d => d.kind === "relation" ? relColor(d.relation) : (REL_COLORS[d.relation] || "#888"))`
  - `.linkLineDash(d => d.kind === "relation" ? [4,2] : null)`

### 4.3 图例（buildLegend 扩展）
- 节点类别图例（现有）。
- "链接关系"图例：因果 / 相关 / 解释 / 包含（实线色块）。
- "抽取关系"图例：列出当前图谱里实际出现的关系文本（虚线色块）。

### 4.4 点击 / 预览
- `onNodeClick` 分支：片段节点 → 现有 `focusLoreSnippet(id)`；实体节点 → 新增 `focusLoreEntity(name)`，弹出**只读**预览卡（实体名 + 它参与的所有关系 `from → relation → to` 列表 + 提示"该实体尚未收录为独立知识条目"）。
- `graphStats` 改为：`N 节点（含 E 实体）· L 关联 · R 关系`。

### 4.5 兜底路径
`buildGraph()`（手写 canvas）同步加入关系边 + 实体节点（边结构 `{ai, bi, kind, relation}`，`drawGraph` 按 kind 决定实线 / 虚线），保持与主路径一致。

### 4.6 性能
- 关系边上限：每片段 ≤ 8 条（Phase 3 已限），巨世界（2000+）理论 ≤ 16K，实际远少；force-graph 可承载。
- 若担心实体节点过多显乱，可改 `resolveName` 一处切到 A2 / A3 策略（无需动其他代码）。

## 五、可选增强（仅当选 B 时细化，不在 v1 默认范围）
- `src/rag.js`：召回时"命中实体沿关系扩展到邻居"（图遍历），把邻居片段按相关度补入召回。
- `src/prompt.js`：说明图遍历带来的上下文，避免 AI 误用。
- 风险：中（触及核心召回，需回归测试剧情质量）。验证另出用例。

## 六、改动文件清单
- `src/lore-ui.js`：`buildGraphModel()` 新增（共享模型）；`mountGraphNow` 改用模型 + 关系边虚线样式 + `onNodeClick` 分支；`buildGraph` 同步；`buildLegend` 加两组边图例；`focusLoreEntity` 新增；`ENTITY_COLOR` / `relColor` 新增；`LORE_CATEGORY_COLORS` 加 `"实体"`。
- `index.html` / `styles.css`：实体预览卡样式（小改）；图谱容器无需改。
- （若选 B）`src/rag.js` + `src/prompt.js`：图遍历召回（另行细化）。

## 七、验证计划（✅ 已执行）
- `npm run verify` 全过（syntax / modules / load 18-18 / 测试 **63-63** / 浏览器烟雾）。
- 新增 `test/kg-graph.test.js`（7 项）：relation 边解析（from/to 匹配片段→连片段；不匹配→建实体节点且同实体合并）、链接边与关系边区分、实体节点不计入 snippet 数、关系文本取色稳定、自环跳过、同实体多片段合并、空输入不崩。
- 浏览器烟雾（`tools/browser-smoke.mjs`）：开局、设置、移动端布局全绿。
- 新增 `tools/graph-browser-test.mjs`：注入含 relations 世界 → 打开图谱实测渲染出 **"5 节点（含 2 实体）· 1 关联 · 3 关系"**、图例「链接」「抽取关系」两组齐全、force-graph 已渲染、无 pageerror，截图 `_kg_graph_preview.png`。

## 八、风险与回退
- 风险低（仅 UI 绘图 + 数据建模，不碰召回 / 剧情引擎）。
- 回退：改动集中在 `lore-ui.js` 图谱函数，git 可单独 revert；实体节点显乱时切 A2 / A3 只改 `resolveName` 一处。
