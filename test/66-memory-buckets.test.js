// ★ 66 · 记忆三分型（借鉴 WorldLines soul 长期记忆分型）
// 覆盖：inferBucket 兜底规则 / addBehaviorRecords 落槽与 emotional 元数据 /
//      prompt 三分段注入 / 记忆包 bucket 保留与合并不降级
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
};
globalThis.window = globalThis;

const { S } = await import("../src/store.js");
const { addBehaviorRecords, inferBucket } = await import("../src/rag.js");
const { buildMemoryInjection } = await import("../src/prompt.js");
const { createMemoryPack, mergeMemoryPack } = await import("../src/memory-transfer.js");

function resetRuntime() {
    storage.clear();
    S.currentWorld = { id: "w1", behavior_records: [] };
    S.activeBehaviorRecords = [];
    S.gameState = { current_date: { day: 1, period: "morning" }, current_location: "庭院" };
}

// ===== inferBucket 兜底规则 =====
test("inferBucket：显式合法 bucket 优先", () => {
    assert.equal(inferBucket({ bucket: "emotional" }), "emotional");
    assert.equal(inferBucket({ bucket: "important_event" }), "important_event");
    assert.equal(inferBucket({ bucket: "learned_fact" }), "learned_fact");
});

test("inferBucket：type=event 或 importance>=4 归重要事件", () => {
    assert.equal(inferBucket({ type: "event" }), "important_event");
    assert.equal(inferBucket({ importance: 5 }), "important_event");
    assert.equal(inferBucket({ importance: 4, type: "item" }), "important_event");
});

test("inferBucket：默认与非法值归学到的知识", () => {
    assert.equal(inferBucket({}), "learned_fact");
    assert.equal(inferBucket({ bucket: "nonsense" }), "learned_fact");
    assert.equal(inferBucket({ importance: 3, type: "relationship" }), "learned_fact");
});

// ===== addBehaviorRecords 落槽 =====
test("addBehaviorRecords：对象元素带 bucket 落槽，字符串元素兜底", () => {
    resetRuntime();
    addBehaviorRecords([
        { text: "女巫说出身世时，玩家感到被信任", bucket: "emotional", target: "女巫", intensity: 0.8 },
        { text: "世界时限「血月之夜」已到", bucket: "important_event", importance: 5 },
        { text: "玩家获得符文钥匙", bucket: "learned_fact" },
        "旧式字符串事实"
    ]);
    assert.equal(S.activeBehaviorRecords.length, 4);
    const emotional = S.activeBehaviorRecords.find(r => r.bucket === "emotional");
    assert.ok(emotional, "emotional 记忆应存在");
    assert.equal(emotional.target, "女巫");
    assert.equal(emotional.intensity, 0.8);
    const str = S.activeBehaviorRecords.find(r => r.text === "旧式字符串事实");
    assert.equal(str.bucket, "learned_fact", "字符串元素应兜底为 learned_fact");
});

test("addBehaviorRecords：无 bucket 按 type/importance 推断", () => {
    resetRuntime();
    addBehaviorRecords([
        { text: "第一夜钟楼巨响", type: "event" },
        { text: "目标失败", importance: 4 },
        { text: "普通物品", type: "item", importance: 2 }
    ]);
    const important = S.activeBehaviorRecords.filter(r => r.bucket === "important_event").map(r => r.text).sort();
    assert.deepEqual(important, ["目标失败", "第一夜钟楼巨响"], "type=event 与 importance>=4 均归重要事件");
    const item = S.activeBehaviorRecords.find(r => r.text === "普通物品");
    assert.equal(item.bucket, "learned_fact");
});

test("addBehaviorRecords：emotional 强度钳制在 0~1，越界修正", () => {
    resetRuntime();
    addBehaviorRecords([{ text: "极度震惊", bucket: "emotional", intensity: 3.5 }]);
    assert.equal(S.activeBehaviorRecords[0].intensity, 1);
    addBehaviorRecords([{ text: "轻微情绪", bucket: "emotional", intensity: -1 }]);
    assert.equal(S.activeBehaviorRecords[1].intensity, 0);
});

test("addBehaviorRecords：emotional 无 target 时不写 target 字段", () => {
    resetRuntime();
    addBehaviorRecords([{ text: "莫名的怀旧感", bucket: "emotional" }]);
    assert.equal("target" in S.activeBehaviorRecords[0], false);
});

