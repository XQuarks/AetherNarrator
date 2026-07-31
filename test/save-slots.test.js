// ============================================================
// 多存档槽位（docs/55）单元测试
// 覆盖：createOrUpdateSave 按 saveId 定位（不按 worldId 覆盖）、
// saveAsNewSave 另存为新槽位并深拷贝、同世界 ≥3 档并存互不干扰、
// loadSave / continueLatestSave 绑定 saveId、deleteSave 清理 saveId、
// 旧档（无 name / 无 saveId）兼容不覆盖。
// 最小 document / window / localStorage / confirm 桩，不依赖真实浏览器与 IndexedDB。
// ============================================================
import { test } from "node:test";
import assert from "node:assert";

// ---- 最小 DOM / 浏览器环境桩 ----
function makeEl() {
    return {
        style: {}, dataset: {}, value: "", checked: false,
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {}, removeChild() {}, insertBefore() {},
        addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
        querySelector() { return makeEl(); }, querySelectorAll() { return []; },
        focus() {}, blur() {}, click() {},
        get innerHTML() { return ""; }, set innerHTML(v) {},
        get textContent() { return ""; }, set textContent(v) {},
    };
}
globalThis.window = globalThis;
globalThis.document = {
    getElementById: () => makeEl(),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    addEventListener() {}, body: makeEl(),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = () => Promise.reject(new Error("stub"));
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
// indexedDB 故意不定义 → idb.js 自动降级（idbGet 返回 null / idbSet 返回 false），不抛错。

import { S } from "../src/store.js";
import { createOrUpdateSave, saveAsNewSave, saveCurrentSlot, loadSave, continueLatestSave, deleteSave } from "../src/save.js";
import { defaultInitialState, deepClone } from "../src/utils.js";
import { normalizeSimulationState } from "../src/simulation.js";

function setupWorld() {
    const world = {
        id: "w1", name: "霍格沃茨",
        schema: { time_config: { mode: "day", calendar_start: { month: 1, date: 1 }, periods: ["morning", "noon", "evening", "night"] }, variable_schema: [] },
        variable_schema: [],
        initial_state: defaultInitialState(),
        modules: {},
    };
    S.worlds = [world];
    S.currentWorld = world;
    S.saves = [];
    S.currentSession = { epoch: 0, worldId: "w1", saveId: null };
    S.gameState = normalizeSimulationState(deepClone(defaultInitialState()));
    S.conversationHistory = [];
    S.chatHistory = [];
    S.activeLoreKB = null;
    S.activeBehaviorRecords = [];
    S.aiEnhanced = false;
    S.lastLoreReviewMsgCount = 0;
    S._loreRevisionBuffer = null;
    S.playerNotes = "";
    S.chatSummary = [];
}

// ----------------------------------------------------------
// 1. 核心回归：按 saveId 更新，不覆盖同世界其他槽位
// ----------------------------------------------------------
test("createOrUpdateSave 按 saveId 更新，不覆盖同世界其他槽位", () => {
    setupWorld();
    S.currentSession.saveId = "sA";
    S.gameState.variables = { gold: 10 };
    createOrUpdateSave();
    S.currentSession.saveId = "sB";
    S.gameState.variables = { gold: 20 };
    createOrUpdateSave();

    assert.strictEqual(S.saves.length, 2, "应有两个独立槽位");
    assert.strictEqual(S.saves.find(s => s.id === "sA").state.variables.gold, 10, "A 槽位应保持 10");
    assert.strictEqual(S.saves.find(s => s.id === "sB").state.variables.gold, 20, "B 槽位应保持 20");

    // 更新 A，B 不应被波及
    S.currentSession.saveId = "sA";
    S.gameState.variables = { gold: 99 };
    createOrUpdateSave();
    assert.strictEqual(S.saves.find(s => s.id === "sA").state.variables.gold, 99, "A 应更新为 99");
    assert.strictEqual(S.saves.find(s => s.id === "sB").state.variables.gold, 20, "B 不应被 A 的更新覆盖");
});

// ----------------------------------------------------------
// 2. 全新 id（startGame 路径）→ 建新槽位，不覆盖世界已有档
// ----------------------------------------------------------
test("createOrUpdateSave 用全新 id 创建新槽位，不覆盖世界已有档（startGame 路径）", () => {
    setupWorld();
    S.currentSession.saveId = "sOld";
    S.gameState.variables = { gold: 5 };
    createOrUpdateSave();

    // 模拟 startGame 每新周目生成新槽位 id
    S.currentSession.saveId = "s" + Date.now() + "_new";
    S.gameState.variables = { gold: 7 };
    createOrUpdateSave();

    assert.strictEqual(S.saves.length, 2, "应新增为两个槽位");
    assert.strictEqual(S.saves.find(s => s.id === "sOld").state.variables.gold, 5, "旧档不应被新周目覆盖");
});

// ----------------------------------------------------------
// 3. saveAsNewSave：另存为全新槽位 + 绑定会话 + 深拷贝
// ----------------------------------------------------------
test("saveAsNewSave 另存为全新槽位并绑定当前会话，深拷贝运行时", () => {
    setupWorld();
    S.currentSession.saveId = "sA";
    S.gameState.variables = { gold: 50 };
    S.conversationHistory = [{ player: "x", narrative: "n" }];
    createOrUpdateSave();

    saveAsNewSave("好结局线");

    assert.strictEqual(S.saves.length, 2, "应新增一个槽位");
    assert.notStrictEqual(S.currentSession.saveId, "sA", "会话应切到新槽位");
    const ns = S.saves.find(s => s.id === S.currentSession.saveId);
    assert.strictEqual(ns.name, "好结局线", "槽位名应为自定义名");
    assert.strictEqual(ns.worldId, "w1");
    assert.deepStrictEqual(ns.state.variables, { gold: 50 }, "应深拷贝当前状态");
    // 改当前状态不应影响已存槽位（独立深拷贝）
    S.gameState.variables.gold = 999;
    assert.strictEqual(S.saves.find(s => s.id === ns.id).state.variables.gold, 50, "新槽位不应随后续改动变化");
});

// ----------------------------------------------------------
// 4. 同世界 ≥3 档并存，互不影响
// ----------------------------------------------------------
test("同一世界可并存 ≥3 个独立槽位，互不影响", () => {
    setupWorld();
    for (const g of [1, 2, 3]) {
        S.currentSession.saveId = "s" + g;
        S.gameState.variables = { gold: g * 10 };
        createOrUpdateSave();
    }
    assert.strictEqual(S.saves.length, 3);
    assert.deepStrictEqual(
        S.saves.map(s => s.state.variables.gold).sort((a, b) => a - b),
        [10, 20, 30]
    );
});

// ----------------------------------------------------------
// 5. loadSave 将会话绑定到所读槽位
// ----------------------------------------------------------
test("loadSave 将 S.currentSession.saveId 绑定到所读槽位", () => {
    setupWorld();
    S.currentSession.saveId = "sX";
    createOrUpdateSave();
    S.currentSession.saveId = null; // 模拟切换前未绑定
    loadSave("sX");
    assert.strictEqual(S.currentSession.saveId, "sX", "加载后应绑定到 sX");
});

// ----------------------------------------------------------
// 6. deleteSave 删除当前活动档时清理 saveId
// ----------------------------------------------------------
test("deleteSave 删除当前活动档时解绑 S.currentSession.saveId", () => {
    setupWorld();
    S.currentSession.saveId = "sA";
    createOrUpdateSave();
    deleteSave("sA");
    assert.strictEqual(S.currentSession.saveId, null, "删除当前档后 saveId 应清空");
    assert.strictEqual(S.saves.length, 0, "存档应被移除");
});

// ----------------------------------------------------------
// 7. continueLatestSave 加载同世界最近（updatedAt 最大）的档并绑定 saveId
// ----------------------------------------------------------
test("continueLatestSave 加载同世界最近存档并绑定 saveId", () => {
    setupWorld();
    S.currentSession.saveId = "sOld"; S.gameState.variables = { gold: 1 };
    createOrUpdateSave();
    // 覆盖 updatedAt 为较早
    S.saves.find(s => s.id === "sOld").updatedAt = "2026-01-01 00:00:00";

    S.currentSession.saveId = "sNew"; S.gameState.variables = { gold: 2 };
    createOrUpdateSave();
    S.saves.find(s => s.id === "sNew").updatedAt = "2026-03-01 00:00:00";

    S.currentSession.saveId = null;
    continueLatestSave("w1");
    assert.strictEqual(S.currentSession.saveId, "sNew", "应加载最近（sNew）并绑定");
});

// ----------------------------------------------------------
// 8. 旧档兼容：无 name / 无 saveId 时，createOrUpdateSave 不覆盖旧档
// ----------------------------------------------------------
test("旧档兼容：会话无 saveId 且有旧档时，createOrUpdateSave 创建新槽位而非覆盖", () => {
    setupWorld();
    // 模拟一条读自旧版的存档（无 name 字段、无 saveId 概念）
    S.saves.push({
        id: "sLegacy", worldId: "w1", worldName: "霍格沃茨",
        progress: "第 1 天", updatedAt: "2026-01-01 00:00:00",
        state: { gold: 1 }, history: [], chatHistory: [], chatSummary: [],
        schema_version: 1, lore_kb: null, behavior_records: [], ai_enhanced: false,
        last_lore_review_msg_count: 0, pending_lore_revision: null, player_notes: "",
    });
    // 新周目：会话 saveId 为空 → 应开新槽位，而不是把 sLegacy 覆盖掉
    S.currentSession.saveId = null;
    S.gameState.variables = { gold: 2 };
    createOrUpdateSave();
    assert.strictEqual(S.saves.length, 2, "应新增为两个槽位（旧档保留）");
    assert.strictEqual(S.saves.find(s => s.id === "sLegacy").state.gold, 1, "旧档不被覆盖");
    const fresh = S.saves.find(s => s.id === S.currentSession.saveId);
    assert.ok(fresh.name, "新槽位应有默认 name");
    assert.strictEqual(fresh.worldId, "w1");
});

// ----------------------------------------------------------
// 9. saveCurrentSlot：保存当前槽位并带反馈
// ----------------------------------------------------------
test("saveCurrentSlot 调用 createOrUpdateSave 写回当前槽位", () => {
    setupWorld();
    S.currentSession.saveId = "sA";
    S.gameState.variables = { gold: 11 };
    createOrUpdateSave();
    S.gameState.variables = { gold: 22 };
    saveCurrentSlot();
    assert.strictEqual(S.saves.find(s => s.id === "sA").state.variables.gold, 22, "当前槽位应被更新");
});
