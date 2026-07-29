// 时间系统进阶 UI-3/4/5 · 纯函数回归测试（docs/44 范围 A）。
// 锁定：流速比同步（UI-3）、世界级默认穿越策略（UI-4）、retrigger_policy 归一化（UI-5）
// 的底层逻辑，确保编辑器改动不破坏 time_config 数据形状与引擎行为。仅测纯函数，不触及 DOM。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    calendarDayIndex,
    applySyncRules,
    clampSyncRules,
    clampTimelineLine,
    addCalendar,
} from "../src/calendar.js";
import { resolveTimeTravelStrategy } from "../src/triggers.js";
import { normalizeRetriggerPolicy, normalizeTimeConfig } from "../src/store.js";

// ---------- UI-3：calendarDayIndex（仅校验相对增量；引擎历元含 year 0，绝对序号非 0）----------
test("calendarDayIndex：gregorian 相对增量正确（+1日=+1，跨闰年 2 月=+29）", () => {
    const idx = calendarDayIndex({ year: 2003, month: 3, date: 15 }, "gregorian");
    assert.ok(idx > 0);
    // 同年 +1 日，序号 +1
    const idx2 = calendarDayIndex({ year: 2003, month: 3, date: 16 }, "gregorian");
    assert.equal(idx2 - idx, 1);
    // 同年 +1 月（3→4，3月31天），序号 +31
    const idx3 = calendarDayIndex({ year: 2003, month: 4, date: 15 }, "gregorian");
    assert.equal(idx3 - idx, 31);
    // 跨闰年 2 月：2004-03-01 与 2004-02-01 相差 29 天（2004 闰年）
    const feb = calendarDayIndex({ year: 2004, month: 2, date: 1 }, "gregorian");
    const mar = calendarDayIndex({ year: 2004, month: 3, date: 1 }, "gregorian");
    assert.equal(mar - feb, 29);
});

// ---------- UI-3：applySyncRules（day 模式）----------
test("applySyncRules：day 模式按 ratio 同步参照线 step", () => {
    const timelines = {
        earth: { calendar_mode: "day", current_date: { step: 5 } },
        xianxia: { calendar_mode: "day", current_date: { step: 1 }, sync_rules: [{ ref: "earth", ratio: 365 }] }
    };
    // xianxia（源）推进 1 日 ⇒ earth 推进 365 日
    applySyncRules(timelines, "xianxia", 1);
    assert.equal(timelines.earth.current_date.step, 5 + 365);
    // 源线自身 current_date 不变（由外层推进）
    assert.equal(timelines.xianxia.current_date.step, 1);
});

// ---------- UI-3 回归：addCalendar 跨闰年 2 月不得差一天（修复 addByTable 静态月表 bug）----------
test("addCalendar：大天数增量跨闰年 2 月精确（+365 天落到前一日，非多 1 天）", () => {
    // 2003-03-15 + 365 天 = 2004-03-14（区间含 2004 闰年 2 月 29 日，整年跨度 366 天）
    assert.deepEqual(addCalendar({ year: 2003, month: 3, date: 15 }, { days: 365 }, "gregorian"), { year: 2004, month: 3, date: 14 });
    // 2004-02-28 + 2 天 = 2004-03-01（跨越闰年 29 日）
    assert.deepEqual(addCalendar({ year: 2004, month: 2, date: 28 }, { days: 2 }, "gregorian"), { year: 2004, month: 3, date: 1 });
});

// ---------- UI-3：applySyncRules（dated 模式）----------
test("applySyncRules：dated 模式按 ratio 同步参照线日历日", () => {
    const timelines = {
        earth: { calendar_mode: "gregorian", current_date: { year: 2003, month: 3, date: 15 } },
        xianxia: { calendar_mode: "lunar", current_date: { year: 3024, month: 1, date: 1 }, sync_rules: [{ ref: "earth", ratio: 365 }] }
    };
    const before = calendarDayIndex(timelines.earth.current_date, "gregorian");
    applySyncRules(timelines, "xianxia", 1);
    const after = calendarDayIndex(timelines.earth.current_date, "gregorian");
    assert.equal(after - before, 365);
});

// ---------- UI-3：applySyncRules 边界 ----------
test("applySyncRules：无 sync_rules / deltaDays=0 / 自指 / 非法 ref 均安全跳过", () => {
    const a = { earth: { calendar_mode: "day", current_date: { step: 1 } }, x: { calendar_mode: "day", current_date: { step: 1 } } };
    assert.equal(applySyncRules(a, "x", 0), a); // delta 0 短路
    const b = { earth: { calendar_mode: "day", current_date: { step: 1 } } };
    assert.equal(applySyncRules(b, "earth", 5), b); // 源无 sync_rules
    const c = {
        earth: { calendar_mode: "day", current_date: { step: 1 } },
        x: { calendar_mode: "day", current_date: { step: 1 }, sync_rules: [{ ref: "x", ratio: 2 }, { ref: "missing", ratio: 2 }] }
    };
    applySyncRules(c, "x", 1); // 自指/缺失 ref 跳过，earth 不变
    assert.equal(c.earth.current_date.step, 1);
});

// ---------- UI-3：clampSyncRules ----------
test("clampSyncRules：丢弃自指 / 缺失 ref / ratio<=0 的规则", () => {
    const tc = {
        timelines: {
            a: { sync_rules: [{ ref: "b", ratio: 2 }, { ref: "a", ratio: 3 }, { ref: "missing", ratio: 1 }, { ref: "b", ratio: 0 }] },
            b: { sync_rules: [] }
        }
    };
    clampSyncRules(tc);
    assert.deepEqual(tc.timelines.a.sync_rules, [{ ref: "b", ratio: 2 }]);
});

