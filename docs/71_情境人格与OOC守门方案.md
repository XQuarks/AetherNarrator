# docs/71 情境人格（A 方案）数据模型与 OOC 守门逻辑

> 关联文档：`docs/70_状态栏与变动日志方案.md`（同批「🟡 可加强」项：OOC 人设守门）
> 状态：方案设计阶段，**本迭代不动代码**，待确认范围后落。

---

## 1. 背景与目标

### 1.1 现状（来自 docs/70 的结论）
当前人物卡的锚点字段为**单值 + 仅主角导向**：

| 字段 | 当前形态 | 局限 |
|---|---|---|
| `personality` | 单值顿号串（已归一） | 全角色只有一套性格 |
| `voice` | 单值字符串 | 全角色只有一种说话方式 |
| `attitude` | "对主角态度"单值 | 只记录与主角关系 |
| `relationship` | "与主角关系"单值 | 只记录主角 |
| `untouchable` | 单值字符串 | 硬禁区，跨切面仍生效 |

单一人格锁定式守门会把两类**合法剧情特性**误判为 OOC：
- **多重人格 / 面具切换**（角色本就该有两面）；
- **对不同人不同语气**（对 A 客气、对 B 尖刻）。

### 1.2 目标
把 OOC 守门从「锁定唯一人格」升级为「**允许人格的白名单**」：
- 角色可在已定义的多个切面（对不同人、不同情境）间自由切换，**不算 OOC**；
- 只有言行落到**所有已定义切面并集之外**才纠偏；
- 数据上新增可选字段，**与现有单值基线叠加兼容、零负担**。

### 1.3 两种场景如何被 A 方案覆盖
| 想要的剧情特性 | 用 A 方案的哪种 context |
|---|---|
| 对不同人不同语气 | `npc:<角色名>` 切面 |
| 多重人格 / 面具切换 | `situation:<标签>` 切面（+ `is_alter` 标记真·人格分裂） |
| 常态（默认） | `default` 切面 |

---

## 2. 核心设计原则

- **P1 锚点 = 集合而非唯一值**：OOC = 言行落到所有已定义切面（含基线）的并集之外。
- **P2 切面切换合法**：本回合切到任一已定义切面，守门不罚（这是与「单一锁死」的本质区别）。
- **P3 基线兜底**：未定义 `personality_modes` 时，回退到现有单值 `personality`/`voice`（向后兼容、零负担）。
- **P4 真·多重人格（`is_alter`）与情境伪装（mask）区分标记**，但守门判定统一按「是否在并集内」。
- **P5 `untouchable` 仍是硬禁区**，跨所有切面一律生效（与 GM 真相层同构）。

---

## 3. 数据模型

### 3.1 新增字段：`character.personality_modes`（数组，可选，默认空）

```js
{
  id: "default",            // 同角色内唯一标识
  label: "常态",            // 给人看的切面名（如「表里人格」「夜之人格」）
  context: "default",       // 触发情境，见 3.2
  traits: "理性、坚韧、好奇", // 此切面性格标签（顿号串，复用 personality 规范形态）
  voice: "平稳、偶尔自嘲",    // 此切面说话方式（复用 voice 规范形态）
  attitude: "对主角客气但有距离", // 可选，仅该切面激活时覆盖基线 attitude
  is_alter: false,          // true=真·人格分裂（剧情特性）；缺省/ false=情境伪装
  priority: 0               // 多面同命中时优先级，数值大者胜
}
```

### 3.2 `context` 触发类型

| context 写法 | 含义 | 覆盖场景 |
|---|---|---|
| `"default"` | 无任何其它切面命中时的基线 | 建议每角色至少配一个 |
| `"npc:马尔福"` | 当前交互对象为该角色时激活 | 对不同人不同语气 |
| `"situation:combat"` | 世界/存档的「当前情境标签」含该标签时激活 | 多重人格按情境触发 |
| `"npc:__player__"`（可选扩展） | 特指与玩家对话时 | 多数情况用 `default` 即可 |

情境标签示例：`alone_night` / `combat` / `secret_revealed` / `public` / `trial`。

### 3.3 与现有字段的关系

