// ============================================================
// AetherNarrator · tools/compute-embeddings.mjs（★ P0-3-C：构建期预计算）
// 用 Node 端 transformers.js 计算「出厂默认世界」的中文向量，
// 输出 data/lore_kb_with_embeddings.json（512 维）。
// 与浏览器运行时同一模型/同一权重，维度与数值完全一致。
//
// 用法（managed node workspace 已装 @xenova/transformers）：
//   NODE_PATH=<workspace>/node_modules node tools/compute-embeddings.mjs
// ============================================================
import { pipeline, env } from "@xenova/transformers";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// 本机构建环境无法直连 huggingface.co，改用国内镜像拉取模型权重
env.remoteHost = "https://hf-mirror.com/";

const EMBED_MODEL = "Xenova/bge-small-zh-v1.5";
const EMBED_DIM = 512;

const root = fileURLToPath(new URL("..", import.meta.url));
const srcPath = root + "data/lore_kb.json";
const outPath = root + "data/lore_kb_with_embeddings.json";

const src = JSON.parse(await readFile(srcPath, "utf8"));
const extractor = await pipeline("feature-extraction", EMBED_MODEL);

for (const s of src.snippets || []) {
    const text = [s.category, s.title, s.content, (s.keywords || []).join(" ")]
        .filter(Boolean).join(" ");
    const out = await extractor(text, { pooling: "mean", normalize: true });
    s.embedding = Array.from(out.data);
    s.embedDim = EMBED_DIM;
    s.embedModel = EMBED_MODEL;
}

// 文件级标记，便于运行时一眼识别向量模型版本
src.embedModel = EMBED_MODEL;
src.embedDim = EMBED_DIM;

await writeFile(outPath, JSON.stringify(src, null, 2));
console.log(`✓ 已用 ${EMBED_MODEL} 重算 ${src.snippets.length} 条向量（${EMBED_DIM} 维）→ ${outPath}`);
