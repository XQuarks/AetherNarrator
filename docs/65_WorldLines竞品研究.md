# 65_WorldLines 竞品研究：可接入性与可借鉴设计

> 日期：2026-08-07
> 状态：研究完成（黎总布置）；4 个借鉴点是否落地**待黎总拍板**
> 研究对象：https://github.com/LudicDynamics/WorldLines（star 56，最后更新约 2026-07）
> 说明：本文所有"开源/闭源"结论均来自该仓库 README 的官方声明；数据结构示例来自其开源示例世界 `examples/multi-agent/kagura-island`。

---

## 一、一句话结论

**不能接入。** WorldLines 的引擎核心（`neonrp`）是闭源的、WORLD/SOUL 协议也尚未开源（官方承诺 v1.0 才发布），且其开源部分使用 AGPL-3.0（改代码后对外发布必须整体开源，与 AetherNarrator 闭源方向冲突）。**但它的设计思想全部通过开源示例世界/教程敞开**——其中 4 点与 AetherNarrator 的未完成项/短板直接对得上，值得借鉴。

---

## 二、WorldLines 是什么

- **定位**：面向 AI 角色扮演 / TRPG 的「活世界」多智能体模拟引擎。世界观是"世界本身 = 一群 AI 角色（soul）组成的**社会**"，每个角色是有心智、记忆、秘密、目标的独立 agent，而不是"一行对话数据"。玩家通过分身终端走进来。
- **团队**：Ludic Dynamics（东京），创始人 Niko Huang（东大 CG 博士 + DeNA 游戏工程师经历）。
- **理论**：把 LLM 游戏世界形式化为 *Parameterized-Action POMDP*（参数化动作的部分可观测马尔可夫决策过程），回合提交走 **Plan–Diff–Validate–Apply** 管线（生成 → 对比差异 → schema 校验 → 应用）。论文：CHI PLAY Companion '26。
- **引擎三种模式**（官方强调不可互换）：
  - `multi-agent`：world-agent 包裹一群独立 soul，每个角色自己感知/决策/行动（如 Kagura Island 7 魂、Stoneford·Elena 2 魂）。**这是它的核心形态。**
  - `orch`：world-agent 路由到领域子代理（town/combat/rules-referee/story），NPC 是数据驱动（如 Stoneford、Goblin Ambush、Sakura Hallway、Lamp of Souls 国风乙女、**Worldline 时间漂移叙事**）。
  - `fast`：单声部轻量 agent。
- **模型无关**：可跑 DeepSeek / OpenRouter / 本地（Ollama / LM Studio / GLM）。
- **版本状态**：v0.1.9 引擎（2026-04）→ v0.2.3 多智能体村庄（2026-06）→ v0.3.0 桌面端（2026-07）→ v1.0 目标"稳定 WORLD/SOUL 协议"。**仍在迭代期，协议未稳定。**

---

## 三、为什么接不进来（开源边界，官方 README 原文声明）

| 部分 | 状态 | 含义 |
|---|---|---|
| 引擎核心 `neonrp` | **闭源**（专有预览，"free to play, not free to fork"） | 没有可接入的运行时 API |
| WORLD/SOUL 协议 | **未开源**（"agent protocol/architecture is still being iterated and not open-sourced yet"） | v1.0 才承诺稳定+开源，现在没有稳定契约可用 |
| `examples/`（示例世界）+ `tools/` + `tutorials/` | **开源，AGPL-3.0** | 可以 fork 世界来玩/改，但**改后发布受 AGPL 传染**（整体开源），不能把其代码搬进 AetherNarrator |
| 运行时形态 | 依赖后端多 agent 并行编排（Claude Code / LangGraph / 自定义 agent 管线） | 与咱们纯前端 + 单 LLM 一回合的架构不符 |

→ 结论：**只学设计思想（数据模型、权限模型、事件模型），不接代码、不抄代码。**

---

## 四、核心架构（可借鉴的部分）

### 4.1 world-agent 主权模型（编排层）

```
world-agent（唯一"世界主权"）
  ├─ 拥有世界状态写入权（write_globs 白名单）
  ├─ 路由 functional 子代理：town / combat / rules-referee / world-builder / npc-builder / story-narrative
  ├─ 每回合：玩家输入 → 活跃 souls 并行反应 → world-agent 收口（整合+叙事+落盘）
  └─ 铁律：world-agent 从不读 souls/**（角色的私密思考不被世界层窥探）
```

