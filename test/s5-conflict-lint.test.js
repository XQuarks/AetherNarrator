import { test } from "node:test";
import assert from "node:assert";
import { detectTimeConflict, formatConflictMessage } from "../src/utils.js";

function makeWorld({ opening = "", system_prompt = "", era = "", calendar_mode = "gregorian", calendar_start = null, season = "" }) {
    return {
        schema: {
            opening_narrative: opening,
            system_prompt,
            time_config: { calendar_mode, calendar_start, season, era_label: era }
        }
    };
}

test("S5-4 写死年份与起点不一致 → 命中 yearConflict", () => {
    const w = makeWorld({ opening: "1926 年的冬天，波士顿被浓雾笼罩。", calendar_start: { year: 1999, month: 1, date: 22 } });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.yearConflict.years, [1926]);
});

test("S5-4 用占位符 → 不命中（占位符豁免，且文本不含现代措辞/年份）", () => {
    const w = makeWorld({ opening: "故事始于{era_label}的一个{season}清晨，雾气尚未散去。", calendar_start: { year: 1999, month: 1, date: 22 } });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, false);
});

test("S5-4 季节不符 → seasonConflict", () => {
    const w = makeWorld({ opening: "那是冬季最冷的一天。", calendar_start: { year: 1999, month: 1, date: 22 }, season: "夏季" });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.seasonConflict.words, ["冬季"]);
});

test("S5-4 无年份文本 + 无起点(day) → 不命中", () => {
    const w = makeWorld({ opening: "故事从一个清晨开始。", calendar_mode: "day", calendar_start: null });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, false);
});

test("S5-4 system_prompt 含年份 + 起点不符 → 命中", () => {
    const w = makeWorld({ opening: "序章", system_prompt: "本故事发生在 1926 年。", calendar_start: { year: 1999, month: 1, date: 22 } });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.yearConflict.years, [1926]);
});

test("S5-4 现代措辞 + 历史世界 → absolutePhrase", () => {
    const w = makeWorld({ opening: "如今，这座城市依旧沉默。", calendar_start: { year: 1926, month: 2, date: 2 } });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.absolutePhrase, true);
    assert.strictEqual(r.conflict, true);
});

test("S5-4 formatConflictMessage 拼装含冲突年份", () => {
    const w = makeWorld({ opening: "1926 年的冬天。", calendar_start: { year: 1999, month: 1, date: 22 } });
    const r = detectTimeConflict(w);
    assert.ok(formatConflictMessage(r).includes("1926"));
});

test("S5-4 system_prompt 为数组也能安全扫描（不崩）", () => {
    const w = makeWorld({ opening: "序章", system_prompt: ["本故事发生在 1926 年。", "调查员登场。"], calendar_start: { year: 1999, month: 1, date: 22 } });
    const r = detectTimeConflict(w);
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.yearConflict.years, [1926]);
});
