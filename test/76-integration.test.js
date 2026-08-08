// ★ docs/76 Phase C：接入结算集成测试（影响度累计 + 越线自动 fork + 门禁）
import assert from "node:assert";
import test from "node:test";

// DOM 宽容 stub：让模块图能在 node 加载（render.js / store.js 依赖 document/window）
const any = new Proxy(function () { }, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : any),
    apply: () => any, construct: () => any, has: () => true
});
const def = (k, v) => { try { globalThis[k] = v; } catch { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } };
def("window", globalThis);
def("document", any);
def("navigator", { userAgent: "node", language: "zh" });
def("location", { href: "http://localhost/", origin: "http://localhost" });
globalThis.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { }, clear: () => { } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = () => Promise.reject(new Error("x"));
globalThis.requestAnimationFrame = c => setTimeout(c, 0);
globalThis.cancelAnimationFrame = () => { };
globalThis.alert = () => { };
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => { }, addListener: () => { } });

let S, applyStateChanges, defaultInitialState;

test.before(async () => {
    const store = await import("../src/store.js");
    S = store.S;
    const g = await import("../src/game.js");
    applyStateChanges = g.applyStateChanges;
    const u = await import("../src/utils.js");
    defaultInitialState = u.defaultInitialState;
});

function setup({ parallelOn }) {
    S.currentWorld = {
        id: "w", rules: [], lore_kb: [
            { title: "loreA", unlock_stage: 2 },
            { title: "loreB", unlock_stage: 5 }
        ],
        modules: { parallel_narrative: { enabled: parallelOn } }
    };
    S.activeLoreKB = { snippets: [] };
    S.gameState = defaultInitialState();
}

test("parallel_narrative 关闭：不影响度累计、无分岔", () => {
    setup({ parallelOn: false });
    applyStateChanges({ bonds: { 小红: { delta: 200 } } });
    assert.equal(S.gameState.player_influence, 0);
    assert.equal(S.gameState.active_narrative_layer, "main");
});

test("parallel_narrative 开启：影响度累计（好感 delta 加权）", () => {
    setup({ parallelOn: true });
    applyStateChanges({ bonds: { 小红: { delta: 30 } } }); // 30 * 1 = 30
    assert.equal(S.gameState.player_influence, 30);
    assert.ok(S.gameState.narrative_layers && S.gameState.narrative_layers.main, "应初始化主线");
});

test("影响度越线 → 自动 fork 新叙事层（蝴蝶效应）", () => {
    setup({ parallelOn: true });
    applyStateChanges({ bonds: { 小红: { delta: 120 } } }); // 120 ≥ 100 阈值
    assert.ok(S.gameState.player_influence >= 100);
    assert.ok(S.gameState.narrative_layers["layer_1"], "应派生 layer_1");
    assert.equal(S.gameState.active_narrative_layer, "layer_1");
    assert.ok(S.gameState.consumed_influence_tiers.includes(100), "档位应被消费");
    assert.ok(Array.isArray(S.gameState.pendingInfluenceEvents) && S.gameState.pendingInfluenceEvents.length >= 1);
});

test("跨阶解锁 lore 计入影响度", () => {
    setup({ parallelOn: true });
    // 剧情进度 1→3 解锁 loreA(unlock_stage=2)，无其它维度 → 仅 loreUnlocked=1 * 8 = 8
    applyStateChanges({ story_progress: 3 });
    assert.equal(S.gameState.player_influence, 8);
});

test("档位消费后不重复 fork（每回合至多一层）", () => {
    setup({ parallelOn: true });
    applyStateChanges({ bonds: { 小红: { delta: 500 } } }); // 一次大跳变，默认单档 [100]
    const layerKeys = Object.keys(S.gameState.narrative_layers);
    assert.equal(layerKeys.length, 2); // main + layer_1（不一次派生多层）
});

test("influence 条件可经 evalCondition 判定", async () => {
    const { evalCondition } = await import("../src/prompt.js");
    const ctx = { gameState: { player_influence: 150 }, world: {} };
    assert.equal(evalCondition({ type: "influence", value: 100 }, ctx), true);
    assert.equal(evalCondition({ type: "influence", value: 200 }, ctx), false);
    assert.equal(evalCondition({ type: "influence", value: 100, op: "<" }, ctx), false);
});
