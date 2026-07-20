// ============================================================
// AetherNarrator · kg-graph.js（Phase 4 · 知识图谱模型，纯函数）
// 说明：把知识库 snippets 建模为「片段节点 + 实体节点 + 两类边」。
//   - link 边：片段之间 s.links（relation ∈ causal/related/explains/contains）
//   - relation 边：s.relations 三元组（from → relation → to，from/to 为实体名）
// 本文件不依赖任何 DOM，可在 node 单测里直接 import（与 lore-ui 的渲染解耦）。
// ============================================================

// 节点类别配色（片段节点按 category 着色）
export const LORE_CATEGORY_COLORS = {
    "规则": "#e0584f", "世界观": "#5b86e0", "地点": "#3fb98f", "人物": "#b96fd6",
    "事件": "#e0a93f", "物品": "#3fb6e0", "势力": "#e06fa0", "冲突": "#e07a4f", "补充": "#9aa0a6",
    "实体": "#7c83ff"
};
export const FALLBACK_CAT_COLOR = "#9aa0a6";
export const ENTITY_COLOR = "#7c83ff";

// 链接边配色（s.links，对应 store.js 的 LINK_RELATION_LABELS）
export const REL_COLORS = { causal: "#ff6464", related: "#6496ff", explains: "#64c864", contains: "#c8b464" };

// 抽取关系（relations 三元组）调色板：不同中文关系分配不同稳定色
export const KG_REL_PALETTE = [
    "#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#38d9a9", "#4dabf7",
    "#748ffc", "#9775fa", "#f783ac", "#e599f7", "#63e6be", "#ff8787"
];

/**
 * 把 snippets 建模为图谱数据结构。
 * @param {Array} snippets 知识库片段数组
 * @returns {{nodes:Array, linkEdges:Array, relEdges:Array, entityCount:number, relationColorMap:Object, distinctRels:Array}}
 *   - nodes: [{id,label,category,color,kind:"snippet"|"entity",degree}]
 *   - linkEdges / relEdges: [{source,target,kind:"link"|"relation",relation}]
 *   - entityCount: 合成实体节点数
 *   - relationColorMap: 关系文本 -> 稳定颜色
 */
export function buildGraphModel(snippets) {
    const list = Array.isArray(snippets) ? snippets : [];
    const snippetById = {};
    const titleNormIndex = {};
    const nodes = [];
    const entityNodes = {}; // 原始名 -> node（同实体合并）

    for (const s of list) {
        if (!s || !s.id) continue;
        snippetById[s.id] = s;
        const norm = (s.title || "").trim().toLowerCase();
        if (norm) titleNormIndex[norm] = s.id;
        nodes.push({
            id: s.id,
            label: s.title || s.id,
            category: s.category || "补充",
            color: LORE_CATEGORY_COLORS[s.category] || FALLBACK_CAT_COLOR,
            kind: "snippet",
            degree: 0
        });
    }

    // 名称 -> 节点 id：先匹配片段 id，再匹配规范化 title，都不中则建实体节点
    function resolveName(name) {
        if (name == null) return null;
        const raw = String(name).trim();
        if (!raw) return null;
        if (snippetById[raw]) return raw;                       // 精确 id 命中
        const norm = raw.toLowerCase();
        if (titleNormIndex[norm]) return titleNormIndex[norm];  // 规范化 title 命中
        if (!entityNodes[raw]) {                                // 合成实体节点（同一实体合并）
            const eid = "entity:" + raw;
            entityNodes[raw] = {
                id: eid, label: raw, category: "实体",
                color: ENTITY_COLOR, kind: "entity", degree: 0
            };
            nodes.push(entityNodes[raw]);
        }
        return entityNodes[raw].id;
    }

    // 链接边（片段↔片段）
    const linkEdges = [];
    for (const s of list) {
        if (!s.links || !Array.isArray(s.links)) continue;
        for (const l of s.links) {
            if (l && l.target != null && (l.target in snippetById)) {
                linkEdges.push({ source: s.id, target: l.target, kind: "link", relation: l.relation || "related" });
            }
        }
    }

    // 关系边（实体三元组）
    const relEdges = [];
    for (const s of list) {
        if (!s.relations || !Array.isArray(s.relations)) continue;
        for (const r of s.relations) {
            const srcId = resolveName(r && r.from) || s.id; // from 缺省时连到声明片段
            const tgtId = resolveName(r && r.to) || s.id;
            if (srcId && tgtId && srcId !== tgtId) {
                relEdges.push({ source: srcId, target: tgtId, kind: "relation", relation: (r && r.relation) || "related" });
            }
        }
    }

    // 度数（用于节点大小 / 悬停高亮）
    const nodeById = {};
    for (const n of nodes) nodeById[n.id] = n;
    for (const e of linkEdges) { if (nodeById[e.source]) nodeById[e.source].degree++; if (nodeById[e.target]) nodeById[e.target].degree++; }
    for (const e of relEdges) { if (nodeById[e.source]) nodeById[e.source].degree++; if (nodeById[e.target]) nodeById[e.target].degree++; }

    // 关系边取色：实际出现的关系文本 -> 稳定调色板
    const seen = new Set();
    const distinctRels = [];
    for (const e of relEdges) { if (!seen.has(e.relation)) { seen.add(e.relation); distinctRels.push(e.relation); } }
    const relationColorMap = {};
    distinctRels.forEach((rel, i) => { relationColorMap[rel] = KG_REL_PALETTE[i % KG_REL_PALETTE.length]; });

    return { nodes, linkEdges, relEdges, entityCount: Object.keys(entityNodes).length, relationColorMap, distinctRels };
}

