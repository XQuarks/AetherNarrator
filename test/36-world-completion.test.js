// A3 创作完成度清单 · 纯函数回归测试（docs/36 方案 A）。
// 锁定 computeWorldCompletion 对 7 个派生维度的判定、pct 计算、空 world 兜底。
// 仅测纯函数，不触及 DOM / 引擎。

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWorldCompletion } from "../src/utils.js";

// 一个"全满"的世界
function fullWorld() {
    return {
        name: "霍格沃茨模拟器",
        desc: "一个以魔法学校为背景的开放世界，玩家扮演新生。",
        opening_narrative: "九又四分之三站台的蒸汽弥漫……",
        hero: "一名麻瓜出身的一年级新生，渴望证明自己。",
        characters: [{ name: "哈利", role: "npc" }],
        rules: [{ name: "学院分制", enabled: true }],
        lore_kb: {
            snippets: [
                { id: "s1", title: "分院仪式", content: "…", trigger: { type: "once" } },
                { id: "s2", title: "普通设定", content: "…" }
            ]
        }
    };
}

test("满世界：7/7 圆满，pct=100，含 1 条带 trigger 的片段算作重要事件", () => {
    const r = computeWorldCompletion(fullWorld());
    assert.equal(r.total, 7);
    assert.equal(r.done, 7);
    assert.equal(r.pct, 100);
    assert.equal(r.grade, "圆满");
    // 重要事件维度应命中 s1（带 trigger）
    const ev = r.items.find(i => i.key === "events");
    assert.equal(ev.done, true);
});

test("缺角色/规则/事件/主角设定：done=3，pct≈43，评级待充实（<4 按方案）", () => {
    const w = {
        name: "X",
        desc: "有世界观描述",
        opening_narrative: "开场",
        hero: "",
        characters: [],
        rules: [],
        lore_kb: { snippets: [{ id: "s", title: "t", content: "c" }] } // 无 trigger
    };
    const r = computeWorldCompletion(w);
    assert.equal(r.done, 3); // 标题+世界观+开场
    assert.equal(r.pct, Math.round((3 / 7) * 100));
    assert.equal(r.grade, "待充实");
    assert.equal(r.items.find(i => i.key === "characters").done, false);
    assert.equal(r.items.find(i => i.key === "rules").done, false);
    assert.equal(r.items.find(i => i.key === "events").done, false);
    assert.equal(r.items.find(i => i.key === "hero").done, false);
});

test("空字符串视为未完成（世界观/开场/主角设定空壳不算）", () => {
    const w = { name: "Y", desc: "   ", opening_narrative: "", hero: null, characters: [], rules: [], lore_kb: { snippets: [] } };
    const r = computeWorldCompletion(w);
    assert.equal(r.items.find(i => i.key === "title").done, true); // name 非空
    assert.equal(r.items.find(i => i.key === "worldview").done, false);
    assert.equal(r.items.find(i => i.key === "opening").done, false);
    assert.equal(r.items.find(i => i.key === "hero").done, false);
});

test("lore_kb 缺失 / 非数组 不崩，事件维度 done=false", () => {
    const r = computeWorldCompletion({ name: "Z", desc: "d", opening_narrative: "o", characters: [{ name: "a" }] });
    assert.equal(r.items.find(i => i.key === "events").done, false);
    assert.equal(r.items.find(i => i.key === "characters").done, true);
});

test("null / undefined world 兜底：total=7, done=0, pct=0, 评级待充实", () => {
    assert.deepEqual(computeWorldCompletion(null).done, 0);
    assert.deepEqual(computeWorldCompletion(undefined).pct, 0);
    assert.equal(computeWorldCompletion(null).grade, "待充实");
    assert.equal(computeWorldCompletion(null).total, 7);
});

test("评级阈值：done<4 为待充实，done>=4 为基本可用，done=total 为圆满", () => {
    const base = { name: "n", desc: "d", opening_narrative: "o", hero: "h", characters: [{ name: "a" }], rules: [{ name: "r" }], lore_kb: { snippets: [{ id: "s", trigger: {} }] } };
    assert.equal(computeWorldCompletion(base).grade, "圆满"); // 7/7
    const four = computeWorldCompletion({ ...base, lore_kb: { snippets: [] } }); // 6/7
    assert.equal(four.grade, "基本可用");
    const three = computeWorldCompletion({ name: "n", desc: "d", opening_narrative: "o" }); // 3/7
    assert.equal(three.grade, "待充实");
});
