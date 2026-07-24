# 以太叙事 AetherNarrator · 界面 UI 参考手册

> 本手册用于把项目的**每一个界面**完整记录下来，便于交给其他 AI / 设计师在不读源码的情况下理解现有 UI，并据此提出或实施界面优化方案。
> 截图是界面的**视觉真源**（位于 `docs/_shots/` 目录，共 23 张）；文字规格是结构的精确描述；代码定位便于直接修改。

---

## 0. 项目与技术栈速览

- **产品**：AetherNarrator（以太叙事）——纯前端、零后端的 AI 文字冒险模拟器。玩家自建/导入世界观，由 LLM 生成剧情，支持知识库、角色状态、时间系统、规则 DSL 等。
- **技术栈**：原生 HTML + CSS + JavaScript（ES Modules），**无任何前端框架**。
- **入口文件**：`index.html`（定义所有界面的静态 DOM 骨架）。
- **逻辑入口**：`src/app.js`（事件委托 `dispatchEvent` → `ACTIONS` 映射，所有 `data-action` 点击都走这里）。
- **界面渲染**：`src/render.js`（屏幕/弹窗显隐 `showScreen/showModal`、世界/存档列表、游戏日志、角色面板、Toast）、`src/lore-ui.js`（知识库/图谱/规则/审稿/开场修复）、`src/game.js`、`src/kg-graph.js`。
- **样式**：全部在 `styles.css`（单文件，含深/浅双主题 CSS 变量）。
- **本地预览方式**（截图即按此方式采集，推荐用 HTTP 而非 `file://`，避免 ES Module 在 `file://` 下的加载怪癖）：
  ```bash
  cd <项目根>
  python -m http.server 8137
  # 浏览器打开 http://127.0.0.1:8137/index.html
  ```

---

## 1. 设计系统（Design Tokens）

所有颜色/圆角均通过 CSS 变量定义，修改配色只需改 `:root` 与 `[data-theme="light"]` 两处。

### 深色主题（默认）
| 变量 | 值 | 用途 |
|---|---|---|
| `--bg` | `#1E1B16` | 页面底色 |
| `--bg-gradient` | `radial-gradient(ellipse at 50% -10%, #2E281F, #26221B 38%, #1A1712)` | 背景渐变（主界面/游戏界面） |
| `--bg-panel` | `#26221B` | 弹窗/面板底 |
| `--bg-sidebar` | `#221E18` | 侧栏底 |
| `--text` | `#D9CFC0` | 主文字 |
| `--text-secondary` | `rgba(217,207,192,.62)` | 次要文字 |
| `--text-muted` | `rgba(217,207,192,.42)` | 弱化文字 |
| `--text-tertiary` | `rgba(217,207,192,.30)` | 三级文字 |
| `--primary` | `#C9A87C` | 主色（金棕，按钮/高亮/边框） |
| `--primary-light` | `#D8BC9A` | 主色亮 |
| `--accent` | `#C9A87C` | 强调色（同主色） |
| `--radius-s/m/l` | `6 / 8 / 12px` | 圆角阶梯 |

### 浅色主题（`[data-theme="light"]`）
| 变量 | 值 |
|---|---|
| `--bg` | `#F3EFE4` |
| `--bg-panel` | `#FCF9F3` |
| `--text` | `#383226` |
| `--text-secondary` | `#8C8272` |
| `--primary` | `#9E7D4E` |
| `--primary-light` | `#B8955E` |

- **字体**：标题与正文使用衬线中文（Noto Serif SC，由 `fonts.googleapis.com` 加载，CSP 已放行）；代码/输入用系统无衬线。
- **装饰**：主界面与游戏界面有全屏 `canvas` 星尘（`#homeMotes`/`#gameMotes`）、`.mist` 雾层、`.vignette` 暗角，均为 `pointer-events:none` 的纯装饰层。
- **动效**：菜单按钮 `rise` 上浮入场；弹窗 `.modal-overlay.show` 淡入 + `.modal` 上滑（`translateY`）；按钮 hover 有位移/描边高亮。

