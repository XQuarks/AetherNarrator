// ============================================================
// AetherNarrator · rag.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { MEMORY_TYPES, MEMORY_BUCKETS, getWorldLoreKB } from "./store.js";

import { cosineSimilarity, isFuzzyFact, normFact, runPool } from "./utils.js";
import { getEmbedConcurrency } from "./providers.js";
import { formatTimeLabel, getTimeConfig } from "./theme.js";
import { isLoreFullInSystem } from "./prompt.js";
import { showToast } from "./render.js";
import { getLoreAnnIndex, embeddingRetrieveBruteforce } from "./ann-index.js";
import { expandRelationNeighbors } from "./kg-graph.js"; // ★ Phase 4 增补：relations 实体图遍历召回（纯函数）
import { showEngineBadge, setEngineReady } from "./loading-ui.js"; // ★ 加载体验：把 worker 进度接到 UI

// ★ P0-3-A：中文 embedding 模型（替代英文 all-MiniLM，中文语义召回更强）。维度由模型固定为 512。
export const EMBED_MODEL = "Xenova/bge-small-zh-v1.5";
export const EMBED_DIM = 512;
// bge 系列官方约定：查询句加检索前缀、文档句不加，召回质量明显提升
const BGE_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";

// ★ P0-3-E：embedding 推理移入 Web Worker，主线程不卡（首载模型下载也在 worker 内完成）
let _embedWorker = null;
let _embedReqId = 0;
const _embedPending = new Map();
// ★ 加载体验：模型就绪状态机（供进入游戏遮罩 / 角标判断）
let _modelReady = false;
let _modelReadyPromise = null;
let _modelReadyResolve = null;

function getModelReadyPromise() {
    if (_modelReadyPromise) return _modelReadyPromise;
    _modelReadyPromise = new Promise((res) => { _modelReadyResolve = res; });
    return _modelReadyPromise;
}

// 返回模型就绪的 Promise；Worker 不可用时（如 Node 测试）立即视为就绪，避免悬挂
export function whenModelReady() {
    if (_modelReady) return Promise.resolve();
    if (typeof Worker === "undefined") return Promise.resolve();
    return getModelReadyPromise();
}

function getEmbedWorker() {
    if (_embedWorker) return _embedWorker;
    if (typeof Worker === "undefined") throw new Error("当前环境不支持 Web Worker");
    _embedWorker = new Worker(new URL("./embedding-worker.js", import.meta.url), { type: "module" }); // ESM module worker（import 加载 transformers 单文件 ESM）
    _embedWorker.onmessage = (e) => {
        const { id, type, data } = e.data || {};
        // ★ 加载体验：warmup 进度 / 就绪消息 → 接到 UI 角标（不再默默吞掉）
        if (type === "progress") { showEngineBadge(typeof data === "string" ? data : "AI 语义引擎准备中…"); return; }
        if (type === "ready") {
            _modelReady = true;
            if (_modelReadyResolve) { _modelReadyResolve(); _modelReadyResolve = null; }
            setEngineReady();
            return;
        }
        const p = _embedPending.get(id);
        if (!p) return;
        _embedPending.delete(id);
        if (type === "result") p.resolve(data);
        else if (type === "error") p.reject(new Error(data));
    };
    _embedWorker.onerror = (err) => {
        const errMsg = String((err && err.message) || err);
        for (const [, p] of _embedPending) p.reject(new Error("embedding worker 错误: " + errMsg));
        _embedPending.clear();
        _embedWorker = null; // 允许下次回落主线程重试
    };
    return _embedWorker;
}

function embedViaWorker(text, isQuery) {
    return new Promise((resolve, reject) => {
        let w;
        try { w = getEmbedWorker(); }
        catch (e) { reject(e); return; }
        const id = ++_embedReqId;
        _embedPending.set(id, { resolve, reject });
        try {
            w.postMessage({ id, text, isQuery });
        } catch (e) {
            _embedPending.delete(id);
            reject(e);
        }
    });
}

// ★ P0 时间线向量并发：批量推理走 Worker（一次 forward pass 处理多条文本）
function embedViaWorkerBatch(texts, isQuery) {
    return new Promise((resolve, reject) => {
        let w;
        try { w = getEmbedWorker(); }
        catch (e) { reject(e); return; }
        const id = ++_embedReqId;
        _embedPending.set(id, { resolve, reject });
        try {
            w.postMessage({ id, texts, isQuery });
        } catch (e) {
            _embedPending.delete(id);
            reject(e);
        }
    });
}

// 把 transformers 的批量输出张量拆成「每条一个向量」的数组（与 worker 内 splitBatch 同形）。
function splitBatchTensor(out) {
    if (!out || !out.dims || out.dims.length < 2) return [Array.from(out.data)];
    const batch = out.dims[0], dim = out.dims[1];
    const vectors = [];
    for (let i = 0; i < batch; i++) {
        vectors.push(Array.from(out.data.subarray(i * dim, (i + 1) * dim)));
    }
    return vectors;
}

// 主动预热（init 时调用）：让 worker 后台加载模型，玩家首次语义检索即命中、不卡
export function warmupEmbeddingWorker() {
    try {
        getModelReadyPromise(); // 先建 promise，确保 worker 的 ready 能 resolve 它
        getEmbedWorker().postMessage({ id: ++_embedReqId, type: "warmup" });
        showEngineBadge("AI 语义引擎准备中…"); // ★ 加载体验：首页即给出可见提示
    } catch (e) { /* Worker 不可用（如 Node 测试环境），忽略，运行时回落主线程 */ }
}

