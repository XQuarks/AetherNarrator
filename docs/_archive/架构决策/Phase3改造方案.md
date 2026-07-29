# Phase 3 改造方案：IP 抽取 NER 增强 + Critic 审稿人　**✅ 已落地（2026-07-20）**

> 配套规划：`docs/架构评估与方案脑暴.md` 第四节 / 第三节「Phase 3 — IP 抽取 NER + Critic 自检」。
> 目标：让"上传一本书就生成可玩世界"更稳更准——① **Critic 审稿人**：世界生成后自动查矛盾/冲突并修订；② **NER 增强**：抽取结果带实体关系图，且支持给"已有世界"补抽知识库。
> 前置：Phase 0 / 1 / 2 已落地。本方案**不兼容旧存档/世界**（规划前提），但**现有默认世界、现有知识库编辑/规则功能必须继续正常工作**。
> **重要现状修正**：核对磁盘代码发现，规划文档里"NER 建知识库"在 Plan A 已大半落地——`generateWorld` 的分块 LLM 抽取（`callLoreChunkLLM` 合并去重生成带 `activation_keys`/`trigger_mode` 的 `lore_kb`）已存在。因此 Phase 3 v1 实际交付 = **Critic 审稿人（全新）+ NER 结构化增强（relations 三元组 + 已有世界补抽）**，而非从零做 NER。

---

## 〇、现状盘点（先说清楚，避免重复造轮子）

**已落地（无需重做）**：
- `src/files.js` 已支持 TXT / DOCX（mammoth）/ EPUB（JSZip）上传，原文存 `S.sourceFileContent`（上限 12M 字符）。
- `src/game.js` 的 `generateWorld` 已实现 **Plan A 全书分块抽取**：`callLoreChunkLLM` 逐块调 LLM 抽 lore → `mergeLoreSnippets` 合并去重 → 生成带 `activation_keys`/`trigger_mode`/`scan_depth`/`priority`/`links` 的 `lore_kb`。**这就是"NER 建知识库"的基础，已可用。**
- `src/lore-revision.js` 已有 diff 纯函数（`parseLoreRevisionResponse` / `buildLoreRevisionDiff` / `applyLoreRevisionDiff`），`src/llm.js` 的 `callLoreRevisionLLM` + `lore-ui.js` 的 `triggerLoreRevision`/`confirmLoreRevision`/`rejectLoreRevision` 已实现"AI 修订→缓冲→确认"整条流水线。**Critic 可直接复用这套 diff/确认机制。**

**Phase 3 真正要补的两块**（下文详述）：
1. **Critic 审稿人（全新）**：生成后（及手动触发）用第二个 LLM 通读整库，查**内部逻辑矛盾 / 触发词冲突 / 悬空链接 / 违反 Phase 2 硬规则 / 重复条目**，产出修订 diff，弹窗让用户"采纳/忽略"。
2. **NER 增强（在已有抽取上做加法）**：
   - 抽取提示词追加**实体关系三元组**（`relations: [{from, relation, to}]`），让 force-graph 图谱能画"类型化关系边"（Phase 4 知识图谱地基）。
   - 给**已有世界**加"从源文档补抽知识库"按钮（当前抽取只在建世界时发生），用 `mergeLoreSnippets` 并入当前 `lore_kb`，不重建整个世界。

---

## 一、Critic 审稿人（核心新增）

### 目标
世界生成完（或玩家在知识库里点"审稿"）后，自动跑一次"审稿 LLM"，把知识库里的**硬伤**揪出来并给出修订建议，玩家一键采纳。这是"上传即生成世界"的差异化护城河。

### 设计
- **新增 `src/critic.js`**（薄编排层，复用 `lore-revision.js` 的纯函数）：
  - `callWorldCriticLLM(kb, world)`：调 `llm.js`，把整库（`[id:类别:标题] 内容 + links`）+ `world.rules`（Phase 2 硬规则）+ `world.desc` 交给模型，提示它找矛盾/冲突/悬空链接/违规/重复，输出**与 lore-revision 同 schema** 的 `snippets` JSON。复用 `parseLoreRevisionResponse` 解析、`buildLoreRevisionDiff` 算 diff。
  - `runWorldCritic(world, { onDone })`：编排"调 LLM → 算 diff → 弹窗"；diff 为空则 toast「未发现矛盾」；否则把 diff 存 `S._loreRevisionBuffer`（**直接复用现有确认台**，不另造轮子），并弹 `criticModal` 概要（更新 N 条 / 新增 M 条）。
- **触发点**：
  1. **自动**：`generateWorld` 在 `loreKb` 合并+向量化完成后，自动 `runWorldCritic(world)`（fire-and-forget，不阻塞"世界已创建"提示）。
  2. **手动**：知识库编辑面板（`loreReviewModal`）加「🤖 审稿检查」按钮，对当前世界跑一次。
- **采纳/忽略**：直接复用 `confirmLoreRevision`/`rejectLoreRevision`（`S._loreRevisionBuffer` 已是统一缓冲）。采纳后 `applyLoreRevisionDiff` → `ensureLoreEmbeddings` 重算向量 → 存盘。
- **与 Phase 2 联动**：Critic 提示词里把 `world.rules`（禁词/状态/标签规则）作为"不可违反的硬约束"喂给模型，让审稿能发现"知识库设定与你自己定的规则打架"的情况。

