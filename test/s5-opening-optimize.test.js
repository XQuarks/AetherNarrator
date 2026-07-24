// 新功能：剧情向优化开场白 —— callOptimizeOpeningLLM 的 mock 行为
// 覆盖：模拟模式返回结构正确、含占位符、旧开场白为空也不抛错。
import { test } from "node:test";
import assert from "node:assert";
import { callOptimizeOpeningLLM } from "../src/llm.js";

// 让 llm.js 的 isMockMode() 在 node 下返回 true（不依赖真实 DOM）
globalThis.document = {
    getElementById: () => ({ checked: true })
};

function makeWorld(over) {
    return {
        name: "双界 · 现实与异界",
        desc: "你是一名普通的现代青年，却拥有在两个世界之间往返的意识。",
        era_label: "公元2003年",
        opening_narrative: "公元 2003 年，江城。你被闹钟拽醒时，窗外还是灰蒙蒙的。",
        schema: { time_config: { mode: "multiverse", era_label: "公元2003年", season: "春季", calendar_start: { year: 2003, month: 3, date: 15 } } },
        lore_kb: { snippets: [{ title: "双界时间各自流淌", content: "现实与异界是两条相互独立的时间线。" }] },
        ...over
    };
}

test("剧情向优化（模拟）：返回结构 {newOpening, mode:'optimize'} 且含占位符", async () => {
    const w = makeWorld();
    const res = await callOptimizeOpeningLLM(w, w.opening_narrative);
    assert.strictEqual(res.mode, "optimize");
    assert.ok(typeof res.newOpening === "string" && res.newOpening.length > 0, "应返回非空新开场白");
    assert.ok(res.newOpening.includes("{calendar_date}"), "优化结果应含 {calendar_date} 占位符便于校验");
    assert.ok(res.newOpening.includes("{era_label}"), "优化结果应保持 {era_label} 占位符");
    assert.ok(res.newOpening.includes("{season}"), "优化结果应保持 {season} 占位符");
});

test("剧情向优化：旧开场白为空也能生成（不抛错）", async () => {
    const w = makeWorld({ opening_narrative: "" });
    const res = await callOptimizeOpeningLLM(w, "");
    assert.ok(typeof res.newOpening === "string");
    assert.strictEqual(res.mode, "optimize");
});

test("剧情向优化：opts.focus 不影响返回结构", async () => {
    const w = makeWorld();
    const res = await callOptimizeOpeningLLM(w, w.opening_narrative, { focus: "强化双界拉扯感" });
    assert.strictEqual(res.mode, "optimize");
    assert.ok(res.newOpening.length > 0);
});