export function keywordRetrieve(input, topK = 5) {
    const kb = getWorldLoreKB();
    if (!kb || !kb.snippets) return [];
    // 中文分词：Intl.Segmenter 按词语切分，"我要去大观园找林黛玉" → ["我","要","去","大观园","找","林黛玉"]
    const terms = segmentChinese(input);
    if (!terms.length) return [];
    const scored = kb.snippets.map(s => {
        let score = 0;
        const text = (s.category + " " + s.title + " " + s.content + " " + (s.keywords || []).join(" ")).toLowerCase();
        for (const t of terms) {
            if (text.includes(t)) score += 2;
            if ((s.keywords || []).some(k => k.toLowerCase().includes(t))) score += 3;
            if (s.title.toLowerCase().includes(t)) score += 4;
        }
        return { snippet: s, kwScore: score };
    }).filter(x => x.kwScore > 0).sort((a, b) => b.kwScore - a.kwScore).slice(0, topK);
    return scored;
}

export function getZhSegmenter() {
    if (S._zhSegmenter === null) {
        try { S._zhSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" }); }
        catch (e) { S._zhSegmenter = false; }
    }
    return S._zhSegmenter || null;
}

export function segmentChinese(text) {
    const terms = [];
    // 先按空白/标点切出英文单词和中文片段
    const chunks = text.split(/[\s,，。！？、；：""''「」《》（）【】]+/).filter(Boolean);
    for (const chunk of chunks) {
        // 纯英文/数字 → 直接作为关键词
        if (/^[a-zA-Z0-9]+$/.test(chunk)) {
            if (chunk.length >= 2) terms.push(chunk.toLowerCase());
            continue;
        }
        // 中文 → Intl.Segmenter 分词（复用单例）
        const seg = getZhSegmenter();
        if (seg) {
            try {
                const segments = seg.segment(chunk);
                for (const s of segments) {
                    if (s.isWordLike && s.segment.length >= 2) {
                        terms.push(s.segment);
                    }
                }
                continue;
            } catch (e) { /* 单例构造时可用、分词时异常仍降级 */ }
        }
        // 降级：如果 Segmenter 不可用，对大块中文直接作为关键词
        if (chunk.length >= 2 && chunk.length <= 10) terms.push(chunk);
    }
    // 去重
    return [...new Set(terms)];
}

export async function embeddingRetrieve(input, topK = 5, qVec = null) {
    const kb = getWorldLoreKB();
    if (!kb || !kb.snippets || !kb.snippets.length) return [];
    // AI 生成世界 / 老存档未预计算向量时，先尝试补算（一次性，之后命中 sn[0].embedding 即跳过）
    if (kb.snippets.some(s => !Array.isArray(s.embedding) || !s.embedding.length)) {
        try { await ensureLoreEmbeddings(kb); } catch (e) { /* 降级为关键词 */ }
    }
    const embeddedSnippets = kb.snippets.filter(s => Array.isArray(s.embedding) && s.embedding.length);
    if (!embeddedSnippets.length) return [];
    // ★ P1 优化：优先复用调用方已算好的查询向量（整回合只算一次），缺失时再自行计算（兜底）
    let queryVec = qVec;
    if (!queryVec) {
        try {
            queryVec = await computeEmbedding(input, true); // 查询句加 bge 检索前缀
        } catch (e) {
            console.warn("查询向量计算失败", e);
            return [];
        }
    }
    // ★ Phase 1：优先走 ANN 索引（O(log n)）；任何失败回落 O(n) 兜底（行为完全一致）
    const worldId = (S.currentWorld && S.currentWorld.id) || "default";
    let scored;
    try {
        const idx = await getLoreAnnIndex(kb, worldId, { dim: EMBED_DIM });
        scored = idx.search(queryVec, topK * 2); // 多取一些，后续加权/门禁再筛
    } catch (e) {
        scored = embeddingRetrieveBruteforce(embeddedSnippets, queryVec, topK);
    }
    return scored.slice(0, topK);
}

// ★ docs/34 #8：主线程回落共用——动态加载 transformers（避免首屏下载 880KB）并初始化共用嵌入模型，
// 与 embedding-worker 共用模型/维度；失败抛错交由调用方降级（关键词检索）。
async function ensureMainThreadTransformers(failMsg) {
    if (typeof window.transformers === "undefined") {
        try {
            const mod = await import("../vendor/transformers/transformers.min.js");
            const e = mod.env;
            e.allowRemoteModels = false;                       // 禁止回退到远程下载
            e.localModelPath = "models";                       // 相对文档根 → 项目根/models/
            if (e.backends && e.backends.onnx && e.backends.onnx.wasm) {
                e.backends.onnx.wasm.wasmPaths = "vendor/transformers/";
            }
            window.transformers = mod;
        } catch (err) {
            throw new Error(failMsg);
        }
    }
    if (!S.embeddingModel) {
        S.embeddingModel = await window.transformers.pipeline("feature-extraction", EMBED_MODEL);
    }
    return S.embeddingModel;
}

export async function computeEmbedding(text, isQuery = false) {
    // ★ P0-3-E：优先走 Web Worker（不卡 UI）；任何失败回落主线程
    try {
        return await embedViaWorker(text, isQuery);
    } catch (e) {
        console.warn("Worker 向量计算失败，回落主线程:", e && e.message);
    }
    const model = await ensureMainThreadTransformers("transformers 不可用（主线程回落加载失败）");
    const input = isQuery ? BGE_QUERY_PREFIX + text : text;
    const out = await model(input, { pooling: "mean", normalize: true });
    return Array.from(out.data);
}

// ★ P0 时间线向量并发：批量向量计算——一次 forward pass 处理多条文本，
// 远快于逐条串行 Worker 往返。embedFn 可注入（测试/替换推理后端）。
export async function computeEmbeddingBatch(texts, isQuery = false, embedFn = null) {
    if (!Array.isArray(texts) || !texts.length) return [];
    if (embedFn) return embedFn(texts, isQuery); // 测试注入
    try {
        return await embedViaWorkerBatch(texts, isQuery);
    } catch (e) {
        console.warn("Worker 批量向量计算失败，回落主线程:", e && e.message);
    }
    const model = await ensureMainThreadTransformers("transformers 不可用（主线程批量回落加载失败）");
    const inputs = isQuery ? texts.map(t => BGE_QUERY_PREFIX + t) : texts;
    const out = await model(inputs, { pooling: "mean", normalize: true });
    return splitBatchTensor(out);
}

export async function ensureLoreEmbeddings(kb, onProgress) {
    if (!kb || !kb.snippets || !kb.snippets.length) return;
    // ★ P0-3 维度打标：全部已算且模型/维度一致才跳过，否则需重算（换模型后旧向量错配）
    if (kb.snippets.every(s => Array.isArray(s.embedding) && s.embedding.length && s.embedDim === EMBED_DIM && s.embedModel === EMBED_MODEL)) return;
    if (typeof window.transformers === "undefined" && typeof Worker === "undefined") return; // 环境不支持，降级为关键词
    // 收集仍需计算向量的片段（已算过且维度一致的跳过，不重复算）
    const pending = kb.snippets.filter(s => !(s.embedding && s.embedDim === EMBED_DIM && s.embedModel === EMBED_MODEL));
    if (!pending.length) return;
    // ★ 提速：并发算向量（复用 runPool）。并发数由界面设置读取（getEmbedConcurrency，默认 100）；
    //    embedding Worker 按 id 配对响应，并发安全；单条失败仅该条降级为关键词检索，不中断整体。
    const EMBED_CONCURRENCY = getEmbedConcurrency();
    await runPool(pending, EMBED_CONCURRENCY,
        async (s) => {
            const text = [s.category, s.title, s.content, (s.keywords || []).join(" ")].filter(Boolean).join(" ");
            try {
                s.embedding = await computeEmbedding(text); // 文档句不加查询前缀
                s.embedDim = EMBED_DIM;
                s.embedModel = EMBED_MODEL;
            } catch (e) {
                console.warn("知识库片段向量计算失败，降级为关键词检索:", e && e.message);
            }
        },
        { onProgress: onProgress ? (done, total) => onProgress(done, total) : undefined }
    );
}

// ★ B1: lore 触发门禁（混合触发：关键词命中 或 向量相似度≥阈值 → 注入）
const EMBED_TRIGGER_THRESHOLD = 0.30; // 语义相似度触发阈值（可调：低→多灌，高→易漏）

function getRecentTurnTexts(maxTurns) {
    const hist = S.conversationHistory || [];
    return hist.slice(-Math.max(0, maxTurns))
        .map(e => ((e && e.player ? e.player : "") + " " + (e && e.narrative ? e.narrative : "")))
        .filter(Boolean);
}

function buildActivationContext(input, depth) {
    const turns = getRecentTurnTexts(Math.max(0, (depth || 1) - 1));
    return [input || "", ...turns].join("\n");
}

function loreTriggeredByKeyword(snip, context) {
    const keys = snip.activation_keys || [];
    if (!keys.length) return true; // 无关键词 → 视为常驻，不拦截
    const lowerCtx = (context || "").toLowerCase();
    for (const k of keys) {
        if (!k) continue;
        const kk = String(k).toLowerCase();
        if (snip.trigger_mode === "regex") {
            try {
                if (new RegExp(kk, "i").test(context || "")) return true;
            } catch (e) {
                if (lowerCtx.includes(kk)) return true; // 正则非法 → 退化子串匹配
            }
        } else if (lowerCtx.includes(kk)) {
            return true;
        }
    }
    return false;
}

function isLoreTriggered(snip, context, embScore) {
    const mode = snip.trigger_mode
        || (snip.activation_keys && snip.activation_keys.length ? "keyword" : "always");
    if (mode === "always") return true;
    const kw = loreTriggeredByKeyword(snip, context);
    const emb = (typeof embScore === "number") && embScore >= EMBED_TRIGGER_THRESHOLD;
    return kw || emb; // 关键词命中 或 语义足够近 → 注入
}

// ★ docs/56：按剧情进度解锁的「隐形门禁」纯函数。
// 复用 gameState.story_progress 当"当前剧情阶段指针"（1..K，单调只增）；
// 未到阶段的 lore（unlock_stage > 当前进度）视为「尚未揭示」，应被剔除、且不给任何提示（防剧透、不破坏沉浸）。
// - 老存档/老 lore 缺 unlock_stage → 默认 1（全程可用，不锁），向后兼容。
// - 行为记录（玩家记忆）以 behavior_ 开头，永远是记忆而非世界设定，不受门禁影响。
// 抽出为纯函数便于单测；S.gameState 缺失时按进度 1 处理（所有 stage≥1 卡片可用）。
export function loreStageUnlocked(snip) {
    if (!snip) return true;
    if (String(snip.id || "").startsWith("behavior_")) return true; // 记忆不受限
    const stage = (typeof snip.unlock_stage === "number" && isFinite(snip.unlock_stage) && snip.unlock_stage >= 1)
        ? Math.floor(snip.unlock_stage) : 1;
    const cur = (S.gameState && typeof S.gameState.story_progress === "number" && isFinite(S.gameState.story_progress) && S.gameState.story_progress >= 1)
        ? Math.floor(S.gameState.story_progress) : 1;
    return stage <= cur;
}

// ★ B4：递归触发 —— 已注入片段的正文里若出现其它片段的激活词，则连带触发它们
// （复用 B1 的关键词门槛，基于"已注入内容"动态连锁，而非依赖预定义硬链；深度封顶避免爆炸）
const RECURSIVE_MAX_DEPTH = 3;

function expandRecursiveTriggers(seedSnips, kb, maxDepth) {
    const chosen = new Map();
    for (const s of seedSnips) if (s && s.id != null) chosen.set(s.id, s);
    let frontier = seedSnips.slice();
    for (let d = 0; d < maxDepth; d++) {
        const ctx = frontier.map(s => ((s.title || "") + " " + (s.content || ""))).join("\n");
        if (!ctx.trim()) break;
        const next = [];
        for (const s of kb.snippets) {
            if (chosen.has(s.id)) continue;
            if (s.recursive === false) continue;         // 该条显式关闭递归
            if (s.trigger_mode === "always") continue;    // 常驻条本就已注入，无需递归带入
            if (loreTriggeredByKeyword(s, ctx)) { chosen.set(s.id, s); next.push(s); }
        }
        if (!next.length) break;
        frontier = next;
    }
    return chosen;
}

// ★ 时间线切片（乙·语义版 + 单向门禁）：带 timeline 的命中条目，
//   ① 先按 story_progress 单向门禁——只保留 order ≤ 当前进度的阶段，屏蔽"尚未发生的未来"（不剧透）；
//   ② 在已解锁阶段内按对话语义/关键词精选相关片段（无匹配则给全部已解锁阶段作为"已知经历"）；
//   ③ 按 order 升序输出，不露"第X章"等章节字（只用地点+要点）。
// 仅对走动态召回的 nonCore 类生效；人物/地点等固定在 system 的类不走此处，靠结构化 timeline + system 指令由 AI 自判。

// 时间线分段文本拼接：地点 + 要点（不含 order/phase，避免章节字混入匹配）
const textOfTimeline = (t) => ((t.location || "") + " " + (t.summary || ""));

// ★ P0 优化：时间线分段向量缓存——首次按段现算后缓存在段对象上（仿 ensureLoreEmbeddings 在 snippet 上存 embedding），
// 后续回合直接复用，避免每条时间线知识每回合都重算整段向量（最坏数十次串行 Worker 往返）。
// 只在段已解锁（one-way 门禁）时按需计算；KB 重新载入（段对象被替换）时缓存自然失效。
// 进行中的计算用 WeakMap 去重（不往段对象上挂 promise，避免污染存档序列化）。embedFn 默认走真实 computeEmbedding，测试可注入 mock。
const _segEmbedPending = new WeakMap();
export async function embedTimelineSegment(t, embedFn = computeEmbedding) {
    const text = textOfTimeline(t);
    // 已算且模型/维度一致 → 直接复用
    if (Array.isArray(t.embedding) && t.embedding.length && t.embedDim === EMBED_DIM && t.embedModel === EMBED_MODEL) {
        return t.embedding;
    }
    // 并发去重：同一段正在计算时复用同一个 promise，避免重复 Worker 往返
    if (_segEmbedPending.has(t)) return _segEmbedPending.get(t);
    const p = (async () => {
        try {
            const v = await embedFn(text, false); // 文档句不加查询前缀
            t.embedding = v;
            t.embedDim = EMBED_DIM;
            t.embedModel = EMBED_MODEL;
            return v;
        } finally {
            _segEmbedPending.delete(t);
        }
    })();
    _segEmbedPending.set(t, p);
    return p;
}

// ★ P0 时间线向量并发：单向门禁（只保留 order ≤ 当前故事进度的已解锁阶段）。
// 抽成独立纯函数，供 selectTimelineSlice 与批量向量化共用，避免门禁逻辑重复。
export function unlockedTimelineSegments(snippet) {
    const tl = snippet.timeline;
    if (!Array.isArray(tl) || !tl.length) return [];
    const orderOf = (t) => (typeof t.order === "number" ? t.order : 1);
    const progress = (S.gameState && typeof S.gameState.story_progress === "number") ? S.gameState.story_progress : 1;
    return tl.filter((t) => orderOf(t) <= progress);
}

// ★ P0 时间线向量并发：把一批时间线阶段合并成一次批量推理（一次 forward pass），
// 远快于逐段串行 Worker 往返。段向量缓存 + 逐段回落保证并发安全与降级。
// batchEmbedFn 默认走真实 computeEmbeddingBatch（Worker 批量），测试可注入 mock。
export async function embedTimelineSegmentsBatch(segments, batchEmbedFn = computeEmbeddingBatch) {
    const pending = segments.filter(s => !(Array.isArray(s.embedding) && s.embedding.length && s.embedDim === EMBED_DIM && s.embedModel === EMBED_MODEL));
    if (!pending.length) return; // 全部已缓存 → 直接跳过（无 Worker 往返）
    const texts = pending.map(textOfTimeline);
    try {
        const vectors = await batchEmbedFn(texts, false); // 文档句不加查询前缀
        if (Array.isArray(vectors)) {
            pending.forEach((s, i) => {
                if (vectors[i] && Array.isArray(vectors[i]) && vectors[i].length) {
                    s.embedding = vectors[i];
                    s.embedDim = EMBED_DIM;
                    s.embedModel = EMBED_MODEL;
                }
            });
        }
    } catch (e) {
        // 整批失败 → 逐段回落（沿用现有 selectTimelineSlice 内的 embedTimelineSegment 单条路径）
        console.warn("时间线批量向量失败，逐段回落:", e && e.message);
        for (const s of pending) {
            try { await embedTimelineSegment(s); } catch (_) { /* 单段失败不阻塞整体 */ }
        }
    }
}

export async function selectTimelineSlice(snippet, input, qVec) {
    const tl = snippet.timeline;
    if (!Array.isArray(tl) || !tl.length) return snippet;
    const orderOf = (t) => (typeof t.order === "number" ? t.order : 1);
    // ① 单向门禁：只保留 order ≤ 当前故事进度的阶段（未发生的未来一律不注入，避免剧透）
    const unlocked = unlockedTimelineSegments(snippet);
    if (!unlocked.length) return snippet; // 连最早阶段都未解锁（异常）→ 不注入 timeline，保留原 content
    // ② 关键词匹配（零成本，始终可用）——仅在已解锁片段内
    const terms = segmentChinese(input || "");
    const kwMatched = [];
    for (const t of unlocked) {
        const text = textOfTimeline(t).toLowerCase();
        let hit = 0;
        for (const term of terms) if (text.includes(term)) hit++;
        if (hit > 0) kwMatched.push({ t, hit });
    }
    // 语义匹配（向量可用时增强）——仅在已解锁片段内；段向量首次算后缓存，后续回合直接复用（P0 优化）
    let chosen = null;
    if (qVec && (typeof window !== "undefined" && (typeof window.transformers !== "undefined" || typeof Worker !== "undefined"))) {
        try {
            const segs = await Promise.all(unlocked.map(async (t) => ({ t, tv: await embedTimelineSegment(t) })));
            const scored = segs.map(({ t, tv }) => ({ t, sim: cosineSimilarity(qVec, tv) }));
            chosen = scored.sort((a, b) => b.sim - a.sim).slice(0, 3).map((x) => x.t);
        } catch (e) { /* 降级关键词 */ }
    }
    if (!chosen && kwMatched.length) {
        chosen = kwMatched.sort((a, b) => b.hit - a.hit).slice(0, 3).map((x) => x.t);
    }
    // 无语义/关键词匹配 → 给已解锁的全部阶段（"到目前为止的已知经历"），仍不剧透未来
    if (!chosen || !chosen.length) chosen = unlocked;
    // ③ 按 order 升序输出，不露章节字（只用地点+要点）
    chosen = chosen.slice().sort((a, b) => orderOf(a) - orderOf(b));
    const tlText = chosen.map((t) => `- ${t.location ? t.location + "：" : ""}${t.summary || ""}`).join("\n");
    return { ...snippet, content: `${(snippet.content || "").trim()}\n\n【已知经历·按时间顺序（未发生的不在此列）】\n${tlText}` };
}

export async function retrieve(input) {
    // ★ P1 优化：整回合只算一次查询向量，供 embeddingRetrieve / 时间线切片 / 行为记忆三处复用，
    //   避免同一 input 在同一回合被 computeEmbedding 算三次（Worker 往返重）。
    let qVec = null;
    try {
        if (typeof window !== "undefined" && (typeof window.transformers !== "undefined" || typeof Worker !== "undefined")) {
            qVec = await computeEmbedding(input, true); // 查询句加 bge 检索前缀
        }
    } catch (e) { qVec = null; }

    // P1#2：小知识库（全文已注入 system）无需每轮跑 embedding 推理 + 关键词向量检索——
    // 那段知识在 buildTurnUserMessage 里不会进入 user 消息，纯属浪费（手机端尤卡）。
    // 仅保留行为记录召回（仍是按相关度），因为它独立于 lore 注入、本就服务于"关键事实"区块。
    if (isLoreFullInSystem()) {
        const behavior = await retrieveBehaviorRecords(input, 3, qVec);
        return behavior.map(b => ({
            id: "behavior_" + b.id, category: "行为记录", title: "关键事实",
            content: b.text, kw: 1.5, emb: 0
        }));
    }

    // ★ P1.2.3: 向量模型未加载时给出一次性可见提示（而非静默降级），便于排查
    // ★ P0 修正：window.transformers 现仅在主线程回落时定义；Worker 可用即视为向量可用，避免误报
    if (typeof Worker === "undefined" && typeof window.transformers === "undefined" && !S.vectorUnavailableWarned) {
        S.vectorUnavailableWarned = true;
        showToast("向量模型未加载，已降级为关键词检索（检查网络或 transformers.js 是否加载）", "warn");
    }

    // RAG 并行化：关键词检索和向量检索同时进行（向量检索复用上方已算的 qVec）
    const [keyword, embedding] = await Promise.all([
        Promise.resolve(keywordRetrieve(input, 7)),
        embeddingRetrieve(input, 7, qVec)
    ]);
    // qVec 已在函数开头算好（供时间线切片语义匹配复用），此处不再重算

    // 保留真实分数（关键词分 + 余弦相似度）做加权融合，而非归一为 1/2 常量（修复 #1 丢失区分度）
    const KW_W = 1.0, EMB_W = 2.0;
    const merged = new Map();
    for (const k of keyword) {
        const cur = merged.get(k.snippet.id) || { snippet: k.snippet, kw: 0, emb: 0 };
        cur.kw = Math.max(cur.kw, k.kwScore);   // 同片段取最高关键词分
        merged.set(k.snippet.id, cur);
    }
    for (const e of embedding) {
        const cur = merged.get(e.snippet.id) || { snippet: e.snippet, kw: 0, emb: 0 };
        cur.emb = Math.max(cur.emb, e.embScore);
        merged.set(e.snippet.id, cur);
    }

    // 加入玩家行为记录（复用本回合已算的 qVec，避免重复算查询向量）
    const behavior = await retrieveBehaviorRecords(input, 3, qVec);
    for (const b of behavior) {
        merged.set("behavior_" + b.id, { snippet: { id: "behavior_" + b.id, category: "行为记录", title: "关键事实", content: b.text }, kw: 1.5, emb: 0 });
    }

    // ★ B1: 触发门禁（混合触发）。P0-2：按用户要求不再兼容"无元数据老存档"，
    // 移除原「无 activation_keys → 全量 Top8 回退」分支，所有知识库统一走触发门禁。
    const _kb = getWorldLoreKB();
    if (_kb && _kb.snippets) {
        // always 是真正的常驻条目，不能依赖关键词/向量候选池是否先召回。
        for (const s of _kb.snippets) {
            const mode = s.trigger_mode || (s.activation_keys?.length ? "keyword" : "always");
            if (mode === "always" && !merged.has(s.id)) merged.set(s.id, { snippet: s, kw: 0.75, emb: 0 });
        }
        for (const [key, val] of merged.entries()) {
            if (String(key).startsWith("behavior_")) continue; // 行为记录（记忆）不受门禁影响，始终按相关度召回
            const snip = val && val.snippet;
            if (!snip) continue;
            const ctx = buildActivationContext(input, snip.scan_depth || 1);
            if (!isLoreTriggered(snip, ctx, val.emb || 0)) merged.delete(key);
        }

        // ★ B4：递归触发（默认开；用 _kb.recursive_enabled === false 关闭）。
        // 已注入片段的正文里若出现其它片段的激活词 → 连带触发（复用 B1 关键词门槛，非硬链）
        if (_kb.recursive_enabled !== false) {
            const seeds = [];
            for (const [key, val] of merged.entries()) {
                if (String(key).startsWith("behavior_")) continue;
                if (val && val.snippet) seeds.push(val.snippet);
            }
            const expanded = expandRecursiveTriggers(seeds, _kb, RECURSIVE_MAX_DEPTH);
            for (const s of expanded.values()) {
                if (!merged.has(s.id)) merged.set(s.id, { snippet: s, kw: 0.5, emb: 0 }); // 连带触发给较低基础分
            }
        }

        // ★ B9②：图谱链接跟随——已触发片段若有 links，沿语义关系拉入关联条目（深度 ≤ 2，与 B4 递归去重）
        if (_kb && _kb.snippets) {
            const idMap = new Map(_kb.snippets.map(s => [s.id, s]));
            const linkedIds = new Set();
            const frontier = new Set();
            for (const [key] of merged.entries()) {
                if (String(key).startsWith("behavior_")) continue;
                frontier.add(String(key));
            }
            for (let depth = 0; depth < 2 && frontier.size; depth++) {
                const next = new Set();
                for (const id of frontier) {
                    const snip = idMap.get(id);
                    if (!snip || !snip.links || !snip.links.length) continue;
                    for (const l of snip.links) {
                        if (!linkedIds.has(l.target) && !merged.has(l.target) && idMap.has(l.target)) {
                            linkedIds.add(l.target);
                            next.add(l.target);
                        }
                    }
                }
                frontier.clear();
                for (const id of next) frontier.add(id);
            }
            for (const id of linkedIds) {
                const snip = idMap.get(id);
                if (snip) merged.set(id, { snippet: snip, kw: 0.3, emb: 0 }); // 图谱链接给最低基础分，避免喧宾夺主
            }

            // ★ Phase 4 增补：relations 实体三元组遍历——已触发片段沿 relations 摸到相关实体/片段，
            //   与上方链接跟随互补（那路走片段 ID 链接，这路走实体名关系）。默认开；
            //   _kb.relation_traversal === false 时关闭。邻居以低分保底，受后续 token 预算裁剪，无溢出风险。
            if (_kb.relation_traversal !== false) {
                try {
                    const seedIds = [];
                    for (const [key] of merged.entries()) {
                        if (String(key).startsWith("behavior_")) continue;
                        seedIds.push(String(key));
                    }
                    const extra = expandRelationNeighbors(seedIds, _kb.snippets, { maxDepth: 2 });
                    for (const id of extra) {
                        if (!merged.has(id) && idMap.has(id)) {
                            merged.set(id, { snippet: idMap.get(id), kw: 0.3, emb: 0 }); // 关系邻居与链接邻居同分保底
                        }
                    }
                } catch (e) {
                    console.warn("relations 图遍历召回失败，跳过：", e && e.message);
                }
            }
        }
    }

    // ★ docs/56：剧情进度门禁（隐形剔除，无任何提示）。
    // 在最终排序/裁剪前统一过滤召回池：未解锁阶段（unlock_stage > 当前 story_progress）的 lore 不进入注入池，
    // 既防剧透、又让"提前聊到后期概念"时 AI 以角色当前认知自然回避，强化沉浸。
    // 此步位于所有召回路径（关键词/向量/常驻/递归/链接/关系图）之后，故上述任意路径带入的卡片都会被统一门禁；
    // 行为记录（behavior_ 开头）跳过——记忆不受剧情阶段限制。
    for (const [key, val] of merged.entries()) {
        if (String(key).startsWith("behavior_")) continue;
        const snip = val && val.snippet;
        if (snip && !loreStageUnlocked(snip)) merged.delete(key);
    }

    // ★ B4：token 预算裁剪 —— 先按 priority（重要度）再按相关度排序，累计到预算上限即停。
    // 预算用字符数近似（1 token ≈ 2 中文字符）。行为记录（记忆）不占 lore 预算、始终保留。
    const BUDGET_CHARS = (_kb && typeof _kb.budget_tokens === "number" && _kb.budget_tokens > 0)
        ? _kb.budget_tokens * 2 : 1600;
    const ranked = Array.from(merged.values())
        .map(x => ({ ...x.snippet, score: KW_W * (x.kw || 0) + EMB_W * (x.emb || 0) }))
        .sort((a, b) => ((b.priority || 0) - (a.priority || 0)) || (b.score - a.score));
    const out = [];
    let usedChars = 0, loreCount = 0;
    for (const s of ranked) {
        if (String(s.id).startsWith("behavior_")) { out.push(s); continue; } // 记忆始终保留
        const cost = (s.content || "").length + (s.title || "").length;
        if (usedChars + cost > BUDGET_CHARS) {
            // 第一条本身超预算时保留受限摘要；其余条目严格跳过，避免“保底三条”击穿预算。
            if (loreCount === 0) {
                const titleCost = (s.title || "").length;
                const remaining = Math.max(0, BUDGET_CHARS - titleCost);
                out.push({ ...s, content: (s.content || "").slice(0, remaining) });
                usedChars = titleCost + remaining;
                loreCount++;
            }
            continue;
        }
        usedChars += cost; loreCount++; out.push(s);
        if (loreCount >= 12) break; // 硬上限，正常由预算先触发
    }
    // ★ 时间线切片（乙·语义版）：对命中且带 timeline 的动态召回条目，按对话语义/关键词筛最相关时间段注入，
    // 避免跨阶段信息混淆（如角色第一章在a城、第三章在b城）。无匹配时保留完整 timeline，由 AI 自判。
    // ★ P0 时间线向量并发：先把本轮所有命中条目「已解锁」阶段的向量合并成一次批量推理（一次 forward pass），
    //   再并发做各条时间线切片筛选（段向量已缓存，纯 CPU、无 Worker 往返）。比逐条串行快一个数量级。
    const allUnlockedSegs = [];
    for (const s of out) {
        if (String(s.id).startsWith("behavior_")) continue;
        if (s.timeline && s.timeline.length) {
            for (const t of unlockedTimelineSegments(s)) allUnlockedSegs.push(t);
        }
    }
    if (allUnlockedSegs.length) await embedTimelineSegmentsBatch(allUnlockedSegs);
    const sliceTasks = [];
    for (let i = 0; i < out.length; i++) {
        const s = out[i];
        if (String(s.id).startsWith("behavior_")) continue;
        if (s.timeline && s.timeline.length) {
            const idx = i;
            sliceTasks.push(selectTimelineSlice(s, input, qVec).then(res => { out[idx] = res; }));
        }
    }
    if (sliceTasks.length) await Promise.all(sliceTasks);

    return out;
}

export async function retrieveBehaviorRecords(input, topK = 3, qVec = null) {
    const records = Array.isArray(S.activeBehaviorRecords) ? S.activeBehaviorRecords : [];
    if (!records.length) return [];

    // ★ C4：向量语义检索优先（"黛玉病了"→"黛玉咳血"），关键词兜底
    const terms = segmentChinese(input);
    let useVector = false;
    // ★ P1 优化：优先复用调用方已算好的查询向量（整回合只算一次），缺失时再自行计算（兜底）
    let queryVec = qVec;
    if (!queryVec) {
        try {
            if ((typeof window.transformers !== "undefined" || typeof Worker !== "undefined") && terms.length > 0) {
                queryVec = await computeEmbedding(input, true); // 查询句加 bge 检索前缀
            }
        } catch (e) { /* 向量不可用，降级关键词 */ }
    }
    if (queryVec && terms.length > 0) {
        useVector = true;
        // 后台补算未计算的记忆 embedding
        ensureBehaviorEmbeddings();
    }

    const scored = records.map(b => {
        let score = 0;
        if (useVector && b.embedding && queryVec) {
            score = cosineSimilarity(queryVec, b.embedding) * 5; // 余弦相似度放大到与关键词可比
        }
        // 关键词兜底：与向量分取 max（两者互补，向量覆盖语义、关键词覆盖精确匹配）
        let kwScore = 0;
        if (terms.length) {
            const text = (b.text || "").toLowerCase();
            for (const t of terms) { if (text.includes(t)) kwScore += 1; }
        }
        score = Math.max(score, kwScore);
        const imp = (typeof b.importance === "number" && b.importance >= 1 && b.importance <= 5) ? b.importance : 3;
        score += imp * 0.5;
        if (b.pinned) score += 2;
        return { ...b, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);

    return scored;
}

// ★ 66：记忆三分型兜底规则（纯函数，供 addBehaviorRecords / memory-transfer / 旧档展示共用）
// emotional 只能显式标注（AI 判断"值得记住的情绪"时才产），避免误判泛滥；
// type=event 或 importance>=4 视为重要事件；其余归"学到的知识"。
export function inferBucket(fact, imp) {
    if (fact && typeof fact.bucket === "string" && MEMORY_BUCKETS.includes(fact.bucket)) return fact.bucket;
    const t = (fact && typeof fact.type === "string") ? fact.type : "";
    if (t === "event") return "important_event";
    const importance = (typeof imp === "number" && imp >= 1 && imp <= 5) ? imp
        : (fact && typeof fact.importance === "number" && fact.importance >= 1 && fact.importance <= 5) ? fact.importance : 3;
    if (importance >= 4) return "important_event";
    return "learned_fact";
}

export function addBehaviorRecords(facts) {
    if (!S.currentWorld || !facts || !facts.length) return;
    if (!Array.isArray(S.activeBehaviorRecords)) S.activeBehaviorRecords = [];
    const list = S.activeBehaviorRecords;
    const gs = S.gameState;
    const timeLabel = gs && gs.current_date
        ? formatTimeLabel(gs.current_date, getTimeConfig().timeConfig)
        : "";
    const locLabel = (gs && gs.current_location) ? gs.current_location : "";
    for (const raw of facts) {
        if (!raw) continue;
        const fact = typeof raw === "string" ? { text: raw } : raw;
        const text = fact.text || "";
        if (!text || isFuzzyFact(text)) continue;
        const n = normFact(text);
        if (list.some(b => normFact(b.text) === n)) continue;
        const imp = (typeof fact.importance === "number" && fact.importance >= 1 && fact.importance <= 5)
            ? fact.importance : 3;
        const type = (typeof fact.type === "string" && MEMORY_TYPES.includes(fact.type)) ? fact.type : "other";
        const bucket = inferBucket(fact, imp);
        const record = {
            id: "b" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now() + Math.random().toString(36).slice(2, 6)),
            text,
            importance: imp,
            pinned: !!fact.pinned,
            type,
            bucket, // ★ 66：记忆三分型（emotional/important_event/learned_fact）
            time: fact.time || timeLabel,
            location: fact.location || locLabel,
            npcs: Array.isArray(fact.npcs) ? fact.npcs.slice(0, 8) : [],
            embedding: null,  // C4：向量暂时留空，由 ensureBehaviorEmbeddings 后台异步补算；关键词检索在此期间兜底
            createdAt: new Date().toISOString()
        };
        // ★ 66：情感记忆附带对象与强度
        if (bucket === "emotional") {
            if (typeof fact.target === "string" && fact.target.trim()) record.target = fact.target.trim().slice(0, 80);
            if (typeof fact.intensity === "number") record.intensity = Math.max(0, Math.min(1, fact.intensity));
        }
        list.push(record);
    }
    if (list.length > 100) S.activeBehaviorRecords = list.slice(-100);
}

// ★ C4：后台异步补算所有行为记忆的向量 embedding（"黛玉病了"→"黛玉咳血" 语义匹配）
// embedFn 为可注入的向量计算函数（默认走 computeEmbedding），便于测试与未来替换推理后端。
export async function ensureBehaviorEmbeddings(embedFn) {
    if (typeof window.transformers === "undefined" && typeof Worker === "undefined") return;
    const records = S.activeBehaviorRecords;
    if (!records || !records.length) return;
    // ★ P0 提速：先筛出仍需算向量的记忆（模型/维度一致已算过的跳过），再用 runPool 并发补算，
    //   避免最坏 100 条记忆逐条串行 Worker 往返；单条失败仅该条降级为关键词检索，不中断整体。
    const pending = records.filter(r => !(r.embedding && r.embedDim === EMBED_DIM && r.embedModel === EMBED_MODEL));
    if (!pending.length) return;
    const embed = embedFn || computeEmbedding;
    const EMBED_CONCURRENCY = getEmbedConcurrency();
    await runPool(pending, EMBED_CONCURRENCY,
        async (r) => {
            try {
                r.embedding = await embed(r.text); // 记忆文本作为文档，不加查询前缀
                r.embedDim = EMBED_DIM;
                r.embedModel = EMBED_MODEL;
            } catch (e) { /* 单条失败不阻塞其余 */ }
        }
    );
}

export function summarizeFactsFromChanges(input, narrative, changes) {
    const facts = [];
    if (changes && changes.inventory) {
        for (const op of changes.inventory) {
            if (op.op === "add") facts.push(`玩家获得了 ${op.name} x${op.count}`);
            if (op.op === "remove") facts.push(`玩家失去了 ${op.name} x${op.count}`);
        }
    }
    if (changes && changes.relationships) {
        for (const [k, v] of Object.entries(changes.relationships)) {
            if (typeof v === "string" && v.trim() !== "") {
                facts.push(`玩家与 ${k} 的关系发生了变化`);
            } else if (typeof v === "number") {
                if (v > 0) facts.push(`玩家与 ${k} 的关系有所提升`);
                if (v < 0) facts.push(`玩家与 ${k} 的关系有所下降`);
            }
        }
    }
    // 属性/技能类变更：若 AI 未给具体描述，仅“有了新的变化”属零信息量，不入库
    // （即使兜底生成也会被 addBehaviorRecords 的模糊过滤二次拦截，避免污染关键记忆）
    if (changes && changes.attributes) {
        for (const [k, v] of Object.entries(changes.attributes)) {
            if (typeof v === "string" && v.trim() !== "") {
                facts.push(`玩家的 ${k} 属性发生了变化：${v}`);
            }
        }
    }
    if (changes && changes.skills) {
        for (const [k, v] of Object.entries(changes.skills)) {
            if (typeof v === "string" && v.trim() !== "") {
                facts.push(`玩家的 ${k} 技能发生了变化：${v}`);
            }
        }
    }
    if (changes && changes.completed_events) {
        for (const e of changes.completed_events) facts.push(`玩家完成了事件：${e && typeof e === "object" ? (e.title || e.name || e.id) : e}`);
    }
    if (changes && changes.current_location) facts.push(`玩家前往/到达了 ${changes.current_location}`);
    if (changes && changes.progression && changes.progression.rank) facts.push(`玩家的境界/等级发生了变化：${changes.progression.rank}`);
    return facts.slice(0, 5);
}
