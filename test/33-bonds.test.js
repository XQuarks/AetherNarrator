// ============================================================
// B4 羁绊 / 好感度 测试（docs/33）
// 覆盖：initBondsFromWorld（人物卡 + initial_state.relationships 初始化）；
//       computeBondUpdates（delta 夹取 / tags 合并 / desc 回写 / 忽略无效）；
//       applyStateChanges（bonds 累加 + 回写文字层 + 关键羁绊手记）；
//       formatStateChanges（好感 Δ + 标签）；buildBondHint；defaultCharacter / ensureWorldCharacters 兜底。
// ============================================================

// 与 32-inventory.test.js 同款 DOM 宽容 stub，令 game.js 模块图可在 node 中求值
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

const { S, defaultCharacter, ensureWorldCharacters, initBondsFromWorld, computeBondUpdates } = await import("../src/store.js");
const { defaultInitialState } = await import("../src/utils.js");
const { applyStateChanges } = await import("../src/game.js");
const { buildBondHint, formatStateChanges } = await import("../src/prompt.js");

function setupWorld() {
    S.currentWorld = { id: "w_b4", rules: [], lore_kb: { snippets: [] } };
    // ★ C1：好感度/变量现在受模块开关控制；本测试专测 bonds，显式开启对应模块
    S.currentWorld.modules = { affinity: { enabled: true }, variables: { enabled: true } };
    S.activeLoreKB = { snippets: [] };
    S.gameState = defaultInitialState();
    S.activeBehaviorRecords = [];
}

test("initBondsFromWorld：从人物卡 + initial_state.relationships 初始化", () => {
    const world = {
        characters: [
            { id: "c1", role: "npc", name: "安吉尔教授", affinity: 10, rel_tags: ["中立学者"], relationship: "远亲" },
            { id: "c2", role: "protagonist", name: "", affinity: 99, rel_tags: [] } // 主角忽略
        ],
        initial_state: { relationships: { "亨利": "青年雕塑家" } }
    };
    const bonds = initBondsFromWorld(world);
    assert.equal(bonds["安吉尔教授"].affinity, 10, "人物卡好感应采用");
    assert.deepEqual(bonds["安吉尔教授"].tags, ["中立学者"], "标签应采用");
    assert.ok(!bonds["（玩家所扮演）"] && !bonds[""], "主角卡不应进入 bonds");
    assert.equal(bonds["亨利"].affinity, 0, "initial_state.relationships 的 NPC 也应纳入（好感默认 0）");
});

test("computeBondUpdates：delta 累加并夹取 [-100,100]", () => {
    const { next } = computeBondUpdates({ "X": { delta: 110 } }, { X: { affinity: 0, tags: [], desc: "" } });
    assert.equal(next["X"].affinity, 100, "应夹取上限 100");
    const { next: n2 } = computeBondUpdates({ "X": { delta: -50 } }, { X: { affinity: -80, tags: [], desc: "" } });
    assert.equal(n2["X"].affinity, -100, "应夹取下限 -100");
});

test("computeBondUpdates：tags 合并去重", () => {
    const { next } = computeBondUpdates({ "X": { tags: ["盟友", "盟友", "信任"] } }, { X: { affinity: 0, tags: ["盟友"], desc: "" } });
    assert.deepEqual(next["X"].tags, ["盟友", "信任"], "新标签应追加去重");
});

test("computeBondUpdates：desc 回写", () => {
    const { next } = computeBondUpdates({ "X": { desc: "新的关系描述" } }, { X: { affinity: 0, tags: [], desc: "旧" } });
    assert.equal(next["X"].desc, "新的关系描述", "desc 应更新");
});

test("computeBondUpdates：忽略非对象项", () => {
    const cur = { X: { affinity: 0, tags: [], desc: "" } };
    const { next } = computeBondUpdates({ "X": "字符串", "Y": 5, "Z": null }, cur);
    assert.equal(next["X"].affinity, 0, "无效项不应改变已有值");
    assert.ok(!next["Y"] && !next["Z"], "无效项不应创建条目");
});

test("applyStateChanges：bonds 累加 + 回写文字关系层", () => {
    setupWorld();
    S.gameState.bonds = { "亨利": { affinity: 0, tags: [], desc: "" } };
    applyStateChanges({ bonds: { "亨利": { delta: -20, desc: "亨利开始戒备你" } } });
    assert.equal(S.gameState.bonds["亨利"].affinity, -20, "好感应累加");
    assert.equal(S.gameState.relationships["亨利"], "亨利开始戒备你", "文字关系层应被回写");
    assert.deepEqual(S.gameState.bonds["亨利"].tags, [], "无 tags 时保持空数组");
});

test("applyStateChanges：好感跨入关键阈值 → 写 relationship 手记（importance 上限 5）", () => {
    setupWorld();
    S.gameState.bonds = { "安吉尔教授": { affinity: 75, tags: [], desc: "远亲" } };
    applyStateChanges({ bonds: { "安吉尔教授": { delta: 10 } } });
    assert.equal(S.gameState.bonds["安吉尔教授"].affinity, 85, "好感应累加至 85");
    const rec = S.activeBehaviorRecords.find(r => r.type === "relationship");
    assert.ok(rec, "应生成一条 type=relationship 的关键羁绊手记");
    assert.equal(rec.importance, 5, "关键羁绊手记 importance 应为 5（上限）");
});

test("formatStateChanges：bonds 渲染好感 Δ + 标签", () => {
    const lines = formatStateChanges({ state_changes: { bonds: { "安吉尔教授": { delta: 10, tags: ["信任"] } } } }, {});
    assert.ok(Array.isArray(lines) && lines.length === 1, "应返回一条变化");
    assert.ok(lines[0].includes("安吉尔教授"), "应包含 NPC 名");
    assert.ok(lines[0].includes("+10"), "应含好感 +10");
    assert.ok(lines[0].includes("信任"), "应含标签");
});

test("buildBondHint 返回非空且含 好感/delta 指令", () => {
    const hint = buildBondHint();
    assert.ok(typeof hint === "string" && hint.length > 20, "应返回非空指令串");
    assert.ok(hint.includes("好感度") || hint.includes("affinity"), "应提及好感度");
    assert.ok(hint.includes("delta"), "应给出 delta 契约说明");
    assert.ok(hint.includes("宿敌") || hint.includes("盟友"), "应给出关系驱动选项示例");
});

test("defaultCharacter 含 B4 默认字段", () => {
    const c = defaultCharacter("npc");
    assert.equal(c.affinity, 0, "affinity 默认 0");
    assert.deepEqual(c.rel_tags, [], "rel_tags 默认空数组");
});

test("ensureWorldCharacters：兜底 affinity/rel_tags 脏数据", () => {
    const w = { characters: [{ id: "c1", role: "npc", name: "X", affinity: "高", rel_tags: "盟友" }] };
    ensureWorldCharacters(w);
    assert.equal(w.characters[0].affinity, 0, "非数字 affinity 应兜底为 0");
    assert.deepEqual(w.characters[0].rel_tags, [], "非数组 rel_tags 应兜底为空数组");
});
