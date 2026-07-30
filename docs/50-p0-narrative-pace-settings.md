# P0 方案：叙事节奏 / 中文叙事字数 / 阅读速度 可调

> 状态：**方案待确认**（未改任何代码）。对齐用户原话：
> 「叙事节奏和中文叙事字数可游玩中途改，文字展示与阅读速度可在设置界面改」

---

## 0. 目标（对齐你的原话）

| 你要的能力 | 要求 | 本方案落点 |
|---|---|---|
| 叙事节奏（紧凑/标准/舒缓） | 可游玩中途改 | 游戏设置弹窗 + 每轮 prompt 注入 |
| 中文叙事字数（简略/适中/详尽） | 可游玩中途改 | 游戏设置弹窗 + 每轮 prompt 注入 |
| 文字展示与阅读速度（慢/标准/快/瞬显） | 可在设置界面改 | 选项页 + 游戏设置弹窗 |

**默认全为「标准」= 与今天行为完全一致（零回归）。**

---

## 1. 现状（为什么值得做）

- **字数/篇幅**：游戏内叙事当前**没有显式中文字数约束**。篇幅由 `data/system_prompt_template.md:41-59` 的「展开/推进/加速」段隐式控制（AI 按场景**自动选**，非玩家可调）。唯一的显式"200-500字"只在建世界的开场白（`src/prompt.js:138`），与回合无关。
- **打字机**：已有（`src/render.js:1361 startTypewriter`），但延迟**全部硬编码**（base 12ms / 句号 70 / 逗号 35 / 换行 45 / 引号 25），无速度设置。
- **流式**：默认走流式，文本随 token 到达逐块显示（`src/render.js:1323 updateLiveNarrative`），无节流/节奏控制。
- **设置 UI**：只有字体大小、知识库确认等（`index.html:80-112` 选项页 / `index.html:879-895` 游戏设置弹窗），没有这三项。

---

## 2. 三个新设置项（数据模型）

沿用 `fontSize` 的范式：放 **localStorage**，作为全局 UI 偏好，**不改存档结构、不碰 IndexedDB 配置**。

| localStorage 键 | 状态字段 (S.*) | 取值 | 默认 |
|---|---|---|---|
| `aigame_pacing` | `narrativePacing` | `compact` / `standard` / `relaxed` | `standard` |
| `aigame_narrlen` | `narrativeLength` | `short` / `standard` / `long` | `standard` |
| `aigame_readspeed` | `readingSpeed` | `slow` / `standard` / `fast` / `instant` | `standard` |

语义：
- **叙事节奏**：`compact`=紧凑（推进为主、信息密度高、少环境铺陈）；`standard`=平衡（维持现状模板逻辑）；`relaxed`=舒缓（增加环境与心理描写）。
- **中文叙事字数**：`short`≈150字 / `standard`=不硬性限制（保持现状）/ `long`≈500字。
- **阅读速度**：`slow` / `standard` / `fast` / `instant`（瞬显=直接出定稿，跳过打字机）。

> **零回归关键**：`standard` 默认值**不向 prompt 注入任何额外指令、不改动打字机延迟**。所以开箱行为与今天完全相同；只有玩家主动切到非标准档才生效。

---

## 3. 生成端：节奏+字数怎么进 prompt（中途改 → 下一回合即时生效）

**注入位置选 `buildAuthorNote()`（`src/prompt.js:1018`）**——它是每回合重建的「中部导演提示」消息（`src/llm.js:620-636`，role=system 的 `# 剧情导演提示（作者注）`），**不走 system 缓存**。因此中途改设置，下一回合生成自动带上新值，**无需 `invalidateSystemPromptCache()`**，也不破 DeepSeek 前缀缓存。

新增纯函数 **`buildNarrativeControlNote()`**（prompt.js，可单测），在 `buildAuthorNote()` 末尾 `parts.push(...)` 合并：
- `pacing=compact` → 追加「以推进模式为主，信息密度高，减少环境铺陈」。
- `pacing=relaxed` → 追加「可适当增加环境与心理描写，节奏舒缓」。
- `length=short` → 追加「每轮中文叙事控制在约150字以内，精炼」。
- `length=long` → 追加「每轮中文叙事可展开至约500字，充分描写」。
- 两者为 `standard` 时**不追加**（保持现状，零回归）。

---

## 4. 展示端：阅读速度改打字机 + 流式节流（立即生效）

