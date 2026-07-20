// tools/extract-new-world-snippets.mjs
// 从 new-worlds.js 提取 lore snippets，输出为 JSON（供 Python 嵌入计算用）
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { writeFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const { createCthulhuWorld, createUrbanLegendWorld } = await import(pathToFileURL(path.join(root, "src/new-worlds.js")).href);

const worlds = {
    demo_cthulhu: { name: "克苏鲁的呼唤", factory: createCthulhuWorld },
    demo_urban_legend: { name: "都市怪谈·阈限空间", factory: createUrbanLegendWorld }
};

const result = {};
for (const [id, { name, factory }] of Object.entries(worlds)) {
    const w = factory();
    result[id] = {
        name,
        snippets: w.lore_kb.snippets.map(s => ({
            id: s.id,
            category: s.category,
            title: s.title,
            content: s.content,
            keywords: s.keywords || []
        }))
    };
}

const outPath = path.join(root, "data", "new_world_snippets.json");
await writeFile(outPath, JSON.stringify(result, null, 2));
console.log(`Extracted ${Object.keys(result).length} worlds' snippets to ${outPath}`);
for (const [id, w] of Object.entries(result)) {
    console.log(`  ${id} (${w.name}): ${w.snippets.length} snippets`);
}
