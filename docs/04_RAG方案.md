# AI 文字游戏 · RAG 方案

RAG（Retrieval-Augmented Generation）是本游戏防止 AI 瞎编的核心机制。

## 1. RAG 流程

```
玩家输入
  │
  ▼
[预处理] 分词、提取地点/NPC/物品
  │
  ├───▶ 关键词检索（lore_kb.snippets）
  ├───▶ 向量检索（embedding）
  └───▶ 行为记录检索（behavior_records）
  │
  ▼
[融合排序] 综合分数，取 Top-K
  │
  ▼
[System Prompt] 注入检索结果
  │
  ▼
LLM 生成叙事 + 状态变更
  │
  ▼
提取关键事实 → 存入 behavior_records
```

## 2. 检索源

### 2.1 知识库（lore_kb）

- 静态数据，创建世界时生成。
- 包含规则、地点、人物、事件、物品、势力、世界观。
- 可手动维护。

### 2.2 玩家行为记录（behavior_records）

- 动态数据，游戏过程中积累。
- 记录玩家做过的事、获得/失去的物品、关系变化、到达的地点、完成的事件。
- 每次 LLM 返回后提取 `key_facts` 存入。

## 3. 检索方法

### 3.1 关键词检索

```javascript
function keywordRetrieve(input, topK) {
    const terms = input.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    snippets.map(s => {
        let score = 0;
        for (const t of terms) {
            if (text.includes(t)) score += 2;
            if (keywords.includes(t)) score += 3;
            if (title.includes(t)) score += 4;
        }
        return { snippet: s, score };
    });
}
```

### 3.2 向量检索

使用 `Xenova/all-MiniLM-L6-v2` 在浏览器端生成 embedding：

```javascript
embeddingModel = await transformers.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
const out = await embeddingModel(input, { pooling: "mean", normalize: true });
const qVec = Array.from(out.data);
// 计算与每条片段 embedding 的余弦相似度
```

### 3.3 行为记录检索

与关键词检索类似，但只匹配 behavior_records.text。

## 4. 融合排序

| 来源 | 权重 | 说明 |
|------|------|------|
| 关键词匹配 title | 4 | 高置信 |
| 关键词匹配 keywords | 3 | 中高置信 |
| 关键词匹配 content | 2 | 普通 |
| 向量相似度 Top | 2 | 语义相关 |
| 行为记录匹配 | 1.5 | 玩家历史 |

去重后按总分排序，取 Top-K（默认 8）。

## 5. 硬规则始终注入

以下片段无论检索分数如何都应注入：

- 力量体系核心规则（境界顺序、魔法限制等）。
- 玩家当前地点的 1-2 条相关描述。
- 当前涉及 NPC 的性格与态度。
- 世界观禁忌列表。

## 6. 关键事实摘要

每次 LLM 返回后，从 `state_changes` 和 `narrative` 中提取关键事实：

- 获得/失去物品
- 关系变化
- 地点变化
- 完成事件
- 死亡原因

存储格式：

```json
{
  "id": "b123",
  "text": "玩家在小镇入口获得了草药 x1",
  "createdAt": "2026-06-29T12:00:00Z"
}
```

## 7. 性能优化

- 浏览器端 embedding 首次加载较慢，建议提供「模拟模式」供快速体验。
- 行为记录上限设为 100 条，超过时保留最近记录。
- 知识库片段数量控制在 50-200 条，避免 prompt 过长。

## 8. 后续升级

- 使用更强大的 embedding 模型（bge-m3、Qwen Embedding）。
- 引入重排序（re-ranker）。
- 按 category 过滤检索结果。
- 支持多模态检索（图片、地图）。
