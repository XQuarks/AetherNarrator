// ============================================================
// AetherNarrator · rag.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";

import { cosineSimilarity, isFuzzyFact, normFact } from "./utils.js";
import { saveWorlds } from "./storage.js";
import { buildTurnUserMessage, isLoreFullInSystem } from "./prompt.js";
import { showToast } from "./render.js";

export function getWorldLoreKB() {
    return (S.currentWorld && S.currentWorld.lore_kb) || S.loreKB;
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
    if (!kb.snippets[0].embedding) {
        try { await ensureLoreEmbeddings(kb); } catch (e) { /* 降级为关键词 */ }
    }
    if (!kb.snippets[0] || !kb.snippets[0].embedding) return [];
    if (!S.embeddingModel) {
        try {
            S.embeddingModel = await window.transformers.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
        } catch (e) {
            console.warn("Embedding model load failed", e);
            return [];
        }
    }
    const out = await S.embeddingModel(input, { pooling: "mean", normalize: true });
    const qVec = Array.from(out.data);
    const scored = kb.snippets.map(s => {
        const sim = cosineSimilarity(qVec, s.embedding);
        return { snippet: s, embScore: sim };
    }).sort((a, b) => b.embScore - a.embScore).slice(0, topK);
    return scored;
}

export async function computeEmbedding(text) {
    if (typeof window.transformers === "undefined") throw new Error("transformers 不可用");
    if (!S.embeddingModel) {
        S.embeddingModel = await window.transformers.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    const out = await S.embeddingModel(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
}

export async function ensureLoreEmbeddings(kb) {
    if (!kb || !kb.snippets || !kb.snippets.length) return;
    if (kb.snippets[0].embedding) return; // 已有向量，跳过
    if (typeof window.transformers === "undefined") return; // 环境不支持，降级为关键词
    for (const s of kb.snippets) {
        if (s.embedding) continue;
        const text = [s.category, s.title, s.content, (s.keywords || []).join(" ")].filter(Boolean).join(" ");
        try {
            s.embedding = await computeEmbedding(text);
        } catch (e) {
            console.warn("知识库片段向量计算失败:", e.message);
            return; // 一旦模型不可用，剩余片段也不再尝试
        }
    }
}

export async function retrieve(input) {
    // P1#2：小知识库（全文已注入 system）无需每轮跑 embedding 推理 + 关键词向量检索——
    // 那段知识在 buildTurnUserMessage 里不会进入 user 消息，纯属浪费（手机端尤卡）。
    // 仅保留行为记录召回（仍是按相关度），因为它独立于 lore 注入、本就服务于"关键事实"区块。
    if (isLoreFullInSystem()) {
        const behavior = retrieveBehaviorRecords(input, 3);
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
    const behavior = retrieveBehaviorRecords(input, 3);
    for (const b of behavior) {
        merged.set("behavior_" + b.id, { snippet: { id: "behavior_" + b.id, category: "行为记录", title: "关键事实", content: b.text }, kw: 1.5, emb: 0 });
    }

    return Array.from(merged.values())
        .map(x => ({ ...x.snippet, score: KW_W * (x.kw || 0) + EMB_W * (x.emb || 0) }))
        .sort((a, b) => b.score - a.score).slice(0, 8);
}

export function retrieveBehaviorRecords(input, topK = 3) {
    if (!S.currentWorld || !S.currentWorld.behavior_records) return [];
    const terms = segmentChinese(input);
    if (!terms.length) return [];
    const scored = S.currentWorld.behavior_records.map(b => {
        let score = 0;
        const text = b.text.toLowerCase();
        for (const t of terms) if (text.includes(t)) score += 1;
        return { ...b, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
    return scored;
}

export function addBehaviorRecords(facts) {
    if (!S.currentWorld || !facts || !facts.length) return;
    if (!S.currentWorld.behavior_records) S.currentWorld.behavior_records = [];
    const list = S.currentWorld.behavior_records;
    for (const text of facts) {
        if (!text) continue;
        if (isFuzzyFact(text)) continue;                       // 过滤空话，不入记忆
        const n = normFact(text);
        if (list.some(b => normFact(b.text) === n)) continue;  // 近似去重，避免重复灌满
        list.push({
            id: "b" + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Date.now() + Math.random().toString(36).slice(2, 6)),
            text,
            createdAt: new Date().toISOString()
        });
    }
    // 限制数量，避免无限增长
    if (list.length > 100) S.currentWorld.behavior_records = list.slice(-100);
    saveWorlds();
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
        for (const e of changes.completed_events) facts.push(`玩家完成了事件：${e}`);
    }
    if (changes && changes.current_location) facts.push(`玩家前往/到达了 ${changes.current_location}`);
    if (changes && changes.progression && changes.progression.rank) facts.push(`玩家的境界/等级发生了变化：${changes.progression.rank}`);
    return facts.slice(0, 5);
}