// ===== prompt 三分段注入 =====
test("buildMemoryInjection：三类记忆分组输出", () => {
    resetRuntime();
    S.activeBehaviorRecords = [
        { id: "e1", text: "对林晚照产生信任", bucket: "emotional", importance: 4, pinned: false, type: "relationship" },
        { id: "v1", text: "血月之夜时限已到", bucket: "important_event", importance: 5, pinned: false, type: "event" },
        { id: "f1", text: "雾港电力靠潮汐电塔", bucket: "learned_fact", importance: 3, pinned: false, type: "discovery" }
    ];
    const block = buildMemoryInjection([]);
    assert.ok(block.includes("【情感记忆】"), "应含情感记忆段");
    assert.ok(block.includes("【重要事件】"), "应含重要事件段");
    assert.ok(block.includes("【学到的知识】"), "应含知识段");
    assert.ok(block.includes("对林晚照产生信任"));
    assert.ok(block.includes("血月之夜时限已到"));
    assert.ok(block.includes("雾港电力靠潮汐电塔"));
});

test("buildMemoryInjection：空段不输出，空记忆返回空串", () => {
    resetRuntime();
    S.activeBehaviorRecords = [{ id: "v1", text: "只有事件", bucket: "important_event", importance: 5, pinned: false }];
    const block = buildMemoryInjection([]);
    assert.ok(!block.includes("【情感记忆】"), "无情感记忆时不输出该段");
    assert.ok(!block.includes("【学到的知识】"), "无知识时不输出该段");
    assert.ok(block.includes("【重要事件】"));

    S.activeBehaviorRecords = [];
    assert.equal(buildMemoryInjection([]), "", "空记忆应返回空串");
});

test("buildMemoryInjection：每段最多 maxPerBucket 条", () => {
    resetRuntime();
    S.activeBehaviorRecords = Array.from({ length: 10 }, (_, i) => ({
        id: "f" + i, text: "知识" + i, bucket: "learned_fact", importance: 3, pinned: false
    }));
    const block = buildMemoryInjection([], { maxPerBucket: 2 });
    const lines = block.split("\n").filter(l => /^\d+\./.test(l));
    assert.equal(lines.length, 2, "默认限每段 2 条时只注入 2 条");
});

test("buildMemoryInjection：旧记录（无 bucket）按 type/importance 兜底分组", () => {
    resetRuntime();
    S.activeBehaviorRecords = [
        { id: "o1", text: "老档事件", type: "event", importance: 3 },
        { id: "o2", text: "老档物品", type: "item", importance: 2 }
    ];
    const block = buildMemoryInjection([]);
    assert.ok(block.includes("【重要事件】") && block.includes("老档事件"), "旧档 event 归重要事件");
    assert.ok(block.includes("【学到的知识】") && block.includes("老档物品"), "旧档 item 归知识");
});

// ===== 记忆包 bucket 兼容 =====
test("createMemoryPack：保留 bucket 字段", () => {
    resetRuntime();
    const pack = createMemoryPack([
        { id: "e1", text: "害怕与 Tsubasa 再会", bucket: "emotional", importance: 4, pinned: true, type: "relationship" }
    ], { worldName: "测试世界" });
    assert.equal(pack.memories[0].bucket, "emotional");
    assert.equal(pack.memories[0].embedding, undefined, "导出仍应剥离向量");
});

test("mergeMemoryPack：本地已有 bucket 不降级，本地无则取导入值", () => {
    resetRuntime();
    S.activeBehaviorRecords = [{ id: "l1", text: "老档事件", type: "event", importance: 3 }];
    const pack = createMemoryPack([
        { id: "p1", text: "老档事件", bucket: "learned_fact", importance: 3, type: "event" },
        { id: "p2", text: "导入的情感", bucket: "emotional", importance: 4, type: "relationship" }
    ]);
    const result = mergeMemoryPack(S.activeBehaviorRecords, pack);
    const kept = result.memories.find(m => m.text === "老档事件");
    assert.equal(kept.bucket, "important_event", "本地已分型不因导入降级");
    const imported = result.memories.find(m => m.text === "导入的情感");
    assert.equal(imported.bucket, "emotional");
});

// ===== 回归：检索不破 =====
test("检索回归：带 bucket 的记忆仍可被关键词召回", async () => {
    resetRuntime();
    S.activeBehaviorRecords = [
        { id: "b1", text: "林黛玉在潇湘馆咳血", bucket: "important_event", importance: 4, pinned: false, type: "event", embedding: null }
    ];
    const { retrieveBehaviorRecords } = await import("../src/rag.js");
    const hits = await retrieveBehaviorRecords("黛玉的病情", 1, null);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].text, "林黛玉在潇湘馆咳血");
});
