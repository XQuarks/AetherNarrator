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
const { addBehaviorRecords, ensureLoreEmbeddings, retrieve, retrieveBehaviorRecords } = await import("../src/rag.js");
const { rebuildSummaryFromHistory } = await import("../src/prompt.js");

function resetRuntime() {
    storage.clear();
    S.currentWorld = { id: "w1", behavior_records: [] };
    S.activeBehaviorRecords = [];
    S.gameState = {
        current_date: { day: 1, period: "morning" },
        current_location: "庭院"
    };
}

test("新增行为记忆只写当前存档运行态，不污染世界模板", () => {
    resetRuntime();

    addBehaviorRecords([{ text: "在庭院发现密道", importance: 4 }]);

    assert.equal(S.activeBehaviorRecords.length, 1);
    assert.deepEqual(S.currentWorld.behavior_records, []);
});

test("未置顶记忆仍参与正常检索", async () => {
    resetRuntime();
    S.activeBehaviorRecords = [{
        id: "b1",
        text: "林黛玉在潇湘馆咳血",
        importance: 4,
        pinned: false,
        type: "event",
        embedding: null
    }];

    const found = await retrieveBehaviorRecords("林黛玉咳血", 3);

    assert.equal(found.length, 1);
    assert.equal(found[0].id, "b1");
});

test("大知识库检索会等待异步记忆召回而不抛错", async () => {
    resetRuntime();
    S.vectorUnavailableWarned = true;
    S.activeLoreKB = {
        snippets: [{
            id: "l1",
            category: "规则",
            title: "长规则",
            content: "世界规则".repeat(4000),
            activation_keys: ["林黛玉"],
            trigger_mode: "keyword"
        }]
    };
    S.activeBehaviorRecords = [{
        id: "b1",
        text: "林黛玉在潇湘馆咳血",
        importance: 5,
        pinned: false,
        type: "event",
        embedding: null
    }];

    const result = await retrieve("林黛玉咳血");

    assert.ok(result.some(item => item.id === "behavior_b1"));
});

test("知识库向量补算会处理首条之后的缺失向量", async () => {
    resetRuntime();
    window.transformers = {};
    S.embeddingModel = async () => ({ data: new Float32Array([0.1, 0.2]) });
    const kb = { snippets: [
        { id: "l1", category: "规则", title: "已有", content: "已有向量", embedding: [0.1, 0.2] },
        { id: "l2", category: "人物", title: "缺失", content: "需要补算", embedding: null }
    ] };

    await ensureLoreEmbeddings(kb);

    assert.deepEqual(kb.snippets[1].embedding, [0.10000000149011612, 0.20000000298023224]);
    delete window.transformers;
    S.embeddingModel = null;
});

test("从旧历史重建摘要时保留叙事结果而非开头铺垫", () => {
    const summaries = rebuildSummaryFromHistory([{
        narrative: "雨一直下着，众人沉默不语。宝玉终于找到丢失的玉佩。黛玉答应明日一同赴宴。"
    }]);

    assert.equal(summaries.length, 1);
    assert.match(summaries[0], /找到丢失的玉佩/);
    assert.match(summaries[0], /明日一同赴宴/);
    assert.doesNotMatch(summaries[0], /雨一直下着/);
});

test("大知识库中的 always 条目无需关键词也会常驻注入", async () => {
    resetRuntime();
    S.vectorUnavailableWarned = true;
    S.activeLoreKB = {
        budget_tokens: 8000,
        snippets: [
            { id: "always", category: "规则", title: "核心禁律", content: "不得伤害无辜", trigger_mode: "always", activation_keys: [] },
            { id: "seed", category: "地点", title: "潇湘馆", content: "潇湘馆".repeat(5000), trigger_mode: "keyword", activation_keys: ["潇湘馆"] }
        ]
    };

    const result = await retrieve("前往潇湘馆");

    assert.ok(result.some(item => item.id === "always"));
});

test("知识库注入严格遵守字符预算并保留至少一条摘要", async () => {
    resetRuntime();
    S.vectorUnavailableWarned = true;
    S.activeLoreKB = {
        budget_tokens: 20,
        snippets: [
            { id: "a", category: "规则", title: "规则甲", content: "甲".repeat(7000), trigger_mode: "always" },
            { id: "b", category: "规则", title: "规则乙", content: "乙".repeat(7000), trigger_mode: "always" }
        ]
    };

    const result = await retrieve("任意行动");
    const lore = result.filter(item => !String(item.id).startsWith("behavior_"));
    const used = lore.reduce((sum, item) => sum + item.title.length + item.content.length, 0);

    assert.ok(lore.length >= 1);
    assert.ok(used <= 40, `实际使用 ${used} 字符`);
});

// ============================================================
// ★ Phase 4 增补：RAG 图遍历召回（relations 实体邻居扩展）
// 撑过 LORE_FULL_THRESHOLD（12000 字）以触发检索分支（否则小库走全量常驻、不跑图遍历）。
// ============================================================
function relationKB(extra = {}) {
    return {
        budget_tokens: 8000,
        ...extra,
        snippets: [
            { id: "harry", category: "人物", title: "哈利",
              content: "哈利波特是故事的主角，拥有闪电形伤疤。".repeat(800), // ~13600 字，撑过阈值
              trigger_mode: "keyword", activation_keys: ["哈利"],
              relations: [{ from: "哈利", relation: "敌对", to: "伏地魔" }, { from: "哈利", relation: "校友", to: "赫敏" }] },
            { id: "voldemort", category: "人物", title: "伏地魔", content: "黑魔王",
              trigger_mode: "keyword", activation_keys: ["伏地魔"],
              relations: [{ from: "伏地魔", relation: "领导", to: "食死徒" }] },
            { id: "death", category: "势力", title: "食死徒", content: "伏地魔的追随者",
              trigger_mode: "keyword", activation_keys: ["食死徒"] }
            // 赫敏 为 entity-only（无片段）
        ]
    };
}

test("relations 图遍历召回：命中哈利→经实体中转召回伏地魔与食死徒", async () => {
    resetRuntime();
    S.vectorUnavailableWarned = true;
    S.activeLoreKB = relationKB();

    const result = await retrieve("哈利");
    const ids = result.map(item => item.id);

    assert.ok(ids.includes("harry"), "seed 哈利 应被召回");
    assert.ok(ids.includes("voldemort"), "直接关系邻居 伏地魔 应被图遍历召回");
    assert.ok(ids.includes("death"), "经 伏地魔 中转的 食死徒 应被 2 跳召回");
    assert.ok(!ids.includes("hermione"), "赫敏 为 entity-only 且无片段，不应注入");
});

test("relations 图遍历召回：relation_traversal:false 时关闭扩展", async () => {
    resetRuntime();
    S.vectorUnavailableWarned = true;
    S.activeLoreKB = relationKB({ relation_traversal: false });

    const result = await retrieve("哈利");
    const ids = result.map(item => item.id);

    assert.ok(ids.includes("harry"), "seed 哈利 仍应被召回");
    assert.ok(!ids.includes("voldemort"), "关闭后伏地魔 不应被扩展召回");
    assert.ok(!ids.includes("death"), "关闭后食死徒 不应被扩展召回");
});

