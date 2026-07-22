// S5-2：存储层必带字段保底（normalizeTimeConfig 落点）。
// 确保：gregorian/lunar 无起点 → 回退 day（不强制 1/1）；custom 无月历表 → 回退 day；
// multiverse 无 timelines → 回退 single；active_timeline 非法 → 取第一条存在的线。
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTimeConfig } from "../src/store.js";

test("S5-2: gregorian 无 calendar_start → 回退 day 模式（不强制 1/1）", () => {
    const cfg = normalizeTimeConfig({ calendar_mode: "gregorian" });
    assert.equal(cfg.calendar_mode, "day");
    assert.equal(cfg.calendar_start, null);
});

test("S5-2: lunar 无 calendar_start → 回退 day 模式", () => {
    const cfg = normalizeTimeConfig({ calendar_mode: "lunar" });
    assert.equal(cfg.calendar_mode, "day");
});

test("S5-2: custom_calendar 无月历表 → 回退 day 模式", () => {
    const cfg = normalizeTimeConfig({ calendar_mode: "custom_calendar" });
    assert.equal(cfg.calendar_mode, "day");
    assert.equal(cfg.custom_calendar, null);
});

test("S5-2: gregorian 带 calendar_start → 保持 gregorian", () => {
    const cfg = normalizeTimeConfig({ calendar_mode: "gregorian", calendar_start: { year: 1999, month: 1, date: 22 } });
    assert.equal(cfg.calendar_mode, "gregorian");
    assert.deepEqual(cfg.calendar_start, { year: 1999, month: 1, date: 22 });
});

test("S5-2: day 模式（无 start）→ 保持 day，不受保底影响", () => {
    const cfg = normalizeTimeConfig({ calendar_mode: "day" });
    assert.equal(cfg.calendar_mode, "day");
});

test("S5-2: multiverse 无 timelines → 回退 single", () => {
    const cfg = normalizeTimeConfig({ mode: "multiverse" });
    assert.equal(cfg.mode, "single");
    assert.equal(cfg.timelines, null);
});

test("S5-2: multiverse 有 timelines 但 active_timeline 非法 → 取第一条", () => {
    const cfg = normalizeTimeConfig({
        mode: "multiverse",
        active_timeline: "nope",
        timelines: { earth: { calendar_mode: "gregorian", calendar_start: { year: 2003, month: 1, date: 1 } } }
    });
    assert.equal(cfg.mode, "multiverse");
    assert.equal(cfg.active_timeline, "earth");
});

test("S5-2: 非 multiverse 模式带 timelines 字段 → 不保留 timelines", () => {
    const cfg = normalizeTimeConfig({ timelines: { earth: { calendar_mode: "day" } } });
    assert.equal(cfg.mode, "single");
    assert.equal(cfg.timelines, null);
});

test("S5-2: 默认（null）→ day 模式，calendar_start 为 null", () => {
    const cfg = normalizeTimeConfig(null);
    assert.equal(cfg.calendar_mode, "day");
    assert.equal(cfg.calendar_start, null);
});
