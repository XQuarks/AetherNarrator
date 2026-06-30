#  AI 文字游戏

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

##  一句话简介

**自定义世界观 × AI 叙事生成 × 角色状态演进** — 打开网页就能玩的文字冒险游戏引擎。支持任意 IP（修仙、魔幻、科幻、武侠……），填入 API Key 即可用大模型驱动剧情；没有 API Key 也能用内置模拟模式提前体验。

---

##  核心特性

| 模块 | 能力 |
|---|---|
|  **世界创建** | 填写 IP 名、故事梗概、硬规则、叙事风格，AI 负责生成完整的角色属性模板和知识库骨架 |
|  **RAG 知识库** | 世界观碎片化存储 + 关键词检索 + 向量语义检索，确保 AI 叙事严格遵循设定 |
|  **结构化状态系统** | 文字属性、关系网、技能树、修行境界、背包物品、目标链 — 每次行动输出可解析的状态变更 |
|  **模拟模式** | 无需 API Key，内置模拟逻辑生成叙事，适合 UI 体验 & 世界观测试 |
|  **真实 AI 模式** | 接入 DeepSeek / OpenAI / 通义千问等任意兼容 API，由 LLM 驱动沉浸式剧情 |
|  **玩家行为记录** | 自动提取关键事实，确保长对话中剧情连贯不遗忘 |
|  **游戏结束机制** | 角色死亡 → 弹窗展示死因 + 游玩统计 + 一键重开 |
|  **纯本地存储** | API Key、游戏存档、世界配置全存 `localStorage`，零服务器、零上传 |
|  **移动端适配** | 响应式布局，手机/平板/桌面体验一致 |

---

##  技术架构

```
┌─────────────────────────────────────────────┐
│           index.html (单文件应用)              │
├─────────────────────────────────────────────┤
│  UI Layer       │  屏幕管理 / 卡片组件 / 面板  │
│  Logic Layer    │  状态机 / RAG引擎 / LLM调用  │
│  Data Layer     │  localStorage / fetch(JSON)  │
├─────────────────────────────────────────────┤
│  data/                                       │
│  ├── initial_state.json      角色属性模板      │
│  ├── lore_kb.json            知识库 (关键词)   │
│  ├── lore_kb_with_embeddings.json 知识库 (向量)│
│  └── system_prompt_template.md  System Prompt │
├─────────────────────────────────────────────┤
│  tools/                                       │
│  └── generate_embeddings.py   向量化脚本       │
└─────────────────────────────────────────────┘
```

**技术选型**：原生 HTML / CSS / JavaScript（零框架依赖）+ `@xenova/transformers`（浏览器端 embedding）+ Python `sentence-transformers`（离线生成向量）

---

##  视觉风格

采用统一的**暗色暮光主题**，两屏共享一致的色彩与质感：

- **底色** `#1A2332` — 沉浸深蓝，长时间阅读不刺眼
- **文字** `#F0EBE0` — 暖奶白，衬线感阅读体验
- **强调色** `#D4A574` — 暖金，克制高级，贯穿卡片 / 进度条 / 图标
- **卡片** — 半透明填充 + 细线描边，替代厚重阴影
- **字体** — 系统原生字体栈，中文优先 `Noto Sans SC`

---

##  快速开始

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

## ✏️ 套用自己的 IP

只需改 **3 个文件**：

### 1. `data/initial_state.json`

填入你的角色：姓名、年龄、背景、属性、技能、关系、背包、修行体系、目标等。

### 2. `data/lore_kb.json`

将世界观拆成片段，每条包含：

```json
{
  "category": "世界观 | 规则 | 角色 | 地点 | 体系",
  "title": "条目名",
  "content": "正文描述",
  "keywords": ["关键词1", "关键词2"]
}
```

### 3. `data/system_prompt_template.md`

替换占位符：

| 占位符 | 说明 |
|---|---|
| `{IP_NAME}` | IP 名称 |
| `{WORLD_RULES}` | 硬规则（不可违反） |
| `{NARRATIVE_STYLE}` | 叙事风格描述 |

`{GAME_STATE_JSON}`、`{RETRIEVED_LORE_SNIPPETS}`、`{PLAYER_INPUT}` 由前端自动注入，无需手动修改。

---

##  知识库 Embedding（可选但推荐）

修改 `lore_kb.json` 后，重新生成向量以获得准确语义检索：

```bash
pip install sentence-transformers

# 中国大陆用户建议
set HF_ENDPOINT=https://hf-mirror.com

python tools/generate_embeddings.py
```

前端在调用 LLM 时会自动从 `lore_kb_with_embeddings.json` 做语义 + 关键词混合检索，把最相关的世界观片段注入 System Prompt。

---

##  接入 AI 模型

关闭「模拟模式」，填写三项配置：

| 配置项 | 示例 |
|---|---|
| Base URL | `https://api.deepseek.com/v1` |
| API Key | `sk-xxxxxxxx` |
| 模型 | `deepseek-chat` / `qwen-turbo` |

### CORS 说明

浏览器直接调用 OpenAI / DeepSeek 等官方 API 会被 CORS 拦截。解决方案：

- **生产环境**：用 Cloudflare AI Gateway 或自有反向代理转发
- **开发测试**：本地 Nginx 转发 / Cloudflare Tunnel
- **快速体验**：安装浏览器 CORS 插件（仅限本地，不推荐长期使用）

---

##  示例世界

项目内置了两个完整的 IP 示例文档：

| 文档 | 内容 |
|---|---|
| `docs/07_示例_修仙世界.md` | 修仙世界观设定 & 角色状态模板 |
| `docs/08_示例_哈利波特世界.md` | 哈利波特世界观设定 & 角色状态模板 |

你可以直接参考这两个文档来搭建自己的 IP。

---

##  设计文档

| 文档 | 主题 |
|---|---|
| `docs/01_世界观生成指南.md` | 如何拆解和构建世界观 |
| `docs/02_知识库设计.md` | 知识库结构 & 检索策略 |
| `docs/03_System_Prompt工程.md` | LLM Prompt 设计原理 |
| `docs/04_RAG方案.md` | RAG 检索增强生成方案 |
| `docs/05_状态与数值设计.md` | 角色状态系统的设计思路 |
| `docs/06_玩家行为记录与关键事实.md` | 长对话记忆机制 |

---

##  未来方向

- [ ] 多存档槽位
- [ ] NPC 日程与事件系统
- [ ] 角色立绘 & 场景插图生成
- [ ] WebSocket 多人在线协作叙事
- [ ] 本地 LLM 支持（WebLLM / Ollama Web）

---

##  开源协议

MIT License — 自由使用、修改、分发。
