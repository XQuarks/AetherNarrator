// S5-4' + S5-7：开场白时间冲突一键修复 —— callRegenerateOpeningLLM 的 mock 行为
// 覆盖：regenerate / toPlaceholders 两种模式在模拟模式下返回结构正确，
// 且占位符版输出必含 {calendar_date}（docs/20 §14.5 要求）。
import { test } from "node:test";
import assert from "node:assert";
import { callRegenerateOpeningLLM } from "../src/llm.js";

// 让 llm.js 的 isMockMode() 在 node 下返回 true（不依赖真实 DOM）
globalThis.document = {
    getElementById: () => ({ checked: true })
};

function makeWorld(over) {
    return {
        name: "克苏鲁的呼唤",
        desc: "20 世纪初的波士顿，诡秘的低语在街巷间蔓延。",
        era_label: "二十世纪",
        opening_narrative: "1926 年的冬天，波士顿被迷雾笼罩。",
        schema: { time_config: { calendar_mode: "gregorian", calendar_start: { year: 1999, month: 1, date: 22 }, season: "冬季", era_label: "二十世纪" } },
        ...over
    };
}

test("S5-7 regenerate（模拟）：返回新开场白且含占位符", async () => {
    const w = makeWorld();
    const res = await callRegenerateOpeningLLM(w, w.schema.time_config, w.opening_narrative, "regenerate");
    assert.strictEqual(res.mode, "regenerate");
    assert.ok(typeof res.newOpening === "string" && res.newOpening.length > 0, "应返回非空新开场白");
    assert.ok(res.newOpening.includes("{calendar_date}"), "regenerate 结果应含 {calendar_date} 占位符便于校验");
});

test("S5-7 toPlaceholders（模拟）：输出必须含 {calendar_date}", async () => {
    const w = makeWorld();
    const res = await callRegenerateOpeningLLM(w, w.schema.time_config, w.opening_narrative, "toPlaceholders");
    assert.strictEqual(res.mode, "toPlaceholders");
    assert.ok(res.newOpening.includes("{calendar_date}"), "改成占位符版必须含 {calendar_date}（docs/20 §14.5）");
    assert.ok(res.newOpening.includes("{era_label}"), "占位符版应保持 {era_label}");
});

test("S5-7 两种模式均消耗一次调用且结构一致（{newOpening, mode}）", async () => {
    const w = makeWorld();
    for (const mode of ["regenerate", "toPlaceholders"]) {
        const res = await callRegenerateOpeningLLM(w, w.schema.time_config, w.opening_narrative, mode);
        assert.ok("newOpening" in res && "mode" in res, "返回结构应含 newOpening 与 mode");
        assert.strictEqual(res.mode, mode);
    }
});

test("S5-7 旧开场白为空也能生成（不抛错）", async () => {
    const w = makeWorld({ opening_narrative: "" });
    const res = await callRegenerateOpeningLLM(w, w.schema.time_config, "", "regenerate");
    assert.ok(typeof res.newOpening === "string");
});
