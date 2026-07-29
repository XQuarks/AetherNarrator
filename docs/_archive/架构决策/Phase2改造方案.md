# Phase 2 改造方案：规则 DSL 引擎【✅ 已落地 · 2026-07-20】

> 配套规划：`docs/架构评估与方案脑暴.md` 第三节「Phase 2 — 规则 DSL 引擎」。
> 目标：把写死在 `worldview.js` + `bannedConcepts` 里的世界硬规则，升级成**普通人能在界面上配置的规则 DSL**，创作者（黎总）不碰代码即可定义"如果…就…"的世界规则。
> 前置：Phase 0 / Phase 1 已落地。本方案**不兼容旧存档/世界**（规划前提），但**当前代码里的默认世界（`bannedConcepts` 词表）必须继续正常工作**——这是"当前数据"不是"旧存档"，不能破坏。
> 范围（黎总已确认）：**完整 v1** = 概念/状态/标签三类条件 + 禁词/标签/结局三类动作。

---

## 一、现在规则是怎么写死的（现状体检）

当前世界只有**一种**规则能力：**禁用概念词表**。

- 数据在 `src/store.js` 的 `DEFAULT_BANNED_CONCEPTS`（手机/电脑/汽车/枪…共 40+ 条），世界可覆盖为 `world.bannedConcepts`。
- 每条形如 `{ concept:"手机", unlockTags:["modern_unlock"], severity:"soft" }`——"出现现代科技词就拦，除非某标签解锁"。
- 执行在 `src/worldview.js`：`findWorldviewViolations(text, rules, activeTags)` 扫 AI 输出文本，`filterStateChangesByWorldview` 过滤状态变更。
- 解锁标签来自 `getActiveConditionTags()`：背包物品 tags + 在场角色 `char:姓名` + 显式 `gameState.tags`。
- 总开关 `plot_freedom >= 4` 时直接放行（守卫放宽）。

**痛点**：
1. 规则只有"禁词"一种，不能表达"金币<0 禁止购买""角色死亡→结局"这类逻辑。
2. 词表写死在 `store.js` 代码里，黎总改不了，想加一条禁用词得找我改代码。
3. 没有编辑界面。

---

## 二、DSL 设计（大白话）

一条规则 = **「如果（条件 when）就（动作 then）」**，外加开关与强度：

```json
{
  "id": "rule_xxx",
  "name": "禁止现代科技",
  "enabled": true,
  "when":  { "type": "concept", "term": "手机", "unlessTags": ["modern_unlock"] },
  "then":  { "type": "ban", "concept": "手机", "aliases": ["智能手机"], "severity": "soft" }
}
```

### 条件 when（v1 支持 3 类，全部有真实引擎钩子）
| type | 含义 | 字段 | 例子 |
|---|---|---|---|
| `concept` | 文本里出现某词（用于禁词） | `term`, `unlessTags` | 出现"手机"且未解锁 modern |
| `state` | 游戏状态数值满足比较 | `field`, `op`(`<`/`<=`/`==`/`>=`/`>`), `value` | `gold < 0` / `is_alive == false` |
| `tag` | 某条件标签处于活跃 | `tag` | `char:王二` 在场 |

> 文档示例"角色死亡→结局"用 `when:{type:"state",field:"is_alive",op:"==",value:false}` 表达，无需另建事件系统。

### 动作 then（v1 支持 3 类，全部有真实引擎钩子）
| type | 含义 | 字段 | 引擎落点（真实存在） |
|---|---|---|---|
| `ban` | 禁止某概念出现在 AI 输出 | `concept`, `aliases[]`, `severity`(soft/hard), `unlessTags[]` | `worldview.js` 世界观守卫（现有） |
| `tag` | 设置/解锁一个条件标签 | `op`(`add`/`remove`), `tag` | `gameState.tags`（现有） |
| `ending` | 触发游戏结束（结局） | `reason` | `render.js: showGameOver(reason)`（现有钩子） |

### 不在 v1 范围（避免凭空承诺）
- `then: deny`（阻止"购买"等游戏动作）：当前引擎**没有正式的动作系统**（无 buy/attack 等可拦截入口），落地需先建动作总线，属独立增量，本期不做。
- `when: event`（叙事事件匹配）：v1 用 `state`/`tag` 条件已能覆盖"死亡→结局"等核心场景；纯叙事事件匹配（如"说出了秘密"）留作后续，本期不接。

---

## 三、解释器怎么接引擎（关键设计）

新增 **`evaluateRules(world, gameState)`**（在 `worldview.js`）：

```
输入：world.rules（DSL 数组）+ 当前 gameState
输出：{
  bannedConcepts: [{concept, aliases, severity, unlessTags}],  // 喂给现有守卫
  tagOps:         [{op, tag}],                                  // 应用到 gameState.tags
  endings:        [{reason, ruleId}]                            // 非空则触发 showGameOver
}
```

- 遍历 `world.rules`，跳过 `enabled:false`；对每条按 `when.type` 求值，命中才收集 `then` 到对应槽。
- **向后兼容默认世界**：`getBannedConceptRules()` 改为——若 `world.rules` 存在且含 `ban` 类规则则用 DSL；否则回退读 `world.bannedConcepts`（默认世界继续工作，零改动）。
- **game.js 调用点零改动**：`findWorldviewViolations` / `filterStateChangesByWorldview` 的对外签名保持不变，内部改从 `evaluateRules` 取禁用概念。
- **`ending` 接线**：在 `processTurn` 应用 AI 状态变更后调 `evaluateRules`；若 `endings` 非空 → `showGameOver(reason)`（复用现有死亡结局弹窗）。`tagOps` 同步写回 `gameState.tags`。

