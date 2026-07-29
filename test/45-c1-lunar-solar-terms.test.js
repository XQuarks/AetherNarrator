// C-1 农历闰月/节气细化 · 测试（docs/45）
// 覆盖：SOLAR_TERMS 映射、formatCalendarDate(lunar) 节气开关、theme 显示层带节气、lunarLeap 预设。
import test from "node:test";
import assert from "node:assert/strict";
import {
    formatCalendarDate,
    SOLAR_TERMS,
    CUSTOM_CALENDAR_PRESETS
} from "../src/calendar.js";
import { formatDateOnly, formatDeadlineLabel } from "../src/theme.js";

test("C-1 SOLAR_TERMS 12 月映射正确（正月立春/雨水 … 腊月小寒/大寒）", () => {
    assert.equal(SOLAR_TERMS[1][0], "立春");
    assert.equal(SOLAR_TERMS[1][1], "雨水");
    assert.equal(SOLAR_TERMS[3][0], "清明");
    assert.equal(SOLAR_TERMS[3][1], "谷雨");
    assert.equal(SOLAR_TERMS[12][0], "小寒");
    assert.equal(SOLAR_TERMS[12][1], "大寒");
    assert.equal(Object.keys(SOLAR_TERMS).length, 12);
});

test("C-1 formatCalendarDate(lunar) 默认不显示节气（引擎层向后兼容）", () => {
    assert.equal(formatCalendarDate({ year: 2026, month: 1, date: 9 }, "lunar"), "农历正月初九");
});

test("C-1 formatCalendarDate(lunar) showSolarTerms 显示该月节气", () => {
    assert.equal(
        formatCalendarDate({ year: 2026, month: 1, date: 9 }, "lunar", null, { showSolarTerms: true }),
        "农历正月初九（立春～雨水）"
    );
    assert.equal(
        formatCalendarDate({ year: 2026, month: 3, date: 9 }, "lunar", null, { showSolarTerms: true }),
        "农历三月初九（清明～谷雨）"
    );
});

test("C-1 formatCalendarDate(lunar) 越界月份回绕到对应节气", () => {
    // month 13 → 正月（(13-1)%12+1 = 1）
    assert.equal(
        formatCalendarDate({ year: 2026, month: 13, date: 1 }, "lunar", null, { showSolarTerms: true }),
        "农历正月初一（立春～雨水）"
    );
});

test("C-1 gregorian/custom 不应因 showSolarTerms 受影响", () => {
    assert.equal(
        formatCalendarDate({ year: 1926, month: 2, date: 2 }, "gregorian", null, { showSolarTerms: true }),
        "1926年2月2日 · 周二"
    );
});

test("C-1 theme.formatDateOnly(lunar) 显示层带节气", () => {
    const tc = { calendar_mode: "lunar", calendar_start: { year: 1, month: 1, date: 1 }, custom_calendar: null };
    assert.equal(formatDateOnly({ year: 1, month: 1, date: 9 }, tc), "农历正月初九（立春～雨水）");
    // 年无关（calendar_start 无 year）时仍带节气、仅省略年
    const tcNoYear = { calendar_mode: "lunar", calendar_start: { month: 1, date: 1 }, custom_calendar: null };
    assert.equal(formatDateOnly({ year: 1, month: 3, date: 9 }, tcNoYear), "农历三月初九（清明～谷雨）");
});

test("C-1 theme.formatDeadlineLabel(lunar) 带节气", () => {
    const tc = { calendar_mode: "lunar", calendar_start: { year: 1, month: 1, date: 1 } };
    assert.equal(formatDeadlineLabel({ year: 1, month: 3, date: 9 }, tc), "农历三月初九（清明～谷雨）");
});

test("C-1 CUSTOM_CALENDAR_PRESETS.lunarLeap 含闰二月（共 13 月）", () => {
    const lp = CUSTOM_CALENDAR_PRESETS.lunarLeap;
    const months = Array.isArray(lp) ? lp : lp.months;
    assert.ok(Array.isArray(months), "lunarLeap 应为月份数组");
    assert.equal(months.length, 13, "含闰月共 13 个月");
    assert.ok(months.some(m => m.name === "闰二月"), "应含闰二月");
    assert.ok(months.some(m => m.name === "正月") && months.some(m => m.name === "腊月"), "应保留正月…腊月");
});
