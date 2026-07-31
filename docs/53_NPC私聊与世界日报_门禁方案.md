# 53 · NPC 私聊 / 世界日报 —— 世界状态门禁方案

> 状态：**范围待黎总确认，未动代码**（按"先方案 → 确认 → 才动代码"规矩）
> 日期：2026-07-31
> 关联：C1 模块化世界开关（`docs/47`）、B2 体力 / B3 背包 / B4 好感度、时间系统、events 支线事件

---

## 1. 背景与目标

黎总提出两个能显著提升"世界是活的"的功能：

- **NPC 私聊**：玩家与目标 NPC 一对一私下对话，是人物卡(B1)/好感度(B4)最自然的出口，也是"跑团式自由输入"的落点。
- **世界日报**：每天一份世界动态汇总，让玩家不在场时世界仍在运转；天然复用 events 支线事件 + 时间系统。

核心矛盾：**沉浸感**。若任何时候都能私聊/看报，会破坏"我被关在地牢、无魔法无科技、周围无人"等情境的真实感。

设计目标：两个功能**做成可选项 + 由世界状态判定能否使用**，且判定**不写死为"隔离/信号"**，可覆盖空间/社会/魔法/时间/关系等几十种情形，最终可**交给 AI 自己判断**。

---

## 2. 设计原则（已与黎总拍板）

1. **沉浸优先**：功能不可用时的反馈必须是"叙事化拒绝"，而非错误框/置灰按钮；拒绝本身应成为剧情。
2. **选项化**：玩家可在设置里彻底关闭任一功能（纯净模式）。
3. **动态渠道**：联系方式与日报获取形式**不固定**。玩家可在世界设定里自选；也可由系统按世界类型/时代/魔法科技水平**按当前情境动态提供**。
4. **现代魔法世界允许用手机**：渠道判定看"这场景能否用此渠道"，不是"渠道古不古风"。
5. **AI 主裁判**：情形列不完，故除"明显不可能"的硬预筛外，其余交给 AI 综合判定并生成叙事化拒绝理由。

---

## 3. 功能范围

| 功能 | 是什么 | 触发方式 | 默认 |
|------|--------|----------|------|
| NPC 私聊 | 与目标 NPC 1v1 私下对话，结果写回记忆(B6)与好感度(B4) | 玩家对在场/可达 NPC 发起 | 模块默认开 |
| 世界日报 | 当日世界动态汇总（头条+小道消息），可挂 side_events 引支线 | 玩家主动点"今日动态"（建议主动，非强制） | 模块默认开 |

两者职责分离：日报=广播世界大事；私聊=1v1 关系/情报。

---

## 4. 两层门禁模型

### 4.1 第一层：全局开关（= C1 模块开关）
复用现有 `world.modules` 注册表（`src/modules.js`）。新增两个模块即等于"全局开关"，创作者/玩家可在世界模块页签勾选。

- `world.modules.npc_chat.enabled`
- `world.modules.world_daily.enabled`

关闭 → 功能在界面**完全不存在**（纯净模式）。此层为免费确定性规则，零 AI 调用。

### 4.2 第二层：世界状态门禁（混合架构，见第 5 节）
开关开启后，每次使用仍需判定"当下世界是否允许"。

---

## 5. 混合门禁架构（核心）

```
玩家请求(私聊/日报)
   │
   ▼
[硬预筛 · 免费确定性规则]  ──否──▶ 直接拒绝(叙事)
   │ 是
   ▼
[AI 判定 · 读取世界状态 flags]  ──否──▶ 叙事化拒绝(理由由 AI 生成)
   │ 是
   ▼
沉浸式呈现(用该渠道联络/取报)
```

### 5.1 硬预筛（只挡"明显不可能"，不浪费 AI 调用）
- 对应模块未启用（`isModuleEnabled(world,'npc_chat'|'world_daily')` 为 false）。
- 目标 NPC 不存在 / 已死亡 / 已"下线"（暂离、失踪）。
- 玩家手上**零可用渠道**（既无玩家自选也无系统可提供的任何渠道）。
- 处于强制过场中（模态打开 / `S.enteringSideEvent` 进行中 / 主线锁）。

### 5.2 AI 判定（其余一切）
把"世界状态 flags"喂给 LLM，返回结构化判定。

**输入（给 AI 的上下文）**
- 世界设定摘要（类型 `world.type`、时代、魔法/科技水平）。
- 当前场景描述（`gameState.current_location` + 近期叙事上下文）。
- 玩家状态（背包 B3、体力 B2、变量、当前状态效果如"被绑/封口"）。
- 目标 NPC 状态（在场？睡眠？好感度 B4？是否共享联系方式？）。
- 世界约束（来自知识库 lore 事实：审查/魔法压制/宵禁/位面屏障/诅咒等）。
- 可用渠道集合（玩家自选 + 系统情境提供，见第 6 节）。
- 请求动作（私聊 X / 取今日日报）。

