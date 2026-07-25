# 文档 24 具体改动方案：运行时注入玩家文风（{STYLE_GUIDE}）

> 配套：基于 `docs/24_剧情生成提示词优化与文风一致性.md` 的"最该做的 3 件事"落地方案。
> 目标：让玩家在建世界时选定的文风，在**每轮生成时都被强制约束**，并消除"硬核世界冒出 ♡/emoji"的违和。
> 设计红线：**预留 `style_profile` 扩展位**，让后续的 `docs/25` 结构化标签（题材/爽点/口味/视角/风格）能直接 plug in，不二次返工。

---

## 0. 现状事实（来自代码核查，非推测）

- 世界对象存文风的字段：`world.style_ref`（`"original" | "custom" | "none"`）+ `world.custom_style`（自由文本）。由 `game.js:176-177` 写入，`prompt.js:31-35` 生成世界时消费一次。
- **运行时 `buildSystemPrompt`（`prompt.js:189-312`）完全不读取 `style_ref`/`custom_style`** → 印证"文风建完即丢"。
- 模板 `data/system_prompt_template.md` 第 33–73 行把「emoji + 心形 ♡ + 女性语气词 + 呻吟喘息」**写死**，对所有世界无条件生效。
- 当前 `buildSystemPrompt` 已处理的占位符：`{IP_NAME} {HERO_CONTEXT} {TONE_GUIDE} {WORLD_RULES} {WORLD_SCHEMA} {PLOT_FREEDOM} {TIME_MODE_RULES}`。模板在 `<!-- DYNAMIC -->`（第 343 行）处拆为"固定前缀（缓存）"和"动态段"——我们要加的占位符都在固定前缀内，命中缓存、零额外 token 负担。

---

## 1. 改动总览

| 文件 | 改动 | 风险 |
|---|---|---|
| `data/system_prompt_template.md` | ① 叙事基调节前加 `{STYLE_GUIDE}` 占位符；② 第 33–73 行 emoji/心形整段替换为 `{STYLE_EXPRESSION_GUIDE}` 占位符 | 低（纯文本） |
| `src/prompt.js` | 新增 `buildStyleProfile` / `buildStyleGuide` / `buildExpressionGuide` / `styleToTemperature`；改 `buildSystemPrompt` 注入两占位符；改 `buildToneGuide` 补类别 + 自定义优先；改 `buildAuthorNote` 加文风提醒 | 低–中 |
| `src/store.js` | `defaultWorldSchema` 增加可选 `style_profile: {}`（向后兼容，旧世界无此字段不影响） | 低 |
| `src/game.js` | （可选）创建世界后按文风预填 `temperature_preset` | 低 |
| `test/s26-style-injection.test.js` | 新增单测覆盖上述函数 | 低 |

**可逆性**：全部为新增/局部替换，旧世界（无 `style_profile`）走 `custom_style` 兜底分支，行为不变。SourceTree 里是一次普通提交，回退右键"重置"即可。

---

## 2. 数据模型：预留 `style_profile` 扩展位

**不改**现有 `world.style_ref` / `world.custom_style`（向后兼容，旧存档照常工作）。

**新增**可选字段 `world.style_profile`（对象，可空），用于 `docs/25` 的结构化标签落地。Doc 24 阶段它可以是空对象，但注入函数统一从"归一化后的 profile"读取，这样 Doc 25 只填字段、不改注入逻辑。

归一化函数（新增于 `prompt.js`）：

```js
// 把世界现有 style_ref/custom_style 与未来的 style_profile 统一成一个对象
export function buildStyleProfile(world) {
    const w = world || {};
    const sp = (w.style_profile && typeof w.style_profile === "object") ? w.style_profile : {};
    return {
        mode: w.style_ref || "none",          // original | custom | none
        custom: w.custom_style || "",          // 自由文本文风要求
        genre: sp.genre || null,               // 题材（docs/25 填）
        tropes: Array.isArray(sp.tropes) ? sp.tropes : [],  // 爽点（docs/25 填）
        taste: sp.taste || null,               // 口味（docs/25 填）
        pov: sp.pov || null,                   // 视角（docs/25 填）
        style: sp.style || null                // 文风标签（docs/25 填）
    };
}
```

---

## 3. 模板改动（对照）

### 3.1 叙事基调节：加 `{STYLE_GUIDE}`

**改前**（第 21–25 行）：
```
# 叙事基调

{TONE_GUIDE}

根据以上基调自动调整叙事侧重点：
```

**改后**：
```
# 本世界强制文风（玩家已选定，每轮必须遵守）

{STYLE_GUIDE}

# 叙事基调

{TONE_GUIDE}

根据以上基调自动调整叙事侧重点：
```

