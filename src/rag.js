// ============================================================
// AetherNarrator · rag.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { MEMORY_TYPES } from "./store.js";

import { cosineSimilarity, isFuzzyFact, normFact, runPool } from "./utils.js";
import { getEmbedConcurrency } from "./providers.js";
import { formatTimeLabel, getTimeConfig } from "./theme.js";
import { buildTurnUserMessage, isLoreFullInSystem } from "./prompt.js";
import { showToast } from "./render.js";
import { getLoreAnnIndex, embeddingRetrieveBruteforce } from "./ann-index.js";
import { expandRelationNeighbors } from "./kg-graph.js"; // ★ Phase 4 增补：relations 实体图遍历召回（纯函数）

// ★ P0-3-A：中文 embedding 模型（替代英文 all-MiniLM，中文语义召回更强）。维度由模型固定为 512。
export const EMBED_MODEL = "Xenova/bge-small-zh-v1.5";
export const EMBED_DIM = 512;
// bge 系列官方约定：查询句加检索前缀、文档句不加，召回质量明显提升
const BGE_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";

// ★ P0-3-E：embedding 推理移入 Web Worker，主线程不卡（首载模型下载也在 worker 内完成）
let _embedWorker = null;
let _embedReqId = 0;
const _embedPending = new Map();

