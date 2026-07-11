import test from "node:test";
import assert from "node:assert/strict";

import {
    filterStateChangesByWorldview,
    findWorldviewViolations,
    shouldRunAIEnhancements
} from "../src/worldview.js";

const rules = [
    { concept: "手机", aliases: ["智能终端"], unlockTags: ["era_modern"], severity: "hard" },
    { concept: "枪", aliases: ["火器"], unlockTags: ["has_firearm"], severity: "soft" }
];

test("世界观规则识别别名并返回可解释违规", () => {
    const violations = findWorldviewViolations("他掏出智能终端查看地图", rules, new Set());
    assert.deepEqual(violations, [{ concept: "手机", matched: "智能终端", severity: "hard" }]);
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
