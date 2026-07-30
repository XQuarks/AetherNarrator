# 对标 UU Game：事件卡面板 + 支线体力 — 方案（docs/51）

> 状态：**仅方案，未改代码**。等黎总确认范围与决策点后再动手。
> 对标来源：桌面「对标游玩参考 / 对标创作参考」里的 UU Game（移动端 AI 文字冒险）。

---

## 1. 对标分析：UU Game 这套机制是什么

UU Game 的游玩节奏是「**主线面板 + 支线事件卡 + 体力消耗 + 时间推进**」：

- 玩家每轮除了看主线剧情，还会看到 **2~3 张「支线事件卡」**（标题 + 一句话描述 + 体力消耗 + 时间消耗）。
- 点一张卡 = 进入那个支线：扣体力、推进时间，AI 现场生成该支线剧情。
- 体力（行动力）是**稀缺资源**，做完支线会消耗，过段时间/过天会回复；这制造了「先做哪个」的取舍和节奏感。
- 主线仍是持续面板（当前处境/状态），支线是可选项，二者分离。

**对 AetherNarrator 的价值**：我们现在的游玩流是「单条流水叙事 + 自由输入」，玩家有时会「不知道该干嘛」。事件卡给自由输入一个**结构化引导**（AI 主动提议可做的事），体力则提供**资源约束与回合节奏**——这正是我们对标 UU 最该学的一点。

---

## 2. 现状盘点：我们的地基已经很强

探查代码后确认，这套机制**大部分地基已经现成**，不用从零造：

| 需要的机制 | 现有实现 | 落点 |
|-----------|---------|------|
| AI 结构化返回（含选项） | `apply_turn_state` 工具，已返回 `choices` 数组 | `src/llm.js:388` |
| 结构化数组先例 | `predict_branches`（走向前瞻）已返回 `branches[]` | `src/llm.js:454` |
| 玩家变量（数值/展示/AI 可消费） | **B2 玩家变量**：状态面板自动展示、AI 经 `state_changes.variables` 消费、存档自动持久化 | `src/store.js` / `src/render.js:1016` |
| 时间推进 | 每回合 AI 返回 `current_date`，`advanceWorldTime` 推进 | `src/game.js:697` |
| 前瞻/状态弹窗先例 | `status-panel-overlay` modal + 状态面板 | `index.html:227` |
| 变量编辑器（创作者加「体力」） | 已有「理智/金钱/体力」示例提示 | `src/lore-editors.js:563` |

**缺口只有三处**：① 没有「支线事件候选」的产出通道；② 没有「体力」资源与消耗/回复引擎；③ 没有事件卡 UI。

---

## 3. 推荐方案（MVP，全部落在现有范式内）

### 3.1 数据模型（零新存储）

- **体力 = 一个 B2 世界变量 `stamina`**（`type:"number"`, `min:0`, `max:100`, `default:100`）。
  - 创作者可在变量编辑器直接加（lore-editors 已把「体力」当作示例）。
  - 自动获得：状态面板「变量」页签展示、AI 经 `state_changes.variables` 感知、存档随 `gameState` 自动持久化。
- **支线事件候选 = AI 在 `apply_turn_state` 返回的新字段**：
  `side_events: [{ title, desc, cost_stamina, cost_time, tag }]`

### 3.2 模块开关（保证不打扰不想用的世界）

- 新增 `events` 模块（沿用 C1 的 Registry 模式，现有 13 模块 + 此 = 14）。
- 默认开；创作者可关。
- **关闭时**：不向 AI 请求 `side_events`、不显示「支线」按钮/面板、不跑体力回复 → 对不想用的世界零影响。
- 开启 `events` 时，若世界还没有 `stamina` 变量，**自动补一个默认 `stamina`**（min0/max100/默认100），把两者绑一起。

### 3.3 产出通道（prompt + 工具 schema）

- `src/llm.js`（约 `:403` 后）：`apply_turn_state.properties` 增加
  ```js
  side_events: { type:"array", items:{ type:"object", additionalProperties:true, properties:{
      title:{type:"string"}, desc:{type:"string"},
      cost_stamina:{type:"number"}, cost_time:{type:"string"}, tag:{type:"string"} } } }
  ```
- `src/prompt.js`（`buildAuthorNote`，约 `:1060` 后）：仅当 `events` 模块开启时，向中部每轮重建位追加一段指令——「在合适时机（当前无强主线推进时）额外返回 2~3 个支线事件候选，每张含标题、一句话描述、体力消耗、时间消耗」。
  - 放中部每轮重建位，**不破坏 system 前缀缓存**（与 P0 的叙事控制指令同位置，已验证安全）。

### 3.4 引擎逻辑（`src/game.js`）

- **提取候选**：`processTurn` 在 `finalChoices = resp.choices`（`game.js:1231`）附近，提取
  `S.pendingSideEvents = resp.side_events || []`，并存 `pendingEntry.sideEvents` 以便回看。
- **体力消耗**：点击进入事件时，先判 `variables.stamina >= cost_stamina`，**不足则 toast 拦截、不消耗回合**；通过则在 `applyStateChanges(resp.state_changes)`（`game.js:1042`）套用后扣减：
  ```js
  s.variables = computeVariableUpdates({ stamina: s.variables.stamina - cost }, world, s.variables).next;
  ```
  ⚠️ **坑**：`computeVariableUpdates` 收的是**绝对值不是增量**（传 -10 会直接设成 -10 再夹取），所以要先算 `cur - cost` 再传。它自动按 schema 夹到 `[0,100]`。
