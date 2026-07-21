// ============================================================
// 选项场景一致性修复（docs/18）回归测试
// 验证 buildSmartFallbackChoices 不再引用 lore 专有名词（人物/地点/事件名），
// 且始终返回 3–4 个「场景安全」的通用动作。
// ============================================================

// 与 load-check.mjs 同款 DOM 宽容 stub，令 game.js 模块图可在 node 中求值
const any = new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : any),
    apply: () => any,
    construct: () => any,
    has: () => true,
});
const def = (k, v) => { try { globalThis[k] = v; } catch { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } };
def("window", globalThis);
def("document", any);
def("navigator", { userAgent: "node", language: "zh" });
def("location", { href: "http://localhost/", origin: "http://localhost" });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = () => Promise.reject(new Error("stub-fetch"));
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.alert = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, addListener: () => {} });

import test from "node:test";
import assert from "node:assert/strict";

const { S } = await import("../src/store.js");
const { buildSmartFallbackChoices } = await import("../src/game.js");

// 模拟一个含「禁忌设定专有名词」的世界（克苏鲁/后室风格），证明保底不再抓它们
function setupWorldWithLore() {
    S.currentWorld = {
        id: "w_test",
        name: "测试世界",
        lore_kb: {
            snippets: [
                { category: "人物", title: "警犬", content: "一条看门犬" },
                { category: "人物", title: "奈亚拉托提普", content: "神话存在" },
                { category: "地点", title: "Level 2——营造之梦", content: "后室层级" },
                { category: "地点", title: "米斯卡塔尼克大学", content: "大学" },
                { category: "物品", title: "死灵之书", content: "禁忌古籍" },
                { category: "事件", title: "星辰归位", content: "邪教仪式" }
            ]
        }
    };
    S.activeLoreKB = S.currentWorld.lore_kb;
    S.gameState = { current_location: "Level 0——大空的迷宫" };
}

// 绝不应出现在保底选项里的专有名词（来自 lore_kb）
const FORBIDDEN = ["警犬", "奈亚拉托提普", "Level 2", "米斯卡塔尼克", "死灵之书", "星辰归位"];

test("保底选项引用 lore 专有名词（盲聊/盲走）已修复", () => {
    setupWorldWithLore();
    for (let i = 0; i < 30; i++) {
        const choices = buildSmartFallbackChoices();
        const joined = choices.map(c => c.text).join(" | ");
        for (const bad of FORBIDDEN) {
            assert.ok(!joined.includes(bad), `第${i}次保底出现了 lore 专名「${bad}」：${joined}`);
        }
        // 也不出现「前往自己所在处」
        assert.ok(!joined.includes("Level 0"), `保底出现前往当前所在地：${joined}`);
    }
});

test("保底选项数量恒为 3–4 且均为场景安全动作", () => {
    setupWorldWithLore();
    const SAFE = new Set([
        "环顾四周，仔细观察当前环境",
        "检查手边能触及的物品",
        "回想刚才发生的一切",
        "试着出声呼喊，看是否有人回应",
        "在原地稍作停留，整理思绪",
        "让事件继续发展",
        "环顾四周"
    ]);
    for (let i = 0; i < 20; i++) {
        const choices = buildSmartFallbackChoices();
        assert.ok(choices.length >= 3 && choices.length <= 4, `数量越界：${choices.length}`);
        for (const c of choices) {
            assert.ok(typeof c.text === "string" && c.text.length > 0, "选项文本为空");
            assert.ok(SAFE.has(c.text), `出现非安全动作选项：${c.text}`);
            assert.ok(c.action && typeof c.action === "string", "选项缺 action");
        }
    }
});

test("保底选项每轮有随机性（多轮不完全相同）", () => {
    setupWorldWithLore();
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
        const joined = buildSmartFallbackChoices().map(c => c.text).join(" | ");
        seen.add(joined);
    }
    // 6 选 4 的组合有 15 种，12 次抽样应至少出现 2 种不同组合
    assert.ok(seen.size >= 2, "保底选项缺乏随机性，每轮都相同");
});
