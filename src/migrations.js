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

// 向后兼容迁移函数已移除（Phase 0：前提=不兼容旧存档/世界）。
// 数据形状由 createDemoWorld / createOrUpdateSave 保证，读取点均已做 undefined 兜底（|| 0 / || null / === true）。
