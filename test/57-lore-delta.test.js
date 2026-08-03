// docs/57 · 双轨知识库运行时：applyLoreDelta + 覆盖段 + 裁判注入 单元测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { S, applyLoreDelta, defaultWorldRuntime } from "../src/store.js";
import { buildLoreRuntimeOverlay } from "../src/prompt.js";
import { getWorldLoreForJudge } from "../src/llm.js";

function mockKB() {
    return {
        ip: "test",
        snippets: [
            { id: "harry", category: "人物", title: "哈利·波特", content: "哈利是救世主，第七部打败伏地魔", keywords: [], activation_keys: ["哈利"], trigger_mode: "keyword", priority: 1, embedding: [0.1], embedDim: 512, embedModel: "Xenova/bge-small-zh-v1.5" },
            { id: "voldemort", category: "人物", title: "伏地魔", content: "伏地魔是反派", keywords: [], activation_keys: [], trigger_mode: "always", priority: 1 }
        ]
    };
}

function resetState() {
    S.currentWorld = null;
    S.activeLoreKB = null;
    S.worldRuntime = null;
    S.gameState = null;
    S.conversationHistory = [];
}

test("applyLoreDelta override 改写已有条目并记录 deltaLog / entityStates", () => {
    resetState();
    S.activeLoreKB = mockKB();
    S.worldRuntime = defaultWorldRuntime();
    S.gameState = { story_progress: 1 };
    const res = applyLoreDelta([{ op: "override", lore_id: "harry", content: "哈利已被玩家杀死", entity: "harry", state: { alive: false, deathTurn: 1 }, note: "开局击杀" }]);
    assert.equal(res.applied.length, 1);
    assert.equal(res.skipped.length, 0);
    const snip = S.activeLoreKB.snippets.find(s => s.id === "harry");
    assert.equal(snip.content, "哈利已被玩家杀死");
    // 向量过期标记（触发局部重算）
    assert.equal(snip.embedding, null);
    assert.equal(S.worldRuntime.deltaLog.length, 1);
    assert.equal(S.worldRuntime.deltaLog[0].from, "哈利是救世主，第七部打败伏地魔");
    assert.equal(S.worldRuntime.deltaLog[0].to, "哈利已被玩家杀死");
    assert.equal(S.worldRuntime.entityStates.harry.alive, false);
    assert.equal(S.worldRuntime.entityStates.harry.deathTurn, 1);
});

test("applyLoreDelta override 不存在的 id 被跳过且不改动副本", () => {
    resetState();
    S.activeLoreKB = mockKB();
    S.worldRuntime = defaultWorldRuntime();
    S.gameState = { story_progress: 3 };
    const before = S.activeLoreKB.snippets.length;
    const res = applyLoreDelta([{ op: "override", lore_id: "nonexistent", content: "x" }]);
    assert.equal(res.applied.length, 0);
    assert.equal(res.skipped.length, 1);
    assert.equal(S.activeLoreKB.snippets.length, before);
    assert.equal(S.worldRuntime.deltaLog.length, 0);
});

test("applyLoreDelta add 新增本局事实条目并标记 _runtime", () => {
    resetState();
    S.activeLoreKB = mockKB();
    S.worldRuntime = defaultWorldRuntime();
    S.gameState = { story_progress: 2 };
    const res = applyLoreDelta([{ op: "add", lore_id: "fact_1", category: "本局事实", title: "预言另寻承载", content: "预言因哈利之死另寻承载者", entity: "prophecy", state: { bearer: "待定" } }]);
    assert.equal(res.applied.length, 1);
    const added = S.activeLoreKB.snippets.find(s => s.id === "fact_1");
    assert.ok(added, "应新增 fact_1");
    assert.equal(added._runtime, true);
    assert.equal(added.category, "本局事实");
    assert.equal(S.worldRuntime.entityStates.prophecy.bearer, "待定");
});

test("applyLoreDelta 绝不污染原著 currentWorld.lore_kb", () => {
    resetState();
    const original = "哈利是救世主，第七部打败伏地魔";
    S.currentWorld = { id: "w1", lore_kb: { ip: "hp", snippets: [{ id: "harry", category: "人物", title: "哈利·波特", content: original }] } };
    S.activeLoreKB = JSON.parse(JSON.stringify(S.currentWorld.lore_kb)); // 深拷贝工作副本
    S.worldRuntime = defaultWorldRuntime();
    S.gameState = { story_progress: 1 };
    applyLoreDelta([{ op: "override", lore_id: "harry", content: "哈利已死" }]);
    const origSnip = S.currentWorld.lore_kb.snippets.find(s => s.id === "harry");
    assert.equal(origSnip.content, original, "原著 lore_kb 不应被改写");
    assert.equal(S.activeLoreKB.snippets.find(s => s.id === "harry").content, "哈利已死", "工作副本应被改写");
});

test("buildLoreRuntimeOverlay：有 deltaLog 返回非空覆盖段，无则空", () => {
    resetState();
    S.worldRuntime = null;
    assert.equal(buildLoreRuntimeOverlay(), "", "无运行态应返回空串（不改动 prompt）");
    S.worldRuntime = defaultWorldRuntime();
    assert.equal(buildLoreRuntimeOverlay(), "", "空 deltaLog 应返回空串");
    S.worldRuntime.deltaLog.push({ turn: 1, op: "override", lore_id: "harry", field: "content", from: "a", to: "哈利已死", entity: "harry", note: "击杀" });
    const txt = buildLoreRuntimeOverlay();
    assert.ok(txt.includes("哈利已死"), "覆盖段应包含实际事实");
    assert.ok(txt.includes("回合1"), "覆盖段应含回合号");
});

test("getWorldLoreForJudge 注入 deltaLog 摘要段（裁判按实际剧情判违和）", () => {
    resetState();
    S.currentWorld = { id: "w1", world_description: "HP 世界", hero: "哈利", lore_kb: mockKB() };
    S.activeLoreKB = mockKB();
    S.worldRuntime = defaultWorldRuntime();
    S.worldRuntime.deltaLog.push({ turn: 1, op: "override", lore_id: "harry", field: "content", from: "a", to: "哈利已被玩家杀死", entity: "harry", note: "开局击杀" });
    const judge = getWorldLoreForJudge();
    assert.ok(judge.includes("本局实际发生的事实变更"), "裁判素材应含本局事实变更段");
    assert.ok(judge.includes("哈利已被玩家杀死"), "裁判应看到更新后的实际剧情");
});

test("defaultWorldRuntime：重开新档应清空运行态", () => {
    resetState();
    S.worldRuntime = defaultWorldRuntime();
    S.worldRuntime.deltaLog.push({ turn: 1, op: "override", lore_id: "x", field: "content", from: "a", to: "b" });
    S.worldRuntime = defaultWorldRuntime(); // 模拟重开新档重置
    assert.equal(S.worldRuntime.deltaLog.length, 0, "重开应清空 deltaLog");
    assert.deepEqual(S.worldRuntime.entityStates, {});
});
