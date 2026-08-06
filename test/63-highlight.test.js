// ============================================================
// docs/63 · 剧情文本高亮（A 人名 / B AI 标记 / C 对白）单元测试
// 覆盖：highlightTerms 防嵌套、highlightNames 单字过滤、
// highlightDialogue 引号识别、highlightAiMarks **/== 解析、
// renderNarrative 整合管道（物品+人名+对白+AI标记+违禁词叠加）、
// 开关关闭、转义安全（XSS 不注入）、highlightItems 兼容性。
// 纯函数 + store 单例，不依赖真实 API / 浏览器。
// ============================================================
import { test } from "node:test";
import assert from "node:assert";

import { S } from "../src/store.js";
import {
    highlightTerms, highlightNames, highlightItems,
    highlightDialogue, highlightAiMarks, renderNarrative
} from "../src/render.js";

function resetState() {
    S.currentWorld = null;
    S.gameState = { ignoredBanned: [] };
    S.highlightNames = true;
    S.highlightItems = true;
    S.highlightDialogue = true;
    S.highlightAiMarks = true;
}

// ----------------------------------------------------------
// 0. store 默认值：4 个高亮开关默认全开
// ----------------------------------------------------------
test("S 高亮设置默认全开", () => {
    assert.strictEqual(S.highlightNames, true, "人物名字高亮默认开");
    assert.strictEqual(S.highlightItems, true, "背包物品高亮默认开");
    assert.strictEqual(S.highlightDialogue, true, "对白高亮默认开");
    assert.strictEqual(S.highlightAiMarks, true, "AI 标记解析默认开");
});

// ----------------------------------------------------------
// 1. highlightTerms：多词高亮核心 + 防嵌套
// ----------------------------------------------------------
test("highlightTerms：基本替换 + 长词优先不嵌套", () => {
    const out = highlightTerms("哈利波特和哈利都在。", ["哈利", "哈利波特"], "name-highlight");
    // 长词「哈利波特」整体命中一次；独立出现的短词「哈利」单独高亮；
    // 关键不变量：长词 span 内部不得被短词再拆一层
    assert.ok(out.includes('<span class="name-highlight">哈利波特</span>'), "长词整体包裹");
    assert.ok(!out.includes('<span class="name-highlight">哈利</span>波特'), "长词 span 内不得嵌套短词");
    assert.strictEqual((out.match(/name-highlight/g) || []).length, 2, "长词 + 独立短词各一处");
});

test("highlightTerms：空词表/空文本原样返回", () => {
    assert.strictEqual(highlightTerms("普通文本。", [], "x"), "普通文本。");
    assert.strictEqual(highlightTerms("", ["词"], "x"), "");
    assert.strictEqual(highlightTerms(null, ["词"], "x"), null);
});

test("highlightTerms：已包裹 span 内的文本不被后续词表再套（跨词表防嵌套）", () => {
    // 第一层：物品「魔杖」已生成 span；第二层词表含「魔」等更短词时不得在 span 内再套
    const first = highlightTerms("哈利握着魔杖。", ["魔杖"], "item-highlight");
    const out = highlightTerms(first, ["魔杖"], "name-highlight");
    assert.ok(!out.includes('item-highlight"><span class="name-highlight"'), "span 内不得再嵌套");
    assert.ok(out.includes('<span class="item-highlight">魔杖</span>'), "外层 span 保持完整");
});

// ----------------------------------------------------------
// 2. highlightItems：兼容既有行为（test/48 回归）
// ----------------------------------------------------------
test("highlightItems：gameState 无 inventory 时不炸（返回原文本）", () => {
    resetState(); // S.gameState 无 inventory
    assert.strictEqual(highlightItems("你走进大厅。"), "你走进大厅。");
});

test("highlightItems：有 inventory 时正常高亮物品名", () => {
    resetState();
    S.gameState.inventory = [{ name: "魔杖" }];
    const out = highlightItems("你握着魔杖，走进大厅。");
    assert.ok(out.includes("item-highlight"), "应高亮物品名");
    assert.ok(out.includes('<span class="item-highlight">魔杖</span>'));
});

// ----------------------------------------------------------
// 3. highlightNames：人物名字高亮（A）
// ----------------------------------------------------------
test("highlightNames：无 currentWorld 时不炸（原样返回）", () => {
    resetState();
    assert.strictEqual(highlightNames("你走进大厅。"), "你走进大厅。");
});

test("highlightNames：从 B1 人物卡取名字高亮", () => {
    resetState();
    S.currentWorld = { characters: [{ name: "赫敏" }, { name: "罗恩" }] };
    const out = highlightNames("赫敏与罗恩正在争论。");
    assert.ok(out.includes('<span class="name-highlight">赫敏</span>'));
    assert.ok(out.includes('<span class="name-highlight">罗恩</span>'));
});

