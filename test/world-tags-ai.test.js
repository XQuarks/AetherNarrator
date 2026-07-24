// 作品标签：AI 自由生成 + 预设冗余清理
// 覆盖：
//  1) 世界生成提示词新增顶层 tags 字段，要求 AI 自由判断、不受 18 关键词限制
//  2) sanitizeWorldConfig 放行并清洗 tags（短串/去重/限量/非字符串过滤）
//  3) mockGenerateWorld 返回自由标签（含非 18 词表的词，如「赛博朋克」）
//  4) pickWorldTags 优先用 AI 标签、正则兜底；analyzeWorldTags 不再写来源标签
//  5) 三个预设的 tags 不再含与 type 徽章重复的「原创 / 已有IP」
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorldGenerationPrompt } from "../src/prompt.js";
import { sanitizeWorldConfig, pickWorldTags, analyzeWorldTags } from "../src/utils.js";
import { mockGenerateWorld } from "../src/llm.js";
import { createCthulhuWorld, createUrbanLegendWorld, createDualWorld } from "../src/new-worlds.js";

// 让 llm.js 在 node 下不依赖真实 DOM（其 mock 分支也不会触碰 document）
globalThis.document = { getElementById: () => ({ checked: true }) };

test("提示词：buildWorldGenerationPrompt 含顶层 tags 字段且要求自由判断", () => {
    const p = buildWorldGenerationPrompt("赛博都市", "original", "赛博朋克未来都市", "主角", null, "", "none", undefined, 3, "");
    assert.ok(p.includes("tags"), "prompt 应包含 tags 字段要求");
    assert.ok(p.includes("自由判断") || p.includes("不受任何固定词表限制"), "应明说不受固定词表限制");
    assert.ok(p.includes("赛博朋克"), "示例标签应出现「赛博朋克」");
    assert.ok(p.includes("原创") && p.includes("已有 IP"), "应提示不要与 type 徽章（原创/已有IP）重复");
});

test("sanitizeWorldConfig：放行并清洗 tags", () => {
    const raw = {
        tags: [" 赛博朋克 ", "赛博朋克", "x".repeat(50), 123, "意识穿越"],
        opening_narrative: "x",
        initial_choices: [{ text: "a" }]
    };
    const out = sanitizeWorldConfig(raw);
    assert.ok(Array.isArray(out.tags), "tags 应是数组");
    assert.ok(out.tags.includes("赛博朋克"), "应保留且去重（trim 后）");
    assert.ok(out.tags.includes("意识穿越"), "应保留合法标签");
    assert.ok(!out.tags.some(t => typeof t !== "string" || t.length > 20), "非字符串与超长串应被丢弃");
    assert.ok(out.tags.length <= 8, "限量 <= 8");
});

test("sanitizeWorldConfig：无 tags 字段时回退为空数组", () => {
    const out = sanitizeWorldConfig({ opening_narrative: "x" });
    assert.deepStrictEqual(out.tags, []);
});

test("mockGenerateWorld：返回自由标签（含非 18 词表的词）", () => {
    const magic = mockGenerateWorld("霍格沃茨", "original", "魔法学院", "", null);
    assert.ok(Array.isArray(magic.tags) && magic.tags.length > 0, "魔法世界应返回标签");

    const xian = mockGenerateWorld("蜀山", "original", "修仙", "", null);
    assert.ok(xian.tags.includes("修仙世界"), "仙侠分支应有「修仙世界」");

    const cyber = mockGenerateWorld("赛博都市", "original", "赛博朋克未来都市", "", null);
    assert.ok(cyber.tags.includes("赛博朋克"), "应生成非 18 词表的自由标签「赛博朋克」");
});

test("pickWorldTags：优先用 AI 标签，缺失时正则兜底且不含来源标签", () => {
    const aiTags = ["双界穿梭", "意识穿越"];
    assert.deepStrictEqual(
        pickWorldTags({ tags: aiTags }, { name: "x", desc: "", hero: "", type: "original", ipName: null }),
        aiTags,
        "有 AI 标签时直接采用"
    );

    const fb = pickWorldTags({ tags: [] }, { name: "校园恋爱", desc: "校园", hero: "", type: "original", ipName: null });
    assert.ok(Array.isArray(fb) && fb.includes("校园"), "兜底应正则命中「校园」");
    assert.ok(!fb.includes("原创"), "兜底不应再写来源标签（避免与徽章重复）");

    const fb2 = pickWorldTags({}, { name: "修仙", desc: "修真", hero: "", type: "original", ipName: null });
    assert.ok(fb2.includes("修仙"), "兜底应正则命中「修仙」");
});

test("analyzeWorldTags：不再写入来源标签", () => {
    const r = analyzeWorldTags("测试", "修真", "", "original", null);
    assert.ok(!r.includes("原创"), "analyzeWorldTags 不应再写「原创」");
    assert.ok(r.includes("修仙"), "仍应命中题材标签");
});

test("预设：三个世界 tags 不含与徽章重复的「原创 / 已有IP」", () => {
    const cases = [
        ["克苏鲁", createCthulhuWorld()],
        ["后室", createUrbanLegendWorld()],
        ["双界", createDualWorld()]
    ];
    for (const [name, w] of cases) {
        assert.ok(!w.tags.includes("原创"), `${name} 不应含「原创」`);
        assert.ok(!w.tags.includes("已有IP"), `${name} 不应含「已有IP」`);
        assert.ok(Array.isArray(w.tags) && w.tags.length > 0, `${name} 仍应保留题材标签`);
    }
});
