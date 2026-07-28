// ============================================================
// AetherNarrator · calendar.js（时间系统彻底解耦 · 方案 B 地基）
// 纯函数日历引擎：无隐藏序数。current_date 按模式携带原生字段。
// 可在 Node 下单测（无 DOM、无 S 依赖）。
//
// current_date 统一形状（按模式）：
//   period / none : { step, period }              —— step 即"第 N 天"
//   gregorian     : { year, month, date, period, step }
//   lunar         : { year, month, date, period, step }
//   custom_calendar: { year, month, date, period, step }
// step：剧情步，仅增，跨所有模式（事件冷却/排序用），永不作为日期展示。
// ============================================================

export const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// ---------- 基础 ----------

export function isLeapYear(y) {
    if (!Number.isFinite(y)) return false;
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
    const mm = ((m - 1) % 12 + 12) % 12; // 0-based，容忍越界月
    const leap = isLeapYear(y);
    const lens = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return lens[mm];
}

// 方案 22（年份归纪元）：从纪元标签解析锚点年 / 年代起点。
//   "1920年代" -> 1920（年代起点）; "1926"/"1926年" -> 1926; 无可解析年份 -> null
export function deriveAnchorYear(eraLabel) {
    if (!eraLabel || typeof eraLabel !== "string") return null;
    const s = eraLabel.trim();
    const dec = s.match(/(?:^|\D)(\d{3,4})\s*年代/);
    if (dec) return Math.floor(parseInt(dec[1], 10) / 10) * 10;
    const yr = s.match(/(?:^|\D)(\d{3,4})\s*年/);
    if (yr) return parseInt(yr[1], 10);
    const y2 = s.match(/(\d{3,4})/);
    if (y2) return parseInt(y2[1], 10);
    return null;
}

// 方案 22（日期校验层）：校验起始日期合法性，返回 { valid, warnings, corrected }。
// - 公历：闰年 2月29 自动纠正（平年→28）；月份/日期越界 clamp；年无关下的 2月29 只警告不纠正。
// - 农历/自定义：月份在表内、日期不超当月天数（clamp）；闰月正确性靠 AI 保证，不在此精确算。
export function validateStartDate(cs, mode, eraLabel) {
    const warnings = [];
    if (!cs || typeof cs !== "object") return { valid: true, warnings, corrected: cs || null };
    const out = {};
    let valid = true;
    const anchorYear = deriveAnchorYear(eraLabel);
    if (mode === "gregorian") {
        if (cs.year != null) {
            const y = cs.year | 0;
            out.year = y;
            if (!Number.isFinite(cs.year) || y < 1 || y > 9999) { warnings.push(`年份 ${cs.year} 超出范围`); valid = false; }
        }
        let m = cs.month != null ? cs.month | 0 : null;
        if (m != null) {
            if (m < 1 || m > 12) { m = Math.min(12, Math.max(1, m)); warnings.push(`月份已夹紧到 ${m}`); valid = false; }
            out.month = m;
        }
        let d = cs.date != null ? cs.date | 0 : null;
        if (d != null) {
            const max = daysInMonth(out.year != null ? out.year : (anchorYear || 1), m || 1);
            if (m === 2 && d === 29) {
                if (out.year != null && !isLeapYear(out.year)) { d = 28; warnings.push(`${out.year}年非闰年，2月29日已纠正为2月28日`); valid = false; }
                else if (out.year == null) { warnings.push(`2月29日需闰年，当前纪元未指定具体年份，已保留2月29日（请确认对应年份为闰年）`); }
            } else if (d > max) { d = max; warnings.push(`日期已夹紧到当月最大 ${max} 日`); valid = false; }
            else if (d < 1) { d = 1; warnings.push(`日期已修正为 1`); valid = false; }
            out.date = d;
        }
    } else if (mode === "lunar" || mode === "custom_calendar") {
        const tbl = (mode === "custom_calendar" && cs.custom_calendar && Array.isArray(cs.custom_calendar.months)) ? cs.custom_calendar : DEFAULT_LUNAR;
        const months = (tbl && tbl.months) || DEFAULT_LUNAR.months;
        if (cs.year != null) out.year = cs.year | 0;
        let m = cs.month != null ? cs.month | 0 : null;
        if (m != null) {
            if (m < 1 || m > months.length) { m = Math.min(months.length, Math.max(1, m)); warnings.push(`农历月份已夹紧到有效范围`); valid = false; }
            out.month = m;
        }
        let d = cs.date != null ? cs.date | 0 : null;
        if (d != null) {
            if (m != null) {
                const max = months[m - 1] ? months[m - 1].days : 30;
                if (d > max) { d = max; warnings.push(`该农历月最多 ${max} 天，已夹紧`); valid = false; }
                else if (d < 1) { d = 1; warnings.push(`日期已修正为 1`); valid = false; }
                out.date = d;
            } else {
                out.date = Math.max(1, d); // 无月份时仅记录日期
            }
        }
        if (mode === "custom_calendar" && cs.custom_calendar) out.custom_calendar = cs.custom_calendar;
    } else {
        return { valid: true, warnings, corrected: null };
    }
    return { valid, warnings, corrected: out };
}

