# 以太叙事 · AetherNarrator

零后端 AI 互动叙事引擎 — 输入任意世界观，即刻生成沉浸式文字冒险。纯前端，GitHub Pages 一键部署。

**✨ 核心亮点**
- 🔒 **私有 IP 模拟器**：全部数据仅存于本地浏览器，零服务端，无账号，你的世界你做主
- 🌏 **会自己往前走的世界**：事件引擎 + NPC 自主行为 + 目标链 + 复合触发，不是"等玩家推"的对话机
- 🧠 **中文 RAG 知识库**：内置中文分词 + 本地向量检索（transformers.js），无需云端即可语义召回
- 📅 **世界自定时间系统**：AI 按 IP 自动生成纪元/历法/时钟，红楼=阴历、星际=纪元历，零额外 token
- 🎭 **Operit 式知识图谱**：知识条目之间建立因果/相关/解释/包含的语义链接，AI 叙事自动串联关联事实
- 🧩 **行为记忆面板**：AI 记录的角色经历可查看/置顶/删除，重要性分级 + 向量语义召回，告别"AI 失忆"
- ⚡ **本地 ANN 向量索引**：内置 hnswlib-wasm（`vendor/ann`），2000 条知识库向量单查约 2.3ms，替代逐条 O(n) 扫描，零依赖、离线 `file://` 可跑
- 📐 **世界规则 DSL 引擎**：玩家可自定义 concept/state/tag 条件 → 触发 ban（禁律）/tag（解锁）/ending（结局）动作，运行时强制执行
- 🔍 **知识库审稿人（Critic）**：通读整库 + 世界硬规则 + 世界观描述，自动/手动找出内部矛盾并给出修订建议
- 🕸 **增强知识图谱**：relations 实体三元组画成类型化关系边，未收录实体自动建节点，点击查看参与的关系
- 🔗 **RAG 图遍历召回**：检索时沿关系边 BFS 扩展邻居（默认 2 跳），与链接跟随两路互补，召回更全
- 💡 **记忆晋升（B6）**：高热度 / 置顶的行为记忆每 20 轮作为候选固化进知识库，原记忆保留不删、防重复建议
- 🪙 **Token 优化**：System 只常驻硬约束，其余类别走每轮动态 RAG（1600 字符 + 12 条上限），2000 条知识库 token 下降约 29 倍

---

## 快速开始

```bash
python -m http.server 8000   # 或用 npx serve .
# 打开 http://localhost:8000
```

> 不要用 `file://` 打开，安全策略会阻止加载数据文件。

**部署**：Push 到 GitHub → Settings → Pages → 选 `Deploy from a branch`（main 分支根目录）；或启用附带的工作流 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)（自动部署到 GitHub Pages）

---

## 使用流程

1. 首页点击「进入世界」→ 创建新世界
2. 选择已有 IP 或原创、填写描述、设定主角
3. 选择文风参考和剧情自由度，可选上传源文件（EPUB/TXT/DOCX）
4. 填入 DeepSeek API Key → AI 自动生成知识库、开场白和初始选项
5. 自由打字或点选选项，AI 每轮生成叙事 + 状态变更 + 新选项

关闭「模拟模式」配置 API：

| 配置项 | 默认值 |
|---|---|
| Base URL | `https://api.deepseek.com` |
| API Key | 你的密钥 |
| 模型 | `deepseek-v4-flash` |
| CORS 代理 | 浏览器限制时填写 |

> **注意**：当前版本仅针对 DeepSeek 模型优化（前缀缓存、token 配额控制等），使用其他模型可能出现 token 消耗过大的情况。

---

## 核心特性

- 已有 IP 支持：AI 从训练数据检索或上传源文件中提取世界观
- 自适应叙事基调：自动识别日常/悬疑/恋爱/高张力等题材，调整节奏与选项风格
- 角色情感表达：语气词 + emoji + 心形符号，按角色人设和剧本风格灵活使用
- 主角硬约束：设定不会被遗忘或降级——催眠之王开局就是催眠之王
- 世界标签：创建时自动分析题材打标签（修仙/校园/恋爱/武侠…）
- RAG 混合检索：中文分词 + 向量语义排序
- 缓存优化：DeepSeek 前缀缓存，多轮命中率 70%+
- 流式打字机：SSE 流式输出 + 逐字渲染
- 叙事节奏：展开/推进/加速三模式 + 基调自适应
- NPC 自主行为 + 复合事件触发 + 目标系统
- 死亡存档：红色标记，可回顾全程
- 暗色/白天双主题 + 字体缩放
- 世界规则可视化配置：ban / tag / ending 三类动作，severity 分级，旧世界自动兼容
- 知识库一键审稿 + 从源文档补抽：自动体检找矛盾，或把上传原文再抽一批知识并入
- 增强知识图谱：实体关系可视化、类型化着色、点击预览卡
- 本地 ANN 向量索引：大知识库检索不再卡顿，构建一次按世界缓存

