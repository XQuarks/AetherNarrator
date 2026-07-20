// AetherNarrator · promotion.js（纯函数，无 DOM，可 node 单测）
// ★ B6 记忆晋升：高热度/置顶行为记录，在 B5 回写（callLoreRevisionLLM）时作为晋升候选交给 AI，
//   AI 以 `promote_<origId>` 为 id 的新增条目（addition）提出，玩家在 B5 确认台点「应用修订」即晋升为
//   正式知识库条目；原记忆标记 `promoted=true`，防止 AI 反复建议同一条晋升。
// 设计：完全复用 B5 确认台，不新建 UI；晋升写回 S.activeLoreKB（存档副本，B7 已保证不污染 world 出厂默认）。

export const PROMOTE_MIN_IMPORTANCE = 4;
const PROMOTE_PREFIX = "promote_";

// 选晋升候选：importance >= minImportance 或 pinned。返回深拷贝子集，不突变入参。
export function selectPromotionCandidates(records, { minImportance = PROMOTE_MIN_IMPORTANCE } = {}) {
    if (!Array.isArray(records)) return [];
    const out = [];
    for (const r of records) {
        if (!r || typeof r !== "object") continue;
        if (r.promoted) continue; // 已晋升的记忆不再当候选，避免 AI 反复建议同一条
        const imp = (typeof r.importance === "number" && r.importance >= 1 && r.importance <= 5) ? r.importance : 3;
        const pinned = !!r.pinned;
        if (imp >= minImportance || pinned) {
            out.push({
                id: r.id,
                text: r.text,
                importance: imp,
                pinned,
                type: r.type || "other",
                time: r.time || "",
                location: r.location || ""
            });
        }
    }
    return out;
}

// 应用晋升标记：对 diff.additions 中 id 以 promote_ 前缀的，把原行为记录标记 promoted=true。
// 返回新数组（不突变入参），便于纯函数测试与不可变更新。
export function markPromotedRecords(records, diff) {
    if (!Array.isArray(records)) return [];
    const promotedIds = new Set();
    const additions = (diff && Array.isArray(diff.additions)) ? diff.additions : [];
    for (const a of additions) {
        if (!a || typeof a.id !== "string") continue;
        if (a.id.startsWith(PROMOTE_PREFIX)) {
            const origId = a.id.slice(PROMOTE_PREFIX.length);
            if (origId) promotedIds.add(origId);
        }
    }
    if (promotedIds.size === 0) return records.slice(); // 无晋升，原样深拷贝返回，保持纯函数语义
    return records.map(r => {
        if (r && promotedIds.has(r.id)) return { ...r, promoted: true };
        return r;
    });
}
