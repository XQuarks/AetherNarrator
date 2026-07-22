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

export function formatCalendarDate(cd, mode, custom = null) {
    if (mode === "gregorian") {
        const y = cd.year, m = cd.month, d = cd.date;
        const wd = WEEKDAY_CN[gregorianWeekday(y, m, d)];
        return `${y}年${m}月${d}日 · ${wd}`;
    }
    if (mode === "lunar") {
        const tbl = (custom && custom.months) ? custom : DEFAULT_LUNAR;
        const mName = (tbl.months[((cd.month - 1) % tbl.months.length + tbl.months.length) % tbl.months.length] || {}).name || `第${cd.month}月`;
        return `${tbl.label || "农历"}${mName}${cnDay(cd.date)}`;
    }
    if (mode === "custom_calendar") {
        const tbl = (custom && custom.months) ? custom : DEFAULT_LUNAR;
        const mName = (tbl.months[((cd.month - 1) % tbl.months.length + tbl.months.length) % tbl.months.length] || {}).name || `月${cd.month}`;
        const pre = tbl.label ? tbl.label + " " : "星历";
        return `${pre}${mName}${cd.date}日`;
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
        if (cd.year == null && cd.month == null && cd.date == null) {
            const start = timeConfig.calendar_start || { year: 1, month: 1, date: 1 };
            cd.year = start.year; cd.month = start.month; cd.date = start.date;
        }
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
        const start = (timeConfig && timeConfig.calendar_start) || { year: 1, month: 1, date: 1 };
        const adv = addCalendar(
            { year: start.year, month: start.month, date: start.date },
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

