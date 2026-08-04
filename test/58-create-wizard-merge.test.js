// docs/58：创建向导合并 + 去类型 + 群像剧 回归测试
// 覆盖：
//  1) buildWorldGenerationPrompt：pov=ensemble 注入群像剧指令、不出现「主角设定：」行；
//     pov=solo 出现「主角设定：」并承载 hero；ipName 非空即注入「参考的世界」；不再有 type 码（类型：xx）。
//  2) resolveCanonContext：只认 ipName（参考的世界）——留空归 original，填写归 ip_adaptation。
//  3) ensureWorldCanon：mode 只看 ip_name，旧 type 字段不再参与。
//  4) computeWorldCompletion：hero 维度 optional，不计入必填分母。
//  5) analyzeWorldTags / pickWorldTags：签名已去 type 参数。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorldGenerationPrompt } from "../src/prompt.js";
import { resolveCanonContext, ensureWorldCanon } from "../src/store.js";
import { computeWorldCompletion, analyzeWorldTags, pickWorldTags } from "../src/utils.js";

// 让 prompt.js 在 node 下不依赖真实 DOM（其导入链可能触达文件上传等 DOM 初始化）
globalThis.document = { getElementById: () => ({ checked: true }), addEventListener: () => {} };

const BASE = { styleRef: "none", customStyle: undefined, plotFreedom: 3, worldPrefix: "" };

test("生成提示词：pov=ensemble 注入群像剧、不出现单人「主角设定：」行", () => {
    const p = buildWorldGenerationPrompt("群像世界", "多角色交织的世界", "", "", "", "none", undefined, 3, "", "ensemble");
    assert.ok(p.includes("群像剧"), "应注入群像剧指令");
    assert.ok(p.includes("无单一主角") || p.includes("无唯一主角"), "应说明无固定单一主角");
    assert.ok(!p.includes("主角设定："), "群像剧不应出现单人主角设定行");
});

test("生成提示词：pov=solo 出现「主角设定：」并承载 hero", () => {
    const p = buildWorldGenerationPrompt("单人世界", "一个世界", "哈利·孤儿", "", "", "none", undefined, 3, "", "solo");
    assert.ok(p.includes("主角设定："), "solo 应出现主角设定行");
    assert.ok(p.includes("哈利·孤儿"), "hero 内容应进入提示词");
});

test("生成提示词：ipName 非空即注入「参考的世界」（不再限定改编IP类型）", () => {
    const p = buildWorldGenerationPrompt("HP 模拟器", "魔法世界", "", "哈利波特", "", "none", undefined, 3, "", "solo");
    assert.ok(p.includes("参考的世界"), "应注入「参考的世界（作品名称）」段");
    assert.ok(p.includes("哈利波特"), "应出现填写的作品名");
});

test("生成提示词：世界来源「类型」那一行已移除（不再有「基于已有 IP / 小说」「原创世界观」选项文案）", () => {
    const ip = buildWorldGenerationPrompt("HP", "魔法", "", "哈利波特", "", "none", undefined, 3, "", "solo");
    const orig = buildWorldGenerationPrompt("原创世界", "仙侠", "", "", "", "none", undefined, 3, "", "solo");
    assert.ok(!ip.includes("基于已有 IP / 小说"), "改编IP 选项文案应消失");
    assert.ok(!orig.includes("原创世界观"), "原创世界观选项文案应消失");
    assert.ok(!ip.includes("- 类型："), "不应再有「- 类型：」这一世界来源行");
});

test("resolveCanonContext：只认 ipName——留空归 original，填写归 ip_adaptation", () => {
    const empty = resolveCanonContext({ ipName: "", desc: "霍格沃茨特快驶向学校", sourceFileContent: "" });
    assert.equal(empty.mode, "original");
    assert.equal(empty.ip_name, null);

    const filled = resolveCanonContext({ ipName: "哈利波特", desc: "", sourceFileContent: "" });
    assert.equal(filled.mode, "ip_adaptation");
    assert.equal(filled.ip_name, "哈利波特");
});

test("ensureWorldCanon：mode 只看 ip_name，旧 type 字段不再参与", () => {
    const withIp = { ip_name: "三体" };
    assert.equal(ensureWorldCanon(withIp).mode, "ip_adaptation");
    const noIp = { type: "ip", ip_name: null };
    assert.equal(ensureWorldCanon(noIp).mode, "original", "即使残留 type=ip，无 ip_name 仍归原创");
});

test("完成度清单：hero 为可选维度，不计入必填分母（total=6）", () => {
    const w = { name: "x", desc: "d", opening_narrative: "o", characters: [{ name: "a" }], rules: [{ name: "r" }], lore_kb: { snippets: [{ id: "s", trigger: {} }] } };
    const r = computeWorldCompletion(w);
    assert.equal(r.total, 6, "必填维度不含 hero");
    assert.equal(r.items.find(i => i.key === "hero").optional, true);
    assert.equal(r.grade, "圆满", "无 hero 也应可达成圆满");
});

test("标签函数：analyzeWorldTags / pickWorldTags 已去 type 参数且不写来源标签", () => {
    const a = analyzeWorldTags("修仙世界", "修真", "", null);
    assert.ok(a.includes("修仙"), "仍命中题材");
    assert.ok(!a.includes("原创"), "不写来源标签");
    const picked = pickWorldTags({}, { name: "校园恋爱", desc: "校园", hero: "", ipName: null });
    assert.ok(picked.includes("校园"), "兜底正则命中题材");
});
