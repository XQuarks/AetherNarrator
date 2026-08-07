const FORMAT = "aethernarrator-memory-pack";
const MEMORY_TYPES = new Set(["event", "relationship", "item", "discovery", "other"]);
// ★ 66：记忆三分型（与 store.js MEMORY_BUCKETS 保持一致，独立白名单避免循环依赖）
const MEMORY_BUCKETS = new Set(["emotional", "important_event", "learned_fact"]);

// ★ 66：bucket 兜底（旧数据/未标注时按 type/importance 推断，与 rag.inferBucket 同规则）
function inferBucket(raw) {
    if (MEMORY_BUCKETS.has(raw?.bucket)) return raw.bucket;
    if (raw?.type === "event") return "important_event";
    const imp = Number.isFinite(raw?.importance) ? raw.importance : 3;
    if (imp >= 4) return "important_event";
    return "learned_fact";
}

function normalizeText(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/[\s,，。！？、；："'「」《》（）【】!?…—]/g, "")
        .toLowerCase();
}

function sanitizeMemory(raw, fallbackId) {
    const text = String(raw?.text || "").trim().slice(0, 1000);
    if (!text) return null;
    return {
        id: (String(raw?.id || fallbackId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || fallbackId),
        text,
        importance: Number.isFinite(raw?.importance) ? Math.max(1, Math.min(5, Math.round(raw.importance))) : 3,
        pinned: raw?.pinned === true,
        type: MEMORY_TYPES.has(raw?.type) ? raw.type : "other",
        bucket: inferBucket(raw),
        time: typeof raw?.time === "string" ? raw.time.slice(0, 100) : "",
        location: typeof raw?.location === "string" ? raw.location.slice(0, 100) : "",
        npcs: Array.isArray(raw?.npcs) ? raw.npcs.slice(0, 8).map(n => String(n).slice(0, 80)) : [],
        createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
        embedding: null
    };
}

export function createMemoryPack(records, metadata = {}) {
    const memories = (Array.isArray(records) ? records : [])
        .map((record, index) => sanitizeMemory(record, `memory_${index + 1}`))
        .filter(Boolean)
        .map(({ embedding, ...memory }) => memory);
    return {
        format: FORMAT,
        version: 1,
        exported_at: new Date().toISOString(),
        world_name: String(metadata.worldName || "").slice(0, 200),
        memories
    };
}

export function mergeMemoryPack(existing, pack) {
    if (!pack || pack.format !== FORMAT || pack.version !== 1 || !Array.isArray(pack.memories)) {
        throw new Error("不是有效的以太叙事记忆包");
    }
    const memories = (Array.isArray(existing) ? existing : [])
        .map((record, index) => sanitizeMemory(record, `local_${index + 1}`))
        .filter(Boolean);
    const byText = new Map(memories.map((memory, index) => [normalizeText(memory.text), index]));
    let added = 0;
    let merged = 0;
    for (let i = 0; i < pack.memories.length; i++) {
        const incoming = sanitizeMemory(pack.memories[i], `imported_${Date.now()}_${i}`);
        if (!incoming) continue;
        const key = normalizeText(incoming.text);
        if (byText.has(key)) {
            const current = memories[byText.get(key)];
            current.importance = Math.max(current.importance, incoming.importance);
            current.pinned = current.pinned || incoming.pinned;
            // ★ 66：合并时 bucket 不降级——本地区分过情感/事件的，保留本地的；本地未区分才用导入的
            if (!current.bucket && incoming.bucket) current.bucket = incoming.bucket;
            if (!current.location && incoming.location) current.location = incoming.location;
            current.npcs = [...new Set([...(current.npcs || []), ...(incoming.npcs || [])])].slice(0, 8);
            merged++;
        } else {
            byText.set(key, memories.length);
            memories.push(incoming);
            added++;
        }
    }
    return { memories: memories.slice(-100), added, merged };
}
