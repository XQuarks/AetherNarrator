// # docs/70：状态栏与变动日志 —— 防泄漏 / 结构化 / 折叠 / 随机事件 单测
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeLLMText } from "../src/utils.js";
import { formatStateChanges, formatStateChangesStructured, shouldTriggerRandomEvent, pickRandomEvent, buildRandomEventNote, getRandomEventHint } from "../src/prompt.js";
import { renderTurnChanges } from "../src/render.js";
import { MODULE_REGISTRY, isModuleEnabled } from "../src/modules.js";

// ---------- 1) sanitizeLLMText：防代码/格式泄漏到界面 ----------
test("sanitizeLLMText：剥离 ``` 代码围栏，内容保留为普通文本", () => {
    const raw = "你推开门。\n```json\n{ \"narrative\": \"x\" }\n```\n里面一片漆黑。";
    const got = sanitizeLLMText(raw);
    assert.equal(got.includes("```"), false, "不应残留 ```");
    assert.ok(got.includes("你推开门"), "正文应保留");
    assert.ok(got.includes("里面一片漆黑"), "正文应保留");
});

test("sanitizeLLMText：行内反引号代码去标记", () => {
    const got = sanitizeLLMText("他念出 `Expelliarmus` 解除了武装");
    assert.equal(got, "他念出 Expelliarmus 解除了武装");
});

test("sanitizeLLMText：丢弃疑似 JSON 结构行", () => {
    const raw = "走廊里传来脚步。\n{ \"bonds\": { \"赫敏\": 5 } }\n你握紧了魔杖。";
    const got = sanitizeLLMText(raw);
    assert.equal(got.includes('"bonds"'), false, "不应残留 JSON 结构行");
    assert.ok(got.includes("走廊里传来脚步"), "正文保留");
    assert.ok(got.includes("你握紧了魔杖"), "正文保留");
});

test("sanitizeLLMText：清除【状态栏】占位标记", () => {
    const got = sanitizeLLMText("【状态栏】\n姓名：小明\n故事正文继续");
    assert.equal(got.includes("【状态栏】"), false);
    assert.ok(got.includes("故事正文继续"));
});

test("sanitizeLLMText：含 {龙纹} 这类非 JSON 行不误伤", () => {
    const raw = "他翻出一本《choices》笔记，封面上画着 {龙纹}。";
    assert.equal(sanitizeLLMText(raw), raw);
});

test("sanitizeLLMText：null/空 → 空串", () => {
    assert.equal(sanitizeLLMText(null), "");
    assert.equal(sanitizeLLMText(""), "");
    assert.equal(sanitizeLLMText(undefined), "");
});

// ---------- 2) formatStateChangesStructured：结构化 + 好感 ±1 + 技能 ----------
test("formatStateChangesStructured：好感 +1 也显示（不设阈值）", () => {
    const out = formatStateChangesStructured({ state_changes: { bonds: { "赫敏": { delta: 1 } } } }, {});
    assert.ok(out.some(x => x.cat === "关系" && x.text.includes("好感 +1")), "关系类应含 好感 +1");
});

test("formatStateChangesStructured：好感 -1 也显示", () => {
    const out = formatStateChangesStructured({ state_changes: { bonds: { "斯内普": { delta: -1 } } } }, {});
    assert.ok(out.some(x => x.cat === "关系" && x.text.includes("好感 -1")), "关系类应含 好感 -1");
});

test("formatStateChangesStructured：覆盖变量/地点/关系/物品/状态/技能 分类", () => {
    const entry = {
        varChanges: [{ type: "number", name: "理智", from: 80, to: 70, unit: "" }],
        state_changes: {
            current_location: "魔药课教室",
            bonds: { "赫敏": { delta: 5, tags: ["信任"] } },
            inventory: [{ op: "add", name: "魔杖", is_key: true }],
            status_effects: [{ name: "轻微擦伤" }],
            skills: { "魔咒学": { delta: 1 } }
        }
    };
    const out = formatStateChangesStructured(entry, {});
    const cats = out.map(x => x.cat);
    assert.ok(cats.includes("变量"));
    assert.ok(cats.includes("地点"));
    assert.ok(cats.includes("关系"));
    assert.ok(cats.includes("物品"));
    assert.ok(cats.includes("状态"));
    assert.ok(cats.includes("技能"));
    assert.ok(out.some(x => x.cat === "物品" && x.text.includes("[关键]")), "关键物品带 [关键] 标记");
});

test("formatStateChangesStructured：无任何变化 → 空数组", () => {
    assert.deepEqual(formatStateChangesStructured({ state_changes: {}, varChanges: [] }, {}), []);
    assert.deepEqual(formatStateChangesStructured({}, {}), []);
});

test("formatStateChanges（扁平兼容）：等于结构化版的 text 列表", () => {
    const entry = {
        varChanges: [{ type: "number", name: "体力", from: 100, to: 90 }],
        state_changes: { bonds: { "罗恩": { delta: 3 } }, inventory: [{ op: "add", name: "面包" }] }
    };
    const flat = formatStateChanges(entry, {});
    const structuredText = formatStateChangesStructured(entry, {}).map(x => x.text);
    assert.deepEqual(flat, structuredText);
});

