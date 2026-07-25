import assert from "node:assert";
import test from "node:test";
import { buildStyleProfile, buildStyleGuide } from "../src/prompt.js";

// collectStylePrefs 依赖 document，在动态导入前 stub 最小实现
globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null
};

test("buildStyleProfile 读取 custom_tag 与各结构化标签", () => {
    const w = {
        style_profile: {
            genre: "克苏鲁",
            tropes: ["复仇", "悬疑"],
            taste: "暗黑",
            pov: "第二人称",
            style: "冷峻",
            custom_tag: "群像叙事"
        }
    };
    const p = buildStyleProfile(w);
    assert.equal(p.genre, "克苏鲁");
    assert.deepEqual(p.tropes, ["复仇", "悬疑"]);
    assert.equal(p.taste, "暗黑");
    assert.equal(p.pov, "第二人称");
    assert.equal(p.style, "冷峻");
    assert.equal(p.custom_tag, "群像叙事");
});

test("buildStyleGuide 输出『主题』与『自定义标签』，且不再含『爽点』", () => {
    const w = {
        style_profile: {
            genre: "克苏鲁",
            tropes: ["复仇"],
            taste: "暗黑",
            pov: "第二人称",
            style: "冷峻",
            custom_tag: "群像"
        }
    };
    const g = buildStyleGuide(w);
    assert.ok(g.includes("· 主题：复仇"), "应含『主题』行");
    assert.ok(g.includes("· 自定义标签：群像"), "应含『自定义标签』行");
    assert.ok(!g.includes("爽点"), "旧的『爽点』文案应已移除");
});

test("collectStylePrefs 在空 DOM 下返回空结构", async () => {
    const { collectStylePrefs } = await import("../src/render.js");
    const r = collectStylePrefs();
    assert.deepEqual(r, {
        genre: null,
        tropes: [],
        taste: null,
        pov: null,
        style: null,
        custom_tag: ""
    });
});
