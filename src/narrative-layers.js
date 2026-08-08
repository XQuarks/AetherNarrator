// ★ docs/76：平行时间轴叙事层引擎（纯函数，可单测）
// 设计：每条叙事层持有一份「核心玩法字段」的完整 deepClone 副本（state_clone）；
// 切换层 = 把当前激活层进度存盘 + 把目标层副本恢复进 gs（story_progress 随副本自然切换，无需改既有读取站点）。
// 本文件刻意不 import game.js，避免循环依赖；system prompt 缓存失效由调用方（app.js/game.js 动作）负责。

import { deepClone } from "./utils.js";

// 叙事层保存的「核心玩法字段」白名单（不含叙事层簿记字段，避免递归）
export const CORE_FIELDS = [
    "name", "age", "background", "personality",
    "attributes", "progression", "relationships", "skills", "skill_growth",
    "inventory", "completed_events",
    "current_location", "story_progress", "current_date",
    "triggered_event_ids", "retrigger_state", "branches",
    "goals", "status_effects",
    "tags", "present_npcs", "situation_tags", "revealed_locations",
    "is_alive", "death_reason", "unlockedEndings", "random_event_state"
];

export function captureCore(gs) {
    const out = {};
    if (!gs || typeof gs !== "object") return out;
    for (const k of CORE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(gs, k)) out[k] = deepClone(gs[k]);
    }
    return out;
}

export function applyCore(gs, core) {
    if (!gs || !core || typeof core !== "object") return;
    for (const k of CORE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(core, k)) gs[k] = deepClone(core[k]);
    }
}

// 懒初始化：无 layers 时建主线（基准=当前状态）；已有时仅校准 active 指针。
export function ensureNarrativeLayers(gs) {
    if (gs.narrative_layers && typeof gs.narrative_layers === "object"
        && Object.keys(gs.narrative_layers).length) {
        if (!gs.active_narrative_layer || !gs.narrative_layers[gs.active_narrative_layer]) {
            gs.active_narrative_layer = "main";
        }
        return gs.narrative_layers;
    }
    const core = captureCore(gs);
    gs.narrative_layers = {
        main: { id: "main", label: "主线", core, lore_scope: [], active: true }
    };
    gs.active_narrative_layer = "main";
    if (typeof gs.player_influence !== "number") gs.player_influence = 0;
    if (!Array.isArray(gs.consumed_influence_tiers)) gs.consumed_influence_tiers = [];
    if (!Array.isArray(gs.pendingInfluenceEvents)) gs.pendingInfluenceEvents = [];
    return gs.narrative_layers;
}

export function getActiveLayer(gs) {
    if (!gs || !gs.narrative_layers) return null;
    return gs.narrative_layers[gs.active_narrative_layer || "main"] || null;
}

// 把当前激活层的进度写回其副本（切换前/每回合末调用，保证进度不丢）
export function saveActiveLayer(gs) {
    if (!gs || !gs.narrative_layers) return;
    const id = gs.active_narrative_layer || "main";
    if (gs.narrative_layers[id]) gs.narrative_layers[id].core = captureCore(gs);
}

// 切换叙事层（确定性；调用方负责失效 system prompt 缓存）
export function switchNarrativeLayer(gs, id) {
    if (!gs || !gs.narrative_layers || !gs.narrative_layers[id]) return false;
    if (id === gs.active_narrative_layer) return true; // 已在目标层
    saveActiveLayer(gs);                 // 先把当前层进度存盘
    applyCore(gs, gs.narrative_layers[id].core); // 恢复目标层副本
    gs.active_narrative_layer = id;
    return true;
}

// 自动 fork 一条新叙事层（沿用 createBranch 的「父线保留 + 独立」思路，但作用于 narrative_layers）
export function forkNarrativeLayer(gs, label) {
    ensureNarrativeLayers(gs);
    const parentId = gs.active_narrative_layer || "main";
    const parent = gs.narrative_layers[parentId];
    let n = 1;
    while (gs.narrative_layers["layer_" + n]) n++;
    const id = "layer_" + n;
    // 先把当前（父线）最新进度存进父层副本，再克隆，确保新层从「当前真实状态」分岔
    saveActiveLayer(gs);
    const layer = {
        id,
        label: label || ("衍生线 " + n),
        core: deepClone(parent.core),
        lore_scope: Array.isArray(parent.lore_scope) ? [...parent.lore_scope] : [],
        active: true,
        derived_from: parentId,
        fork_influence: (typeof gs.player_influence === "number") ? gs.player_influence : 0
    };
    gs.narrative_layers[id] = layer;
    gs.active_narrative_layer = id;
    return id;
}

// 跨层影响注入：把「旧层某抉择」的影响度投影到新层基准（蝴蝶效应可视化）。
// 简化实现：新层 core 已是父层克隆（天然包含该抉择后果）；此处额外记录导致分叉的本回合增量摘要，
// 供 UI 展示「本线因何分岔」。更深层的「后果推演」可作为后续扩展。
export function injectCrossLayerInfluence(layer, sourceDelta) {
    if (!layer || typeof layer !== "object") return layer;
    if (sourceDelta && typeof sourceDelta === "object") {
        layer.fork_cause = {
            bonds: sourceDelta.bonds ? Object.keys(sourceDelta.bonds) : [],
            completed_events: Array.isArray(sourceDelta.completed_events) ? sourceDelta.completed_events : [],
            endings: Array.isArray(sourceDelta.endings) ? sourceDelta.endings : []
        };
    }
    return layer;
}

export function layerCount(gs) {
    return gs && gs.narrative_layers ? Object.keys(gs.narrative_layers).length : 0;
}
