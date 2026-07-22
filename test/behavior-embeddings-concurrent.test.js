// P0 优化回归：行为记忆向量补算并发化
// 锁定 ensureBehaviorEmbeddings 的「已算跳过 + 并发补算 + 模型变更重算」行为，
// 验证最坏 100 条记忆不再逐条串行 Worker 往返（仿 ensureLoreEmbeddings 的 runPool 机制）。
import test from "node:test";
import assert from "node:assert/strict";
import { ensureBehaviorEmbeddings, EMBED_MODEL, EMBED_DIM } from "../src/rag.js";
import { S } from "../src/store.js";

// 临时注入全局环境（绕过 ensureBehaviorEmbeddings 的早返回检测），结束还原避免污染其它测试
function withEnv(fn) {
    const savedWin = global.window, savedWorker = global.Worker;
    global.window = { transformers: {} };
    global.Worker = class {};
    try { return fn(); } finally {
        global.window = savedWin;
        global.Worker = savedWorker;
    }
}

test("P0 行为记忆：已含正确模型向量时跳过补算，仅补算缺失项", async () => {
    let calls = 0;
    const embedFn = async () => { calls++; return [0.1, 0.2, 0.3]; };
    S.activeBehaviorRecords = [
        { text: "黛玉咳血", embedding: [0.9, 0.8, 0.7], embedDim: EMBED_DIM, embedModel: EMBED_MODEL },
        { text: "宝玉挨打", embedding: null, embedDim: 0, embedModel: null },
    ];
    await withEnv(() => ensureBehaviorEmbeddings(embedFn));
    assert.strictEqual(calls, 1, "仅缺失向量的记忆应被补算一次");
    assert.deepEqual(S.activeBehaviorRecords[0].embedding, [0.9, 0.8, 0.7], "已算记忆不应被覆盖");
    assert.ok(Array.isArray(S.activeBehaviorRecords[1].embedding) && S.activeBehaviorRecords[1].embedding.length === 3, "缺失记忆应被补算");
});

test("P0 行为记忆：模型不一致时重新计算", async () => {
    let calls = 0;
    const embedFn = async () => { calls++; return [0.4, 0.5]; };
    S.activeBehaviorRecords = [
        { text: "旧模型记忆", embedding: [0.1], embedDim: 1, embedModel: "old/model" },
    ];
    await withEnv(() => ensureBehaviorEmbeddings(embedFn));
    assert.strictEqual(calls, 1, "模型不一致的记忆应被重新计算");
    assert.strictEqual(S.activeBehaviorRecords[0].embedModel, EMBED_MODEL, "重算后应刷新为当前模型");
});

test("P0 行为记忆：空列表直接返回不崩", async () => {
    S.activeBehaviorRecords = [];
    let calls = 0;
    await withEnv(() => ensureBehaviorEmbeddings(async () => { calls++; return []; }));
    assert.strictEqual(calls, 0);
});

test("P0 行为记忆：多条缺失时并发补算（非逐条串行）", async () => {
    let inflight = 0, maxInflight = 0;
    const embedFn = async () => {
        inflight++; maxInflight = Math.max(maxInflight, inflight);
        await new Promise(r => setTimeout(r, 10));
        inflight--;
        return [0.0, 1.0];
    };
    S.activeBehaviorRecords = Array.from({ length: 10 }, (_, i) => ({
        text: "记忆" + i, embedding: null, embedDim: 0, embedModel: null,
    }));
    await withEnv(() => ensureBehaviorEmbeddings(embedFn));
    assert.ok(maxInflight > 1, "多条缺失记忆应并发补算，而非逐条串行（maxInflight=" + maxInflight + "）");
    const allComputed = S.activeBehaviorRecords.every(r => Array.isArray(r.embedding) && r.embedding.length === 2);
    assert.ok(allComputed, "全部 10 条记忆都应被补算");
});
