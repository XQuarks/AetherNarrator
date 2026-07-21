// ============================================================
// L3 认知状态追踪（docs/18）测试
// 验证 revealed_locations 字段、applyStateChanges 的增量/自动累加逻辑，
// 以及 buildSmartFallbackChoices 基于 present_npcs / revealed_locations 的增强分支。
// ============================================================

// 与 load-check.mjs 同款 DOM 宽容 stub，令 game.js 模块图可在 node 中求值
const any = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : any),
    apply: () => any,
    construct: () => any,
    has: () => true,
});
const def = (k, v) => { try { globalThis[k] = v; } catch { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } };
def("window", globalThis);
def("document", any);
def("navigator", { userAgent: "node", language: "zh" });
def("location", { href: "http://localhost/", origin: "http://localhost" });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = () => Promise.reject(new Error("stub-fetch"));
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.alert = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, addListener: () => {} });
// idb.js 的 saveState 依赖 IndexedDB：优先用 fake-indexeddb，否则吞掉其 unhandledRejection（状态写入在 saveState 之前已完成，不影响断言）
try { await import("fake-indexeddb/auto"); } catch { process.on("unhandledRejection", () => {}); }

import test from "node:test";
import assert from "node:assert/strict";

const { S } = await import("../src/store.js");
const { defaultInitialState } = await import("../src/utils.js");
const { buildSmartFallbackChoices, applyStateChanges } = await import("../src/game.js");

function setupMinimalWorld() {
    S.currentWorld = { id: "w_l3", rules: [], lore_kb: { snippets: [] } };
    S.activeLoreKB = { snippets: [] };
    S.gameState = defaultInitialState();
}

test("defaultInitialState 含 revealed_locations/present_npcs 默认空数组（向前兼容旧存档）", () => {
    const gs = defaultInitialState();
    assert.ok(Array.isArray(gs.revealed_locations), "revealed_locations 应为数组");
    assert.deepEqual(gs.revealed_locations, []);
    assert.ok(Array.isArray(gs.present_npcs));
    assert.deepEqual(gs.present_npcs, []);
});

test("applyStateChanges：revealed_locations 增量 add（去重）生效", () => {
    setupMinimalWorld();
    S.gameState.current_location = "庭院";
    S.gameState.revealed_locations = ["后门"];
    applyStateChanges({ revealed_locations: { add: ["大观楼", "后门"] } });
    assert.ok(S.gameState.revealed_locations.includes("大观楼"), "显式 add 的地点应进入");
    assert.ok(S.gameState.revealed_locations.includes("后门"), "原有地点应保留");
    assert.equal(S.gameState.revealed_locations.filter(l => l === "后门").length, 1, "重复 add 应去重");
});

test("applyStateChanges：revealed_locations 增量 remove 生效", () => {
    setupMinimalWorld();
    S.gameState.revealed_locations = ["A", "B"];
    applyStateChanges({ revealed_locations: { remove: ["A"] } });
    assert.deepEqual(S.gameState.revealed_locations, ["B"]);
});

test("applyStateChanges：current_location 变更时旧地点自动加入 revealed_locations，且不含当前所在地", () => {
    setupMinimalWorld();
    S.gameState.current_location = "庭院";
    S.gameState.revealed_locations = [];
    applyStateChanges({ current_location: "潇湘馆" });
    assert.equal(S.gameState.current_location, "潇湘馆");
    assert.ok(S.gameState.revealed_locations.includes("庭院"), "离开的地点应自动进入 revealed_locations");
    assert.ok(!S.gameState.revealed_locations.includes("潇湘馆"), "当前所在地不得出现在 revealed_locations");
});

test("applyStateChanges：present_npcs 增量（add/remove）仍正常", () => {
    setupMinimalWorld();
    S.gameState.present_npcs = ["宝玉"];
    applyStateChanges({ present_npcs: { add: ["黛玉"], remove: ["宝玉"] } });
    assert.deepEqual(S.gameState.present_npcs, ["黛玉"]);
});

// ===================== 保底增强分支 =====================

test("保底：present_npcs 有值时生成「与X交谈」，且无已知地点时不出现「前往」", () => {
    setupMinimalWorld();
    S.gameState.current_location = "庭院";
    S.gameState.present_npcs = ["林黛玉"];
    S.gameState.revealed_locations = [];
    const joined = buildSmartFallbackChoices().map(c => c.text).join(" | ");
    assert.ok(joined.includes("与林黛玉交谈"), `应出现与在场角色交谈选项：${joined}`);
    assert.ok(!joined.includes("前往"), `无已知地点时不应出现前往选项：${joined}`);
});

test("保底：revealed_locations 有值时生成「前往Y」且排除当前所在地", () => {
    setupMinimalWorld();
    S.gameState.current_location = "庭院";
    S.gameState.present_npcs = [];
    S.gameState.revealed_locations = ["潇湘馆", "庭院"]; // 故意含当前所在地，应被过滤
    const joined = buildSmartFallbackChoices().map(c => c.text).join(" | ");
    assert.ok(joined.includes("前往潇湘馆"), `应出现前往已知地点选项：${joined}`);
    assert.ok(!joined.includes("前往庭院"), `不得出现前往当前所在地：${joined}`);
});

test("保底：present_npcs 过滤 _npc 占位键", () => {
    setupMinimalWorld();
    S.gameState.current_location = "庭院";
    S.gameState.present_npcs = ["guide_npc", "真实NPC"];
    S.gameState.revealed_locations = [];
    const joined = buildSmartFallbackChoices().map(c => c.text).join(" | ");
    assert.ok(joined.includes("与真实NPC交谈"), `应出现真实NPC交谈：${joined}`);
    assert.ok(!joined.includes("guide_npc"), `应过滤 _npc 占位：${joined}`);
});

test("保底：present_npcs 与 revealed_locations 都有时，两者选项均出现且数量 3-4", () => {
    setupMinimalWorld();
    S.gameState.current_location = "庭院";
    S.gameState.present_npcs = ["宝玉"];
    S.gameState.revealed_locations = ["潇湘馆"];
    const choices = buildSmartFallbackChoices();
    assert.ok(choices.length >= 3 && choices.length <= 4, `数量越界：${choices.length}`);
    const joined = choices.map(c => c.text).join(" | ");
    assert.ok(joined.includes("与宝玉交谈"), `应出现交谈选项：${joined}`);
    assert.ok(joined.includes("前往潇湘馆"), `应出现前往选项：${joined}`);
});
