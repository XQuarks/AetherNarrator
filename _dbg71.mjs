const { buildWorldGenerationPrompt } = await import("./src/prompt.js");
const p = buildWorldGenerationPrompt("雾港", "一座大雾海港城", "你", null, null, null, null, 3, null, "第二人称", 8000, null, null, { map: { enabled: true } });
const locIdx = p.indexOf("11. locations");
console.log(JSON.stringify(p.slice(locIdx, locIdx + 400)));
