// ============================================================
// docs/75 关系升级门控——判定引擎纯函数测试
// 验证：阈值/节点/主动三类门控的判定、确定性升级、等级阶梯与文案、老档缺省兼容。
// 载入 prompt.js（经 relationship-gating.js）需要 DOM 宽容 stub，与 74 集成测试同款。
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

const rg = await import("../src/relationship-gating.js");
const {
    DEFAULT_TIERS, DEFAULT_GATES,
    getTiers, getGates, getTierIndex, nextGate,
    thresholdMet, nodeMet, isEligible, applyRelationshipUpgrade, upgradeLabel
} = rg;

function gs(bonds) { return { bonds: bonds || {} }; }
function world(over) { return { relationship_upgrade: over || {} }; }

// 默认世界（无 relationship_upgrade 配置）→ 用代码默认
const W0 = {};

test("默认阶梯与门控：五阶 + [20,40,60,80] 阈值", () => {
    assert.deepEqual(getTiers(W0), ["陌生人", "相识", "朋友", "挚友", "恋人"]);
    assert.deepEqual(getGates(W0).map(g => g.threshold), [20, 40, 60, 80]);
    assert.equal(getGates(W0).length, 4); // 5 阶 → 4 道门
});

test("getTierIndex：老档无 tier 默认 0", () => {
    assert.equal(getTierIndex(gs({}), "小红"), 0);
    assert.equal(getTierIndex(gs({ 小红: { affinity: 50 } }), "小红"), 0);
    assert.equal(getTierIndex(gs({ 小红: { affinity: 50, tier: 2 } }), "小红"), 2);
});

test("nextGate：按当前 tier 取下一门；顶级返回 null", () => {
    assert.deepEqual(nextGate(W0, gs({}), "小红"), { threshold: 20, active: true });
    assert.deepEqual(nextGate(W0, gs({ 小红: { tier: 1 } }), "小红"), { threshold: 40, active: true });
    assert.equal(nextGate(W0, gs({ 小红: { tier: 4 } }), "小红"), null); // 恋人=最高级
});

test("thresholdMet：复用 bond 条件（affinity >= N）", () => {
    const s = gs({ 小红: { affinity: 40 } });
    assert.equal(thresholdMet(s, "小红", 40), true);
    assert.equal(thresholdMet(s, "小红", 41), false);
    assert.equal(thresholdMet(s, "小红", 20), true);
});

test("nodeMet：无 node 默认满足；带 location 条件时按 evalEventConditions 判定", () => {
    const s = gs({ 小红: { affinity: 99 } });
    assert.equal(nodeMet(W0, s, null), true);
    const node = { conditions: [{ type: "location", value: "老家" }], condition_mode: "all" };
    assert.equal(nodeMet(W0, gs({ 小红: { affinity: 99, location: "老家" } }), node), false); // location 看 current_location
    assert.equal(nodeMet(W0, { ...s, current_location: "老家" }, node), true);
});

test("isEligible：阈值达标即具备资格（忽略 active）", () => {
    assert.equal(isEligible(W0, gs({ 小红: { affinity: 19 } }), "小红"), false);
    assert.equal(isEligible(W0, gs({ 小红: { affinity: 20 } }), "小红"), true);
    assert.equal(isEligible(W0, gs({ 小红: { affinity: 80, tier: 3 } }), "小红"), true); // → 恋人
    assert.equal(isEligible(W0, gs({ 小红: { affinity: 99, tier: 4 } }), "小红"), false); // 已顶级
});

test("isEligible：节点条件不满足则阻断", () => {
    const w = world({ gates: [{ threshold: 20, node: { conditions: [{ type: "location", value: "老家" }] }, active: true }] });
    // 注意：w 无 tiers → 用默认五阶，gates 只配了第一道；其余用默认补齐
    const ok = gs({ 小红: { affinity: 30 } });
    assert.equal(isEligible(w, ok, "小红"), false); // 没到过老家
    assert.equal(isEligible(w, { ...ok, current_location: "老家" }, "小红"), true);
});

