import test from "node:test";
import assert from "node:assert/strict";

import { advanceWorldTime, hydrateWorldTime } from "../src/time-engine.js";

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

test("显式倒退时间被拒绝并保持原状态", () => {
    const current = hydrateWorldTime({ day: 3, period: "afternoon", clock: "14:00" }, periods);
    const result = advanceWorldTime(current, { day: 2, period: "morning" }, periods);
    assert.equal(result.changed, false);
    assert.equal(result.rejected, true);
    assert.deepEqual(result.currentDate, current);
});

test("旧存档可从 day period clock 推导绝对分钟", () => {
    const hydrated = hydrateWorldTime({ day: 2, period: "evening", clock: "18:30" }, periods);
    assert.equal(hydrated.absolute_minutes, 2550);
    assert.equal(hydrated.clock, "18:30");
});