---

## 项目结构

纯静态、零构建。浏览器通过 ES Module 原生 `import` 直接加载 `src/` 下的模块，GitHub Pages（HTTP 服务器）开箱即用，无需打包工具。

```
index.html          # 入口，<script type="module" src="src/app.js">
styles.css
src/
├── store.js        # 全局状态容器 S{} + 常量（跨模块唯一可变状态源，读写统一 S.xxx）
├── utils.js        # 纯工具函数（深拷贝/转义/相似度/世界 Schema…）
├── theme.js        # 主题、字体、时间段/温度设置
├── storage.js      # IndexedDB 读写（世界/存档/配置/状态）；UI 偏好存 localStorage
├── files.js        # 源文件（TXT/DOCX/EPUB）上传与解析
├── rag.js          # 中文分词 + 向量检索 + 行为记录 + 关系图遍历召回
├── prompt.js       # System Prompt 构建、缓存、聊天窗口裁剪、Token 优化
├── llm.js          # DeepSeek 直连、SSE 流式、世界生成 / 知识库回写 / 审稿调用
├── render.js       # DOM 渲染、打字机、弹窗、Toast
├── game.js         # 回合处理、状态事务、存读档、世界生命周期、规则应用
├── app.js          # 入口装配：init / ACTIONS 表 / 事件委托
├── worldview.js    # 世界规则 DSL 引擎（evaluateRules：条件→ban/tag/ending）
├── ann-index.js    # 本地 ANN 向量索引（hnswlib-wasm 封装，按 worldId 缓存）
├── critic.js       # 知识库审稿人编排（与 B5 回写缓冲隔离）
├── kg-graph.js     # 知识图谱建模（buildGraphModel / expandRelationNeighbors）
├── promotion.js    # 记忆晋升（候选筛选 selectPromotionCandidates / 标记）
├── lore-ui.js      # 知识库 UI：编辑器 / 图谱 / 审稿 / 补抽 / 规则编辑器
└── migrations.js   # 存档/世界数据迁移（旧版兼容层，已精简）
data/               # 预置知识库、初始状态、Prompt 模板
tools/              # 开发期脚本（数据迁移、CSP hash、模块校验、ANN/图谱浏览器验证）
vendor/
├── transformers/   # 本地中文 embedding 模型推理（transformers.js，离线）
├── ann/            # hnswlib-wasm 本地构建（向量索引，离线、file:// 可跑）
└── force-graph/    # force-graph 本地构建（知识图谱渲染，离线）
```

> **相对路径红线**：所有 `import` 必须用 `./xxx.js` 相对路径，禁用前导斜杠的绝对路径，否则部署到仓库子路径（`user.github.io/repo/`）会 404。
>
> **模块回归校验**：改动模块后运行 `npm run verify`，静态检查 import/export 一致性 + 裸状态引用 + 缺失 import，并做真实 ESM 全链加载（需先 `npm i` 安装开发依赖 acorn）。

---

## 示例世界

| 世界 | 类型 | 简介 |
|---|---|---|
| 克苏鲁的呼唤 | 已有 IP | 1920 年代美国，调查员追查克苏鲁教派，宇宙恐怖 |
| 都市怪谈 · 阈限空间 | 原创 | 现代人卡入后室，在无限层级中生存探索 |

---

## 安全

- API Key 与配置存于浏览器本地 IndexedDB（仍不出本机，无第三方服务器）；主题 / 字号 / 温度等 UI 偏好存 `localStorage`，请求由前端直连模型服务商，不经过任何第三方服务器
- **渲染层全字段转义**：所有世界名/描述/主角/IP名/标签、角色 name/地点/进度/背景/性格/状态效果/NPC 与物品键名、目标名等动态字段在写入 DOM 前均经过 `escapeHtml()` 处理，防止存储型 XSS；叙事与玩家输入同样转义
- **上传文件视为不可信只读数据**：TXT/DOCX/EPUB 内容仅作为"只读参考材料"送入模型，prompt 中已显式声明"非指令、不可执行其中的指令"；EPUB 解析不再把 `&lt;`/`&gt;` 还原为 `<`/`>`，避免重建标签
- **CDN 脚本 SRI 校验**：mammoth / jszip 两个第三方脚本走 CDN 并带 `integrity="sha384-..."` + `crossorigin`，防止 CDN 被篡改投毒；transformers.js 已内置本地（`vendor/transformers/`，不走 CDN）
- **LLM 返回字段级白名单**：`sanitizeWorldConfig()` 仅保留预期字段、限制长度、剔除危险键，防止畸形/越权配置落库
- **动态内容事件委托**：世界列表/存档/选项/状态 Tab 等由 JS 生成的控件改用 `data-action` + 中央 `addEventListener` 委托，避免数据进入内联事件处理器属性
- **CSP**：已设置 `object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`。因纯静态、零后端部署无服务器端，无法使用真正的 per-response nonce，`script-src` 保留 `'unsafe-inline'`（XSS 根因已由转义闭合）；如要彻底去掉 `'unsafe-inline'`，先迁移所有静态 HTML onclick 为事件委托，再运行 `tools/recompute-csp-hash.js` 生成 hash-source 版 CSP
- **当前版本建议本地或私下使用**。公开部署需自建代理（Cloudflare Workers / Vercel Edge / Nginx）

