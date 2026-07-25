// P0 时间线向量并发回归：把本轮所有命中条目的「已解锁」时间线阶段向量合并成一次批量推理
// （一次 forward pass 远快于逐段串行 Worker 往返），再并发做各条时间线切片筛选。
// 锁定：① 单向门禁（只注入已解锁阶段，屏蔽未来）② 批量只算一次、已缓存段跳过 ③ 批量失败逐段回落不崩
// ④ selectTimelineSlice 语义/关键词选取正确 ⑤ retrieve 端到端并发切片不崩且产出已知经历。
import test from "node:test";
import assert from "node:assert/strict";
import {
    retrieve,
    unlockedTimelineSegments,
    embedTimelineSegmentsBatch,
    selectTimelineSlice,
    EMBED_MODEL,
    EMBED_DIM,
} from "../src/rag.js";
import { S } from "../src/store.js";

// 临时注入全局环境（绕过浏览器专属的 window/Worker 早返回检测），结束还原避免污染其它测试
async function withEnv(fn) {
    const savedWin = global.window, savedWorker = global.Worker;
    global.window = { transformers: {} };
    global.Worker = class {};
    try { return await fn(); } finally {
        global.window = savedWin;
        global.Worker = savedWorker;
    }
}

function resetState() {
    S.activeLoreKB = null;
    S.activeBehaviorRecords = [];
    S.gameState = { story_progress: 2 };
    S._zhSegmenter = null;
}

// ---------- 单向门禁 ----------
test("unlockedTimelineSegments：按 story_progress 屏蔽未来阶段", () => {
    S.gameState = { story_progress: 2 };
    const snip = { timeline: [
        { order: 1, location: "a", summary: "x" },
        { order: 2, location: "b", summary: "y" },
        { order: 3, location: "c", summary: "z" },
    ] };
    const u = unlockedTimelineSegments(snip);
    assert.strictEqual(u.length, 2);
    assert.strictEqual(u[0].location, "a");
    assert.strictEqual(u[1].location, "b");
});

test("unlockedTimelineSegments：无 timeline / 空 → 空数组", () => {
    S.gameState = { story_progress: 5 };
    assert.deepEqual(unlockedTimelineSegments({ timeline: [] }), []);
    assert.deepEqual(unlockedTimelineSegments({}), []);
});

// ---------- 批量向量化 ----------
test("embedTimelineSegmentsBatch：整批只调用一次批量推理，并缓存在段上", async () => {
    let calls = 0;
    const mockBatch = async (texts) => {
        calls++;
        return texts.map(() => [0.1, 0.2, 0.3]);
    };
    const segs = [
        { order: 1, location: "北京", summary: "初到" },
        { order: 2, location: "上海", summary: "相遇" },
    ];
    await embedTimelineSegmentsBatch(segs, mockBatch);
    assert.strictEqual(calls, 1, "整批应只调用一次批量推理");
    assert.ok(Array.isArray(segs[0].embedding) && segs[0].embedding.length === 3);
    assert.strictEqual(segs[0].embedModel, EMBED_MODEL);
    assert.strictEqual(segs[0].embedDim, EMBED_DIM);
    assert.ok(Array.isArray(segs[1].embedding) && segs[1].embedding.length === 3);
});

test("embedTimelineSegmentsBatch：已缓存段跳过、不重复计算、不被覆盖", async () => {
    let calls = 0;
    const mockBatch = async (texts) => { calls++; return texts.map(() => [0.5, 0.5]); };
    const cached = { order: 1, location: "广州", summary: "旧向量", embedding: [9, 9], embedModel: EMBED_MODEL, embedDim: EMBED_DIM };
    const fresh = { order: 2, location: "深圳", summary: "新向量" };
    await embedTimelineSegmentsBatch([cached, fresh], mockBatch);
    assert.strictEqual(calls, 1, "已缓存段不应进入批量请求");
    assert.deepEqual(cached.embedding, [9, 9], "已缓存段向量不应被覆盖");
    assert.ok(Array.isArray(fresh.embedding) && fresh.embedding.length === 2);
});

test("embedTimelineSegmentsBatch：批量失败不向上抛错（逐段回落被捕获）", async () => {
    const mockBatch = async () => { throw new Error("boom"); };
    const segs = [{ order: 1, location: "x", summary: "y" }];
    let threw = false;
    try { await embedTimelineSegmentsBatch(segs, mockBatch); } catch (e) { threw = true; }
    assert.strictEqual(threw, false, "批量失败应被捕获、不向上抛错");
});

