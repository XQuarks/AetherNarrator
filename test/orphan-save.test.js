// ============================================================
// 孤儿存档「世界已删除」提醒（docs/19）回归测试
// 覆盖：列表徽章、详情弹窗、loadSave 防御性判空，确保世界被删后
// 不再崩溃、给出清晰提醒，且不会误把内存中其它世界带入 S.currentWorld。
// ============================================================

// 与 load-check.mjs / fallback-choices.test.js 同款 DOM 宽容 stub，令模块图可在 node 中求值
const any = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : any),
    apply: () => any,
    construct: () => any,
    has: () => true,
});
const def = (k, v) => { try { globalThis[k] = v; } catch { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } };
def("window", globalThis);
def("navigator", { userAgent: "node", language: "zh" });
def("location", { href: "http://localhost/", origin: "http://localhost" });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = () => Promise.reject(new Error("stub-fetch"));
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.alert = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, addListener: () => {} });

import test from "node:test";
import assert from "node:assert/strict";

const { S } = await import("../src/store.js");
const { renderSaveList, renderSaveDetail } = await import("../src/render.js");
const { loadSave } = await import("../src/game.js");

// 可捕获 innerHTML/textContent 的轻量假 DOM（覆盖 render.js 的 getElementById 调用）
function makeEl() {
    return {
        _html: "",
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = v; },
        textContent: "",
        classList: { add() {}, remove() {}, contains() { return false; } },
        setAttribute() {}, removeAttribute() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        focus() {},
        dataset: {},
    };
}
const els = {};
const fakeDoc = {
    getElementById: (id) => (els[id] || (els[id] = makeEl())),
    querySelectorAll: () => [],
    querySelector: () => null,
    body: makeEl(),
    activeElement: null,
    addEventListener() {},
};
// 模块在调用时才读 document，导入完成后再覆盖为可捕获的假 DOM
globalThis.document = fakeDoc;

test("孤儿存档在列表显示「世界已删除」徽章，按钮为「查看」而非「继续游玩」", () => {
    S.worlds = [{ id: "w_alive", name: "现存世界" }];
    S.saves = [
        { id: "s_orphan", worldId: "w_gone", worldName: "旧世界", progress: "第1天", updatedAt: "2026-01-01" },
        { id: "s_ok", worldId: "w_alive", worldName: "现存世界", progress: "第2天", updatedAt: "2026-02-02" },
    ];
    renderSaveList();
    const html = els["saveListContent"].innerHTML;
    assert.ok(html.includes("世界已删除"), "孤儿存档应显示「世界已删除」徽章");
    assert.ok(html.includes('data-id="s_orphan">查看</button>'), "孤儿存档按钮应为「查看」");
    assert.ok(!html.includes('data-id="s_orphan">继续游玩</button>'), "孤儿存档不应是「继续游玩」");
    assert.ok(html.includes('data-id="s_ok">继续游玩</button>'), "正常存档按钮应为「继续游玩」");
    assert.ok(!html.includes('data-id="s_ok">查看</button>'), "正常存档不应是「查看」");
});

test("孤儿存档详情弹窗提示无法游玩，footer 不含「继续游戏」按钮", () => {
    S.worlds = [{ id: "w_alive", name: "现存世界" }];
    S.currentWorld = { id: "w_alive", name: "现存世界" }; // 模拟内存中已有另一个世界
    S.saves = [{ id: "s_orphan", worldId: "w_gone", worldName: "旧世界", progress: "第1天", updatedAt: "2026-01-01" }];
    renderSaveDetail("s_orphan");
    const body = els["detailSaveBody"].innerHTML;
    const footer = els["detailSaveModalFooter"].innerHTML;
    assert.ok(body.includes("无法继续游玩"), "详情应提示无法游玩");
    assert.ok(footer.includes("删除该存档"), "footer 应有「删除该存档」");
    assert.ok(!footer.includes('data-action="loadSave"'), "孤儿存档 footer 不应有「继续游戏」按钮");
    // 关键回归：世界缺失时不得把 S.currentWorld 误赋值为已删除世界（原 bug 会带入上一个世界）
    assert.strictEqual(S.currentWorld && S.currentWorld.id, "w_alive", "世界缺失时不应误改 S.currentWorld");
});

test("正常存档详情仍含「继续游戏」按钮且正确赋值 S.currentWorld", () => {
    S.worlds = [{ id: "w_alive", name: "现存世界" }];
    S.currentWorld = null;
    S.saves = [{ id: "s_ok", worldId: "w_alive", worldName: "现存世界", progress: "第1天", updatedAt: "2026-01-01" }];
    renderSaveDetail("s_ok");
    const footer = els["detailSaveModalFooter"].innerHTML;
    assert.ok(footer.includes('data-action="loadSave"'), "正常存档 footer 应有「继续游戏」");
    assert.ok(!footer.includes("删除该存档"), "正常存档 footer 不应是「删除该存档」");
    assert.strictEqual(S.currentWorld && S.currentWorld.id, "w_alive", "世界存在时应正确赋值 S.currentWorld");
});

test("loadSave 对世界缺失存档防御性提前返回，不进入游戏、不崩溃", () => {
    S.worlds = [{ id: "w_alive", name: "现存世界" }];
    S.currentWorld = { id: "w_alive" };
    S.gameState = "PRE_GUARD"; // 标记：若 prepareSessionFromSave 被调用会被覆盖
    S.saves = [{ id: "s_orphan", worldId: "w_gone", worldName: "旧世界" }];
    // 不应抛错（原实现会带着 null 的 currentWorld 进游戏而崩溃）
    assert.doesNotThrow(() => loadSave("s_orphan"));
    // 关键：提前返回，未调用 prepareSessionFromSave（gameState 保持标记值）
    assert.strictEqual(S.gameState, "PRE_GUARD", "世界缺失时不应进入 prepareSessionFromSave");
    assert.strictEqual(S.currentWorld && S.currentWorld.id, "w_alive", "currentWorld 不应被改动");
});