关键点：
- **唯一写入者**：世界状态只能由 world-agent 写（`game/meta/run_state.json`、`game/timeline/*.json`、`game/locations/*.json`、`game/lore/notes.md`），子代理不落盘或仅回传结果。→ 防多个 agent 互相污染。
- **权限白名单**：每个 agent 的 `manifest.json` 声明 `read_globs` / `write_globs`（可写哪些路径），越权写被运行时拒绝。soul 内部再拆 6 个 specialist（orchestrator/mind/memory/action/dialogue/narrative），各自 `write_globs` 不同（如 `soul-memory` 只能写 `short-term-memo/**`、`long-term-memo/**`；`soul-mind` 零写权限）。
- **控制面 vs 人格面分离**：运行时可以对"离线角色"做低熵系统级连续性写入，但禁止读取/撰写角色私密思想。

### 4.2 文件支撑 + 事件溯源 + 版本化（持久层）

- 世界一切状态在磁盘上（纯 JSON + Markdown），**每回合 = 一条 append-only 事件**，快照（snapshots）加速回放。
- "Every agent decision, every world-state change, is a plain-text event you can trace, replay, and measure."
- `playthrough.json` 记录整局契约，带 `version_hash` / `head_commit`——**世界像 git 仓库一样可 diff、可分支、可恢复、可分享**（作者博客："Version Control for Story Worlds"）。

### 4.3 防剧透门禁（内容层）

- `game/lore/` 分三层：`gm-truth.md`（**世界真相/GM 视角，narrator 被 `deny_globs` 禁止读取**）、`story.md`（玩家可见故事线）、`notes.md`（运行时笔记，world-agent 可写）。
- 即：**引擎知道真相、叙事层不知道**，真相只能被"受门禁的后期揭示"放出来。

---

## 五、数据模型细节（来自开源示例 Kagura Island，真实结构）

### 5.1 灵魂包 soul（= 咱们的 B1 人物卡 + B6 记忆，但更细）

```
souls/<sid>/
  soul.md                # 散文「宪章」：不是字段罗列，是有质感的写作
  persona/               # 不可变心理内核
    core_traits.json     #   核心性格
    motivations.json     #   动机
    values.json          #   价值排序（冲突时选哪个 → "人味"来源）
    relationships.json   #   与其他角色的关系
  background/            # 不可变来历
    origin.md / history.md / secrets.md   # 秘密 = 角色引擎
  rules/                 # action_rules / decision_rules / interaction_rules
  character/             # 运行时可写（RPG 数值）
    stats.json / inventory.json / equipment.json / wallet.json / status.json
  long-term-memo/        # 长期记忆（三分型！）
    emotional_memories.json   # 情感记忆
    important_events.md       # 重要事件
    learned_facts.json        # 学到的知识/事实
  short-term-memo/       # 短期记忆
    current_context.json / recent_events.json / conversation_cache.json
  trajectory/action_log.md  # 行为轨迹日志
  agents/manifest.json   # 6 个 soul-specialist 的权限契约
  run_state.json
```

`persona` / `background` 是**不可变内核**（这个角色是谁，不因一局游戏改掉）；`character` / `memory` 是**运行时可写**（数值涨、记忆累积 = 灵魂"活着"的部分）。

`soul.md` 宪章的写法（值得抄的"模板"）：`Core Presence`（一句话人格）→ `What Drives Her`（驱动力）→ `Voice And Social Posture`（声口）→ `Pressure Pattern`（压力下的反应模式）→ `Blind Spots`（盲点）。

### 5.2 世界侧 game/（= 咱们的 world 数据 + 时间线 + 新增地点）

```
game/
  lore/         gm-truth.md(真相,禁读) · story.md(玩家可见) · notes.md(运行时笔记) · 线索json
  locations/    地点图：id/name/tags/summary/connections(连接)/npcs_default/hidden(隐藏点)
  items/        物品：owner/location/power/era_link(时代关联,如"勾玉=穿越6年前"的道具)
  player/       stats/profile/inventory/flags/wallet/journal(私有日志,player层维护)
  timeline/     current.json：循环时间线 + 记忆继承表
  meta/         active-agent / roster(玩家绑定) / run_state / game-start
  agents/       manifest.json：world-agent 团队契约
```