- 现有单值 `personality` / `voice` / `attitude` **保留为基线**：无 modes 时直接使用；有 modes 时作为 `default` 切面缺省值来源。
- 若某 mode 的 `traits` / `voice` 为空 → **从基线继承**（避免重复填）。
- `untouchable` 跨所有切面统一生效，**不进 mode**。
- `relationship` 仍只记「与主角关系」（切面只改语气/态度表达，不改关系数值）。

### 3.4 归一化（承接 docs/70 已修的数据坑）

- 在 `store.js:ensureWorldCharacters`（加载兜底）对每个 character 确保 `personality_modes` 为数组；每个 mode 的 `traits` / `voice` 归一为**字符串**（数组 → 顿号串，对齐刚修的 `personality` 规范），杜绝「种子世界用数组、编辑器用字符串」的二态坑。
- 归一函数**直接复用**刚写的 `personality` 字符串归一逻辑处理 `mode.traits` / `mode.voice`。
- 种子世界 `new-worlds.js` 可示范给 1–2 个角色定义 modes（如给某角色加 `npc:宿敌` 切面），便于实测。

---

## 4. 守门逻辑

### 4.1 切面选择（运行时）

输入：当前交互对象（来自 `present_npcs` / 玩家对话的 addressee）+ 当前活跃情境标签（来自 `S` 情境状态）。

1. 收集命中切面：遍历 `personality_modes`，`context` 匹配 active context 者入候选。
2. 命中多个 → 取 `priority` 最大者；平局取数组先出现者。
3. 无命中 → 取 `context:"default"` 切面；再无 → 用基线单值 `personality` / `voice`。

选定切面 = 本回合该角色的「生效锚点」。

### 4.2 OOC 判定（核心）

- 计算该角色的**允许空间** = 所有已定义切面（含基线）的 `traits` + `voice` + `untouchable` 的**并集**。
- 生成该角色台词/行为后对照允许空间：
  - 落在某个已定义切面内 → **通过**；
  - 落到并集之外（如平时冷峻的人突然热情洋溢且无任何切面定义此态）→ **OOC**。
- **关键**：切面之间切换（常态 ↔ 面具 ↔ alter）**不算 OOC**；只有越出并集才算。

> 判定方式说明：因 LLM 自由文本硬解析不可靠，建议采用「**生成前指令约束 + 事后抽检**」而非逐句解析。即守门主要作为 prompt 硬规则（让模型自检是否越界），辅以可选的轻量关键词异常检测，不做脆弱的全文语义判定。

### 4.3 玩家校准闭环（适配多切面）

- 玩家指出「X 人设崩 / OOC / 不像他」→ 引擎识别角色 + 触发重锚（见第 7 节）。
- 重锚指令内容：
  > 下一轮请让 X 严格保持在其【已定义切面】之内；切面切换允许，但不得超出并集。上一轮明显越界处可于本轮以 X 自身口吻轻微回调，**不改写已存档历史**。
- 多切面下，重锚**不锁定某一切面**，只要求「回到并集内」。若玩家点名具体情境（「你对马尔福不该那么客气」），可额外 pin 到 `npc:马尔福` 切面。

---

## 5. 运行时上下文来源

- **当前交互对象**：引擎已有 `present_npcs`（在场角色）与玩家对话对象信号；取「本回合正在回应的 NPC / 玩家对话目标」作为 `npc:` 匹配源。
- **情境标签**：建议新增轻量 `S.situation_tags`（字符串数组），或由现有 `status_effects` 派生；世界/事件可写入（如进入战斗置 `combat`）。守门读取活跃标签匹配 `situation:` 切面。
- ⚠️ 待确认：情境标签的**写入机制**（事件引擎自动？创作者手动？从 `status_effects` 派生？）属独立设计点，需另议。

---

## 6. Prompt 注入设计

- `buildCharactersContext`（`prompt.js:621`）扩展：若角色有 `personality_modes`，注入每个切面的 `context → traits/voice` 映射，并加规则：
  > 当情境命中 X 时，切换到该切面；OOC 判定以【所有已定义切面并集】为准，切面间切换允许。
- 复用字段名（`traits` 来自 `personality` 规范、`voice` 来自 `voice` 规范）→ 缓存友好，不破坏 system 前缀结构。
- `untouchable` 仍单独强调「跨切面一律禁区」。

---

## 7. 玩家校准触发（B + C 组合）