// ---------- UI-4：resolveTimeTravelStrategy ----------
test("resolveTimeTravelStrategy：指令层最高优先级（reset/branch 显式 → null）", () => {
    assert.equal(resolveTimeTravelStrategy({ reset_triggers: "all" }, { default_timetravel_strategy: "branch" }, "x"), null);
    assert.equal(resolveTimeTravelStrategy({ branch: true }, { default_timetravel_strategy: "reset" }, "x"), null);
});

test("resolveTimeTravelStrategy：线级覆盖 > 世界级默认 > keep 回落", () => {
    // 线级 branch 覆盖世界级 reset
    assert.equal(resolveTimeTravelStrategy(null, { default_timetravel_strategy: "reset", timelines: { x: { timetravel_strategy: "branch" } } }, "x"), "branch");
    // 线级未设(null) ⇒ 世界级 reset 生效
    assert.equal(resolveTimeTravelStrategy(null, { default_timetravel_strategy: "reset", timelines: { x: { timetravel_strategy: null } } }, "x"), "reset");
    // 线级 keep ⇒ keep
    assert.equal(resolveTimeTravelStrategy(null, { default_timetravel_strategy: "reset", timelines: { x: { timetravel_strategy: "keep" } } }, "x"), "keep");
    // 世界级 keep + 无线覆盖 ⇒ keep 回落
    assert.equal(resolveTimeTravelStrategy(null, { default_timetravel_strategy: "keep" }, "x"), "keep");
    // 完全缺省 tc ⇒ keep 回落
    assert.equal(resolveTimeTravelStrategy(null, {}, "x"), "keep");
});

// ---------- UI-5：normalizeRetriggerPolicy ----------
test("normalizeRetriggerPolicy：once 与非对象回落 'once'", () => {
    assert.equal(normalizeRetriggerPolicy("once"), "once");
    assert.equal(normalizeRetriggerPolicy(null), "once");
    assert.equal(normalizeRetriggerPolicy({ mode: "nope" }), "once");
});

test("normalizeRetriggerPolicy：repeatable 夹紧 max_repeats/cooldown_steps", () => {
    assert.deepEqual(normalizeRetriggerPolicy({ mode: "repeatable", max_repeats: 3, cooldown_steps: 2 }), { mode: "repeatable", max_repeats: 3, cooldown_steps: 2 });
    const neg = normalizeRetriggerPolicy({ mode: "repeatable", max_repeats: -5, cooldown_steps: -9 });
    assert.equal(neg.mode, "repeatable");
    assert.equal(neg.max_repeats, 1);
    assert.equal(neg.cooldown_steps, 0);
});

// ---------- UI-4/5：normalizeTimeConfig 落点 ----------
test("normalizeTimeConfig：default_timetravel_strategy 缺省 keep，仅接受 keep/reset/branch", () => {
    assert.equal(normalizeTimeConfig({}).default_timetravel_strategy, "keep");
    assert.equal(normalizeTimeConfig({ default_timetravel_strategy: "branch" }).default_timetravel_strategy, "branch");
    assert.equal(normalizeTimeConfig({ default_timetravel_strategy: "reset" }).default_timetravel_strategy, "reset");
    assert.equal(normalizeTimeConfig({ default_timetravel_strategy: "bogus" }).default_timetravel_strategy, "keep");
});

test("normalizeTimeConfig：deadlines 的 retrigger_policy 归一化（once / repeatable）", () => {
    const cfg = normalizeTimeConfig({
        deadlines: [
            { title: "魔王复活", retrigger_policy: { mode: "repeatable", max_repeats: 2 } },
            { title: "季节更替" }
        ]
    });
    assert.equal(cfg.deadlines.length, 2);
    assert.deepEqual(cfg.deadlines[0].retrigger_policy, { mode: "repeatable", max_repeats: 2, cooldown_steps: 0 });
    assert.equal(cfg.deadlines[1].retrigger_policy, "once");
});

// ---------- UI-3/4：clampTimelineLine 落点 ----------
test("clampTimelineLine：sync_rules 与 timetravel_strategy 夹紧", () => {
    const out = clampTimelineLine({
        sync_rules: [{ ref: "b", ratio: 2 }, { ref: "", ratio: 1 }, { ref: "b" }, { ratio: 3 }],
        timetravel_strategy: "branch"
    });
    assert.deepEqual(out.sync_rules, [{ ref: "b", ratio: 2 }]);
    assert.equal(out.timetravel_strategy, "branch");
    const out2 = clampTimelineLine({ timetravel_strategy: "bogus" });
    assert.equal(out2.timetravel_strategy, null);
});

test("normalizeTimeConfig：multiverse 下合法 sync_rules 保留、自指被过滤", () => {
    const cfg = normalizeTimeConfig({
        mode: "multiverse",
        active_timeline: "a",
        timelines: {
            a: { calendar_mode: "day", current_date: { step: 1 }, sync_rules: [{ ref: "b", ratio: 2 }, { ref: "a", ratio: 9 }] },
            b: { calendar_mode: "day", current_date: { step: 1 } }
        }
    });
    assert.equal(cfg.timelines.a.sync_rules.length, 1);
    assert.deepEqual(cfg.timelines.a.sync_rules[0], { ref: "b", ratio: 2 });
});
