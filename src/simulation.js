function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function stableId(prefix, text) {
    let hash = 0;
    for (const char of String(text || "")) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return `${prefix}_${Math.abs(hash).toString(36)}`;
}

function normalizeEvent(value, status = "active") {
    const raw = typeof value === "string" ? { title: value } : (value || {});
    const title = String(raw.title || raw.name || raw.id || "未命名事件").slice(0, 200);
    return {
        id: String(raw.id || stableId("event", title)).slice(0, 80),
        title,
        stage: String(raw.stage || (status === "completed" ? "已完成" : "进行中")).slice(0, 100),
        status,
        location: String(raw.location || "").slice(0, 100),
        impact: String(raw.impact || "").slice(0, 300),
        updated_at: raw.updated_at || null,
        ...(raw.completed_at ? { completed_at: clone(raw.completed_at) } : {})
    };
}

function normalizeNpcActivity(value) {
    const out = {};
    for (const [name, activity] of Object.entries(value && typeof value === "object" ? value : {})) {
        const raw = typeof activity === "string" ? { action: activity } : (activity || {});
        out[name] = {
            action: String(raw.action || raw.activity || "").slice(0, 300),
            goal: String(raw.goal || "").slice(0, 200),
            location: String(raw.location || "").slice(0, 100),
            visible: raw.visible !== false,
            updated_at: raw.updated_at || null
        };
    }
    return out;
}

export function normalizeSimulationState(state) {
    const out = clone(state && typeof state === "object" ? state : {});
    const activeSource = Array.isArray(out.active_events)
        ? out.active_events
        : out.active_event
            ? [out.active_event]
            : [];
    out.active_events = activeSource.map(event => normalizeEvent(event, "active"));
    out.active_event = out.active_events[0] || null;
    out.completed_events = (Array.isArray(out.completed_events) ? out.completed_events : [])
        .map(event => normalizeEvent(event, "completed"));
    out.npc_activity = normalizeNpcActivity(out.npc_activity);
    return out;
}

export function applySimulationChanges(state, changes, currentTime) {
    const out = normalizeSimulationState(state);
    const update = changes && typeof changes === "object" ? changes : {};
    const timestamp = currentTime ? clone(currentTime) : null;
    const triggered = update.active_events || (update.triggered_event ? [update.triggered_event] : []);
    for (const raw of Array.isArray(triggered) ? triggered : [triggered]) {
        if (!raw) continue;
        const event = normalizeEvent(raw, "active");
        event.updated_at = timestamp;
        const index = out.active_events.findIndex(existing => existing.id === event.id);
        if (index >= 0) out.active_events[index] = { ...out.active_events[index], ...event };
        else out.active_events.push(event);
    }
    for (const raw of Array.isArray(update.completed_events) ? update.completed_events : []) {
        const event = normalizeEvent(raw, "completed");
        event.completed_at = timestamp;
        out.active_events = out.active_events.filter(existing => existing.id !== event.id && existing.title !== event.title);
        const index = out.completed_events.findIndex(existing => existing.id === event.id || existing.title === event.title);
        if (index >= 0) out.completed_events[index] = { ...out.completed_events[index], ...event };
        else out.completed_events.push(event);
    }
    if (update.npc_activity) {
        const npcUpdates = normalizeNpcActivity(update.npc_activity);
        for (const [name, activity] of Object.entries(npcUpdates)) {
            out.npc_activity[name] = { ...(out.npc_activity[name] || {}), ...activity, updated_at: timestamp };
        }
    }
    out.active_event = out.active_events[0] || null;
    return out;
}

export function buildWorldSummary(state) {
    const normalized = normalizeSimulationState(state);
    const location = normalized.current_location || "未知地点";
    const visibleNpcCount = Object.values(normalized.npc_activity).filter(npc => npc.visible !== false).length;
    const activeGoal = (normalized.goals || []).find(goal => goal.visible !== false && goal.status === "active");
    const activeEvent = normalized.active_events[0];
    const parts = [`你当前在「${location}」`];
    if (activeEvent) parts.push(`正在发生「${activeEvent.title}」`);
    if (visibleNpcCount) parts.push(`${visibleNpcCount} 位 NPC 正在行动`);
    if (activeGoal) parts.push(`当前可介入目标：「${activeGoal.name || activeGoal.goal_id}」`);
    if (!activeEvent && !activeGoal) parts.push("世界暂时平静");
    return parts.join("；") + "。";
}

export function createRestEvent(from, to, location = "") {
    return {
        id: `rest_${to?.day || 1}_${to?.period || "morning"}`,
        type: "rest",
        title: "休息并迎来新的一天",
        stage: "已完成",
        status: "completed",
        location: String(location || "").slice(0, 100),
        from: clone(from),
        to: clone(to)
    };
}
