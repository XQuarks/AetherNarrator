// ============================================================
// docs/75 关系升级门控——接入 applyStateChanges 的端到端测试
// 验证：relationship_upgrade + affinity 双开、且 gate.active===false 时，回合结算确定性自动升级并推 pendingRelationshipEvents；
// 默认 active:true（须玩家主动）与模块关闭时，均不自动升级（不破坏既有好感契约）。
// 与 74 集成测试同款 DOM 宽容 stub，令 game.js 模块图可在 node 中求值。
// ============================================================

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
const rg = await import("../src/relationship-gating.js");
const { getTierIndex } = rg;

function setup({ relOn = true, affOn = true, gates } = {}) {
    S.currentWorld = {
        id: "w_rel", rules: [], lore_kb: { snippets: [] },
        modules: {
            affinity: { enabled: affOn },
            relationship_upgrade: { enabled: relOn },
        },
        relationship_upgrade: gates ? { gates } : undefined,
    };
    S.activeLoreKB = { snippets: [] };
    S.gameState = defaultInitialState();
}

test("双开 + 自动门控（active:false）：回合结算确定性自动升级并推事件", () => {
    setup({ gates: [{ threshold: 20, active: false }] });
    applyStateChanges({ bonds: { 小红: { delta: 25, tags: [], desc: "初识" } } });
    assert.equal(S.gameState.bonds["小红"].affinity, 25);
    assert.equal(getTierIndex(S.gameState, "小红"), 1); // 自动升入 相识
    assert.equal(S.gameState.pendingRelationshipEvents.length, 1);
    assert.deepEqual(S.gameState.pendingRelationshipEvents[0], { type: "rel_upgrade", npc: "小红", fromTier: 0, toTier: 1 });
});

test("默认门控（active:true）：回合结算不自动升级（须玩家主动）", () => {
    setup({}); // 默认 gates 全 active:true
    applyStateChanges({ bonds: { 小红: { delta: 25, tags: [], desc: "初识" } } });
    assert.equal(S.gameState.bonds["小红"].affinity, 25);
    assert.equal(getTierIndex(S.gameState, "小红"), 0); // 未自动升级
    assert.equal(S.gameState.pendingRelationshipEvents.length, 0);
});

test("relationship_upgrade 关闭：完全无副作用", () => {
    setup({ relOn: false, affOn: true });
    applyStateChanges({ bonds: { 小红: { delta: 25, tags: [], desc: "初识" } } });
    assert.equal(S.gameState.bonds["小红"].affinity, 25);
    assert.equal(getTierIndex(S.gameState, "小红"), 0); // 无等级概念
    assert.equal(S.gameState.pendingRelationshipEvents.length, 0);
});

test("affinity 关闭：好感不应用、更无升级（门禁生效）", () => {
    setup({ relOn: true, affOn: false });
    applyStateChanges({ bonds: { 小红: { delta: 25, tags: [], desc: "初识" } } });
    assert.equal(S.gameState.bonds["小红"], undefined); // 好感未写入（affinity 关闭，bonds 仅被归一化为空对象，无 小红 数据）
    assert.equal(getTierIndex(S.gameState, "小红"), 0);  // 无等级概念
    assert.equal(S.gameState.pendingRelationshipEvents.length, 0);
});

test("未达阈值不升级：affinity 仅 10，门控阈值 20", () => {
    setup({ gates: [{ threshold: 20, active: false }] });
    applyStateChanges({ bonds: { 小红: { delta: 10, tags: [], desc: "点头之交" } } });
    assert.equal(getTierIndex(S.gameState, "小红"), 0);
    assert.equal(S.gameState.pendingRelationshipEvents.length, 0);
});
