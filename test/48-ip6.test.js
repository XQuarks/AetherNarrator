// ============================================================
// IP#6 · 生成后硬扫描（标黄 + 提示条 + 三动作）单元测试
// 覆盖：ip_scan 模块动态默认（填作品名才开）、removeSentenceWithTerm 移除逻辑、
// highlightBanned / renderNarrative 标黄、renderScanWarnBar 三按钮、
// computeIpScanHits 扫描+忽略过滤、自由度≥4 免扫。
// 纯函数 + 最小 document stub，不依赖真实 API / 浏览器。
// ============================================================
import { test } from "node:test";
import assert from "node:assert";

import { S } from "../src/store.js";
import { MODULE_REGISTRY, defaultModules, isModuleEnabled } from "../src/modules.js";
import { highlightBanned, highlightItems, renderNarrative, renderScanWarnBar } from "../src/render.js";
import { removeSentenceWithTerm } from "../src/utils.js";
import { computeIpScanHits } from "../src/game.js";
import { getBannedConceptRules } from "../src/store.js";

function resetState() {
    S.currentWorld = null;
    S.gameState = { ignoredBanned: [] };
    S.chatHistory = [];
    S.chatSummary = [];
}

// ----------------------------------------------------------
// 1. ip_scan 模块：动态默认（填了作品名才默认开）
// ----------------------------------------------------------
test("MODULE_REGISTRY 含 ip_scan 模块", () => {
    assert.ok(MODULE_REGISTRY.some(m => m.id === "ip_scan"), "应登记 ip_scan");
});

test("ip_scan 默认：填了 ip_name → 默认开；没填 → 默认关", () => {
    const withName = { id: "w1", ip_name: "哈利波特" };
    const without = { id: "w2", ip_name: "" };
    assert.strictEqual(defaultModules(withName).ip_scan.enabled, true, "填作品名应默认开");
    assert.strictEqual(defaultModules(without).ip_scan.enabled, false, "原创无作品名应默认关");
});

test("isModuleEnabled：ip_scan 动态默认随 ip_name；显式关闭覆盖默认", () => {
    const wName = { id: "w1", ip_name: "克苏鲁神话" }; // 无 world.modules
    assert.strictEqual(isModuleEnabled(wName, "ip_scan"), true, "有 ip_name 且无显式设置 → 开");
    const wPlain = { id: "w2" };
    assert.strictEqual(isModuleEnabled(wPlain, "ip_scan"), false, "无 ip_name 且无显式设置 → 关");
    // 用户即使填了作品名，也可手动关掉
    const wOff = { id: "w3", ip_name: "HP", modules: { ip_scan: { enabled: false } } };
    assert.strictEqual(isModuleEnabled(wOff, "ip_scan"), false, "显式关闭应覆盖动态默认");
});

test("ip_scan 受 isModuleEnabled 门禁（核心模块不受影响）", () => {
    const w = { id: "w", ip_name: "HP" };
    assert.strictEqual(isModuleEnabled(w, "ip_scan"), true);
    // 关掉后扫描应被门禁挡住（game.js 的 A2 块依赖此判断）
    w.modules = { ip_scan: { enabled: false } };
    assert.strictEqual(isModuleEnabled(w, "ip_scan"), false);
});

// ----------------------------------------------------------
// 1.5 highlightItems：gameState 缺 inventory 时不炸（AI 世界缺字段回归）
// ----------------------------------------------------------
test("highlightItems：gameState 无 inventory 字段时不炸（返回原文本）", () => {
    resetState(); // S.gameState = { ignoredBanned: [] }，无 inventory（真实 AI 世界可能缺该字段）
    assert.strictEqual(highlightItems("你走进大厅。"), "你走进大厅。", "缺 inventory 时原样返回，不读 undefined.length");
});

test("highlightItems：有 inventory 时正常高亮物品名", () => {
    resetState();
    S.gameState.inventory = [{ name: "魔杖" }];
    const out = highlightItems("你握着魔杖，走进大厅。");
    assert.ok(out.includes("item-highlight"), "有 inventory 时应正常高亮");
});

