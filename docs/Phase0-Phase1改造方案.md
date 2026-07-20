# Phase 0（清理）+ Phase 1（ANN 索引）具体改造方案

> 前提：**不兼容旧存档/世界**。因此可以自由删除向后兼容（迁移）代码、做破坏性 schema 变更，无需写迁移脚本、也不用背历史包袱。
> 本文只列「方案 + 改动文件清单」，**不执行**。待黎总说"做"再动手。

---

## 一、Phase 0：清理（✅ 已落地 2026-07-20，低风险）

### 目标
删掉 `migrations.js` 里的向后兼容迁移函数，让未来改 schema 不受旧数据牵制。**只删兼容层，不动业务逻辑。**

### 关键事实（已核对磁盘）
- `src/migrations.js` 含 4 个导出：
  - `parseStoredArray` / `parseStoredObject`（**纯安全解析，不是迁移**）—— `storage.js:8` 依赖，⚠️ **必须保留**。
  - `migrateWorldRecord`(46-52) / `migrateSaveRecord`(54-82)（**真正的旧档兼容迁移**）—— 本次删除。
  - `LATEST_SAVE_SCHEMA_VERSION`(=2) —— 删函数后若无人引用则一并删除导出。
- 调用方（grep 已确认）：`storage.js`、`save.js`、`render.js`、`lore-ui.js`、`game.js`、`app.js`。
- `store.js` / `theme.js` 里的 `localStorage` 是 **UI 偏好（主题/字号/温度）**，工作记忆明确"刻意保留"——⚠️ **不在清理范围**。
- 根目录 `_archive_root_monolith_2026-07-15/` 已不存在（7-15 回退时已清），跳过。

### 逐文件改动清单

| 文件 | 行 | 改动 |
|------|----|------|
| `src/migrations.js` | 46-82 | 删除 `migrateWorldRecord` / `migrateSaveRecord` 两个函数 |
| `src/migrations.js` | 2 | `LATEST_SAVE_SCHEMA_VERSION` 若全项目无引用则删除该行 |
| `src/storage.js` | 8 | import 去掉 `migrateSaveRecord, migrateWorldRecord`（仅留 `parseStoredArray, parseStoredObject`） |
| `src/storage.js` | 41 | `S.worlds = parsed.value.map(migrateWorldRecord)` → `S.worlds = parsed.value`（新世界自带正确结构；如需保险可内联 `out.behavior_records ??= []`） |
| `src/storage.js` | 339 | `S.saves = raw.map(save => migrateSaveRecord(...))` → `S.saves = raw` |
| `src/save.js` | 18 | import 去掉 `LATEST_SAVE_SCHEMA_VERSION, migrateSaveRecord` |
| `src/save.js` | 124 | `migrateSaveRecord(stored, world)` → 直接用 `stored` |
| `src/render.js` | 10 | import 去掉 `migrateSaveRecord` |
| `src/render.js` | 407 | `migrateSaveRecord(stored, world)` → `stored` |
| `src/lore-ui.js` | 12 | import 去掉 `migrateSaveRecord` |
| `src/lore-ui.js` | 465 | `migrateSaveRecord(stored, world)` → `stored` |
| `src/game.js` | 14 | 确认 `migrateSaveRecord`/`LATEST_SAVE_SCHEMA_VERSION` 是否真被使用；若无实际使用 → 删除整行 import（grep 显示 game.js 内仅此一处出现，疑似死导入） |
| `src/app.js` *(可选)* | 44 | 去掉 `migrateGameState(S.gameState)` 调用 + `utils.js:12` 的 `migrateGameState` 函数（gameState 形状也不再兼容旧档） |
| `docs/架构评估与方案脑暴.md` | — | 补一句"Phase 0 已落地" |

### 风险 & 回滚
- **风险：低**。纯删兼容代码；新数据本就符合当前 schema。
- **回滚**：SourceTree 一键 revert 即可。
- **验证**：`npm run verify`（语法 / 模块图 / 加载 18 / 测试 39）必须全过——`check:modules` 会抓出任何残留的悬空 import。

---

## 二、Phase 1：ANN 索引（✅ 已落地 2026-07-20，风险中·有 O(n) 兜底）

### 目标
把 `embeddingRetrieve()` 里的 **O(n) 全库余弦扫描** 换成 **近似最近邻（ANN）索引**，检索从"逐本翻图书馆"变"按检索卡定位"。

