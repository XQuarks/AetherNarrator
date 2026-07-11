// Persisted-data migrations are intentionally DOM-free so they can run before UI boot.
export const LATEST_SAVE_SCHEMA_VERSION = 2;

export function parseStoredArray(raw, fallback = []) {
    if (raw == null || raw === "") return { ok: true, value: clone(fallback) };
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? { ok: true, value: parsed }
            : { ok: false, value: clone(fallback), error: new Error("存储内容不是数组") };
    } catch (error) {
        return { ok: false, value: clone(fallback), error };
    }
}

export function parseStoredObject(raw, fallback = {}) {
    if (raw == null || raw === "") return { ok: true, value: clone(fallback) };
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? { ok: true, value: parsed }
            : { ok: false, value: clone(fallback), error: new Error("存储内容不是对象") };
    } catch (error) {
        return { ok: false, value: clone(fallback), error };
    }
}

function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function normalizeLoreKB(value, fallback = null) {
    const source = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : fallback && typeof fallback === "object" && !Array.isArray(fallback)
            ? fallback
            : null;
    if (!source) return null;
    const out = clone(source);
    if (!Array.isArray(out.snippets)) out.snippets = [];
    return out;
}

export function migrateWorldRecord(world) {
    const out = clone(world && typeof world === "object" ? world : {});
    out.schema_version = LATEST_SAVE_SCHEMA_VERSION;
    out.ai_enhanced_default = out.ai_enhanced_default === true;
    if (!Array.isArray(out.behavior_records)) out.behavior_records = [];
    return out;
}

export function migrateSaveRecord(save, world = null) {
    const out = clone(save && typeof save === "object" ? save : {});
    const worldMemories = world && Array.isArray(world.behavior_records)
        ? world.behavior_records
        : [];

    out.schema_version = LATEST_SAVE_SCHEMA_VERSION;
    out.lore_kb = normalizeLoreKB(out.lore_kb, world && world.lore_kb);
    out.behavior_records = clone(Array.isArray(out.behavior_records)
        ? out.behavior_records
        : worldMemories);
    out.ai_enhanced = typeof out.ai_enhanced === "boolean"
        ? out.ai_enhanced
        : !!(world && world.ai_enhanced_default);
    out.last_lore_review_msg_count = Number.isFinite(out.last_lore_review_msg_count)
        ? Math.max(0, Math.floor(out.last_lore_review_msg_count))
        : 0;
    if (Array.isArray(out.pending_lore_revision)) {
        out.pending_lore_revision = { updates: clone(out.pending_lore_revision), additions: [] };
    } else if (out.pending_lore_revision && typeof out.pending_lore_revision === "object") {
        out.pending_lore_revision = {
            updates: clone(Array.isArray(out.pending_lore_revision.updates) ? out.pending_lore_revision.updates : []),
            additions: clone(Array.isArray(out.pending_lore_revision.additions) ? out.pending_lore_revision.additions : [])
        };
    } else {
        out.pending_lore_revision = null;
    }
    return out;
}
