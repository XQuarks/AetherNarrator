// P0 优化回归：时间线分段向量缓存
// 锁定 embedTimelineSegment 的「同段只算一次 + 并发去重 + 模型变更重算」行为，
// 验证每条时间线知识不再每回合现算整段向量（最坏数十次串行 Worker 往返）。
import test from "node:test";
import assert from "node:assert/strict";
import { embedTimelineSegment, EMBED_MODEL, EMBED_DIM } from "../src/rag.js";

// ---------- 缓存复用 ----------
test("P0 时间线段向量：同一分段跨多次调用只算一次", async () => {
    let calls = 0;
    const mockEmbed = async () => { calls++; return [0.1, 0.2, 0.3]; };
    const seg = { order: 1, location: "北京", summary: "主角初到京城" };
    const v1 = await embedTimelineSegment(seg, mockEmbed);
    const v2 = await embedTimelineSegment(seg, mockEmbed);
    assert.strictEqual(calls, 1, "同一分段不应重复计算向量");
    assert.deepEqual(v1, v2);
    assert.ok(Array.isArray(seg.embedding) && seg.embedding.length === 3, "向量应缓存在段对象上");
    assert.strictEqual(seg.embedModel, EMBED_MODEL, "应打上当前模型标记");
    assert.strictEqual(seg.embedDim, EMBED_DIM, "应打上当前维度标记");
});

// ---------- 并发去重 ----------
test("P0 时间线段向量：并发调用同一分段只触发一次计算", async () => {
    let inflight = 0, maxInflight = 0;
    const mockEmbed = async () => {
        inflight++; maxInflight = Math.max(maxInflight, inflight);
        await new Promise(r => setTimeout(r, 8));
        inflight--;
        return [0.9];
    };
    const seg = { order: 2, location: "上海", summary: "外滩相遇" };
    const [a, b] = await Promise.all([
        embedTimelineSegment(seg, mockEmbed),
        embedTimelineSegment(seg, mockEmbed),
    ]);
    assert.strictEqual(maxInflight, 1, "并发调用同一分段只应触发一次计算（去重）");
    assert.deepEqual(a, b);
});

// ---------- 模型/维度变更后重算 ----------
test("P0 时间线段向量：模型不一致时重新计算", async () => {
    let calls = 0;
    const mockEmbed = async () => { calls++; return [0.4, 0.5]; };
    const seg = { order: 3, location: "广州", summary: "码头暗号" };
    await embedTimelineSegment(seg, mockEmbed);
    assert.strictEqual(calls, 1);
    // 模拟模型已切换（段上记录的 embedModel 与当前不一致）
    seg.embedModel = "old/embedding-model";
    const v2 = await embedTimelineSegment(seg, mockEmbed);
    assert.strictEqual(calls, 2, "模型不一致应重新计算");
    assert.deepEqual(v2, [0.4, 0.5]);
    assert.strictEqual(seg.embedModel, EMBED_MODEL, "重算后应刷新为当前模型");
});

// ---------- 空文本兜底不崩 ----------
test("P0 时间线段向量：无地点无要点时不崩", async () => {
    let calls = 0;
    const mockEmbed = async (text) => { calls++; assert.strictEqual(text, " "); return [0.0]; };
    const seg = { order: 4 };
    const v = await embedTimelineSegment(seg, mockEmbed);
    assert.deepEqual(v, [0.0]);
    assert.strictEqual(calls, 1);
});