### 改动文件
| 文件 | 改动 |
|------|------|
| `src/critic.js`（**新增**） | `callWorldCriticLLM` / `runWorldCritic` 编排 |
| `src/llm.js` | 新增 `callWorldCriticLLM` 的 prompt 构建（复用 `buildApiUrl`/`readApiInputs`） |
| `src/game.js` | `generateWorld` 末尾接 `runWorldCritic`（自动审稿） |
| `src/lore-ui.js` | 知识库面板加「审稿检查」按钮 → `triggerWorldCritic`；导出 `triggerWorldCritic` |
| `src/render.js` + `index.html` | 新增 `criticModal` 概要弹窗（采纳/忽略） |
| `src/app.js` | 注册 `triggerWorldCritic` / `confirmLoreRevision` 已在 ACTIONS |

---

## 二、NER 增强（在已有抽取上做加法）

### 2.1 实体关系三元组（图谱地基）
- 改 `src/llm.js` 的 `buildLoreChunkPrompt`：要求每条 snippet 额外输出 `relations: [{from, relation, to}]`（如 `{from:"林家", relation:"敌对", to:"王家"}`）。
- `src/game.js` 的 `generateWorld` 合并逻辑：把各段 `relations` 汇总进 snippet（与 `links` 并存，`links` 是人工维护、`relations` 是抽取所得，图谱渲染时都画）。
- `src/lore-ui.js` 的 `mountGraphNow`：force-graph 边数据同时读 `links` 与 `relations`，关系类型着色（已有 `REL_COLORS`）。
- 影响：纯增量字段，旧 snippet 无 `relations` 时图谱退化为只读 `links`，**向后兼容**。

### 2.2 已有世界补抽知识库
- `src/lore-ui.js` 知识库面板加「📥 从源文档补抽」按钮（仅当 `world.source_content` 存在时可用）。
- 点击 → 复用 `generateWorld` 里的分块抽取+合并逻辑（抽成独立函数 `extractLoreFromSource(sourceContent, name, ipName, styleRef, customStyle)` 便于复用）→ `mergeLoreSnippets(currentKB.snippets, newSnippets)` 并入 → 重算向量 → 存盘 → 提示"已补抽 N 条"。
- 不动世界其他配置（schema/开场/规则），只 enrich `lore_kb`。

### 改动文件
| 文件 | 改动 |
|------|------|
| `src/llm.js` | `buildLoreChunkPrompt` 加 `relations` 输出要求；抽 `extractLoreFromSource` 公共函数 |
| `src/game.js` | `generateWorld` 改用 `extractLoreFromSource`；合并时汇总 `relations` |
| `src/lore-ui.js` | 加「从源文档补抽」按钮 + `extractAndMergeSourceLore(worldId)` |
| `src/prompt.js` / `src/rag.js` | 无需改（只读 snippet 字段，新增 `relations` 不影响现有召回） |

---

## 三、逐文件改动清单（汇总）

| 文件 | 改动 | Phase |
|------|------|------|
| `src/critic.js` | **新增**：Critic 编排 | 3-Critic |
| `src/llm.js` | 加 `callWorldCriticLLM` prompt；`buildLoreChunkPrompt` 加 relations；抽 `extractLoreFromSource` | 3-Critic / 3-NER |
| `src/game.js` | `generateWorld` 自动接 Critic；改用 `extractLoreFromSource`；合并汇总 relations | 3-全 |
| `src/lore-ui.js` | 知识库面板加「审稿检查」「从源文档补抽」按钮 + 对应函数；导出 | 3-全 |
| `src/render.js` + `index.html` | 新增 `criticModal` 概要弹窗 | 3-Critic |
| `src/app.js` | 注册 `triggerWorldCritic`（确认沿用 `confirmLoreRevision`） | 3-Critic |
| `test/critic.test.js` | **新增**：Critic diff 解析/空 diff/与 rules 联动判定（mock 注入，不真调 LLM） | 3-Critic |
| `docs/架构评估与方案脑暴.md` | 补「Phase 3 已落地」 | — |

---

## 四、验证

- `npm run verify` 全过（语法 / 模块图 / 加载 / 测试，现有 50 项 + 新增 Critic 单测）。
- **Critic 单测（mock 注入，不烧 API）**：
  - 输入含矛盾的知识库（如两条互相冲突的设定）→ 解析出 updates。
  - 输入干净知识库 → diff 为空 → 走"未发现矛盾"分支。
  - 输入违反 `world.rules` 禁词的知识库 → Critic 建议修订（验证与 Phase 2 联动）。
- **浏览器实测**：上传一段含冲突设定的示例文本 → 生成世界 → 确认自动弹"审稿"概要 → 点采纳 → 知识库更新、图谱出现 relations 边。
- **回归**：默认世界（无 source_content）进入游戏、知识库编辑、规则编辑均正常（Critic 按钮在 `source_content` 缺失时仍可用，仅"补抽"按钮禁用）。

---

## 五、范围确认点（动代码前需黎总拍板）

1. **v1 是否包含 NER 增强（实体关系 + 已有世界补抽）**，还是只做 **Critic 审稿人** 这一块差异化功能？（Critic 是全新且最值钱，NER 增强是锦上添花。）
2. **自动审稿时机**：世界生成后自动跑（省事但多一次 API 调用），还是只在玩家手动点「审稿检查」时才跑（省钱、可控）？建议默认自动跑 + 可手动。
3. **Critic 成本**：每次审稿 = 1 次 LLM 调用（通读整库）。大世界（2000+ 条）可能要较长的上下文，是否接受？

> 黎总确认以上范围后，我即按本方案落地，不改任何未授权文件。