function getEmbedWorker() {
    if (_embedWorker) return _embedWorker;
    if (typeof Worker === "undefined") throw new Error("当前环境不支持 Web Worker");
    _embedWorker = new Worker(new URL("./embedding-worker.js", import.meta.url), { type: "module" }); // ESM module worker（import 加载 transformers 单文件 ESM）
    _embedWorker.onmessage = (e) => {
        const { id, type, data } = e.data || {};
        if (type === "ready" || type === "progress") return; // warmup / 进度消息，无 pending
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

// 主动预热（init 时调用）：让 worker 后台加载模型，玩家首次语义检索即命中、不卡
export function warmupEmbeddingWorker() {
    try {
        getEmbedWorker().postMessage({ id: ++_embedReqId, type: "warmup" });
    } catch (e) { /* Worker 不可用（如 Node 测试环境），忽略，运行时回落主线程 */ }
}

export function getWorldLoreKB() {
    // ★ B7：优先使用当前存档的独立知识库副本（不污染 world 出厂默认）
    return S.activeLoreKB || (S.currentWorld && S.currentWorld.lore_kb) || S.loreKB;
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

export async function embeddingRetrieve(input, topK = 5) {
    const kb = getWorldLoreKB();
    if (!kb || !kb.snippets || !kb.snippets.length) return [];
    // AI 生成世界 / 老存档未预计算向量时，先尝试补算（一次性，之后命中 sn[0].embedding 即跳过）
    if (kb.snippets.some(s => !Array.isArray(s.embedding) || !s.embedding.length)) {
        try { await ensureLoreEmbeddings(kb); } catch (e) { /* 降级为关键词 */ }
    }
    const embeddedSnippets = kb.snippets.filter(s => Array.isArray(s.embedding) && s.embedding.length);
    if (!embeddedSnippets.length) return [];
    let qVec;
    try {
        qVec = await computeEmbedding(input, true); // 查询句加 bge 检索前缀
    } catch (e) {
        console.warn("查询向量计算失败", e);
        return [];
    }
    // ★ Phase 1：优先走 ANN 索引（O(log n)）；任何失败回落 O(n) 兜底（行为完全一致）
    const worldId = (S.currentWorld && S.currentWorld.id) || "default";
    let scored;
    try {
        const idx = await getLoreAnnIndex(kb, worldId, { dim: EMBED_DIM });
        scored = idx.search(qVec, topK * 2); // 多取一些，后续加权/门禁再筛
    } catch (e) {
        scored = embeddingRetrieveBruteforce(embeddedSnippets, qVec, topK);
    }
    return scored.slice(0, topK);
}

export async function computeEmbedding(text, isQuery = false) {
    // ★ P0-3-E：优先走 Web Worker（不卡 UI）；任何失败回落主线程
    try {
        return await embedViaWorker(text, isQuery);
    } catch (e) {
        console.warn("Worker 向量计算失败，回落主线程:", e && e.message);
    }
    // 主线程回落（需 window.transformers）
    if (typeof window.transformers === "undefined") throw new Error("transformers 不可用");
    if (!S.embeddingModel) {
        S.embeddingModel = await window.transformers.pipeline("feature-extraction", EMBED_MODEL);
    }
    const input = isQuery ? BGE_QUERY_PREFIX + text : text;
    const out = await S.embeddingModel(input, { pooling: "mean", normalize: true });
    return Array.from(out.data);
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
export async function selectTimelineSlice(snippet, input, qVec) {
    const tl = snippet.timeline;
    if (!Array.isArray(tl) || !tl.length) return snippet;
    const orderOf = (t) => (typeof t.order === "number" ? t.order : 1);
    // ① 单向门禁：只保留 order ≤ 当前故事进度的阶段（未发生的未来一律不注入，避免剧透）
    const progress = (S.gameState && typeof S.gameState.story_progress === "number") ? S.gameState.story_progress : 1;
    const unlocked = tl.filter((t) => orderOf(t) <= progress);
    if (!unlocked.length) return snippet; // 连最早阶段都未解锁（异常）→ 不注入 timeline，保留原 content
    const textOf = (t) => ((t.location || "") + " " + (t.summary || "")); // 不含 phase，避免章节字混入匹配
    // ② 关键词匹配（零成本，始终可用）——仅在已解锁片段内
    const terms = segmentChinese(input || "");
    const kwMatched = [];
    for (const t of unlocked) {
        const text = textOf(t).toLowerCase();
        let hit = 0;
        for (const term of terms) if (text.includes(term)) hit++;
        if (hit > 0) kwMatched.push({ t, hit });
    }
    // 语义匹配（向量可用时增强）——仅在已解锁片段内
    let chosen = null;
    if (qVec && (typeof window !== "undefined" && (typeof window.transformers !== "undefined" || typeof Worker !== "undefined"))) {
        try {
            const scored = [];
            for (const t of unlocked) {
                const tv = await computeEmbedding(textOf(t), false);
                scored.push({ t, sim: cosineSimilarity(qVec, tv) });
            }
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
    // P1#2：小知识库（全文已注入 system）无需每轮跑 embedding 推理 + 关键词向量检索——
    // 那段知识在 buildTurnUserMessage 里不会进入 user 消息，纯属浪费（手机端尤卡）。
    // 仅保留行为记录召回（仍是按相关度），因为它独立于 lore 注入、本就服务于"关键事实"区块。
    if (isLoreFullInSystem()) {
        const behavior = await retrieveBehaviorRecords(input, 3);
        return behavior.map(b => ({
            id: "behavior_" + b.id, category: "行为记录", title: "关键事实",
            content: b.text, kw: 1.5, emb: 0
        }));
    }

    // ★ P1.2.3: 向量模型未加载时给出一次性可见提示（而非静默降级），便于排查
    if (typeof window.transformers === "undefined" && !S.vectorUnavailableWarned) {
        S.vectorUnavailableWarned = true;
        showToast("向量模型未加载，已降级为关键词检索（检查网络或 transformers.js 是否加载）", "warn");
    }

    // RAG 并行化：关键词检索和向量检索同时进行
    const [keyword, embedding] = await Promise.all([
        Promise.resolve(keywordRetrieve(input, 7)),
        embeddingRetrieve(input, 7)
    ]);
    // 缓存查询向量，供时间线切片做语义匹配（向量可用时；兜底不影响主流程）
    let qVec = null;
    try {
        if (typeof window !== "undefined" && (typeof window.transformers !== "undefined" || typeof Worker !== "undefined")) {
            qVec = await computeEmbedding(input, true); // 查询句加 bge 检索前缀
        }
    } catch (e) { qVec = null; }

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

    // 加入玩家行为记录
    const behavior = await retrieveBehaviorRecords(input, 3);
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
    for (let i = 0; i < out.length; i++) {
        const s = out[i];
        if (String(s.id).startsWith("behavior_")) continue;
        if (s.timeline && s.timeline.length) {
            out[i] = await selectTimelineSlice(s, input, qVec);
        }
    }

    return out;
}

export async function retrieveBehaviorRecords(input, topK = 3) {
    const records = Array.isArray(S.activeBehaviorRecords) ? S.activeBehaviorRecords : [];
    if (!records.length) return [];

    // ★ C4：向量语义检索优先（"黛玉病了"→"黛玉咳血"），关键词兜底
    const terms = segmentChinese(input);
    let useVector = false;
    let qVec = null;
    try {
        if (typeof window.transformers !== "undefined" && terms.length > 0) {
            qVec = await computeEmbedding(input, true); // 查询句加 bge 检索前缀
            useVector = true;
            // 后台补算未计算的记忆 embedding
            ensureBehaviorEmbeddings();
        }
    } catch (e) { /* 向量不可用，降级关键词 */ }

    const scored = records.map(b => {
        let score = 0;
        if (useVector && b.embedding && qVec) {
            score = cosineSimilarity(qVec, b.embedding) * 5; // 余弦相似度放大到与关键词可比
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
        list.push({
            id: "b" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now() + Math.random().toString(36).slice(2, 6)),
            text,
            importance: imp,
            pinned: !!fact.pinned,
            type,
            time: fact.time || timeLabel,
            location: fact.location || locLabel,
            npcs: Array.isArray(fact.npcs) ? fact.npcs.slice(0, 8) : [],
            embedding: null,  // C4：向量暂时留空，由 ensureBehaviorEmbeddings 后台异步补算；关键词检索在此期间兜底
            createdAt: new Date().toISOString()
        });
    }
    if (list.length > 100) S.activeBehaviorRecords = list.slice(-100);
}

// ★ C4：后台异步补算所有行为记忆的向量 embedding（"黛玉病了"→"黛玉咳血" 语义匹配）
export async function ensureBehaviorEmbeddings() {
    if (typeof window.transformers === "undefined" && typeof Worker === "undefined") return;
    const records = S.activeBehaviorRecords;
    if (!records || !records.length) return;
    for (const r of records) {
        // ★ P0-3 维度打标：模型/维度一致才跳过，否则重算
        if (r.embedding && r.embedDim === EMBED_DIM && r.embedModel === EMBED_MODEL) continue;
        try {
            r.embedding = await computeEmbedding(r.text); // 记忆文本作为文档，不加查询前缀
            r.embedDim = EMBED_DIM;
            r.embedModel = EMBED_MODEL;
        } catch (e) { /* 单条失败不阻塞其余 */ }
    }
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