`timeline/current.json` 亮点：**循环时间线 + `memory_inherit` 表**（每个角色在当前循环是否记得上一轮：`has_memory / reason / residual`）+ `taboo_violations`（禁忌违规记录）+ `key_rules`（循环铁律）。→ 与咱们 docs/20/21 时间系统（multiverse、穿越记忆策略）是同一类问题、不同表达。

### 5.3 角色卡 / 世界书（SillyTavern 兼容层，创作侧）

- **角色卡**：标准 `chara_card_v2`（name/description/personality/first_mes/mes_example/creator_notes），**AI 角色卡可直接导入它的世界**。
- **世界书 lorebook**：`entries[]`，每条 `keys`（触发关键词）+ `content` + `insertion_order`（优先级）+ `constant`（常驻条目，不进上下文则不靠关键词）——"按需注入，不是全量塞"。→ 与咱们 B1 知识库的 activation_keys / trigger_mode 是同一设计家族。

---

## 六、与 AetherNarrator 逐项对照

| WorldLines 设计 | AetherNarrator 现状 | 结论 |
|---|---|---|
| world-agent 主权 + write_globs 白名单 | 已有同类：B 系列容器注入 + `sanitizeWorldConfig` 白名单（仅引擎可写状态、AI 只产增量） | ✅ 思想已覆盖，不重复做 |
| soul 包（soul.md 散文宪章 + persona/background/rules） | B1 人物卡已落地 | 可学：人物卡描述可参考"宪章五段式"写法；`values.json` 价值排序值得补 |
| long-term-memo **记忆三分型**（情感/重要事件/知识） | B6 记忆为单型（key_facts → activeBehaviorRecords ≤100） | ⭐ 借鉴点 1 |
| gm-truth **真相禁读**（deny_globs） | docs/56 防剧透门禁已有（unlock_stage 隐形剔除，未达标卡片不进召回池） | 可互补：加"GM 专属真相层"，只喂引擎判定、绝不进叙事 prompt → 借鉴点 2 |
| locations **地点连接图**（connections + hidden + npcs_default） | **无地点系统** | ⭐ 借鉴点 3（穿越/多世界玩法前置） |
| 事件溯源 + 快照 + 版本化（playthrough.json / head_commit） | docs/34 B5'「日程+章节化回溯」⬜ 未做；现有存档为整体快照（docs/55） | ⭐ 借鉴点 4（正好当 B5' 参考实现） |
| timeline memory_inherit（循环中谁记得什么） | docs/20/21 时间系统已有（multiverse、穿越策略、已触发事件四策略） | ✅ 已有同类，思想可交叉验证 |
| lorebook（keys 触发 + insertion_order + constant） | B1 知识库已有（activation_keys / trigger_mode / scan_depth） | ✅ 同一设计家族 |
| 多智能体并行（每 soul 6 specialist） | 单 LLM 一回合（浏览器端） | ❌ 架构不符，学不了 |
| 世界"不玩也在走"（常驻运行） | 纯前端无后端常驻 | ❌ 学不了 |
| 直接 fork 它的示例世界 | AGPL-3.0 传染 + 引擎闭源 | ❌ 不抄代码 |

---

## 七、4 个借鉴点落地建议（供拍板，均不接代码）

### 借鉴点 1：记忆三分型（升级 B6，低成本，推荐先做）

**目标**：让角色记忆不只是"事实列表"，而分情感/事件/知识三类，叙事更有"人味"。

**建议结构**（保持现有 key_facts 兼容，只增不破）：
```jsonc
// S.activeBehaviorRecords 或新增 S.soulMemory（容量上限沿用 B6 的 100 条）
{
  "emotional": [ { "text": "…", "target": "某个角色/物", "intensity": 0.8, "ts": 123456 } ],
  "important_events": [ { "text": "…", "day": 3, "era": "…", "ts": 123456 } ],
  "learned_facts":  [ { "text": "…", "source": "lore:xxx", "ts": 123456 } ]
}
```
**改动面**：`prompt.js` 记忆注入段（三类分段落注入）+ B6 晋升逻辑按类型落槽 + `lore-ui.js` 编辑器展示。**涉及**：B6 模块。**成本**：中（1 次重构）。**兼容**：旧 key_facts 归入 learned_facts。