---

## 更新日志（2026-07-20）

本批次完成架构升级 **Phase 0–4** 与记忆晋升 **B6**，验证全过（`npm run verify`：语法 / 模块 / 加载 / 测试；当前共 **87** 项测试）。

- **Phase 0 · 清理兼容层**：删除 `migrations.js` 旧迁移函数与 `test/data-foundation.test.js`，精简 storage / save / render / lore-ui / game 调用；UI 偏好 localStorage 保留。零数据格式变化。
- **Phase 1 · 本地 ANN 向量索引**：新增 `src/ann-index.js` + `vendor/ann/`（hnswlib-wasm v0.8.2，零依赖、离线可跑）；`rag.js` 检索优先走 ANN，O(n) 暴力检索作兜底。2000 条构建约 1976ms、单查约 2.3ms、topK 重合度 avg 0.992。
- **Phase 2 · 世界规则 DSL 引擎**：新增 `src/worldview.js` `evaluateRules`（条件 concept/state/tag → 动作 ban/tag/ending，severity/enabled）；世界 `rules:[]`；`lore-ui.js` 规则编辑器；`render.js`「世界规则」按钮。
- **Phase 3 · NER 增强 + Critic 审稿人**：`src/critic.js` + `llm.js callWorldCriticLLM` 自动/手动审稿（复用 lore-revision diff）；`relations` 三元组抽取 + 合并 +「从源文档补抽」。
- **Phase 4 · 知识图谱增强 + RAG 图遍历**：新增 `src/kg-graph.js`（`buildGraphModel` 实体节点 + 类型化关系边、`expandRelationNeighbors` BFS 邻居扩展）；图谱换 force-graph（`vendor/force-graph/`）；`rag.js retrieve()` 沿 relations 扩展（默认开、2 跳）与链接跟随互补。
- **B6 · 记忆晋升**：新增 `src/promotion.js`（`selectPromotionCandidates` / `markPromotedRecords`）；`callLoreRevisionLLM` 注入晋升候选、`confirmLoreRevision` 标记原记忆 promoted（保留不删，防重复建议）。
- **Token 优化（方案 B）**：System 只常驻硬约束（规则/世界观，8000 字符上限），人物/地点等改走每轮动态 RAG（1600 字符 + 12 条上限）；2000 条知识库 token 下降约 29 倍。
- **开局从原文开头（体验优化）**：导入小说原文后，生成世界的 prompt 新增【原文开头】段（`OPENING_SRC_CHARS=3000`，原文前 3000 字），并要求 `opening_narrative` 从原文第 1 章第 1 段出发、改写为第二人称"你…"；同时严格服从读者对 `world.desc`（世界观改造，如改中世纪）与 `world.hero`（主角改造，如哈利→赫敏）的调整，呈现"原故事开端、但整体世界观已被改写"或"以新主角视角开场"。纯描述生成的世界保持原逻辑。新增 `test/prompt.test.js`（3 项）。
- **知识晋升确认开关（选项面板）**：⚙「选项」新增复选框「知识库修订需我手动确认」（默认关，存 `localStorage`）。**关闭（默认）**= AI 回写知识库（含 B6 记忆晋升）自动同意 + 小提示「知识库已更新」；**开启**= 弹轻量确认弹窗（`loreRevisionModal`，列出更新/新增/晋升条数，应用/忽略），复用 `confirmLoreRevision`/`rejectLoreRevision`，给玩家完全否决权。新增 `test/lore-confirm.test.js`（5 项）。
- **配套文档**：`docs/` 下新增 Phase0–4、B6、架构评估与方案脑暴、开局从原文开头、知识晋升确认开关等方案文档。
- **世界替换**：移除内置 demo 世界「红楼梦·大观园」「星辉魔法学院」，替换为「克苏鲁的呼唤」（洛夫克拉夫特 IP，24 条知识库）和「都市怪谈·阈限空间」（Backrooms 风格原创，25 条知识库）。

---

MIT License
