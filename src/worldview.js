function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function activeRules(rules, activeTags) {
    const tags = activeTags instanceof Set ? activeTags : new Set(activeTags || []);
    return (Array.isArray(rules) ? rules : []).map(entry => {
        if (typeof entry === "string") {
            return { concept: entry, aliases: [], unlockTags: [], severity: "soft" };
        }
        return {
            concept: String(entry?.concept || "").trim(),
            aliases: Array.isArray(entry?.aliases) ? entry.aliases.filter(Boolean).map(String) : [],
            unlockTags: Array.isArray(entry?.unlockTags) ? entry.unlockTags.filter(Boolean).map(String) : [],
            severity: entry?.severity === "hard" ? "hard" : "soft"
        };
    }).filter(rule => rule.concept && !rule.unlockTags.some(tag => tags.has(tag)));
}

export function findWorldviewViolations(text, rules, activeTags = new Set()) {
    const source = String(text || "").toLowerCase();
    if (!source) return [];
    const out = [];
    for (const rule of activeRules(rules, activeTags)) {
        const terms = [rule.concept, ...rule.aliases];
        const matched = terms.find(term => source.includes(String(term).toLowerCase()));
        if (matched) out.push({ concept: rule.concept, matched, severity: rule.severity });
    }
    return out;
}

// ===== 世界观守卫「N 次后静默」机制 =====
// 同一个疑似偏离世界观的「东西」(key) 累计被系统提示达到阈值后，不再弹提示，
// 但仍会照常检测、不影响剧情推进。计数存放在 S.gameState.worldviewNagCounts，随存档保存。
export const WORLDVIEW_NAG_THRESHOLD = 3;

// 纯函数：给定 key 与已有计数表，返回本次是否弹提示以及更新后的计数表。
// - 已达标(key 计数 >= 阈值)：返回 { show:false, counts }，计数不变（已静默）
// - 未达标：计数 +1 并返回 { show:true, counts }
// 设计为纯函数（不依赖 S / DOM），便于 node 单测；game.js 负责把 counts 写回存档。
export function recordWorldviewNag(key, nagCounts = {}, threshold = WORLDVIEW_NAG_THRESHOLD) {
    const counts = nagCounts && typeof nagCounts === "object" ? nagCounts : {};
    const count = Number(counts[key]) || 0;
    if (count >= threshold) {
        return { show: false, counts };
    }
    return { show: true, counts: { ...counts, [key]: count + 1 } };
}

export function filterStateChangesByWorldview(changes, rules, activeTags = new Set()) {
    const source = clone(changes && typeof changes === "object" ? changes : {});
    const violations = [];

    const cleanObject = value => {
        if (Array.isArray(value)) {
            const kept = [];
            for (const item of value) {
                const before = violations.length;
                const cleaned = cleanObject(item);
                if (violations.length === before) kept.push(cleaned);
            }
            return kept;
        }
        if (!value || typeof value !== "object") return value;
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            const keyHits = findWorldviewViolations(key, rules, activeTags);
            const valueHits = typeof child === "string"
                ? findWorldviewViolations(child, rules, activeTags)
                : [];
            if (keyHits.length || valueHits.length) {
                violations.push(...keyHits, ...valueHits);
                continue;
            }
            out[key] = cleanObject(child);
        }
        return out;
    };

    return { changes: cleanObject(source), violations };
}

export function shouldRunAIEnhancements({ enabled, freedom, hasLore }) {
    return enabled === true && Number(freedom) < 4 && hasLore === true;
}

export function isEnhancementContextCurrent(expected, current) {
    if (!expected || !current) return false;
    return expected.worldId === current.worldId
        && expected.epoch === current.epoch
        && expected.turnId === current.turnId;
}

// ===== Phase 2：规则 DSL 解释器 =====
// 一条规则 = { id, name, enabled=true, when:{type,...}, then:{type,...} }
//   when.type: "always"(或省略) | "concept" | "state" | "tag"
//   then.type: "ban" | "tag" | "ending"
// 详情见 docs/Phase2改造方案.md。
// evaluateRules 为纯函数，不依赖 S / DOM，便于 node 测试。

