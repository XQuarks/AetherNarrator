// 文档24/26：运行时注入玩家文风（{STYLE_GUIDE} / {STYLE_EXPRESSION_GUIDE}）
// 覆盖 buildStyleProfile / buildStyleGuide / buildExpressionGuide /
//      buildToneGuide / buildAuthorNote / styleToTemperature / buildSystemPrompt
// 设计：纯函数走参数；buildToneGuide/buildAuthorNote/buildSystemPrompt 读全局 S.currentWorld（贴近运行期路径）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S } from "../src/store.js";
import {
    buildStyleProfile, buildStyleGuide, buildExpressionGuide,
    buildToneGuide, buildAuthorNote, styleToTemperature, buildSystemPrompt
} from "../src/prompt.js";

// buildSystemPrompt 内部 getProvider() 读 document.getElementById，Node 无 DOM，stub 最小实现
globalThis.document = globalThis.document || { getElementById: () => null };
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 设全局世界状态（贴近运行期真实路径，供 buildToneGuide/buildAuthorNote/buildSystemPrompt 读取）
function setWorld(over) {
    S.currentWorld = Object.assign({
        id: "w_test", name: "测试世界", desc: "", hero: "",
        schema: { time_config: { mode: "none" } },   // 让时间与权威时间分支早返回，避开花哨格式化
        lore_kb: { snippets: [] },
        style_ref: "none", custom_style: "", plot_freedom: 3
    }, over);
    S.gameState = Object.assign(
        { name: "主角", background: "", personality: [], current_date: { year: 2020, month: 1, date: 1, period: "morning" } },
        over.gameState || {}
    );
}

// ---------- buildStyleProfile ----------
test("buildStyleProfile：旧世界无 style_profile 走兜底", () => {
    const p = buildStyleProfile({ style_ref: "custom", custom_style: "硬核" });
    assert.strictEqual(p.mode, "custom");
    assert.strictEqual(p.custom, "硬核");
    assert.deepEqual(p.tropes, []);
    assert.strictEqual(p.genre, null);
});

test("buildStyleProfile：含 style_profile 正确合并（docs/25 接入点）", () => {
    const p = buildStyleProfile({ style_ref: "custom", custom_style: "x", style_profile: { genre: "仙侠", tropes: ["爽点"], taste: "热血", pov: "第一人称", style: "冷峻" } });
    assert.strictEqual(p.genre, "仙侠");
    assert.deepEqual(p.tropes, ["爽点"]);
    assert.strictEqual(p.taste, "热血");
    assert.strictEqual(p.pov, "第一人称");
    assert.strictEqual(p.style, "冷峻");
});

// ---------- buildStyleGuide ----------
test("buildStyleGuide：style_ref 兜底分支 original/none/custom", () => {
    assert.ok(buildStyleGuide({ style_ref: "original" }).includes("通用叙事风格"), "original 走通用叙事风格兜底");
    assert.ok(buildStyleGuide({ style_ref: "none" }).includes("不模仿特定文风"), "none 应不模仿特定文风");
    const g = buildStyleGuide({ style_ref: "custom", custom_style: "克苏鲁恐怖" });
    assert.ok(g.includes("严格遵循玩家自定义要求"), "custom 应严格遵循");
    assert.ok(g.includes("克苏鲁恐怖"), "应含玩家自定义文风原文");
});

test("buildStyleGuide：style_profile.style 出现「文风标签」", () => {
    const g = buildStyleGuide({ style_ref: "none", style_profile: { style: "冷峻硬汉" } });
    assert.ok(g.includes("文风标签"), "应含「文风标签」小节");
    assert.ok(g.includes("冷峻硬汉"), "应含 style_profile.style 值");
});

// ---------- buildExpressionGuide ----------
test("buildExpressionGuide：轻松/恋爱类启用 emoji 与心形、不禁用", () => {
    const g = buildExpressionGuide({ custom_style: "轻松日常甜宠" });
    assert.ok(g.includes("♡"), "轻松类应出现心形符号");
    assert.ok(!g.includes("禁用 emoji"), "轻松类不应禁用 emoji");
});

