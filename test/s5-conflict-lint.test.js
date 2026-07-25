import { test } from "node:test";
import assert from "node:assert";
import { detectTimeConflict, formatConflictMessage } from "../src/utils.js";

function makeWorld({ opening = "", system_prompt = "", era = "", calendar_mode = "gregorian", calendar_start = null }) {
    return {
        schema: {
            opening_narrative: opening,
            system_prompt,
            time_config: { calendar_mode, calendar_start, era_label: era }
        }
    };
}

// 方案 22：年份锚点来自 era_label（年份归纪元），按 decade 容错；
// era_label 本身不再作为比对目标（避免「1920年代」被当硬年份误报）。

test("S5-4 写死年份与纪元 decade 不一致 → 命中 yearConflict", () => {
    // 纪元「1990年代」(decade 199)；剧情写死 1926 (decade 192) → 冲突
    const w = makeWorld({ opening: "1926 年的冬天，波士顿被浓雾笼罩。", era: "1990年代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.yearConflict.years, [1926]);
});

test("S5-4 用占位符 → 不命中（占位符豁免，且文本不含现代措辞/年份）", () => {
    const w = makeWorld({ opening: "故事始于{era_label}的一个清晨，雾气尚未散去。", era: "1990年代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, false);
});

test("S5-4 无年份文本 + 无起点(day) → 不命中", () => {
    const w = makeWorld({ opening: "故事从一个清晨开始。", calendar_mode: "day", calendar_start: null });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, false);
});

test("S5-4 system_prompt 含年份 + 纪元不符 → 命中", () => {
    const w = makeWorld({ opening: "序章", system_prompt: "本故事发生在 1926 年。", era: "1990年代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.yearConflict.years, [1926]);
});

test("S5-4 现代措辞 + 历史纪元 → absolutePhrase", () => {
    const w = makeWorld({ opening: "如今，这座城市依旧沉默。", era: "1920年代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.absolutePhrase, true);
    assert.strictEqual(r.conflict, true);
});

test("S5-4 formatConflictMessage 拼装含冲突年份", () => {
    const w = makeWorld({ opening: "1926 年的冬天。", era: "1990年代" });
    const r = detectTimeConflict(w);
    assert.ok(formatConflictMessage(r).includes("1926"));
});

test("S5-4 system_prompt 为数组也能安全扫描（不崩）", () => {
    const w = makeWorld({ opening: "序章", system_prompt: ["本故事发生在 1926 年。", "调查员登场。"], era: "1990年代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.yearConflict.years, [1926]);
});

// === 方案 22 新增：纪元锚定 + 同 decade 容错 ===

test("S5-4 era_label 本身不触发冲突（年份归纪元，纪元不作为比对目标）", () => {
    // 克苏鲁式：era_label=「1920年代」且开场白也提「1920年代」→ 不应误报
    const w = makeWorld({ opening: "1920年代，波士顿的浓雾里藏着不可名状的恐惧。", era: "1920年代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, false);
});

test("S5-4 同 decade 不冲突（1926 与 1920年代互通）", () => {
    const w = makeWorld({ opening: "1926 年的波士顿，调查刚刚开始。", era: "1920年代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, false);
});

test("S5-4 模糊纪元（无可解析年份）跳过年份比对，仅查现代措辞", () => {
    const w = makeWorld({ opening: "故事发生在久远的年代，英雄尚未登场。", era: "上古神话时代" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, false);
});
