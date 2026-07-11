import test from "node:test";
import assert from "node:assert/strict";

import { applySimulationChanges, buildWorldSummary, normalizeSimulationState } from "../src/simulation.js";

test("旧字符串事件与 NPC 动态迁移为结构化状态", () => {
    const state = normalizeSimulationState({
        active_event: "贾府夜宴",
        completed_events: ["初入荣国府"],
        npc_activity: { "林黛玉": "在潇湘馆读书" }
    });

    assert.equal(state.active_events[0].title, "贾府夜宴");
    assert.equal(state.completed_events[0].title, "初入荣国府");
    assert.equal(state.npc_activity["林黛玉"].action, "在潇湘馆读书");
});

test("事件完成后从活跃列表移除且不会重复入历史", () => {
    const state = normalizeSimulationState({
        active_events: [{ id: "e1", title: "夜宴", stage: "进行中" }],
        completed_events: []
    });
    const once = applySimulationChanges(state, { completed_events: [{ id: "e1", title: "夜宴" }] }, { day: 1, period: "night" });
    const twice = applySimulationChanges(once, { completed_events: [{ id: "e1", title: "夜宴" }] }, { day: 1, period: "night" });

    assert.equal(twice.active_events.length, 0);
    assert.equal(twice.completed_events.length, 1);
    assert.equal(twice.completed_events[0].completed_at.day, 1);
});

test("世界摘要突出活跃事件、NPC 和临近目标", () => {
    const summary = buildWorldSummary({
        current_location: "潇湘馆",
        active_events: [{ id: "e1", title: "夜宴" }],
        npc_activity: { "林黛玉": { action: "读书" } },
        goals: [{ status: "active", visible: true, name: "赴宴", deadline: { day: 2 } }]
    });

    assert.match(summary, /潇湘馆/);
    assert.match(summary, /夜宴/);
    assert.match(summary, /赴宴/);
});