**输出 schema（JSON）**
```json
{
  "allowed": true | false,
  "channel": "手机推送" | "双面镜" | null,
  "reason": "（denied 时）一句第二人称、当下时的叙事化拒绝，需贴合世界、不剧透、不出现'功能/系统'等元词汇"
}
```

**判定 prompt 要点**
- 用第二人称、现在时，落进世界观语气。
- 拒绝必须是一段"剧情"而非"报错"：如"你摸出手机，屏幕漆黑——这里没有一丝信号，也没有魔法的微光"。
- **严禁剧透**：不得借拒绝泄露隐藏剧情/未触发事件。
- 允许时给出所用 `channel`，供渲染层做沉浸 framing。

### 5.3 世界状态 flags 采集（映射现有系统，纯函数）

| flag | 来源（现有系统） |
|------|------------------|
| `time_of_day`（时段） | 时间系统 `current_date` → 推导 早/午/晚/夜 |
| `location` | `gameState.current_location` |
| `inventory_channels` | `gameState.inventory`（带 `tag:'contact'` 或 `is_key` 的渠道物） |
| `affinity` | `gameState.bonds[npc].affinity`（B4） |
| `stamina` | `gameState.variables.stamina`（B2） |
| `world_constraints` | 知识库 lore 事实 / 世界设定（审查/魔法压制/宵禁/位面屏障/诅咒） |
| `story_lock` | `S.enteringSideEvent` / 模态打开 / 主线锁 |
| `npc_state` | `present_npcs` / 近期叙事（在场/睡眠/可达） |

采集器 `collectCommFlags(world, gameState, scene)` 返回上述对象，喂给 AI 判定与硬预筛共用。

---

## 6. 动态渠道系统

渠道**不写死**。两个来源汇成"可用渠道集合"：

### 6.1 玩家自选（`world.contact_channels`）
世界设定/高级设置里，创作者或玩家声明本世界的联络方式，受世界设定约束。
```json
// world.contact_channels 示例
[
  { "id":"phone", "name":"手机", "kind":"tech",
    "requires": { "world_flags": ["tech_allowed"] } },
  { "id":"patronus", "name":"守护神传信", "kind":"magic",
    "requires": { "world_flags": ["magic_allowed"] } },
  { "id":"raven", "name":"信鸦", "kind":"physical",
    "requires": { "item_id": "raven" } }
]
```
在中世纪无科技世界选"手机"会因 `requires.world_flags` 不满足被门禁卡掉。

### 6.2 系统按情境提供（`suggestChannels(world, scene)`）
依据 `world.type`（original/fan/ip/shared/public_domain）、时代、魔法/科技水平，运行时生成当前合适渠道：
- 酒馆场景 → "酒保低声递来的传单"
- 现代公寓 → "手机弹出的推送"
- 中世纪营地 → "信使 / 篝火边的传令"

系统提供的渠道不落库，按场景动态生成；玩家满意后可"固化"为自选渠道（顺便进背包 B3）。

### 6.3 NPC 联系方式 consent
私聊需对方"给过联系方式"。存于 `gameState.bonds[npc].shared_contacts`（channel id 列表）；AI 判定时校验"该渠道双方都有"。陌生人或未互给联系方式 → 拒接（叙事化：对方不认识你的联络方式）。

---

## 7. 叙事化拒绝（呈现方式）

- **硬预筛拒绝 / 全局关闭**：入口本就不存在，无需拒绝文本。
- **AI 拒绝**：把 `reason` 作为**一条普通叙事日志**注入正文流（非弹窗、非 toast），读起来就是剧情延续。例：
  > "你想传讯给海格，却记起他此刻正在禁林深处；而周遭的反魔法屏障，让任何呼唤都沉入寂静。"
- 若玩家主动点已开启功能的入口但被拒，入口可见、点击得叙事行——避免"有个功能我不能用"的元认知破框。

---

## 8. 数据模型与存储（落点）

### 8.1 新增模块（`src/modules.js` · MODULE_REGISTRY）
```js
{ id:"npc_chat",  name:"NPC 私聊",  desc:"与目标 NPC 一对一私下对话", defaultEnabled:true, statusTab:"relations",
  promptFragment:()=>"【NPC 私聊】玩家可就在场/可达且已共享联系方式的 NPC 发起私下对话，对话影响好感与记忆。" },
{ id:"world_daily", name:"世界日报", desc:"每日世界动态汇总，可引支线", defaultEnabled:true, statusTab:"timeline",
  promptFragment:()=>"【世界日报】本世界每日可获取一份世界动态，汇总头条与传闻，可能牵引支线。" }
```
（沿用 `defaultModules` / `isModuleEnabled` / `sanitizeModules` 现有机制，旧世界读档自动补默认。）

