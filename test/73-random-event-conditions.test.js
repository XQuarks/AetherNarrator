// docs/73：随机事件条件系统 —— 判定引擎单测
// 覆盖：evalCondition 六类条件、evalEventConditions(all/any)、pickRandomEvent 条件过滤、getRandomEventHint 记录 firedTitles
import { test } from "node:test";
import assert from "node:assert";
import { evalCondition, evalEventConditions, pickRandomEvent, getRandomEventHint } from "../src/prompt.js";
import { S } from "../src/store.js";

// —— 测试上下文构造器 ——
const GS = (over = {}) => Object.assign({
    story_progress: 1,
    current_location: "大厅",
    bonds: {},
    completed_events: [],
    random_event_state: { lastTitle: null, firedTitles: [] }
}, over);
const W = (lore = []) => ({ lore_kb: lore });

test("evalCondition：location 命中/不命中", () => {
    const ctx = { gameState: GS({ current_location: "霍格沃茨大厅" }), world: {} };
    assert.equal(evalCondition({ type: "location", value: "霍格沃茨大厅" }, ctx), true);
    assert.equal(evalCondition({ type: "location", value: "禁林" }, ctx), false);
});

test("evalCondition：story_progress 支持 >= <= ==", () => {
    const ctx = { gameState: GS({ story_progress: 5 }), world: {} };
    assert.equal(evalCondition({ type: "story_progress", op: ">=", value: 3 }, ctx), true);
    assert.equal(evalCondition({ type: "story_progress", op: "<=", value: 3 }, ctx), false);
    assert.equal(evalCondition({ type: "story_progress", op: "==", value: 5 }, ctx), true);
    assert.equal(evalCondition({ type: "story_progress", op: ">=", value: "abc" }, ctx), false, "非数值 value 保守 false");
});

test("evalCondition：bond 好感比较", () => {
    const ctx = { gameState: GS({ bonds: { "哈利": { affinity: 50 } } }), world: {} };
    assert.equal(evalCondition({ type: "bond", npc: "哈利", op: ">=", value: 40 }, ctx), true);
    assert.equal(evalCondition({ type: "bond", npc: "哈利", op: ">=", value: 60 }, ctx), false);
    assert.equal(evalCondition({ type: "bond", npc: "赫敏", op: ">=", value: 1 }, ctx), false, "无该角色好感");
});

test("evalCondition：fired 前置随机事件（firedTitles）", () => {
    const ctx = { gameState: GS({ random_event_state: { lastTitle: "分院仪式", firedTitles: ["分院仪式"] } }), world: {} };
    assert.equal(evalCondition({ type: "fired", value: "分院仪式" }, ctx), true);
    assert.equal(evalCondition({ type: "fired", value: "密室开启" }, ctx), false);
});

test("evalCondition：events 前置支线事件（completed_events）", () => {
    const ctx = { gameState: GS({ completed_events: ["密室开启"] }), world: {} };
    assert.equal(evalCondition({ type: "events", value: "密室开启" }, ctx), true);
    assert.equal(evalCondition({ type: "events", value: "凤凰社重组" }, ctx), false);
});

test("evalCondition：lore 知识卡解锁（unlock_stage <= story_progress）", () => {
    const ctx = { gameState: GS({ story_progress: 3 }), world: W([{ title: "秘典·第一章", unlock_stage: 2 }, { title: "秘典·终章", unlock_stage: 9 }]) };
    assert.equal(evalCondition({ type: "lore", value: "秘典·第一章" }, ctx), true, "已达解锁阶段");
    assert.equal(evalCondition({ type: "lore", value: "秘典·终章" }, ctx), false, "未达解锁阶段");
    assert.equal(evalCondition({ type: "lore", value: "不存在的卡" }, ctx), false, "卡不存在");
});

test("evalCondition：season 由 current_date 推断", () => {
    const ctx = { gameState: GS({ current_date: { month: 12, day: 360 } }), world: {} };
    assert.equal(evalCondition({ type: "season", value: "冬季" }, ctx), true);
    assert.equal(evalCondition({ type: "season", value: "夏季" }, ctx), false);
    const ctx2 = { gameState: GS({ current_date: { day: 100 } }), world: {} }; // day100 → 月约4 → 春
    assert.equal(evalCondition({ type: "season", value: "春季" }, ctx2), true);
});

test("evalCondition：era 匹配", () => {
    const ctx = { gameState: GS({ era: "中世纪" }), world: { era_label: "中世纪" } };
    assert.equal(evalCondition({ type: "era", value: "中世纪" }, ctx), true);
    assert.equal(evalCondition({ type: "era", value: "现代" }, ctx), false);
    const ctx2 = { gameState: GS({}), world: { era_label: "魔法纪元" } };
    assert.equal(evalCondition({ type: "era", value: "魔法纪元" }, ctx2), true, "回退到 world.era_label");
});

test("evalCondition：未知类型/缺 type → false", () => {
    assert.equal(evalCondition(null, { gameState: GS(), world: {} }), false);
    assert.equal(evalCondition({ type: "unknown" }, { gameState: GS(), world: {} }), false);
    assert.equal(evalCondition({}, { gameState: GS(), world: {} }), false);
});

test("evalEventConditions：无条件 → true（向后兼容）", () => {
    assert.equal(evalEventConditions({}, { gameState: GS(), world: {} }), true);
    assert.equal(evalEventConditions({ title: "X" }, { gameState: GS(), world: {} }), true, "缺 conditions 字段视为无条件");
});

