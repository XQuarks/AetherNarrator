# AetherNarrator 测试套件说明（AI 维护者指南）

> 本文件供接手本项目的 AI / 维护者快速理解 `test/` 下的测试脚本：**每个测试守护什么、依赖什么、如何运行**。人类读者亦可参考。
> 维护结论：38 个测试文件全部有效，无孤儿模块、无失效测试、无空测试。请勿凭"看起来重复"误删（见第六节互补说明）。

## 一、总览

- 测试位置：`test/*.test.js`，共 **38 个文件、约 284 个用例**（含 `describe` 嵌套子测试）。
- 测试框架：Node 内置 `node:test`（无需额外安装）。
- 收录机制：`package.json` 的 `test` 脚本为 `node --test test/*.test.js`，**只要文件命名为 `<name>.test.js` 就会自动被收录**，新增测试无需改配置。
- 隔离性：Node 测试运行器默认**每个测试文件在独立子进程中执行**，文件间全局状态（`src/store.js` 的 `S` 等）不串扰，可放心在单文件内 setup / teardown 全局状态。

## 二、如何运行

```bash
npm test                 # 跑全部 38 个测试文件
npm run verify           # 全套：语法 → 模块 → 加载 → 测试 → 浏览器冒烟
npm run check:syntax     # 仅语法检查（tools/syntax_check.cjs）
npm run check:modules    # 模块引用校验（tools/verify-modules.cjs）
npm run check:load       # 浏览器加载桩校验（tools/load-check.mjs）
```

- Node 版本：托管 `22.22.2`（项目 `type: module`，纯 ESM）。
- `npm run verify` 末尾的 `check:browser`（`tools/browser-smoke.mjs`）在沙箱环境下偶发因权限（EPERM）失败，本地重试即可，并非测试本身问题。

## 三、运行环境约定（写新测试必读）

1. **DOM 桩**：`game.js` / `app.js` / `render.js` / `lore-ui.js` 等模块加载时会访问 `document` / `window`。需要 import 它们的测试（`cognitive-state`、`fallback-choices`、`orphan-save`、`s5-critic-time`、`s5-opening-fix`、`s5-opening-optimize`、`world-tags-ai`）在文件顶部注入一个 Proxy 宽容 stub（`const any = new Proxy(function(){}, {...})`，再把 `window/document/navigator/location/fetch` 等挂到 `globalThis`）。**新增同类测试请复用该模式**（参考 `test/cognitive-state.test.js` 顶部）。
2. **IndexedDB**：仅 `cognitive-state.test.js` 用 `import("fake-indexeddb/auto")`，其余用 `localStorage` 的 Map 桩或全局桩，不依赖真实 IndexedDB。
3. **Embedding / 向量**：`ann`、`behavior-embeddings-concurrent`、`query-vector-dedup`、`timeline-embedding-cache`、`memory-isolation` **全部用 mock，不真实加载 transformers / hnswlib-wasm / Worker**。它们只守护向量**调度与缓存契约**（跳过已算、并发补算、查询复用、模型变更重算、缓存失效）；真实模型加载与召回质量由浏览器侧实测覆盖，node 单测不烧模型。
4. **LLM（`callXxxLLM`）**：`s5-critic-time`、`s5-opening-fix`、`s5-opening-optimize`、`world-tags-ai` 通过 `document.getElementById` 返回 `{checked:true}` 触发 `llm.js` 的 mock 模式（或 mock `fetch` 截获 prompt），**不真实请求 API**。
5. **全局状态 `S`**：直接读写 `S.currentWorld` / `S.gameState` 的测试都在文件内用 setup 函数管理，互不跨文件污染。

## 四、分类索引