---

## 2. 界面总览（23 个）

| # | 界面 | 截图 |
|---|---|---|
| 01 | 主界面 Home | `_shots/01-home.png` |
| 02 | 选项弹窗 Settings | `_shots/02-settings.png` |
| 03 | API 配置弹窗 | `_shots/03-api.png` |
| 04 | 世界列表 | `_shots/04-worldlist.png` |
| 05–08 | 创建世界向导（4 步） | `_shots/05~08-*.png` |
| 09 | 存档列表 | `_shots/09-savelist.png` |
| 10 | 世界详情弹窗 | `_shots/10-worlddetail.png` |
| 11 | 知识库编辑·知识库视图 | `_shots/11-lore-kb.png` |
| 12 | 知识库编辑·图谱视图 | `_shots/12-lore-graph.png` |
| 13 | 知识库编辑·时间体系视图 | `_shots/13-lore-time.png` |
| 14 | AI 审稿结果弹窗 | `_shots/14-critic.png` |
| 15 | 开场白时间冲突修复弹窗 | `_shots/15-openingfix.png` |
| 16 | 世界规则编辑器 | `_shots/16-rule.png` |
| 17 | 游戏界面（含日志/输入） | `_shots/17-game.png` `17b-game-log.png` |
| 18 | 角色状态面板 | `_shots/18-status.png` |
| 19 | 游戏设置弹窗 | `_shots/19-gamesettings.png` |
| 20 | 作者注（叙事约束）弹窗 | `_shots/20-authornote.png` |
| 21 | 游戏结束弹窗 | `_shots/21-gameover.png` |
| 22 | 存档详情弹窗 | `_shots/22-savedetail.png` |

---

## 3. 各界面详细规格

> 通用机制：所有界面切换与弹窗开关都靠 `data-action` 事件委托（`src/app.js` 的 `dispatchEvent` → `ACTIONS`）。**任何 DOM 改动务必保留 `data-action` 属性**，否则交互会失效。屏幕用 `.screen.active` 显示（`.screen{display:none}` → `.screen.active{display:flex}`）；弹窗用 `.modal-overlay.show` 显示（`.modal-overlay{display:none}` → `.modal-overlay.show{display:flex}`）。

### 01 · 主界面 Home (`#homeScreen`)
- **用途**：启动页，提供导航与主题切换。
- **触发**：应用加载即显示。
- **布局**：全屏渐变背景 + 星尘 canvas + 雾/暗角 → 居中 `.home-content`：主题切换按钮 → 标题「以太叙事 / AetherNarrator」→ 分隔符 → 副标题 → **菜单网格（4 个 `.menu-btn`）** → 免责声明 → 本地说明。
- **关键元素**：
  - `button.theme-toggle-btn[data-action="toggleTheme"]` 日/月图标
  - `button.menu-btn.primary-btn[data-action="showWorldList"]`「进入世界」
  - `button.menu-btn[data-action="showSaveList"]`「读取存档」
  - `button.menu-btn[data-action="showApiModal"]`「API 配置」
  - `button.menu-btn[data-action="showSettingsModal"]`「选项」
  - `.home-disclaimer` / `.home-local-note` 说明文字
- **代码**：静态写于 `index.html:42-84`；星尘动画 `index.html:683` 内联 `initMotes`。

### 02 · 选项弹窗 (`#settingsModal`)
- **用途**：字体大小、AI 温度、知识库修订确认开关、导出调试日志。
- **触发**：主界面「选项」→ `data-action="showSettingsModal"`（`render.js:56`）。
- **布局**：`.modal` → `.modal-header`(标题+关闭) → `.modal-body`（3 个 `.form-group`）→ `.modal-footer`。
- **关键元素**：
  - `.font-size-controls`：`button.font-size-btn[data-action="changeFontSize"][data-size=small|normal|large]`「小/中/大」
  - `input#temperatureSlider[type=range][data-action="updateTempLabel"]` + `#tempLabel`「0.5 — 剧情模式…」
  - `input#loreRequireConfirm[type=checkbox][data-action="toggleLoreRequireConfirm"]`「知识库修订需我手动确认」
  - `.modal-footer`：`button.btn[data-action="exportDebugLog"]`「导出调试日志」+ `button.btn.primary[data-action="closeModal"]`「完成」
