import test from "node:test";
import assert from "node:assert/strict";
import { S } from "../src/store.js";
import { normalizeTimeConfig } from "../src/store.js";
import { getTimeConfig, ensureTimelineState } from "../src/theme.js";
import { advanceWorldTime } from "../src/time-engine.js";
import { createDualWorld } from "../src/new-worlds.js";

function setDualWorld(active = "earth") {
    S.currentWorld = createDualWorld();
    S.gameState = { current_date: { step: 1, period: "morning" }, timelines: null, active_timeline: null };
    S.gameState.active_timeline = active;
}

test("normalizeTimeConfig 保留 multiverse 结构与 active_timeline", () => {
    const cfg = normalizeTimeConfig({
        mode: "multiverse",
        active_timeline: "xianxia",
        timelines: {
            earth: { name: "现实", calendar_mode: "gregorian", calendar_start: { year: 2003, month: 1, date: 1 }, current_date: { year: 2003, month: 3, date: 15 } },
            xianxia: { name: "异界", calendar_mode: "lunar", current_date: { year: 3024, month: 1, date: 1 } }
        }
    });
    assert.equal(cfg.mode, "multiverse");
    assert.equal(cfg.active_timeline, "xianxia");
    assert.equal(cfg.timelines.earth.calendar_mode, "gregorian");
    assert.equal(cfg.timelines.xianxia.calendar_mode, "lunar");
    assert.equal(cfg.timelines.earth.name, "现实");
});

test("getTimeConfig 按 active 时间线解析 calendar_mode（切换即变）", () => {
    setDualWorld("earth");
    let tc = getTimeConfig();
    assert.equal(tc.timeConfig.calendar_mode, "gregorian");
    assert.equal(tc.active_timeline, "earth");
    assert.ok(tc.timelines && tc.timelines.earth && tc.timelines.xianxia);

    S.gameState.active_timeline = "xianxia";
    tc = getTimeConfig();
    assert.equal(tc.timeConfig.calendar_mode, "lunar");
    assert.equal(tc.active_timeline, "xianxia");
});

test("ensureTimelineState 初始化全线 current_date 并令 current_date = active 线", () => {
    setDualWorld("earth");
    const tc = getTimeConfig();
    ensureTimelineState(S.gameState, tc);
    assert.ok(S.gameState.timelines.earth && S.gameState.timelines.xianxia);
    assert.deepEqual(S.gameState.current_date, S.gameState.timelines.earth.current_date);
    assert.equal(S.gameState.current_date.year, 2003);
    assert.equal(S.gameState.current_date.month, 3);
    assert.equal(S.gameState.current_date.date, 15);
});

test("多世界：各线独立推进，切换互不丢进度", () => {
    setDualWorld("earth");
    let tc = getTimeConfig();
    ensureTimelineState(S.gameState, tc);

    // 现实线推进 10 天（3/15 → 3/25）
    const r1 = advanceWorldTime(S.gameState.current_date, { addDays: 10 }, { ...tc.timeConfig, periods: tc.periods });
    S.gameState.current_date = r1.currentDate;
    S.gameState.timelines.earth.current_date = r1.currentDate;

    // 切到异界（仍为开局 3024-01-01）
    S.gameState.active_timeline = "xianxia";
    S.gameState.current_date = S.gameState.timelines.xianxia.current_date;
    assert.equal(S.gameState.current_date.year, 3024);

    // 异界推进 1 个月（1/1 → 2/1）
    tc = getTimeConfig();
    const r2 = advanceWorldTime(S.gameState.current_date, { addMonths: 1 }, { ...tc.timeConfig, periods: tc.periods });
    S.gameState.timelines.xianxia.current_date = r2.currentDate;

    // 切回现实，进度仍在（3/25）
    S.gameState.active_timeline = "earth";
    S.gameState.current_date = S.gameState.timelines.earth.current_date;
    assert.equal(S.gameState.current_date.year, 2003);
    assert.equal(S.gameState.current_date.month, 3);
    assert.equal(S.gameState.current_date.date, 25);

    // 异界进度也仍在（2/1）
    assert.equal(S.gameState.timelines.xianxia.current_date.month, 2);
    assert.equal(S.gameState.timelines.xianxia.current_date.date, 1);
});

test("非多世界世界：ensureTimelineState 为 no-op，不动 current_date", () => {
    S.currentWorld = { id: "w1", time_config: { calendar_mode: "gregorian", calendar_start: { year: 1999, month: 1, date: 22 } }, periods: ["morning", "night"] };
    S.gameState = { current_date: { year: 1999, month: 1, date: 22, period: "morning" }, timelines: null };
    const tc = getTimeConfig();
    ensureTimelineState(S.gameState, tc);
    assert.equal(S.gameState.timelines, null);
    assert.equal(S.gameState.current_date.year, 1999);
});
