// ★ docs/71：情境人格（A 方案）数据模型 + OOC 守门逻辑 单元测试
import test from "node:test";
import assert from "node:assert/strict";
import { S } from "../src/store.js";
import { ensureWorldCharacters, defaultCharacter } from "../src/store.js";
import { defaultInitialState } from "../src/utils.js";
import {
    selectActiveFacet,
    detectOocCorrection,
    buildOocReanchorNote,
    consumeOocReanchor,
    buildCharactersContext
} from "../src/prompt.js";
import { applyTagOpTo } from "../src/game.js";

// ---------- 1) ensureWorldCharacters 归一 personality_modes ----------
test("ensureWorldCharacters 归一 personality_modes（数组→顿号串、缺失→[]、非法项过滤、补 id）", () => {
    const world = {
        characters: [
            {
                name: "斯内普", role: "npc", personality: "冷嘲、审视", voice: "冷峻",
                personality_modes: [
                    { context: "default", traits: ["冷嘲", "审视"], voice: ["冷峻", "反问"] },
                    { context: "npc:马尔福", traits: "飘忽傲慢", voice: "抬高语调" },
                    null, // 非法项
                    "garbage" // 非法项
                ]
            },
            { name: "赫敏", role: "npc" } // 无 modes
        ]
    };
    ensureWorldCharacters(world);
    const snape = world.characters[0];
    assert.ok(Array.isArray(snape.personality_modes));
    assert.strictEqual(snape.personality_modes.length, 2, "非法项应被过滤");
    // 第一个 mode：数组 traits/voice → 顿号串
    assert.strictEqual(snape.personality_modes[0].traits, "冷嘲、审视");
    assert.strictEqual(snape.personality_modes[0].voice, "冷峻、反问");
    assert.strictEqual(snape.personality_modes[0].context, "default");
    assert.ok(typeof snape.personality_modes[0].id === "string" && snape.personality_modes[0].id, "应补 id");
    // 第二个 mode：npc 切面、字符串原样
    assert.strictEqual(snape.personality_modes[1].context, "npc:马尔福");
    assert.strictEqual(snape.personality_modes[1].traits, "飘忽傲慢");
    // 赫敏：无 modes → 空数组（向后兼容）
    assert.deepStrictEqual(world.characters[1].personality_modes, []);
});

test("defaultCharacter 含 personality_modes: []", () => {
    const c = defaultCharacter("npc");
    assert.deepStrictEqual(c.personality_modes, []);
});

// ---------- 2) selectActiveFacet ----------
const charWithModes = {
    name: "X", personality: "平和", voice: "平稳",
    personality_modes: [
        { id: "d", context: "default", traits: "平和", voice: "平稳", priority: 0 },
        { id: "n", context: "npc:马尔福", traits: "讥讽", voice: "傲慢", priority: 0 },
        { id: "s", context: "situation:combat", traits: "锋利", voice: "简短", priority: 5 }
    ]
};

test("selectActiveFacet：仅 default 时返回 default", () => {
    const f = selectActiveFacet(charWithModes, { presentNpcs: [], situationTags: [] });
    assert.strictEqual(f.id, "d");
});

test("selectActiveFacet：npc 命中时返回 npc 切面（覆盖 default）", () => {
    const f = selectActiveFacet(charWithModes, { presentNpcs: ["马尔福"], situationTags: [] });
    assert.strictEqual(f.id, "n");
});

test("selectActiveFacet：situation 命中且 priority 最高时返回 situation 切面", () => {
    const f = selectActiveFacet(charWithModes, { presentNpcs: ["马尔福"], situationTags: ["combat"] });
    assert.strictEqual(f.id, "s");
});

test("selectActiveFacet：无 mode 返回 null；仅有 default 时（无论上下文）返回 default", () => {
    assert.strictEqual(selectActiveFacet({ name: "Y" }, {}), null);
    const onlyDefault = { name: "Z", personality_modes: [{ context: "default", traits: "a" }] };
    const f = selectActiveFacet(onlyDefault, { presentNpcs: ["路人"], situationTags: ["rain"] });
    assert.strictEqual(f.context, "default");
});

