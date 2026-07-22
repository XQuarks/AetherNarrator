// src/triggers.js
// Phase 3 · 已触发事件四策略（S1 不重触发 / S2 可重复 / S3 重置回放 / S4 分支隔离）
// 纯函数，无 DOM 依赖，可直接 node 单测；不引入任何外部模块以避免循环依赖。

export const TIMELINE_MAIN = "main";

// 取出当前激活的时间线/分支 key（单世界默认 main）
export function activeTimelineKey(state) {
    return (state && state.active_timeline) || TIMELINE_MAIN;
}

function clone(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch { return x; }
}

// 把任意 current_date 转成 step（剧情步），用于 repeatable 的冷却判定
function stepOfDate(cd) {
    if (!cd || typeof cd !== "object") return 0;
    if (typeof cd.step === "number") return cd.step;
    if (typeof cd.day === "number") return cd.day;
    return 0;
}

// S3-1：归一化触发记录结构，并迁移旧档 flat 数组 triggered_deadlines → triggered_event_ids.main
export function normalizeTriggeredEvents(state) {
    if (!state || typeof state !== "object") return state;
    // 向后兼容：旧存档可能用扁平数组 triggered_deadlines
    if (Array.isArray(state.triggered_deadlines)) {
        state.triggered_event_ids = state.triggered_event_ids && typeof state.triggered_event_ids === "object" && !Array.isArray(state.triggered_event_ids)
            ? state.triggered_event_ids
            : {};
        const set = new Set(state.triggered_event_ids[TIMELINE_MAIN] || []);
        for (const id of state.triggered_deadlines) if (id) set.add(id);
        state.triggered_event_ids[TIMELINE_MAIN] = Array.from(set);
        delete state.triggered_deadlines;
    }
    if (!state.triggered_event_ids || typeof state.triggered_event_ids !== "object" || Array.isArray(state.triggered_event_ids)) {
        state.triggered_event_ids = (Array.isArray(state.triggered_event_ids))
            ? { [TIMELINE_MAIN]: state.triggered_event_ids }
            : { [TIMELINE_MAIN]: [] };
    }
    if (!state.retrigger_state || typeof state.retrigger_state !== "object") {
        state.retrigger_state = { [TIMELINE_MAIN]: {} };
    }
    if (!state.branches || typeof state.branches !== "object") state.branches = {};
    return state;
}

// 取某条时间线/分支的触发记录（ids 集合 + retrigger 计数/冷却）
export function getTimelineTriggered(state, timelineKey) {
    const key = timelineKey || activeTimelineKey(state);
    const ids = new Set((state.triggered_event_ids && state.triggered_event_ids[key]) || []);
    const stateMap = (state.retrigger_state && state.retrigger_state[key]) || {};
    return { ids, state: stateMap };
}

// S1/S2：单事件触发策略判定（调用方已确认「时间已抵达目标」）
//   policy = "once"（默认）→ 未触发过则 due
//   policy = {mode:"repeatable", max_repeats, cooldown_steps} → 未超次数且过冷却则 due（freshRepeat=true）
export function evalPolicy(deadline, triggeredIds, retriggerState, step) {
    const id = deadline && deadline.id;
    if (!id) return { due: false, freshRepeat: false };
    const policy = deadline.retrigger_policy || "once";
    if (policy === "once") {
        return { due: !triggeredIds.has(id), freshRepeat: false };
    }
    if (policy && policy.mode === "repeatable") {
        if (!triggeredIds.has(id)) return { due: true, freshRepeat: false };
        const count = (retriggerState && retriggerState[id] && retriggerState[id].count) || 0;
        const max = (typeof policy.max_repeats === "number" && policy.max_repeats > 0) ? policy.max_repeats : Infinity;
        if (count >= max) return { due: false, freshRepeat: false };
        const cooldown = (typeof policy.cooldown_steps === "number" && policy.cooldown_steps > 0) ? policy.cooldown_steps : 0;
        const lastStep = (retriggerState && retriggerState[id] && retriggerState[id].lastStep) || 0;
        if (step - lastStep < cooldown) return { due: false, freshRepeat: false };
        return { due: true, freshRepeat: true };
    }
    return { due: !triggeredIds.has(id), freshRepeat: false };
}

// 记录一次触发（S1 写入集合；S2 累加次数与最后 step）
export function recordTrigger(state, eventId, step, timelineKey) {
    const key = timelineKey || activeTimelineKey(state);
    state.triggered_event_ids = state.triggered_event_ids || {};
    state.retrigger_state = state.retrigger_state || {};
    const ids = state.triggered_event_ids[key] || (state.triggered_event_ids[key] = []);
    if (!ids.includes(eventId)) ids.push(eventId);
    const map = state.retrigger_state[key] || (state.retrigger_state[key] = {});
    map[eventId] = { count: (map[eventId] ? map[eventId].count : 0) + 1, lastStep: step };
    return state;
}

// S3：重置回放——回滚触发记录，使重走该段可重新触发
//   which = "all"           → 清空该线全部触发记录
//   which = ["ev_a","ev_b"] → 仅回滚指定事件
export function resetTriggers(state, which, timelineKey) {
    const key = timelineKey || activeTimelineKey(state);
    state.triggered_event_ids = state.triggered_event_ids || {};
    state.retrigger_state = state.retrigger_state || {};
    if (which === "all") {
        state.triggered_event_ids[key] = [];
        state.retrigger_state[key] = {};
        return state;
    }
    const list = Array.isArray(which) ? which : (typeof which === "string" ? [which] : []);
    const ids = state.triggered_event_ids[key] || [];
    state.triggered_event_ids[key] = ids.filter(id => !list.includes(id));
    const map = state.retrigger_state[key] || {};
    for (const id of list) delete map[id];
    return state;
}

// S4：分支隔离——新建一条分支时间线，父线的触发记录与日期原样保留（原未来保留）
//   返回新建分支的 id。各分支独立触发记录。
export function createBranch(state, branchLabel, targetDate, tc) {
    const parentKey = activeTimelineKey(state);
    state.branches = state.branches || {};
    state.triggered_event_ids = state.triggered_event_ids || {};
    state.retrigger_state = state.retrigger_state || {};
    // 记录父线日期，便于切回（原未来保留）
    if (!state.branches[parentKey]) {
        state.branches[parentKey] = {
            label: parentKey === TIMELINE_MAIN ? "主线" : parentKey,
            current_date: clone(state.current_date)
        };
    }
    // 生成确定性分支 id：branch_<n>
    let n = 1;
    while (state.branches["branch_" + n]) n++;
    const branchId = "branch_" + n;
    state.branches[branchId] = {
        label: branchLabel || ("分支" + n),
        current_date: clone(targetDate)
    };
    // 独立触发记录（与父线隔离）
    state.triggered_event_ids[branchId] = [];
    state.retrigger_state[branchId] = {};
    state.active_timeline = branchId;
    state.current_date = clone(targetDate);
    return branchId;
}
