# 以太叙事 · AetherNarrator

<p align="center">
  <em>零后端的 AI 互动叙事引擎 — 输入任意 IP 世界观，即刻生成沉浸式文字冒险</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/部署-GitHub_Pages-blue?logo=github" alt="GitHub Pages">
  <img src="https://img.shields.io/badge/零后端-纯前端-green" alt="No Backend">
  <img src="https://img.shields.io/badge/LLM-兼容_OpenAI_API-orange" alt="LLM">
  <img src="https://img.shields.io/badge/缓存-DeepSeek_前缀加速-yellow" alt="Cache">
  <img src="https://img.shields.io/badge/知识库-混合_RAG-purple" alt="RAG">
  <img src="https://img.shields.io/badge/存档-localStorage-blueviolet" alt="localStorage">
</p>

---

## 简介

自定义世界观 × AI 叙事生成 × 角色状态演进 — 打开网页就能玩的文字冒险游戏引擎。支持已有 IP（小说、影视）或原创世界观、上传 EPUB/TXT/DOCX 源文件，填入 DeepSeek API Key 即可由大模型驱动剧情；无 Key 也能用内置模拟模式体验。

---

## 核心特性

| 模块 | 能力 |
|---|---|
| **世界创建** | 填写名称 / 描述 / 主角 / 文风 / 剧情自由度，AI 一键生成角色模板、知识库、开场白、初始选项 |
| **已有 IP 支持** | 输入作品名称 + 上传 EPUB/TXT/DOCX 源文件，AI 从原文精确提取世界观 |
| **开场选项** | 新世界创建后自动展示 2-4 个初始行动选项，退出再读档仍能看到 |
| **RAG 检索** | 关键词检索（中文分词 Intl.Segmenter）+ 向量语义检索（Xenova/all-MiniLM-L6-v2）混合排序 |
| **结构化状态** | 文字属性、NPC 关系、技能、境界、背包、目标 — 每次输出可解析的 JSON 状态变更 |
| **缓存优化** | System Prompt 硬化 + 聊天历史锚定模式 + DeepSeek 磁盘缓存，多轮对话命中率 70%+ |
| **流式输出** | SSE 流式 API，token 实时到达 + 进度显示，打字机效果逐字呈现 |
| **选项动画** | 选项在打字完成后从左至右缓动渐入，发送时立即消失，视觉流畅 |
| **温度可调** | 选项面板 0.0-1.0 滑块，默认 0.5（剧情模式，稳定连贯） |
| **AI 记忆** | 永久关键事实注入 + NPC 关系描述 + 对话历史摘要 + 叙事一致性自检 |
| **剧情系统** | 叙事三模式节奏控制 / 选项深度设计 / NPC 自主行动 / 复合事件触发 / 数值约束 |
| **死亡存档** | 存档列表红色标记已死亡存档，进入后红色横幅提示但不妨碍浏览历史 |
| **双主题** | 暗色沉浸 + 白天电子书仿纸色，偏好持久化 |
| **字体调节** | 选项面板小 / 中 / 大三档，通过 zoom 全局缩放 |
| **本地存储** | API Key / 存档 / 世界配置全存 localStorage，零服务器 |

---

## 技术架构

```
index.html (单文件应用)
├── UI Layer     屏幕管理 / 卡片组件 / 面板 / 主题 / 打字机
├── Logic Layer  状态机 / RAG引擎 / LLM调用 / 状态变更 / 行为记录
├── Data Layer   localStorage / fetch(JSON) / EPUB-DOCX解析
│
data/
├── initial_state.json              角色属性模板
├── lore_kb.json                    知识库 (关键词)
├── lore_kb_with_embeddings.json    知识库 (向量)
└── system_prompt_template.md       System Prompt 模板

tools/
└── generate_embeddings.py          向量化脚本

docs/                               设计文档 (8篇)
```

**外部依赖**：`@xenova/transformers`（浏览器端 embedding）、`mammoth`（DOCX 解析）、`JSZip`（EPUB 解析）

---

## 快速开始

```bash
# 本地预览
python -m http.server 8000    # 或 npx serve .
# 打开 http://localhost:8000
```

> 不要用 `file://` 打开，安全策略会阻止加载 `data/` 目录。

### 部署到 GitHub Pages

