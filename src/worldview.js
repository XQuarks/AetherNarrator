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