### 实际落地说明（与方案差异点）
- **库引入方式**：未在 `index.html` 加静态 `<script>`。改为 `src/ann-index.js` 的 `loadHNSWLib()` 在浏览器内 **动态 `import("../vendor/ann/hnswlib.js")`**（wasm 已内联进 js，无需 fetch，`file://` 亦可）。`index.html` 只改了 CSP：在 `script-src` 补 `wasm-unsafe-eval`、`unsafe-eval`（hnswlib 的 emscripten 胶水用 `new Function` 注册类需 `unsafe-eval`，wasm 编译需 `wasm-unsafe-eval`）。
- **API 修正**：hnswlib-wasm 正确构造是 `new lib.HierarchicalNSW("cosine", dim)`（空间类型作第一参数，**无独立 `Space` 对象**）。初版误写 `new lib.Space(...)` 已在浏览器实测时修正。
- **缓存键**：`getLoreAnnIndex(kb, worldId, {dim})` 按 worldId 缓存，模型维度变化自动重建；`invalidateLoreAnn(worldId)` / `invalidateAllLoreAnn()` 失效钩子已接 `lore-ui.js`（词条增删改）与 `save.js`（切世界/读档）。
- **测试分层**：`test/ann.test.js` 用 `__setTestHnswLib` 注入 mock lib 校验「构建/查询映射/缓存/失效/兜底」逻辑（node 无法跑浏览器 wasm 构建）；`tools/ann-browser-test.mjs` 在真实 Edge/Chromium 里 import 真库、建 2000 条 512 维索引、对比 ANN topK 与暴力 topK 重合度（合格线 avgRecall≥0.95 / minRecall≥0.85）。

### 瓶颈定位（已核对）
`src/rag.js:131-152` `embeddingRetrieve`：
```js
const scored = embeddedSnippets.map(s => ({           // ← 每条都算一次余弦，O(n)
    snippet: s, embScore: cosineSimilarity(qVec, s.embedding)
})).sort((a,b)=>b.embScore-a.embScore).slice(0, topK);
```
- 你的世界 2000+ 条 → 每回合对 2000+ 个 512 维向量各算一次余弦 → 主线程/Worker 都吃力，且 `selectTimelineSlice`(rag.js:294) 还会**逐段时间线段再调一次 embedding 向量**，雪上加霜。
- 向量已存在每条 `s.embedding`（512 维 + `embedModel`/`embedDim` 打标），`data/lore_kb_with_embeddings.json` 即是样例。

### 设计

#### 1. 离线引入 ANN 库（沿用 force-graph 的"npm→vendor"模式）
- 用托管 Node：`cd ~/.workbuddy/binaries/node/workspace && npm install hnswlib-wasm --no-save`，把 `hnswlib.wasm` + JS 胶水复制到 `vendor/ann/`（沙箱封了 CDN curl，但 npm 可达，force-graph 当时就这么做的）。
- 主选 **`hnswlib-wasm`**（HNSW 算法，浏览器最成熟）；备选 `usearch`（更小巧的 wasm）。
- 兜底：若 wasm 在 `file://` 下加载异常，保留现有 O(n) 暴力扫描作为 fallback（行为完全一致，仅慢）。
- `index.html` 按库构建方式加一行引入（UMD 用普通 `<script>`，ESM 用 import）。

#### 2. 新增 `src/ann-index.js`
- `getLoreAnnIndex(kb)`：
  - 按 `kb` 或 worldId 缓存（模块级 `Map`），避免每次检索重建。
  - 仅索引带合法 `s.embedding` 且 `embedModel/embedDim` 与 `EMBED_MODEL/EMBED_DIM` 一致的片段。
  - 建 HNSW 索引（space=`cosine`，dim=512），逐条插入向量、label=snippet.id。
  - 模型变更 → 触发重建。
- `searchLoreAnn(qVec, topK)`：查询索引，返回 topK 的 `{id, score}`，再映射回 snippet。
- `invalidateLoreAnn(worldId)`：编辑知识库后清缓存，下次懒重建。
- 库缺失/异常 → 抛错，由 `rag.js` 捕获走 fallback。

#### 3. 改 `src/rag.js`
- `embeddingRetrieve`(131-152)：
  ```js
  let scored;
  try {
      const idx = await getLoreAnnIndex(kb);
      const hits = searchLoreAnn(qVec, topK * 2);          // ANN 近似 TopK
      scored = hits.map(h => ({ snippet: idMap.get(h.id), embScore: h.score })).filter(x=>x.snippet);
  } catch (e) {
      // 兜底：现有 O(n) 余弦扫描（原代码原样保留）
      scored = embeddedSnippets.map(s => ({ snippet:s, embScore: cosineSimilarity(qVec, s.embedding) }))
               .sort(...).slice(0, topK);
  }
  ```
