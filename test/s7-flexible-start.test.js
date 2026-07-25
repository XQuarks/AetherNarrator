// 方案 22（年份归纪元 + 柔性起始日期 + 日期校验层）单测
// 覆盖：deriveAnchorYear / 克苏鲁式不误报 / era_label 不作为比对目标 /
//       各粒度显示 / validateStartDate 校验+自动纠正 / 无 year 截止显示 / 旧档硬年兼容
import test from "node:test";
import assert from "node:assert/strict";
import {
    deriveAnchorYear, validateStartDate, formatCalendarDate,
    normalizeCurrentDate, backfillCurrentDate
} from "../src/calendar.js";
import { normalizeTimeConfig } from "../src/store.js";
import { detectTimeConflict } from "../src/utils.js";
import { formatDateOnly, formatDeadlineLabel } from "../src/theme.js";

// ---------- 1. deriveAnchorYear 四种解析 ----------
test("S7 deriveAnchorYear: 年代起点「1920年代」→ 1920", () => {
    assert.equal(deriveAnchorYear("1920年代"), 1920);
});
test("S7 deriveAnchorYear: 硬年「1926」→ 1926", () => {
    assert.equal(deriveAnchorYear("1926"), 1926);
});
test("S7 deriveAnchorYear: 硬年带「年」「1926年」→ 1926", () => {
    assert.equal(deriveAnchorYear("1926年"), 1926);
});
test("S7 deriveAnchorYear: 纯纪元无年份「大清乾隆年间」→ null", () => {
    assert.equal(deriveAnchorYear("大清乾隆年间"), null);
});
test("S7 deriveAnchorYear: 空串 → null", () => {
    assert.equal(deriveAnchorYear(""), null);
});
test("S7 deriveAnchorYear: null → null", () => {
    assert.equal(deriveAnchorYear(null), null);
});

// ---------- 2. 克苏鲁式：era_label 作锚点，同 decade 不误报 ----------
test("S7 克苏鲁式 era_label=1920年代 + system_prompt 含「1920年代」→ 不冲突", () => {
    const w = {
        schema: {
            opening_narrative: "序章",
            system_prompt: "本故事发生在1920年代的美国普罗维登斯。",
            time_config: { calendar_mode: "gregorian", calendar_start: { month: 2, date: 2 }, era_label: "1920年代" }
        }
    };
    const r = detectTimeConflict(w);
    assert.equal(r.conflict, false);
});
test("S7 克苏鲁式 system_prompt 含异 decade「1999年」→ 冲突", () => {
    const w = {
        schema: {
            opening_narrative: "序章",
            system_prompt: "到了1999年，命运起了变化。",
            time_config: { calendar_mode: "gregorian", calendar_start: { month: 2, date: 2 }, era_label: "1920年代" }
        }
    };
    const r = detectTimeConflict(w);
    assert.equal(r.conflict, true);
    assert.ok(r.yearConflict, "应命中 yearConflict");
});
test("S7 克苏鲁式 opening 同 decade「1926年」→ 不冲突", () => {
    const w = {
        schema: {
            opening_narrative: "1926 年的冬天，浓雾笼罩波士顿。",
            system_prompt: "",
            time_config: { calendar_mode: "gregorian", calendar_start: { month: 2, date: 2 }, era_label: "1920年代" }
        }
    };
    const r = detectTimeConflict(w);
    assert.equal(r.conflict, false);
});

// ---------- 3. detectTimeConflict 不再把 era_label 本身当比对目标 ----------
test("S7 era_label 含 1920年代 但未出现在 opening/system_prompt → 不触发冲突", () => {
    const w = {
        schema: {
            opening_narrative: "故事就这样开始了。",
            system_prompt: "请保持年代氛围。",
            time_config: { calendar_mode: "gregorian", calendar_start: { month: 2 }, era_label: "1920年代" }
        }
    };
    const r = detectTimeConflict(w);
    assert.equal(r.conflict, false);
});