| 分类 | 测试文件 | 一句话 |
|---|---|---|
| A. 时间系统 | `calendar` · `time-engine` · `triggers` · `multiverse` · `s5-start-date` · `s5-required-fields` · `s5-authoritative-time` · `s5-conflict-lint` · `s5-critic-time` · `s5-opening-tokens` · `s6-old-save-compat` · `s7-flexible-start` | 历法推进、时间倒流、事件触发、多世界时间线、开局日期/占位符/冲突检测、旧档兼容、年份归纪元+柔性起始日期 |
| B. 知识库 / 世界观 / 批评 | `kg-graph` · `critic` · `lore-revision` · `lore-confirm` · `worldview-guard` · `worldview-dsl` · `promotion` · `memory-transfer` | 知识图谱、矛盾修订、晋升确认、世界观禁令、规则 DSL、记忆包迁移 |
| C. 开场白专项 | `s5-opening-fix` · `s5-opening-optimize` | 时间冲突一键修复（regenerate/toPlaceholders）、剧情向优化 |
| D. UI / 交互 / 选项 | `action-wiring` · `atmosphere` · `cognitive-state` · `fallback-choices` · `orphan-save` | 按钮接线校验、氛围净化、认知状态、保底选项安全、孤儿存档 |
| E. 世界生成 / 提示词 / 模拟 | `prompt` · `world-tags-ai` · `simulation` · `s-stream-narrative` | 开局 prompt 构造、AI 标签清洗、模拟事件结构化、流式叙事抽取 |
| F. Embedding / RAG | `ann` · `behavior-embeddings-concurrent` · `query-vector-dedup` · `timeline-embedding-cache` · `memory-isolation` · `timeline-vector-batch` | ANN 索引、行为向量并发补算、查询向量复用、时间线缓存、记忆隔离、时间线批量向量与并发切片 |
| G. 基础设施 / 回合 | `reliability` | 回合锁、会话上下文、损坏配置回退、deadline、休息事件 |

## 五、测试详细清单

### A. 时间系统（Time & Calendar）

| 测试文件 | 被测模块:函数（src） | 用例 | 运行依赖 | 核心守护点 |
|---|---|---|---|---|
| `calendar.test.js` | `calendar.js`: `addGregorian/addLunar/addCustom/backfillCurrentDate/normalizeCurrentDate` 等 | 32 | 纯函数 | 多历法推进、月末夹紧、逆跳、旧档回推、比较 |
| `time-engine.test.js` | `time-engine.js`: `advanceWorldTime/hydrateWorldTime`；`calendar.js`: `compareCalendar` | 9 | 纯函数 | 跨午夜/倒流/绝对跳转推进、deadline 到期判定 |
| `triggers.test.js` | `triggers.js`: `normalizeTriggeredEvents/getTimelineTriggered/evalPolicy/recordTrigger/resetTriggers/createBranch` | 9 | 纯函数 | 事件不重触发、可重复冷却、分支隔离、重置回放 |
| `multiverse.test.js` | `store.js`: `S/normalizeTimeConfig`；`theme.js`: `getTimeConfig/ensureTimelineState`；`time-engine.js`；`new-worlds.js`: `createDualWorld` | 5 | store 全局态 | 多世界时间线独立推进、切换不丢进度、非多世界 no-op |
| `s5-start-date.test.js` | `calendar.js`: `normalizeCurrentDate` | 5 | 纯函数 | UI 起始日期经 `calendar_start` 正确驱动开局 `current_date` |
| `s5-required-fields.test.js` | `store.js`: `normalizeTimeConfig` | 9 | 纯函数 | 时间配置缺字段保底：custom 无月历表→day；multiverse 无 timelines→single；active_timeline 非法→取第一条；**gregorian/lunar 无 calendar_start 不再回退 day，保持 dated 模式**（年份归纪元后纪元-only 世界合法） |
| `s5-authoritative-time.test.js` | `prompt.js`: `buildAuthoritativeTime/buildAuthorNote` | 5 | 设全局 `S` | 权威时间章节（gregorian/multiverse/none/continuous）每轮注入 |
| `s5-conflict-lint.test.js` | `utils.js`: `detectTimeConflict/formatConflictMessage` | 11 | 纯函数 | 开场白时间冲突检测：改以 `era_label` 为锚点、同 decade 容错、克苏鲁式「1920年代」不误报、年份/季节/现代措辞/占位符豁免 |
| `s5-critic-time.test.js` | `utils.js`: `buildCriticTimeContext`；`llm.js`: `callWorldCriticLLM` | 5 | DOM stub + mock fetch | Critic 注入「权威时间锚点 + 冲突线索 + 第7条审查重点」 |
| `s5-opening-tokens.test.js` | `utils.js`: `resolveOpeningTokens` | 9 | 纯函数 | `{era_label}/{season}/{calendar_date}` 等占位符按历法解析、非破坏性保留 |
| `s6-old-save-compat.test.js` | `calendar.js`: `normalizeCurrentDate/backfillCurrentDate/ensureCurrentDate`；`new-worlds.js`: 三个预设 | 9 | 纯函数 + 预设工厂 | 旧 `{day}` 存档回推/规范化不崩、新档存读一致；克苏鲁预设已改 `calendar_start` 仅 `{month,date}`、年从 `era_label「1920年代」`推导为 1920 |
| `s7-flexible-start.test.js` | `calendar.js`: `deriveAnchorYear/validateStartDate/formatCalendarDate/normalizeCurrentDate/backfillCurrentDate`；`store.js`: `normalizeTimeConfig`；`utils.js`: `detectTimeConflict`；`theme.js`: `formatDateOnly/formatDeadlineLabel` | 26 | 纯函数 | 年份归纪元+柔性起始日期：anchor 推导（年代/硬年/无年）、克苏鲁式不误报、各粒度显示（年无关只月日/只月/全空）、日期校验（闰年/越界自动纠正）、无 year 截止、旧档硬年兼容 |

