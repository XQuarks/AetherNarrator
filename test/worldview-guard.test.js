import test from "node:test";
import assert from "node:assert/strict";

import {
    filterStateChangesByWorldview,
    findWorldviewViolations,
    isEnhancementContextCurrent,
    shouldRunAIEnhancements,
    recordWorldviewNag,
    WORLDVIEW_NAG_THRESHOLD
} from "../src/worldview.js";

import { S, getActiveConditionTags, getBannedConcepts } from "../src/store.js";

const rules = [
    { concept: "手机", aliases: ["智能终端"], unlockTags: ["era_modern"], severity: "hard" },
    { concept: "手枪", aliases: ["左轮"], unlockTags: ["has_firearm"], severity: "soft" },
    { concept: "突击步枪", aliases: ["AK-47"], unlockTags: ["has_modern_firearm"], severity: "hard" }
];

test("世界观规则识别别名并返回可解释违规", () => {
    const violations = findWorldviewViolations("他掏出智能终端查看地图", rules, new Set());
    assert.deepEqual(violations, [{ concept: "手机", matched: "智能终端", severity: "hard" }]);
});

test("后台增强结果只允许写回原世界原会话", () => {
    const expected = { worldId: "w1", epoch: 3, turnId: 8 };
    assert.equal(isEnhancementContextCurrent(expected, { worldId: "w1", epoch: 3, turnId: 8 }), true);
    assert.equal(isEnhancementContextCurrent(expected, { worldId: "w2", epoch: 3, turnId: 8 }), false);
    assert.equal(isEnhancementContextCurrent(expected, { worldId: "w1", epoch: 4, turnId: 8 }), false);
});

test("任一解锁标签激活后对应概念合法", () => {
    const violations = findWorldviewViolations("他掏出手机查看地图", rules, new Set(["era_modern"]));
    assert.deepEqual(violations, []);
});

test("过滤状态变更时只移除违规叶子并保留同级合法内容", () => {
    const changes = {
        skills: { sword: "剑术精进", phone: "熟练使用智能终端" },
        inventory: [
            { op: "add", item_id: "tea", name: "茶叶", count: 1 },
            { op: "add", item_id: "phone", name: "手机", count: 1 }
        ]
    };

    const result = filterStateChangesByWorldview(changes, rules, new Set());

    assert.deepEqual(result.changes.skills, { sword: "剑术精进" });
    assert.deepEqual(result.changes.inventory, [{ op: "add", item_id: "tea", name: "茶叶", count: 1 }]);
    assert.equal(result.violations.length, 2);
    assert.deepEqual(changes.skills, { sword: "剑术精进", phone: "熟练使用智能终端" });
});

test("AI 增强仅在开关开启且世界需要约束时运行", () => {
    assert.equal(shouldRunAIEnhancements({ enabled: false, freedom: 1, hasLore: true }), false);
    assert.equal(shouldRunAIEnhancements({ enabled: true, freedom: 4, hasLore: true }), false);
    assert.equal(shouldRunAIEnhancements({ enabled: true, freedom: 2, hasLore: false }), false);
    assert.equal(shouldRunAIEnhancements({ enabled: true, freedom: 2, hasLore: true }), true);
});

test("背包持有时期火器（左轮）仅解锁时期火器，不放行现代火器（分工）", () => {
    const prevGs = S.gameState;
    const prevWorld = S.currentWorld;
    try {
        // 物品本身未打 has_firearm 标签，但名称含「左轮手枪」→ 引擎应自动放行时期火器
        S.currentWorld = undefined;
        S.gameState = { inventory: [{ item_id: "pistol", name: "左轮手枪", count: 1 }] };
        const tags = getActiveConditionTags();
        assert.equal(tags.has("has_firearm"), true, "持有左轮应自动激活 has_firearm");
        assert.equal(tags.has("has_modern_firearm"), false, "持有左轮不应激活 has_modern_firearm");
        const banned = getBannedConcepts();
        // 时期火器应解锁（「步枪」概念已移除，避免与「突击步枪」子串冲突）
        for (const w of ["手枪", "左轮", "子弹", "霰弹枪", "火枪"]) {
            assert.equal(banned.includes(w), false, `时期火器「${w}」应被解锁`);
        }
        // 现代火器仍禁用（AK-47 类需现代火器标签）
        for (const w of ["突击步枪", "自动步枪", "冲锋枪", "机枪", "加特林"]) {
            assert.equal(banned.includes(w), true, `现代火器「${w}」应仍被禁用`);
        }
    } finally {
        S.gameState = prevGs;
        S.currentWorld = prevWorld;
    }
});

