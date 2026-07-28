// ============================================================
// AetherNarrator · ann-index.js（Phase 1：ANN 向量索引）
// ============================================================
// 用 HNSW（hnswlib-wasm）替代 rag.js 的 O(n) 全库余弦扫描。
// - 浏览器侧：动态 import "../vendor/ann/hnswlib.js"（wasm 已内联，无需 fetch，file:// 亦可）
// - 任何加载/构建/读回失败都向外抛错或静默降级，由 rag.js 捕获走 O(n) 兜底（行为完全一致）
// - #14 持久化：索引构建后通过 hnswlib 自带 IDBFS（IndexedDB 虚拟文件系统）落盘，
//   下次启动 loadIndex 读回，跳过重建（消除刷新卡顿）；文件名含内容指纹，编辑后自动失效重建。
//   向量本身早已持久化在每条 snippet 里（刷新不重算向量），仅省去「重新塞入索引结构」这步。
// 内联余弦相似度，避免引入 utils→store 链（store 顶层访问 localStorage，node 环境无此对象会崩）
function cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 模块级缓存：worldId -> { sig, index }。sig 含内容指纹，切换世界/编辑知识库后失效重建。
const _cache = new Map();
let _HNSWLib = null;     // 懒加载的 hnswlib 模块（浏览器）
let _glue = null;        // vendor/ann/hnswlib.js 模块命名空间（含 syncFileSystem）
let _fsSynced = false;   // 本会话是否已把 IDBFS 从 IndexedDB 恢复到虚拟 FS（仅一次）
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
    _glue = mod;                 // 缓存 glue，供 syncFileSystem 刷盘使用
    const lib = mod.default || mod;
    _HNSWLib = await lib.loadHnswlib();
    return _HNSWLib;
}

// 由已就绪的 raw 索引 + 片段集合构造检索包装（重建 label→snippet 映射）。
// ★ 关键不变量：idMap 的下标顺序必须与「构建/writeIndex 时 addPoint 的顺序」完全一致——
//   即 (snippets||[]).filter(有效) 的原始顺序（filter 保序）。loadIndex 读回时复用同一顺序重建。
function wrapLoreIndex(raw, snippets, dim) {
    const valid = (snippets || []).filter(s =>
        s && s.id != null && Array.isArray(s.embedding) && s.embedding.length === dim
    );
    const idMap = new Map();
    valid.forEach((s, i) => idMap.set(i, s));
    return {
        size: valid.length,
        _raw: raw,   // ★ #14：持久化用，便于 writeIndex
        search(qVec, topK) {
            if (!Array.isArray(qVec) || qVec.length !== dim) throw new Error("查询向量维度不匹配");
            const k = Math.min(topK, valid.length);
            if (!k) return [];
            // searchKnn 强制 3 参：(queryPoint, numNeighbors, filter)，filter 传 undefined
            const { neighbors, distances } = raw.searchKnn(qVec, k, undefined);
            return neighbors
                .map((label, i) => ({ snippet: idMap.get(label), embScore: 1 - (distances[i] || 0) }))
                .filter(x => x.snippet);
        }
    };
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
    valid.forEach((s, i) => { index.addPoint(s.embedding, i, false); });
    return wrapLoreIndex(index, snippets, dim);
}

