// Phase 2：规则 DSL 解释器单元测试
// 覆盖 evaluateRules 的条件/动作求值、severity、enabled 开关、旧版兼容、ending 触发。
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRules, legacyBanEntry } from "../src/worldview.js";

// 工具：构造一个带 rules 的世界
function worldWithRules(rules) {
    return { id: "w_test", name: "测试世界", rules };
}

const gs = (over) => Object.assign({ state: {}, tags: [], inventory: [], present_npcs: [] }, over);

test("旧版 bannedConcepts 回退：无 rules 时返回 legacy 禁用词", () => {
    const w = { bannedConcepts: [{ concept: "手机", unlockTags: ["modern_unlock"] }, "电脑"] };
    const r = evaluateRules(w, gs());
    assert.equal(r.bannedConcepts.length, 2);
    assert.deepEqual(r.tagOps, []);
    assert.deepEqual(r.endings, []);
    assert.equal(r.bannedConcepts[0].concept, "手机");
    assert.deepEqual(r.bannedConcepts[0].unlockTags, ["modern_unlock"]);
    assert.equal(r.bannedConcepts[1].concept, "电脑");
});

test("ban 规则（when.always）并入 bannedConcepts，severity 保留", () => {
    const w = worldWithRules([
        { id: "r1", name: "禁核", enabled: true, when: { type: "always" }, then: { type: "ban", concept: "核弹", aliases: ["核武器"], severity: "hard", unlessTags: ["nuke_unlock"] } }
    ]);
    const r = evaluateRules(w, gs());
    assert.equal(r.bannedConcepts.length, 1);
    assert.equal(r.bannedConcepts[0].concept, "核弹");
    assert.equal(r.bannedConcepts[0].severity, "hard");
    assert.deepEqual(r.bannedConcepts[0].aliases, ["核武器"]);
    assert.deepEqual(r.bannedConcepts[0].unlockTags, ["nuke_unlock"]);
});

test("state 条件命中触发 ending，未命中不触发", () => {
    const w = worldWithRules([
        { id: "r1", name: "破产结局", enabled: true, when: { type: "state", field: "gold", op: "<", value: 0 }, then: { type: "ending", reason: "你破产了" } }
    ]);
    const hit = evaluateRules(w, gs({ state: { gold: -10 } }));
    assert.equal(hit.endings.length, 1);
    assert.equal(hit.endings[0].reason, "你破产了");

    const miss = evaluateRules(w, gs({ state: { gold: 50 } }));
    assert.equal(miss.endings.length, 0);
});

test("state 条件支持多种比较算子", () => {
    const mk = (op, val) => worldWithRules([
        { id: "r", enabled: true, when: { type: "state", field: "hp", op, value: val }, then: { type: "tag", op: "add", tag: "hurt" } }
    ]);
    assert.equal(evaluateRules(mk("<=", 10), gs({ state: { hp: 5 } })).tagOps.length, 1);
    assert.equal(evaluateRules(mk(">=", 10), gs({ state: { hp: 5 } })).tagOps.length, 0);
    assert.equal(evaluateRules(mk("==", "alive"), gs({ state: { hp: "alive" } })).tagOps.length, 1);
    assert.equal(evaluateRules(mk("!=", "alive"), gs({ state: { hp: "dead" } })).tagOps.length, 1);
    assert.equal(evaluateRules(mk(">", 3), gs({ state: { hp: 4 } })).tagOps.length, 1);
});

test("tag 条件：活跃标签触发 tag 动作，非活跃不触发", () => {
    const w = worldWithRules([
        { id: "r1", enabled: true, when: { type: "tag", tag: "war" }, then: { type: "ban", concept: "和平", severity: "soft" } }
    ]);
    const active = evaluateRules(w, gs({ tags: ["war"] }));
    assert.equal(active.bannedConcepts.length, 1);
    const inactive = evaluateRules(w, gs({ tags: [] }));
    assert.equal(inactive.bannedConcepts.length, 0);
});

test("concept 条件：匹配叙事文本触发 ending", () => {
    const w = worldWithRules([
        { id: "r1", enabled: true, when: { type: "concept", term: "末日" }, then: { type: "ending", reason: "世界末日降临" } }
    ]);
    const hit = evaluateRules(w, gs(), "就在那一刻，末日降临了");
    assert.equal(hit.endings.length, 1);
    const miss = evaluateRules(w, gs(), "风和日丽的一天");
    assert.equal(miss.endings.length, 0);
});

test("enabled=false 的规则被跳过", () => {
    const w = worldWithRules([
        { id: "r1", enabled: false, when: { type: "always" }, then: { type: "ban", concept: "X" } },
        { id: "r2", enabled: true, when: { type: "always" }, then: { type: "ban", concept: "Y" } }
    ]);
    const r = evaluateRules(w, gs());
    assert.deepEqual(r.bannedConcepts.map(b => b.concept), ["Y"]);
});

test("tag 动作 op=remove 正确产出", () => {
    const w = worldWithRules([
        { id: "r1", enabled: true, when: { type: "always" }, then: { type: "tag", op: "remove", tag: "peace" } }
    ]);
    const r = evaluateRules(w, gs());
    assert.deepEqual(r.tagOps, [{ op: "remove", tag: "peace" }]);
});

test("ending 动作返回 reason 与 ruleId", () => {
    const w = worldWithRules([
        { id: "death_rule", enabled: true, when: { type: "state", field: "is_alive", op: "==", value: false }, then: { type: "ending", reason: "角色死亡" } }
    ]);
    const r = evaluateRules(w, gs({ state: { is_alive: false } }));
    assert.equal(r.endings.length, 1);
    assert.equal(r.endings[0].ruleId, "death_rule");
    assert.equal(r.endings[0].reason, "角色死亡");
});

test("legacyBanEntry 兼容字符串与对象条目", () => {
    assert.deepEqual(legacyBanEntry("手机"), { concept: "手机", aliases: [], severity: "soft", unlockTags: [] });
    assert.deepEqual(legacyBanEntry({ concept: "枪", severity: "hard", unlockTags: ["u"] }),
        { concept: "枪", aliases: [], severity: "hard", unlockTags: ["u"] });
    assert.equal(legacyBanEntry(null), null);
    assert.equal(legacyBanEntry({ foo: 1 }), null);
});

test("world 为 null / 无 rules 时返回空约束", () => {
    assert.deepEqual(evaluateRules(null, gs()), { bannedConcepts: [], tagOps: [], endings: [] });
    assert.deepEqual(evaluateRules({}, gs()), { bannedConcepts: [], tagOps: [], endings: [] });
});
