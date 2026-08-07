// ★ 69 · 章节化回溯（借鉴 WorldLines playthrough 轻量版：回合状态快照 + 历史截断）
// 覆盖：章节分组 / label / 日志追加与读取 / 分支 / 回溯恢复（state+history+chat+summary+记忆截断）/ 复制与删除日志
import test from "node:test";
import assert from "node:assert/strict";

// ---- 轻量 IndexedDB mock（idb.js 的 Promise 包装；onsuccess 用 setImmediate 派发，
// 避免 queueMicrotask 与 node:test 的异步边界冲突导致 "event loop has already resolved"）----
const dbData = new Map();
function makeReq(result) {
    const req = { result, error: null };
    setImmediate(() => { if (req.onsuccess) req.onsuccess(); });
    return req;
}
globalThis.indexedDB = {
    open: () => {
        const req = {
            result: {
                objectStoreNames: { contains: () => true },
                createObjectStore: () => {},
                transaction: () => {
                    const tx = { oncomplete: null, onerror: null, objectStore: null };
                    tx.objectStore = () => ({
                        get: (key) => makeReq(dbData.has(key) ? dbData.get(key) : undefined),
                        put: (value, key) => { dbData.set(key, value); setImmediate(() => { if (tx.oncomplete) tx.oncomplete(); }); return makeReq(undefined); },
                        delete: (key) => { dbData.delete(key); setImmediate(() => { if (tx.oncomplete) tx.oncomplete(); }); return makeReq(undefined); }
                    });
                    return tx;
                }
            },
            error: null
        };
        setImmediate(() => { if (req.onsuccess) req.onsuccess(); });
        return req;
    }
};

const { chapterOf, turnLabel, appendTurnLog, loadTurnLog, forkBranch, rewindToTurn, copyTurnLog, deleteTurnLog, persistLog } = await import("../src/timeline-log.js");
const { rebuildChatFromHistory, rebuildSummaryFromHistory } = await import("../src/prompt.js");

const SAVE = {
    id: "s1",
    history: [
        { player: "你好", narrative: "开局旁白", day: 1, period: "morning" },
        { player: "去码头", narrative: "你到了码头", day: 1, period: "afternoon" },
        { player: "查线索", narrative: "发现了勾玉", day: 2, period: "night" }
    ],
    chatHistory: [{ role: "assistant", content: "x" }],
    chatSummary: ["旧摘要"]
};

const stateAt = (loc) => ({ story_progress: 2, current_location: loc, current_date: { day: 2, period: "night" } });

test("chapterOf：每 10 回合一章", () => {
    assert.equal(chapterOf(1), 1);
    assert.equal(chapterOf(10), 1);
    assert.equal(chapterOf(11), 2);
    assert.equal(chapterOf(25), 3);
});

test("turnLabel：日/时段/地点组合", () => {
    assert.equal(turnLabel({ day: 3, period: "night", location: "码头" }), "第3天 · 夜晚 · 码头");
    assert.equal(turnLabel({ day: 1, period: "morning" }), "第1天 · 早晨");
    assert.equal(turnLabel({ tcd: { month: 5, date: 20 } }), "5月20日");
    assert.equal(turnLabel({}), "");
});

test("appendTurnLog：追加与读取（含 state/entry/hist_idx/章节）", async () => {
    dbData.clear();
    await appendTurnLog("s1", "w1", {
        state: stateAt("码头"), entry: { player: "去码头", narrative: "你到了码头", day: 1, period: "afternoon", choices: ["查货", "问人"] },
        histIdx: 2, memoryCount: 3
    });
    await appendTurnLog("s1", "w1", {
        state: stateAt("码头"), entry: { player: "查线索", narrative: "发现了勾玉", day: 2, period: "night", choices: [] },
        histIdx: 3, memoryCount: 4
    });
    const log = await loadTurnLog("s1");
    assert.ok(log, "日志应存在");
    assert.equal(log.turns.length, 2);
    assert.equal(log.turns[0].turn, 1);
    assert.equal(log.turns[0].hist_idx, 2);
    assert.equal(log.turns[0].state.current_location, "码头");
    assert.equal(log.turns[0].entry.player, "去码头");
    assert.equal(log.turns[0].memory_count, 3);
    assert.equal(log.turns[1].turn, 2);
    assert.equal(log.current_branch, "main");
});

