# Phase 5 工具调用约束 + L2 分层缓存 · 方案文档

> 来源：docs/架构评估与方案脑暴.md §三 Phase 5（L123–128）+ docs/34 §2.4（状态 ⬜）。
> 约束（来自 docs/架构评估）：本项目纯前端、零后端、可离线；Phase 5 为**稳健性 + 省 token**优化，风险低。
> 创建：2026-07-28。按项目规矩（docs/21 第 56 行 / UI-1 / A3 同款）：**先出方案 → 确认范围 → 才动代码**。本文件即方案，待用户确认范围后实施。
> 兼容性：本改动只动 LLM 调用 / 解析 / 提示词缓存结构，**不改 schema、不改存档、不改引擎**，对旧存档与世界无影响（反而更稳）。

---

## 一、目标

两件事绑成一个 Phase（同类优化：让 AI 调用更稳、更省）：

1. **工具调用约束（function calling 结构化返回）**：让 AI 按"提前定好的参数格式"返回结构化状态，从源头消除脆弱的 JSON 容错解析链，把"解析失败"打到底。
2. **L2 分层缓存**：把"角色卡"从当前 system 单缓存段里拆出来，设独立缓存断点，让角色卡与世界规则/知识库分段缓存，降 token、稳住大世界前缀缓存。

---

## 二、现状（已具备，需升级的地方有代码证据）

### 2.1 工具调用约束现状