### 3.2 角色情感表达节：整段替换为占位符

**改前**（第 33–73 行）：写死的 emoji/心形/女性语气词/呻吟喘息整段。

**改后**：
```
# 角色情感表达（语气词与视觉符号）

{STYLE_EXPRESSION_GUIDE}
```

> 原有那段"女性语气词/心形/呻吟"内容**不删除、不丢失**——它变成 `buildExpressionGuide` 在"轻松/恋爱类"分支下的输出文本（见 4.2）。史诗/恐怖类世界则注入各自对应的描写指南。

---

## 4. prompt.js 改动

### 4.1 新增 `buildStyleGuide(world)` → 填充 `{STYLE_GUIDE}`

```js
// 运行时强制文风约束（缓存友好，纯函数）
export function buildStyleGuide(world) {
    const p = buildStyleProfile(world);
    const lines = [];
    lines.push("本世界的文风是最高优先级叙事约束，任何场景、任何 NPC 都不得偏离。");
    lines.push("若世界知识库(world.system_prompt)中的文风描述与本条冲突，以本条为准。");
    lines.push("");

    if (p.mode === "original") {
        lines.push("· 文风模式：沿用源文件本身的文风与叙事节奏（如为原创世界则使用通用叙事风格）。");
    } else if (p.mode === "none") {
        lines.push("· 文风模式：通用叙事风格，不模仿特定文风。");
    } else {
        lines.push("· 文风模式：严格遵循玩家自定义要求。");
    }

    if (p.custom && p.custom.trim()) {
        lines.push("· 玩家自定义文风要求（必须执行）：" + p.custom.trim());
    }
    // ★ docs/25 结构化标签接入点：这些字段现在多半为空，Doc 25 落地后自动生效
    if (p.genre) lines.push("· 题材：" + p.genre);
    if (p.tropes.length) lines.push("· 爽点/主题：" + p.tropes.join("、"));
    if (p.taste) lines.push("· 口味：" + p.taste);
    if (p.pov) lines.push("· 叙事视角：" + p.pov);
    if (p.style) lines.push("· 文风标签：" + p.style);
    return lines.join("\n");
}
```

### 4.2 新增 `buildExpressionGuide(world)` → 填充 `{STYLE_EXPRESSION_GUIDE}`

按文风分类输出不同描写指南；轻松/恋爱类包含原模板的语气词/心形段，其余类替换为对应冷峻/恐怖/赛博朋克指南。

```js
export function buildExpressionGuide(world) {
    const p = buildStyleProfile(world);
    const text = [p.style, p.taste, p.genre, p.custom].filter(Boolean).join(" ");

    // 轻松/日常/恋爱/甜宠/治愈 → 启用 emoji + 心形 + 语气词（原模板内容）
    if (/(轻松|日常|恋爱|甜宠|甜|宠|治愈|温馨|活泼|少女)/.test(text)) {
        return [
            "可适度使用 emoji（如 💡🔥🌟）与心形符号 ♡ 增强亲密感；语气词（呀/嘛/呢）可营造轻松或恋爱氛围。",
            "恋爱向可含轻柔的亲密描写，但须保持克制、不越界；日常对话可自然带出心形符号。",
            "女性化语气词（啊、呀、嗯、呜、唔）可穿插于台词与反应描写；舒适/放松场景可用「嗯～好舒服的风啊」式表达。",
            "注意：符号与语气词须贴合角色人设与当下情绪，不可让所有角色不分场合使用。"
        ].join("\n");
    }
    // 史诗/硬核/废土/生存 → 冷峻感官
    if (/(史诗|硬核|废土|生存|残酷|热血|战争|战斗)/.test(text)) {
        return [
            "禁用 emoji 与心形符号。",
            "描写以冷峻的感官细节为主：气味、触感、声响、痛觉、疲惫。",
            "句子短促有力，避免甜腻语气词；情感通过动作与环境流露，而非直白抒情。",
            "伤亡、血污、废墟等元素可写实呈现，但避免为残酷而残酷的炫技。"
        ].join("\n");
    }
    // 克苏鲁/恐怖/悬疑/暗黑 → 不可名状
    if (/(克苏鲁|恐怖|惊悚|悬疑|暗黑|诡异|怪谈|未知|疯狂)/.test(text)) {
        return [
            "禁用 emoji 与心形符号。",
            "用不确定性、留白、不可名状感制造恐惧：不要细写怪物全貌，写它带来的错位与不安。",
            "避免任何轻佻或亲密语气，保持疏离与压抑；叙事节奏克制，信息碎片化释放。",
            "理智/认知的动摇是核心张力，可通过感知扭曲、记忆不可靠来体现。"
        ].join("\n");
    }
    // 赛博朋克/黑色/冷峻 → 冷光金属
    if (/(赛博朋克|赛博|黑色|冷峻|犬儒|霓虹|科幻|废土公路)/.test(text)) {
        return [
            "禁用 emoji 与心形符号。",
            "用冷光、金属、数据、雨水等意象构建质感；对话带犬儒、锋利与距离感。",
            "避免甜腻语气词；情感压抑在冷硬外壳下，通过反差与细节流露。",
            "科技描写重质感与代价（义体、神经接口、监控），而非炫技。"
        ].join("\n");
    }
    // 默认：克制使用 emoji，与基调一致
    return "可在叙事中适度使用 emoji 来增强氛围（如 😊💀🔥✨），但须与当前叙事基调保持一致——日常向活泼些，高张力向克制使用。心形符号与语气词仅用于明确的恋爱/亲密场景，且须贴合人设。";
}
```