test("背包持有现代火器仅解锁现代火器，不反向解锁时期火器", () => {
    const prevGs = S.gameState;
    const prevWorld = S.currentWorld;
    try {
        S.currentWorld = undefined;
        S.gameState = { inventory: [{ item_id: "ak", name: "突击步枪", count: 1 }] };
        const tags = getActiveConditionTags();
        assert.equal(tags.has("has_modern_firearm"), true, "持有突击步枪应激活 has_modern_firearm");
        assert.equal(tags.has("has_firearm"), false, "持有突击步枪不应激活 has_firearm");
        const banned = getBannedConcepts();
        assert.equal(banned.includes("突击步枪"), false, "突击步枪应被解锁");
        assert.equal(banned.includes("手枪"), true, "手枪仍需 has_firearm，不应被现代火器解锁");
    } finally {
        S.gameState = prevGs;
        S.currentWorld = prevWorld;
    }
});

test("同时持有两类火器时 A2 中文层全部放行，但纯拉丁写法（AK-47）本就不在禁用表，交给 A7 兜底", () => {
    const prevGs = S.gameState;
    const prevWorld = S.currentWorld;
    try {
        S.currentWorld = undefined;
        S.gameState = { inventory: [
            { item_id: "pistol", name: "左轮手枪", count: 1 },
            { item_id: "ak", name: "突击步枪", count: 1 }
        ] };
        const banned = getBannedConcepts();
        assert.equal(banned.includes("手枪"), false, "左轮解锁手枪");
        assert.equal(banned.includes("突击步枪"), false, "突击步枪解锁");
        // AK-47 是拉丁写法，A2 无对应中文概念，故不在禁用表（不靠 A2 拦截，由 A7 语义兜底）
        assert.equal(banned.includes("AK-47"), false, "AK-47 拉丁写法不在 A2 禁用表，由 A7 语义兜底");
    } finally {
        S.gameState = prevGs;
        S.currentWorld = prevWorld;
    }
});

test("世界观守卫「3 次后静默」：同一概念前 3 次提示、第 4 次起静默", () => {
    let counts = {};
    // 第 1~3 次：都应弹提示，且计数递增
    for (let i = 1; i <= 3; i++) {
        const r = recordWorldviewNag("a2:枪", counts);
        assert.equal(r.show, true, `第 ${i} 次应提示`);
        counts = r.counts;
    }
    assert.equal(counts["a2:枪"], 3, "计数应达到阈值 3");
    // 第 4 次起：不再弹提示，计数保持不变
    const r4 = recordWorldviewNag("a2:枪", counts);
    assert.equal(r4.show, false, "第 4 次应静默");
    assert.equal(r4.counts["a2:枪"], 3, "静默后计数不应再增长");
    // 再调用一次仍静默
    const r5 = recordWorldviewNag("a2:枪", r4.counts);
    assert.equal(r5.show, false, "第 5 次仍静默");
});

test("世界观守卫静默：不同概念独立计数，互不影响", () => {
    let counts = {};
    const r1 = recordWorldviewNag("a2:手机", counts);
    counts = r1.counts;
    // 另一个概念第一次仍应提示
    const r2 = recordWorldviewNag("a2:电脑", counts);
    assert.equal(r2.show, true, "不同概念独立计数，手机被提示不影响电脑");
    assert.equal(counts["a2:手机"], 1, "手机计数=1");
    assert.equal(r2.counts["a2:电脑"], 1, "电脑计数=1");
});

test("世界观守卫静默：A2 与 A7 使用不同 key 前缀，预算互不占用", () => {
    let counts = {};
    // A2 把「枪」提示满 3 次
    for (let i = 0; i < 3; i++) counts = recordWorldviewNag("a2:枪", counts).counts;
    assert.equal(recordWorldviewNag("a2:枪", counts).show, false, "A2 枪已静默");
    // A7 对同一语义的违和描述仍应提示（key 前缀不同）
    const r = recordWorldviewNag("a7:出现了枪", counts);
    assert.equal(r.show, true, "A7 不同前缀，不应被 A2 预算耗尽");
});

test("世界观守卫静默：默认阈值与自定义阈值", () => {
    assert.equal(WORLDVIEW_NAG_THRESHOLD, 3, "默认阈值为 3");
    let counts = {};
    for (let i = 0; i < 2; i++) counts = recordWorldviewNag("x", counts, 2).counts;
    assert.equal(recordWorldviewNag("x", counts, 2).show, false, "自定义阈值=2 时第 3 次应静默");
    // 非法 counts 入参应安全回退为空表
    assert.equal(recordWorldviewNag("y", null).show, true, "null 计数应安全回退");
});
