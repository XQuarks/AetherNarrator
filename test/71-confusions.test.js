// ★ 71 · 混淆点修复（创建向导 + 生成联动 + 编辑器提示）
// 覆盖：生成 prompt 的 locations 段随 map 模块开关切换、gm_truth 段阶段建议
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
};
globalThis.window = globalThis;

const { buildWorldGenerationPrompt } = await import("../src/prompt.js");

function buildPrompt(mods) {
    return buildWorldGenerationPrompt("雾港", "一座大雾海港城", "你", null, null, null, null, 3, null, "第二人称", 8000, null, null, mods);
}

// 提取第 11 节 locations 段（不含 gm_truth 段，避免误匹配其他"省略"字样）
function locSection(prompt) {
    const start = prompt.indexOf("11. locations");
    const end = prompt.indexOf("# 注意", start);
    return start >= 0 ? prompt.slice(start, end > start ? end : start + 500) : "";
}

test("生成 prompt：map 模块开启 → locations 段要求必须产出", () => {
    const sec = locSection(buildPrompt({ map: { enabled: true } }));
    assert.ok(sec.includes("必须产出 8~20 个地点"), "map 开启时应要求必须产出");
    assert.ok(!sec.includes("直接省略此字段"), "map 开启时 locations 段不应鼓励省略");
    assert.ok(!sec.includes("产出 8~20 个地点即可，也可以省略"), "map 开启时不应是可选语气");
});

test("生成 prompt：map 未开启/缺省 → locations 段保持可选", () => {
    const secOff = locSection(buildPrompt({ map: { enabled: false } }));
    assert.ok(secOff.includes("产出 8~20 个地点即可，也可以省略"), "map 关闭时保持可选");
    assert.ok(secOff.includes("直接省略此字段"), "map 关闭时提示可省略");
    const secDefault = locSection(buildPrompt(null));
    assert.ok(secDefault.includes("产出 8~20 个地点即可，也可以省略"), "缺省模块设置时保持可选（兼容旧调用）");
});

test("生成 prompt：gm_truth 段含阶段总数建议（防提前全剧透）", () => {
    const prompt = buildPrompt(null);
    assert.ok(prompt.includes("lore_stage_count"), "应提示同步配置阶段总数");
    assert.ok(prompt.includes("提前全部揭示"), "应警告提前揭示风险");
});
