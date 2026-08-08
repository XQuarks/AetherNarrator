// ★ docs/75：关系升级门控——确定性判定引擎（纯函数，不碰 DOM/S，可单测）
// 设计原则：引擎管状态（按门控确定性升级 bonds[npc].tier），LLM 管叙事（只报好感/标签）。
// 三大门控中「阈值/节点」直接复用 prompt.js 的条件引擎（零新条件代码），「主动」由 UI 触发确定性动作。
// 关系升级结果以 isEligible 双保险为准，绝不信任 AI 自报等级（防泄漏 / 防作弊）。

import { evalCondition, evalEventConditions } from "./prompt.js";

// 标准五阶（创作者可在 world.relationship_upgrade.tiers 覆盖）
export const DEFAULT_TIERS = ["陌生人", "相识", "朋友", "挚友", "恋人"];
// 每级「升入」的门控，index = 升入 tiers[index+1] 的门槛（gates[i] → 升入 tiers[i+1]）
// 默认仅阈值 + 主动（节点默认不要求，世界按需加）；阈值沿用 [20,40,60,80] 的松紧节奏
export const DEFAULT_GATES = [
    { threshold: 20, active: true },  // → 相识
    { threshold: 40, active: true },  // → 朋友
    { threshold: 60, active: true },  // → 挚友
    { threshold: 80, active: true },  // → 恋人
];

// 取等级阶梯（缺省用代码默认，兼容老世界无配置）
export function getTiers(world) {
    const w = (world && world.relationship_upgrade) || {};
    return (Array.isArray(w.tiers) && w.tiers.length) ? w.tiers : DEFAULT_TIERS;
}

// 取门控数组（长度 = tiers.length - 1，与阶梯对齐）；创作者可逐阶覆盖，未提供者用默认补齐
export function getGates(world) {
    const tiers = getTiers(world);
    const need = tiers.length - 1;
    const w = (world && world.relationship_upgrade) || {};
    if (Array.isArray(w.gates) && w.gates.length) {
        const arr = w.gates.slice(0, need);
        while (arr.length < need) arr.push({ threshold: 9999, active: true }); // 兜底：未配置段默认不可达
        return arr;
    }
    return DEFAULT_GATES.slice(0, need);
}

// 当前等级下标（老存档 bonds[npc] 无 tier → 默认 0，不报错）
export function getTierIndex(gs, npc) {
    const b = (gs && gs.bonds && gs.bonds[npc]) || null;
    return (b && typeof b.tier === "number") ? b.tier : 0;
}

// 下一步门控（按当前 tier 取 gates[tier]）；已顶级返回 null
export function nextGate(world, gs, npc) {
    const tiers = getTiers(world);
    const idx = getTierIndex(gs, npc);
    if (idx >= tiers.length - 1) return null; // 已在最高级
    const gates = getGates(world);
    return gates[idx] || null;
}

// ① 阈值门控：复用 evalCondition 的 bond 分支（affinity >= threshold）
export function thresholdMet(gs, npc, threshold) {
    const v = Number(threshold);
    if (!Number.isFinite(v)) return false;
    return evalCondition({ type: "bond", npc, op: ">=", value: v }, { gameState: gs, world: {} });
}

// ② 节点门控：复用 evalEventConditions（location/story_progress/bond/events/lore/season/era + all/any）
// 无 node 配置 = 满足（默认不要求节点）
export function nodeMet(world, gs, node) {
    if (!node) return true;
    return evalEventConditions(node, { gameState: gs, world });
}

// 综合：是否「已具备升级资格」（忽略 active 与否）
export function isEligible(world, gs, npc) {
    const gate = nextGate(world, gs, npc);
    if (!gate) return false; // 已在最高级
    const thr = (typeof gate.threshold === "number") ? gate.threshold : 0;
    if (!thresholdMet(gs, npc, thr)) return false;
    if (!nodeMet(world, gs, gate.node)) return false;
    return true;
}

// 确定性升级（主动 / 自动 共用）。双保险：不信任 UI / 自动触发源，必须 isEligible 为真才升级。
// 每次只升 1 级（to = from + 1）；资格者下回合可继续升，符合阶梯语义。
// 返回 { ok, fromTier, toTier, event }。
export function applyRelationshipUpgrade(world, gs, npc) {
    // 防御：确保队列存在（纯函数自洽，调用方无需预置）
    if (!Array.isArray(gs.pendingRelationshipEvents)) gs.pendingRelationshipEvents = [];
    const gate = nextGate(world, gs, npc);
    if (!gate) return { ok: false };
    if (!isEligible(world, gs, npc)) return { ok: false };
    if (!gs.bonds) gs.bonds = {};
    const bond = gs.bonds[npc] || (gs.bonds[npc] = { affinity: 0, tags: [] });
    const from = (typeof bond.tier === "number") ? bond.tier : 0;
    const to = from + 1;
    bond.tier = to;
    const ev = { type: "rel_upgrade", npc, fromTier: from, toTier: to };
    gs.pendingRelationshipEvents.push(ev);
    return { ok: true, fromTier: from, toTier: to, event: ev };
}

// 主动升级按钮文案（按下一阶 tier 名）；世界可在 relationship_upgrade.upgrade_labels 覆盖
export function upgradeLabel(world, toTierIndex) {
    const tiers = getTiers(world);
    const name = tiers[toTierIndex] || "";
    const w = (world && world.relationship_upgrade) || {};
    if (w.upgrade_labels && typeof w.upgrade_labels === "object" && w.upgrade_labels[name]) {
        return w.upgrade_labels[name];
    }
    if (name === "恋人") return "表白";
    if (name === "挚友") return "深交";
    return "增进关系";
}
