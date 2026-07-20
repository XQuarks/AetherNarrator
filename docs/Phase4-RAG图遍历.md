# Phase 4 增补 · RAG 图遍历召回（relations 实体邻居扩展）

> 状态：✅ **已落地（2026-07-20）**。黎总确认范围 = 默认开启 + 2 跳。验证见第七节。
> 前置：Phase 4 知识图谱 UI（relations 三元组已在图谱里画成虚线关系边）已落地 ✅。本增补是它的**召回侧闭环**——让这些关系真正影响"每轮喂给 AI 的知识"。

---

## 一、要解决的问题

当前 `retrieve()`（`src/rag.js:317`）的图谱扩展只有一路：

- **B9② 链接跟随**（rag.js:399–427）：沿 `s.links`（片段↔片段的**片段 ID**链接）深度≤2 拉邻居。

但 Phase 3/4 抽出来的 `s.relations`（`[{from, relation, to}]` **实体名**三元组，如 `哈利—[敌对]→伏地魔`）**完全没有进召回**。结果是：图谱里画得出"哈利和伏地魔是死对头"，但只要玩家没直接提到"伏地魔"，AI 这轮就收不到伏地魔的设定——**图谱与召回是两张皮**。

本增补 = 在 B9② 之外，**再加一路沿 `relations` 实体三元组的邻居扩展**（命中"哈利"→顺藤摸到"伏地魔""食死徒"）。

---

## 二、设计

### 1. 纯函数（node 可单测）
在 `src/kg-graph.js` 新增 `expandRelationNeighbors(seedSnippetIds, snippets, opts)`：
- 由 `snippets` 建两张表（每次召回现建，O(n+edges)，与现有 B9② 同量级，不引入缓存失效坑）：
  - `nameToSnippetId`：规范化实体名 → 片段 id（按 `title` 精确匹配；也允许按片段 id 解析）。
  - `adj`：实体名 → 邻居实体名集合（relations 无向建边，便于双向摸到）。
- 起点 = 每个 seed 片段的 `title` + 它 relations 里提到的实体名。
- BFS 沿 `adj` 扩展 `maxDepth` 跳，收集落点在某片段上的实体名 → 返回**候选片段 id 集合**（排除 seed 自身、排除已召回）。
- 实体-only 节点（如"伏地魔"尚未收录为片段）仍作为 BFS 中转，可继续摸到下游片段（如"食死徒"），本身不注入（无内容可喂）。

### 2. 接入 `retrieve()`（`src/rag.js`）
- 位置：紧接 B9② 链接跟随块之后（rag.js:427 之后），仍在"触发门禁"之后，故邻居**不再过门禁**、直接以低分保底（与链接邻居一致）。
- 门禁开关：`_kb.relation_traversal === false` 时跳过（默认**开启**）。
- 落地分：`0.3`（与现有链接邻居一致，避免喧宾夺主）。
- 预算：邻居照常参与后面的 token 预算裁剪（BUDGET_CHARS）+ 12 条硬上限，超预算自动丢弃，零溢出风险。
- 去重：已召回的不再覆盖（保持原高分）。

### 3. 不碰的东西（零回归）
- 不改 `s.links` 跟随逻辑；relations 是**新增一路**，两者结果求并集。
- 不碰剧情引擎 / prompt 组装 / 时间线切片。
- 纯函数与渲染层（kg-graph.buildGraphModel）解耦，沿用 Phase 4 已落地的纯模块。

---

## 三、改动文件清单
- `src/kg-graph.js`：新增 `expandRelationNeighbors`（纯函数）。
- `src/rag.js`：`retrieve()` 内 B9② 之后插入 relations 遍历块（约 8 行，含开关 + 门禁注释）。
- `test/kg-graph.test.js`：新增 `expandRelationNeighbors` 单测（BFS 深度 / 实体-only 中转 / seed 排除 / 无 relations 空返回）。
- `test/memory-isolation.test.js`：新增 1 条集成测试，调用真实 `retrieve()` 验证"命中哈利→召回伏地魔/食死徒"；并验证 `relation_traversal:false` 时关闭。
- `docs/Phase4-RAG图遍历.md`：本文件标已落地。
- `docs/架构评估与方案脑暴.md`：Phase 4 段补"RAG 图遍历已落地"。

---

## 四、需黎总拍板的范围（见提问）

1. **默认开启 or 默认关闭**：推荐默认开启（低分 + 预算帽，已用单测/集成测试覆盖，零回归风险）；保守起见也可默认关闭、留开关手动开。
2. **扩展深度**：推荐 2 跳（与现有 B9② 链接跟随一致）；1 跳更克制。

---

## 五、验证计划（✅ 已通过）
- `npm run verify` 全过：**70/70** 测试（新增 7 项纯函数 + 2 项 retrieve 集成）+ check:modules + check:load(18/18) + 浏览器烟雾。
- 纯函数单测（`test/kg-graph.test.js`）：BFS 2 跳正确、seed 自身排除、实体-only 中转不注入、maxDepth=1 不摸第 2 跳、空/非法输入空集。
- 集成测试（`test/memory-isolation.test.js`）：真实 `retrieve()` 在 node 跑（关键词降级），断言"命中哈利→召回伏地魔(直接)+食死徒(经中转 2 跳)"；断言 `relation_traversal:false` 时关闭扩展。
- 浏览器烟雾：开局/设置/移动端三连跑全绿、无 pageerror。

## 六、改动文件清单（✅ 已落地）
- `src/kg-graph.js`：新增纯函数 `expandRelationNeighbors`（node 可单测）。
- `src/rag.js`：`retrieve()` 内 B9② 链接跟随之后插入 relations 遍历块（门禁 `_kb.relation_traversal !== false`，默认开；邻居以低分 0.3 保底，受 token 预算裁剪）。
- `test/kg-graph.test.js`：+7 项 `expandRelationNeighbors` 单测。
- `test/memory-isolation.test.js`：+2 项 `retrieve` 集成测试（含开关关闭）。
- `docs/Phase4-RAG图遍历.md`：本文件标已落地。
- `docs/架构评估与方案脑暴.md`：Phase 4 段补"RAG 图遍历已落地"。

## 七、范围确认与红线
- 黎总确认：默认开启 + 2 跳（AskUserQuestion）。
- 黎总红线守住：先出方案 doc（本文件）→ 确认范围 → 亲口"做"才动码；未碰未授权文件。
- 设计要点：relations 遍历与现有 B9② `s.links` 跟随是**两路互补并集**，不改动 links 逻辑、不碰剧情引擎/ prompt 组装/时间线切片；邻居低分保底 + token 预算帽，零溢出风险。
