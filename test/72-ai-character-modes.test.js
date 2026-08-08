// ★ docs/71：AI 生成角色时自动产出 personality_modes（含 IP/同人世界原作考据分支）单元测试
import assert from "node:assert";
import test from "node:test";
import { buildCharacterSystemPrompt, parseCharacters } from "../src/llm.js";

// ---------- 1) buildCharacterSystemPrompt：所有世界都带切面 schema ----------
test("buildCharacterSystemPrompt：始终包含 personality_modes 切面 schema", () => {
    const p = buildCharacterSystemPrompt({});
    assert.ok(p.includes("personality_modes"), "应含切面字段名");
    assert.ok(p.includes("情境人格"), "应含情境人格说明");
    assert.ok(p.includes("npc:<角色名>"), "应含 npc: 触发说明");
    assert.ok(p.includes("situation:<情境标签>"), "应含 situation: 触发说明");
    assert.ok(p.includes("is_alter"), "应含多重人格标记");
});

// ---------- 2) IP / 同人世界：追加原作考据强指令 ----------
test("buildCharacterSystemPrompt：含 ip_name 时追加原作考据指令并写入作品名", () => {
    const p = buildCharacterSystemPrompt({ ip_name: "哈利波特" });
    assert.ok(p.includes("原作考据要求"), "应含原作考据段落");
    assert.ok(p.includes("《哈利波特》"), "应把作品名写进指令");
    assert.ok(p.includes("禁止凭空杜撰与原作明显相悖"), "应要求可溯源、禁止杜撰");
});

// ---------- 3) 原创世界：不追加原作考据指令 ----------
test("buildCharacterSystemPrompt：无 ip_name 时不追加原作考据指令", () => {
    const p = buildCharacterSystemPrompt({ desc: "原创仙侠" });
    assert.ok(!p.includes("原作考据要求"), "原创世界不应触发原作考据段落");
});

// ---------- 4) parseCharacters：完整解析 personality_modes（含 is_alter / priority） ----------
test("parseCharacters：解析完整 personality_modes（default + npc: + 多重人格）", () => {
    const text = JSON.stringify([
        {
            role: "npc",
            name: "斯内普",
            personality: "冷嘲",
            personality_modes: [
                { context: "default", traits: "冷嘲、审视", voice: "冷峻", attitude: "对主角戒备", is_alter: false, priority: 0 },
                { context: "npc:马尔福", traits: "飘忽傲慢", voice: "讥讽", is_alter: false, priority: 5 },
                { context: "situation:battle", traits: "狠厉", is_alter: false, priority: 8 },
                { context: "npc:邓布利多", traits: "隐忍顺从", is_alter: true, priority: 3 }
            ]
        }
    ]);
    const out = parseCharacters(text);
    assert.strictEqual(out.length, 1);
    const modes = out[0].personality_modes;
    assert.strictEqual(modes.length, 4, "4 个切面应全部保留");
    assert.strictEqual(modes[0].context, "default");
    assert.strictEqual(modes[0].traits, "冷嘲、审视");
    assert.strictEqual(modes[1].context, "npc:马尔福");
    assert.strictEqual(modes[1].priority, 5);
    assert.strictEqual(modes[2].context, "situation:battle");
    assert.strictEqual(modes[3].is_alter, true, "多重人格标记应保留");
    assert.ok(typeof modes[3].id === "string" && modes[3].id, "应补 id");
});

// ---------- 5) parseCharacters：无 modes 时归一为 []（不报错） ----------
test("parseCharacters：无 personality_modes 时归一为 []", () => {
    const text = JSON.stringify([{ role: "npc", name: "路人", personality: "普通" }]);
    const out = parseCharacters(text);
    assert.deepStrictEqual(out[0].personality_modes, []);
});
