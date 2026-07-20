// ============================================================
// tools/compute-new-world-embeddings.mjs
// 为两个新世界（克苏鲁 + 都市怪谈）的 lore 条目计算 512 维向量
// 用法：
//   node tools/compute-new-world-embeddings.mjs
// ============================================================
import { pipeline, env } from "@xenova/transformers";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const _dirname = path.dirname(fileURLToPath(import.meta.url));
const _root = path.resolve(_dirname, "..");

// 使用本地模型（已量化，~24MB），不走远程下载
env.localModelPath = pathToFileURL(path.join(_root, "models")).href;
// 镜像
env.remoteHost = "https://hf-mirror.com/";

const EMBED_MODEL = "Xenova/bge-small-zh-v1.5";
const EMBED_DIM = 512;

async function computeEmbeddings() {
    // 动态导入新世界工厂
    const newWorldsModule = await import(pathToFileURL(path.join(_root, "src/new-worlds.js")).href);
    
    const worlds = [
        { name: "克苏鲁的呼唤", factory: newWorldsModule.createCthulhuWorld },
        { name: "都市怪谈·阈限空间", factory: newWorldsModule.createUrbanLegendWorld },
    ];

    console.log("Loading embedding model...");
    const extractor = await pipeline("feature-extraction", EMBED_MODEL);
    console.log("Model loaded.\n");

    for (const { name, factory } of worlds) {
        const world = factory();
        const snippets = world.lore_kb.snippets;
        console.log(`[${name}] Computing ${snippets.length} embeddings...`);

        for (let i = 0; i < snippets.length; i++) {
            const s = snippets[i];
            const text = [s.category, s.title, s.content, (s.keywords || []).join(" ")]
                .filter(Boolean).join(" ");
            const out = await extractor(text, { pooling: "mean", normalize: true });
            s.embedding = Array.from(out.data);
            s.embedDim = EMBED_DIM;
            s.embedModel = EMBED_MODEL;
            
            if ((i + 1) % 10 === 0 || i === snippets.length - 1) {
                console.log(`  ${i + 1}/${snippets.length}`);
            }
        }
    }

    // 输出嵌入结果 JSON
    const result = {};
    for (const { name, factory } of worlds) {
        const w = factory();
        result[w.id] = w.lore_kb.snippets.map(s => ({
            id: s.id,
            embedding: s.embedding,
            embedDim: s.embedDim,
            embedModel: s.embedModel
        }));
    }

    const outPath = path.join(_root, "data/new_world_embeddings.json");
    await writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(`\n✓ Embeddings saved to ${outPath}`);
    
    // 打印统计
    for (const [worldId, snippets] of Object.entries(result)) {
        console.log(`  ${worldId}: ${snippets.length} snippets with ${(snippets[0]?.embedding?.length || 0)}-dim embeddings`);
    }
}

computeEmbeddings().catch(e => {
    console.error("Failed:", e);
    process.exit(1);
});
