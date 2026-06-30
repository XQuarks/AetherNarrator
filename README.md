# 以太叙事 · AetherNarrator

<p align="center">
  <em>一个零后端的 AI 互动叙事引擎 — 输入任意 IP 世界魂，即刻生成沉浸式文字冒险</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/部署-GitHub_Pages-blue?logo=github" alt="GitHub Pages">
  <img src="https://img.shields.io/badge/零后端-纯前端-green" alt="No Backend">
  <img src="https://img.shields.io/badge/LLM-任意兼容_API-orange" alt="LLM">
  <img src="https://img.shields.io/badge/知识库-向量_RAG-purple" alt="RAG">
  <img src="https://img.shields.io/badge/存档-localStorage-blueviolet" alt="localStorage">
</p>

---

## 一句话简介

**自定义世界观 × AI 叙事生成 × 角色状态演进** — 打开网页就能玩的文字冒险游戏引擎。支持基于已有 IP（小说、影视、游戏）或完全原创世界观，填入 API Key 即可用大模型驱动剧情；没有 API Key 也能用内置模拟模式提前体验。

---

## 核心特性

| 模块 | 能力 |
|---|---|
| **世界创建** | 填写 IP 名 / 原创世界观、主角设定、叙事风格、剧情自由度，AI 生成完整的角色属性模板、知识库骨架和开场叙事 |
| **已有 IP 支持** | 输入作品名称，AI 从训练数据中检索相关设定；可上传原著 TXT/DOCX 文件，AI 从原文精确提取世界观 |
| **世界观修改** | 选择已有 IP 时可对原作世界观进行修改和扩展（调整力量体系、加入新势力、改变时间线等），也可直接使用原作世界观 |
| **开场白生成** | 首次进入新世界时，AI 根据世界观、文风、角色设定自动生成 1-3 段沉浸式开场叙事，帮助玩家融入故事 |
| **RAG 知识库** | 世界观碎片化存储 + 关键词检索 + 向量语义检索，确保 AI 叙事严格遵循设定 |
| **结构化状态系统** | 文字属性、关系网、技能树、修行境界、背包物品、目标链 — 每次行动输出可解析的状态变更 |
| **模拟模式** | 无需 API Key，内置模拟逻辑生成叙事，适合 UI 体验 & 世界观测试 |
| **真实 AI 模式** | 接入 DeepSeek / OpenAI / 通义千问等任意兼容 API，由 LLM 驱动沉浸式剧情 |
| **白天 / 夜间主题** | 深灰暗夜 + 浅灰白昼双主题，一键切换，偏好自动持久化到 localStorage |
| **删除世界** | 世界列表每个卡片带删除按钮，一键清除该世界的所有数据（记忆库、状态、存档等） |
| **玩家行为记录** | 自动提取关键事实，确保长对话中剧情连贯不遗忘 |
| **游戏结束机制** | 角色死亡 → 弹窗展示死因 + 游玩统计 + 一键重开 |
| **纯本地存储** | API Key、游戏存档、世界配置全存 `localStorage`，零服务器、零上传 |
| **移动端适配** | 响应式布局 + 触屏滚动优化，手机 / 平板 / 桌面体验一致 |

---

## 技术架构

```
┌───────────────────────────────────────────────────┐
│         index.html (单文件应用)                      │
├───────────────────────────────────────────────────┤
│  UI Layer       │  屏幕管理 / 卡片组件 / 面板 / 主题 │
│  Logic Layer    │  状态机 / RAG引擎 / LLM调用 / 开场白│
│  Data Layer     │  localStorage / fetch(JSON)        │
├───────────────────────────────────────────────────┤
│  data/                                              │
│  ├── initial_state.json      角色属性模板            │
│  ├── lore_kb.json            知识库 (关键词)         │
│  ├── lore_kb_with_embeddings.json 知识库 (向量)      │
│  └── system_prompt_template.md  System Prompt 模板  │
├───────────────────────────────────────────────────┤
│  tools/                                              │
│  └── generate_embeddings.py   向量化脚本             │
└───────────────────────────────────────────────────┘
```

**技术选型**：原生 HTML / CSS / JavaScript（零框架依赖）+ `@xenova/transformers`（浏览器端 embedding）+ `mammoth`（DOCX 文件解析）+ Python `sentence-transformers`（离线生成向量）

---

## 视觉风格

采用双主题设计，风格受 Trionn.com 设计工作室启发 — 极克制色彩、大字间距标题、方形指示器、卡片式叙事：

### 夜间模式（默认）

- **底色** `#161618` / `#1C1C1E` — 深灰沉浸，长时间阅读不刺眼
- **文字** `#E4E4E8` — 冷调亮白
- **强调色** `#C9A87C` — 暖金，克制高级，贯穿卡片 / 按钮 / 进度条
- **卡片** — 半透明填充 + 细线描边 + 柔和投影

### 白天模式

- **底色** `#F3F3F6` / `#FFFFFF` — 浅灰清爽
- **文字** `#1A1A1C` — 深墨色
- **强调色** `#B08A5E` — 深暖金
- **卡片** — 微阴影 + 浅边框

两个主题通过右上角 ☀/🌙 按钮一键切换，偏好自动保存。

---

## 快速开始

### 本地预览

