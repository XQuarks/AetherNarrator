// ============================================================
// B3 背包/物品 测试（docs/32）
// 覆盖：applyStateChanges 物品增删保留 category/is_key + 关键手记；
//       formatStateChanges 获得/失去带 [关键] 标记；
//       buildItemUseHint 常驻指令；状态面板渲染（分类+关键高亮）通过纯函数逻辑间接验证。
// ============================================================

// 与 cognitive-state.test.js 同款 DOM 宽容 stub，令 game.js 模块图可在 node 中求值
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
const { buildItemUseHint, formatStateChanges } = await import("../src/prompt.js");

function setupWorld() {
    S.currentWorld = { id: "w_b3", rules: [], lore_kb: { snippets: [] } };
    S.activeLoreKB = { snippets: [] };
    S.gameState = defaultInitialState();
    S.activeBehaviorRecords = [];
}

test("buildItemUseHint 返回非空且含 使用/关键 指令（常驻 system 静态段）", () => {
    const hint = buildItemUseHint();
    assert.ok(typeof hint === "string" && hint.length > 20, "应返回非空指令串");
    assert.ok(hint.includes("使用"), "应提示优先给「使用 X」选项");
    assert.ok(hint.includes("关键"), "应提及关键物品");
    assert.ok(hint.includes("category"), "应给出 category 取值说明");
});

test("applyStateChanges：add 新物品写入 category/is_key", () => {
    setupWorld();
    applyStateChanges({ inventory: [{ op: "add", item_id: "key_rune", name: "符文钥匙", count: 1, category: "线索", is_key: true }] });
    const it = S.gameState.inventory.find(i => i.item_id === "key_rune");
    assert.ok(it, "物品应被加入背包");
    assert.equal(it.category, "线索", "category 应保留");
    assert.equal(it.is_key, true, "is_key 应保留");
});

test("applyStateChanges：add 已存在物品合并数量并保留原 category/is_key", () => {
    setupWorld();
    S.gameState.inventory = [{ item_id: "herb", name: "草药", count: 1, category: "消耗品", is_key: false, tags: [] }];
    applyStateChanges({ inventory: [{ op: "add", item_id: "herb", name: "草药", count: 2, category: "线索", is_key: true }] });
    const it = S.gameState.inventory.find(i => i.item_id === "herb");
    assert.equal(it.count, 3, "数量应累加");
    assert.equal(it.category, "消耗品", "合并时保留原 category");
    assert.equal(it.is_key, false, "合并时保留原 is_key");
});

test("applyStateChanges：remove 扣减归零移除", () => {
    setupWorld();
    S.gameState.inventory = [{ item_id: "herb", name: "草药", count: 2, category: "消耗品", is_key: false, tags: [] }];
    applyStateChanges({ inventory: [{ op: "remove", item_id: "herb", count: 2 }] });
    assert.ok(!S.gameState.inventory.find(i => i.item_id === "herb"), "归零应移除");
});

test("applyStateChanges：关键物品获得 → 写入强调手记（importance 高 / type=item）", () => {
    setupWorld();
    applyStateChanges({ inventory: [{ op: "add", item_id: "key_rune", name: "符文钥匙", count: 1, category: "线索", is_key: true }] });
    const rec = S.activeBehaviorRecords.find(r => r.type === "item" && (r.text || "").includes("符文钥匙"));
    assert.ok(rec, "应生成一条 type=item 的关键物品手记");
    assert.equal(rec.importance, 5, "关键物品手记 importance 应取上限 5");
});

test("applyStateChanges：普通物品获得 → 不写 type=item 手记", () => {
    setupWorld();
    applyStateChanges({ inventory: [{ op: "add", item_id: "herb", name: "草药", count: 1, category: "消耗品", is_key: false }] });
    assert.ok(!S.activeBehaviorRecords.some(r => r.type === "item"), "普通物品不应生成 type=item 手记");
});

test("formatStateChanges：关键物品获得带 [关键] 标记", () => {
    const entry = { state_changes: { inventory: [{ op: "add", item_id: "key_rune", name: "符文钥匙", is_key: true }] } };
    const lines = formatStateChanges(entry, null);
    assert.ok(lines.some(l => l.includes("获得") && l.includes("[关键]") && l.includes("符文钥匙")), "应出现「获得 [关键] 符文钥匙」");
});

test("formatStateChanges：普通物品获得无 [关键] 标记", () => {
    const entry = { state_changes: { inventory: [{ op: "add", item_id: "herb", name: "草药", is_key: false }] } };
    const lines = formatStateChanges(entry, null);
    assert.ok(lines.some(l => l.includes("获得") && l.includes("草药")), "应出现「获得 草药」");
    assert.ok(!lines.some(l => l.includes("[关键]")), "普通物品不应带 [关键]");
});

test("formatStateChanges：关键物品失去带 [关键] 标记", () => {
    const entry = { state_changes: { inventory: [{ op: "remove", item_id: "key_rune", name: "符文钥匙", is_key: true }] } };
    const lines = formatStateChanges(entry, null);
    assert.ok(lines.some(l => l.includes("失去") && l.includes("[关键]") && l.includes("符文钥匙")), "应出现「失去 [关键] 符文钥匙」");
});