### B. 知识库 / 世界观 / 批评（Lore, Worldview, Critic）

| 测试文件 | 被测模块:函数（src） | 用例 | 运行依赖 | 核心守护点 |
|---|---|---|---|---|
| `kg-graph.test.js` | `kg-graph.js`: `buildGraphModel/expandRelationNeighbors/REL_COLORS/...` | 12 | 纯函数 | 关系边/链接边解析、实体合并、自环跳过、邻居召回 |
| `critic.test.js` | `utils.js`: `mergeLoreSnippets`；`lore-revision.js`: `parseLoreRevisionResponse/buildLoreRevisionDiff/applyLoreRevisionDiff` | 6 | 纯函数 | relations 三元组 NER 合并 + 「矛盾设定→修订 diff→修正」 |
| `lore-revision.test.js` | `lore-revision.js`: `applyLoreRevisionDiff/buildLoreRevisionDiff/parseLoreRevisionResponse` | 3 | 纯函数 | 修订 JSON 解析、diff 仅含实际变化/新增、应用后保留原条目 |
| `lore-confirm.test.js` | `lore-ui.js`: `shouldAutoApplyLoreRevision/buildLoreRevisionSummaryHTML` | 5 | store 态 | 晋升确认开关（自动 vs 手动）与弹窗摘要统计 |
| `worldview-guard.test.js` | `worldview.js`: `filterStateChangesByWorldview/findWorldviewViolations/...`；`store.js`: `S/getActiveConditionTags/getBannedConcepts` | 12 | store 态 | 违禁概念识别/别名/解锁标签/状态过滤/「3 次后静默」守卫 |
| `worldview-dsl.test.js` | `worldview.js`: `evaluateRules/legacyBanEntry` | 11 | 纯函数 | rules DSL 的 when/then 求值、severity、enabled、ending、旧版兼容 |
| `promotion.test.js` | `promotion.js`: `selectPromotionCandidates/markPromotedRecords/PROMOTE_MIN_IMPORTANCE` | 9 | 纯函数 | 晋升候选阈值/置顶/去重、`promote_` 前缀反解、不突变入参 |
| `memory-transfer.test.js` | `memory-transfer.js`: `createMemoryPack/mergeMemoryPack` | 4 | 纯函数 | 记忆包导出剔除向量、导入合并去重、拒非法格式、清洗 XSS |

### C. 开场白专项（Opening）

