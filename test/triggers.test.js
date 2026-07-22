import { test } from "node:test";
import assert from "node:assert";
import {
    normalizeTriggeredEvents, getTimelineTriggered, evalPolicy,
    recordTrigger, resetTriggers, createBranch
} from "../src/triggers.js";
import { collectDueDeadlines } from "../src/time-engine.js";

const PERIODS = ["morning", "forenoon", "afternoon", "evening", "night"];

test("S1 不重触发：已触发的一次性事件穿回去不再重放", () => {
    const state = { triggered_event_ids: { main: ["ev_a"] }, retrigger_state: { main: {} }, branches: {} };
    const rec = getTimelineTriggered(state, "main");
    const due = collectDueDeadlines(
        { day: 5, period: "morning" },
        [
            { id: "ev_a", title: "生日", day: 5, period: "morning" },
            { id: "ev_b", title: "比武", day: 5, period: "morning" }
        ],
        PERIODS, rec.ids, rec.state, 5
    );
    assert.deepEqual(due.map(d => d.id), ["ev_b"]); // ev_a 已触发，不重放
});

test("S1 evalPolicy once：未触发 due，已触发不 due", () => {
    assert.equal(evalPolicy({ id: "x" }, new Set(), {}, 1).due, true);
    assert.equal(evalPolicy({ id: "x" }, new Set(["x"]), {}, 1).due, false);
});

test("S2 可重复：超次数停止 + 冷却生效", () => {
    const dl = {
        id: "r", title: "商情", day: 1, period: "morning",
        retrigger_policy: { mode: "repeatable", max_repeats: 2, cooldown_steps: 1 }
    };
    const state = { triggered_event_ids: { main: [] }, retrigger_state: { main: {} }, branches: {} };
    // 第一次（未触发）→ due
    let rec = getTimelineTriggered(state, "main");
    assert.equal(collectDueDeadlines({ day: 1, period: "morning" }, [dl], PERIODS, rec.ids, rec.state, 1).length, 1);
    recordTrigger(state, "r", 1, "main");
    // 同 step（冷却未过）→ 不 due
    rec = getTimelineTriggered(state, "main");
    assert.equal(collectDueDeadlines({ day: 1, period: "morning" }, [dl], PERIODS, rec.ids, rec.state, 1).length, 0);
    // step+1（冷却过）→ due（第二次）
    rec = getTimelineTriggered(state, "main");
    assert.equal(collectDueDeadlines({ day: 1, period: "morning" }, [dl], PERIODS, rec.ids, rec.state, 2).length, 1);
    recordTrigger(state, "r", 2, "main");
    // step+2（次数已 2 = max）→ 不 due
    rec = getTimelineTriggered(state, "main");
    assert.equal(collectDueDeadlines({ day: 1, period: "morning" }, [dl], PERIODS, rec.ids, rec.state, 3).length, 0);
});

test("S3 重置回放：reset_triggers:all 后事件可再次触发", () => {
    const state = {
        triggered_event_ids: { main: ["ev_a"] },
        retrigger_state: { main: { ev_a: { count: 1, lastStep: 1 } } },
        branches: {}
    };
    resetTriggers(state, "all", "main");
    assert.deepEqual(state.triggered_event_ids.main, []);
    assert.deepEqual(state.retrigger_state.main, {});
    const rec = getTimelineTriggered(state, "main");
    const due = collectDueDeadlines(
        { day: 3, period: "morning" },
        [{ id: "ev_a", title: "节点", day: 3, period: "morning" }],
        PERIODS, rec.ids, rec.state, 3
    );
    assert.equal(due.length, 1); // 重置后可重触发
});

test("S3 重置指定事件：只回滚名单内", () => {
    const state = {
        triggered_event_ids: { main: ["a", "b"] },
        retrigger_state: { main: { a: { count: 1, lastStep: 1 }, b: { count: 1, lastStep: 1 } } },
        branches: {}
    };
    resetTriggers(state, ["a"], "main");
    assert.deepEqual(state.triggered_event_ids.main, ["b"]);
    assert.equal(state.retrigger_state.main.a, undefined);
    assert.ok(state.retrigger_state.main.b);
});

test("S4 分支隔离：新建分支独立触发记录，父线原记录保留", () => {
    const state = {
        active_timeline: "main",
        current_date: { day: 5, period: "morning" },
        triggered_event_ids: { main: ["ev_a"] },
        retrigger_state: { main: {} },
        branches: {}
    };
    const branchId = createBranch(state, "异界", { day: 5, period: "morning" });
    assert.equal(state.active_timeline, branchId);
    assert.equal(state.triggered_event_ids[branchId].length, 0); // 分支独立、空
    assert.deepEqual(state.triggered_event_ids.main, ["ev_a"]); // 父线保留
    assert.ok(state.branches.main); // 父线日期已记录，便于切回
    // 分支上 ev_a 仍可触发（隔离）
    const rec = getTimelineTriggered(state, branchId);
    const due = collectDueDeadlines(
        { day: 5, period: "morning" },
        [{ id: "ev_a", title: "节点", day: 5, period: "morning" }],
        PERIODS, rec.ids, rec.state, 5
    );
    assert.equal(due.length, 1);
});

test("S4 多世界：不同时间线触发记录互不干扰", () => {
    const state = {
        active_timeline: "earth",
        triggered_event_ids: { main: ["x"], earth: [] },
        retrigger_state: { main: {}, earth: {} },
        branches: {}
    };
    let rec = getTimelineTriggered(state, "earth");
    assert.equal(collectDueDeadlines(
        { day: 2, period: "morning" },
        [{ id: "x", title: "t", day: 2, period: "morning" }],
        PERIODS, rec.ids, rec.state, 2
    ).length, 1);
    rec = getTimelineTriggered(state, "main");
    assert.equal(collectDueDeadlines(
        { day: 2, period: "morning" },
        [{ id: "x", title: "t", day: 2, period: "morning" }],
        PERIODS, rec.ids, rec.state, 2
    ).length, 0);
});

test("向后兼容：旧档 flat triggered_deadlines 迁移为 main", () => {
    const state = { triggered_deadlines: ["old1", "old2"] };
    normalizeTriggeredEvents(state);
    assert.deepEqual(state.triggered_event_ids.main, ["old1", "old2"]);
    assert.equal(state.triggered_deadlines, undefined);
    assert.deepEqual(state.retrigger_state.main, {});
});

test("collectDueDeadlines 向后兼容：仅传 4 参（Set）仍工作", () => {
    const due = collectDueDeadlines(
        { day: 2, period: "afternoon" },
        [
            { id: "d1", title: "午后赴宴", day: 2, period: "afternoon" },
            { id: "d2", title: "第三日比武", day: 3, period: "morning" }
        ],
        PERIODS,
        new Set(["already"])
    );
    assert.deepEqual(due.map(i => i.id), ["d1"]);
});
