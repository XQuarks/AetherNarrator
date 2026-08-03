# 56 · 按剧情进度解锁 lore（隐形门禁）方案

> 状态：方案草稿，待黎总确认范围后实施
> 日期：2026-08-03
> 关联：rag.js 的 timeline 分阶段门禁（已有的 `order ≤ story_progress`）、`story_progress` 进度指针、抽书流程（game.js Plan A）

## 1. 背景与问题

把整本小说（如《三体》全本 88 万字）导入后，项目会 AI 分块抽取成几百~上千条结构化 lore 卡片（人物/地点/事件/设定）。这些卡片**覆盖全书**，结局相关设定（宇宙归零、程心、二向箔、降维打击）必然被抽进知识库。

当前注入机制（`rag.js`）是**每回合按需检索**：常驻 `always` 类 + 关键词/向量命中的 `keyword` 类 top5。问题在于——普通 lore 卡片**没有"进度锁"**。如果一条结局卡片的触发词是"黑暗森林""三体危机"这种全书贯穿的概念，玩家在**第一卷**聊到这些词，它就可能被检索出来，**提前剧透**结局。

已有的 `story_progress` 进度指针（单向只增，AI 每轮推进）目前只用于"时间线分段文本"的 `order ≤ story_progress` 门禁（`rag.js::unlockedTimelineSegments`）。本方案把它复用为"剧情阶段指针"，给普通 lore 卡片也加上同一套门禁。

## 2. 目标与不变量

- **目标**：让后期/结局设定不会在玩家尚未推进到对应剧情阶段时冒出，从根上防剧透。
- **核心不变量：不破坏沉浸感**。
  - 完全隐形：不弹"内容未解锁"、不做任何 meta 提示。
  - 不卡流程：该聊的照样聊，AI 基于"角色当前已知"回应。
  - 提前问到后期概念 → 因卡片不在召回池，AI 自然回避/模糊，反而强化代入。
- **向后兼容**：老存档/老 lore 缺 `unlock_stage` 字段时，默认 `1`（全程可用，不锁）。

## 3. 方案概述（已与黎总确认 4 项取舍）

| 取舍 | 决策 |
|---|---|
| 进度轴 | 复用现有 `story_progress`（改造成"剧情阶段 1..N"），不新增存储 |
| 阶段粒度 | 粗粒度剧情阶段（如三体分 5-6 段：红岸/危机/面壁/威慑/广播/归零） |
| 阶段来源 | AI 抽书时自动给每条 lore 标 `unlock_stage`；抽完作者可在编辑器校正 |
| 玩家可见 | 完全隐形，无 UI；阶段标签仅在世界书编辑器（作者端）可见 |

机制一句话：**lore 卡片加 `unlock_stage` → 复用 `story_progress` 当当前阶段 → 每回合门禁「stage > 当前进度 则剔除，且不提示」→ 抽书时 AI 自动标注阶段，结局卡片自然落到后期。**

## 4. 数据模型改动

### 4.1 lore 卡片（snippet）新增字段
```js
{
  id, category, title, content,
  keywords: [], activation_keys: [],
  trigger_mode: "keyword",   // always 仍常驻（见 §6 门禁豁免说明）
  scan_depth: 1, priority: 0,
  insert_at: "before_user", insert_depth: 1,
  unlock_stage: 1            // ★ 新增：1=全程可用；>1=需推进到该阶段才注入
}
```
- 默认值：`1`（缺字段/老存档 → 不锁）。
- 落地位置：`src/lore-ui.js::addLoreEntry` 默认结构、`src/utils.js` 的 lore sanitize 兜底（缺则补 `1`）。

### 4.2 世界配置新增（可选，用于阶段刻度对齐）
```js
world.lore_stage_count = 6;                 // 阶段总数 K（抽书首段由 AI 定，或按卷/部）
world.lore_stage_labels = ["红岸","危机","面壁","威慑","广播","归零"]; // 仅作者端展示
```
- 缺省时不限制（门禁仍按 `unlock_stage` 绝对值生效；`story_progress` 上限 clamp 用到此值）。

## 5. 抽书时自动标注（AI）

- **入口**：`src/llm.js::buildLoreChunkPrompt`（逐块抽 lore）+ `callWorldGenerationLLM` 首段（定基础结构）。
- **增强点**：
  1. 在 lore 输出 schema 里增加 `unlock_stage`（整数 1..K），并说明语义："该设定首次在剧情中被触及的阶段；结局/后期设定标高值"。
  2. 首段生成时让 AI 输出 `lore_stage_count` 与 `lore_stage_labels`（阶段主题），写入 world 配置。
- **AI 自由度**：AI 负责把结局相关卡片标到高 stage（如 5/6），基础设定标 1。
- **校正**：抽完后作者在"知识库初览"里可按阶段查看分布并手改（`lore-ui.js`）。