| 环节 | 位置 | 现状 |
|---|---|---|
| 主回合入口 | `src/llm.js:416` `callLLM` | 走 `callLLMStreaming` / `callLLMNonStreaming` |
| 请求体已约束 | `src/providers.js` L22–113（6 预设 `buildBody`） | **已带** `response_format: { type: "json_object" }` —— 即 API 层面已要求"只返回 JSON" |
| 非流式解析 | `src/llm.js:501` → `src/utils.js:497` `parseResponse` | 去 ``` 围栏 → 正则截取 `{...}` → `JSON.parse` → 失败 `tryRepairJSON` 补括号 → 再失败 **throw** |
| 流式解析 | `src/llm.js:520` `callLLMStreaming` + `extractPartialNarrative` | 实时抽 narrative 显示；最终仍要解析整段 JSON |
| 解析失败重试 | `src/game.js:837` `callTurnLLMWithRetry` | 捕获 /JSON 解析失败 结构化损坏 截断/ 后最多**重试 2 次**（最坏 3 次 API 调用才肯放弃） |
| 其它结构化解析 | `src/llm.js:829` `parseJsonLoose` | 一致性包 / 角色卡 / Critic / B 系列等多处复用同一"三段兜底链"（直接 parse → 正则截取 → tryRepairJSON） |

**结论**：主回合**已经是半约束**（json_object），但代码**仍跑完整兜底链**，因为 json_object 不保证 100% 合法 JSON（模型仍可能包 markdown、流式截断、偶发畸形）。兜底链脆弱，且失败会触发重试**白烧 token**。

### 2.2 L2 缓存现状

| 环节 | 位置 | 现状 |
|---|---|---|
| system 单一缓存 | `src/prompt.js:207` `buildSystemPrompt`（L221 `cachedSystemPrompt` 前缀缓存） | 同一世界内整套 system（规则 + 知识库 + 角色卡 + 主角）拼成**一个**缓存串，只有 **L1 单个缓存断点** |
| 角色卡注入 | `src/prompt.js:322` `buildCharactersContext` → L323 拼进 systemPrompt | 角色卡与世界规则/知识库**混在同一缓存段** |

**结论**：角色卡变化频率极低（只在你编辑角色时才变），却被绑在会随知识库/规则变动的 L1 段里。编辑知识库会让整段缓存失效、角色卡也被迫重发。缺少独立的 L2（角色卡）缓存断点。

---

## 三、设计

### 3.1 工具调用约束（核心逻辑）

**现在**：AI 返回的是 `message.content` 里的一段**文本**，代码自己 `JSON.parse` + 正则 + 补括号去救。
**改后**：请求里**事先声明一个工具**（如 `apply_turn_state`），把参数 schema 定死——`narrative`（剧情）/ `state_changes`（状态变化）/ `choices`（选项）。AI 改为**调用这个工具**，模型方（DeepSeek / OpenAI 兼容）直接返回**已解析好的参数对象**，代码一句话 `args.narrative` 取到，**不再碰字符串解析**。

等于从"让 AI 写作文、你拿红笔改错别字" → "给 AI 一张填报表、它只能往格子里填"。

- **主回合**：`callLLM` 调用时传入 `tools` 定义；`callLLMNonStreaming` / `callLLMStreaming` 从 `message.tool_calls[].function.arguments` 取对象，不再走 `parseResponse` 兜底链。
- **其它结构化返回**（一致性包 / 角色卡 / Critic / B 系列）：同样从 `parseJsonLoose` 兜底链迁到 function calling（范围见第六节）。
- **失败处理**：schema 不符合由 API 层保证（不符则返回 API 错误而非畸形字符串）；彻底失败不再"正则猜补"，直接报错 → `callTurnLLMWithRetry` 仍保留（但触发频率趋近 0，重试烧 token 基本消失）。

### 3.2 流式 vs 体验（关键权衡，需用户拍板）

主回合当前是**流式**（AI 边生成边在屏幕上打字，体感好）。function calling 下参数以 `tool_calls` 形式返回，OpenAI 兼容 API **支持流式 tool_calls**（参数片段随 SSE 累积），但需改 `extractPartialNarrative`：从累积的 `tool_calls` 参数里实时抽 `narrative` 显示。两种落地方式：

- **保体验（推荐）**：流式下从 `tool_calls` 参数实时抽 narrative，保留打字机效果。改动大一点（流式解析要适配 tool_calls 累积）。
- **最简（非流式）**：主回合改用非流式 function calling，整段生成完才显示，最简单最稳，但失去实时打字。

### 3.3 L2 分层缓存（逻辑）

把角色卡从 L1 单缓存段拆出，作为**独立缓存断点**：

- 在 `buildSystemPrompt` 里，把 `buildCharactersContext` 产出的角色卡块，**单独成一个 message（或独立缓存标记段）**，与世界规则/知识库段分开。
- 效果：编辑知识库/规则 → 只 bust 对应段缓存；角色卡段因低频变化而**长期命中**，每回合少发角色卡 token、大世界下 system 前缀更稳。
- 依赖模型前缀缓存（DeepSeek 支持；本地 `none` 策略不缓存，自动跳过，无副作用）。

### 3.4 模拟模式 / 多模型兼容

- **模拟模式**：`mockLLM` 本就直接返回结构化对象，function-calling 分支下保持一致即可（mock 不调 API，无需 tools）。
- **模型支持**：6 预设均为 OpenAI 兼容（含 `/v1/chat/completions`），原生支持 tools；**Claude(Anthropic) 不支持**（docs/34 ❓3 已登记，需独立分支，待产品确认是否纳入）。

---

## 四、接线点 / 影响文件

| 文件 | 改动 |
|---|---|
| `src/llm.js` | `callLLM` 传 tools 定义；`callLLMNonStreaming` / `callLLMStreaming` 从 `tool_calls` 取参数（替代 `parseResponse` 兜底链）；`extractPartialNarrative` 适配 tool_calls 流式累积（保体验方案） |
| `src/prompt.js` | 抽角色卡为独立缓存段（L2）；可选集中管理 tools 的 schema 常量 |
| `src/providers.js` | `buildBody` 支持传出 `tools`（当前只传 `response_format`）；Claude 分支待 ❓3 拍板 |
| `src/utils.js` | `parseResponse` 主回合路径可废弃或仅留非流式兜底；`parseJsonLoose` 视范围逐步退场 |
| `src/game.js` | `callTurnLLMWithRetry` 重试逻辑保留但触发率趋零；mock 路径对齐 |
| `test/37-*.test.js` | ① 工具定义 schema 校验；② 从 tool_calls 取参数等价旧 `resp`；③ 流式 tool_calls 累积抽 narrative；④ L2 缓存段独立（角色卡变更不 bust 规则段） |

**不改动**：schema、存档结构、引擎、任何持久化逻辑；对旧存档/世界无影响。

---

## 五、验证

- `npm run check:syntax && npm run check:modules && npm test`（新增 37 单测全绿）
- 结构化输出成功率统计（对比改造前后 `callTurnLLMWithRetry` 重试触发率，应趋零）
- token 监控对比（`S.lastCacheStats` / `logTurnStats` 看角色卡独立缓存后命中率与总量）
- 浏览器烟雾：`tools/_ui_capture.mjs` 跑通主回合 + 角色卡编辑段
- 手测：开模拟模式跑一局（验 mock 路径）；接真实 API 跑一局（验 tools 返回 + 流式打字保体验与否）

---

## 六、范围选项（待用户确认）

| 方案 | 工具调用约束 | L2 缓存 | 工作量 | 体验影响 |
|---|---|---|---|---|
| **A（推荐）** | 主回合 + 关键结构化返回（一致性包/角色卡/Critic/B 系列）全迁 function calling；**流式下从 tool_calls 实时抽 narrative，保留打字机** | 角色卡拆独立缓存断点 | 中 | 保体验 + 更稳 + 更省 token |
| **B** | 仅主故事回合迁 function calling，且**用非流式**（最简，去掉 `parseResponse` 兜底链与重试烧 token）；其余结构化解析暂保留 | 同 A | 小 | 失去实时打字（整段生成完才显示） |
| **C** | A + 把所有 LLM 结构化返回**统一收口到一个集中 tools 层**（tools schema 集中管理、所有调用走同一套取参逻辑） | 角色卡 + 知识库硬约束都拆独立缓存断点 | 大 | 最彻底、最一致 |

> 建议选 **A**：性价比最高，既从源头消除解析失败、又保留打字机体验、还顺手省 token。若想最快见效、能接受暂时失去实时打字，选 B。若想一劳永逸统一所有结构化返回，选 C。
> 另外：L2 缓存相对独立，若只想先稳输出、缓存稍后做，可在确认时说明「先做工具调用约束、L2 缓存单列」。
> 确认后实施，并同步 docs/34（Phase 5 行 → ✅ + 更新日志）、docs/架构评估与方案脑暴.md（Phase 5 → ✅）。

---

## 实施状态：✅ 已实施（方案 C，2026-07-28）

用户于规划阶段选择 **方案 C**（A + 集中 tools 层 + 知识库硬约束也拆独立缓存断点）。全部落地，未动 schema / 存档 / 引擎。

### 代码改动
- **`src/providers.js`**：新增共享 `buildChatBody(model, messages, {temperature, maxTokens, tool})`；6 预设 `buildBody` 统一收口——传 `tool` 时输出 `tools` + `tool_choice`，否则回退 `response_format: {type:"json_object"}`（向后兼容）。
- **`src/llm.js`**：
  - 新增集中 **`TOOLS` 注册表**（7 个工具：`apply_turn_state` / `generate_world` / `extract_lore_chunk` / `consistency_pack` / `character_cards` / `worldview_judge` / `lore_revision`），全部 `additionalProperties:true` 宽松 schema。
  - 新增统一入口 **`callStructured(messages, toolName, {stream, onPartial, temperature, maxTokens, mockFn})`**：mock 模式直接返回 `mockFn()`；否则走 `callLLMStreaming` / `callLLMNonStreaming`，从 `tool_calls[].function.arguments` 取参，回退 `parseResponse`（提供方不守 tools 也稳）。
  - 新增 `extractStructuredFromMessage` / `extractStructuredFromArgs`（导出，供测试）做取参与兜底修复。
  - `callLLM` 主回合改走 `callStructured("apply_turn_state", {stream:true})`，**流式打字机保留**（`onPartial(fullArgs)` → `extractPartialNarrative` 实时抽 narrative）。
  - 一致性包 / 角色卡 / 世界观裁判 / B5 知识库修订 / Critic 审稿 全部迁到 `callStructured` + 对应 tool；删除冗余 `callLLMJson`。
  - 修复历史遗留 bug：`callLLMStreaming` 重复声明 `provider`（参数已传，移除冗余 `const provider = getProvider()`）。
- **`src/prompt.js`**：`buildSystemPrompt` 拆为 **L1 core** + 两独立缓存断点 **`buildCharactersBreakpoint()`（角色卡）** + **`buildLoreHardBreakpoint()`（知识库硬约束）**；`invalidateSystemPromptCache` 一并清三段，并新增 `invalidateCharactersCache()` / `invalidateLoreHardCache()`（L2 窄失效）。
- **接线（`src/lore-editors.js` / `src/lore-ui.js` / `src/critic.js`）**：角色卡编辑→`invalidateCharactersCache`；知识库编辑（B5 修订 / Critic 采纳 / 手动保存 / 源文档补抽）→`invalidateLoreHardCache`。**顺带修复三处历史 bug**：Critic 采纳、手动知识库保存、源文档补抽此前均未失效系统缓存，会导致知识库硬约束段陈旧——现统一窄失效。
- **`src/store.js`**：新增 `cachedCharactersPrompt` / `cachedLoreHardPrompt` 及其 worldId 字段。

### 缓存顺序（L2 生效关键）
`callLLM` 组装消息顺序：`L1 core → 角色卡段 → 知识库硬约束段 → 历史 → 检索 → 作者注 → user`。
角色卡段排在知识段**之前**，故编辑知识库只 bust 知识段缓存，角色卡前缀缓存长期命中（提供方前缀缓存按消息内容命中；结构上即生效，与 JS 窄失效无关）。`none` 策略（本地模型）不缓存、每轮重建，无副作用。

### 验证结果
- `npm run check:syntax` ✅ / `npm run check:modules` ✅
- `npm test`：**409/409 全绿**（较改造前 393 +16，新增 `test/37-phase5-tools.test.js` 16 项）
- `npm run verify`（含浏览器烟雾）✅
- 覆盖点：TOOLS schema 校验、tool_calls 非流式取参、流式累积 arguments 取参、兜底回退、callStructured 集中调度（mock 按 toolName 分发 + 未知工具抛错）、L2 两段独立缓存命中与窄失效、callLLM mock 端到端跑通、L1 core 不再含角色/知识段。

### 文档同步
- `docs/34`：Phase 5 行 → ✅；规划第 3 项划除；功能批次标注 ✅。
- `docs/架构评估与方案脑暴.md`：Phase 5 → ✅，补改动文件与验证。

### 已知边界
- **Claude(Anthropic) 不支持 tools**（docs/34 ❓3 已登记）：当前 6 预设均为 OpenAI 兼容，原生支持；Claude 分支待产品确认是否纳入（届时需非 tools 回退路径，现有 `response_format` 回退可兜底）。
- 主回合流式用 `S.currentAbortController`：后台 B5/Critic 调用经 `callStructured` 亦会写入该控制器；与「用户导航 abort 主回合」共享，属可接受的次要权衡（旧 `S.auxiliaryControllers` 机制已被统一层取代）。