test("buildExpressionGuide：史诗/硬核类禁用 emoji、不出现心形", () => {
    const g = buildExpressionGuide({ custom_style: "史诗硬核废土" });
    assert.ok(g.includes("禁用 emoji"), "史诗/硬核类必须禁用 emoji");
    assert.ok(!g.includes("♡"), "史诗类不应出现心形符号");
});

test("buildExpressionGuide：克苏鲁/恐怖类禁用 emoji 且不可名状", () => {
    const g = buildExpressionGuide({ custom_style: "克苏鲁恐怖不可名状" });
    assert.ok(g.includes("禁用 emoji"));
    assert.ok(g.includes("不可名状"));
});

test("buildExpressionGuide：赛博朋克类禁用 emoji 且冷光", () => {
    const g = buildExpressionGuide({ custom_style: "赛博朋克冷光金属" });
    assert.ok(g.includes("禁用 emoji"));
    assert.ok(g.includes("冷光"));
});

// ---------- buildToneGuide（读 S.currentWorld） ----------
test("buildToneGuide：style_preset.narrative_style 以玩家选定文风为准，覆盖关键词推断", () => {
    setWorld({ style_preset: { narrative_style: "硬核史诗，冷峻而克制" }, desc: "轻松日常的校园" });
    const t = buildToneGuide();
    assert.ok(t.includes("以玩家选定的叙事风格为准"), "应直接以玩家选定的叙事风格为准");
    assert.ok(t.includes("硬核史诗"), "应含玩家自定义文风原文");
});

test("buildToneGuide：克苏鲁关键词命中悬疑基调", () => {
    setWorld({ style_ref: "none", custom_style: "", desc: "克苏鲁恐怖深渊旧日" });
    const t = buildToneGuide();
    assert.ok(t.includes("悬疑"), "克苏鲁应推悬疑基调");
});

test("buildToneGuide：废土关键词命中高张力", () => {
    setWorld({ style_ref: "none", custom_style: "", desc: "废土生存末日求生" });
    const t = buildToneGuide();
    assert.ok(t.includes("高张力"), "废土应推高张力基调");
});

// ---------- buildAuthorNote（读 S.currentWorld，含文风保持提醒） ----------
test("buildAuthorNote：含「文风保持」提醒（中部纠偏位双保险）", () => {
    setWorld({ style_ref: "custom", custom_style: "史诗硬核" });
    const note = buildAuthorNote();
    assert.ok(note.includes("文风保持"), "中部纠偏位应含文风保持提醒");
});

// ---------- styleToTemperature ----------
test("styleToTemperature：各档映射正确", () => {
    assert.strictEqual(styleToTemperature("史诗硬核"), 0.4);
    assert.strictEqual(styleToTemperature("克苏鲁恐怖"), 0.4);
    assert.strictEqual(styleToTemperature("武侠仙侠"), 0.4);
    assert.strictEqual(styleToTemperature("轻松日常"), 0.8);
    assert.strictEqual(styleToTemperature("赛博朋克"), 0.6);
    assert.strictEqual(styleToTemperature(""), 0.7);
    assert.strictEqual(styleToTemperature(undefined), 0.7);
});

// ---------- buildSystemPrompt：占位符被替换、玩家文风生效 ----------
test("buildSystemPrompt：注入两占位符且无残留，玩家文风生效", () => {
    S.systemPromptTemplate = fs.readFileSync(path.join(__dirname, "..", "data", "system_prompt_template.md"), "utf8");
    S.cachedSystemPrompt = null;
    S.cachedSysPromptWorldId = null;
    setWorld({
        id: "w_test", name: "无名之雾", desc: "克苏鲁恐怖", hero: "调查员",
        schema: { time_config: { mode: "none" } }, lore_kb: { snippets: [] },
        style_ref: "custom", custom_style: "克苏鲁恐怖不可名状", plot_freedom: 3
    });
    const out = buildSystemPrompt();
    assert.ok(!out.includes("{STYLE_GUIDE}"), "占位符 {STYLE_GUIDE} 应被替换，不应残留");
    assert.ok(!out.includes("{STYLE_EXPRESSION_GUIDE}"), "占位符 {STYLE_EXPRESSION_GUIDE} 应被替换，不应残留");
    assert.ok(out.includes("克苏鲁恐怖不可名状"), "应注入玩家自定义文风");
    assert.ok(out.includes("禁用 emoji"), "克苏鲁世界应注入禁用 emoji 指南");
});