### 借鉴点 2：GM 专属真相层（补强 docs/56，低成本）

**目标**：世界可以有"只有引擎知道"的真相（谜底、幕后设定、NPC 真实身份），保证 AI 叙事绝不剧透，且玩家后期揭示时从"受控通道"放出。

**建议**：`world.lore_kb` 现有 `unlock_stage` 机制保留；新增一层 `world.gm_truth`（纯文本/结构化），**只进 `sanitizeWorldConfig` 白名单、只在引擎侧判定逻辑（事件触发、结局判定、检索过滤）使用，任何叙事 prompt 构建路径都不得包含**。编辑器 `lore-ui.js` 加"GM 真相"tab，标注"不会透露给玩家"。
**成本**：低。**风险**：需在 `prompt.js` 所有叙事构建入口加一次"gm_truth 字段剔除"检查（防手滑注入）。

### 借鉴点 3：地点连接图（新系统，为穿越/多世界铺路，中等成本）

**目标**：世界有显式地点图（地点 + 连接 + 隐藏点 + 默认 NPC），AI 叙事可引用"当前地点"，多世界/穿越时可判断"能不能到达"。

**建议结构**（新增 `world.locations`，与现有 lore 互补，不冲突）：
```jsonc
[ { "id": "cafe", "name": "咖啡馆", "summary": "…", "connections": ["town","cafe-basement"],
    "npcs_default": ["kagami"], "hidden": { "basement": "cafe-basement" }, "discovered": false } ]
```
**改动面**：`sanitizeWorldConfig` 白名单加 `locations`；`render.js` 世界详情加"地图"视图；生成 prompt 让 AI 产出地点图；游玩时 `S.currentLocation` 参与回合上下文。**涉及**：与 docs/20/21 时间系统协同（穿越 = 切换地点图/时间线）。**成本**：中。

### 借鉴点 4：事件溯源 + 章节化回溯（实现 docs/34 B5'，参考实现有了）

**目标**：每回合存"只追加事件日志"（append-only），支持回到任意历史回合（章节化回溯），像 git 一样可分支恢复——这是 B5' 一直没做的。

**建议**（浏览器端可行版本，不学它的 git 集成）：
- IndexedDB 每回合追加 `{ turn, type: "event", payload }`（玩家输入/AI 回复/状态变更摘要/关键事实），定期存快照（如每 10 回合）；
- 回溯 = 从最近快照重放到目标回合（replay），分支 = 复制世界快照后从该点继续；
- 复用现有存档（docs/55）：普通存档 = 快照；回溯点 = 快照 + 事件日志。
**成本**：中高（涉及存储层 + 存档 UI + 游玩循环）。**建议**：等前面 1~3 稳定后再做，作为"进阶项"。

---

## 八、明确不学（及原因）

1. **6-specialist soul**（角色内部再拆 6 个 AI 子代理）：咱们单 LLM 一回合，无后端并行；学它 = 复杂度爆炸且无收益。
2. **世界常驻运行**（不看也走）：需要常驻后端进程，纯前端做不到，且与"玩家驱动的文字游戏"定位不符。
3. **直接抄任何代码**：AGPL-3.0 传染 + 引擎闭源，只抄思想、不抄代码。
4. **它的"版本化世界 = git 仓库"** 的完整形态：对浏览器端太重；只借鉴"事件日志 + 快照 + 回放"的最小形态。

---

## 九、行动建议

- **建议顺序**：借鉴点 1（记忆三分）→ 借鉴点 2（GM 真相层）→ 借鉴点 3（地点图）→ 借鉴点 4（事件溯源/B5'）。
- 1、2 是"升级现有模块"，性价比最高；3 为穿越玩法铺路；4 是独立进阶项。
- 每项都按项目规矩：**先出细化方案文档 → 黎总确认范围 → 才动代码**。

## 待定

1. ~~是否整理研究文档~~ ✅ 2026-08-07 黎总确认，本文档落盘。
2. 借鉴点 1~4 各自是否立项、范围如何？→ **待黎总拍板**。