- **代码**：`render.js:56 showSettingsModal`（填充当前值）。

### 03 · API 配置弹窗 (`#apiModal`)
- **用途**：填写模型厂商、API Key、模型名、Base URL、CORS 代理、并发等。
- **触发**：主界面「API 配置」→ `data-action="showApiModal"`（`render.js:52`）。
- **布局**：`.modal-body` 静态表单 + `<details class="advanced-details">` 高级选项。
- **关键元素**：
  - `select#providerSelect.lore-sel[data-action="onProviderChange"]`：DeepSeek/通义千问/智谱 GLM/本地 Ollama/OpenAI 兼容/自定义
  - `input#apiKey[type=password]`、`input#modelName`
  - 高级：`#baseUrl`、`#corsProxy`、`checkbox#mockMode`「模拟模式」、`checkbox#noStreamMode`、`number#chunkConcurrency`、`number#embedConcurrency`
  - 底栏：`[data-action="saveApiConfig"]`「确认」
- **代码**：表单静态（`index.html:222-292`）；厂商切换 `app.js` → `applyProviderPreset`（`storage.js`）。

### 04 · 世界列表 (`#worldListScreen`)
- **用途**：列出全部世界（含 3 个预设世界），进入/删除，或创建/导入世界。
- **触发**：主界面「进入世界」→ `data-action="showWorldList"`（`game.js:217`）。
- **布局**：`.nav-header`（返回← + 标题「选择世界」）→ 两个入口条（创建/导入）→ `.list-content#worldListContent`（动态渲染）。
- **关键元素**：
  - `div.create-world-bar[data-action="showCreateWorldModal"]`「＋ 创建新世界 / 输入 IP 或原创世界观」
  - `div.import-world-bar[data-action="triggerWorldPackImport"]`「📥 导入世界 / 从文件导入（含知识库）」
  - 动态卡片 `.world-list-item[data-action="showWorldDetail"][data-id]`：`.item-title`(+`.new-badge`「新」)、`.item-meta`(描述)、`.item-tags`(`.tag`/`.tag.accent`「已有 IP/原创」)、`button.delete-world-btn[data-action="deleteWorld"]`「删除」
- **代码**：`render.js:264 renderWorldList`；预设世界由 `storage.js:34 loadWorlds` 注入（`new-worlds.js` 工厂：`createCthulhuWorld`/`createUrbanLegendWorld`/`createDualWorld`）。

### 05–08 · 创建世界向导 (`#createWorldModal`，4 步)
- **用途**：分步输入名称 / 类型·IP / 世界观 / 微调，生成世界。
- **触发**：世界列表「创建新世界」→ `data-action="showCreateWorldModal"`（`render.js:68`）。
- **布局**：`.cw-steps`（4 个 `.cw-step-dot`）→ `.modal-body`（4 个 `.cw-step[data-step=1..4]`，按步显隐）→ `.cw-footer`（`上一步`/`下一步`/`确认生成`）。
- **各步元素**：
  - **步骤1**（`05-create-step1.png`）：`input#worldName`「世界名称」
  - **步骤2**（`06-create-step2.png`）：`select#worldType[data-action="onWorldTypeChange"]`（已有 IP/原创）、`#ipNameField`(`#ipName`+`.req-tag`)、`#ipUploadField`(`#fileUploadArea`+`input#sourceFile[data-action="handleFileSelect"]`)、上传提示框
  - **步骤3**（`07-create-step3.png`）：`textarea#worldDesc`「世界观描述」
  - **步骤4**（`08-create-step4.png`）：`textarea#heroDesc`、`#styleRefGroup`(3 个 radio：参考原版/自定义文风/不参考)、`#customStyleField`(自定义文风)、`input#plotFreedom[type=range]`+`#plotFreedomLabel`、`details` 高级（世界观/对话特殊要求 `#worldPrefix`/`#customPrefix`）
