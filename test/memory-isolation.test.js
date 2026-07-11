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
const { addBehaviorRecords, retrieve, retrieveBehaviorRecords } = await import("../src/rag.js");

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
