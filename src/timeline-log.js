// ============================================================
// AetherNarrator · timeline-log.js（docs/69 章节化回溯 · 回合日志）
// 借鉴 WorldLines playthrough 的轻量版：每回合保存「状态快照 + 对话切片」，
// 回溯 = 取目标回合快照恢复状态 + 从存档历史截断到该回合（无 LLM 参与，可靠）。
// 纯事件重放（用 state_changes 推演状态）在 LLM 游戏里不可行（增量不幂等），故用快照。
// ============================================================
import { idbGet, idbSet, idbDel } from "./idb.js";
import { deepClone } from "./utils.js";
import { rebuildChatFromHistory, rebuildSummaryFromHistory } from "./prompt.js";

const LOG_PREFIX = "aigame_log_";
// 每存档最多保留的回合快照数（500 回合 × ~7KB ≈ 3.5MB，IndexedDB 可承受）
export const MAX_LOG_TURNS = 500;
// 章节自动分组：每 N 回合一章（展示分组用，不影响回溯逻辑）
export const CHAPTER_TURNS = 10;

export function logKey(saveId) {
    return LOG_PREFIX + saveId;
}

// 纯函数：章节号（第 1 章 = turn 1..10）
export function chapterOf(turn) {
    return Math.floor((turn - 1) / CHAPTER_TURNS) + 1;
}

// 纯函数：回合展示 label（第X天·时段 · 地点）
export function turnLabel(entry) {
    if (!entry) return "";
    const parts = [];
    if (entry.day != null) parts.push("第" + entry.day + "天");
    else if (entry.tcd) {
        const d = entry.tcd;
        if (d.day != null) parts.push("第" + d.day + "天");
        else if (d.date != null || d.month != null) parts.push((d.month || "?") + "月" + (d.date || "?") + "日");
    }
    if (entry.period) {
        const p = { morning: "早晨", forenoon: "上午", afternoon: "下午", evening: "傍晚", night: "夜晚" }[entry.period] || entry.period;
        parts.push(p);
    }
    const loc = (entry.location || "").trim();
    if (loc) parts.push(loc);
    return parts.join(" · ");
}

// 读取日志；无则返回 null
export async function loadTurnLog(saveId) {
    if (!saveId) return null;
    try {
        return await idbGet(logKey(saveId));
    } catch (e) {
        return null;
    }
}

// 持久化日志（forkBranch 等内存改动后由调用方写盘）
export async function persistLog(log) {
    if (!log || !log.saveId) return;
    try { await idbSet(logKey(log.saveId), log); } catch (e) { /* 忽略 */ }
}

// 追加一回合快照（正常玩家回合定稿后调用）。
// 返回新日志（调用方不必再 load）；写失败返回 null（不影响主流程）。
export async function appendTurnLog(saveId, worldId, payload) {
    if (!saveId) return null;
    const log = (await loadTurnLog(saveId)) || {
        schema_version: 1, saveId, worldId,
        turns: [], branches: [], current_branch: "main"
    };
    if (!Array.isArray(log.turns)) log.turns = [];
    if (!Array.isArray(log.branches)) log.branches = [];
    const branch = log.current_branch || "main";
    const turn = log.turns.length + 1;
    const entry = payload.entry || {};
    const histIdx = (typeof payload.histIdx === "number") ? payload.histIdx : (log.turns.length ? (log.turns[log.turns.length - 1].hist_idx + 1) : 0);
    log.turns.push({
        turn,
        t: new Date().toISOString(),
        label: turnLabel(entry),
        hist_idx: histIdx,
        state: deepClone(payload.state || {}),
        entry: {
            player: (entry.player || "").slice(0, 120),
            narrative: (entry.narrative || "").slice(0, 200),
            choices: Array.isArray(entry.choices) ? entry.choices.map(c => (typeof c === "string" ? c : (c && c.text) || "")).filter(Boolean).slice(0, 6) : []
        },
        memory_count: (typeof payload.memoryCount === "number") ? payload.memoryCount : 0,
        branch,
        base_turn: (branch && branch !== "main") ? (log._baseTurnOfBranch || null) : null
    });
    delete log._baseTurnOfBranch;
    // 容量上限：丢弃最旧
    if (log.turns.length > MAX_LOG_TURNS) log.turns = log.turns.slice(-MAX_LOG_TURNS);
    try {
        await idbSet(logKey(saveId), log);
        return log;
    } catch (e) {
        return null;
    }
}

// 回溯后开启新分支（在 rewind 执行前调用；后续 appendTurnLog 将写入新分支）
export function forkBranch(log, baseTurn) {
    if (!log) return "main";
    if (!Array.isArray(log.branches)) log.branches = [];
    const branchId = "b" + Date.now().toString(36);
    log.branches.push({ id: branchId, base_turn: baseTurn, created_at: new Date().toISOString() });
    log.current_branch = branchId;
    log._baseTurnOfBranch = baseTurn;
    return branchId;
}

// 另存为新存档时复制日志（新槽位独立 key）
export async function copyTurnLog(srcSaveId, dstSaveId) {
    if (!srcSaveId || !dstSaveId || srcSaveId === dstSaveId) return;
    const log = await loadTurnLog(srcSaveId);
    if (!log) return;
    try {
        await idbSet(logKey(dstSaveId), { ...log, saveId: dstSaveId });
    } catch (e) { /* 复制失败不阻断主流程 */ }
}

// 删除存档时删除日志
export async function deleteTurnLog(saveId) {
    if (!saveId) return;
    try { await idbDel(logKey(saveId)); } catch (e) { /* 忽略 */ }
}

// ★ 回溯核心（纯函数，返回恢复后的运行时片段；不直接改 S，便于测试）
// save：存档对象（含 state/history/chatHistory/chatSummary）；log：回合日志；
// targetTurn：目标回合（日志序号 1..N）；
// opts.rebuildSummary：是否重建 chatSummary（true 用截断后的 history 重建）；
// opts.clearMemory：是否清空记忆到目标回合（默认保留）；behaviorRecords 传入以支持截断。
export function rewindToTurn(save, log, targetTurn, opts = {}) {
    const turns = (log && Array.isArray(log.turns)) ? log.turns : [];
    const snap = turns.find(t => t.turn === targetTurn);
    if (!snap) throw new Error("目标回合不在回溯日志中（turn=" + targetTurn + "）");
    const history = Array.isArray(save.history) ? save.history.slice(0, snap.hist_idx) : [];
    const chatHistory = rebuildChatFromHistory(history);
    const chatSummary = opts.rebuildSummary !== false
        ? rebuildSummaryFromHistory(history)
        : (Array.isArray(save.chatSummary) ? save.chatSummary.slice() : []);
    let behaviorRecords = null; // null = 保留现状
    if (opts.clearMemory && Array.isArray(opts.behaviorRecords)) {
        behaviorRecords = opts.behaviorRecords.slice(0, snap.memory_count);
    }
    return {
        gameState: deepClone(snap.state),
        history,
        chatHistory,
        chatSummary,
        behaviorRecords,
        label: snap.label || turnLabel(snap.entry),
        branch: snap.branch || "main"
    };
}