```bash
cd "AI文字游戏_纯前端GitHubPages版"

# 方式一：Python
python -m http.server 8000
# 打开 http://localhost:8000

# 方式二：Node.js
npx serve .
```

> 不要用 `file://` 直接打开，浏览器安全策略会阻止加载 `data/` 目录下的文件。

### 部署到 GitHub Pages

1. 将整个目录 Push 到 GitHub 仓库
2. Settings → Pages → Source 选 **GitHub Actions**
3. 已有 `.github/workflows/deploy.yml`，自动部署
4. 访问 `https://你的用户名.github.io/仓库名/`

> 如果仓库名不是 `<用户名>.github.io`，需确认 `index.html` 中 fetch 路径使用相对路径 `./data/...`（已默认设置）。

---

## 使用流程

### 创建世界

1. 点击「创建新世界」按钮
2. 选择世界类型：
   - **基于已有 IP / 小说**：输入作品名称，AI 会从训练数据中检索该作品的设定、人物、力量体系等；可以在世界观描述中直接使用原作世界观，也可以在此基础上修改和扩展
   - **原创世界观**：自由描述你的世界
3. 填写世界观描述（越详细，AI 生成越贴合预期）
4. 设置主角（可选，不填则由 AI 设计）
5. 选择叙事文风：模仿源文件 / 自定义文风 / 通用叙事
6. 调整剧情自由度（1-5级，从严格遵循原著到完全自由发挥）
7. 上传源文件（可选，上传原著 TXT/DOCX 后 AI 从原文精确提取设定）
8. 点击生成，AI 将创建：
   - 角色属性模板（schema）
   - 初始状态（initial_state）
   - 知识库（lore_kb）
   - 游戏运行 System Prompt
   - **开场白（opening_narrative）** — 1-3 段沉浸式叙事，帮助玩家立即融入故事

### 进入游戏

1. 在世界列表中选择一个世界，查看详情
2. 点击「开始游戏」
3. 首次进入时，开场白自动展示，营造氛围
4. 在输入框中输入你的行动，AI 生成叙事 + 状态变更 + 选项
5. 可以点选推荐选项，也可以自由打字

### 管理世界

- 世界列表每个卡片右上角有「删除」按钮，点击后二次确认，彻底删除该世界的所有数据
- 世界详情页可查看开场白预览、世界观、角色设定等信息

---

## 接入 AI 模型

关闭「模拟模式」，在弹窗中填写三项配置：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| Base URL | `https://api.deepseek.com` | 任意兼容 OpenAI `/chat/completions` 接口的 API 地址 |
| API Key | — | 你的 API 密钥 |
| 模型名称 | `deepseek-v4-flash` | DeepSeek 推荐使用 `deepseek-v4-flash`，也支持 `deepseek-chat` |

> DeepSeek API 使用 `response_format: { type: "json_object" }` 要求 prompt 中包含 "json" 这个词，本项目已自动处理。

### CORS 说明

浏览器直接调用 OpenAI / DeepSeek 等官方 API 会被 CORS 拦截。解决方案：

- **生产环境**：用 Cloudflare AI Gateway 或自有反向代理转发
- **开发测试**：本地 Nginx 转发 / Cloudflare Tunnel
- **快速体验**：安装浏览器 CORS 插件（仅限本地，不推荐长期使用）

---

## 知识库 Embedding（可选但推荐）

修改 `lore_kb.json` 后，重新生成向量以获得准确语义检索：

```bash
pip install sentence-transformers

# 中国大陆用户建议
set HF_ENDPOINT=https://hf-mirror.com

python tools/generate_embeddings.py
```

前端在调用 LLM 时会自动从 `lore_kb_with_embeddings.json` 做语义 + 关键词混合检索，把最相关的世界观片段注入 System Prompt。

---

## XSS 安全

所有用户输入（特殊要求前缀、世界观描述等）在显示到界面时均通过 `escapeHtml()` 函数处理，防止 HTML 注入攻击。AI 返回的叙事文本同样经过转义，确保安全。

---

## 示例世界

项目内置了两个完整的 IP 示例文档：

| 文档 | 内容 |
|---|---|
| `docs/07_示例_修仙世界.md` | 修仙世界观设定 & 角色状态模板 |
| `docs/08_示例_哈利波特世界.md` | 哈利波特世界观设定 & 角色状态模板 |

你可以直接参考这两个文档来搭建自己的 IP。

---

## 设计文档

| 文档 | 主题 |
|---|---|
| `docs/01_世界观生成指南.md` | 如何拆解和构建世界观 |
| `docs/02_知识库设计.md` | 知识库结构 & 检索策略 |
| `docs/03_System_Prompt工程.md` | LLM Prompt 设计原理 |
| `docs/04_RAG方案.md` | RAG 检索增强生成方案 |
| `docs/05_状态与数值设计.md` | 角色状态系统的设计思路 |
| `docs/06_玩家行为记录与关键事实.md` | 对话记忆机制 |

---

## 未来方向

- [ ] 多存档槽位
- [ ] NPC 日程与事件系统
- [ ] 角色立绘 & 场景插图生成
- [ ] WebSocket 多人在线协作叙事
- [ ] 本地 LLM 支持（WebLLM / Ollama Web）
- [ ] 联网搜索 API 集成（Tavily / SerpAPI）

---

## 开源协议

MIT License — 自由使用、修改、分发。