// ---------- 3) renderTurnChanges：折叠 / 分组 / 上限6 / 空隐藏 ----------
import { S } from "../src/store.js";
S.currentWorld = null;

test("renderTurnChanges：整轮无变化 → 返回空串（区块完全隐藏）", () => {
    assert.equal(renderTurnChanges({ state_changes: {}, varChanges: [] }), "");
    assert.equal(renderTurnChanges({}), "");
});

test("renderTurnChanges：默认折叠（<details> 不带 open 属性）", () => {
    const html = renderTurnChanges({ state_changes: { bonds: { "赫敏": { delta: 5 } } } });
    assert.ok(html.startsWith('<details class="turn-changes">'), "以 <details> 开头");
    assert.ok(/<details[^>]*>/.test(html) && !/<details[^>]*\sopen/.test(html), "不应含 open 属性（默认折叠）");
    assert.ok(html.includes("本回合变化"), "含标题");
});

test("renderTurnChanges：单类超过 6 条 → 截断并显示「…另有 N 项未列出」", () => {
    const varChanges = [];
    for (let i = 1; i <= 8; i++) varChanges.push({ type: "number", name: "属性" + i, from: 0, to: 1 });
    const html = renderTurnChanges({ varChanges });
    assert.ok(html.includes("本回合变化（8 项）"), "总数应为 8");
    assert.ok(html.includes("另有 2 项未列出"), "应提示超出 2 项");
    // 变量类中可见条目应为 6 + 1（提示）条 turn-change-item
    const itemCount = (html.match(/turn-change-item/g) || []).length;
    assert.equal(itemCount, 7, "6 条可见 + 1 条提示 = 7");
});

// ---------- 4) 模块注册：random_event ----------
test("modules：random_event 已注册且默认关闭（可自选功能）", () => {
    const m = MODULE_REGISTRY.find(x => x.id === "random_event");
    assert.ok(m, "random_event 模块应存在");
    assert.equal(m.defaultEnabled, false, "可自选功能，默认关闭");
    assert.ok(typeof m.promptFragment === "function", "应有提示词片段");
});

test("random_event promptFragment：无池返回 null，有池才注入指令（一致性）", () => {
    const m = MODULE_REGISTRY.find(x => x.id === "random_event");
    assert.equal(m.promptFragment({}), null, "无 random_events 不注入招牌");
    assert.equal(m.promptFragment({ random_events: [] }), null, "空池不注入招牌");
    assert.ok(m.promptFragment({ random_events: [{ title: "X" }] }), "有池才注入指令文案");
});

// ---------- 5) 随机事件纯函数调度 ----------
test("shouldTriggerRandomEvent：每 3 回合触发", () => {
    assert.equal(shouldTriggerRandomEvent(3, 3), true);
    assert.equal(shouldTriggerRandomEvent(6, 3), true);
    assert.equal(shouldTriggerRandomEvent(4, 3), false);
    assert.equal(shouldTriggerRandomEvent(0, 3), false);
});

test("pickRandomEvent：排除上一次避免连续重复；空池返回 null", () => {
    const pool = [{ title: "A" }, { title: "B" }, { title: "C" }];
    const first = pickRandomEvent(pool, null, () => 0);
    assert.equal(first.title, "A");
    const second = pickRandomEvent(pool, "A", () => 0); // 排除 A 后取首个 = B
    assert.equal(second.title, "B");
    assert.equal(pickRandomEvent([], null), null);
});

test("buildRandomEventNote：拼出注入文案", () => {
    const note = buildRandomEventNote({ title: "走廊遇故人", hint: "一位旧识叫住你" });
    assert.ok(note.includes("走廊遇故人"));
    assert.ok(note.includes("旧识叫住你"));
    assert.equal(buildRandomEventNote(null), null);
});

test("getRandomEventHint：未到节奏 / 无池 / 模块关 → null；到节奏且有池 → 注入", () => {
    const worldOff = { modules: { random_event: { enabled: false } }, random_events: [{ title: "X" }] };
    assert.equal(getRandomEventHint({ world: worldOff, history: [{ isWarning: false }] }), null, "模块关闭不注入");

    const worldNoPool = { modules: { random_event: { enabled: true } } };
    assert.equal(getRandomEventHint({ world: worldNoPool, history: [{ isWarning: false }, { isWarning: false }, { isWarning: false }] }), null, "无事件池不注入");

    const worldOk = { modules: { random_event: { enabled: true } }, random_events: [{ title: "巨怪走廊" }, { title: "匿名信" }] };
    const hint = getRandomEventHint({ world: worldOk, history: [{ isWarning: false }, { isWarning: false }, { isWarning: false }] });
    assert.ok(hint, "第3回合应注入随机事件");
    assert.ok(/巨怪走廊|匿名信/.test(hint), "应注入事件池中的某一事件");
});
