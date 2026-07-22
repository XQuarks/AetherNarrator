// P1 优化回归：查询句向量整回合只算一次
// 锁定 embeddingRetrieve / retrieveBehaviorRecords / retrieve 的「可选 qVec 参数复用」契约——
// 传入已算好的查询向量时应直接复用（不重算 computeEmbedding），缺失时再自行计算兜底。
// 防止未来有人把复用去掉，导致同一回合对同一 input 重复算向量（Worker 往返重）。
import test from "node:test";
import assert from "node:assert/strict";
import { embeddingRetrieve, retrieveBehaviorRecords, EMBED_DIM } from "../src/rag.js";
import { S } from "../src/store.js";

// 构造 EMBED_DIM 维向量，hotIndex 处置高值（用于制造相似/不相似）
function vec(hotIndex) {
    const v = new Array(EMBED_DIM).fill(0.01);
    if (hotIndex != null) v[hotIndex] = 0.9;
    return v;
}

function setBehaviorRecords(records) { S.activeBehaviorRecords = records; }
function setLoreKB(snippets) { S.activeLoreKB = { snippets }; }

// 临时注入全局环境（绕过浏览器专属的 window/Worker 早返回检测），结束还原避免污染其它测试
function withEnv(fn) {
    const savedWin = global.window, savedWorker = global.Worker;
    global.window = { transformers: {} };
    global.Worker = class {};
    try { return fn(); } finally {
        global.window = savedWin;
        global.Worker = savedWorker;
    }
}

test("P1 行为记忆：传入 qVec 时复用，向量语义匹配生效（不重算）", async () => {
    setBehaviorRecords([
        { id: "b1", text: "黛玉在潇湘馆咳血", embedding: vec(0), importance: 3 },
        { id: "b2", text: "宝钗在蘅芜苑扑蝶", embedding: vec(1), importance: 3 },
    ]);
    const fakeQVec = vec(0); // 与 b1 高度相似
    const out = await withEnv(() => retrieveBehaviorRecords("黛玉", 3, fakeQVec));
    assert.ok(out.length > 0, "应召回行为记忆");
    assert.strictEqual(out[0].id, "b1", "向量语义最相似的记忆应排在最前");
});

test("P1 行为记忆：不传 qVec 时无模型环境降级为关键词，不崩", async () => {
    setBehaviorRecords([
        { id: "b1", text: "魔法石被毁", embedding: null, importance: 3 },
        { id: "b2", text: "密室被开启", embedding: null, importance: 3 },
    ]);
    const out = await withEnv(() => retrieveBehaviorRecords("魔法石", 3)); // 无模型 → 关键词兜底
    assert.ok(out.some(b => b.id === "b1"), "关键词命中项应被召回");
});

test("P1 向量检索：传入 qVec 时复用，返回最相似片段（不重算）", async () => {
    setLoreKB([
        { id: "s1", category: "loc", title: "潇湘馆", content: "黛玉居所", activation_keys: [], embedding: vec(0) },
        { id: "s2", category: "loc", title: "蘅芜苑", content: "宝钗居所", activation_keys: [], embedding: vec(1) },
    ]);
    const fakeQVec = vec(0); // 与 s1 高度相似
    const out = await withEnv(() => embeddingRetrieve("潇湘馆", 3, fakeQVec));
    assert.ok(out.length > 0, "应召回知识片段");
    assert.ok(out.some(r => r.snippet && r.snippet.id === "s1"), "最相似片段应被召回");
});

test("P1 向量检索：不传 qVec 时无模型环境优雅降级（返回空，不抛）", async () => {
    setLoreKB([
        { id: "s1", category: "loc", title: "潇湘馆", content: "黛玉居所", activation_keys: [], embedding: vec(0) },
    ]);
    // 不传 qVec（null）→ 内部应自行计算；node 无模型会失败并被 catch 降级，不应抛错
    let threw = false;
    let out;
    try { out = await withEnv(() => embeddingRetrieve("潇湘馆", 3)); } catch (e) { threw = true; }
    assert.strictEqual(threw, false, "无模型环境下应优雅降级而非抛错");
    assert.ok(Array.isArray(out), "应返回数组");
});