- **代码**：`render.js:68~251`（showCreateWorldModal / cwNext / cwPrev / onWorldTypeChange / selectStyleRef / updatePlotFreedomLabel / toggleWorldPrefix / toggleCustomPrefix）；最终 `generateWorld`（`game.js:80`）。

### 09 · 存档列表 (`#saveListScreen`)
- **用途**：列出全部存档，继续/删除；孤儿存档（世界已删）仅可查看。
- **触发**：主界面「读取存档」→ `data-action="showSaveList"`（`game.js:223`）。
- **布局**：`.nav-header`（返回 + 标题「读取存档」）→ `.list-content#saveListContent`（动态）。
- **关键元素**：动态卡片 `.save-item`：`.save-info`(`.item-title` + 死亡/世界已删徽章 `☠ 已死亡`/`⚠ 世界已删除`) + `.item-meta`(进度+最后游玩) + `.save-actions`：`button.save-play-btn[data-action="showSaveDetail"]`「继续游玩/查看」、`button.save-del-btn[data-action="deleteSave"]`「删除」。空态显示 `.empty-state`。
- **代码**：`render.js:299 renderSaveList`（数据源 `S.saves`，由 `save.js:createOrUpdateSave` 写入）。

### 10 · 世界详情弹窗 (`#worldDetailModal`)
- **用途**：展示世界元数据，并开始游玩 / 继续 / 重开 / 编辑知识库与规则 / 导出。
- **触发**：世界列表点击某卡片 → `data-action="showWorldDetail"`（`render.js:332`）。
- **布局**：`.modal-header`(标题+关闭) → `.modal-body#detailWorldBody`(动态段落) → `.modal-footer#detailModalFooter`(按钮按是否已有存档动态生成)。
- **关键元素**：
  - `#detailWorldBody` 段落：世界类型、作品名称、世界观描述、主角设定、进度系统、创建时间、开场白预览、文风参考、剧情自由度、特殊要求、源文件
  - 底栏（动态）：`[data-action="editWorldLore"]`「默认知识库」、`[data-action="openRuleEditor"]`「世界规则」、`[data-action="showExportWorldChoice"]`「导出世界」、`[data-action="continueLatestSave"|"startGame"]`「继续游戏/开始游玩」、`[data-action="confirmRestart"]`「重新开始」
- **代码**：`render.js:332 showWorldDetail` + `:392-410` 动态 footer。

### 11 · 知识库编辑·知识库视图 (`#loreReviewModal`)
- **用途**：Obsidian 风三栏知识库编辑（文件树 / 笔记 / 关联）。
- **触发**：世界详情「默认知识库」或存档详情「存档知识库」→ `data-action="editWorldLore"`（`lore-ui.js:579 openLoreReview`）。
- **布局**：`.modal.modal-wide` → 三页签 `.lore-view-tab[data-lore-view=kb|graph|time]` → 对应 pane。知识库视图为三栏：`.lore-tree`（文件树）/ `.lore-note`（笔记，预览↔编辑切换）/ `.lore-backlinks`（出链/反链）。
- **关键元素**：`input#loreSearch.lore-search`「🔍 搜索…」、`button[data-action="addLoreEntry"]`「＋ 添加条目」；笔记面板 `lore-tab` 切换/「删除」；底栏 `extractSourceBtn`「📥 从源文档补抽」、`triggerWorldCritic`「🤖 审稿检查」、`saveLoreReview`「保存知识库」。
- **代码**：`lore-ui.js:444 renderLoreReviewBody` / `:379 renderKBPane` / `:181 renderNotePanel` / `:160 buildLoreTree` / `:220 renderBacklinksPanel`。