### 8.2 世界级设置
- `world.comm_gate_mode`：`'ai'`（默认）| `'rules'`（纯规则、不调 AI）。
- `world.contact_channels`：玩家自选渠道数组（见 6.1）。

### 8.3 运行时 / 玩家级
- `gameState.bonds[npc].shared_contacts`：已共享渠道 id 列表（私聊 consent）。
- `gameState.comm_cache`：场景状态哈希 → 判定结果缓存（见 9.2）。

### 8.4 新增文件（实施期才建）
- `src/comm-gate.js`：硬预筛 + AI 判定 + flags 采集 + 缓存。
- `src/comm-channels.js`：`suggestChannels` + 渠道校验。
- `test/53-comm-gate.test.js`：预筛/AI 判定/缓存/渠道校验。

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| AI 调用成本/延迟 | 按"场景状态哈希"缓存判定（`comm_cache`），世界状态未变不重判；硬预筛先挡大半；`comm_gate_mode:'rules'` 供零调用偏好 |
| AI 判定前后不一致 | flags 确定性事实入 prompt 当锚；缓存降低重复判定；拒绝文案本就允许变化，读作剧情无碍 |
| AI 拒绝时剧透隐藏剧情 | prompt 明确禁止借拒绝泄露未触发事件/隐藏设定 |
| AI 太松/太严 | 判定 prompt 给正/反例；`comm_gate_mode` 可在规则档兜底 |
| 渠道与世界设定冲突 | 玩家自选受 `requires` 约束；系统提供渠道依世界类型生成 |
| 私聊刷屏破坏节奏 | 建议消耗体力(B2)/时间（复用 events 的 `cost_stamina`），限频 |

---

## 10. 与现有系统对接表

| 现有系统 | 在本方案中的角色 |
|----------|------------------|
| C1 `world.modules`（`src/modules.js`） | 全局开关 = 两功能模块 |
| 时间系统 `current_date` | 推导 `time_of_day` 时段 flag |
| `gameState.current_location` / `revealed_locations` | 位置 flag、日报投递可达性 |
| B2 体力 `variables.stamina` | 私聊/日报消耗的体力门槛 |
| B3 背包 `inventory` | 实体渠道物（双面镜/信鸦）即物品；系统渠道可固化入包 |
| B4 好感度 `bonds[x].affinity` | 私聊好感度门槛；`shared_contacts` 存 consent |
| events 支线 + `S.enteringSideEvent` | 日报头条挂 side_events；`story_lock` 防过场中联络 |
| 知识库 lore 事实 | `world_constraints`（审查/魔法压制等）来源 |
| B6 关键事实 | 私聊产生的承诺/情报晋升，主线可读回 |
| `world.type` 枚举 | 系统提供渠道的世界适配依据 |

---

## 11. 实施分期（仅计划，确认后才动代码）

- **Phase 0 · 数据模型**：`modules.js` 加两模块；`world.comm_gate_mode` / `world.contact_channels` 默认与迁移兜底；`bonds.shared_contacts` 读档兼容。
- **Phase 1 · flags 采集**：`collectCommFlags()` 从现有系统抽 8 类 flag。
- **Phase 2 · 门禁引擎**：`comm-gate.js` 硬预筛 + AI 判定（扩展 `llm.js` 判定 prompt）+ 场景哈希缓存。
- **Phase 3 · 动态渠道 + 呈现**：`comm-channels.js` 玩家自选/系统建议 + 叙事化拒绝注入正文流 + UI 入口（私聊上下文菜单 / 日报"今日动态"）+ 设置页（模块勾选 + 判定模式 + 渠道编辑）。
- **Phase 4 · 测试**：`test/53` 覆盖预筛/AI 判定/缓存/渠道校验/旧档兼容。

---

## 12. 待黎总确认的问题

1. 两个功能**默认开**还是**默认关**？（建议默认开，纯净模式玩家可关）
2. 判定模式**默认 AI** 还是**默认纯规则**？（建议默认 AI）
3. 私聊/日报是否**消耗体力(B2)或时间**防刷？（建议消耗，复用 events 机制）
4. 日报**主动点"今日动态"** 还是**每天开局自动一拍**？（建议主动点，更可控、不强行打断）
5. 系统提供的情境渠道，玩家满意后能否**固化**为自选渠道并入库(B3)？（建议允许）
6. 范围确认后，按 Phase 0→4 开工，还是先排期？

> 黎总确认以上范围（尤其 1–5）后，再进入代码实施。
