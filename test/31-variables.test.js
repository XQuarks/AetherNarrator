// ★ B2 玩家变量 + 本回合变化：纯函数单测
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    getEnabledVariables, syncVariablesToSchema, computeVariableUpdates,
    coerceVariableValue
} from "../src/store.js";
import { buildVariablesContext, formatStateChanges } from "../src/prompt.js";

const NUM_VAR = { id: "sanity", name: "理智", type: "number", default: 80, min: 0, max: 100, unit: "%", desc: "精神稳定度", enabled: true };
const TXT_VAR = { id: "mood", name: "心情", type: "text", default: "平静", enabled: true };
const TOG_VAR = { id: "blessed", name: "受祝福", type: "toggle", default: false, enabled: true };
const DISABLED = { id: "hidden", name: "隐藏", type: "number", default: 50, enabled: false };

const WORLD = { variable_schema: [NUM_VAR, TXT_VAR, TOG_VAR, DISABLED] };

test("getEnabledVariables 过滤掉未启用变量", () => {
    const enabled = getEnabledVariables(WORLD);
    assert.equal(enabled.length, 3);
    assert.ok(enabled.every(v => v.enabled !== false));
    assert.deepEqual(enabled.map(v => v.id), ["sanity", "mood", "blessed"]);
});

test("syncVariablesToSchema 补默认、清脏 key", () => {
    // 缺省 → 用 default 补
    const a = syncVariablesToSchema(WORLD, {});
    assert.equal(a.sanity, 80);
    assert.equal(a.mood, "平静");
    assert.equal(a.blessed, false);
    // 不应包含被禁用/不存在的 key（DISABLED 未启用 → 不出现）
    assert.ok(!("hidden" in a));

    // 脏 key（不在 schema）应被清除；已有值保留
    const b = syncVariablesToSchema(WORLD, { sanity: 42, junk: "x" });
    assert.equal(b.sanity, 42);
    assert.ok(!("junk" in b));
});

test("coerceVariableValue 按定义纠正类型", () => {
    assert.equal(coerceVariableValue("70", NUM_VAR), 70);
    assert.equal(coerceVariableValue("abc", NUM_VAR), 80); // 非数字回退 default
    assert.equal(coerceVariableValue(true, TOG_VAR), true);
    assert.equal(coerceVariableValue("yes", TOG_VAR), true);
    assert.equal(coerceVariableValue(123, TXT_VAR), "123");
});

test("computeVariableUpdates 数值夹取 + 忽略非法/未知/未启用", () => {
    // 溢出上限夹取到 100
    const r1 = computeVariableUpdates({ sanity: 150 }, WORLD, { sanity: 80 });
    assert.equal(r1.next.sanity, 100);
    assert.equal(r1.applied.length, 1);

    // 非数字忽略
    const r2 = computeVariableUpdates({ sanity: "崩了" }, WORLD, { sanity: 80 });
    assert.equal(r2.next.sanity, 80);
    assert.equal(r2.applied.length, 0);

    // 未知变量忽略
    const r3 = computeVariableUpdates({ nope: 5 }, WORLD, {});
    assert.equal(Object.keys(r3.next).length, 0);

    // 未启用变量忽略
    const r4 = computeVariableUpdates({ hidden: 10 }, WORLD, {});
    assert.ok(!("hidden" in r4.next));

    // 无变化不记录
    const r5 = computeVariableUpdates({ sanity: 80 }, WORLD, { sanity: 80 });
    assert.equal(r5.applied.length, 0);
});

test("computeVariableUpdates 文本/开关类型", () => {
    const r1 = computeVariableUpdates({ mood: "焦虑" }, WORLD, { mood: "平静" });
    assert.equal(r1.next.mood, "焦虑");
    assert.equal(r1.applied[0].type, "text");

    const r2 = computeVariableUpdates({ blessed: true }, WORLD, { blessed: false });
    assert.equal(r2.next.blessed, true);
    assert.equal(r2.applied[0].type, "toggle");
});

test("buildVariablesContext 空 schema 返回空串", () => {
    assert.equal(buildVariablesContext({ variable_schema: [] }), "");
    assert.equal(buildVariablesContext({}), "");
});

test("buildVariablesContext 含变量定义与类型说明", () => {
    const ctx = buildVariablesContext(WORLD);
    assert.ok(ctx.includes("玩家变量"));
    assert.ok(ctx.includes("理智"));
    assert.ok(ctx.includes("state_changes.variables"));
    assert.ok(ctx.includes("数值型")); // number 说明
    // 不应包含被禁用的 hidden
    assert.ok(!ctx.includes("隐藏"));
});

test("formatStateChanges 变量增减 + 地点 + 关系 + 物品 + 死亡", () => {
    const entry = {
        state_changes: {
            current_location: "图书馆",
            relationships: { "安吉尔教授": "你与教授的关系更近了一步。" },
            inventory: [{ op: "add", item_id: "book", name: "古籍" }, { op: "remove", item_id: "herb", name: "草药" }],
            is_alive: false
        },
        varChanges: [
            { name: "理智", type: "number", from: 80, to: 75, unit: "%" },
            { name: "受祝福", type: "toggle", from: false, to: true }
        ]
    };
    const lines = formatStateChanges(entry, WORLD);
    assert.ok(lines.some(l => l.includes("理智") && l.includes("80 → 75") && l.includes("（-5%）")));
    assert.ok(lines.some(l => l.includes("受祝福") && l.includes("开")));
    assert.ok(lines.some(l => l.includes("前往 图书馆")));
    assert.ok(lines.some(l => l.includes("与 安吉尔教授 关系更新")));
    assert.ok(lines.some(l => l.includes("获得 古籍")));
    assert.ok(lines.some(l => l.includes("失去 草药")));
    assert.ok(lines.some(l => l.includes("角色死亡")));
});

test("formatStateChanges 无变化返回空数组", () => {
    assert.deepEqual(formatStateChanges({ state_changes: {}, varChanges: [] }, WORLD), []);
    assert.deepEqual(formatStateChanges({}, WORLD), []);
});
