// A2 一致性包：生成 → 禁项写入现有管线 → 注入 system prompt
import { test } from "node:test";
import assert from "node:assert/strict";
import { S, getBannedConcepts, ensureWorldCanon, applyConsistencyPack } from "../src/store.js";
import { buildCanonRules } from "../src/prompt.js";
import { parseConsistencyPack, generateConsistencyPack } from "../src/llm.js";

function resetS() {
    S.currentWorld = null;
    S.gameState = { tags: [], inventory: [], present_npcs: [] };
}

test("parseConsistencyPack 解析合法 JSON", () => {
    const text = '{"banned":["手机","电脑"],"must_read":["霍格沃茨是魔法学校"],"style_anchor":"英伦魔幻"}';
    const p = parseConsistencyPack(text);
    assert.deepEqual(p.banned, ["手机", "电脑"]);
    assert.equal(p.must_read[0], "霍格沃茨是魔法学校");
    assert.equal(p.style_anchor, "英伦魔幻");
});

test("parseConsistencyPack 容错：无 JSON / 多余文字返回空包", () => {
    assert.deepEqual(parseConsistencyPack("抱歉我无法生成").banned, []);
    const withChat = '好的，以下是包：\n{"banned":["魔网"],"must_read":[],"style_anchor":"暗黑"}';
    const p = parseConsistencyPack(withChat);
    assert.deepEqual(p.banned, ["魔网"]);
});

test("applyConsistencyPack 把 banned 转成 world.rules 的 ban 规则（玩家可编辑来源）", () => {
    resetS();
    const world = { type: "ip", ip_name: "哈利波特", rules: [], bannedConcepts: [] };
    ensureWorldCanon(world);
    applyConsistencyPack(world, { banned: ["手机", "魔网"], must_read: ["核心铁律"], style_anchor: "魔幻" });
    // 禁项应作为 rules 的「禁止概念」规则存在（单一可编辑来源）
    const banRules = world.rules.filter(r => r.then && r.then.type === "ban");
    assert.ok(banRules.length >= 2, "应生成至少 2 条 ban 规则");
    assert.ok(banRules.some(r => r.then.concept === "手机"), "手机应成为 ban 规则");
    assert.ok(banRules.some(r => r.then.concept === "魔网"), "魔网应成为 ban 规则");
    assert.equal(world.canon.pack_source, "generated");
    assert.deepEqual(world.canon.consistency_pack.banned, ["手机", "魔网"]);
    assert.equal(world.canon.consistency_pack.must_read[0], "核心铁律");
});

test("getBannedConcepts 运行时包含生成的一致性包禁项（来自 rules ban 规则）", () => {
    resetS();
    const world = { type: "ip", ip_name: "哈利波特", rules: [], bannedConcepts: [] };
    applyConsistencyPack(world, { banned: ["魔网"], must_read: [], style_anchor: "" });
    S.currentWorld = world;
    const banned = getBannedConcepts();
    assert.ok(banned.includes("魔网"), "生成的禁项应出现在运行时禁项列表");
    assert.ok(!banned.includes("手机"), "未生成的禁项不应出现（全局强加已去掉）");
});

test("getBannedConcepts 去掉全局强加：空世界返回空（不再回退 DEFAULT_BANNED_CONCEPTS）", () => {
    resetS();
    const world = { type: "original", rules: [], bannedConcepts: [] };
    S.currentWorld = world;
    assert.deepEqual(getBannedConcepts(), [], "无生成包/种子包/规则的世界不应被强加全局禁项");
});

test("buildCanonRules 注入 must_read / style_anchor / key_divergences", () => {
    const world = {
        canon: {
            consistency_pack: { banned: ["x"], must_read: ["铁律A"], style_anchor: "暗黑" },
            key_divergences: "时间线改到2025"
        }
    };
    const out = buildCanonRules(world);
    assert.ok(out.includes("铁律A"));
    assert.ok(out.includes("暗黑"));
    assert.ok(out.includes("时间线改到2025"));
    assert.ok(out.includes("优先级最高"));
});

test("buildCanonRules 无包时返回空串（不污染 system prompt）", () => {
    assert.equal(buildCanonRules({ canon: { consistency_pack: null } }), "");
    assert.equal(buildCanonRules({}), "");
});

test("generateConsistencyPack 在无 DOM/API 环境下不抛错，返回包结构", async () => {
    const p = await generateConsistencyPack("霍格沃茨的魔法世界", "哈利波特");
    assert.ok(Array.isArray(p.banned));
    assert.ok(Array.isArray(p.must_read));
    assert.equal(typeof p.style_anchor, "string");
});
