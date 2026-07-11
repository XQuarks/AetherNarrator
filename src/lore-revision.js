function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export function parseLoreRevisionResponse(content) {
    let text = String(content || "").trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.snippets)) throw new Error("知识库修订响应缺少 snippets");
    return parsed.snippets.filter(item => item && typeof item === "object" && item.id);
}

export function buildLoreRevisionDiff(current, proposed) {
    const existing = new Map((Array.isArray(current) ? current : []).map(item => [item.id, item]));
    const updates = [];
    const additions = [];
    for (const item of Array.isArray(proposed) ? proposed : []) {
        if (!item || !item.id) continue;
        const before = existing.get(item.id);
        if (!before) additions.push(clone(item));
        else if (JSON.stringify(before) !== JSON.stringify(item)) updates.push(clone(item));
    }
    return { updates, additions };
}

export function applyLoreRevisionDiff(current, diff) {
    const out = clone(Array.isArray(current) ? current : []);
    const index = new Map(out.map((item, i) => [item.id, i]));
    for (const update of Array.isArray(diff?.updates) ? diff.updates : []) {
        if (!update || !update.id) continue;
        if (index.has(update.id)) out[index.get(update.id)] = clone(update);
    }
    for (const addition of Array.isArray(diff?.additions) ? diff.additions : []) {
        if (!addition || !addition.id || index.has(addition.id)) continue;
        index.set(addition.id, out.length);
        out.push(clone(addition));
    }
    return out;
}