### 12 · 知识库编辑·图谱视图 (`#loreReviewModal` + graph tab)
- **用途**：用 force-graph 可视化知识库实体关系网。
- **触发**：知识库弹窗内切到「🔗 图谱」页签 → `.lore-view-tab[data-lore-view="graph"]`（切到该视图时弹窗加 `.modal-graph-wide` 加宽）。
- **布局**：`#loreGraph`（force-graph canvas）+ 工具 `#loreGraphTools`（`btn-icon[data-graph=zoom-in|zoom-out|reset]`）+ `#graphLegend`/`#graphInfo`/`#graphPreview`。
- **代码**：`lore-ui.js:846 mountGraphNow` / `:946 buildGraph` / `:1057 drawGraph`；数据模型 `kg-graph.js:36 buildGraphModel`。

### 13 · 知识库编辑·时间体系视图 (`#loreReviewModal` + time tab)
- **用途**：可视化/编辑世界时间配置（仅 world 模式可编辑），含时间冲突徽章与开场白修复入口。
- **触发**：切到「🕰 时间体系」页签 → `.lore-view-tab[data-lore-view="time"]`。
- **关键元素**：`.time-cfg-card`（纪元/历法 `#tc_calendar`/时钟 `#tc_clock`/季节/天气/起始日期 `#tc_start_year|month|date`）、`#timeConflictBadge` 冲突徽章、`.opening-fix-actions`（`regenerateOpening`「🔄 重新生成开场白」/`convertOpeningToPlaceholders`「🏷 改成占位符版」/`optimizeOpening`「✨ 剧情向优化」）。
- **代码**：`lore-ui.js:97 renderTimeConfigSection`（含 `renderOpeningFixActions`）。

### 14 · AI 审稿结果弹窗 (`#criticModal`)
- **用途**：展示 AI 审稿发现的矛盾/可优化项，采纳或忽略。
- **触发**：知识库弹窗「🤖 审稿检查」→ `data-action="triggerWorldCritic"`（mock/真实 LLM 生成后弹此窗）。
- **布局**：`.modal-body#criticModalBody` 动态 `<ul>`（✏️ 更新 / ➕ 新增 列表）→ 底栏 `rejectCriticRevision`「忽略」/`confirmCriticRevision`「采纳修订」。
- **代码**：`critic.js:39 renderCriticModalBody`；由 `runWorldCritic`（`critic.js:16`）生成。

### 15 · 开场白时间冲突修复弹窗 (`#openingFixModal`)
- **用途**：预览 AI 重写的开场白（生成/占位符/剧情向优化），确认写回。
- **触发**：知识库时间体系视图内的开场修复按钮 → `data-action="regenerateOpening"` 等（`lore-ui.js:311 regenerateOpening` / `:329 optimizeOpening`）。
- **布局**：`.modal-wide` → `#openingFixBody` 双栏 diff（`.opening-diff`：原 `#opening-diff-old` vs 新 `#opening-diff-new`）→ 底栏 `rejectOpeningFix`「✗ 丢弃」/`applyOpeningFix`「✓ 应用修复」。
- **代码**：`lore-ui.js:346 renderOpeningFixModal`。

### 16 · 世界规则编辑器 (`#ruleEditorModal`)
- **用途**：用 DSL 配置世界规则（如「金币<0 → 触发结局」「禁止出现某概念」）。
- **触发**：世界详情「世界规则」→ `data-action="openRuleEditor"`（`lore-ui.js:1451`）。
- **布局**：`.modal-wide` → `#ruleEditorBody` 动态 `.rule-card` 列表 → 底栏 `addRule`「＋ 添加规则」/`saveRuleReview`「保存规则」。
- **关键元素**：`.rule-card`：`input.rule-name`、`.rule-enabled`「启用」复选、`deleteRule`「删除」、`.rule-row`「如果」`select[data-action="ruleTypeChange"][data-kind=when]` + 子输入、「就」`select[...][data-kind=then]` + 子输入。旧禁用词可一键转为规则（`.rule-import-banner` + `importBannedAsRules`）。
- **代码**：`lore-ui.js:1382 renderRuleEditorBody` / `:1451 openRuleEditor` / `:1463-1503` 增删改。