// 默认农历月历（12 个月，大小月交替 30/29，约 354 天/年；进阶可换 custom_calendar）
export const DEFAULT_LUNAR = {
    label: "农历",
    months: [
        { name: "正月", days: 30 }, { name: "二月", days: 29 }, { name: "三月", days: 30 },
        { name: "四月", days: 29 }, { name: "五月", days: 30 }, { name: "六月", days: 29 },
        { name: "七月", days: 30 }, { name: "八月", days: 29 }, { name: "九月", days: 30 },
        { name: "十月", days: 29 }, { name: "冬月", days: 30 }, { name: "腊月", days: 29 }
    ]
};

function num(x) { return Number.isFinite(x) ? x : 0; }

// 农历/自定义 日序中文（初一/十一/廿三/卅一）
function cnDay(d) {
    const n = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    if (d <= 10) return "初" + n[d - 1];
    if (d <= 20) return "十" + n[d - 11];
    if (d <= 30) return "廿" + n[d - 21];
    return "卅" + (n[d - 31] || "");
}

// ---------- 通用月历表推进（保证月末夹紧 + 天数进位/借位）----------

function addByTable(cd, change, months) {
    const M = months.length;
    if (M === 0) return { ...cd };
    const years = change.years || 0;
    const monthsAdd = change.months || 0;
    const daysAdd = change.days || 0;
    let y = (cd.year || 0) + years;
    let mIdx = (cd.month || 1) - 1 + monthsAdd;
    y += Math.floor(mIdx / M);
    mIdx = ((mIdx % M) + M) % M;
    // 月末夹紧：先把起始日夹紧到目标月长度，再加天数增量（如 1月31日 +1月 = 2月28日，而非 3月3日）
    let d = Math.min(cd.date || 1, months[mIdx].days) - 1; // 0-based 便于借位
    d += daysAdd;
    while (d >= months[mIdx].days) { d -= months[mIdx].days; mIdx++; if (mIdx >= M) { mIdx -= M; y++; } }
    while (d < 0) { mIdx--; if (mIdx < 0) { mIdx += M; y--; } d += months[mIdx].days; }
    return { year: y, month: mIdx + 1, date: d + 1 };
}

// ---------- 各模式「加时间」----------

// gregorian：按真实月长（含闰年），月末夹紧。
export function addGregorian(cd, change = {}) {
    const y0 = cd.year || 0;
    const yTarget = y0 + (change.years || 0);
    const months = [];
    for (let m = 1; m <= 12; m++) months.push({ name: String(m), days: daysInMonth(yTarget, m) });
    return addByTable(cd, change, months);
}

export function addLunar(cd, change = {}, lunar = DEFAULT_LUNAR) {
    return addByTable(cd, change, lunar.months);
}

export function addCustom(cd, change = {}, custom = null) {
    const months = (custom && Array.isArray(custom.months) && custom.months.length)
        ? custom.months
        : DEFAULT_LUNAR.months;
    return addByTable(cd, change, months);
}

// 按模式分派
export function addCalendar(cd, change, mode, custom = null) {
    if (mode === "lunar") return addLunar(cd, change, custom && custom.months ? custom : DEFAULT_LUNAR);
    if (mode === "custom_calendar") return addCustom(cd, change, custom);
    return addGregorian(cd, change); // gregorian 默认；day/none 不应传 dated cd
}

// ---------- 比较（方案 B 核心：按模式分派，无 ordinal 互转）----------

export function compareCalendar(a, b, mode, custom = null) {
    if (mode === "gregorian" || mode === "lunar" || mode === "custom_calendar") {
        for (const k of ["year", "month", "date"]) {
            const av = num(a && a[k]);
            const bv = num(b && b[k]);
            if (av !== bv) return av < bv ? -1 : 1;
        }
        return 0;
    }
    // period / none / 其他：以 step（剧情步）为准，退化用 day
    const as = num(a && a.step) || num(a && a.day);
    const bs = num(b && b.step) || num(b && b.day);
    if (as !== bs) return as < bs ? -1 : 1;
    return 0;
}

// ---------- 展示 ----------

export function gregorianWeekday(y, m, d) {
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    return dt.getUTCDay(); // 0=周日
}

