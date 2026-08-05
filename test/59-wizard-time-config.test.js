// test/59-wizard-time-config.test.js
// docs/59：创建向导内嵌完整时间系统编辑器 —— 收集与硬约束文本验证
import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeConfigPrompt, getWizardTimeConfig } from "../src/wizard-time.js";
import { normalizeTimeConfig } from "../src/store.js";

// 说明：wizard-time.js 使用独立命名空间（wz_ 前缀 id + data-wtime），状态存本地缓冲 WT，
// 不依赖 S.currentWorld；真实 DOM 交互（下拉联动/增删月份/多线）由浏览器可视化
// verify-create-wizard.mjs 覆盖（见 docs/59 §12）。此处验证「玩家配置 → AI 硬约束文本」核心逻辑与门禁兜底。

test("buildTimeConfigPrompt：单线 day 输出硬约束文本含关键字段", () => {
    const tc = normalizeTimeConfig({
        mode: "single", calendar_mode: "day", era_label: "乾隆年间",
        show: true, clock_mode: "period", default_timetravel_strategy: "keep", weather: "细雨"
    });
    const txt = buildTimeConfigPrompt(tc);
    assert.match(txt, /玩家已锁定/);
    assert.match(txt, /单一时间线/);
    assert.match(txt, /乾隆年间/);
    assert.match(txt, /按第 N 天推进/);
    assert.match(txt, /细雨/);
    assert.match(txt, /保留记录/); // keep
});

test("buildTimeConfigPrompt：自定义历法含月份与历法名", () => {
    const tc = normalizeTimeConfig({
        mode: "single", calendar_mode: "custom_calendar", era_label: "星历",
        custom_calendar: { label: "星历", months: [{ name: "一月", days: 30 }, { name: "二月", days: 30 }] }
    });
    const txt = buildTimeConfigPrompt(tc);
    assert.match(txt, /自定义历法/);
    assert.match(txt, /星历/);
    assert.match(txt, /一月/);
    assert.match(txt, /二月/);
});

test("buildTimeConfigPrompt：多时间线含各线与流速比", () => {
    const tc = normalizeTimeConfig({
        mode: "multiverse",
        timelines: {
            A: { name: "现世", calendar_mode: "day" },
            B: { name: "异界", calendar_mode: "gregorian", sync_rules: [{ ref: "A", ratio: 2 }] }
        }
    });
    const txt = buildTimeConfigPrompt(tc);
    assert.match(txt, /多时间线/);
    assert.match(txt, /现世/);
    assert.match(txt, /异界/);
    assert.match(txt, /流速比/);
    assert.match(txt, /A×2/);
});

test("buildTimeConfigPrompt：截止事件（重触发策略）", () => {
    const tc = normalizeTimeConfig({
        mode: "single", calendar_mode: "day",
        deadlines: [{ title: "末日降临", day: 100, retrigger_policy: "once" }]
    });
    const txt = buildTimeConfigPrompt(tc);
    assert.match(txt, /截止事件/);
    assert.match(txt, /末日降临/);
    assert.match(txt, /第100天/);
    assert.match(txt, /触发一次|一次/);
});

test("buildTimeConfigPrompt：多时间线无 timelines 由 normalizeTimeConfig 回落 single", () => {
    const tc = normalizeTimeConfig({ mode: "multiverse" }); // 无 timelines
    assert.equal(tc.mode, "single"); // S5-2 保底
    const txt = buildTimeConfigPrompt(tc);
    assert.match(txt, /单一时间线/);
});

test("buildTimeConfigPrompt：null / 未锁定 → 空串（不注入 AI）", () => {
    assert.equal(buildTimeConfigPrompt(null), "");
    assert.equal(buildTimeConfigPrompt(undefined), ""); // 内部 getWizardTimeConfig 在无 DOM 兜底返回 null
});

test("getWizardTimeConfig：无 DOM 环境门禁兜底不崩溃，返回 null", () => {
    // node 全局无 document → timeModuleOn 容错返回 true，但 WT.locked 默认 false → null
    const r = getWizardTimeConfig();
    assert.equal(r, null);
});

test("normalizeTimeConfig 对向导形状各场景稳定（与详情页一致）", () => {
    const a = normalizeTimeConfig({ mode: "single", calendar_mode: "lunar", calendar_start: { month: 13, date: 40 } });
    assert.equal(a.calendar_mode, "lunar");
    // 起始日期越界由 validateStartDate 纠正
    assert.ok(a.calendar_start.month >= 1 && a.calendar_start.month <= 12);
    const b = normalizeTimeConfig({ mode: "single", calendar_mode: "custom_calendar", custom_calendar: { label: "x".repeat(50), months: [] } });
    assert.equal(b.custom_calendar, null); // 无月份 → 不保留
    const c = normalizeTimeConfig({ clock_mode: "24h" }); // 非法时钟
    assert.equal(c.clock_mode, "period"); // 回落默认（仅 period/none）
});