### 17 · 游戏界面 (`#gameScreen`)
- **用途**：核心游玩界面——剧情日志、指令输入、角色/设置入口、时间线与死亡横幅。
- **触发**：世界详情「开始游玩/继续游戏」→ `startGame`/`continueLatestSave`/`loadSave`（`save.js`/`game.js`），切到 `gameScreen`。
- **布局**：`#gameMotes` canvas + 雾/暗角 → `.game-header`（世界名/日期/`#timelineSwitch` + 按钮组）→ `.death-banner#deathBanner`（默认隐藏）→ `.game-body`(`.game-log#gameLog` 含 `#choicesArea` + `.game-input-area`：`#loadingIndicator` + `.input-row`(`#playerInput`+`button.send-btn`))。
- **关键元素**：
  - 顶栏：`#gameWorldName`、`#gameDayInfo`、`.timeline-switch#timelineSwitch`(多时间线时 `.tl-chip[data-action="switchTimeline"]`)、`button[data-action="showStatusPanel"]`「角色」、`#gameThemeToggle[data-action="toggleTheme"]`、`button[data-action="goHome"]`「返回主界面」、`button[data-action="showGameSettings"]`「⚙」
  - 输入：`input#playerInput[placeholder="输入你想做的事..."]` + `button.send-btn[data-action="submitInput"]`「发送」
  - 加载：`#loadingIndicator`（`.loading-dot`/`.loading-text`「正在思考...」/`.loading-time`）
  - 动态：选择按钮 `.choice-chip[data-action="chooseOption"][data-index]`、日志 `.log-entry`（`.meta` + `.player-text` + `.narrative`）
- **代码**：`render.js:837 renderLog` / `:958 renderChoices` / `:795 updateGameDayInfo` / `:968 checkDeathBanner` / `:1031 showLoading`。

### 18 · 角色状态面板 (`#statusPanelOverlay`)
- **用途**：侧滑面板，查看/编辑角色属性、背景、关系、物品、技能、目标、记忆、时间线。
- **触发**：游戏界面「角色」→ `data-action="showStatusPanel"`（`render.js:483`）。
- **布局**：右滑 `.status-panel` → `.status-tabs#statusTabs`（动态 tab）→ `.status-content#statusContent`（按 tab 渲染）。
- **关键元素（tab）**：属性/背景/状态/关系/物品/(技能)/目标/记忆/时间线；`.status-card`、`.status-tag`、`.goal-item`(completed/failed)、`.memory-card`（★评分、📌置顶、🗑删除）、`.timeline-item`。
- **代码**：`render.js:498 renderStatusTabs` / `:543 renderStatusPanel`。

### 19 · 游戏设置弹窗 (`#gameSettingsModal`)
- **用途**：游戏内设置——作者注、AI 增强开关、导出剧情。
- **触发**：游戏界面「⚙」→ `data-action="showGameSettings"`（`game.js:1003`）。
- **布局**：`.modal-body` 按钮列表 → `.modal-footer`「关闭」。
- **关键元素**：`button.btn[data-action="showAuthorNoteModal"]`「✍️ 叙事约束（作者注）」、`button#aiEnhancedToggle[data-action="toggleAIEnhanced"]`「🧠 AI 增强检查：已关闭/已开启」、`button.btn[data-action="exportStory"]`「📄 导出剧情文本」。
- **代码**：`game.js:1003 showGameSettings` / `:996 updateAIEnhancedButton`。

### 20 · 作者注（叙事约束）弹窗 (`#authorNoteModal`)
- **用途**：设置持续生效的叙事约束（每轮注入 AI）。
- **触发**：游戏设置内「✍️ 叙事约束」→ `data-action="showAuthorNoteModal"`（`game.js:242`）。
- **布局**：`textarea#authorNoteInput` + 底栏「取消」/`saveAuthorNote`「保存」。
- **代码**：`game.js:242 showAuthorNoteModal`。

### 21 · 游戏结束弹窗 (`#gameOverOverlay`)
- **用途**：角色死亡后展示结局与操作。
- **触发**：游戏循环中死亡 → `render.js:1014 showGameOver`（写 `#gameOverReason` 并加 `.show`）。
- **布局**：`.game-over-box`：`h2`「游戏结束」+ `.reason#gameOverReason` + `backToHomeAfterGameOver`「返回主界面」+ `reviewDeathScene`「查看结局」。
- **代码**：`render.js:1014 showGameOver`。