export function formatCalendarDate(cd, mode, custom = null, opts = {}) {
    const showYear = opts.showYear !== false; // 默认显示年；年无关模式（calendar_start 无 year）传 false
    if (mode === "gregorian") {
        const y = cd.year, m = cd.month, d = cd.date;
        const parts = [];
        if (showYear && y != null) parts.push(`${y}年`);
        if (m != null) parts.push(`${m}月`);
        if (d != null) parts.push(`${d}日`);
        if (parts.length === 0) return "";
        const wd = (showYear && y != null && m != null && d != null) ? WEEKDAY_CN[gregorianWeekday(y, m, d)] : "";
        return parts.join("") + (wd ? ` · ${wd}` : "");
    }
    if (mode === "lunar") {
        const tbl = (custom && custom.months) ? custom : DEFAULT_LUNAR;
        const mName = (cd.month != null)
            ? ((tbl.months[((cd.month - 1) % tbl.months.length + tbl.months.length) % tbl.months.length] || {}).name || `第${cd.month}月`)
            : "";
        const dPart = (cd.date != null) ? cnDay(cd.date) : "";
        return [tbl.label || "农历", mName, dPart].filter(Boolean).join("");
    }
    if (mode === "custom_calendar") {
        const tbl = (custom && custom.months) ? custom : DEFAULT_LUNAR;
        const mName = (cd.month != null)
            ? ((tbl.months[((cd.month - 1) % tbl.months.length + tbl.months.length) % tbl.months.length] || {}).name || `月${cd.month}`)
            : "";
        const dPart = (cd.date != null) ? `${cd.date}日` : "";
        const pre = tbl.label ? tbl.label + " " : "星历";
        return [pre + mName, dPart].filter(Boolean).join("");
    }
    return "";
}

// ---------- 主推进入口（time-engine 调用）----------

// change: { years, months, days, steps }
//   years/months/days = 日历推进（大跳跃）；steps = 剧情步推进（默认 +1）
// 返回新的 current_date（不修改入参）。step 仅增。
export function advanceCalendarTime(currentDate, change = {}, mode = "day", periods = null, custom = null) {
    const next = { ...currentDate };
    const stepInc = (change.steps != null) ? change.steps : 1;
    next.step = (next.step || 0) + Math.max(0, stepInc);

    if (mode === "period" || mode === "day") {
        // period / day 模式：day 即"第 N 天"，与 step 同义，一并推进
        next.day = (next.day || 0) + Math.max(0, stepInc);
        return next;
    }
    if (mode === "none") {
        // none 模式：无真实日期，仅推进 step（不显示）
        return next;
    }
    // dated modes：原生日期推进
    const cd = { year: num(next.year), month: num(next.month) || 1, date: num(next.date) || 1 };
    const calChange = { years: change.years || 0, months: change.months || 0, days: change.days || 0 };
    let adv;
    if (mode === "lunar") adv = addLunar(cd, calChange, custom && custom.months ? custom : DEFAULT_LUNAR);
    else if (mode === "custom_calendar") adv = addCustom(cd, calChange, custom);
    else adv = addGregorian(cd, calChange);
    next.year = adv.year;
    next.month = adv.month;
    next.date = adv.date;
    return next;
}

// 确保 current_date 形状合法：dated 模式补齐 year/month/date/step；period 模式补齐 day/step。
// 不修改入参。用于"无时间变更"分支与原档回退后的规范化。
export function ensureCurrentDate(currentDate, timeConfig = {}) {
    const mode = timeConfig.calendar_mode;
    const cd = { ...(currentDate && typeof currentDate === "object" ? currentDate : {}) };
    if (mode === "gregorian" || mode === "lunar" || mode === "custom_calendar") {
        const start = timeConfig.calendar_start || null;
        // 方案 22：各字段独立补齐；年份优先 current_date → calendar_start → 纪元锚点 → 1
        if (cd.year == null) {
            if (start && Number.isFinite(start.year)) cd.year = start.year;
            else cd.year = deriveAnchorYear(timeConfig.era_label) ?? 1;
        }
        if (cd.month == null) cd.month = (start && Number.isFinite(start.month)) ? start.month : 1;
        if (cd.date == null) cd.date = (start && Number.isFinite(start.date)) ? start.date : 1;
        if (cd.step == null) cd.step = 1;
        if (!cd.period) cd.period = "morning";
    } else {
        if (cd.day == null) cd.day = 1;
        if (cd.step == null) cd.step = cd.day;
        if (!cd.period) cd.period = "morning";
    }
    return cd;
}

// ---------- 旧档回推（Phase 1 的 normalizeSimulationState 使用）----------

