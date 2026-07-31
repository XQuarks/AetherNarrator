# 52. 创作向导与叙事风格预设升级方案

## 1. 方案代号与一句话目标

- **代号**：W2-Style（Wizard + Style Preset）
- **目标**：把"创建世界"从四步弹窗升级为**编辑器式长页**，把"叙事风格"从单选+标签升级为**"模板库 + 可自由编辑的叙事文风大文本框"**。（注：经拍板，文风**仅在创建时设定**，设置页不做运行时切换。）

## 2. 背景：从对标素材看到什么

读了 `桌面\对标创作参考\` 与 `桌面\对标游玩参考\` 的素材后，UU Game 的做法可归纳为：

| 维度 | UU Game 现状 | 我们现状 | 差距 |
| --- | --- | --- | --- |
| 创作入口 | 编辑器式长页，左侧/顶部分模块导航 | 四步弹窗向导 | 步骤太浅，放不下"玩法模块/世界书/生成项" |
| 叙事风格 | 顶部快捷风格标签 + "叙事文风"500~2000字大文本框 + "从平台模板套用" | 三选一单选 + 6 个结构化标签 | 缺"一键套用风格模板"和"自由文风长文本" |
| 风格控制深度 | 不同"生成引擎"本身带文风差异（畅聊/标准/露娜/疾风/专家/太阳） | 单一模型 + 温度滑块 | 不换引擎，但可用"风格预设"模拟不同引擎效果 |
| 生成项 | 可勾选让 AI 生成：简介/叙事规则/主题配色/角色属性/预设NPC/开场白 | 一键生成全部 | 可让玩家选择生成范围，减少 token/等待 |
| 运行时调整 | 设置页有"文风设定"，仅本存档生效 | 无运行时文风切换 | 玩家玩到一半发现风格不对无法微调 |

**结论**：UU Game 的核心思路是"**创作者像写设定集一样搭世界，风格像调音色一样随时可换**"。

## 3. 本方案拍板（已知会黎总）

1. **不考虑兼容旧世界与预设世界**：新数据模型只对新建世界生效；`src/new-worlds.js` 三个示范世界保持 `style_profile: {}` 或改为使用新模板，不做存档迁移。
2. **不引入多引擎计费模型**：我们的"生成引擎"差异用"风格预设模板 + 推荐温度 + 系统追加指令"模拟，不引入 UU 的计费倍率。
3. **风格预设模板库先内置、后开放**：本期先内置 12 个常用模板，不开放用户自定义模板上传。
4. **运行时不可改文风（黎总拍板 2026-07-31）**：游戏内设置页**不做**文风编辑入口；风格只在"创建世界"时设定并锁定于 `world.style_preset`。理由：避免玩家中途改文风致 AI 输出漂移，也省去运行时覆盖层复杂度。

## 4. 核心设计

### 4.1 叙事风格预设 = 模板库 + 自由编辑

不再用 `style_ref`（original/custom/none）三选一，改为 `world.style_preset`：

```js
world.style_preset = {
  preset_id: "daily_healing",          // "custom" 表示自定义
  name: "日常治愈",
  short_tag: "日常治愈",                // 顶部/卡片显示
  source: "template",                   // "template" | "custom"
  // 核心：一段 500~2000 字的叙事文风约束
  narrative_style: "以日常生活片段为主，冲突轻柔、可化解；注重氛围、细节与人物互动的小确幸；语气温暖、舒缓...",
  // 结构化标签（保留并扩展）
  genre: "都市",
  tropes: ["治愈", "日常"],
  taste: "温暖",
  pov: "第二人称",
  style: "舒缓",
  custom_tag: "",
  // 联动参数
  recommended_temperature: 0.5,
  system_addendum: "多描写光影、声音和触感；每次交互结束后明确提示数值变化。"
};
```

- `narrative_style` 是核心，直接作为 `{STYLE_GUIDE}` 的主体。
- **套用模板即自动连带填写**：玩家在模板库选中某模板时，系统一次性把该模板的 `narrative_style`（叙事文风长文本）**和** `recommended_temperature`（AI 温度）都填进对应输入框，省去玩家自己调参。
- 玩家可自由编辑：
  - 在模板文本基础上增删改写；
  - 手动拖动温度滑块覆盖推荐值；
  - 完全清空，写自己的"自定义风格"（此时 `source:"custom"`，仍可填温度与标签）。

### 4.2 内置风格模板库（示例 12 个）

新增 `src/style-presets.js`，内置模板：

| 模板 ID | 名称 | 题材 | 温度 | 一句话定位 |
| --- | --- | --- | --- | --- |
| daily_healing | 日常治愈 | 都市 | 0.5 | 小确幸、氛围、舒缓 |
| cyberpunk_cold | 赛博冷峻 | 赛博朋克 | 0.4 | 高科技低生活、克制、光影 |
| wuxia_vivid | 武侠江湖 | 武侠 | 0.6 | 快意恩仇、对白简练、江湖气 |
| lovecraft_dread | 克苏鲁恐惧 | 克苏鲁 | 0.4 | 暗示与氛围、留白、未知恐怖 |
| hp_canon | 哈利波特原著 | 西幻 | 0.5 | 英式奇幻、成长、细节丰富 |
| xianxia_grand | 仙侠史诗 | 仙侠 | 0.5 | 宏大世界观、修行、天道 |
| noir_moody | 黑色电影 | 都市 | 0.4 | 阴郁、光影、内心独白 |
| cozy_mystery | 舒适悬疑 | 悬疑 | 0.6 | 轻推理、日常外衣、节奏明快 |
| romcom_sweet | 甜宠恋爱 | 现代 | 0.7 | 轻松、糖分、心理活动 |
| grimdark | 暗黑残酷 | 西幻/末世 | 0.4 | 道德灰色、残酷、沉重 |
| slice_of_life | 校园日常 | 校园 | 0.6 | 青春、群像、细腻互动 |
| epic_fantasy | 史诗奇幻 | 西幻 | 0.5 | 宏大叙事、多线、命运感 |

每个模板包含：name、short_tag、narrative_style、genre、tropes、taste、pov、style、recommended_temperature、system_addendum。

### 4.3 创作向导重构：从 4 步弹窗到编辑器式长页

保留"新建世界"入口，但打开后是一个全屏/大弹窗编辑器：

**顶部栏**

- 左侧：世界名称输入框
- 中间：当前风格标签（可点击切换）
- 右侧："生成世界"按钮、保存草稿按钮

**左侧模块导航**

1. 基本信息
2. 叙事风格
3. 世界观
4. 玩法模块
5. 时间系统
6. 生成设置

**各模块内容**

| 模块 | 内容 |
| --- | --- |
| 基本信息 | 世界名称、世界类型（原创/同人/IP/共享/公共领域）、作品名、源文件上传、剧情自由度滑块 |
| 叙事风格 | 风格模板库弹窗/面板、叙事文风大文本框、结构化标签（题材/主题/口味/视角/文风/自定义标签）、AI 温度滑块 |
| 世界观 | 世界观描述、主角设定、世界书入口（**复用已有 B1 知识库 lore_kb 模块**，本方案不新建；仅放"前往编辑知识库"按钮跳转现有 lore 编辑面板） |
| 玩法模块 | 勾选启用模块：B1人物卡、B2变量、B3背包、B4羁绊、events支线、goals目标、schedule日程、map地图等 |
| 时间系统 | 沿用现有 time_config，但提供可视化预设选择（按天/按年/自定义历法） |
| 生成设置 | 勾选让 AI 生成哪些内容：游戏简介、叙事规则、角色属性、预设 NPC、开场白、主题配色建议 |

**交互**

- 点击左侧导航跳转对应模块。
- 必填项（名称、世界观描述）未填时，"生成世界"按钮禁用并提示。
- 切换"叙事风格模板"时，弹出确认：是否覆盖当前 narrative_style 文本。

### 4.4 数据模型变更

新建世界时，不再写：

```js
world.style_ref = "original";
world.custom_style = "";
world.style_profile = { genre, tropes, taste, pov, style, custom_tag };
```

改为写：

```js
world.style_preset = { ... }; // 见 4.1
world.plot_freedom = 3;
world.temperature_preset = 0.5;
```

旧字段 `style_ref`、`custom_style`、`style_profile` 在本方案中废弃（旧世界仍保留，但新系统不读取）。

### 4.5 UI/UX 关键细节

- **风格模板套用按钮**：在"叙事风格"模块右上角，点击后展开面板，12 个模板以卡片展示（名称+短描述+题材标签），hover 显示推荐温度。
- **风格标签顶部常驻**：创建页顶部显示当前风格 short_tag，像 UU Game 那样可点"更换"快速换模板。
- **叙事文风文本框**：min-height 200px，placeholder 给示例，字数提示 500~2000 字。
- **AI 温度联动**：切换模板时自动推荐温度；玩家可手动覆盖。

### 4.6 运行时注入改造

`src/prompt.js` 改造：

```js
export function buildStyleProfile(world) {
  const preset = world.style_preset || {};
  return {
    mode: preset.source || "custom",
    narrative_style: preset.narrative_style || "",
    genre: preset.genre || null,
    tropes: Array.isArray(preset.tropes) ? preset.tropes : [],
    taste: preset.taste || null,
    pov: preset.pov || null,
    style: preset.style || null,
    custom_tag: preset.custom_tag || "",
    system_addendum: preset.system_addendum || ""
  };
}