// 从 gameState 派生「活跃条件标签」集合（与 store.getActiveConditionTags 同口径）
function getTagsFromState(gs) {
    const tags = new Set();
    if (!gs || typeof gs !== "object") return tags;
    if (Array.isArray(gs.tags)) gs.tags.forEach(t => tags.add(t));
    if (Array.isArray(gs.inventory)) {
        for (const it of gs.inventory) {
            if (it && Array.isArray(it.tags)) it.tags.forEach(t => tags.add(t));
        }
    }
    if (Array.isArray(gs.present_npcs)) {
        for (const n of gs.present_npcs) if (n) tags.add("char:" + n);
    }
    return tags;
}

function compareState(field, op, target, gs) {
    if (!gs || !gs.state || typeof gs.state !== "object") return false;
    const val = gs.state[field];
    if (val === undefined || val === null) return false;
    const a = Number(val), b = Number(target);
    switch (op) {
        case "<": return a < b;
        case "<=": return a <= b;
        case ">": return a > b;
        case ">=": return a >= b;
        case "==": return String(val) === String(target);
        case "!=": return String(val) !== String(target);
        default: return false;
    }
}

function evalWhen(when, ctx) {
    if (!when || typeof when !== "object") return true; // 无 when = 常驻规则
    switch (when.type) {
        case "always":
            return true;
        case "concept": {
            const term = String(when.term || "").trim().toLowerCase();
            if (!term) return false;
            return ctx.text != null && String(ctx.text).toLowerCase().includes(term);
        }
        case "state":
            return compareState(when.field, when.op || "==", when.value, ctx.gameState);
        case "tag":
            return when.tag != null && ctx.activeTags.has(when.tag);
        default:
            return false;
    }
}

function normalizeBan(then) {
    return {
        concept: String(then.concept || "").trim(),
        aliases: Array.isArray(then.aliases) ? then.aliases.map(String) : [],
        severity: then.severity === "hard" ? "hard" : "soft",
        unlockTags: Array.isArray(then.unlessTags) ? then.unlessTags.map(String) : []
    };
}

export function legacyBanEntry(entry) {
    if (typeof entry === "string") {
        return { concept: entry, aliases: [], severity: "soft", unlockTags: [] };
    }
    if (!entry || !entry.concept) return null;
    return {
        concept: String(entry.concept).trim(),
        aliases: Array.isArray(entry.aliases) ? entry.aliases.map(String) : [],
        severity: entry.severity === "hard" ? "hard" : "soft",
        unlockTags: Array.isArray(entry.unlockTags) ? entry.unlockTags.map(String) : []
    };
}

// 解释执行世界规则，返回归一化约束：
//   { bannedConcepts:[{concept,aliases,severity,unlockTags}], tagOps:[{op,tag}], endings:[{reason,ruleId}] }
// - world.rules 存在且非空：按 DSL 解释（ban 规则并入 bannedConcepts，与现有守卫完全兼容）
// - 否则回退：仅取 world.bannedConcepts（默认词表由 store.getBannedConceptRules 补）
// - text（可选）：本轮叙事文本，供 when.type==="concept" 触发条件匹配（如"输出出现某词→触发结局"）
export function evaluateRules(world, gs, text) {
    const result = { bannedConcepts: [], tagOps: [], endings: [] };
    if (!world || typeof world !== "object") return result;
    const rules = Array.isArray(world.rules) ? world.rules : null;
    if (rules && rules.length) {
        const activeTags = getTagsFromState(gs);
        const ctx = { text: text != null ? String(text) : null, gameState: gs, activeTags };
        for (const rule of rules) {
            if (!rule || rule.enabled === false) continue;
            if (!evalWhen(rule.when, ctx)) continue;
            const then = rule.then;
            if (!then || typeof then !== "object") continue;
            if (then.type === "ban") {
                const b = normalizeBan(then);
                if (b.concept) result.bannedConcepts.push(b);
            } else if (then.type === "tag") {
                if (then.tag) result.tagOps.push({ op: then.op === "remove" ? "remove" : "add", tag: String(then.tag) });
            } else if (then.type === "ending") {
                result.endings.push({
                    reason: String(then.reason || "规则触发：世界结束"),
                    ruleId: rule.id || null
                });
            }
        }
        return result;
    }
    // 回退：旧版 bannedConcepts（仅 ban 概念，无 tag/ending）
    const legacy = Array.isArray(world.bannedConcepts) ? world.bannedConcepts : [];
    for (const entry of legacy) {
        const b = legacyBanEntry(entry);
        if (b) result.bannedConcepts.push(b);
    }
    return result;
}