// ★ #14（ANN 索引持久化）：把「世界 + 维度 + 片段集合」压成一个短指纹串，
// 作为持久化文件名的一部分。任何增删/改文本/换维度都会改变指纹 → 旧索引文件被忽略 →
// 自动重建，无需显式删除（旧文件成为孤儿，体积可控，后续可加清扫）。
const INDEX_VERSION = 1;
function snippetFingerprint(snippets, dim) {
    let h = 0x811c9dc5; // FNV-1a
    const fnv = (str) => {
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    };
    fnv(String(dim) + "|" + (snippets ? snippets.length : 0) + "|");
    const arr = (snippets || []).filter(s => s && s.id != null);
    for (const s of arr) {
        fnv(String(s.id) + " " + (s.category || "") + " " + (s.title || "") + " " +
            (s.content || "") + " " + ((s.keywords || []).join(",")) + " ");
    }
    return (h >>> 0).toString(16);
}
function annFileName(worldId, dim, sig) {
    const safe = String(worldId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
    return `ann_${safe}_${dim}_${sig}_v${INDEX_VERSION}.idx`;
}

// 获取（或懒构建 / 懒读回）某世界的 ANN 索引。
// ★ #14 持久化：用内容指纹拼出确定文件名 → 尝试 loadIndex 读回（命中则跳过重建，消除刷新卡顿）；
//   失败则 buildLoreIndex + writeIndex + syncFileSystem("write") 落 IndexedDB。
//   任何一步失败都静默降级为内存构建（rag.js 另有 O(n) 兜底），不影响游玩。
export async function getLoreAnnIndex(kb, worldId, opts = {}) {
    const key = worldId || "default";
    const dim = opts.dim || 512;
    const snippets = (kb && kb.snippets) || [];
    const sig = snippetFingerprint(snippets, dim);
    const cached = _cache.get(key);
    if (cached && cached.sig === sig) return cached.index;   // 内存命中
    const lib = await loadHNSWLib();
    // 首次（每会话）把 IDBFS 从 IndexedDB 恢复到虚拟 FS，之后 loadIndex 才能找到文件
    if (!_fsSynced) {
        try { if (_glue && typeof _glue.syncFileSystem === "function") await _glue.syncFileSystem("read"); }
        catch (e) { /* 读同步失败不影响后续，走重建 */ }
        _fsSynced = true;
    }
    const fileName = annFileName(worldId, dim, sig);
    let index = null;
    // 尝试读回持久化索引（仅当库暴露 loadIndex 方法；用 prototype 判断避免给无该方法的环境多构造）
    const hasLoad = typeof lib.HierarchicalNSW === "function" &&
        (typeof lib.HierarchicalNSW.prototype?.loadIndex === "function");
    if (hasLoad) {
        try {
            const raw = new lib.HierarchicalNSW("cosine", dim, fileName);
            raw.loadIndex(fileName);                 // 不存在/损坏会抛错 → 下方 catch 走重建
            index = wrapLoreIndex(raw, snippets, dim);
            if (!index || index.size === 0) index = null; // 空索引视为未命中，回落重建
        } catch (e) { index = null; }
    }
    // 未命中 → 重建并持久化
    if (!index) {
        index = buildLoreIndex(lib, snippets, opts);
        try {
            if (index._raw && typeof index._raw.writeIndex === "function") {
                index._raw.writeIndex(fileName);            // 写出索引到虚拟 FS
                if (_glue && typeof _glue.syncFileSystem === "function") {
                    await _glue.syncFileSystem("write");    // 刷入 IndexedDB（仅浏览器 glue 可用）
                }
            }
        } catch (e) { /* 持久化失败不致命，内存索引仍可用 */ }
    }
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

// ★ 清除全部持久化 ANN 索引（设置界面「清除索引缓存」按钮）：
//   删除 IDBFS 里所有 ann_*.idx（含孤儿与当前），再刷盘释放 IndexedDB 空间；
//   并清空内存 _cache，下次进入世界会懒重建。任何失败都静默降级（孤儿文件无害，不影响存档/剧情）。
// 实现：利用 hnswlib 模块暴露的 Emscripten `FS`（EXPORTED_RUNTIME_METHODS 含 'FS'，见 wasm 导出表），
//   readdir 列出 + unlink 删除，再 syncFileSystem("write") 把删除落盘；多挂载点一并扫描以防 IDBFS 非根挂载。
export async function clearLoreAnnCache() {
    const lib = await loadHNSWLib();
    let deleted = 0;
    try {
        // 先把已持久化文件从 IndexedDB 拉进内存 FS，确保读到真实清单
        if (_glue && typeof _glue.syncFileSystem === "function") {
            try { await _glue.syncFileSystem("read"); } catch (e) { /* 忽略 */ }
        }
        const FS = (lib && lib.FS) || null;
        if (FS && typeof FS.readdir === "function" && typeof FS.unlink === "function") {
            const roots = ["/"];
            if (Array.isArray(FS.mounts)) {
                FS.mounts.forEach(m => {
                    if (m && m.mountpoint && roots.indexOf(m.mountpoint) === -1) roots.push(m.mountpoint);
                });
            }
            for (const root of roots) {
                let files = [];
                try {
                    files = FS.readdir(root).filter(f =>
                        typeof f === "string" && f.startsWith("ann_") && f.endsWith(".idx"));
                } catch (e) { continue; }
                const base = root.endsWith("/") ? root.slice(0, -1) : root;
                for (const f of files) {
                    try { FS.unlink(base + "/" + f); deleted++; } catch (e) { /* 忽略单个失败 */ }
                }
            }
        }
        // 把删除结果刷回 IndexedDB（仅浏览器 glue 可用；无 glue 时静默跳过）
        if (_glue && typeof _glue.syncFileSystem === "function") {
            try { await _glue.syncFileSystem("write"); } catch (e) { /* 忽略 */ }
        }
    } catch (e) {
        // 任何异常都不致命：孤儿文件最多占用一点空间，不影响游玩
    }
    invalidateAllLoreAnn();   // 清空内存缓存，下次懒重建
    return deleted;
}
