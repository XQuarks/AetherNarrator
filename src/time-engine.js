const DAY_MINUTES = 1440;
const DEFAULT_STARTS = [360, 540, 780, 1080, 1260];

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

export function hydrateWorldTime(currentDate, periods = []) {
    const source = currentDate && typeof currentDate === "object" ? currentDate : {};
    const order = periods.length ? periods : ["morning"];
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

export function advanceWorldTime(currentDate, change, periods = []) {
    const order = periods.length ? periods : ["morning"];
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

    if (targetAbsolute < current.absolute_minutes) {
        return { currentDate: current, changed: false, rejected: true };
    }
    const next = hydrateWorldTime({ ...current, ...request, absolute_minutes: targetAbsolute }, order);
    return {
        currentDate: next,
        changed: targetAbsolute > current.absolute_minutes,
        rejected: false,
        elapsedMinutes: targetAbsolute - current.absolute_minutes
    };
}

export function collectDueDeadlines(currentDate, deadlines, periods = [], triggeredIds = new Set()) {
    const current = hydrateWorldTime(currentDate, periods);
    const seen = triggeredIds instanceof Set ? triggeredIds : new Set(triggeredIds || []);
    return (Array.isArray(deadlines) ? deadlines : []).map((deadline, index) => {
        if (!deadline) return null;
        const seed = `${deadline.title || "deadline"}_${deadline.day || 0}_${deadline.period || ""}_${index}`;
        let hash = 0;
        for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        return { ...deadline, id: deadline.id || `deadline_${Math.abs(hash).toString(36)}` };
    }).filter(deadline => {
        if (!deadline || seen.has(deadline.id)) return false;
        const target = hydrateWorldTime({ day: deadline.day, period: deadline.period }, periods);
        return current.absolute_minutes >= target.absolute_minutes;
    });
}
