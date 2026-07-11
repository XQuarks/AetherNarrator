import test from "node:test";
import assert from "node:assert/strict";

import { acquireTurn, isSessionContextCurrent, releaseTurn } from "../src/turn-lifecycle.js";
import { parseStoredArray, parseStoredObject } from "../src/migrations.js";
import { collectDueDeadlines } from "../src/time-engine.js";
import { createRestEvent } from "../src/simulation.js";

test("同一时刻只能获取一个主回合锁", () => {
    const runtime = { isGenerating: false };
    assert.equal(acquireTurn(runtime), true);
    assert.equal(acquireTurn(runtime), false);
    releaseTurn(runtime);
    assert.equal(acquireTurn(runtime), true);
});

test("导航后的旧请求异常不属于当前会话", () => {
    const expected = { epoch: 2, worldId: "w1" };
    assert.equal(isSessionContextCurrent(expected, { epoch: 2, worldId: "w1" }), true);
    assert.equal(isSessionContextCurrent(expected, { epoch: 3, worldId: "w1" }), false);
    assert.equal(isSessionContextCurrent(expected, { epoch: 2, worldId: "w2" }), false);
});

test("损坏的配置对象回退且不抛异常", () => {
    const result = parseStoredObject("not-json", { mockMode: false });
    assert.equal(result.ok, false);
    assert.deepEqual(result.value, { mockMode: false });
});

test("损坏的 localStorage 数组回退且不抛异常", () => {
    const result = parseStoredArray("{broken", [{ id: "fallback" }]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.value, [{ id: "fallback" }]);
});

test("世界 deadline 到点只返回尚未触发的项目", () => {
    const due = collectDueDeadlines(
        { day: 2, period: "afternoon" },
        [
            { id: "d1", title: "午后赴宴", day: 2, period: "afternoon" },
            { id: "d2", title: "第三日比武", day: 3, period: "morning" }
        ],
        ["morning", "forenoon", "afternoon", "evening", "night"],
        new Set(["already"])
    );
    assert.deepEqual(due.map(item => item.id), ["d1"]);
    assert.deepEqual(collectDueDeadlines(
        { day: 2, period: "afternoon" },
        [{ id: "d1", title: "午后赴宴", day: 2, period: "afternoon" }],
        ["morning", "forenoon", "afternoon", "evening", "night"],
        new Set(["d1"])
    ), []);
});

test("缺少 id 的旧世界 deadline 仍可生成稳定触发标识", () => {
    const due = collectDueDeadlines(
        { day: 1, period: "morning" },
        [{ title: "旧版期限", day: 1, period: "morning" }],
        ["morning", "night"],
        new Set()
    );
    assert.equal(due.length, 1);
    assert.match(due[0].id, /^deadline_/);
});

test("休息生成结构化世界事件", () => {
    const event = createRestEvent(
        { day: 1, period: "night" },
        { day: 2, period: "morning" },
        "潇湘馆"
    );
    assert.equal(event.type, "rest");
    assert.equal(event.to.day, 2);
    assert.match(event.title, /休息/);
});