---

## 四、可视化编辑界面（黎总用的部分）

- **入口**：世界详情弹窗（`render.js`）加一个「世界规则」按钮 → 打开 `openRuleEditor(worldId)` 新弹窗。
- **规则列表**：显示每条规则的「名称 / 条件摘要 / 动作摘要 / 启用开关 / 删除」。
- **新增/编辑表单**（纯下拉+填空，无代码）：
  1. 选条件类型（概念/状态/标签）→ 动态显示对应字段；
  2. 选动作类型（禁词/标签/结局）→ 动态显示对应字段；
  3. 填名称、severity；
  4. 保存写回 `world.rules`，存 IndexedDB。
- **老世界升级**：打开无 `rules` 但有 `bannedConcepts` 的世界时，列表顶部显示一键「把现有禁用词表转为可编辑规则」按钮（非破坏，可取消）。

---

## 五、逐文件改动清单

| 文件 | 改动 |
|------|------|
| `src/worldview.js` | 新增 `evaluateRules(world, gameState)`；`findWorldviewViolations`/`filterStateChangesByWorldview` 内部改读 DSL（签名不变）；保留 `getBannedConceptRules` 兼容回退（放 `store.js` 或本文件） |
| `src/store.js` | 世界 schema 加 `rules: []`；`getBannedConceptRules()` 优先 DSL、回退 `bannedConcepts`；导出 `DEFAULT_RULES`（空） |
| `src/game.js` | `processTurn` 应用状态变更后调 `evaluateRules`：写 `tagOps` 到 `gameState.tags`，`endings` 非空则 `showGameOver`；其余调用点零改动 |
| `src/lore-ui.js` | 新增 `openRuleEditor` / `addRule` / `deleteRule` / `saveRuleReview`（规则编辑弹窗与读写） |
| `src/render.js` | 世界详情弹窗加「世界规则」按钮 + 规则编辑弹窗 DOM |
| `index.html` | 若有需要加规则弹窗容器（或复用现有 modal 体系） |
| `test/worldview-dsl.test.js`（**新增**） | DSL 解释执行：concept/state/tag 三类条件求值；ban/tag/ending 三类动作；severity 区分；enabled 开关；与旧 `bannedConcepts` 兼容；`ending` 触发判定 |

---

## 六、验证（✅ 已通过）

- `npm run verify` 全过（语法 / 模块图 / 加载 18/18 / 测试 **50/50** 含新增 11 项 DSL 测试 / 浏览器烟雾测试 3 次连跑全绿，无 `includes` 运行时报错）。
- DSL 单元测试（`test/worldview-dsl.test.js`，11 项全过）：concept/state/tag 三类条件求值；ban/tag/ending 三类动作；severity 区分；enabled 开关；与旧 `bannedConcepts` 兼容；ending 触发判定。
- 浏览器实测（真实 Edge）：世界详情页 / 开始游戏 / 规则编辑器三流程均无 pageerror（仅 CSP 字体警告，无功能影响）。
- 回归：默认世界（仅 `bannedConcepts`、无 `rules`）进入游戏，现代科技词仍被正确拦截（兼容路径）；旧世界（IndexedDB 无 `rules` 字段）打开规则编辑器自动补 `rules: []`，不崩。

---

## 七、风险与缓解

- **低–中（DSL 解析需测试覆盖）** → 已配 `test/worldview-dsl.test.js` 全覆盖；`evaluateRules` 纯函数易测。
- **默认世界回归** → 靠「无 `rules` 则回退 `bannedConcepts`」保证零破坏；测试含兼容用例。
- **黎总改错规则导致世界不可玩** → `severity: soft` 仅提示不阻断；`enabled` 开关可随时关；`ending` 规则只接真实状态判定，不会因 AI 幻觉误触发。

---

## 八、与初版方案（脑暴文档）的差异说明

- 脑暴文档示例写 `{when:{event:"death",target:"$char"}, then:{trigger:"ending"}}`，并说"worldview.js 改为解释执行 DSL"。
- 实际落地修正为：**`when` 用 `state`/`concept`/`tag` 三类具体条件**（不引入未实现的 `event` 类型），**`then` 用 `ban`/`tag`/`ending` 三类真实钩子动作**（不含未实现的 `deny`）。这样每条规则都接得住真实引擎，不画饼。
- `ending` 真实落点是 `showGameOver()`；原 `game_over_conditions`（schema 里的提示文案）**不改动、不被求值**，避免与 DSL 重复。

---

## 九、范围确认点（黎总已确认：完整 v1，均已落地）

1. **v1 动作集**：`ban` / `tag` / `ending` 三类（有真实钩子）。**`deny`（阻止动作）本期不做**（引擎无动作系统，避免画饼）。
2. **条件集**：`concept` / `state` / `tag` 三类，已落地。
3. **老世界升级**：「一键把禁用词表转规则」按钮（`importLegacyBans`）已落地，非自动、可取消（写回前 `S._ruleImportedLegacy` 标记，仅影响草稿）。

> 黎总确认范围后已按本方案落地。改动文件见「五、逐文件改动清单」，未碰任何未授权文件。