### 4.3 改 `buildSystemPrompt`：注入两个占位符

在 `prompt.js:229-236` 的 `systemPrompt = fixedTemplate.replace(...)` 链中追加两行：

```js
        .replace(/{STYLE_GUIDE}/g, buildStyleGuide(S.currentWorld))
        .replace(/{STYLE_EXPRESSION_GUIDE}/g, buildExpressionGuide(S.currentWorld))
```

### 4.4 改 `buildToneGuide`：补类别 + 自定义优先

在 `prompt.js:430` 函数开头，**若玩家给定了自定义文风或风格标签，直接以它为基调，不再瞎猜**：

```js
export function buildToneGuide() {
    const p = buildStyleProfile(S.currentWorld);
    // ★ 自定义优先：玩家已明确文风时，不再用关键词推断（避免与风格打架）
    if (p.custom && p.custom.trim()) {
        return `叙事基调：以玩家自定义文风为准（${p.custom.trim()}）。\n\n请据此调整叙事的紧张程度、信息密度与情感表达，保持全篇一致。`;
    }
    if (p.style || p.taste) {
        const given = [p.style, p.taste].filter(Boolean).join(" / ");
        return `叙事基调：以玩家选定的「${given}」为准，请据此统一全篇语气与节奏。`;
    }
    // —— 以下保持原有关键词推断逻辑，但补"恐怖/克苏鲁、废土/生存、黑色/冷峻、史诗"类别 ——
    const clues = [ ... ].join(" ");
    // 新增词表：
    const horrorWords = /克苏鲁|恐怖|惊悚|诡异|怪谈|不可名状|疯狂|深渊/;
    const wastelandWords = /废土|生存|末日|灾后|荒野|求生/;
    const noirWords = /黑色|冷峻|犬儒|悬疑|暗黑|罪案|侦探/;
    const epicWords = /史诗|神话|传说|宏大|文明|王朝|远征/;
    // 在 tones 推断时：命中 horror→推"悬疑"；命中 wasteland→推"高张力"；命中 noir→推"悬疑"；命中 epic→推"高张力"
    // （具体把上面正则加入已有 daily/intense/mystery/romance 的命中判断即可，逻辑不变）
    ...
}
```

> 注意：上面"自定义优先"分支会让 `buildToneGuide` 在玩家给了 `custom_style` 时返回一句简短约束，不再输出那 4 条详细基调说明。这是**有意为之**——玩家自定义文风已是最高约束，无需再叠模板的基调菜单。若你希望仍保留详细基线，可在自定义分支里也拼接原有 4 条说明，我们实现时按你偏好定。

### 4.5 改 `buildAuthorNote`：中部纠偏位加文风提醒

在 `prompt.js:745` 函数 `parts.push(...)` 末尾追加（离生成点近、权重高）：

```js
    // ★ 文风保持（中部纠偏位）：双保险，漂移可被即时拦回
    const p = buildStyleProfile(S.currentWorld);
    const styleLabel = p.custom && p.custom.trim() ? p.custom.trim()
        : [p.genre, p.style, p.taste].filter(Boolean).join("/") || (p.mode === "original" ? "源文件文风" : "通用文风");
    if (styleLabel) {
        parts.push("【文风保持】本轮及后续所有输出，必须维持本世界强制文风（见系统提示"本世界强制文风"节）。如检测到语气/用词偏离，立即回调，不要等玩家纠正。");
    }
```

---

## 5. 文风 → 推荐温度映射（可选，配合 theme.js）

