# AI 文字游戏 - 纯前端 GitHub Pages 版

一个完全基于浏览器的 AI 文字游戏框架。无需服务器，所有数据（游戏存档、API Key、配置）均保存在浏览器本地。部署到 GitHub Pages 后，玩家打开网页即可游玩。

---

## 文件说明

| 文件/目录 | 用途 |
|---|---|
| `index.html` | 游戏本体：单页应用，包含界面、前端逻辑、LLM 调用、RAG 检索、状态管理。 |
| `data/initial_state.json` | 玩家初始状态模板：角色、属性、关系、技能、背包、目标、时间等。 |
| `data/lore_kb.json` | 知识库原始数据：世界观、规则、角色、地点、体系片段，带关键词。 |
| `data/lore_kb_with_embeddings.json` | 带向量 embedding 的知识库，用于语义检索（RAG）。 |
| `data/system_prompt_template.md` | System Prompt 模板，使用 `{IP_NAME}`、`{WORLD_RULES}` 等占位符。 |
| `tools/generate_embeddings.py` | 重新生成 `lore_kb_with_embeddings.json` 的脚本（需 Python + sentence-transformers）。 |
| `.github/workflows/deploy.yml` | GitHub Actions 自动部署到 GitHub Pages。 |
| `README.md` | 本文档。 |

---

## 快速开始

### 1. 本地测试

由于浏览器安全策略，直接用 `file://` 打开 `index.html` 无法加载 `data/` 目录下的 JSON 文件。请使用本地 HTTP 服务器：

```bash
# 进入项目目录
cd "AI文字游戏_纯前端GitHubPages版"

# 用 Python 启动本地服务器
python -m http.server 8000

# 浏览器打开 http://localhost:8000
```

### 2. 部署到 GitHub Pages

1. 在 GitHub 新建一个仓库，把这些文件上传。
2. 进入仓库 **Settings → Pages**。
3. Source 选择 **GitHub Actions**。
4. 已经配置好的 `.github/workflows/deploy.yml` 会自动把工作流跑起来。
5. 部署完成后，访问 `https://你的用户名.github.io/仓库名/` 即可。

> 注意：默认部署到 GitHub Pages 后，base URL 可能不是根路径。如果你的仓库名不是 `你的用户名.github.io`，需要修改 `index.html` 中 `fetch("data/...")` 的路径，加上仓库前缀。详情见下文的「部署路径」一节。

---

## 如何套用任意 IP

只需要改三个文件：

### 1. `data/initial_state.json`

填入你 IP 的初始状态：角色姓名、背景、属性、关系、技能、背包、起始地点、目标等。

### 2. `data/lore_kb.json`

把你的世界观资料写成片段。每个片段包含：

- `category`：世界观 / 规则 / 角色 / 地点 / 体系
- `title`：标题
- `content`：正文内容
- `keywords`：关键词数组，用于关键词检索

### 3. `data/system_prompt_template.md`

替换占位符：

- `{IP_NAME}`：IP 名称
- `{WORLD_RULES}`：世界观硬规则
- `{NARRATIVE_STYLE}`：叙事风格

`{GAME_STATE_JSON}`、`{RETRIEVED_LORE_SNIPPETS}`、`{PLAYER_INPUT}` 由前端自动填充，不需要改。

---

## 生成向量 Embedding（可选）

如果你新增了或修改了 `data/lore_kb.json`，可以重新生成向量检索用的 embedding 文件：

```bash
# 安装依赖（首次）
pip install sentence-transformers

# 设置 Hugging Face 国内镜像（可选，在中国大陆建议）
set HF_ENDPOINT=https://hf-mirror.com

# 生成 embedding
python tools/generate_embeddings.py
```

生成后，`data/lore_kb_with_embeddings.json` 会被更新。前端会自动使用它做语义检索。

---

## 玩家使用说明

### 模拟模式

默认开启。无需 API Key，前端会用内置的模拟逻辑生成剧情。适合体验和测试 UI。

### 真实 AI 模式

关闭「模拟模式」，填写以下三项：

- **Base URL**：你的 AI 接口地址，例如 `https://api.deepseek.com/v1`
- **API Key**：你的 API Key，例如 `sk-...`
- **模型名称**：例如 `deepseek-chat` 或 `qwen-turbo`

### 关于 CORS 的说明

由于浏览器安全策略，直接从前端调用 DeepSeek、OpenAI、通义千问等官方 API，通常会被 **CORS 拦截**。

**推荐解决方案**：

1. **使用 Cloudflare AI Gateway 或自己的反向代理**：在自定义域名下配置一个支持 CORS 的代理，把 Base URL 指向它。
2. **本地反向代理**：开发时在本地运行一个转发服务（例如 Nginx、Cloudflare tunnel）。
3. **浏览器插件**：仅在本地测试时，可安装「Allow CORS」类插件临时关闭限制（不推荐长期使用）。

### 数据安全

- API Key、游戏状态、配置全部保存在浏览器的 `localStorage` 中。
- 不会发送到任何服务器。
- 清除浏览器数据或换浏览器会丢失存档。

---

## 部署路径

如果你的 GitHub Pages 地址不是根路径（例如 `https://abc.github.io/my-game/`），需要修改 `index.html` 中所有 `fetch("data/...")` 的路径，加上仓库名前缀：

```js
// 根路径部署
fetch("data/lore_kb.json")

// 子路径部署（仓库名为 my-game）
fetch("/my-game/data/lore_kb.json")
```

也可以改成相对路径：

```js
fetch("./data/lore_kb.json")
```

推荐使用相对路径 `./data/...`，这样根路径和子路径都能兼容。

---

## 进阶升级方向

1. **Embedding 模型升级**：使用更大的 embedding 模型或训练领域特定向量。
2. **对话历史压缩**：长对话后做摘要，减少 LLM token 消耗。
3. **多存档槽**：支持多个存档槽位。
4. **NPC 日程系统**：NPC 按时间和地点出现，错过就见不到。
5. **多结局与目标链**：更复杂的目标和失败分支。
6. **UI 美化**：加入角色立绘、地图、BGM、音效。

---

## 技术栈

- 原生 HTML / CSS / JavaScript（无框架依赖）
- `@xenova/transformers`：浏览器端 embedding 模型（可选加载）
- `localStorage`：本地存档
- GitHub Pages：静态托管
- Python + sentence-transformers：生成知识库 embedding（开发工具）