- `keywordRetrieve`(74) 与加权融合(342-354) **不动**（混合检索保留：关键词 + ANN 向量）。
- `ensureLoreEmbeddings`(171) 不动（建索引前必须先保证向量就绪）。
- 行为记录 `retrieveBehaviorRecords`(463) 仅 ≤100 条 O(n)，**暂不索引**（低优先级，可在 Phase 1.5 补）。

#### 4. 失效钩子（编辑即时生效）
- `src/lore-ui.js` 增/删/改词条 → 调用 `invalidateLoreAnn(currentWorldId)`。
- `src/save.js` 切换世界/读档 → 清对应缓存（或直接留空，下次检索懒重建）。

#### 5. 持久化（Phase 1.5，可选）
- HNSW wasm 在浏览器序列化较麻烦；2000×512 建索引仅几十毫秒，**Phase 1 先内存构建**（向量本身已持久化在 snippet 里）。
- 后续若需跨会话免重建，再把索引序列化存 IndexedDB（给 `idb.js` 加一个 object store 即可）。

### 逐文件改动清单（实际）

| 文件 | 改动 |
|------|------|
| `vendor/ann/hnswlib.js` + `hnswlib-*.js`（**新增**） | hnswlib-wasm 浏览器构建（wasm 内联），从 node_modules 复制 |
| `index.html` | CSP `script-src` 补 `wasm-unsafe-eval`、`unsafe-eval`（不改 script 标签） |
| `src/ann-index.js`（**新增**） | ANN 索引：动态 import 真库 / `getLoreAnnIndex(kb, worldId)` / `idx.search` / `invalidateLoreAnn` / `invalidateAllLoreAnn` / `embeddingRetrieveBruteforce` O(n) 兜底；余弦相似度内联避免引入 store 链 |
| `src/rag.js` | `embeddingRetrieve` 优先 ANN（try/catch 回落 O(n) 兜底），其余不动 |
| `src/lore-ui.js` | `saveLoreReview` 写回后 `invalidateLoreAnn(currentWorld.id)` |
| `src/save.js` | `startGame` / `prepareSessionFromSave` 开头 `invalidateAllLoreAnn()` |
| `test/ann.test.js`（**新增**） | mock lib 注入校验构建/查询映射/缓存/失效/兜底（node 侧） |
| `tools/ann-browser-test.mjs`（**新增**） | 真实浏览器 2000 条 ANN vs 暴力 topK 重合度验证 |
| `docs/架构评估与方案脑暴.md` | 补"Phase 1 已落地" |

### 风险 & 回滚
- **风险：中**（引入新依赖）。**缓解**：① O(n) fallback 永远在，ann 失败=原行为；② 索引全内存、不改任何数据格式（向量早已持久化）；③ 零存档/世界数据风险。
- **回滚**：SourceTree revert；或删 `src/ann-index.js` + 还原 `rag.js` 即完全回到现状。
- **验证**：
  1. `npm run verify` 全过（语法/模块/加载 18/测试 39）。
  2. 新增 `test/ann.test.js`：构造 200 条随机向量 mock kb，对比 ANN 返回集合与暴力 TopK 集合的重合度（>95% 即合格），防回归。
  3. 浏览器实测：临时把一个 2000 条 mock 知识库注入 `S.currentWorld`，跑 `retrieve()` 测耗时前后对比（临时脚本跑完即删）。demo 默认世界仅 7 条，看不出差别——**大世界增益需你本地浏览器开真实世界验证**。

---

## 三、执行顺序建议
1. **先做 Phase 0**（纯删代码，10 分钟，验证全过）→ 干净基线。
2. **再做 Phase 1**（加库 + 新模块 + 改一处检索）→ 验证 + 单测 + 浏览器实测。
3. 两步都建议**分别提交**（SourceTree 两个 commit），出问题各自 revert，互不牵连。

## 四、总体影响一览
| 维度 | Phase 0 | Phase 1 |
|------|---------|---------|
| 改动文件数 | 6-7 个 | 4 个 + 2 新增 |
| 数据格式变化 | 无 | 无（向量已存） |
| 存档/世界兼容 | 主动放弃旧档（符合前提） | 不影响 |
| 主要收益 | 未来 schema 自由 | 大世界检索快一个量级、未命中降 |
| 主要风险 | 低 | 中（有兜底） |