`theme.js` 的 `getTemperature` 读 `S.temperatureSetting`（全局一个值）。新增映射，让创建世界时按文风预填推荐温度：

```js
// 文风标签 → 推荐温度（严谨低、自由高）
export function styleToTemperature(style) {
    if (/史诗|硬核|废土|克苏鲁|恐怖|悬疑|冷峻|黑色/.test(style || "")) return 0.4;
    if (/轻松|日常|恋爱|甜宠|治愈|温馨/.test(style || "")) return 0.8;
    if (/赛博朋克|宏大|神话/.test(style || "")) return 0.6;
    return 0.7; // 默认中性
}
```

接入点（`game.js` 创建世界成功后）：`world.temperature_preset = styleToTemperature(world.custom_style || world.style_profile?.style)`，并在设置界面把"温度"默认值显示给用户、允许改。此项为增强，不影响主流程。

---

## 6. 测试方案

新增 `test/s26-style-injection.test.js`（沿用现有 `node --test` 体系，预期并入当前 ~283 项后）：

- `buildStyleProfile`：旧世界（无 `style_profile`）返回兜底；有 `style_profile` 正确合并。
- `buildStyleGuide`：`mode=original/none/custom` 三种分支输出正确；含 `custom_style` 时原文出现；含 `style_profile.style` 时出现"文风标签"。
- `buildExpressionGuide`：分别喂"轻松/恋爱""史诗/硬核""克苏鲁/恐怖""赛博朋克"，断言输出包含对应关键词且**不含** emoji 启用语（史诗/恐怖/赛博分支必须出现"禁用 emoji"）。
- `buildSystemPrompt`：构造最小 `S.currentWorld`（含 `style_ref`/`custom_style`/模板），断言返回字符串含 `{STYLE_GUIDE}` 与 `{STYLE_EXPRESSION_GUIDE}` 已被替换（占位符不再残留）。
- `buildToneGuide`：给 `custom_style` 时返回以自定义为准的简短约束；补的 horror/wasteland/noir/epic 词表能正确命中。
- `buildAuthorNote`：含"文风保持"提醒。
- `styleToTemperature`：各档映射正确。

验证命令（与项目现有约定一致）：`npm run check:modules && npm run check:syntax && npm test`。

---

## 7. 与 docs/25 的接口约定（关键，避免二次返工）

Doc 25 落地"结构化标签 UI"时，只需：

1. 在创建卡加 题材/爽点/口味/视角/风格 五个输入；
2. 把它们写入 `world.style_profile = { genre, tropes, taste, pov, style }`；
3. **不改动**本方案的任何注入函数——`buildStyleGuide` / `buildExpressionGuide` / `buildToneGuide` 已读这些字段并自动生效；
4. 文风→温度映射 `styleToTemperature` 直接吃 `style_profile.style`。

即：本方案把"引擎室"建好，Doc 25 只是往里接"控制面板"。

---

## 8. 落地步骤（按"改一处 → 跑测试 → 说明"节奏）

1. **Step A**：`system_prompt_template.md` 加两占位符（3.1、3.2）。→ 跑 `check:syntax`。
2. **Step B**：`prompt.js` 新增 `buildStyleProfile` / `buildStyleGuide` / `buildExpressionGuide` / `styleToTemperature` 四个纯函数。→ 单测前三个。
3. **Step C**：`prompt.js` 改 `buildSystemPrompt` 注入两占位符。→ 跑 `buildSystemPrompt` 单测，确认无占位符残留。
4. **Step D**：`prompt.js` 改 `buildToneGuide`（自定义优先 + 补类别）。→ 跑 tone 单测。
5. **Step E**：`prompt.js` 改 `buildAuthorNote` 加文风提醒。→ 跑 authorNote 单测。
6. **Step F**：`store.js` 的 `defaultWorldSchema` 加可选 `style_profile: {}`。→ 跑 schema 单测。
7. **Step G（可选）**：`game.js` 创建世界后按 `styleToTemperature` 预填温度。→ 跑相关单测。
8. **全量**：`npm test` 全绿 + `browser-smoke` 通过。

> 每步改完我会告诉你"动了哪个文件、改了什么、测试过没过"，你随时可叫停。

---

## 9. 一句话总结

本方案不动引擎、不改存档结构，只在"提示词装配层"加一个**运行时强制文风约束**：模板加两个占位符，`prompt.js` 加四个纯函数 + 改三个已有函数，并把数据接口预留成 `style_profile`，让 docs/25 的结构化标签能直接 plug in。旧世界（无 `style_profile`）走兜底分支，行为完全不变。