test("forkBranch：回溯后进入新分支，追加回合归属新分支", async () => {
    dbData.clear();
    await appendTurnLog("s1", "w1", { state: stateAt("码头"), entry: { player: "a" }, histIdx: 1, memoryCount: 0 });
    const log = await loadTurnLog("s1");
    const bid = forkBranch(log, 1);
    await persistLog(log);
    await appendTurnLog("s1", "w1", { state: stateAt("码头"), entry: { player: "b（分支）" }, histIdx: 2, memoryCount: 1 });
    const log2 = await loadTurnLog("s1");
    assert.equal(log2.branches.length, 1, "应记录 1 个分支");
    assert.equal(log2.branches[0].base_turn, 1);
    assert.equal(log2.turns[1].branch, bid, "追加回合归属新分支");
    assert.equal(log2.turns[1].base_turn, 1, "记录分叉源回合");
    assert.equal(log2.turns[0].branch, "main");
});

test("rewindToTurn：恢复目标回合 state + 截断 history + 重建 chat/summary", () => {
    const log = {
        turns: [
            { turn: 1, hist_idx: 1, label: "第1天·早晨", state: stateAt("小镇入口"), entry: { player: "你好" }, memory_count: 0, branch: "main", base_turn: null },
            { turn: 2, hist_idx: 2, label: "第1天·下午", state: stateAt("码头"), entry: { player: "去码头" }, memory_count: 2, branch: "main", base_turn: null }
        ]
    };
    const restored = rewindToTurn(SAVE, log, 2, { behaviorRecords: [{ text: "m1" }, { text: "m2" }, { text: "m3" }] });
    assert.equal(restored.gameState.current_location, "码头", "恢复目标回合状态");
    assert.deepEqual(restored.history.map(h => h.player), ["你好", "去码头"], "历史截断到该回合");
    assert.deepEqual(restored.chatHistory, rebuildChatFromHistory(restored.history), "chatHistory 由截断历史重建");
    assert.deepEqual(restored.chatSummary, rebuildSummaryFromHistory(restored.history), "chatSummary 由截断历史重建");
    assert.equal(restored.behaviorRecords, null, "默认保留记忆（不截断）");
    assert.equal(restored.label, "第1天·下午");
});

test("rewindToTurn：clearMemory 时记忆截断到目标回合", () => {
    const log = { turns: [{ turn: 1, hist_idx: 1, label: "x", state: stateAt("小镇"), entry: {}, memory_count: 2 }] };
    const restored = rewindToTurn(SAVE, log, 1, {
        behaviorRecords: [{ text: "a" }, { text: "b" }, { text: "c" }],
        clearMemory: true
    });
    assert.deepEqual(restored.behaviorRecords.map(r => r.text), ["a", "b"], "记忆截断到目标回合的数量");
});

test("rewindToTurn：目标不存在抛错；无日志抛错", () => {
    assert.throws(() => rewindToTurn(SAVE, { turns: [{ turn: 1, hist_idx: 1, state: {} }] }, 5), /目标回合不在回溯日志/);
    assert.throws(() => rewindToTurn(SAVE, null, 1), /目标回合不在回溯日志/);
});

test("copyTurnLog / deleteTurnLog：另存复制与删除", async () => {
    dbData.clear();
    await appendTurnLog("s1", "w1", { state: stateAt("码头"), entry: { player: "a" }, histIdx: 1, memoryCount: 0 });
    await copyTurnLog("s1", "s2");
    const copy = await loadTurnLog("s2");
    assert.ok(copy && copy.turns.length === 1, "新槽位应复制日志");
    assert.equal(copy.saveId, "s2");
    await deleteTurnLog("s1");
    assert.equal(await loadTurnLog("s1"), null, "删除后读不到");
    assert.ok(await loadTurnLog("s2"), "另一槽位不受影响");
});