test("selectActiveFacet：focusNpc 也能触发 npc 切面", () => {
    const f = selectActiveFacet(charWithModes, { presentNpcs: [], situationTags: [], focusNpc: "马尔福" });
    assert.strictEqual(f.id, "n");
});

// ---------- 3) detectOocCorrection ----------
const world = { characters: [{ name: "斯内普", role: "npc" }, { name: "赫敏", role: "npc" }] };

test("detectOocCorrection：命中关键词且识别角色名", () => {
    const r = detectOocCorrection("斯内普你刚才人设崩了", world);
    assert.ok(r);
    assert.strictEqual(r.charName, "斯内普");
});

test("detectOocCorrection：命中关键词但未指名 → charName null", () => {
    const r = detectOocCorrection("你这人设不对啊", world);
    assert.ok(r);
    assert.strictEqual(r.charName, null);
});

test("detectOocCorrection：无关键词返回 null", () => {
    assert.strictEqual(detectOocCorrection("我们去大厅吧", world), null);
    assert.strictEqual(detectOocCorrection("", world), null);
});

test("detectOocCorrection：ooc 关键词命中", () => {
    const r = detectOocCorrection("这是 OOC 了吧", world);
    assert.ok(r);
});

// ---------- 4) buildOocReanchorNote / consumeOocReanchor ----------
test("buildOocReanchorNote：含角色名 / 所有角色", () => {
    assert.ok(buildOocReanchorNote("斯内普").includes("斯内普"));
    assert.ok(buildOocReanchorNote(null).includes("所有角色"));
});

test("consumeOocReanchor：注入后清空标记；无标记返回空串", () => {
    S.oocReanchor = { charName: "斯内普" };
    const note = consumeOocReanchor();
    assert.ok(note.includes("斯内普"));
    assert.strictEqual(S.oocReanchor, null);
    assert.strictEqual(consumeOocReanchor(), "");
});

// ---------- 5) buildCharactersContext 注入守门说明 ----------
test("buildCharactersContext：有 modes 时注入 OOC 守门说明（含切面与并集规则）", () => {
    const ctx = buildCharactersContext({
        characters: [{
            name: "斯内普", role: "npc", personality: "冷嘲", voice: "冷峻", untouchable: "不为麻瓜求情",
            personality_modes: [
                { context: "default", traits: "冷嘲", voice: "冷峻" },
                { context: "npc:马尔福", traits: "飘忽傲慢", voice: "抬高语调" }
            ]
        }]
    });
    assert.ok(ctx.includes("多重人格 / 切面"), "应出现切面说明块");
    assert.ok(ctx.includes("OOC = 言行落到所有切面并集之外"), "应出现并集守门规则");
    assert.ok(ctx.includes("npc:马尔福"), "应列出 npc 切面");
});

test("buildCharactersContext：无 modes 时不注入切面块", () => {
    const ctx = buildCharactersContext({
        characters: [{ name: "赫敏", role: "npc", personality: "理性", voice: "引经据典" }]
    });
    assert.ok(!ctx.includes("多重人格 / 切面"));
});

// ---------- 6) defaultInitialState 含 situation_tags ----------
test("defaultInitialState 含 situation_tags: []", () => {
    const s = defaultInitialState();
    assert.ok(Array.isArray(s.situation_tags));
    assert.strictEqual(s.situation_tags.length, 0);
});

// ---------- 7) applyTagOpTo：situation_tags 增量运算（applyStateChanges 内部复用） ----------
test("applyTagOpTo：situation_tags 支持 add/remove/纯数组/null", () => {
    const tags = [];
    applyTagOpTo(tags, { add: ["combat", "alone_night"] });
    assert.ok(tags.includes("combat") && tags.includes("alone_night"));
    applyTagOpTo(tags, { remove: ["combat"] });
    assert.ok(!tags.includes("combat") && tags.includes("alone_night"));
    const t2 = [];
    applyTagOpTo(t2, ["a", "b"]); // 纯数组视为 add
    assert.deepStrictEqual(t2, ["a", "b"]);
    const t3 = ["x"];
    applyTagOpTo(t3, null); // 非法 op 不崩溃
    assert.deepStrictEqual(t3, ["x"]);
});