test("applyRelationshipUpgrade：资格真才升级，推事件，每次+1级", () => {
    const s = gs({ 小红: { affinity: 20 } });
    const r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(r.ok, true);
    assert.equal(r.fromTier, 0);
    assert.equal(r.toTier, 1);
    assert.equal(s.bonds["小红"].tier, 1);
    assert.equal(s.pendingRelationshipEvents.length, 1);
    assert.deepEqual(s.pendingRelationshipEvents[0], { type: "rel_upgrade", npc: "小红", fromTier: 0, toTier: 1 });
});

test("applyRelationshipUpgrade：资格假返回 ok:false 且不改状态", () => {
    const s = gs({ 小红: { affinity: 10 } });
    const r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(r.ok, false);
    assert.equal(s.bonds["小红"].tier, undefined);
    assert.equal(s.pendingRelationshipEvents.length, 0);
});

test("applyRelationshipUpgrade：已顶级返回 ok:false", () => {
    const s = gs({ 小红: { affinity: 99, tier: 4 } });
    const r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(r.ok, false);
});

test("applyRelationshipUpgrade：bond 不存在时懒创建", () => {
    const s = gs({});
    applyRelationshipUpgrade(W0, gs({ 小红: { affinity: 25 } }), "小红");
});

test("连续升级：资格逐阶满足可逐回合升，直至顶级", () => {
    const s = gs({ 小红: { affinity: 85 } }); // 一次性达线，但每次只升 1 级
    let r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(r.ok, true);
    assert.equal(s.bonds["小红"].tier, 1);
    // 升到第 2 级（仍是 active 通道，手动再调模拟玩家跨回合点击/自动结算）
    r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(s.bonds["小红"].tier, 2);
    r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(s.bonds["小红"].tier, 3);
    r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(s.bonds["小红"].tier, 4);
    r = applyRelationshipUpgrade(W0, s, "小红");
    assert.equal(r.ok, false); // 恋人已顶级
});

test("upgradeLabel：情境化文案（恋人→表白 / 挚友→深交 / 其余→增进关系）", () => {
    assert.equal(upgradeLabel(W0, 4), "表白");   // → 恋人
    assert.equal(upgradeLabel(W0, 3), "深交");   // → 挚友
    assert.equal(upgradeLabel(W0, 1), "增进关系"); // → 朋友
    assert.equal(upgradeLabel(W0, 2), "增进关系"); // → 挚友? 否，toTier=2 升入 tiers[2]=朋友 → 增进关系
});

test("upgradeLabel：世界配置覆盖文案", () => {
    // toTierIndex=1 → 相识；toTierIndex=4 → 恋人
    const w = world({ upgrade_labels: { 恋人: "求婚", 相识: "拜把子" } });
    assert.equal(upgradeLabel(w, 4), "求婚");
    assert.equal(upgradeLabel(w, 1), "拜把子");
});

test("创作者覆盖阶梯与逐阶门控", () => {
    const w = world({ tiers: ["陌生人", "朋友", "挚友", "恋人"], gates: [{ threshold: 30 }, { threshold: 60 }, { threshold: 90 }] });
    assert.deepEqual(getTiers(w), ["陌生人", "朋友", "挚友", "恋人"]);
    assert.deepEqual(getGates(w).map(g => g.threshold), [30, 60, 90]);
    // gates 长度 = 3 = tiers.length - 1
    assert.equal(isEligible(w, gs({ 小红: { affinity: 30 } }), "小红"), true);
    assert.equal(isEligible(w, gs({ 小红: { affinity: 20 } }), "小红"), false);
});

test("创作者门控不足：自动补齐默认不可达段", () => {
    const w = world({ gates: [{ threshold: 10 }] }); // 5 阶但只配 1 道
    const gates = getGates(w);
    assert.equal(gates.length, 4);
    assert.equal(gates[0].threshold, 10);
    assert.equal(gates[3].threshold, 9999); // 兜底不可达
});
