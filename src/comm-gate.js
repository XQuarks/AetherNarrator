// ============================================================
// 门禁引擎（docs/53）
// ------------------------------------------------------------
// 两层门禁：
//   第一层 全局开关 = world.modules.npc_chat / world_daily（C1 模块）
//   第二层 世界状态门禁 = 混合架构：
//     · 硬预筛（免费确定性规则，挡"明显不可能"）
//     · AI 判定（其余一切，由 callStructured 产出 {allowed,channel,reason}）
// 世界状态 flags 从现有系统抽取；判定结果按"场景状态哈希"缓存。
// ============================================================

import { S } from "./store.js";
import { isModuleEnabled } from "./modules.js";
import { resolveChannels } from "./comm-channels.js";
import { aiJudgeContact } from "./llm.js";

export const PRIVATE_STAMINA_COST = 5;   // 私聊消耗体力（仅当世界有体力系统）
export const DAILY_STAMINA_COST = 3;     // 日报消耗体力（仅当世界有体力系统）

// —— 世界状态 flags 采集（纯函数，从现有系统抽 8 类）——
export function collectCommFlags(world, gameState, scene = {}) {
    const s = gameState || {};
    const tc = s.current_date || {};
    const bond = (scene.npcId && s.bonds) ? s.bonds[scene.npcId] : null;
    return {
        time_of_day: tc.period || "未知",
        location: s.current_location || scene.location || "未知",
        inventory_channels: (s.inventory || [])
            .filter(i => (i.tags && i.tags.includes("contact")) || i.is_key)
            .map(i => i.name),
        affinity: bond ? (typeof bond.affinity === "number" ? bond.affinity : 0) : null,
        stamina: (typeof (s.variables && s.variables.stamina) === "number") ? s.variables.stamina : null,
        world_constraints: (world && Array.isArray(world.comm_constraints)) ? world.comm_constraints : [],
        story_lock: !!(scene.story_lock) || !!(S && S.enteringSideEvent),
        npc_state: scene.npc_state
            || (s.present_npcs && scene.npcId && s.present_npcs.includes(scene.npcId) ? "present" : "unknown"),
        channels_available: (scene.channels || []).length
    };
}

// —— 硬预筛：只挡"明显不可能"，不浪费 AI 调用 ——
// 返回 { pass, blocked?, reason? }
export function hardPrefilter(world, gameState, action) {
    const mod = action.type === "npc_chat" ? "npc_chat" : "world_daily";
    if (!isModuleEnabled(world, mod)) return { pass: false, blocked: "module_off" };

    if (action.type === "npc_chat") {
        const chars = (world && Array.isArray(world.characters)) ? world.characters : [];
        const npc = chars.find(c => c.name === action.npcId);
        if (!npc) return { pass: false, blocked: "npc_missing", reason: `这个世界里没有叫做「${action.npcId}」的人。` };
        const bond = gameState && gameState.bonds && gameState.bonds[action.npcId];
        if (bond && bond.status === "dead") return { pass: false, blocked: "npc_dead", reason: `（${action.npcId} 已经不在了。）` };
    }

    if (!action._channels || !action._channels.length) {
        return { pass: false, blocked: "no_channel", reason: "你目前没有任何可以联络或获取消息的渠道。" };
    }
    if (action._story_lock) {
        return { pass: false, blocked: "story_lock", reason: "此刻正忙于要事，无暇他顾。" };
    }
    return { pass: true };
}

// —— 规则模式判定（不调 AI）：基于 flags 的确定性逻辑 ——
export function rulesDecision(flags, action, channels) {
    if (!channels || !channels.length) {
        return { allowed: false, channel: null, reason: "你目前没有任何可以联络或获取消息的渠道。" };
    }
    if (action._story_lock) {
        return { allowed: false, channel: null, reason: "此刻正忙于要事，无暇他顾。" };
    }
    if (action.type === "npc_chat") {
        const shared = action._sharedContacts && action._sharedContacts.length;
        if (!shared && (flags.affinity != null && flags.affinity < 20)) {
            return { allowed: false, channel: null, reason: `你和 ${action.npcId} 还不熟，对方并不打算私下交谈。` };
        }
    }
    const ch = channels[0];
    return { allowed: true, channel: ch.name, reason: "" };
}

function cacheKey(world, gameState, action, flags, mode) {
    const s = gameState || {};
    const invSig = (s.inventory || []).map(i => i.item_id).sort().join(",");
    const bondSig = Object.keys(s.bonds || {}).sort().map(k => k + ":" + ((s.bonds[k] && s.bonds[k].affinity) || 0)).join(",");
    const chanSig = (action._channels || []).map(c => c.id).sort().join(",");
    return [
        world && world.id, mode, action.type, action.npcId || "",
        flags.location, flags.time_of_day, invSig, bondSig, chanSig, flags.story_lock
    ].join("|");
}

// —— 主入口：编排全局开关 → 硬预筛 → (rules | AI) 判定，带场景哈希缓存 ——
// opts.judge 可注入（测试用）；默认走 llm.aiJudgeContact
export async function evaluateGate(world, gameState, action, scene = {}, opts = {}) {
    const mod = action.type === "npc_chat" ? "npc_chat" : "world_daily";
    if (!isModuleEnabled(world, mod)) {
        return { allowed: false, channel: null, reason: null, blocked: "module_off" };
    }

    const channels = resolveChannels(world, gameState, scene);
    action._channels = channels;
    action._story_lock = !!(scene.story_lock) || !!(S && S.enteringSideEvent);
    if (action.type === "npc_chat") {
        const bond = gameState && gameState.bonds && gameState.bonds[action.npcId];
        action._sharedContacts = (bond && Array.isArray(bond.shared_contacts)) ? bond.shared_contacts : [];
        action._npc_state = scene.npc_state
            || (gameState && gameState.present_npcs && gameState.present_npcs.includes(action.npcId) ? "present" : "unknown");
    }

    const flags = collectCommFlags(world, gameState, { ...scene, channels, npc_state: action._npc_state });
    const pre = hardPrefilter(world, gameState, action);
    if (!pre.pass) return { allowed: false, channel: null, reason: pre.reason, blocked: pre.blocked };

    const mode = (world && world.comm_gate_mode) || "ai";

    // 场景状态哈希缓存：状态未变则不重判（控成本）
    const key = cacheKey(world, gameState, action, flags, mode);
    const cache = (gameState && gameState.comm_cache) || {};
    if (cache.key === key && cache.result) return cache.result;

    let result;
    if (mode === "rules") {
        result = rulesDecision(flags, action, channels);
    } else {
        const judge = opts.judge || aiJudgeContact;
        result = await judge({ world, gameState, action, flags, channels, scene });
    }
    if (gameState) gameState.comm_cache = { key, result };
    return result;
}