// ---------- 4. 各粒度显示 ----------
test("S7 显示：年无关仅月日 → 2月2日", () => {
    const r = formatCalendarDate({ month: 2, date: 2 }, "gregorian", null, { showYear: false });
    assert.equal(r, "2月2日");
});
test("S7 显示：仅月份 → 2月", () => {
    const r = formatCalendarDate({ month: 2 }, "gregorian", null, { showYear: false });
    assert.equal(r, "2月");
});
test("S7 显示：全空 → 空串（由纪元兜底）", () => {
    const r = formatCalendarDate({}, "gregorian", null, { showYear: false });
    assert.equal(r, "");
});
test("S7 显示：完整日期（showYear=true）含年 → 1926年2月2日（含星期后缀）", () => {
    const r = formatCalendarDate({ year: 1926, month: 2, date: 2 }, "gregorian", null, { showYear: true });
    assert.ok(r.startsWith("1926年2月2日"), `应含「1926年2月2日」，实际：${r}`);
});
test("S7 显示：年无关模式 calendar_start 无 year → formatDateOnly 不露年（2月2日）", () => {
    const tc = normalizeTimeConfig({ calendar_mode: "gregorian", calendar_start: { month: 2, date: 2 }, era_label: "1920年代" });
    const cd = normalizeCurrentDate({ month: 2, date: 2, period: "morning" }, tc);
    assert.equal(formatDateOnly(cd, tc), "2月2日");
});
test("S7 显示：calendar_start 为 null → formatDateOnly 空串（仅纪元前缀）", () => {
    const tc = normalizeTimeConfig({ calendar_mode: "gregorian", era_label: "1920年代" });
    const cd = normalizeCurrentDate({ period: "morning" }, tc);
    assert.equal(formatDateOnly(cd, tc), "");
});

// ---------- 5. validateStartDate 校验 + 安全自动纠正 ----------
test("S7 校验：平年 2月29 → 纠正为 28 + 警告", () => {
    const r = validateStartDate({ year: 2023, month: 2, date: 29 }, "gregorian", null);
    assert.equal(r.corrected.date, 28);
    assert.ok(r.warnings.some(w => w.includes("2月29日已纠正")), "应有纠正警告");
});
test("S7 校验：闰年 2月29 → 保留不纠正", () => {
    const r = validateStartDate({ year: 2024, month: 2, date: 29 }, "gregorian", null);
    assert.equal(r.corrected.date, 29);
});
test("S7 校验：年无关 2月29 → 只警告不纠正（保留29）", () => {
    const r = validateStartDate({ month: 2, date: 29 }, "gregorian", "1920年代");
    assert.equal(r.corrected.date, 29);
    assert.ok(r.warnings.some(w => w.includes("闰年")), "应提示需确认闰年");
});
test("S7 校验：月份越界 → clamp 到 12", () => {
    const r = validateStartDate({ month: 13, date: 1 }, "gregorian", null);
    assert.equal(r.corrected.month, 12);
});
test("S7 校验：日期越界（平年2月30）→ clamp 到 28", () => {
    const r = validateStartDate({ year: 2023, month: 2, date: 30 }, "gregorian", null);
    assert.equal(r.corrected.date, 28);
});
test("S7 校验：农历月份超表 → clamp 到有效范围", () => {
    const r = validateStartDate({ month: 15, date: 1 }, "lunar", null);
    assert.equal(r.corrected.month, 12);
});
test("S7 校验：农历日期超当月天数 → clamp", () => {
    // 二月（DEFAULT_LUNAR 29 天）填 30 → 纠正为 29
    const r = validateStartDate({ month: 2, date: 30 }, "lunar", null);
    assert.equal(r.corrected.date, 29);
});

// ---------- 6. 截止日期（无 year）在年无关模式显示正确 ----------
test("S7 截止：无 year 的 deadline 在年无关模式显示不露年 → 2月4日 · 夜晚", () => {
    const tc = normalizeTimeConfig({ calendar_mode: "gregorian", calendar_start: { month: 2, date: 2 }, era_label: "1920年代" });
    const label = formatDeadlineLabel({ month: 2, date: 4, period: "night" }, tc);
    assert.equal(label, "2月4日 · 夜晚");
});

// ---------- 7. 旧档兼容：calendar_start 带 year 继续硬年逻辑 ----------
test("S7 兼容：calendar_start 带 year 仍被 normalizeTimeConfig 保留", () => {
    const cfg = normalizeTimeConfig({ calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 } });
    assert.deepEqual(cfg.calendar_start, { year: 1926, month: 2, date: 2 });
});
test("S7 兼容：旧档 {day} 回推仍按硬年锚点（1926-02-02 + 4天 = 1926-02-06）", () => {
    const tc = normalizeTimeConfig({ calendar_mode: "gregorian", calendar_start: { year: 1926, month: 2, date: 2 } });
    const r = backfillCurrentDate({ day: 5, period: "night" }, tc);
    assert.equal(r.year, 1926);
    assert.equal(r.month, 2);
    assert.equal(r.date, 6);
});
