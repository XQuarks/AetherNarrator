// ============================================================
// Phase 5 · 工具调用约束 + L2 分层缓存 单元测试
// 覆盖：集中 tools 层 schema、tool_calls 取参逻辑、callStructured 调度、L2 独立缓存断点。
// 纯函数 + mock 模式，不依赖真实 API / 浏览器 DOM（用最小 document stub）。
// ============================================================
import { test } from "node:test";
import assert from "node:assert";

import { S } from "../src/store.js";
import {
    TOOLS, callStructured, extractStructuredFromMessage, extractStructuredFromArgs, callLLM
} from "../src/llm.js";
import {
    buildSystemPrompt, buildLoreHardBreakpoint, buildCharactersBreakpoint,
    invalidateSystemPromptCache, invalidateLoreHardCache, invalidateCharactersCache
} from "../src/prompt.js";

// ---- 最小 DOM stub：mockMode 开启时走 mock 分支；baseUrl 指向 deepseek → prefix 缓存策略 ----
global.document = {
    getElementById: (id) => {
        if (id === "mockMode") return { checked: true, value: "on" };
        if (id === "noStreamMode") return { checked: false, value: "" };
        return { checked: false, value: "https://api.deepseek.com/v1" };
    }
};

function resetState() {
    S.currentWorld = null;
    S.activeLoreKB = null;
    S.gameState = null;
    S.currentSession = { epoch: 1, worldId: "w_test" };
    S.chatHistory = [];
    S.conversationHistory = [];
    S.chatSummary = [];
    S.cachedSystemPrompt = null;
    S.cachedSysPromptWorldId = null;
    S.cachedCharactersPrompt = null;
    S.cachedCharactersWorldId = null;
    S.cachedLoreHardPrompt = null;
    S.cachedLoreHardWorldId = null;
}

// ---------- 1. 集中 tools 层 schema 校验 ----------
test("TOOLS 注册表：10 个工具、schema 宽松（additionalProperties=true）", () => {
    const expected = [
        "apply_turn_state", "generate_world", "extract_lore_chunk",
        "consistency_pack", "character_cards", "worldview_judge", "lore_revision",
        "predict_branches", // ★ C4：走向前瞻（理解 A·后果预览）
        "judge_contact",    // ★ docs/53：世界状态裁判（联络/获报是否允许）
        "generate_daily"    // ★ docs/53：世界日报生成
    ];
    for (const key of expected) {
        assert.ok(TOOLS[key], `缺少工具 ${key}`);
        const t = TOOLS[key];
        assert.strictEqual(t.name, key, `${key}.name 应与键一致`);
        assert.strictEqual(typeof t.description, "string", `${key}.description 应为字符串`);
        assert.strictEqual(t.parameters.type, "object", `${key}.parameters.type 应为 object`);
        assert.strictEqual(t.parameters.additionalProperties, true, `${key} 应允许额外字段，避免模型拒答`);
        assert.strictEqual(typeof t.parameters.properties, "object", `${key}.parameters.properties 应存在`);
    }
    assert.strictEqual(Object.keys(TOOLS).length, expected.length, "工具数量应为 10");
});

// ---------- 2. 非流式取参：tool_calls → 解析对象 ----------
test("extractStructuredFromMessage：从 tool_calls 取参数", () => {
    const msg = { tool_calls: [{ function: { arguments: JSON.stringify({ narrative: "x", choices: [] }) } }] };
    assert.deepStrictEqual(extractStructuredFromMessage(msg, "t"), { narrative: "x", choices: [] });
});

test("extractStructuredFromMessage：无 tool_calls 回退 content（parseResponse）", () => {
    const msg = { content: '```json\n{"consistent":true,"severity":"soft","violations":[]}\n```' };
    const obj = extractStructuredFromMessage(msg, "t");
    assert.strictEqual(obj.consistent, true);
    assert.deepStrictEqual(obj.violations, []);
});

test("extractStructuredFromMessage：既无 tool_calls 也无 content → 抛错", () => {
    assert.throws(() => extractStructuredFromMessage({}, "t"));
});