export function buildStyleGuide(world, runtimeOverrides = {}) {
  const p = { ...buildStyleProfile(world), ...runtimeOverrides };
  const lines = [];
  lines.push("本世界的叙事文风是最高优先级约束，任何场景、任何 NPC 都不得偏离。");
  if (p.narrative_style) lines.push(p.narrative_style);
  if (p.system_addendum) lines.push(p.system_addendum);
  if (p.genre) lines.push(`题材：${p.genre}`);
  if (p.tropes.length) lines.push(`主题：${p.tropes.join("、")}`);
  if (p.taste) lines.push(`口味：${p.taste}`);
  if (p.pov) lines.push(`叙事视角：${p.pov}`);
  if (p.style) lines.push(`文风标签：${p.style}`);
  return lines.join("\n");
}
```

运行时调用：`buildStyleGuide(world, S.gameState?.styleOverrides)`。

### 4.7 设置页运行时文风设定（❌ 本期不做，黎总拍板 2026-07-31）

经拍板，**游戏内设置页不做文风编辑入口**。理由：
- 风格在创建世界时即锁定于 `world.style_preset`，中途改文风易致 AI 输出风格漂移、破坏沉浸；
- 省去 `gameState.styleOverrides` 运行时覆盖层与缓存失效逻辑，复杂度更低、更稳；
- 若玩家确实想换风格，正确做法是"重开/复制世界"，而非运行时覆盖。

## 5. 实施范围与阶段（黎总拍板：A+B 一起做）

按黎总 2026-07-31 决策：阶段 A 与阶段 B **合并实施**，不设先后；运行时文风设定不做；世界书复用已有模块、不新建；示范世界不迁移（见第 3 节拍板 #1）。

**阶段 A+B（合并实施）**

- 新增 `src/style-presets.js`：内置 12 个风格模板（见 4.2），每个含 `narrative_style` + `recommended_temperature` + `system_addendum` + 结构化标签；选中即自动填写文风文本与温度。
- 改造 `world.style_preset` 数据模型，废弃 `style_ref` / `custom_style` / `style_profile`（旧世界保留但不读取）。
- 改造 `buildStyleProfile` / `buildStyleGuide`（见 4.6），`{STYLE_GUIDE}` 主体取自 `narrative_style`。
- 创作向导重构为编辑器式长页（见 4.3）：新增 `index.html` 全屏编辑器 + `src/wizard-editor.js`，左侧 6 模块导航，叙事风格模块接入模板库 + 自动填温 + 自由编辑。
- 世界观模块放"前往编辑知识库"入口，跳转现有 B1 lore 编辑面板（世界书已存在，不重建）。
- 不新增设置页文风编辑（见 4.7）。
- 不重写 `src/new-worlds.js` 示范世界（按拍板 #1 不兼容旧/预设世界）。

## 6. 验证方式

- **单元测试**：12 个模板都能被 `buildStyleGuide` 正确渲染；自定义风格覆盖生效；运行时覆盖只影响 `gameState`。
- **浏览器烟雾**：创建世界时切换模板，叙事文风文本框正确填充；设置页修改文风后，下轮 AI 输出风格变化。
- **人工测试**：用同一世界观分别套用"武侠江湖"和"克苏鲁恐惧"模板，AI 输出明显不同。

## 7. 风险与红线

- **风险 1：narrative_style 文本太长，挤占 system prompt 长度。** 控制 2000 字以内；模板默认 500~800 字。
- **风险 2：玩家写冲突的风格描述。** 我们在 buildStyleGuide 中声明"本条最高优先级"，但最终仍依赖 AI 遵循能力。
- **风险 3：与现有 IP 扫描/事件卡系统的交互。** 风格预设只改文风约束，不改 IP 扫描规则或事件卡机制。
- **红线**：本方案**不改**事件卡、时间系统、模块注册表、B 系列容器等已稳定系统。

## 8. 范围锁定（黎总拍板 2026-07-31）

1. **A+B 一起做**：风格模板库 + 编辑器式向导合并实施。
2. **内置 12 个模板**：选中即自动帮玩家填写对应温度 + 叙事文风 prompt；玩家仍可自由改写风格与温度。
3. **设置页运行时不能改文风**：删除 4.7 运行时覆盖方案。
4. **世界书 = 已有 B1 知识库（lore_kb）模块**：同一概念已落地（每条片段带 `activation_keys`/`trigger_mode`/`scan_depth`，关键词或向量≥0.30 触发注入）。本期**不新建**，仅在向导"世界观"模块加跳转入口。

> ⏳ 待黎总亲口说"做"，再按上述范围动 `src/` 与 `index.html`。按项目规矩，方案确认后须明确授权才写代码。