// ----------------------------------------------------------
// 2. removeSentenceWithTerm：移除含命中词的句子
// ----------------------------------------------------------
test("removeSentenceWithTerm：移除含命中词的句子，保留其余", () => {
    const text = "你走进大厅。他突然掏出手机打了个电话。夜色渐深。";
    const out = removeSentenceWithTerm(text, "手机");
    assert.ok(out.includes("你走进大厅"), "前句应保留");
    assert.ok(out.includes("夜色渐深"), "后句应保留");
    assert.ok(!out.includes("手机"), "含命中词的句子应被移除");
});

test("removeSentenceWithTerm：命中词不存在 → 原样返回", () => {
    const text = "风很轻柔。月光洒在窗台。";
    assert.strictEqual(removeSentenceWithTerm(text, "火箭"), text);
});

test("removeSentenceWithTerm：空输入安全返回", () => {
    assert.strictEqual(removeSentenceWithTerm("", "x"), "");
    assert.strictEqual(removeSentenceWithTerm("abc", ""), "abc");
});

// ----------------------------------------------------------
// 3. highlightBanned / renderNarrative：标黄
// ----------------------------------------------------------
test("highlightBanned：把命中词包成 .banned-hit 黄底", () => {
    const html = highlightBanned("他拿出手机打电话。", ["手机"]);
    assert.ok(html.includes('<span class="banned-hit">手机</span>'), "应生成黄底 span");
});

test("highlightBanned：无命中词 → 原样返回", () => {
    assert.strictEqual(highlightBanned("平静的夜里。", []), "平静的夜里。");
});

test("renderNarrative：带入 bannedHits 时叙事中标黄", () => {
    const html = renderNarrative("他拿出手机打电话。", false, ["手机"]);
    assert.ok(html.includes('<span class="banned-hit">手机</span>'), "renderNarrative 应标黄");
});

test("renderNarrative：isWarning 时不标黄、纯转义", () => {
    const html = renderNarrative("系统拦截", true, ["手机"]);
    assert.ok(!html.includes("banned-hit"), "警告条目不应标黄");
});

// ----------------------------------------------------------
// 4. renderScanWarnBar：三按钮 + 数据
// ----------------------------------------------------------
test("renderScanWarnBar：含 移除这句 / AI 重写本回合 / 忽略 三按钮", () => {
    const html = renderScanWarnBar({ bannedHits: ["手机"] }, 3);
    assert.ok(html.includes('data-action="removeBannedSentence"'), "应有移除按钮");
    assert.ok(html.includes('data-action="regenerateTurn"'), "应有重写按钮");
    assert.ok(html.includes('data-action="ignoreBannedTerm"'), "应有忽略按钮");
    assert.ok(html.includes('data-idx="3"'), "应带条目下标");
    assert.ok(html.includes('data-term="手机"'), "应带命中词");
});

// ----------------------------------------------------------
// 5. computeIpScanHits：扫描 + 忽略过滤 + 自由度≥4 免扫
// ----------------------------------------------------------
test("computeIpScanHits：叙事含违禁概念 → 返回命中词", () => {
    resetState();
    const rules = [{ concept: "手机", aliases: [], severity: "soft" }];
    const hits = computeIpScanHits("他掏出手机打电话。", "", rules, []);
    assert.deepStrictEqual(hits, ["手机"]);
});

test("computeIpScanHits：选项文本也并入扫描范围", () => {
    resetState();
    const rules = [{ concept: "魔法杖", aliases: [], severity: "soft" }];
    const hits = computeIpScanHits("你环顾四周。", "用魔法杖施法", rules, []);
    assert.deepStrictEqual(hits, ["魔法杖"]);
});

test("computeIpScanHits：已「忽略」的词被过滤", () => {
    resetState();
    const rules = [{ concept: "手机", aliases: [], severity: "soft" }];
    const hits = computeIpScanHits("他掏出手机打电话。", "", rules, ["手机"]);
    assert.deepStrictEqual(hits, [], "忽略列表中的词不应再命中");
});

test("computeIpScanHits：自由度≥4 时 getBannedConceptRules 返回空 → 免扫", () => {
    resetState();
    S.currentWorld = { id: "w", plot_freedom: 5 }; // ≥4 放宽
    const rules = getBannedConceptRules();
    assert.deepStrictEqual(rules, [], "高自由度世界不应注入禁项");
    const hits = computeIpScanHits("他掏出手机打电话。", "", rules, []);
    assert.deepStrictEqual(hits, [], "无规则则无命中（天然免扫）");
});
