// ============================================================
// test/51 · 事件卡面板 + 支线体力（对标 UU Game 的 P0 第二块）
// 覆盖：events 模块门禁与默认体力注入、体力扣减/回复的绝对值夹取、
//       AI 工具 schema 的 side_events 字段、中部提示词 gated 注入。
// 注：跨天回复的端到端行为依赖 applyStateChanges 的 DOM 链（updateGameDayInfo），
//     由本机 npm run verify 的浏览器冒烟覆盖；此处覆盖其依赖的纯逻辑。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureEventsWorldReady } from "../src/modules.js";
import { computeVariableUpdates, S } from "../src/store.js";
import { TOOLS } from "../src/llm.js";
import { buildAuthorNote } from "../src/prompt.js";

// ---------- 1) ensureEventsWorldReady：门禁 + 默认体力注入 ----------
test("ensureEventsWorldReady：events 开启注入默认 stamina 并连带启用 variables", () => {
    const world = { id: "w1", modules: { events: { enabled: true } }, variable_schema: [] };
    ensureEventsWorldReady(world);
    const stamina = (world.variable_schema || []).find(v => v.id === "stamina");
    assert.ok(stamina, "events 开启应注入 stamina 变量");
    assert.strictEqual(stamina.min, 0);
    assert.strictEqual(stamina.max, 100);
    assert.strictEqual(stamina.default, 100);
    assert.strictEqual(world.modules.variables.enabled, true, "应连带强制启用 variables 模块");
});

test("ensureEventsWorldReady：events 关闭不注入 stamina", () => {
    const world = { id: "w2", modules: { events: { enabled: false } }, variable_schema: [] };
    ensureEventsWorldReady(world);
    assert.strictEqual((world.variable_schema || []).length, 0, "events 关闭不应注入 stamina");
});

test("ensureEventsWorldReady：已有 stamina 不重复注入", () => {
    const world = {
        id: "w3", modules: { events: { enabled: true } },
        variable_schema: [{ id: "stamina", name: "体力", type: "number", min: 0, max: 100, default: 100, enabled: true }]
    };
    ensureEventsWorldReady(world);
    const cnt = (world.variable_schema || []).filter(v => v.id === "stamina").length;
    assert.strictEqual(cnt, 1, "不应重复注入 stamina");
});

// ---------- 2) computeVariableUpdates：体力扣减/回复的绝对值夹取 ----------
const staminaWorld = {
    variable_schema: [{ id: "stamina", name: "体力", type: "number", min: 0, max: 100, default: 100, enabled: true }]
};

test("computeVariableUpdates：体力扣减按绝对值夹取下限（不足归 0）", () => {
    // 当前 50，进入事件消耗后目标 -10 → 夹取到 0（验证 applyNormalTurn 的「先算 cur-cost 再传绝对值」语义）
    const r = computeVariableUpdates({ stamina: -10 }, staminaWorld, { stamina: 50 });
    assert.strictEqual(r.next.stamina, 0);
});

test("computeVariableUpdates：体力回复按绝对值夹取上限（不超 100）", () => {
    // 当前 90，跨天回复 +30 → 目标 120 → 夹取到 100
    const r = computeVariableUpdates({ stamina: 120 }, staminaWorld, { stamina: 90 });
    assert.strictEqual(r.next.stamina, 100);
});

test("computeVariableUpdates：体力正常扣减", () => {
    // 当前 50，进入事件消耗后目标 30 → 30
    const r = computeVariableUpdates({ stamina: 30 }, staminaWorld, { stamina: 50 });
    assert.strictEqual(r.next.stamina, 30);
});

// ---------- 3) AI 工具 schema：apply_turn_state 含 side_events ----------
test("TOOLS.apply_turn_state 含 side_events 字段且结构完整", () => {
    const props = TOOLS.apply_turn_state.parameters.properties;
    assert.ok(props.side_events, "apply_turn_state 应包含 side_events");
    assert.strictEqual(props.side_events.type, "array");
    const itemProps = props.side_events.items.properties;
    for (const k of ["title", "desc", "cost_stamina", "cost_time", "tag"]) {
        assert.ok(itemProps[k], "side_events 项应含字段 " + k);
    }
});

// ---------- 4) buildAuthorNote：events 指令 gated ----------
function setWorldForNote(eventsEnabled) {
    S.currentWorld = {
        id: "w", name: "测试",
        modules: { events: { enabled: eventsEnabled } },
        time_config: { mode: "day", periods: [{ name: "晨", start: 0, end: 360 }], calendar_mode: "day" },
        events: [],
        variable_schema: [],
        style_profile: {},
        author_note: ""
    };
    S.gameState = { current_date: { mode: "day", step: 1, period: "晨" } };
    S.narrativePacing = "standard";
    S.narrativeLength = "standard";
}

test("buildAuthorNote：events 开启时注入支线事件产出指令", () => {
    setWorldForNote(true);
    const note = buildAuthorNote();
    assert.ok(note.includes("支线事件"), "events 开启应包含支线事件指令");
});

test("buildAuthorNote：events 关闭时不注入支线事件指令", () => {
    setWorldForNote(false);
    const note = buildAuthorNote();
    assert.ok(!note.includes("支线事件"), "events 关闭不应包含支线事件指令");
});