| 测试文件 | 被测模块:函数（src） | 用例 | 运行依赖 | 核心守护点 |
|---|---|---|---|---|
| `s5-opening-fix.test.js` | `llm.js`: `callRegenerateOpeningLLM` | 4 | DOM stub（mock 模式） | regenerate/toPlaceholders 模拟返回含 `{calendar_date}` 的新开场白 |
| `s5-opening-optimize.test.js` | `llm.js`: `callOptimizeOpeningLLM` | 3 | DOM stub（mock 模式） | 剧情向优化模拟返回含占位符的结构化开场白 |

### D. UI / 交互 / 选项（UI & Choices）

| 测试文件 | 被测模块:函数（src） | 用例 | 运行依赖 | 核心守护点 |
|---|---|---|---|---|
| `action-wiring.test.js` | `app.js`: `ACTIONS` 表（间接）；`index.html` 的 `data-action` | 1 | `fs` 读源码正则比对 | 所有 HTML 声明操作都在 `ACTIONS` 接线，无遗漏 |
| `atmosphere.test.js` | `utils.js`: `sanitizeAtmosphere` | 4 | 纯函数 | 留白压缩、60 字截断、非法值归一为 null |
| `cognitive-state.test.js` | `game.js`: `buildSmartFallbackChoices/applyStateChanges`；`utils.js`: `defaultInitialState` | 9 | DOM stub + fake-indexeddb | revealed_locations/present_npcs 增量累加 + 保底增强分支 |
| `fallback-choices.test.js` | `game.js`: `buildSmartFallbackChoices` | 3 | DOM stub | 保底选项不引用 lore 专名、恒 3–4 个场景安全动作、有随机性 |
| `orphan-save.test.js` | `render.js`: `renderSaveList/renderSaveDetail`；`game.js`: `loadSave` | 4 | DOM stub + fetch 桩 | 世界被删后孤儿存档不崩溃、显徽章、`loadSave` 防御提前返回 |

### E. 世界生成 / 提示词 / 模拟（World Gen & Simulation）

| 测试文件 | 被测模块:函数（src） | 用例 | 运行依赖 | 核心守护点 |
|---|---|---|---|---|
| `prompt.test.js` | `prompt.js`: `buildWorldGenerationPrompt` | 3 | 纯函数 | 导入原文时注入【原文开头】段 + 第二人称改写，无原文走兜底 |
| `world-tags-ai.test.js` | `prompt.js`: `buildWorldGenerationPrompt`；`utils.js`: `sanitizeWorldConfig/pickWorldTags/analyzeWorldTags`；`llm.js`: `mockGenerateWorld`；`new-worlds.js` | 7 | DOM stub（mock 模式） | tags 自由生成、清洗去重、优先 AI 标签、不与 type 徽章重复 |
| `simulation.test.js` | `simulation.js`: `applySimulationChanges/buildWorldSummary/normalizeSimulationState` | 3 | 纯函数 | 旧字符串事件/NPC 迁移为结构化状态、完成去重、摘要生成 |
| `s-stream-narrative.test.js` | `llm.js`: `extractPartialNarrative` | 6 | 纯函数 | 流式叙事中间态抽取：未出现/非字符串返回 null、部分文本（无收尾引号）、完整还原、转义引号/换行、字段后置仍可抽 |

### F. Embedding / RAG（向量与检索，**全部 mock**）

