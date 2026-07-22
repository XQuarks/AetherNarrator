import test from "node:test";
import assert from "node:assert/strict";

import {
    isLeapYear, daysInMonth, addGregorian, addLunar, addCustom, addCalendar,
    compareCalendar, formatCalendarDate, gregorianWeekday, advanceCalendarTime,
    backfillCurrentDate, normalizeCurrentDate, DEFAULT_LUNAR
} from "../src/calendar.js";

// ---------- 闰年 / 月长 ----------

test("isLeapYear 正确判定", () => {
    assert.equal(isLeapYear(2000), true);
    assert.equal(isLeapYear(1900), false);
    assert.equal(isLeapYear(2024), true);
    assert.equal(isLeapYear(2023), false);
});

test("daysInMonth 二月闰年 29 天", () => {
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2023, 2), 28);
    assert.equal(daysInMonth(2024, 12), 31);
});

// ---------- gregorian 推进 + 月末夹紧 ----------

test("gregorian 普通 +1 月", () => {
    const r = addGregorian({ year: 2026, month: 1, date: 15 }, { months: 1 });
    assert.deepEqual(r, { year: 2026, month: 2, date: 15 });
});

test("gregorian 月末夹紧：1月31日 +1月 = 2月28日(平年)", () => {
    const r = addGregorian({ year: 2023, month: 1, date: 31 }, { months: 1 });
    assert.deepEqual(r, { year: 2023, month: 2, date: 28 });
});

test("gregorian 月末夹紧：1月31日 +1月 = 2月29日(闰年)", () => {
    const r = addGregorian({ year: 2024, month: 1, date: 31 }, { months: 1 });
    assert.deepEqual(r, { year: 2024, month: 2, date: 29 });
});

test("gregorian 跨年：2026-12-31 +1天 = 2027-01-01", () => {
    const r = addGregorian({ year: 2026, month: 12, date: 31 }, { days: 1 });
    assert.deepEqual(r, { year: 2027, month: 1, date: 1 });
});

test("gregorian 跨年 +1月：2026-12-15 +1月 = 2027-01-15", () => {
    const r = addGregorian({ year: 2026, month: 12, date: 15 }, { months: 1 });
    assert.deepEqual(r, { year: 2027, month: 1, date: 15 });
});

test("gregorian 逆跳（时间穿越）：2026-06-01 +(-3年) = 2023-06-01", () => {
    const r = addGregorian({ year: 2026, month: 6, date: 1 }, { years: -3 });
    assert.deepEqual(r, { year: 2023, month: 6, date: 1 });
});

test("gregorian 大跳跃：+3月（闭关三月）", () => {
    const r = addGregorian({ year: 2026, month: 2, date: 3 }, { months: 3 });
    assert.deepEqual(r, { year: 2026, month: 5, date: 3 });
});

// ---------- lunar 推进 ----------

test("lunar 正常 +1 月（大小月交替）", () => {
    const r = addLunar({ year: 2026, month: 1, date: 10 }, { months: 1 });
    assert.equal(r.month, 2);
    assert.equal(r.date, 10);
});

test("lunar 月末夹紧：正月30日 +1月 = 二月29日", () => {
    const r = addLunar({ year: 2026, month: 1, date: 30 }, { months: 1 });
    assert.deepEqual(r, { year: 2026, month: 2, date: 29 });
});

// ---------- custom 自定义历法 ----------

const STAR_CAL = {
    label: "星历",
    months: [
        { name: "熔火月", days: 35 }, { name: "寒铁月", days: 35 },
        { name: "翠星月", days: 30 }, { name: "幻月", days: 30 }
    ]
};

test("custom 月历表进位：熔火月35日(末日) +1月 = 寒铁月35日(末日)", () => {
    const r = addCustom({ year: 3024, month: 1, date: 35 }, { months: 1 }, STAR_CAL);
    assert.deepEqual(r, { year: 3024, month: 2, date: 35 });
});

test("custom 跨年：第4月30日(末日) +1月 = 下一年第1月30日(末日)", () => {
    const r = addCustom({ year: 3024, month: 4, date: 30 }, { months: 1 }, STAR_CAL);
    assert.deepEqual(r, { year: 3025, month: 1, date: 30 });
});

test("custom 默认回退到农历月历（无 months 时）", () => {
    const r = addCustom({ year: 1, month: 1, date: 30 }, { months: 1 });
    assert.equal(r.month, 2);
});

test("addCalendar 按 mode 分派", () => {
    assert.deepEqual(addCalendar({ year: 2026, month: 1, date: 31 }, { months: 1 }, "gregorian"),
        { year: 2026, month: 2, date: 28 });
    assert.deepEqual(addCalendar({ year: 1, month: 1, date: 30 }, { months: 1 }, "lunar"),
        { year: 1, month: 2, date: 29 });
});

// ---------- compareCalendar 分派 ----------

test("compareCalendar gregorian 三元组比较", () => {
    const a = { year: 2026, month: 2, date: 2 };
    const b = { year: 2026, month: 2, date: 3 };
    const c = { year: 2025, month: 12, date: 31 };
    assert.equal(compareCalendar(a, b, "gregorian"), -1);
    assert.equal(compareCalendar(b, a, "gregorian"), 1);
    assert.equal(compareCalendar(a, a, "gregorian"), 0);
    assert.equal(compareCalendar(c, a, "gregorian"), -1);
});