// 旧档 current_date = {day, period} → 按世界 time_config 回推为原生 current_date。
//   dated 模式：calendar_start + (day-1) 天；step = day
//   day/none  ：{ step: day, period }
export function backfillCurrentDate(oldDate, timeConfig) {
    const period = (oldDate && oldDate.period) || "morning";
    const day = Number.isFinite(oldDate && oldDate.day) ? oldDate.day : 1;
    const mode = timeConfig && timeConfig.calendar_mode;
    if (mode === "gregorian" || mode === "lunar" || mode === "custom_calendar") {
        const start = (timeConfig && timeConfig.calendar_start) || {};
        const startYear = Number.isFinite(start.year) ? start.year : (deriveAnchorYear(timeConfig && timeConfig.era_label) ?? 1);
        const adv = addCalendar(
            { year: startYear, month: start.month || 1, date: start.date || 1 },
            { days: day - 1 },
            mode,
            timeConfig && timeConfig.custom_calendar
        );
        return { year: adv.year, month: adv.month, date: adv.date, period, step: day };
    }
    return { step: day, period };
}

// 载入/新建时一次性规范化 current_date：
//   - 旧档（dated 世界仅带 day/period）：回推为原生 年/月/日（calendar_start + (day-1) 天），并去掉残留 day
//   - 其余：ensureCurrentDate 补齐缺失字段（year/month/date/step/period 等）
// 不修改入参。
export function normalizeCurrentDate(currentDate, timeConfig = {}) {
    const cd = (currentDate && typeof currentDate === "object") ? currentDate : {};
    const mode = timeConfig.calendar_mode;
    const isDated = mode === "gregorian" || mode === "lunar" || mode === "custom_calendar";
    if (isDated && cd.day != null && cd.year == null && cd.month == null && cd.date == null) {
        return backfillCurrentDate(cd, timeConfig);
    }
    return ensureCurrentDate(cd, timeConfig);
}

// ---------- 自定义历法可视化编辑器辅助（docs/35 / UI-1 方案 C）----------

// 预设月历表：农历=现成 DEFAULT_LUNAR；科幻历=示例（10 个「周期」各 36 天，360 天年）。
export const CUSTOM_CALENDAR_PRESETS = {
    lunar: DEFAULT_LUNAR.months.map(m => ({ name: m.name, days: m.days })),
    scifi: Array.from({ length: 10 }, (_, i) => ({ name: `周期 ${i + 1}`, days: 36 }))
};

// 夹紧自定义月份数组：≤24 月、天数夹取 1–400、月名空回退「月N」、剥离非法项。
// 与 store.normalizeTimeConfig 的 custom_calendar 归一化保持一致（≤24 月、days 1–400、label≤20）。
export function clampCustomCalendarMonths(months) {
    const arr = Array.isArray(months) ? months : [];
    return arr.slice(0, 24).map((m, i) => ({
        name: (m && typeof m.name === "string" && m.name.trim()) ? m.name.trim().slice(0, 10) : `月${i + 1}`,
        days: Math.min(400, Math.max(1, Number.isFinite(m && m.days) ? (m.days | 0) : 30))
    }));
}

// 统计自定义历法：月数与一年总天数，并给一个示例日期串（供编辑器实时展示）。
export function summarizeCustomCalendar(cc) {
    const months = (cc && cc.months) || [];
    const monthCount = months.length;
    const yearDays = months.reduce((s, m) => s + (Number.isFinite(m && m.days) ? m.days : 0), 0);
    const label = (cc && cc.label) || "星历";
    const sample = monthCount ? `${label} 第1年 ${months[0].name} 1日` : "（尚未配置月份）";
    return { monthCount, yearDays, sample };
}

// 重排月份：把 from 位置元素移到 to 位置（越界夹紧，不改变数组长度）。
export function reorderMonths(months, from, to) {
    const arr = Array.isArray(months) ? months.slice() : [];
    if (from < 0 || from >= arr.length) return arr;
    const t = Math.min(arr.length - 1, Math.max(0, to));
    const [item] = arr.splice(from, 1);
    arr.splice(t, 0, item);
    return arr;
}

// 插入闰月：在 afterIdx 之后插入一个名为 name 的月份（默认 30 天）。
export function insertLeapMonth(months, afterIdx, name = "闰月", days = 30) {
    const arr = Array.isArray(months) ? months.slice() : [];
    const idx = (afterIdx == null) ? arr.length - 1 : Math.min(arr.length, Math.max(-1, afterIdx));
    arr.splice(idx + 1, 0, { name: String(name).slice(0, 10), days: Math.min(400, Math.max(1, days | 0)) });
    return arr;
}

