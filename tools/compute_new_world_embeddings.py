# tools/compute_new_world_embeddings.py
# 为两个新世界计算向量嵌入（bge-small-zh-v1.5, 512维）
# 与游戏内 embed_model / embed_dim 一致
import json, sys, os
import numpy as np
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

# 导入 sentence-transformers
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("需要安装 sentence-transformers: pip install sentence-transformers")
    sys.exit(1)

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
EMBED_DIM = 512

print(f"Loading model: {MODEL_NAME}...")
model = SentenceTransformer(MODEL_NAME, trust_remote_code=True)

# 动态加载 new-worlds.js 不可能，改为直接嵌入 world 定义
# 我们从 new-worlds.js 手动提取 lore 条目
# 直接用 Node 生成带入参的 JSON 中间文件
print("Loading lore snippets from Node-generated JSON...")
input_path = ROOT / "data" / "new_world_snippets.json"
with open(input_path, "r", encoding="utf-8") as f:
    worlds_data = json.load(f)

for world_key, world in worlds_data.items():
    snippets = world["snippets"]
    print(f"\n[{world['name']}] Computing {len(snippets)} embeddings...")
    
    texts = []
    for s in snippets:
        text = " ".join(filter(None, [
            s.get("category", ""),
            s.get("title", ""),
            s.get("content", ""),
            " ".join(s.get("keywords", []))
        ]))
        texts.append(text)
    
    embeddings = model.encode(texts, normalize_embeddings=True)
    
    for s, emb in zip(snippets, embeddings):
        s["embedding"] = emb.tolist()
        s["embed_dim"] = EMBED_DIM
        s["embed_model"] = f"Xenova/{MODEL_NAME.split('/')[1]}"
    
    print(f"  Done. Embedding dim: {len(embeddings[0])}")

# 输出可注入的数据
output_path = ROOT / "data" / "new_world_embeddings.json"
# 仅保留嵌入元数据以便注入
result = {}
for world_key, world in worlds_data.items():
    result[world_key] = [
        {"id": s["id"], "embedding": s["embedding"], "embedDim": s["embed_dim"], "embedModel": s["embed_model"]}
        for s in world["snippets"]
    ]

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"\nSaved to {output_path}")
for wk, snippets in result.items():
    print(f"  {wk}: {len(snippets)} snippets, {len(snippets[0]['embedding'])}-dim")