## 6. 门禁实现（rag.js）

位置：复用现有 B1 触发门禁循环（`rag.js` 约 498-513 行，遍历 `merged` 对每个 snippet 调 `isLoreTriggered` 那段）。在 `isLoreTriggered` 之前/之内加一步：

```js
const curStage = (S.gameState && typeof S.gameState.story_progress === "number")
  ? S.gameState.story_progress : 1;
// ★ 隐形进度门禁：未到阶段的 lore 直接剔除，不给任何提示
const stage = (typeof snip.unlock_stage === "number") ? snip.unlock_stage : 1;
if (stage > curStage) { merged.delete(key); continue; }
```

- **关于 `always` 类**：统一受门禁约束——只要 `unlock_stage > 当前进度` 就锁（包含 always）。理由：一致性更好、防剧透更彻底；抽书时基础法则类会被标 `1`（不锁），作者也可对任意卡片设阶段。
- **无提示**：仅从召回池删除，不写 toast、不写 prompt 注释、不暴露"锁定"语义——满足沉浸不变量。
- **性能**：纯数值比较，召回后过滤，零额外开销。

## 7. 编辑器（lore-ui.js）

- 在 lore 编辑表单加 `unlock_stage` 数字输入（min=1，max=world.lore_stage_count 或 10），默认 1；同步 `le_depth_` 那套 `on(input)` 绑定模式。
- "知识库初览"面板：可按阶段（1..K）折叠展示卡片数（作者可见，便于发现"全堆在后期"等分布异常）。

## 8. story_progress 刻度对齐（关键工程点）

门禁要准，必须保证 `story_progress` 与 `unlock_stage` **同一刻度**：

1. **上限 clamp**：`src/game.js`（约 703 行 `story_progress` 更新处）与 `src/utils.js`（sanitize）把 `story_progress` 限制在 `[1, world.lore_stage_count]`（有配置时），避免 AI 给超出 K 的值导致门禁失效。
2. **AI 推进指令**：在 system / 给 AI 的回合指令里说明——若本世界有 `lore_stage_count`，推进 `story_progress` 时用 1..K 刻度，对应剧情阶段（而非自由大数）。
3. **漂移兜底**：即使 AI 偶尔标错 stage，作者在编辑器可手改；门禁基于绝对值，不依赖 AI 当轮精确度。

## 9. 不破坏沉浸感的保证（小结）

- 无 UI、无提示、无 meta 文案。
- 提前触达后期概念 → 卡片不在池 → AI 以"当前认知"回避，符合叙事。
- 若该聊的被误锁 → 作者可在编辑器把对应卡片 `unlock_stage` 调回 1，零代码。

## 10. 边界与风险

| 风险 | 缓解 |
|---|---|
| AI 阶段标注漂移（K 与 story_progress 不对齐） | §8 上限 clamp + 作者校正；门禁按绝对值 |
| 老存档/老 lore 缺字段 | 默认 `unlock_stage=1`（不锁），向后兼容 |
| 基础法则类被误锁导致 AI "不知道规则" | 抽书时基础类标 1；作者可改 |
| 性能 | 召回后纯数值过滤，无影响 |

## 11. 涉及文件清单

- `src/rag.js` — 门禁逻辑（核心改动）
- `src/llm.js` — 抽书 prompt 增强（输出 `unlock_stage` + 首段定 `lore_stage_count/labels`）
- `src/lore-ui.js` — 编辑器字段 + 默认结构 + 初览按阶段展示
- `src/utils.js` — lore sanitize 兜底 `unlock_stage=1`；`story_progress` 上限 clamp
- `src/game.js` — `story_progress` 上限 clamp 到 `lore_stage_count`
- `src/prompt.js` —（可选）system 指令说明阶段刻度
- `test/` — 新增门禁单测 + 抽书 schema 校验

## 12. 测试要点

- 门禁纯函数：`unlock_stage > story_progress` → 剔除；`<=` → 保留；缺字段 → 保留（默认 1）。
- 抽书 mock：AI 输出含 `unlock_stage` 且 ∈ [1, K]。
- 回归：`npm test` 全绿（s6 时间系统、world-tags-ai、multiverse 等不受影响）。

## 13. 实施步骤（待确认后）

1. 数据模型：utils/lore-ui 加 `unlock_stage`（默认 1）。
2. rag.js 门禁（隐形剔除）。
3. game.js/utils 的 `story_progress` 上限 clamp。
4. llm.js 抽书 prompt 增强（自动标阶段 + 首段定 K）。
5. lore-ui 编辑器字段 + 初览按阶段。
6. 测试 + 全量回归。
7. 在 demo（克苏鲁/三体类全书世界）验证结局卡片确实被推到后期且前期不剧透。