### 4.1 非流式打字机（`src/render.js:1361-1402`）
抽出纯函数 **`getTypingDelays(level)`** 返回延迟表：
```
slow:     { base:28, sentence:160, comma:80, newline:100, quote:55 }
standard: { base:12, sentence:70,  comma:35, newline:45,  quote:25 }  // = 现状硬编码值
fast:     { base:6,  sentence:32,  comma:16, newline:22,  quote:12 }
instant:  null  // 跳过打字机，直接 finishTyping() 定稿
```
`startTypewriter` 的 `delay` 改为 `getTypingDelays(S.readingSpeed)[...]`；`instant` 时直接定稿不走逐字。**每次 tick 实时读 `S.readingSpeed`**，所以正在打的字也会立刻变快/变慢。

### 4.2 流式节流（`src/render.js:1323 updateLiveNarrative`）
抽出纯函数 **`getStreamThrottleMs(level)`**：`slow`=120ms，其余=0（立即，=现状）。
在 `updateLiveNarrative` 内：若 throttle>0，累积文本、仅当距上次绘制 ≥ throttle 才 repaint（模块级记 `lastPaint` 时间戳）；`instant/fast/standard` 仍即时。这样慢速下流式也有「逐句浮现」的阅读节奏，且不改默认行为。

---

## 5. UI 控件放哪

- **游戏设置弹窗**（`index.html:886-890` gameSettingsModal）：新增 3 行分段按钮（叙事节奏 / 中文叙事字数 / 阅读速度），复用与字体大小相同的 `.font-size-btn` 分段样式（`index.html:91-93`）。这是「游玩中途」可调入口。
- **选项页**（`index.html:88-110` settingsScreen）：额外放「阅读速度」一行，明确满足「可在设置界面改」。
- `src/app.js:129` 的 `ACTIONS` 注册：`changeNarrativePacing` / `changeNarrativeLength` / `changeReadingSpeed`，仿 `changeFontSize`（`src/theme.js:235`）。
- 实现函数放 `src/theme.js`（与 `changeFontSize` 同处）：写 localStorage + 更新按钮 active 态。

---

## 6. 涉及文件清单

| 文件 | 改动 |
|---|---|
| `src/store.js:35-66` | `S` 对象加 3 个默认值（localStorage 读取） |
| `src/theme.js` | 加 `changeNarrativePacing/Length/ReadingSpeed` + 按钮态更新（仿 `changeFontSize`） |
| `src/prompt.js:1018` `buildAuthorNote` | 末尾合并 `buildNarrativeControlNote()` |
| `src/prompt.js` | 新增导出纯函数 `buildNarrativeControlNote()` |
| `src/render.js:1361` `startTypewriter` | `delay` 取自 `getTypingDelays(S.readingSpeed)`；`instant` 走定稿 |
| `src/render.js:1323` `updateLiveNarrative` | 按 `getStreamThrottleMs` 节流 |
| `src/render.js` | 新增导出纯函数 `getTypingDelays` / `getStreamThrottleMs` |
| `index.html:886` `gameSettingsModal` | 加 3 行分段控件 |
| `index.html:88` `settingsScreen` | 加「阅读速度」一行 |
| `src/app.js:129` `ACTIONS` | 注册 3 个 action |
| `styles.css` | 复用现有分段样式，基本无需新增 |
| `test/50-narrative-pace.test.js` | 新增（见下） |

---

## 7. 测试计划（沿用 `node --test`，当前 456 项全绿）

- `buildNarrativeControlNote`：每个 pacing/length 组合返回预期中文指令串（含 `standard` 不追加）。
- `getTypingDelays`：`slow/standard/fast` 返回正确表，`instant` 返回 `null`。
- `getStreamThrottleMs`：`slow`=120，其余=0。
- 设置函数：`changeNarrativePacing` 等写入 `S` + localStorage、更新按钮态。
- 集成：`buildAuthorNote` 在 non-standard 时包含控制指令。
- 跑 `npm test` + `npm run verify`，确保 456→新增全绿、无回归。

---

## 8. 待你确认的几点（不影响方案主线）

1. **阅读速度是否也放进游戏设置弹窗**（中途可改）？我建议放（更顺手）；但你说"在设置界面改"，若只放选项页也行。
2. **叙事字数预设数值**：简略≈150 / 标准=不限 / 详尽≈500，是否认可？还是要自由滑块（min-max 字数）？
3. **叙事节奏预设名**：紧凑/标准/舒缓，OK 吗？
4. 是否需要把「叙事节奏/字数」也镜像到主选项页（目前只计划放游戏设置弹窗）？

**确认范围后我按上面的文件清单动手写代码。**
