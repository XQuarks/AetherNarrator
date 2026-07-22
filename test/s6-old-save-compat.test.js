// S6-2 · 旧档兼容回归：旧 {day} 存档不崩 + 新档存读一致
// 锁定 calendar.js 的 normalizeCurrentDate / backfillCurrentDate 兜底行为，
// 并验证三个预设工厂构造后规范化不崩、形状合法。
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCurrentDate, backfillCurrentDate, ensureCurrentDate } from "../src/calendar.js";
import { createCthulhuWorld, createUrbanLegendWorld, createDualWorld } from "../src/new-worlds.js";

// ---------- 旧档兜底：none 模式 ----------
test("S6-2 none 旧档 {day,period} → normalizeCurrentDate 得 {step} 不崩", () => {
    const tc = { calendar_mode: "none", calendar_start: null };
    const r = normalizeCurrentDate({ day: 1, period: "afternoon" }, tc);
    assert.equal(r.period, "afternoon");
    assert.equal(typeof r.step, "number");
    assert.ok(Number.isFinite(r.step));
});

test("S6-2 none 旧档 step 缺失时 ensureCurrentDate 兜底为 1", () => {
    const tc = { calendar_mode: "none" };
    const r = ensureCurrentDate({ period: "night" }, tc);
    assert.equal(r.period, "night");
    assert.equal(r.step, 1);
});

// ---------- 旧档回推：dated 模式 ----------
test("S6-2 dated 旧档 {day} + calendar_start → 回推原生年月日", () => {
    const tc = { calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 } };
    // 第 5 天 = 1926-02-02 + 4 天 = 1926-02-06
    const r = backfillCurrentDate({ day: 5, period: "night" }, tc);
    assert.equal(r.year, 1926);
    assert.equal(r.month, 2);
    assert.equal(r.date, 6);
    assert.equal(r.period, "night");
    assert.equal(r.step, 5);
});

test("S6-2 normalizeCurrentDate 对 dated 旧档触发回推（去残留 day）", () => {
    const tc = { calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 } };
    const r = normalizeCurrentDate({ day: 5, period: "night" }, tc);
    assert.equal(r.year, 1926);
    assert.equal(r.month, 2);
    assert.equal(r.date, 6);
    assert.equal(r.step, 5);
    assert.equal(r.day, undefined); // 回推后应去掉旧 day 字段
});

// ---------- 预设工厂适配 ----------
test("S6-2 后室预设 current_date 为原生 {step,period} 且规范化不崩", () => {
    const w = createUrbanLegendWorld();
    const tc = w.schema.time_config;
    assert.equal(tc.calendar_mode, "none");
    const r = normalizeCurrentDate(w.initial_state.current_date, tc);
    assert.equal(typeof r.step, "number");
    assert.equal(r.period, "afternoon");
    // 任务截止也应为 {step}
    for (const g of w.initial_state.goals) {
        assert.ok("step" in g.deadline, `goal ${g.goal_id} 截止应为 step 形状`);
    }
});

test("S6-2 克苏鲁预设为原生 dated 形状且规范化不崩", () => {
    const w = createCthulhuWorld();
    const tc = w.schema.time_config;
    assert.equal(tc.calendar_mode, "gregorian");
    const r = normalizeCurrentDate(w.initial_state.current_date, tc);
    assert.equal(r.year, 1926);
    assert.equal(r.month, 2);
    assert.equal(r.date, 2);
    // 开场白已去硬编码为占位符
    assert.ok(w.opening_narrative.includes("{calendar_year}年的冬天"));
});

test("S6-2 双世界预设规范化不崩且目标截止为 {step}", () => {
    const w = createDualWorld();
    const tc = w.schema.time_config;
    assert.equal(tc.mode, "multiverse");
    const r = normalizeCurrentDate(w.initial_state.current_date, tc);
    assert.ok(Number.isFinite(r.step) || r.year != null, "双世界 current_date 规范化应合法");
    for (const g of w.initial_state.goals) {
        assert.ok("step" in g.deadline, `goal ${g.goal_id} 截止应为 step 形状`);
    }
});

// ---------- 新档存读一致 ----------
test("S6-2 原生新档 normalizeCurrentDate 往返保持一致", () => {
    const tc = { calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 } };
    const native = { year: 1926, month: 2, date: 2, period: "morning", step: 1 };
    const r = normalizeCurrentDate(native, tc);
    assert.equal(r.year, 1926);
    assert.equal(r.month, 2);
    assert.equal(r.date, 2);
    assert.equal(r.period, "morning");
    assert.equal(r.step, 1);
});

test("S6-2 原生 none 新档 {step} normalizeCurrentDate 往返一致", () => {
    const tc = { calendar_mode: "none" };
    const native = { step: 7, period: "night" };
    const r = normalizeCurrentDate(native, tc);
    assert.equal(r.step, 7);
    assert.equal(r.period, "night");
});
