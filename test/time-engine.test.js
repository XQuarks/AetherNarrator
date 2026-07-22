import test from "node:test";
import assert from "node:assert/strict";

import { advanceWorldTime, hydrateWorldTime } from "../src/time-engine.js";
import { compareCalendar } from "../src/calendar.js";

const periods = ["morning", "forenoon", "afternoon", "evening", "night"];

test("从早晨推进到下午仍在同一天", () => {
    const current = hydrateWorldTime({ day: 1, period: "morning" }, periods);
    const result = advanceWorldTime(current, { period: "afternoon" }, periods);
    assert.equal(result.changed, true);
    assert.equal(result.currentDate.day, 1);
    assert.equal(result.currentDate.period, "afternoon");
});

test("行动耗时跨午夜时自动推进日期与时段", () => {
    const current = hydrateWorldTime({ day: 1, period: "night", clock: "20:00" }, periods);
    const result = advanceWorldTime(current, { elapsed_minutes: 600 }, periods);
    assert.equal(result.currentDate.day, 2);
    assert.equal(result.currentDate.clock, "06:00");
    assert.equal(result.currentDate.period, "morning");
});

test("显式倒退时间在方案 B 下被允许（时间倒流）", () => {
    const current = hydrateWorldTime({ day: 3, period: "afternoon", clock: "14:00" }, periods);
    const result = advanceWorldTime(current, { day: 2, period: "morning" }, periods);
    assert.equal(result.rejected, false);
    assert.equal(result.currentDate.day, 2);
    assert.equal(result.currentDate.period, "morning");
});

test("旧存档可从 day period clock 推导绝对分钟", () => {
    const hydrated = hydrateWorldTime({ day: 2, period: "evening", clock: "18:30" }, periods);
    assert.equal(hydrated.absolute_minutes, 2550);
    assert.equal(hydrated.clock, "18:30");
});

// ---------- dated 模式（方案 B：原生年/月/日，无隐藏序数）----------

const gregTc = { calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 }, custom_calendar: null };

test("gregorian：原生日期 +1 天（闭关/过夜）", () => {
    const cur = { year: 1926, month: 2, date: 2, period: "morning", step: 1 };
    const result = advanceWorldTime(cur, { addDays: 1 }, gregTc);
    assert.equal(result.rejected, false);
    assert.equal(result.currentDate.year, 1926);
    assert.equal(result.currentDate.month, 2);
    assert.equal(result.currentDate.date, 3);
    assert.equal(result.currentDate.step, 2);
});

test("gregorian：大段时间跳跃（修仙闭关 addMonths:3）", () => {
    const cur = { year: 2026, month: 2, date: 3, period: "morning", step: 1 };
    const result = advanceWorldTime(cur, { addMonths: 3 }, gregTc);
    assert.equal(result.currentDate.year, 2026);
    assert.equal(result.currentDate.month, 5);
    assert.equal(result.currentDate.date, 3);
});

test("gregorian：绝对跳转（车祸苏醒到 2004-06-16）", () => {
    const cur = { year: 1999, month: 1, date: 22, period: "morning", step: 1 };
    const result = advanceWorldTime(cur, { year: 2004, month: 6, date: 16 }, gregTc);
    assert.equal(result.currentDate.year, 2004);
    assert.equal(result.currentDate.month, 6);
    assert.equal(result.currentDate.date, 16);
});

test("gregorian：时间倒流（穿越回过去）被允许", () => {
    const cur = { year: 2004, month: 6, date: 16, period: "morning", step: 50 };
    const result = advanceWorldTime(cur, { year: 1999, month: 1, date: 22 }, gregTc);
    assert.equal(result.rejected, false);
    assert.equal(result.currentDate.year, 1999);
    assert.equal(result.currentDate.month, 1);
    assert.equal(result.currentDate.date, 22);
});

test("gregorian：compareCalendar 判定 deadline 到期（严格大于）", () => {
    const cur = { year: 1926, month: 2, date: 3 };
    const target = { year: 1926, month: 2, date: 2 };
    assert.equal(compareCalendar(cur, target, "gregorian", null) > 0, true);
    const justArrived = { year: 1926, month: 2, date: 2 };
    assert.equal(compareCalendar(justArrived, target, "gregorian", null), 0);
});

