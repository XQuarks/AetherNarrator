// ============================================================
// docs/74 技能成长容器——接入 applyStateChanges 的端到端测试
// 验证：skills 模块开启时，state_changes.skills 的 {result} 信封被正确路由到确定性成长引擎，
// 跨阈值升星并推入 pendingGrowthEvents；且绝不触碰 s.skills 字符串契约；旧式字符串描述仍兼容。
// ============================================================

// 与 cognitive-state.test.js / 32-inventory.test.js 同款 DOM 宽容 stub，令 game.js 模块图可在 node 中求值
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
try { await import("fake-indexeddb/auto"); } catch { process.on("unhandledRejection", () => {}); }

import test from "node:test";
import assert from "node:assert/strict";

const { S } = await import("../src/store.js");
const { defaultInitialState } = await import("../src/utils.js");
const { applyStateChanges } = await import("../src/game.js");

function setup(enableSkills) {
    S.currentWorld = {
        id: "w_sg", rules: [], lore_kb: { snippets: [] },
        modules: enableSkills ? { skills: { enabled: true } } : {}
    };
    S.activeLoreKB = { snippets: [] };
    S.gameState = defaultInitialState();
    S.activeBehaviorRecords = [];
}

test("applyStateChanges：skills 开启时 result:success 累加，第3次升1星并推入 pendingGrowthEvents", () => {
    setup(true);
    for (let i = 1; i <= 3; i++) applyStateChanges({ skills: { "火焰咒": { result: "success" } } });
    assert.equal(S.gameState.skill_growth["火焰咒"].successCount, 3);
    assert.equal(S.gameState.skill_growth["火焰咒"].stars, 1);
    assert.ok(Array.isArray(S.gameState.pendingGrowthEvents));
    const up = S.gameState.pendingGrowthEvents.find(e => e.type === "skill_up" && e.name === "火焰咒");
    assert.ok(up, "应有升星事件");
    assert.equal(up.oldStars, 0);
    assert.equal(up.newStars, 1);
    // ★ 关键：s.skills 字符串契约不被成长引擎触碰
    assert.deepEqual(S.gameState.skills, {});
});

test("applyStateChanges：result:fail 不累加、不升星", () => {
    setup(true);
    applyStateChanges({ skills: { "剑术": { result: "fail" } } });
    assert.equal(S.gameState.skill_growth["剑术"].successCount, 0);
    assert.equal(S.gameState.skill_growth["剑术"].stars, 0);
    assert.equal(S.gameState.pendingGrowthEvents.length, 0);
});

test("applyStateChanges：skills 模块关闭时不处理成长（不污染状态）", () => {
    setup(false);
    applyStateChanges({ skills: { "火焰咒": { result: "success" } } });
    assert.equal(S.gameState.skill_growth["火焰咒"], undefined);
    assert.equal(S.gameState.pendingGrowthEvents.length, 0);
});

test("applyStateChanges：旧式字符串描述仍写 s.skills 文字层（历史契约兼容）", () => {
    setup(true);
    applyStateChanges({ skills: { "观星": "你学会在星图中辨认方位。" } });
    assert.equal(S.gameState.skills["观星"], "你学会在星图中辨认方位。");
    assert.equal(S.gameState.skill_growth["观星"], undefined);
});

test("applyStateChanges：连续成功跨多阈值，pendingGrowthEvents 记录每次升星", () => {
    setup(true);
    for (let i = 1; i <= 15; i++) applyStateChanges({ skills: { "魔药": { result: "success" } } });
    assert.equal(S.gameState.skill_growth["魔药"].stars, 3); // 第15次升到3星（封顶）
    const ups = S.gameState.pendingGrowthEvents.filter(e => e.type === "skill_up" && e.name === "魔药");
    // 第3/8/15次升星 → 3 条升星事件
    assert.equal(ups.length, 3);
    assert.deepEqual(ups.map(e => e.newStars), [1, 2, 3]);
});