test("highlightNames：单字名不参与（防误伤）", () => {
    resetState();
    S.currentWorld = { characters: [{ name: "王" }, { name: "哈利" }] };
    const out = highlightNames("王先生对哈利说。");
    assert.ok(!out.includes("name-highlight\">王</span>"), "单字名不应高亮");
    assert.ok(out.includes('<span class="name-highlight">哈利</span>'), "两字名正常高亮");
});

// ----------------------------------------------------------
// 4. highlightDialogue：对白引号识别（C）
// ----------------------------------------------------------
test("highlightDialogue：中文弯引号与直角引号", () => {
    const out = highlightDialogue("她低声说：“今晚就走。”他笑道「你确定？」");
    assert.ok(out.includes('<span class="dialogue-highlight">“今晚就走。”</span>'));
    assert.ok(out.includes('<span class="dialogue-highlight">「你确定？」</span>'));
});

test("highlightDialogue：英文双引号（转义为 &quot; 后仍可识别）", () => {
    const out = highlightDialogue("他喊道：\"站住！\"");
    assert.ok(out.includes('<span class="dialogue-highlight">&quot;站住！&quot;</span>'), "英文引号对应完整包裹");
});

test("highlightDialogue：无引号文本原样返回", () => {
    assert.strictEqual(highlightDialogue("平静的夜里，风在吹。"), "平静的夜里，风在吹。");
});

// ----------------------------------------------------------
// 5. highlightAiMarks：AI 标记解析（B）
// ----------------------------------------------------------
test("highlightAiMarks：**加粗** 与 ==高亮== 解析", () => {
    const out = highlightAiMarks("这是**关键线索**，而==真相==在后面。");
    assert.ok(out.includes('<strong class="ai-emphasis">关键线索</strong>'));
    assert.ok(out.includes('<span class="ai-mark">真相</span>'));
});

test("highlightAiMarks：无标记时原样返回", () => {
    assert.strictEqual(highlightAiMarks("普通的叙述文本。"), "普通的叙述文本。");
});

test("highlightAiMarks：标记内文本被转义（不引入 HTML）", () => {
    const out = highlightAiMarks("**<script>alert(1)</script>**");
    assert.ok(!out.includes("<script>"), "不得出现原始 script 标签");
    assert.ok(out.includes("&lt;script&gt;"), "内部文本应转义");
    assert.ok(out.includes('<strong class="ai-emphasis">'), "包裹结构完整");
});

// ----------------------------------------------------------
// 6. renderNarrative：整合管道（开关 + 叠加 + 转义安全）
// ----------------------------------------------------------
test("renderNarrative：人名+物品+对白+AI标记+违禁词全部叠加", () => {
    resetState();
    S.currentWorld = { characters: [{ name: "赫敏" }] };
    S.gameState.inventory = [{ name: "魔杖" }];
    const text = "赫敏握着魔杖说：“**别怕**，真相是==密室==。”";
    const html = renderNarrative(text, false, ["密室"]);
    assert.ok(html.startsWith("<p>") && html.endsWith("</p>"), "段落包裹");
    assert.ok(html.includes('class="name-highlight"'), "人名高亮");
    assert.ok(html.includes('class="item-highlight"'), "物品高亮");
    assert.ok(html.includes('class="dialogue-highlight"'), "对白高亮");
    assert.ok(html.includes('class="ai-emphasis"'), "AI 粗体");
    assert.ok(html.includes('class="ai-mark"'), "AI 高亮");
    assert.ok(html.includes('class="banned-hit"'), "违禁词标黄（最后叠加）");
});

test("renderNarrative：开关关闭时对应层不高亮，但段落结构保留", () => {
    resetState();
    S.currentWorld = { characters: [{ name: "赫敏" }] };
    S.highlightNames = false;
    S.highlightAiMarks = false;
    const html = renderNarrative("赫敏说：“**别怕**。”", false, null);
    assert.ok(html.startsWith("<p>"), "段落仍在");
    assert.ok(!html.includes("name-highlight"), "人名高亮被关");
    assert.ok(!html.includes("ai-emphasis"), "AI 标记不解析（符号原样）");
    assert.ok(html.includes("**别怕**"), "标记符号原样保留");
    assert.ok(html.includes("dialogue-highlight"), "对白高亮不受影响");
});

test("renderNarrative：isWarning 时纯转义不高亮", () => {
    resetState();
    const html = renderNarrative("系统拦截", true, ["手机"]);
    assert.ok(!html.includes("banned-hit"), "警告文本不标黄");
    assert.ok(!html.includes("<p>"), "警告文本不做段落包裹");
});

test("renderNarrative：XSS 安全（<script> 被转义）", () => {
    resetState();
    const html = renderNarrative("<script>alert(1)</script> 赫敏", false, null);
    assert.ok(!html.includes("<script>"), "原始标签不得出现");
    assert.ok(html.includes("&lt;script&gt;"), "应转义为实体");
});

test("renderNarrative：旧档回归（无 bannedHits 参数也正常）", () => {
    resetState();
    const html = renderNarrative("你走进大厅。", false);
    assert.strictEqual(html, "<p>你走进大厅。</p>");
});