// ---------- 2.5 思考模式兜底：正文空、思考过程在 reasoning_content ----------
test("extractStructuredFromMessage：content 空但 reasoning_content 含 JSON → 兜底解析", () => {
    const msg = { content: "", reasoning_content: '{"narrative":"x","choices":[]}' };
    assert.deepStrictEqual(extractStructuredFromMessage(msg, "t"), { narrative: "x", choices: [] });
});

test("extractStructuredFromMessage：content 空且 reasoning_content 非 JSON → 报错注明疑似思考模式", () => {
    const msg = { content: "", reasoning_content: "让我想想…… 嗯 就这样吧" };
    assert.throws(() => extractStructuredFromMessage(msg, "t"), /疑似思考模式/);
});

test("extractStructuredFromMessage：content 与 reasoning_content 均空 → 原样报错", () => {
    assert.throws(() => extractStructuredFromMessage({ content: "" }, "t"), /无 tool_calls 且无 content/);
});

// ---------- 3. 流式收尾取参：累积 arguments 文本 ----------
test("extractStructuredFromArgs：合法 JSON 直接解析", () => {
    assert.deepStrictEqual(extractStructuredFromArgs('{"a":1}', "t"), { a: 1 });
});

test("extractStructuredFromArgs：残缺/带围栏文本经 parseResponse 修复", () => {
    assert.strictEqual(extractStructuredFromArgs('```json\n{"a":2}\n```', "t").a, 2);
});

test("extractStructuredFromArgs：纯垃圾 → 抛错", () => {
    assert.throws(() => extractStructuredFromArgs("not json at all", "t"));
});

// ---------- 4. callStructured 集中调度（mock 模式） ----------
test("callStructured：mock 模式按 toolName 返回对应 mockFn 结果", async () => {
    const r1 = await callStructured([{ role: "user", content: "x" }], "apply_turn_state", {
        mockFn: () => ({ narrative: "A" })
    });
    assert.deepStrictEqual(r1, { narrative: "A" });

    const r2 = await callStructured([{ role: "user", content: "x" }], "generate_world", {
        mockFn: () => ({ name: "W" })
    });
    assert.deepStrictEqual(r2, { name: "W" });
});

test("callStructured：未知工具名 → 抛错", async () => {
    await assert.rejects(() => callStructured([], "nope", {}));
});

test("callStructured：mock 模式且无 mockFn → 返回 null", async () => {
    const r = await callStructured([], "apply_turn_state", {});
    assert.strictEqual(r, null);
});

// ---------- 5. L2 分层缓存：知识库硬约束独立断点 ----------
test("buildLoreHardBreakpoint：小知识库产出全量知识段并命中缓存", () => {
    resetState();
    S.currentWorld = { id: "w1", name: "雾", desc: "d", lore_kb: { ip: "x", snippets: [
        { id: "r1", category: "规则", title: "不可名状", content: "禁止直视神明" }
    ] } };
    S.activeLoreKB = S.currentWorld.lore_kb;

    const hard = buildLoreHardBreakpoint();
    assert.ok(hard.includes("世界观"), "应产出世界观知识/约束段");
    // prefix 策略下应写入缓存，二次调用返回同一缓存串
    assert.strictEqual(S.cachedLoreHardPrompt, hard, "应命中 L2 缓存");
    assert.strictEqual(buildLoreHardBreakpoint(), hard, "二次调用应返回缓存串（不重建）");

    invalidateLoreHardCache();
    assert.strictEqual(S.cachedLoreHardPrompt, null, "invalidateLoreHardCache 应清空缓存");
});

test("buildLoreHardBreakpoint：空知识库返回空串", () => {
    resetState();
    S.currentWorld = { id: "w2", name: "空", desc: "d", lore_kb: { ip: "x", snippets: [] } };
    S.activeLoreKB = S.currentWorld.lore_kb;
    assert.strictEqual(buildLoreHardBreakpoint(), "", "空知识库应返回空串");
});

