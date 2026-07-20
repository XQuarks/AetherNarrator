// ============================================================
// AetherNarrator · ann-index.js（Phase 1：ANN 向量索引）
// ============================================================
// 用 HNSW（hnswlib-wasm）替代 rag.js 的 O(n) 全库余弦扫描。
// - 浏览器侧：动态 import "../vendor/ann/hnswlib.js"（wasm 已内联，无需 fetch，file:// 亦可）
// - 任何加载/构建失败都向外抛错，由 rag.js 捕获走 O(n) 兜底（行为完全一致）
// - 索引全内存构建，不改变任何数据格式（向量早已持久化在每条 snippet 里）
// 内联余弦相似度，避免引入 utils→store 链（store 顶层访问 localStorage，node 环境无此对象会崩）
function cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 模块级缓存：worldId -> { sig, index }。切换世界/编辑知识库后失效重建。
const _cache = new Map();
let _HNSWLib = null;     // 懒加载的 hnswlib 模块（浏览器）
let _testLib = null;     // 测试注入的 mock lib（绕过浏览器 import）

// ★ 仅供测试注入 mock hnswlib，避免 node 环境无法加载浏览器 wasm 构建
export function __setTestHnswLib(lib) { _testLib = lib; }

async function loadHNSWLib() {
    if (_HNSWLib) return _HNSWLib;
    if (_testLib) return _testLib;
    if (typeof window === "undefined") {
        throw new Error("ANN 库仅在浏览器环境可用（node 测试请使用 __setTestHnswLib 注入）");
    }
    const mod = await import("../vendor/ann/hnswlib.js");
    const lib = mod.default || mod;
    _HNSWLib = await lib.loadHnswlib();
    return _HNSWLib;
}

// 用给定 hnswlib 模块为片段集构建索引（纯函数，便于测试与复用）
export function buildLoreIndex(lib, snippets, opts = {}) {
    const dim = opts.dim || 512;
    const space = opts.space || "cosine";
    const valid = (snippets || []).filter(s =>
        s && s.id != null && Array.isArray(s.embedding) && s.embedding.length === dim
    );
    if (!valid.length) throw new Error("没有可索引的有效向量");
    // ★ hnswlib-wasm 0.8.2 权威签名（来自 dist/hnswlib-wasm.d.ts）：
    //   new HierarchicalNSW(spaceName: 'l2'|'ip'|'cosine', numDimensions: number, autoSaveFilename: string)
    //   第 3 参是「自动存盘文件名」（字符串，必填）；传空串 "" 关闭自动存盘。
    //   maxElements 是 initIndex(maxElements) 的第一个参数，不是构造参数。
    const index = new lib.HierarchicalNSW(space, dim, "");
    // initIndex 在此 wasm 构建强制 4 参（无默认值）：(maxElements, M, efConstruction, randomSeed)
    index.initIndex(valid.length, 16, 200, 100);
    const idMap = new Map();
    valid.forEach((s, i) => { index.addPoint(s.embedding, i, false); idMap.set(i, s); });
    return {
        size: valid.length,
        search(qVec, topK) {
            if (!Array.isArray(qVec) || qVec.length !== dim) throw new Error("查询向量维度不匹配");
            const k = Math.min(topK, valid.length);
            // searchKnn 强制 3 参：(queryPoint, numNeighbors, filter)，filter 传 undefined
            const { neighbors, distances } = index.searchKnn(qVec, k, undefined);
            return neighbors
                .map((label, i) => ({ snippet: idMap.get(label), embScore: 1 - (distances[i] || 0) }))
                .filter(x => x.snippet);
        }
    };
}

// 获取（或懒构建）某世界的 ANN 索引。worldId 变化或模型维度变化则重建。
export async function getLoreAnnIndex(kb, worldId, opts = {}) {
    const key = worldId || "default";
    const sig = String(opts.dim || 512);
    const cached = _cache.get(key);
    if (cached && cached.sig === sig) return cached.index;
    const lib = await loadHNSWLib();
    const index = buildLoreIndex(lib, (kb && kb.snippets) || [], opts);
    _cache.set(key, { sig, index });
    return index;
}

// O(n) 余弦暴力排序（ANN 不可用时的兜底，与原逻辑一致）
export function embeddingRetrieveBruteforce(embeddedSnippets, qVec, topK = 5) {
    return embeddedSnippets
        .map(s => ({ snippet: s, embScore: cosineSimilarity(qVec, s.embedding) }))
        .sort((a, b) => b.embScore - a.embScore)
        .slice(0, topK);
}

// ★ 失效钩子：编辑/切换知识库后清缓存，下次检索懒重建
export function invalidateLoreAnn(worldId) { _cache.delete(worldId || "default"); }
export function invalidateAllLoreAnn() { _cache.clear(); }
