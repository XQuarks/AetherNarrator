// docs/54 · 规则可视化与结局系统增强 —— 纯函数单测
// 覆盖：evaluateEndingStatus（四类 when 的 met / 数值类 progress / kind 缺省 / 旧档兼容）、
//       evalWhen / compareState 导出、appendUniqueEnding 去重、unlockedEndings 缺省归一。
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEndingStatus, evalWhen, compareState, appendUniqueEnding, ENDING_KINDS } from "../src/worldview.js";
import { defaultInitialState } from "../src/utils.js";
import { normalizeSimulationState } from "../src/simulation.js";

const WORLD = {
    rules: [
        { id: "r1", name: "破产结局", enabled: true, when: { type: "state", field: "gold", op: "<", value: 0 }, then: { type: "ending", reason: "你破产了", title: "破产结局", kind: "bad" } },
        // 旧档：无 title / kind，应回退 normal + 名称兜底
        { id: "r2", name: "", enabled: true, when: { type: "state", field: "gold", op: "<", value: 100 }, then: { type: "ending", reason: "快破产了" } },
        { id: "r3", name: "富甲一方", enabled: true, when: { type: "state", field: "gold", op: ">", value: 1000 }, then: { type: "ending", reason: "你成了首富", title: "首富", kind: "good" } },
        { id: "r4", name: "标签结局", enabled: true, when: { type: "tag", tag: "rich" }, then: { type: "ending", reason: "你是有钱人", kind: "true" } },
        { id: "r5", name: "概念结局", enabled: true, when: { type: "concept", term: "破产" }, then: { type: "ending", reason: "文本触发" } },
        { id: "r6", name: "常驻结局", enabled: true, when: { type: "always" }, then: { type: "ending", reason: "始终结局" } },
        // 禁项规则不应出现在结局列表
        { id: "rb", name: "禁项", enabled: true, when: { type: "always" }, then: { type: "ban", concept: "核弹" } }
    ]
};

const GS = { state: { gold: 50 }, tags: ["rich"] };

function byId(list, id) { return list.find(e => e.ruleId === id); }

test("evalWhen / compareState 已导出为函数", () => {
    assert.equal(typeof evalWhen, "function");
    assert.equal(typeof compareState, "function");
    assert.ok(Array.isArray(ENDING_KINDS) && ENDING_KINDS.includes("secret"));
});

test("evaluateEndingStatus：仅返回 ending 规则（不含 ban）", () => {
    const list = evaluateEndingStatus(WORLD, GS, "有人破产了");
    assert.equal(list.length, 6);
    assert.ok(!list.some(e => e.ruleId === "rb"));
});

test("evaluateEndingStatus：state 数值类 met 与 progress", () => {
    const list = evaluateEndingStatus(WORLD, GS, "x");
    const r1 = byId(list, "r1"); // gold(50) < 0 ?
    assert.equal(r1.met, false);
    assert.equal(r1.progress, 0); // target===0 时给 0（远未触发）
    const r2 = byId(list, "r2"); // gold(50) < 100 ?
    assert.equal(r2.met, true);
    assert.equal(r2.progress, 1);
    const r3 = byId(list, "r3"); // gold(50) > 1000 ?
    assert.equal(r3.met, false);
    assert.ok(Math.abs(r3.progress - 0.05) < 1e-9); // 50/1000
});

test("evaluateEndingStatus：tag / concept / always 三类 met 与 progress=null", () => {
    const list = evaluateEndingStatus(WORLD, GS, "有人破产了");
    const r4 = byId(list, "r4"); // tag rich 活跃
    assert.equal(r4.met, true);
    assert.equal(r4.progress, null);
    const r5 = byId(list, "r5"); // 文本含「破产」
    assert.equal(r5.met, true);
    assert.equal(r5.progress, null);
    const r6 = byId(list, "r6"); // 始终
    assert.equal(r6.met, true);
    assert.equal(r6.progress, null);
});

test("evaluateEndingStatus：kind 缺省回退 normal，旧档无 title 用名称兜底", () => {
    const list = evaluateEndingStatus(WORLD, GS, "x");
    const r2 = byId(list, "r2");
    assert.equal(r2.kind, "normal");
    assert.equal(r2.title, "结局"); // name 为空 → 兜底「结局」
    const r1 = byId(list, "r1");
    assert.equal(r1.kind, "bad");
    assert.equal(r1.title, "破产结局");
});

test("evaluateEndingStatus：无 ending 规则返回空数组", () => {
    const list = evaluateEndingStatus({ rules: [{ id: "x", then: { type: "ban", concept: "a" } }] }, GS, "x");
    assert.deepEqual(list, []);
    const empty = evaluateEndingStatus({}, GS, "x");
    assert.deepEqual(empty, []);
});

test("appendUniqueEnding：按 ruleId 去重 + 缺省兜底", () => {
    let list = [];
    list = appendUniqueEnding(list, { ruleId: "r1", title: "A", kind: "bad" });
    assert.equal(list.length, 1);
    // 重复 ruleId 不追加
    list = appendUniqueEnding(list, { ruleId: "r1", title: "A2" });
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "A");
    // 新 ruleId，无 title/kind → 兜底
    list = appendUniqueEnding(list, { ruleId: "r2" });
    assert.equal(list.length, 2);
    assert.equal(list[1].title, "结局");
    assert.equal(list[1].kind, "normal");
    // 无 ruleId → 兜底 __death__
    list = appendUniqueEnding(list, {});
    assert.equal(list.length, 3);
    assert.equal(list[2].ruleId, "__death__");
    // __death__ 去重
    list = appendUniqueEnding(list, { ruleId: "__death__" });
    assert.equal(list.length, 3);
});

test("defaultInitialState 含 unlockedEndings:[]", () => {
    const s = defaultInitialState();
    assert.ok(Array.isArray(s.unlockedEndings) && s.unlockedEndings.length === 0);
});

test("normalizeSimulationState 兜底 unlockedEndings 为数组", () => {
    const a = normalizeSimulationState({});
    assert.ok(Array.isArray(a.unlockedEndings));
    const b = normalizeSimulationState({ unlockedEndings: [{ ruleId: "r1" }] });
    assert.equal(b.unlockedEndings.length, 1);
});