1. Push 到 GitHub 仓库
2. Settings → Pages → Source 选 **GitHub Actions**
3. `.github/workflows/deploy.yml` 已就绪，自动部署

---

## 使用流程

### 创建世界
1. 首页点击「进入世界」→ 顶部「+ 创建新世界」
2. 选择已有 IP 或原创、填写世界观描述、设定主角
3. 选择文风（模仿源文件/自定义/通用）和剧情自由度（1-5）
4. 可选：上传 EPUB/TXT/DOCX 源文件
5. 点击生成，AI 创建角色模板、知识库、开场白和初始选项

### 进行游戏
1. 世界列表中选择世界，点击「开始游戏」
2. 开场白打字呈现后，初始选项从左滑入
3. 自由打字或点选选项进行冒险
4. 每轮 AI 生成叙事 → 状态变更 → 新选项
5. 死亡后弹窗展示死因，可「查看结局」回顾全程

---

## 接入 AI

关闭「模拟模式」，填写：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| Base URL | `https://api.deepseek.com` | 兼容 OpenAI `/chat/completions` |
| API Key | — | 你的密钥 |
| 模型名称 | `deepseek-v4-flash` | 也支持 `deepseek-chat` |
| CORS 代理 | — | 浏览器 CORS 限制时填写 |
| 禁用流式 | 关 | CORS 代理不支持 SSE 时开启 |

### CORS 说明

- **生产**：Cloudflare AI Gateway 或自有反向代理
- **开发**：本地 Nginx / Cloudflare Tunnel
- **体验**：浏览器 CORS 插件（仅限本地）

---

## 示例世界

项目内置两个 demo：

| 世界 | 类型 | 简介 |
|---|---|---|
| 蒸汽与魔法 | 原创 | 已移除，替换为「星辉魔法学院」 |
| 星辉魔法学院 | 原创 | 翡翠森林中的千年魔法学院，七元素学派，恋爱冒险 |
| 红楼梦 · 大观园 | 已有 IP | 清代贾府，儿女情长、家族兴衰，20 条知识库 + 冲突事件 |

---

## 设计文档

| 文档 | 主题 |
|---|---|
| `docs/01_世界观生成指南.md` | 拆解和构建世界观 |
| `docs/02_知识库设计.md` | 知识库结构与检索策略 |
| `docs/03_System_Prompt工程.md` | LLM Prompt 设计原理 |
| `docs/04_RAG方案.md` | RAG 检索增强生成 |
| `docs/05_状态与数值设计.md` | 角色状态系统 |
| `docs/06_玩家行为记录与关键事实.md` | 对话记忆机制 |
| `docs/07_示例_魔法学院.md` | 星辉魔法学院世界观设定 |
| `docs/08_示例_红楼梦.md` | 红楼梦世界观设定 |

---

## 安全

- 所有用户输入经 `escapeHtml()` 转义，防 XSS
- API Key 仅存 localStorage，不上传
- `structuredClone()` / `crypto.randomUUID()` 安全克隆与 ID 生成

---

## 安全声明 ⚠️

**当前版本仅限个人本地使用或私下演示，不建议直接公开部署。**

| 风险 | 说明 | 对策 |
|------|------|------|
| **API Key 泄露** | API Key 存储在 `localStorage`，请求从浏览器直发。XSS 或恶意脚本可读取 Key。 | **仅限本地使用**；公开部署需自建代理 |
| **CDN 脚本注入** | 依赖 3 个 CDN 脚本（embedding、DOCX 解析、ZIP 解析） | 已加 `integrity` SRI 校验，防止篡改 |
| **第三方代理** | 如果使用第三方 CORS 代理，API Key 会经过该代理 | 自建 Cloudflare Workers / Nginx 代理更安全 |

### 安全部署建议

公开上线请使用以下方案之一：

**方案 A（推荐）：自建代理**
```
浏览器 → 你的后端（隐藏 API Key）→ DeepSeek API
```
- 后端用 Cloudflare Workers / Vercel Edge Function / 自有 VPS
- 后端持有 API Key，前端只发请求体

**方案 B：使用 CORS 代理**
在 API 配置弹窗中填写 CORS 代理 URL。代理端负责添加 Authorization 头并转发请求。

**方案 C：纯离线模式**
开启模拟模式，不使用任何 API Key。

---

## 开源协议

MIT License
