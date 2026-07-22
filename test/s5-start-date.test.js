// S5-1：世界创建卡「起始日期」输入框 → 写回 time_config.calendar_start → 新游戏开局日期跟随。
// 本测试验证链路末端（normalizeCurrentDate 从 calendar_start 推出开局 current_date），
// 证明 UI 输入的目标值确实驱动游戏起始日。
import { test } from "node:test";
import assert from "node:assert";
import { normalizeCurrentDate } from "../src/calendar.js";

test("S5-1: gregorian 自定义 calendar_start 决定开局日期", () => {
    const tc = { calendar_mode: "gregorian", calendar_start: { year: 1999, month: 1, date: 22 } };
    const cd = normalizeCurrentDate(undefined, tc);
    assert.deepStrictEqual({ year: cd.year, month: cd.month, date: cd.date }, { year: 1999, month: 1, date: 22 });
});

test("S5-1: lunar 自定义 calendar_start 生效", () => {
    const tc = { calendar_mode: "lunar", calendar_start: { year: 3024, month: 3, date: 9 } };
    const cd = normalizeCurrentDate(undefined, tc);
    assert.deepStrictEqual({ year: cd.year, month: cd.month, date: cd.date }, { year: 3024, month: 3, date: 9 });
});

test("S5-1: custom_calendar 自定义 calendar_start 生效", () => {
    const tc = {
        calendar_mode: "custom_calendar",
        calendar_start: { year: 70498, month: 7, date: 3 },
        custom_calendar: { label: "星际历", months: [{ name: "月一", days: 30 }] }
    };
    const cd = normalizeCurrentDate(undefined, tc);
    assert.deepStrictEqual({ year: cd.year, month: cd.month, date: cd.date }, { year: 70498, month: 7, date: 3 });
});

test("S5-1: 无 calendar_start 的 dated 世界回退默认起点（不崩）", () => {
    const tc = { calendar_mode: "gregorian", calendar_start: null };
    const cd = normalizeCurrentDate(undefined, tc);
    assert.ok(Number.isFinite(cd.year) && Number.isFinite(cd.month) && Number.isFinite(cd.date));
});

test("S5-1: day 模式忽略 calendar_start（不产出 year/month/date）", () => {
    const tc = { calendar_mode: "day", calendar_start: { year: 1, month: 1, date: 1 } };
    const cd = normalizeCurrentDate(undefined, tc);
    assert.strictEqual(cd.day, 1);
    assert.strictEqual(cd.year, undefined);
    assert.strictEqual(cd.month, undefined);
});
