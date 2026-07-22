import { addCalendar, compareCalendar, advanceCalendarTime } from "./calendar.js";
import { evalPolicy } from "./triggers.js";

const DAY_MINUTES = 1440;
const DEFAULT_STARTS = [360, 540, 780, 1080, 1260];
// 向后兼容：调用方可能直接传 periods 数组（旧测试/旧代码）
const DEFAULT_ORDER = ["morning", "forenoon", "afternoon", "evening", "night"];

const DATED_MODES = ["gregorian", "lunar", "custom_calendar"];

function periodStarts(periods) {
    if (periods.length === DEFAULT_STARTS.length) return DEFAULT_STARTS;
    return periods.map((_, index) => Math.floor(index * DAY_MINUTES / Math.max(1, periods.length)));
}

function parseClock(clock) {
    const match = String(clock || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function formatClock(minutes) {
    const value = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function periodAt(minuteOfDay, periods) {
    const starts = periodStarts(periods);
    let index = 0;
    for (let i = 0; i < starts.length; i++) if (minuteOfDay >= starts[i]) index = i;
    return periods[index] || periods[0] || "morning";
}

// 解析 tc（timeConfig 兼容）：数组 → 视为 periods（day 模式）
function resolveTc(tc) {
    if (Array.isArray(tc)) return { calendar_mode: "day", periods: tc };
    const t = tc && typeof tc === "object" ? tc : {};
    return {
        calendar_mode: t.calendar_mode || (t.timeConfig && t.timeConfig.calendar_mode) || "day",
        periods: t.periods || (t.timeConfig && t.timeConfig.periods) || DEFAULT_ORDER,
        calendar_start: t.calendar_start || (t.timeConfig && t.timeConfig.calendar_start) || null,
        custom_calendar: t.custom_calendar || (t.timeConfig && t.timeConfig.custom_calendar) || null
    };
}

// 旧 day-based 推进（period / day / none 模式沿用，行为不变）
function advanceWorldTimeLegacy(currentDate, change, periods = []) {
    const order = periods.length ? periods : DEFAULT_ORDER;
    const current = hydrateWorldTime(currentDate, order);
    const request = change && typeof change === "object" ? change : {};
    const legacyElapsed = Number.isFinite(request.clock_minutes) ? request.clock_minutes : 0;
    const elapsed = Number.isFinite(request.elapsed_minutes) ? request.elapsed_minutes : legacyElapsed;
    let targetAbsolute = current.absolute_minutes;

    if (elapsed > 0) {
        targetAbsolute += Math.floor(elapsed);
    } else if (request.day != null || request.period != null || request.clock != null) {
        const targetDay = Number.isFinite(request.day) ? Math.max(1, Math.floor(request.day)) : current.day;
        const explicitClock = parseClock(request.clock);
        const periodIndex = request.period != null ? order.indexOf(request.period) : -1;
        const minuteOfDay = explicitClock != null
            ? explicitClock
            : periodIndex >= 0
                ? periodStarts(order)[periodIndex]
                : current.absolute_minutes % DAY_MINUTES;
        targetAbsolute = (targetDay - 1) * DAY_MINUTES + minuteOfDay;
    }

    // 方案 B：允许时间倒流（含穿越回过去），不再拒绝倒退
    const next = hydrateWorldTime({ ...current, ...request, absolute_minutes: targetAbsolute }, order);
    return {
        currentDate: next,
        changed: targetAbsolute !== current.absolute_minutes,
        rejected: false,
        elapsedMinutes: targetAbsolute - current.absolute_minutes
    };
}

export function hydrateWorldTime(currentDate, periods = []) {
    const source = currentDate && typeof currentDate === "object" ? currentDate : {};
    const order = periods.length ? periods : DEFAULT_ORDER;
    let absolute;
    if (Number.isFinite(source.absolute_minutes) && source.absolute_minutes >= 0) {
        absolute = Math.floor(source.absolute_minutes);
    } else {
        const day = Number.isFinite(source.day) ? Math.max(1, Math.floor(source.day)) : 1;
        const clockMinute = parseClock(source.clock);
        const periodIndex = Math.max(0, order.indexOf(source.period));
        const minuteOfDay = clockMinute == null ? periodStarts(order)[periodIndex] : clockMinute;
        absolute = (day - 1) * DAY_MINUTES + minuteOfDay;
    }
    const day = Math.floor(absolute / DAY_MINUTES) + 1;
    const minuteOfDay = absolute % DAY_MINUTES;
    return {
        ...source,
        day,
        period: periodAt(minuteOfDay, order),
        clock: formatClock(minuteOfDay),
        absolute_minutes: absolute
    };
}

export function advanceWorldTime(currentDate, change, tc = {}) {
    const ctx = resolveTc(tc);
    const current = currentDate && typeof currentDate === "object" ? currentDate : {};
    const req = change && typeof change === "object" ? change : {};

    // 目标 period
    const period = req.period != null ? req.period : current.period;

    if (DATED_MODES.includes(ctx.calendar_mode)) {
        // ===== dated 模式：方案 B（无隐藏序数，原生日期按模式分派）=====
        const start = ctx.calendar_start || { year: 1, month: 1, date: 1 };
        const cur = {
            year: current.year != null ? current.year : start.year,
            month: current.month != null ? current.month : start.month,
            date: current.date != null ? current.date : start.date
        };
        let calChange = {};
        if (req.year != null || req.month != null || req.date != null) {
            // 绝对跳转（含时间倒流，方案 B 允许）
            const ty = req.year != null ? req.year : cur.year;
            const tm = req.month != null ? req.month : cur.month;
            const td = req.date != null ? req.date : cur.date;
            calChange = { years: ty - cur.year, months: tm - cur.month, days: td - cur.date };
        } else {
            calChange = { years: req.addYears || 0, months: req.addMonths || 0, days: req.addDays || 0 };
        }
        const newCal = addCalendar(cur, calChange, ctx.calendar_mode, ctx.custom_calendar);
        const advancedByCal = compareCalendar(newCal, cur, ctx.calendar_mode, ctx.custom_calendar) !== 0;
        const changed = advancedByCal || period !== current.period || !!(req.addDays || req.addMonths || req.addYears);
        const next = advanceCalendarTime(
            current,
            { years: calChange.years, months: calChange.months, days: calChange.days, steps: changed ? 1 : 0 },
            ctx.calendar_mode,
            ctx.periods,
            ctx.custom_calendar
        );
        next.period = period;
        return { currentDate: next, changed: !!changed, rejected: false, elapsedMinutes: 0 };
    }

    // ===== period / day / none 模式：沿用旧逻辑 =====
    return advanceWorldTimeLegacy(current, req, ctx.periods);
}

export function collectDueDeadlines(currentDate, deadlines, tc = [], triggeredIds = new Set(), retriggerState = {}, step = 0) {
    const ctx = resolveTc(tc);
    const current = currentDate && typeof currentDate === "object" ? currentDate : {};
    const seen = triggeredIds instanceof Set ? triggeredIds : new Set(triggeredIds || []);
    const reState = retriggerState && typeof retriggerState === "object" ? retriggerState : {};

    // dated 模式：deadline 用 {year,month,date,period}（或回退 calendar_start）；按原生日期比较
    if (DATED_MODES.includes(ctx.calendar_mode)) {
        const start = ctx.calendar_start || { year: 1, month: 1, date: 1 };
        const cur = {
            year: current.year != null ? current.year : start.year,
            month: current.month != null ? current.month : start.month,
            date: current.date != null ? current.date : start.date
        };
        return (Array.isArray(deadlines) ? deadlines : []).map((deadline, index) => {
            if (!deadline) return null;
            const seed = `${deadline.title || "deadline"}_${deadline.year || deadline.month || 0}_${deadline.date || deadline.day || 0}_${deadline.period || ""}_${index}`;
            let hash = 0;
            for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
            return { ...deadline, id: deadline.id || `deadline_${Math.abs(hash).toString(36)}` };
        }).filter(deadline => {
            if (!deadline) return false;
            const target = {
                year: deadline.year != null ? deadline.year : start.year,
                month: deadline.month != null ? deadline.month : 1,
                date: deadline.date != null ? deadline.date : 1
            };
            if (compareCalendar(cur, target, ctx.calendar_mode, ctx.custom_calendar) < 0) return false; // 时间未抵达
            return evalPolicy(deadline, seen, reState, step).due; // S1/S2：按策略判定
        });
    }

    // 旧逻辑（period / day / none）：deadline 用 {day, period}
    return (Array.isArray(deadlines) ? deadlines : []).map((deadline, index) => {
        if (!deadline) return null;
        const seed = `${deadline.title || "deadline"}_${deadline.day || 0}_${deadline.period || ""}_${index}`;
        let hash = 0;
        for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        return { ...deadline, id: deadline.id || `deadline_${Math.abs(hash).toString(36)}` };
    }).filter(deadline => {
        if (!deadline) return false;
        const target = hydrateWorldTime({ day: deadline.day, period: deadline.period }, ctx.periods);
        if (hydrateWorldTime(current, ctx.periods).absolute_minutes < target.absolute_minutes) return false; // 时间未抵达
        return evalPolicy(deadline, seen, reState, step).due; // S1/S2：按策略判定
    });
}
