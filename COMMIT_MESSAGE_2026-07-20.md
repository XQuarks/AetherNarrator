feat: 架构升级 Phase 0–4 + B6 记忆晋升 + 开局原文开头 + 知识晋升开关

本期完成本地化架构升级 Phase 0–4、记忆晋升 B6，以及两项体验优化（开局从原文开头、知识晋升确认开关），全部改动零破坏性，npm run verify 全过（语法 / 模块 / 加载 / 测试 87 项）。

Phase 0 · 清理兼容层
- 移除 migrations.js 旧迁移函数与 test/data-foundation.test.js；简化 storage/save/render/lore-ui/game 调用；UI 偏好仍存 localStorage。

Phase 1 · 本地 ANN 向量索引
- 新增 src/ann-index.js + vendor/ann/（hnswlib-wasm v0.8.2，零依赖离线可跑）
- rag.js 检索优先走 ANN，暴力检索兜底；2000 条构建 ~1976ms、单查 ~2.3ms、topK 重合度 avg 0.992

Phase 2 · 世界规则 DSL 引擎
- 新增 src/worldview.js evaluateRules（条件 concept/state/tag → 动作 ban/tag/ending，severity/enabled）
- 世界 rules:[] + lore-ui.js 规则编辑器 + render.js「世界规则」按钮

Phase 3 · NER 增强 + Critic 审稿人
- 新增 src/critic.js + llm.js callWorldCriticLLM（自动 / 手动审稿，复用 lore-revision diff）
- relations 三元组抽取 + 合并 + 「从源文档补抽」

Phase 4 · 知识图谱增强 + RAG 图遍历
- 新增 src/kg-graph.js（buildGraphModel 实体节点 + 类型化关系边、expandRelationNeighbors BFS 邻居扩展）
- 图谱换 force-graph（vendor/force-graph/）；rag.js retrieve() 沿 relations 扩展（默认开、2 跳）与链接跟随互补

B6 · 记忆晋升
- 新增 src/promotion.js（selectPromotionCandidates / markPromotedRecords）
- callLoreRevisionLLM 注入晋升候选、confirmLoreRevision 标记原记忆 promoted（保留不删，防重复建议）

Token 优化（方案 B）
- System 只常驻硬约束（8000 字符上限），其余走每轮动态 RAG（1600 字符 + 12 条上限）
- 2000 条知识库 token 下降约 29 倍

体验优化 A · 开局从原文开头
- src/prompt.js：导入小说原文后生成世界时注入【原文开头】段（原文前 3000 字），要求 opening_narrative 从原著第 1 章第 1 段出发、改写第二人称「你…」，并严格服从 world.desc（世界观改造，如改中世纪）/ world.hero（主角改造，如哈利→赫敏）。无原文保持原逻辑。新增 test/prompt.test.js（3 项）。

体验优化 B · 知识晋升确认开关
- ⚙ 选项面板新增复选框「知识库修订需我手动确认」（默认关，存 localStorage）：关 → AI 回写自动同意并提示「知识库已更新」；开 → 弹轻量确认窗列更新 / 新增 / 晋升数，玩家可否决。
- 涉及 store.js / index.html / render.js / lore-ui.js / game.js / app.js / styles.css；新增 test/lore-confirm.test.js（5 项）。

配套：docs/ 下新增 Phase0–4、B6、架构脑暴、开局从原文开头、知识晋升确认开关等方案文档；README 同步更新。

---

（以下为提交文件清单，仅供你在 SourceTree 勾选用，不要作为 commit message 正文）

已修改：
  README.md  index.html  styles.css
  src/app.js  src/game.js  src/llm.js  src/lore-ui.js  src/migrations.js
  src/prompt.js  src/rag.js  src/render.js  src/save.js  src/storage.js
  src/store.js  src/utils.js  src/worldview.js
  test/memory-isolation.test.js

新增：
  src/ann-index.js  src/critic.js  src/kg-graph.js  src/promotion.js
  test/ann.test.js  test/critic.test.js  test/kg-graph.test.js
  test/lore-confirm.test.js  test/promotion.test.js  test/prompt.test.js
  test/worldview-dsl.test.js
  tools/ann-browser-test.mjs  tools/graph-browser-test.mjs
  vendor/ann/  vendor/force-graph/
  docs/（8 个方案文档）

已删除：
  test/data-foundation.test.js

建议排除（不入库）：
  _kg_graph_preview.png（验证截图，临时产物）
  node_modules/（应已被 .gitignore 忽略）
