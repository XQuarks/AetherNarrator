// UI-1 自定义历法可视化编辑器 · 纯函数回归测试（docs/35 方案 C）。
// 锁定「编辑器读写 custom_calendar 数据」的底层整形/摘要/排序/闰月逻辑，
// 确保改 UI 不破坏数据形状。仅测纯函数，不触及 DOM。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CUSTOM_CALENDAR_PRESETS,
    clampCustomCalendarMonths,
    summarizeCustomCalendar,
    reorderMonths,
    insertLeapMonth,
} from "../src/calendar.js";

test("CUSTOM_CALENDAR_PRESETS 含 lunar(12月) 与 scifi(10×36天)", () => {
    const lunar = CUSTOM_CALENDAR_PRESETS.lunar;
    assert.equal(lunar.length, 12, "农历模板 12 个月");
    for (const m of lunar) {
        assert.equal(typeof m.name, "string");
        assert.ok(Number.isFinite(m.days) && m.days >= 1, "每月天数合法");
    }
    const scifi = CUSTOM_CALENDAR_PRESETS.scifi;
    assert.equal(scifi.length, 10, "科幻模板 10 个周期");
    assert.ok(scifi.every(m => m.days === 36), "科幻每周期 36 天");
});

test("clampCustomCalendarMonths：天数夹取 1–400、月名裁剪、超 24 截断", () => {
    const out = clampCustomCalendarMonths([
        { name: "元月", days: 30 },
        { name: "", days: 999 },        // 天数超限 → 400；空名 → 月2
        { name: "长名".repeat(10), days: -5 }, // 天数下限 → 1；名超长裁剪
        { name: "末月", days: 25 },
    ]);
    assert.equal(out.length, 4);
    assert.deepEqual(out[0], { name: "元月", days: 30 });
    assert.equal(out[1].days, 400);
    assert.equal(out[1].name, "月2");
    assert.equal(out[2].days, 1);
    assert.ok(out[2].name.length <= 10);
    assert.deepEqual(out[3], { name: "末月", days: 25 });
});

test("clampCustomCalendarMonths：非数组/超长列表安全", () => {
    assert.deepEqual(clampCustomCalendarMonths(null), []);
    assert.deepEqual(clampCustomCalendarMonths(undefined), []);
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `M${i}`, days: 1 }));
    assert.equal(clampCustomCalendarMonths(many).length, 24, "最多 24 个月");
});

test("summarizeCustomCalendar：空历法给出占位示例", () => {
    const s = summarizeCustomCalendar(null);
    assert.equal(s.monthCount, 0);
    assert.equal(s.yearDays, 0);
    assert.equal(s.sample, "（尚未配置月份）");
});

test("summarizeCustomCalendar：统计月数与全年天数、示例格式", () => {
    const s = summarizeCustomCalendar({ label: "星历", months: [{ name: "启", days: 40 }, { name: "承", days: 30 }] });
    assert.equal(s.monthCount, 2);
    assert.equal(s.yearDays, 70);
    assert.equal(s.sample, "星历 第1年 启 1日");
    assert.ok(s.sample.includes("星历"));
});

test("reorderMonths：从前往后移动且不修改原数组", () => {
    const src = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
    const out = reorderMonths(src, 0, 2);
    assert.deepEqual(out.map(m => m.name), ["B", "C", "A", "D"]);
    assert.deepEqual(src.map(m => m.name), ["A", "B", "C", "D"], "原数组不被修改");
});

test("reorderMonths：越界 from 返回原样、to 自动夹取", () => {
    const src = [{ name: "A" }, { name: "B" }];
    assert.deepEqual(reorderMonths(src, -1, 5).map(m => m.name), ["A", "B"], "from 越界原样返回");
    const out = reorderMonths(src, 1, 99);
    assert.deepEqual(out.map(m => m.name), ["A", "B"], "to 超出末端夹取到末端（B 已在末）");
});

test("insertLeapMonth：在指定月后插入闰月，默认名/天", () => {
    const src = [{ name: "A", days: 30 }, { name: "B", days: 30 }];
    const out = insertLeapMonth(src, 0, "闰月", 29);
    assert.equal(out.length, 3);
    assert.deepEqual(out[1], { name: "闰月", days: 29 });
    assert.deepEqual(out[0], { name: "A", days: 30 });
    assert.deepEqual(out[2], { name: "B", days: 30 });
    assert.deepEqual(src.length, 2, "原数组不被修改");
});

test("insertLeapMonth：after 为空插入到末尾、天数越界夹取", () => {
    const src = [{ name: "A", days: 30 }];
    const out = insertLeapMonth(src, null, "末闰", 999);
    assert.equal(out.length, 2);
    assert.deepEqual(out[1], { name: "末闰", days: 400 });
});