test("compareCalendar period/none 按 step 比较", () => {
    assert.equal(compareCalendar({ step: 1 }, { step: 2 }, "period"), -1);
    assert.equal(compareCalendar({ step: 5 }, { step: 5 }, "none"), 0);
    assert.equal(compareCalendar({ step: 3 }, { step: 1 }, "day"), 1);
});

test("compareCalendar 逆跳日期仍正确比较（不假设只增）", () => {
    const past = { year: 1996, month: 1, date: 1 };
    const now = { year: 1999, month: 1, date: 22 };
    assert.equal(compareCalendar(past, now, "gregorian"), -1);
    assert.equal(compareCalendar(now, past, "gregorian"), 1);
});

// ---------- 展示 ----------

test("formatCalendarDate gregorian 含星期", () => {
    // 1926-02-02 真实是周二（以 Date.UTC 为准）
    assert.equal(formatCalendarDate({ year: 1926, month: 2, date: 2 }, "gregorian"), "1926年2月2日 · 周二");
});

test("formatCalendarDate lunar 中文", () => {
    assert.equal(formatCalendarDate({ year: 2026, month: 1, date: 9 }, "lunar"), "农历正月初九");
});

test("formatCalendarDate custom 自定义前缀", () => {
    assert.equal(formatCalendarDate({ year: 3024, month: 1, date: 3 }, "custom_calendar", STAR_CAL), "星历 熔火月3日");
});

test("gregorianWeekday 已知日期", () => {
    assert.equal(gregorianWeekday(1926, 2, 2), 2); // 周二
    assert.equal(gregorianWeekday(1999, 1, 22), 5); // 周五（英伟达上市日）
    assert.equal(gregorianWeekday(2004, 6, 16), 3); // 周三（腾讯上市日）
});

// ---------- advanceCalendarTime：step 仅增 ----------

test("advanceCalendarTime period 模式仅增 step", () => {
    const r = advanceCalendarTime({ step: 1, period: "morning" }, { steps: 1 }, "period");
    assert.equal(r.step, 2);
    assert.equal(r.period, "morning");
});

test("advanceCalendarTime gregorian 推进日期 + step 仅增", () => {
    const r = advanceCalendarTime({ year: 1926, month: 2, date: 2, period: "morning", step: 1 },
        { days: 1 }, "gregorian");
    assert.deepEqual({ year: r.year, month: r.month, date: r.date }, { year: 1926, month: 2, date: 3 });
    assert.equal(r.step, 2);
});

test("advanceCalendarTime 不修改入参（纯函数）", () => {
    const src = { year: 2026, month: 1, date: 1, step: 1 };
    const before = JSON.stringify(src);
    advanceCalendarTime(src, { months: 1 }, "gregorian");
    assert.equal(JSON.stringify(src), before);
});

// ---------- 旧档回推 ----------

test("backfillCurrentDate：gregorian 旧 {day} 回推（calendar_start 锚定）", () => {
    const start = { year: 1926, month: 2, date: 2 };
    const r = backfillCurrentDate({ day: 1, period: "morning" }, { calendar_mode: "gregorian", calendar_start: start });
    assert.deepEqual(r, { year: 1926, month: 2, date: 2, period: "morning", step: 1 });
    const r2 = backfillCurrentDate({ day: 32, period: "morning" }, { calendar_mode: "gregorian", calendar_start: start });
    assert.deepEqual(r2, { year: 1926, month: 3, date: 5, period: "morning", step: 32 });
});

test("backfillCurrentDate：period 旧 {day} → {step:day}", () => {
    const r = backfillCurrentDate({ day: 7, period: "night" }, { calendar_mode: "day" });
    assert.deepEqual(r, { step: 7, period: "night" });
});

test("backfillCurrentDate：none 旧 {day} → {step:day}", () => {
    const r = backfillCurrentDate({ day: 3, period: "morning" }, { calendar_mode: "none" });
    assert.deepEqual(r, { step: 3, period: "morning" });
});

// ---------- normalizeCurrentDate（载入/新建时一次性规范化）----------

test("normalizeCurrentDate：dated 旧 {day} 回推为原生年/月/日", () => {
    const tc = { calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 } };
    const r = normalizeCurrentDate({ day: 1, period: "morning" }, tc);
    assert.deepEqual(r, { year: 1926, month: 2, date: 2, period: "morning", step: 1 });
    const r2 = normalizeCurrentDate({ day: 32, period: "morning" }, tc);
    assert.deepEqual(r2, { year: 1926, month: 3, date: 5, period: "morning", step: 32 });
});

test("normalizeCurrentDate：dated 已原生形状不丢字段", () => {
    const tc = { calendar_mode: "gregorian", calendar_start: { year: 1, month: 1, date: 1 } };
    const r = normalizeCurrentDate({ year: 2004, month: 6, date: 16, period: "night", step: 9 }, tc);
    assert.deepEqual(r, { year: 2004, month: 6, date: 16, period: "night", step: 9 });
});

test("normalizeCurrentDate：period 旧 {day} 补齐 step", () => {
    const r = normalizeCurrentDate({ day: 5, period: "night" }, { calendar_mode: "period" });
    assert.equal(r.day, 5);
    assert.equal(r.step, 5);
    assert.equal(r.period, "night");
});

test("normalizeCurrentDate：none 旧 {day} → {step:day}", () => {
    const r = normalizeCurrentDate({ day: 3, period: "morning" }, { calendar_mode: "none" });
    assert.deepEqual(r, { day: 3, step: 3, period: "morning" });
});

