// P0：叙事节奏 / 中文叙事字数 / 阅读速度 可调
// 覆盖：① buildNarrativeControlNote 纯函数（各档指令 / standard 零回归）
//       ② getTypingDelays / getStreamThrottleMs 纯函数
//       ③ buildAuthorNote 每轮合并玩家控制指令（中部注入，中途改即生效）
//       ④ change* 持久化到 localStorage 并更新 S
// 不触及真实 DOM / 引擎运行期，仅依赖可单测纯函数与轻量全局桩。

import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../src/store.js";
import { buildNarrativeControlNote, buildAuthorNote } from "../src/prompt.js";
import { getTypingDelays, getStreamThrottleMs } from "../src/render.js";
import { changeNarrativePacing, changeNarrativeLength, changeReadingSpeed } from "../src/theme.js";

// 最小世界环境（仿 s5-authoritative-time 测试），让 buildAuthorNote 可跑
function setWorld() {
    S.currentWorld = { schema: {} };
    S.gameState = {};
}

// ---------- ① buildNarrativeControlNote ----------
test("buildNarrativeControlNote: standard（含默认参数）不追加任何指令（零回归）", () => {
    assert.equal(buildNarrativeControlNote("standard", "standard"), "");
    assert.equal(buildNarrativeControlNote(), "");
});

test("buildNarrativeControlNote: compact/relaxed 节奏指令", () => {
    assert.ok(buildNarrativeControlNote("compact", "standard").includes("【叙事节奏·紧凑】"));
    assert.ok(buildNarrativeControlNote("relaxed", "standard").includes("【叙事节奏·舒缓】"));
});

test("buildNarrativeControlNote: short/long 字数指令", () => {
    assert.ok(buildNarrativeControlNote("standard", "short").includes("【叙事字数·简略】"));
    assert.ok(buildNarrativeControlNote("standard", "long").includes("【叙事字数·详尽】"));
    const both = buildNarrativeControlNote("compact", "long");
    assert.ok(both.includes("【叙事节奏·紧凑】") && both.includes("【叙事字数·详尽】"));
});

// ---------- ② 展示端纯函数 ----------
test("getTypingDelays: 各档返回正确表，未知档回落 standard，instant 返回 null", () => {
    assert.deepEqual(getTypingDelays("standard"), { base: 12, sentence: 70, comma: 35, newline: 45, quote: 25 });
    assert.equal(getTypingDelays("slow").base, 28);
    assert.equal(getTypingDelays("fast").base, 6);
    assert.equal(getTypingDelays("instant"), null);
    assert.deepEqual(getTypingDelays("bogus"), getTypingDelays("standard"));
});

test("getStreamThrottleMs: 仅 slow=120，其余=0", () => {
    assert.equal(getStreamThrottleMs("slow"), 120);
    assert.equal(getStreamThrottleMs("standard"), 0);
    assert.equal(getStreamThrottleMs("fast"), 0);
    assert.equal(getStreamThrottleMs("instant"), 0);
});

// ---------- ③ buildAuthorNote 每轮合并玩家控制指令 ----------
test("buildAuthorNote 含玩家叙事控制指令（P0 中部每轮注入）", () => {
    setWorld();
    S.narrativePacing = "compact";
    S.narrativeLength = "long";
    const note = buildAuthorNote();
    assert.ok(note.includes("【叙事节奏·紧凑】"), "应含紧凑节奏指令");
    assert.ok(note.includes("【叙事字数·详尽】"), "应含详尽字数指令");
});

test("buildAuthorNote 在 standard 时不混入控制指令", () => {
    setWorld();
    S.narrativePacing = "standard";
    S.narrativeLength = "standard";
    const note = buildAuthorNote();
    assert.ok(!note.includes("【叙事节奏·"), "standard 不应含节奏指令");
    assert.ok(!note.includes("【叙事字数·"), "standard 不应含字数指令");
});

// ---------- ④ 持久化（轻量 localStorage + document 桩） ----------
function installDomLs() {
    const store = {};
    globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
    const stubEl = { classList: { toggle() {} } };
    globalThis.document = { getElementById: () => stubEl };
    return store;
}

test("changeNarrativePacing: 写入 localStorage 并更新 S", () => {
    const store = installDomLs();
    changeNarrativePacing("relaxed");
    assert.equal(S.narrativePacing, "relaxed");
    assert.equal(store["aigame_pacing"], "relaxed");
});

test("changeNarrativeLength / changeReadingSpeed: 写入 localStorage 并更新 S", () => {
    const store = installDomLs();
    changeNarrativeLength("long");
    changeReadingSpeed("slow");
    assert.equal(S.narrativeLength, "long");
    assert.equal(S.readingSpeed, "slow");
    assert.equal(store["aigame_narrlen"], "long");
    assert.equal(store["aigame_readspeed"], "slow");
});
