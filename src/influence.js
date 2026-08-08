// ★ docs/76：玩家影响度判定引擎（纯函数，可单测，不依赖 AI 临场发挥）
// 设计红线：影响度由引擎从「确定性」的 state_changes 增量加权算出；
// 三路产出（状态栏展示 / evalCondition 加 influence case / 越线 fork 叙事层）均在别处接线，本文件只算数。

export const DEFAULT_INFLUENCE_WEIGHTS = {
    attr_per_point: 0.5,      // 属性绝对值变化每点（文字描述记为 1 点）
    affinity_per_point: 1,    // 好感 delta 每点
    event_triggered: 10,      // 触发一个预设事件
    quest_completed: 15,      // 完成一个任务
    lore_unlocked: 8,         // 解锁一条 lore
    rel_upgrade: 12,          // 一次关系升阶
    ending_reached: 40,       // 触达一个结局
    random_event: 5           // 触发一次随机事件
};

export const DEFAULT_MAX_LAYERS = 4;            // 主线 + 最多 3 条衍生叙事层
export const DEFAULT_INFLUENCE_THRESHOLDS = [100]; // 偏离度越线档 → 自动 fork 新叙事层

// 世界配置读取（缺省用代码默认）
export function getInfluenceWeights(world) {
    const w = (world && world.parallel_narrative && world.parallel_narrative.weights) || {};
    return { ...DEFAULT_INFLUENCE_WEIGHTS, ...w };
}
export function getInfluenceThresholds(world) {
    const t = world && world.parallel_narrative && world.parallel_narrative.influence_thresholds;
    return (Array.isArray(t) && t.length) ? [...t].sort((a, b) => a - b) : [...DEFAULT_INFLUENCE_THRESHOLDS];
}
export function getMaxLayers(world) {
    const m = world && world.parallel_narrative && world.parallel_narrative.max_layers;
    return (typeof m === "number" && m >= 1) ? m : DEFAULT_MAX_LAYERS;
}

// 从本回合 state_changes 增量累加影响度（确定性）。
// extra 携带引擎侧才能算出的维度：relUpgrades(本回合关系升阶数) / loreUnlocked(本回合跨阶解锁 lore 数)。
export function accumulateInfluence(changes, weights, extra) {
    const w = weights || DEFAULT_INFLUENCE_WEIGHTS;
    const c = changes || {};
    let inc = 0;
    // 属性：数值取绝对值，文字描述记为 1 点
    if (c.attributes && typeof c.attributes === "object" && !Array.isArray(c.attributes)) {
        for (const v of Object.values(c.attributes)) {
            if (typeof v === "number") inc += Math.abs(v) * w.attr_per_point;
            else if (typeof v === "string" && v.trim()) inc += 1 * w.attr_per_point;
        }
    }
    // 好感：delta 绝对值
    if (c.bonds && typeof c.bonds === "object" && !Array.isArray(c.bonds)) {
        for (const upd of Object.values(c.bonds)) {
            if (upd && typeof upd.delta === "number") inc += Math.abs(upd.delta) * w.affinity_per_point;
        }
    }
    // 触发事件
    if (Array.isArray(c.completed_events)) inc += c.completed_events.length * w.event_triggered;
    // 完成任务（goal_updates 中 status==="completed"，或显式 completed_quests）
    let quests = 0;
    if (Array.isArray(c.completed_quests)) quests += c.completed_quests.length;
    if (Array.isArray(c.goal_updates)) quests += c.goal_updates.filter(g => g && g.status === "completed").length;
    inc += quests * w.quest_completed;
    // 解锁 lore（显式字段；若 AI 未直接给，引擎可据 story_progress 跨阶补算后由 extra 传入）
    if (Array.isArray(c.unlocked_lore)) inc += c.unlocked_lore.length * w.lore_unlocked;
    // 技能习得/运用（文档权重未单列，给温和值以免漏算重大习得）
    if (c.skills && typeof c.skills === "object" && !Array.isArray(c.skills)) {
        for (const info of Object.values(c.skills)) {
            if (typeof info === "string" && info.trim()) inc += 2;
            else if (info && typeof info === "object" && info.result) inc += 1;
        }
    }
    // 结局
    if (Array.isArray(c.endings)) inc += c.endings.length * w.ending_reached;
    // 随机事件
    if (c.random_event_result || c.random_event) inc += 1 * w.random_event;
    // 引擎侧维度
    const ex = extra || {};
    if (typeof ex.relUpgrades === "number") inc += ex.relUpgrades * w.rel_upgrade;
    if (typeof ex.loreUnlocked === "number") inc += ex.loreUnlocked * w.lore_unlocked;
    return Math.round(inc * 100) / 100;
}

// 当前状态相对基准的「偏离度」（比对法，用于展示/调试；主流程用累计法避免浮点漂移）
export function computeInfluence(currentState, baseline, weights) {
    const w = weights || DEFAULT_INFLUENCE_WEIGHTS;
    if (!baseline || !currentState) return 0;
    let inc = 0;
    const ca = (currentState.attributes || {}), ba = (baseline.attributes || {});
    for (const k of new Set([...Object.keys(ca), ...Object.keys(ba)])) {
        const cv = ca[k], bv = ba[k];
        if (typeof cv === "number" && typeof bv === "number") inc += Math.abs(cv - bv) * w.attr_per_point;
        else if (cv !== bv) inc += 1 * w.attr_per_point;
    }
    const cb = (currentState.bonds || {}), bb = (baseline.bonds || {});
    for (const k of Object.keys(cb)) {
        const ca2 = (cb[k] && typeof cb[k].affinity === "number") ? cb[k].affinity : 0;
        const cb2 = (bb[k] && typeof bb[k].affinity === "number") ? bb[k].affinity : 0;
        inc += Math.abs(ca2 - cb2) * w.affinity_per_point;
    }
    const ce = Array.isArray(currentState.completed_events) ? currentState.completed_events.length : 0;
    const be = Array.isArray(baseline.completed_events) ? baseline.completed_events.length : 0;
    inc += Math.abs(ce - be) * w.event_triggered;
    return Math.round(inc * 100) / 100;
}

// 偏离度是否越过「未消费」的档位 → 返回该档位值（否则 null）。
// 每回合最多返回一个未消费档位，避免一次大跳变同时派生多条层。
export function crossedInfluenceTier(influence, thresholds, consumed) {
    const consumedSet = Array.isArray(consumed) ? consumed : [];
    for (const t of (thresholds || [])) {
        if (typeof t === "number" && influence >= t && !consumedSet.includes(t)) return t;
    }
    return null;
}