| 方案 | 做法 | 优劣 |
|---|---|---|
| **B 关键词触发** | `game.js` 玩家输入处理位检测 `OOC\|人设崩\|不像他\|说话方式不对\|人设偏离` → 下一轮 `buildAuthorNote` 塞一次性重锚 note（与 docs/70 的 `random_event` 注入位同构） | 精准、省 token；中文表述有漏检 |
| **C UI 按钮** | 状态面板加「人设校准」按钮，点击强制下一轮重锚 | 最稳、玩家可控；需加 UI |

- 两者汇入同一份重锚指令；识别目标角色 = 当前 active context 的角色。
- 推荐默认走 B 软触发，同时给 C 按钮让玩家主动「拉回人设」。

---

## 8. 编码落点建议（待确认后做）

| 文件 | 改动 |
|---|---|
| `src/store.js` `ensureWorldCharacters` | 归一 `personality_modes`（数组 + 每 mode 的 traits/voice 字符串归一） |
| `src/prompt.js` `buildCharactersContext` | 注入切面映射 + 守门规则 |
| `src/prompt.js`（新增 gate 函数） | `selectActiveFacet(char, ctx)` + 轻量 `isOOC` 抽检（建议指令约束为主，不做脆弱全文解析） |
| `src/game.js` | 玩家输入关键词检测 + 重锚 note 注入（同 `random_event` 注入位） |
| `src/new-worlds.js` | 示范 1–2 个角色定义 modes |
| `test/` | mode 归一单测 + 切面选择单测 + 守门不误判切换的单测 |

---

## 9. 守卫与兜底（G1–G8）

- **G1** 无 `personality_modes` → 完全回退基线，守门按单值（向后兼容）。
- **G2** mode `traits` / `voice` 为空 → 继承基线（不显示 `undefined`）。
- **G3** `context` 无匹配且无 `default` → 回退基线单值。
- **G4** `priority` 平局 → 数组先现者胜（确定性）。
- **G5** 同角色 `mode.id` 重复 → 后者覆盖前者（归一时去重）。
- **G6** `untouchable` 跨切面强制生效。
- **G7** 情境标签缺失/异常 → 视为无 situation 上下文，仅按 `npc:` / `default` 匹配。
- **G8** 玩家校准识别失败（无法确定角色）→ 不注入重锚，静默降级（不误伤）。

---

## 10. 与数据坑修复的关系

- 已在 docs/70 迭代把 `personality` 归一为单值顿号串（`store.js` + `llm.js` + `new-worlds.js`）。
- facet 支持是**新增字段** `personality_modes`，与单值基线**互不冲突、可叠加**；先修坑不影响后续加 facet。
- 归一函数可直接复用刚写的 `personality` 字符串归一逻辑处理 `mode.traits` / `mode.voice`。

---

## 11. 待确认项

1. 情境标签 `S.situation_tags` 的**写入机制**（事件引擎 / 手动 / 从 `status_effects` 派生）？
2. `is_alter` 真·多重人格的「切换触发」是否需剧情标志驱动（如 flag 触发 alter 登场），还是纯情境？
3. 玩家校准是否本迭代就要（含 UI 按钮 C），还是先只做 B 关键词？
4. 是否需要在角色编辑器里提供 `personality_modes` 的图形化编辑界面？

---

## 12. 一句话总结

OOC 守门从「锁死唯一人格」升级为「允许人格白名单」：角色可在已定义的多个切面（对不同人、不同情境）间自由切换而不被误判，只有越出并集才纠偏；数据上新增可选 `personality_modes` 数组、与现有单值基线叠加兼容，归一逻辑复用刚修的 `personality` 字符串规范。

---

## 13. 实现状态（2026-08-08 落地）

黎总确认 4 项决策：①按推荐做 ②切换触发条件（npc:/situation:）都支持 ③含 UI 按钮 ④需图形化编辑界面。已按推荐方案全部实现并通过验证。

