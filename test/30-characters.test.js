// B1 人物卡：数据模型 + 提示词注入 + AI 解析（纯函数，Node 环境可跑）
import assert from "node:assert";
import test from "node:test";
import { S, ensureWorldCharacters, defaultCharacter } from "../src/store.js";
import { buildCharactersContext } from "../src/prompt.js";
import { parseCharacters } from "../src/llm.js";

const NPC_ONLY = ["与主角关系", "对主角态度", "当前状态", "声音标签"];

test("ensureWorldCharacters：缺字段补空数组、已有保留、脏数据兜底", () => {
    const w1 = {};
    ensureWorldCharacters(w1);
    assert.ok(Array.isArray(w1.characters));
    assert.equal(w1.characters.length, 0);

    const w2 = { characters: [{ name: "甲", role: "npc" }] };
    ensureWorldCharacters(w2);
    assert.equal(w2.characters.length, 1);
    assert.ok(w2.characters[0].id, "应补 id");
    assert.equal(w2.characters[0].role, "npc");

    const w3 = { characters: [null, "junk", { role: "protagonist", name: "你" }] };
    ensureWorldCharacters(w3);
    assert.equal(w3.characters.length, 1, "非对象条目被过滤");
    assert.equal(w3.characters[0].role, "protagonist");
});

test("defaultCharacter：主角/ NPC 字段初始化", () => {
    const p = defaultCharacter("protagonist");
    assert.equal(p.role, "protagonist");
    assert.ok(p.id);
    assert.equal(p.name, "");
    assert.equal(p.notes, "");
    const n = defaultCharacter("npc");
    assert.equal(n.role, "npc");
});

test("buildCharactersContext：空世界返回空串（不污染 system prompt）", () => {
    assert.equal(buildCharactersContext({ characters: [] }), "");
    assert.equal(buildCharactersContext({}), "");
    assert.equal(buildCharactersContext(null), "");
});

test("buildCharactersContext：主角 + 多 NPC 正确格式化且主角在前", () => {
    const world = {
        characters: [
            { role: "npc", name: "薛蟠", identity: "呆霸王", relationship: "表兄", attitude: "不屑", untouchable: "永不洗白" },
            { role: "protagonist", name: "林黛玉", identity: "贾府表小姐", motivation: "还泪报恩", notes: "敏感多思" }
        ]
    };
    const out = buildCharactersContext(world);
    assert.ok(out.includes("# 角色设定（人物卡）"), "含段标题");
    assert.ok(out.includes("【角色卡 · 主角】林黛玉"), "主角块");
    assert.ok(out.includes("【角色卡 · NPC】薛蟠"), "NPC 块");
    // 主角排前
    assert.ok(out.indexOf("林黛玉") < out.indexOf("薛蟠"), "主角在前");
    // NPC 专属字段出现
    assert.ok(out.includes("与主角关系：表兄"));
    assert.ok(out.includes("对主角态度：不屑"));
    assert.ok(out.includes("不可触碰设定：永不洗白"));
    assert.ok(out.includes("备注：敏感多思"));
    // 主角不应出现 NPC 专属字段标签
    const protBlock = out.slice(out.indexOf("林黛玉"), out.indexOf("薛蟠"));
    for (const label of NPC_ONLY) assert.ok(!protBlock.includes(label + "："), "主角块无 NPC 专属字段：" + label);
});

test("buildCharactersContext：只输出非空字段", () => {
    const world = { characters: [{ role: "npc", name: "甲" }] };
    const out = buildCharactersContext(world);
    assert.ok(out.includes("【角色卡 · NPC】甲"));
    assert.ok(!out.includes("身份："), "空的身份不应输出");
    assert.ok(!out.includes("核心目标："), "空的动机不应输出");
});

test("buildCharactersContext：缺参时回退 S.currentWorld", () => {
    S.currentWorld = { characters: [{ role: "protagonist", name: "测试主角" }] };
    const out = buildCharactersContext();
    assert.ok(out.includes("测试主角"));
    S.currentWorld = null;
});

test("parseCharacters：标准 JSON 数组", () => {
    const text = JSON.stringify([
        { role: "protagonist", name: "哈利", identity: "巫师", motivation: "打败伏地魔" },
        { role: "npc", name: "赫敏", relationship: "挚友" }
    ]);
    const out = parseCharacters(text);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, "protagonist");
    assert.equal(out[1].role, "npc");
    assert.equal(out[1].relationship, "挚友");
});

test("parseCharacters：带噪声的 JSON / 损坏输入安全降级", () => {
    const noisy = "```json\n" + JSON.stringify([{ role: "npc", name: "张三", identity: "侠客" }]) + "\n```";
    const out = parseCharacters(noisy);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "张三");

    assert.deepEqual(parseCharacters("不是 json"), []);
    assert.deepEqual(parseCharacters(""), []);
    assert.deepEqual(parseCharacters(null), []);
});