// ---------- 6. L2 分层缓存：角色卡独立断点 ----------
test("buildCharactersBreakpoint：有角色卡产出角色设定段并命中缓存", () => {
    resetState();
    S.currentWorld = { id: "w3", name: "角色", desc: "d", characters: [
        { role: "protagonist", name: "主角" },
        { role: "npc", name: "甲" }
    ] };
    const chars = buildCharactersBreakpoint();
    assert.ok(chars.includes("# 角色设定（人物卡）"), "应产出角色卡段");
    assert.strictEqual(S.cachedCharactersPrompt, chars, "应命中角色卡缓存");
    assert.strictEqual(buildCharactersBreakpoint(), chars, "二次调用应返回缓存串");

    invalidateCharactersCache();
    assert.strictEqual(S.cachedCharactersPrompt, null, "invalidateCharactersCache 应清空缓存");
});

test("buildCharactersBreakpoint：无角色卡返回空串", () => {
    resetState();
    S.currentWorld = { id: "w4", name: "无角色", desc: "d", characters: [] };
    assert.strictEqual(buildCharactersBreakpoint(), "", "无角色卡应返回空串");
});

// ---------- 7. L2 顺序正确性：callLLM 在 mock 模式下端到端不崩溃（角色卡段先于知识段） ----------
test("callLLM（mock）：端到端跑通，L2 三段均参与构建", async () => {
    resetState();
    S.currentWorld = {
        id: "w5", name: "整合", desc: "d", hero: "调查员",
        schema: { time_config: { mode: "none" } },
        world_schema: { time_config: { mode: "none" } },
        lore_kb: { ip: "x", snippets: [{ id: "r1", category: "规则", title: "t", content: "c" }] },
        characters: [{ role: "npc", name: "甲" }]
    };
    S.activeLoreKB = S.currentWorld.lore_kb;
    S.gameState = {
        current_location: "镇上", relationships: {}, current_date: { year: 1, month: 1, day: 1, period: "morning", step: 1 },
        variables: {}, bonds: {}, name: "主角", background: ""
    };

    const out = await callLLM("我四处看看", []);
    assert.ok(out && typeof out === "object", "应返回结构化对象");
    assert.ok("narrative" in out, "应包含 narrative 字段（mockLLM 产出）");
    // L1 / L2 三段缓存均被填充（证明三段构建链路跑通）
    assert.strictEqual(typeof S.cachedLoreHardPrompt, "string", "知识库硬约束段应已构建");
    assert.ok(S.cachedCharactersPrompt.includes("# 角色设定（人物卡）"), "角色卡段应已构建");
    assert.ok(S.cachedSystemPrompt.length > 0, "L1 core 应已构建");
});

// ---------- 8. 向后兼容：旧 buildSystemPrompt 仍是 L1 core（不含知识库硬约束/角色卡段） ----------
test("buildSystemPrompt（L1 core）不含独立缓存段的角色/知识标题", () => {
    resetState();
    S.currentWorld = {
        id: "w6", name: "拆分", desc: "d", hero: "主角",
        schema: { time_config: { mode: "none" } }, world_schema: { time_config: { mode: "none" } },
        lore_kb: { ip: "x", snippets: [{ id: "r1", category: "规则", title: "t", content: "c" }] },
        characters: [{ role: "npc", name: "甲" }],
        system_prompt_template: undefined
    };
    S.activeLoreKB = S.currentWorld.lore_kb;
    S.systemPromptTemplate = "# 系统\n\n{WORLD_RULES}\n{STYLE_GUIDE}\n{STYLE_EXPRESSION_GUIDE}";
    const out = buildSystemPrompt();
    // L1 core 仍含占位符替换后的世界规则；知识库硬约束段与角色卡段已拆出，不应出现在 L1 串里
    assert.ok(out.includes("WORLD_RULES") === false, "占位符应被替换");
    assert.ok(!out.includes("# 角色设定（人物卡）"), "角色卡段不应出现在 L1 core");
});