### 22 · 存档详情弹窗 (`#saveDetailModal`)
- **用途**：镜像世界详情，针对某存档展示进度并继续游戏/编辑存档知识库/导出。
- **触发**：存档列表点击某卡片 → `data-action="showSaveDetail"`（`game.js:229` → `render.js:416 renderSaveDetail`）。
- **布局**：`.modal-body#detailSaveBody`（所属世界/类型/进度/最后游玩/状态/知识库条目数）+ `.modal-footer#detailSaveModalFooter`：`returnFromSaveDetail`「返回」/`editSaveLore`「存档知识库」/`showExportWorldChoice`「导出世界」/`loadSave`「继续游戏」。孤儿存档（世界已删）走特殊分支，仅「返回/删除该存档」。
- **代码**：`render.js:416 renderSaveDetail`。

---

## 4. 其它零散界面/组件

- **知识晋升确认弹窗 (`#loreRevisionModal`)**：AI 回写知识库时让用户确认。`#loreRevisionSummary` 动态列表 + `confirmLoreRevision`/`rejectLoreRevision`（`lore-ui.js:786 renderLoreRevisionModal`）。
- **重新开始确认弹窗 (`#restartConfirmModal`)**：静态说明 + `confirmRestart`→`doRestartConfirmed`（`game.js:261/270`）。
- **导出世界选择弹窗 (`#exportWorldChoiceModal`)**：`exportWorldChoiceFull`「📦 完整版(含向量)」/`exportWorldChoiceLite`「🪶 精简版」（`game.js:1098`）。
- **Toast (`#toast`)**：全局轻提示，`render.js:1020 showToast(msg,type,duration)`。

---

## 5. 给优化 AI 的注意事项（务必遵守，避免破坏功能）

1. **保留 `data-action`**：所有按钮/输入的交互都靠 `index.html` 的 `data-action` + `app.js` 的 `ACTIONS` 事件委托。改 DOM 文案/结构时**不要删除或改错 `data-action`**，否则点击无反应。
2. **改样式集中在 `styles.css`**：不要在内联 `style` 里硬编码颜色，统一用 `:root` / `[data-theme="light"]` 的 CSS 变量，保证深/浅主题同步。
3. **装饰层 `pointer-events:none`**：`#homeMotes`/`#gameMotes`/`.mist`/`.vignette` 必须保持 `pointer-events:none`，否则会遮挡主界面菜单点击（这是真实存在的坑）。
4. **动态内容容器别删**：`#worldListContent`、`#saveListContent`、`#detailWorldBody`、`#loreReviewBody`、`#statusTabs`/`#statusContent`、`#criticModalBody`、`#openingFixBody`、`#ruleEditorBody`、`#gameLog`、`#timelineSwitch` 等由 JS 动态填充，只改其**外层容器样式**，内部由渲染函数控制。
5. **弹窗显隐约定**：屏幕用 `.screen.active`；弹窗用 `.modal-overlay.show`。新增界面请遵循同样约定，复用 `showScreen/showModal/closeModal`（`render.js`）。
6. **图谱视图依赖 force-graph**：`#loreGraph` 由 `kg-graph.js` + `vendor/force-graph` 渲染，容器尺寸变化需重算，优化布局时注意保留 canvas 容器。
7. **截图复采**：若优化了 UI，可重新用无头浏览器按 `tools/_ui_capture.mjs`（需先 `python -m http.server 8137`）复拍 `_shots/`，与本手册对照验收。

---

*文档生成方式：通过无头 Chrome（系统 Chrome + Playwright）在 `http://127.0.0.1:8137` 下逐一触发各界面并截图，结合静态骨架 `index.html` 与动态渲染函数（`render.js`/`lore-ui.js`/`game.js`/`critic.js`/`kg-graph.js`）整理而成。*