test("evalEventConditions：all 全满足 true / 缺一 false", () => {
    const ctx = { gameState: GS({ current_location: "大厅", story_progress: 5 }), world: {} };
    const ev = { conditions: [{ type: "location", value: "大厅" }, { type: "story_progress", op: ">=", value: 3 }], condition_mode: "all" };
    assert.equal(evalEventConditions(ev, ctx), true);
    const ev2 = { conditions: [{ type: "location", value: "大厅" }, { type: "story_progress", op: ">=", value: 99 }], condition_mode: "all" };
    assert.equal(evalEventConditions(ev2, ctx), false, "缺一即不满足");
});

test("evalEventConditions：any 任一 true / 全缺 false", () => {
    const ctx = { gameState: GS({ current_location: "大厅", story_progress: 1 }), world: {} };
    const ev = { conditions: [{ type: "location", value: "大厅" }, { type: "story_progress", op: ">=", value: 99 }], condition_mode: "any" };
    assert.equal(evalEventConditions(ev, ctx), true, "满足一个即可");
    const ev2 = { conditions: [{ type: "location", value: "禁林" }, { type: "story_progress", op: ">=", value: 99 }], condition_mode: "any" };
    assert.equal(evalEventConditions(ev2, ctx), false, "全不满足");
});

test("pickRandomEvent：先按条件过滤（ctx 控制），再按 rng 取", () => {
    const pool = [
        { title: "A", conditions: [{ type: "location", value: "大厅" }] },
        { title: "B", conditions: [{ type: "location", value: "禁林" }] }
    ];
    const ctxHall = { gameState: GS({ current_location: "大厅" }), world: {} };
    assert.equal(pickRandomEvent(pool, null, () => 0, ctxHall).title, "A", "只命中大厅事件");
    const ctxForest = { gameState: GS({ current_location: "禁林" }), world: {} };
    assert.equal(pickRandomEvent(pool, null, () => 0, ctxForest).title, "B", "只命中禁林事件");
});

test("pickRandomEvent：条件全不满足 → null（不硬塞）", () => {
    const pool = [{ title: "A", conditions: [{ type: "location", value: "不存在之地" }] }];
    const ctx = { gameState: GS({ current_location: "大厅" }), world: {} };
    assert.equal(pickRandomEvent(pool, null, () => 0, ctx), null);
});

test("pickRandomEvent：向后兼容无条件池 + 排除 lastTitle", () => {
    const pool = [{ title: "A" }, { title: "B" }, { title: "C" }];
    assert.equal(pickRandomEvent(pool, null, () => 0).title, "A");
    assert.equal(pickRandomEvent(pool, "A", () => 0).title, "B", "排除 A 后取首个");
    assert.equal(pickRandomEvent([], null), null, "空池 null");
});

test("getRandomEventHint：到节奏且条件满足 → 注入并记入 firedTitles", () => {
    S.gameState = GS({ current_location: "大厅", story_progress: 1 });
    const world = {
        modules: { random_event: { enabled: true } },
        random_events: [{ title: "巨怪走廊", conditions: [{ type: "location", value: "大厅" }] }]
    };
    const hint = getRandomEventHint({ world, history: [{ isWarning: false }, { isWarning: false }, { isWarning: false }] });
    assert.ok(hint, "应注入");
    assert.ok(/巨怪走廊/.test(hint));
    assert.ok(S.gameState.random_event_state.firedTitles.includes("巨怪走廊"), "应记入 firedTitles");
});

test("getRandomEventHint：到节奏但条件不满足 → null（不注入、不记录）", () => {
    S.gameState = GS({ current_location: "禁林", story_progress: 1 });
    const world = {
        modules: { random_event: { enabled: true } },
        random_events: [{ title: "巨怪走廊", conditions: [{ type: "location", value: "大厅" }] }]
    };
    const hint = getRandomEventHint({ world, history: [{ isWarning: false }, { isWarning: false }, { isWarning: false }] });
    assert.equal(hint, null, "条件不满足不注入");
    assert.equal(S.gameState.random_event_state.firedTitles.length, 0, "不应记录");
});

test("getRandomEventHint：firedTitles 去重（同标题不重复记录）", () => {
    S.gameState = GS({ current_location: "大厅", story_progress: 1, random_event_state: { lastTitle: "巨怪走廊", firedTitles: ["巨怪走廊"] } });
    const world = {
        modules: { random_event: { enabled: true } },
        random_events: [{ title: "巨怪走廊", conditions: [{ type: "location", value: "大厅" }] }]
    };
    getRandomEventHint({ world, history: [{ isWarning: false }, { isWarning: false }, { isWarning: false }] });
    assert.deepEqual(S.gameState.random_event_state.firedTitles, ["巨怪走廊"], "不重复 push");
});

test("向后兼容：旧事件无 conditions 视为无条件仍可注入", () => {
    S.gameState = GS({ current_location: "大厅", story_progress: 1 });
    const world = {
        modules: { random_event: { enabled: true } },
        random_events: [{ title: "旧式事件" }]   // 无 conditions 字段
    };
    const hint = getRandomEventHint({ world, history: [{ isWarning: false }, { isWarning: false }, { isWarning: false }] });
    assert.ok(hint && /旧式事件/.test(hint), "旧数据照常工作");
});