- **跨天回复**：`applyStateChanges` 时间推进后（`game.js:709` 后，复用已有的 `prevActiveDate` 快照），若「天」前进则回复体力：
  ```js
  const days = dayAdvanced(prevActiveDate, s.current_date);  // day 模式比 day，dated 模式用 calendarDayIndex
  if (days > 0) s.variables = computeVariableUpdates({ stamina: s.variables.stamina + days*REGEN }, world, s.variables).next;
  ```
  `REGEN` 默认 30/天（放常量，或写进变量 schema 备注）。`none` 时间模式（无"天"概念）不回复。

### 3.5 UI（`index.html` + `render.js` + `styles.css`）

- **按钮**：`player-tools`（`index.html:207` 附近）加「🎴 支线」，`data-action="showEventPanel"`，仅 `events` 模块开时显示。
- **面板**：仿 `status-panel-overlay` 做一个 modal，列出 `S.pendingSideEvents` 为卡片（标题 + 描述 + 「体力 N · 时间 N」角标 + 进入按钮）。
- **进入事件**：点卡片 → 体力校验 → 把「（主动触发支线：标题）」填入输入框并**自动提交**（走正常 `processTurn`，事件叙事仍是一次普通回合，复用 P0 的打字机/阅读速度）。
- **体力展示**：B2 变量自动在状态面板「变量」页签显示进度条；事件卡角标直接显示消耗。
- **不改布局**：MVP 走 modal，**不动 `.game-body` 单列布局**，零布局风险。

### 3.6 不需要改的

- 存档逻辑（整体序列化 `gameState`，新增字段自动持久化，旧档 `undefined` 兜底，不破坏兼容）。
- 时间显示、主线叙事流（事件进入 = 一次普通 `processTurn`，叙事渲染与 P0 节奏控制完全复用）。
- `migrations.js`（项目前提「新版不兼容旧档」，但新增字段有默认值兜底，实际安全）。

---

## 4. 改动文件清单（精确到插入点）

| 文件 | 改动 | 插入点 |
|------|------|--------|
| `src/llm.js` | `apply_turn_state` 加 `side_events` 字段 | `:403` 后 |
| `src/prompt.js` | `buildAuthorNote` 加 events 指令（gated） | `:1060` 后 |
| `src/game.js` | 提取 `side_events`；体力扣减；跨天回复 | `:1042` 后 / `:709` 后 / `:1231` 后 |
| `src/render.js` | 新增 `renderEventPanel(events)` | 邻近 `renderChoices` |
| `index.html` | `player-tools` 加「🎴 支线」按钮 + 事件面板 modal | `:207` 附近 / 仿 `:227` |
| `styles.css` | `.event-panel` / `.event-card` 样式 | 邻近 `.status-panel` |
| `src/modules.js` | 注册 `events` 模块 | 现有 13 模块处 |
| `src/lore-editors.js` | 模块开关 UI + 开启时补默认 `stamina` | 模块开关区 |
| `src/app.js` | 注册 `showEventPanel` / `enterSideEvent` action | ACTIONS 表 |
| `test/51-event-card-stamina.test.js` | 新增测试 | 新建 |

> 若走「体力 = 通用 `gameState` 字段」备选（见 D1），则需额外在 `src/utils.js:248` 附近加 `stamina/maxStamina`，`store.js` 不用动（已自动序列化）；但推荐走 B2 变量，故默认不列。

---

## 5. 验证计划

- 新增 `test/51-event-card-stamina.test.js`：
  - `side_events` 能从 `resp` 正确提取；`events` 模块关时不提取。
  - 体力不足 → 进入被拦截（不扣减、不推进）。
  - 体力扣减正确夹取到 `[0,100]`（用 `computeVariableUpdates` 绝对值语义）。
  - 跨天 → 体力按 `REGEN` 回复并夹取上限。
  - `events` 模块关时 `buildAuthorNote` 不注入事件指令、`applyStateChanges` 不跑回复。
- 跑 `npm test` 全绿；再**本机** `npm run verify`（含浏览器冒烟，事件面板点击交互）。

---

## 6. 风险与决策点（需黎总拍板）

- **D1 体力存哪**：① B2 世界变量 `stamina`（**推荐**：模块化、AI 可感知、状态面板自动展示、按世界可选）② 通用 `gameState` 字段（更简单、但强制所有世界都有体力）。
- **D2 进入事件是否自动提交**：① **自动提交**（点卡即开始，顺滑）② 仅填输入框、等玩家点发送（与现有选项行为一致）。
- **D3 时间消耗 `cost_time`**：① 仅作 UI 提示 + 给 AI 的软指令（**推荐**，避免和 AI 自身的时间推进重复计算）② 引擎硬推进（更可控但易和 AI 推进双算）。
- **D4 事件候选频率**：① 每回合 AI 顺带返回（**推荐**，零额外调用、还顺带充当「可选项」引导）② 手动「🔄 刷新支线」按钮另发一次前瞻式调用。
- **D5 面板形态**：① modal 弹窗（**推荐 MVP**，零布局风险）② 常驻右侧栏（更"面板化"但需改 `.game-body` 布局）。

---

## 7. 与已做 P0 的衔接

P0 的「叙事节奏 / 中文叙事字数 / 阅读速度」**完全不受影响**——事件卡进入后仍是一次普通 `processTurn`，叙事走同一渲染与打字机/阅读速度逻辑。本功能只新增「支线引导 + 体力约束」两层。