// ============================================================
// ★ Phase 4 增补：RAG 图遍历召回（纯函数，node 可单测）
// 作用：沿 s.relations 实体三元组，从已召回的 seed 片段向外摸到相关片段。
// 与现有 B9②「s.links 片段 ID 链接跟随」互补：那路走片段 ID，这路走实体名关系。
// 不依赖 DOM / S，每次召回现建索引（O(n+edges)，与 B9② 同量级，避免缓存失效坑）。
// ============================================================

/**
 * 从 seed 片段出发，沿 relations 三元组扩展应额外注入的邻居片段 id。
 * @param {string[]|Set<string>} seedSnippetIds 当前已召回的片段 id
 * @param {Array} snippets 知识库片段数组
 * @param {{maxDepth?:number}} [opts] 扩展跳数，默认 2
 * @returns {Set<string>} 应额外召回的片段 id（排除 seed 自身、排除不存在的）
 */
export function expandRelationNeighbors(seedSnippetIds, snippets, opts = {}) {
    const maxDepth = (typeof opts.maxDepth === "number" && opts.maxDepth >= 0) ? opts.maxDepth : 2;
    const list = Array.isArray(snippets) ? snippets : [];
    const seeds = (seedSnippetIds instanceof Set) ? seedSnippetIds : new Set((seedSnippetIds || []).map(String));
    if (!list.length || seeds.size === 0) return new Set();

    const norm = (n) => (n == null ? "" : String(n).trim().toLowerCase());

    // 规范化实体名 -> 片段 id：优先按 title 精确匹配，也允许按片段 id 解析
    const nameToSnippetId = {};
    for (const s of list) {
        if (!s || !s.id) continue;
        const t = norm(s.title);
        if (t && !nameToSnippetId[t]) nameToSnippetId[t] = s.id;
        const id = norm(s.id);
        if (id && !nameToSnippetId[id]) nameToSnippetId[id] = s.id;
    }

    // 关系邻接（无向）：键/值为规范化实体名
    const adj = {};
    for (const s of list) {
        if (!Array.isArray(s.relations)) continue;
        for (const r of s.relations) {
            const f = norm(r && r.from), t = norm(r && r.to);
            if (!f || !t || f === t) continue;
            (adj[f] || (adj[f] = new Set())).add(t);
            (adj[t] || (adj[t] = new Set())).add(f);
        }
    }

    // 起点实体 = 每个 seed 片段自身的 title / id（depth 0）。
    // 它 relations 里提到的实体是 depth-1 邻居，由下方 BFS 自然走到，切勿提前塞进 starts，
    // 否则会把它当成 depth 0、其下游被误判为可触达（maxDepth 语义错位）。
    const starts = new Set();
    for (const id of seeds) {
        const s = list.find(x => x && x.id === id);
        if (!s) continue;
        const t = norm(s.title);
        if (t) starts.add(t);
        const idn = norm(s.id);
        if (idn) starts.add(idn);
    }
    if (starts.size === 0) return new Set();

    // BFS 沿关系边扩展 maxDepth 跳（实体-only 节点也作为中转，可继续摸到下游片段）
    const visited = new Set(starts);
    let frontier = [...starts];
    for (let d = 0; d < maxDepth && frontier.length; d++) {
        const next = [];
        for (const e of frontier) {
            const nbs = adj[e];
            if (!nbs) continue;
            for (const nb of nbs) {
                if (!visited.has(nb)) { visited.add(nb); next.push(nb); }
            }
        }
        frontier = next;
    }

    // 落点到片段 id，排除 seed 自身（实体-only 节点无内容，自然落不到片段）
    const result = new Set();
    for (const e of visited) {
        const sid = nameToSnippetId[e];
        if (sid && !seeds.has(sid)) result.add(sid);
    }
    return result;
}