// ---------- 时间线切片选取（段向量已缓存，纯 CPU） ----------
test("selectTimelineSlice：语义匹配只取最相关的已解锁阶段（非兜底全量）", async () => {
    await withEnv(async () => {
        // 4 个阶段全部已解锁（progress=4）；qVec 只与「边城」段最相似。
        // 若走语义排序（top 3）则只取 边城+新手村+京都，应排除 皇宫；
        // 若错误地走「兜底全量已解锁」则会把 皇宫 也塞进来 —— 用皇宫缺席来证明走的是语义分支。
        S.gameState = { story_progress: 4 };
        const segs = [
            { order: 1, location: "新手村", summary: "初入江湖", embedding: [1,0,0,0], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
            { order: 2, location: "京都", summary: "风波渐起", embedding: [0,1,0,0], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
            { order: 3, location: "边城", summary: "古道西风", embedding: [0,0,1,0], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
            { order: 4, location: "皇宫", summary: "最终决战", embedding: [0,0,0,1], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
        ];
        const snip = { id: "tlx", category: "story", title: "成长", content: "主线", timeline: segs };
        const q = [0,0,1,0]; // 与「边城」段最相似
        const out = await selectTimelineSlice(snip, "zzzquery", q);
        assert.ok(out.content.includes("边城"), "最相似阶段应被选中");
        assert.ok(out.content.includes("【已知经历"), "应带已知经历前缀");
        assert.ok(!out.content.includes("皇宫"), "语义排序只取 top3，最不相似的阶段应被排除（证明走语义而非兜底全量）");
    });
});

test("selectTimelineSlice：无 qVec 时按关键词匹配（段向量缓存不影响关键词）", async () => {
    S._zhSegmenter = false; // 关闭分词器，走整块关键词匹配，避免 Intl.Segmenter 行为差异
    S.gameState = { story_progress: 3 };
    const segs = [
        { order: 1, location: "雪山", summary: "修炼寒冰诀", embedding: [1,0], embedDim: 2, embedModel: EMBED_MODEL },
        { order: 2, location: "火山", summary: "熔岩秘境试炼", embedding: [0,1], embedDim: 2, embedModel: EMBED_MODEL },
    ];
    const snip = { id: "tly", timeline: segs };
    const out = await selectTimelineSlice(snip, "熔岩秘境", null); // qVec=null → 关键词
    assert.ok(out.content.includes("火山"), "关键词命中阶段应被选中");
    assert.ok(out.content.includes("熔岩秘境"), "应保留命中阶段要点");
    assert.ok(!out.content.includes("雪山"), "未命中阶段不应入选");
});

// ---------- retrieve 端到端并发切片 ----------
test("retrieve：时间线向量并发——批量+并发切片端到端不崩且产出已知经历", async () => {
    resetState();
    // 大知识库（>12000字）走 RAG 路径；时间线段提前缓存向量，批量路径直接跳过、并发切片用缓存
    const loreText = "世界观设定".repeat(3000); // >12000 字，确保 isLoreFullInSystem 返回 false 走 RAG
    const segs = [
        { order: 1, location: "新手村", summary: "初入江湖", embedding: [1,0,0,0,0,0,0,0], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
        { order: 2, location: "京都", summary: "风波渐起", embedding: [0,1,0,0,0,0,0,0], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
        { order: 3, location: "皇宫", summary: "最终决战", embedding: [0,0,1,0,0,0,0,0], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
    ];
    S.activeLoreKB = { snippets: [
        // s1 仅用于把知识库撑到 >12000 字以走 RAG 路径；用不匹配的 activation_keys 使其不被触发，避免占满预算把 tl1 裁掉
        { id: "s1", category: "loc", title: "常驻地", content: loreText, activation_keys: ["zzz_no_match_keyword"], embedding: [0,0,0,0,0,0,0,0], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
        { id: "tl1", category: "story", title: "成长线", content: "主线剧情内容", activation_keys: [], embedding: [0,0,0,0,0,0,0,1], embedDim: EMBED_DIM, embedModel: EMBED_MODEL, trigger_mode: "always", timeline: segs },
    ] };
    S.gameState = { story_progress: 2, current_location: "x", current_date: { year: 1, month: 1, date: 1, period: "morning" } };
    S._zhSegmenter = false;

    const result = await withEnv(() => retrieve("测试输入"));
    assert.ok(Array.isArray(result), "retrieve 应返回数组");
    const tl = result.find(r => r.id === "tl1");
    assert.ok(tl, "带 timeline 的片段应出现在召回结果中");
    assert.ok(tl.content.includes("【已知经历"), "应注入「已知经历」时间线切片");
    assert.ok(tl.content.includes("新手村"), "已解锁阶段应出现");
    assert.ok(!tl.content.includes("皇宫"), "未解锁的未来阶段(order3)应被门禁屏蔽");
    resetState();
});
