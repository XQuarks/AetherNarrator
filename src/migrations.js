// Persisted-data migrations are intentionally DOM-free so they can run before UI boot.
export const LATEST_SAVE_SCHEMA_VERSION = 2;

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
    out.pending_lore_revision = Array.isArray(out.pending_lore_revision)
        ? clone(out.pending_lore_revision)
        : null;
    return out;
}
