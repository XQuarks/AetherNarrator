// UI-2 多时间线可视化配置器 · 纯函数回归测试（docs/43 方案 C）。
// 锁定「多时间线字典构造/夹紧/增删/改名/活动线/模板」的底层逻辑，
// 确保改 UI 不破坏 time_config.timelines 数据形状。仅测纯函数，不触及 DOM。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    clampTimelineLine,
    seedDefaultTimelines,
    addTimeline,
    deleteTimeline,
    renameTimelineKey,
    setActiveTimeline,
    applyMultiverseTemplate,
    MULTIVERSE_TEMPLATES,
} from "../src/calendar.js";

test("clampTimelineLine：字段长度裁剪 + 非法历法回退 day + current_date 保底", () => {
    const out = clampTimelineLine({
        name: "x".repeat(50),
        calendar_mode: "bogus",
        calendar_start: { year: 2003, month: 1, date: 1 },
        current_date: { year: 2003, month: 3, date: 15 },
        era_label: "y".repeat(60),
        weather: "z".repeat(40),
    });
    assert.equal(out.name.length, 30, "名称≤30");
    assert.equal(out.calendar_mode, "day", "非法历法回退 day");
    assert.equal(out.era_label.length, 40, "纪元≤40");
    assert.equal(out.weather.length, 20, "天气≤20");
    assert.deepEqual(out.current_date, { year: 2003, month: 3, date: 15 });
});

test("clampTimelineLine：day/none 模式缺 current_date 时补 {step:1}", () => {
    const out = clampTimelineLine({ calendar_mode: "day" });
    assert.deepEqual(out.current_date, { step: 1 });
    const out2 = clampTimelineLine({ calendar_mode: "none" });
    assert.deepEqual(out2.current_date, { step: 1 });
});

test("clampTimelineLine：自定义历法月历表被夹紧(≤24月/天数1–400/月名≤10)", () => {
    const out = clampTimelineLine({
        calendar_mode: "custom_calendar",
        custom_calendar: { label: "星历", months: [{ name: "元", days: 999 }, { name: "贰", days: 30 }, { name: "叁", days: 5 }] },
    });
    assert.ok(out.custom_calendar, "保留 custom_calendar");
    assert.equal(out.custom_calendar.months.length, 3);
    assert.equal(out.custom_calendar.months[0].days, 400, "天数夹到 400");
    assert.equal(out.custom_calendar.months[0].name, "元");
});

test("seedDefaultTimelines：从单线 gregorian 配置继承出 main 线", () => {
    const tc = { calendar_mode: "gregorian", era_label: "公元2003年", calendar_start: { year: 2003, month: 1, date: 1 }, weather: "晴" };
    const tl = seedDefaultTimelines(tc);
    assert.ok(tl.main, "产生 main 线");
    assert.equal(tl.main.name, "公元2003年", "线名取纪元文字");
    assert.equal(tl.main.calendar_mode, "gregorian");
    assert.deepEqual(tl.main.current_date, { year: 2003, month: 1, date: 1 });
    assert.equal(tl.main.era_label, "公元2003年");
});

test("seedDefaultTimelines：day 模式初始日期补 {step:1}", () => {
    const tl = seedDefaultTimelines({ calendar_mode: "day" });
    assert.deepEqual(tl.main.current_date, { step: 1 });
});

test("addTimeline：新增唯一 id 并设为活动线（当无活动线）", () => {
    const tc = { timelines: { a: clampTimelineLine({ name: "A" }) }, active_timeline: "a" };
    const id = addTimeline(tc, { name: "B", calendar_mode: "lunar" });
    assert.ok(/^line_\d+$/.test(id), "默认 id 形如 line_N");
    assert.ok(tc.timelines[id], "新线已写入");
    assert.equal(tc.timelines[id].calendar_mode, "lunar");
    // 已有 active，不应被覆盖
    assert.equal(tc.active_timeline, "a");
});

test("addTimeline：无 timelines 时自动初始化并设置 active", () => {
    const tc = {};
    const id = addTimeline(tc, { name: "首线" });
    assert.ok(tc.timelines && tc.timelines[id], "timelines 已建");
    assert.equal(tc.active_timeline, id, "首线即活动线");
});

test("deleteTimeline：至少保留 1 条（拒绝删空）", () => {
    const tc = { timelines: { a: clampTimelineLine({ name: "A" }) }, active_timeline: "a" };
    assert.equal(deleteTimeline(tc, "a"), false, "唯一线不可删");
    assert.ok(tc.timelines.a, "唯一线未被删除");
});

test("deleteTimeline：删线后活动线回退到剩余第一条", () => {
    const tc = {
        timelines: { a: clampTimelineLine({ name: "A" }), b: clampTimelineLine({ name: "B" }) },
        active_timeline: "b",
    };
    assert.equal(deleteTimeline(tc, "b"), true);
    assert.ok(!tc.timelines.b);
    assert.equal(tc.active_timeline, "a", "活动线回退到 a");
});

test("renameTimelineKey：迁移数据 + 修正 active；拒绝空/重名/同名", () => {
    const tc = {
        timelines: { a: clampTimelineLine({ name: "A" }), b: clampTimelineLine({ name: "B" }) },
        active_timeline: "a",
    };
    assert.equal(renameTimelineKey(tc, "a", "c"), true);
    assert.ok(tc.timelines.c && !tc.timelines.a, "key 已迁移");
    assert.equal(tc.active_timeline, "c", "active 跟随迁移");
    assert.equal(renameTimelineKey(tc, "c", "b"), false, "重名拒绝");
    assert.equal(renameTimelineKey(tc, "c", ""), false, "空名拒绝");
    assert.equal(renameTimelineKey(tc, "c", "c"), false, "同名拒绝");
});

test("setActiveTimeline：仅当线存在才生效", () => {
    const tc = { timelines: { a: clampTimelineLine({ name: "A" }), b: clampTimelineLine({ name: "B" }) }, active_timeline: "a" };
    assert.equal(setActiveTimeline(tc, "b"), true);
    assert.equal(tc.active_timeline, "b");
    assert.equal(setActiveTimeline(tc, "ghost"), false);
});

test("applyMultiverseTemplate：双界穿梭模板载入 earth/xianxia 两线", () => {
    const tc = { timelines: {}, active_timeline: null };
    assert.equal(applyMultiverseTemplate(tc, "双界穿梭"), true);
    assert.deepEqual(Object.keys(tc.timelines).sort(), ["earth", "xianxia"]);
    assert.equal(tc.active_timeline, "earth");
    const earth = tc.timelines.earth;
    assert.equal(earth.calendar_mode, "gregorian");
    assert.equal(tc.timelines.xianxia.calendar_mode, "lunar");
    assert.equal(earth.era_label, "公元2003年");
    assert.equal(tc.timelines.xianxia.era_label, "大周天历3024年");
});

test("applyMultiverseTemplate：未知模板返回 false 不改数据", () => {
    const tc = { timelines: { a: clampTimelineLine({ name: "A" }) }, active_timeline: "a" };
    assert.equal(applyMultiverseTemplate(tc, "不存在"), false);
    assert.ok(tc.timelines.a, "原数据未动");
});

test("MULTIVERSE_TEMPLATES 双界穿梭两线 current_date 已就绪（可直接进游戏）", () => {
    const tpl = MULTIVERSE_TEMPLATES["双界穿梭"];
    assert.ok(tpl.timelines.earth.current_date && tpl.timelines.xianxia.current_date, "两线均有初始日期");
});
