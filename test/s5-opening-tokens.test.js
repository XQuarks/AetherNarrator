// S5-3 · 开场白占位符解析验证
import { test } from "node:test";
import assert from "node:assert";
import { resolveOpeningTokens } from "../src/utils.js";

// 公历：全部 token 解析
test("S5-3 gregorian 全 token 解析", () => {
    const cfg = { calendar_mode: "gregorian", era_label: "二十世纪", season: "冬季", calendar_start: { year: 1926, month: 2, date: 2 } };
    const cd = { year: 1926, month: 2, date: 2, period: "morning", step: 1 };
    const text = "现在是{era_label}的{season}。{calendar_date}，波士顿……";
    const out = resolveOpeningTokens(text, cfg, cd);
    assert.ok(out.includes("二十世纪"), "era_label 应解析");
    assert.ok(out.includes("冬季"), "season 应解析");
    assert.ok(out.includes("1926年2月2日"), "calendar_date 应解析为 1926年2月2日");
    assert.ok(!out.includes("{era_label}") && !out.includes("{calendar_date}"), "不应残留占位符");
});

test("S5-3 gregorian 解析 calendar_year / calendar_month", () => {
    const cfg = { calendar_mode: "gregorian", calendar_start: { year: 1999, month: 1, date: 22 } };
    const cd = { year: 1999, month: 1, date: 22 };
    const out = resolveOpeningTokens("{calendar_year}年{calendar_month}月", cfg, cd);
    assert.strictEqual(out, "1999年1月");
});

// 农历
test("S5-3 lunar 解析 calendar_date 为农历", () => {
    const cfg = { calendar_mode: "lunar", calendar_start: { year: 3024, month: 1, date: 9 } };
    const cd = { year: 3024, month: 1, date: 9 };
    const out = resolveOpeningTokens("农历开局：{calendar_date}", cfg, cd);
    assert.ok(out.includes("农历正月初九"), "应为 农历正月初九，实际：" + out);
});

// 自定义历法
test("S5-3 custom_calendar 解析 calendar_date", () => {
    const cfg = {
        calendar_mode: "custom_calendar",
        custom_calendar: { label: "星历", months: [{ name: "元月", days: 30 }, { name: "二月", days: 29 }] },
        calendar_start: { year: 3024, month: 1, date: 3 }
    };
    const cd = { year: 3024, month: 1, date: 3 };
    const out = resolveOpeningTokens("星历元年：{calendar_date}", cfg, cd);
    assert.ok(out.includes("星历 元月3日"), "应为 星历 元月3日，实际：" + out);
});

// period 模式：仅 era_label / season 解析，calendar token 保留原文（非破坏性）
test("S5-3 period 模式仅配置级 token 解析，日历 token 保留", () => {
    const cfg = { calendar_mode: "period", era_label: "修仙界", season: "春" };
    const cd = { day: 3, period: "morning", step: 3 };
    const out = resolveOpeningTokens("{era_label}·{season}·{calendar_date}·{calendar_year}", cfg, cd);
    assert.ok(out.includes("修仙界"), "era_label 应解析");
    assert.ok(out.includes("春"), "season 应解析");
    assert.ok(out.includes("{calendar_date}"), "calendar_date 在 period 模式应保留原文");
    assert.ok(out.includes("{calendar_year}"), "calendar_year 在 period 模式应保留原文");
});

// none 模式：配置级 token 解析，日历 token 保留
test("S5-3 none 模式日历 token 保留", () => {
    const cfg = { calendar_mode: "none", era_label: "幻境" };
    const cd = { step: 1, period: "morning" };
    const out = resolveOpeningTokens("{era_label}：{calendar_date}", cfg, cd);
    assert.ok(out.includes("幻境"), "era_label 应解析");
    assert.ok(out.includes("{calendar_date}"), "calendar_date 在 none 模式应保留原文");
});

// 纯文本不变
test("S5-3 无占位符纯文本原样返回", () => {
    const cfg = { calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 } };
    const cd = { year: 1926, month: 2, date: 2 };
    const text = "你在一间阴暗的房间里醒来。";
    assert.strictEqual(resolveOpeningTokens(text, cfg, cd), text);
});

// 空/非字符串安全
test("S5-3 空文本与 null 安全", () => {
    assert.strictEqual(resolveOpeningTokens("", { calendar_mode: "gregorian" }, { year: 1 }), "");
    assert.strictEqual(resolveOpeningTokens(null, { calendar_mode: "gregorian" }, { year: 1 }), "");
    assert.strictEqual(resolveOpeningTokens(undefined, { calendar_mode: "gregorian" }, { year: 1 }), "");
});

// dated 但 current_date 缺 year：日历 token 保留（防止误用）
test("S5-3 dated 模式但 current_date 无 year 时日历 token 保留", () => {
    const cfg = { calendar_mode: "gregorian", era_label: "X" };
    const cd = { day: 5, period: "morning" }; // 缺 year
    const out = resolveOpeningTokens("{era_label}-{calendar_date}", cfg, cd);
    assert.ok(out.startsWith("X-"), "era_label 解析");
    assert.ok(out.includes("{calendar_date}"), "无 year 时 calendar_date 保留");
});