| 测试文件 | 被测模块:函数（src） | 用例 | 运行依赖 | 核心守护点 |
|---|---|---|---|---|
| `ann.test.js` | `ann-index.js`: `buildLoreIndex/getLoreAnnIndex/invalidateLoreAnn/embeddingRetrieveBruteforce` | 5 | mock hnswlib（`__setTestHnswLib`） | ANN 索引构建/查询映射/缓存失效/抛错兜底（不真实加载 wasm） |
| `behavior-embeddings-concurrent.test.js` | `rag.js`: `ensureBehaviorEmbeddings/EMBED_MODEL/EMBED_DIM`；`store.js`: `S` | 4 | `window/Worker` 桩 + mock 向量 | 已算跳过 + 并发补算 + 模型变更重算（防逐条串行） |
| `query-vector-dedup.test.js` | `rag.js`: `embeddingRetrieve/retrieveBehaviorRecords/EMBED_DIM` | 4 | `window/Worker` 桩 + mock 向量 | 「传入 qVec 复用不重算」契约，无模型时降级关键词 |
| `timeline-embedding-cache.test.js` | `rag.js`: `embedTimelineSegment/EMBED_MODEL/EMBED_DIM` | 4 | mockEmbed（直接返回数组） | 同段只算一次 + 并发去重 + 模型变更重算 |
| `memory-isolation.test.js` | `rag.js`: `addBehaviorRecords/ensureLoreEmbeddings/retrieve`；`prompt.js`: `rebuildSummaryFromHistory` | 9 | `window.transformers={}` + mock `S.embeddingModel` | 行为记忆运行态与世界模板隔离、检索/召回/字符预算 |
| `timeline-vector-batch.test.js` | `rag.js`: `embedTimelineSegmentsBatch/unlockedTimelineSegments/selectTimelineSlice/retrieve`；`store.js`: `S` | 8 | mock 向量 + Worker 桩 | 时间线分段按进度解锁、批量一次推理+段上缓存、失败逐段回落、语义/关键词切片、并发端到端不崩 |

### G. 基础设施 / 回合（Reliability）

| 测试文件 | 被测模块:函数（src） | 用例 | 运行依赖 | 核心守护点 |
|---|---|---|---|---|
| `reliability.test.js` | `turn-lifecycle.js`: `acquireTurn/isSessionContextCurrent/releaseTurn`；`migrations.js`: `parseStoredArray/parseStoredObject`；`time-engine.js`: `collectDueDeadlines`；`simulation.js`: `createRestEvent` | 7 | 纯函数 | 回合锁/会话上下文/损坏配置回退/deadline 到点/休息事件 |

## 六、已知"同一函数、角度互补"的测试（勿误删）

以下成对测试调用了相同函数，但**断言的不变式不同、属于互补回归**，删任何一个都会丢失一类保护：

- **`critic.test.js` ↔ `lore-revision.test.js`**：都测 `lore-revision.js` 的 diff 函数。
  - `critic` 偏「矛盾设定 → 修订 diff → 修正」的业务编排 + `mergeLoreSnippets` 的 NER 三元组合并。
  - `lore-revision` 偏 JSON 解析 + diff 仅含实际变化/新增 + 应用后保留原条目。
- **`cognitive-state.test.js` ↔ `fallback-choices.test.js`**：都测 `game.js` 的 `buildSmartFallbackChoices`。
  - `cognitive-state` 验证 revealed_locations/present_npcs **增强分支**（生成交谈/前往选项）与数量 3–4。
  - `fallback-choices` 验证**安全契约**（不引用 lore 专名、场景安全动作、每轮随机性）。

同理，`s5-opening-tokens` / `s5-conflict-lint` 与 C 类开场白测试虽都围绕"开场白"，但分别守护占位符解析、冲突检测、修复/优化三种不同函数，非重复。

## 七、维护约定（新增 / 修改测试）

1. **命名**：模块单测 `<module>.test.js`；Phase 专项 `s5-<feature>.test.js` / `s6-<feature>.test.js`；功能域用语义名（如 `calendar`、`triggers`）。
2. **收录**：文件放 `test/` 下、命名 `<name>.test.js` 即自动被 `npm test` 收录。
3. **DOM 依赖**：import 含 `document`/`window` 的模块（game/app/render/lore-ui）必须在文件顶部注入 Proxy DOM 桩，参考 `test/cognitive-state.test.js`。
4. **Embedding / LLM 一律 mock**：不要真实加载模型或请求网络；复用现有 mock 模式（注入 `window.transformers={}` / `Worker` 桩 / `document.getElementById` 返回配置元素 / mock `fetch`）。
5. **改了 src 导出名** → `grep -rn` 全 `test/` 同步所有 import 该函数的测试，否则单测会在加载期报导出缺失。
6. **跑全量验证**：改完跑 `npm run verify`（或至少 `npm test`）确认不破坏其他文件（文件间隔离，但共享同一套 src 导出）。