**改动落点（与第 8 节一致）**
- `src/store.js` `ensureWorldCharacters`：加载兜底归一 `personality_modes`（数组/字符串→顿号串、非法项过滤、补 id、is_alter/priority 兜底）；`defaultCharacter` 加 `personality_modes: []`。
- `src/llm.js` `generateCharacters`：AI 生成角色时归一 `personality_modes`（可选返回）。
- `src/prompt.js`：
  - `buildCharactersContext` 注入切面映射块 + 「OOC = 言行落到所有切面并集之外；切面切换合法；不可触碰设定跨切面生效」硬规则（缓存友好）。
  - 新增纯函数 `selectActiveFacet(char, ctx)`（default 权重 -1 恒低于具体切面；npc:/situation: 按 present_npcs / situationTags / focusNpc 匹配；priority 大者胜）、`detectOocCorrection(input, world)`、`buildOocReanchorNote(charName)`、`consumeOocReanchor()`。
  - `buildAuthorNote` 中部每轮位消费 `S.oocReanchor` 注入一次性重锚指令（与 `random_event` 同构）。
- `src/utils.js` `defaultInitialState`：新增 `situation_tags: []`。
- `src/game.js`：
  - `applyTagOpTo`（纯函数，抽出 situation/present/tags 增量运算，便于单测）；`applyStateChanges` 复用。
  - `submitInput` 玩家输入关键词检测 → 置 `S.oocReanchor`；导出 `requestOocReanchor()`（状态面板按钮用）。
- `src/render.js` `renderStatusTabs`：状态面板加「🎭 人设校准」按钮（data-action=requestOocReanchor）。
- `src/lore-editors.js`：人物卡图形化编辑切面（renderModesHtml + syncCharacterForm 回填 + addCharMode/delCharMode + saveCharacterReview 清洗）。
- `src/app.js`：补 import + ACTIONS（`requestOocReanchor` / `addCharMode` / `delCharMode`）。
- `styles.css`：`.char-modes` / `.mode-row` / `.status-reanchor-btn` 样式。
- `test/71-situational-personality.test.js`：17 项单测（归一 / 切面选择 / 校准检测 / 重锚指令 / 守门注入 / situation_tags 运算）。

**验证**：`syntax_check` / `verify-modules` / `load-check` 全过；`node --test test/*.test.js` **776 项全绿**（原 759 + 新增 17，无回归）。`check:browser` 需无头浏览器，本沙箱无环境未跑。

**创作者用法**
- 角色卡编辑器 → 每张角色卡底部「多重人格 / 情境切面」→ ＋添加切面：选 `default` / `npc:<角色名>` / `situation:<标签>`，填性格/声音/态度，勾选真·多重人格。保存即生效，叙事 prompt 自动注入守门规则。
- 玩家游玩时：输入"X 人设崩了"或点状态面板「🎭 人设校准」，下一回合该角色回到已定义切面并集内（不删历史）。
- 事件/世界可通过 `state_changes.situation_tags:{add:["combat"]}` 设置情境标签，驱动 `situation:` 切面。

## 14. AI 生成角色自动产出 modes（2026-08-08 补充）

黎总要求：AI 生成角色时自动产出 `personality_modes`，且**原作/IP 类世界要深挖原作真实表现**给 NPC 补精准切面。

**改动落点（`src/llm.js`）**
- 新增 `CHARACTER_MODES_INSTRUCTION`（切面 schema，所有世界通用、按"看情况"产出、不硬凑）。
- 新增 `ipFacetInstruction(ipName)`：含 `ip_name` 的 IP/同人世界追加「原作考据要求」——严格依据《原作名》真实性格，分析知名角色面对不同对象/情境的真实差异，写成可溯源的 `npc:/situation:` 切面，禁止杜撰相悖人格。
- 抽出可测的 `buildCharacterSystemPrompt(world)`：基础 + 切面 schema +（IP 时）原作考据；`generateCharacters` 改用它，并 `maxTokens` 1500→2200 防切面 JSON 截断。
- `parseCharacters` 此前已实现 `personality_modes` 归一（数组/字符串→顿号串、context 缺省 default、is_alter/priority 兜底、补 id）。

**覆盖路径**：角色卡编辑器「AI 生成」按钮（`generateCharactersAI`→`generateCharacters`）与建世界向导「AI 完善」共用 `generateCharacters`，一次改动两端生效。

**验证**：`test/72-ai-character-modes.test.js` 5 项（prompt 始终含 schema / IP 世界含原作考据并写入作品名 / 原创世界不含考据 / parseCharacters 完整解析含 is_alter·priority / 无 modes 归一为 []）；全套 **781 项全绿**（776 + 5），无回归。
