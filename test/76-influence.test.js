// ★ docs/76 Phase A：玩家影响度引擎单测
import assert from "node:assert";
import test from "node:test";
import {
    DEFAULT_INFLUENCE_WEIGHTS, DEFAULT_MAX_LAYERS, DEFAULT_INFLUENCE_THRESHOLDS,
    getInfluenceWeights, getInfluenceThresholds, getMaxLayers,
    accumulateInfluence, computeInfluence, crossedInfluenceTier
} from "../src/influence.js";

const W = {}; // 空 world → 用代码默认

test("默认权重/阈值/层数与文档一致", () => {
    assert.deepEqual(getInfluenceWeights(W), DEFAULT_INFLUENCE_WEIGHTS);
    assert.deepEqual(getInfluenceThresholds(W), [100]);
    assert.equal(getMaxLayers(W), 4);
});

test("accumulateInfluence：空 changes → 0", () => {
    assert.equal(accumulateInfluence({}, DEFAULT_INFLUENCE_WEIGHTS), 0);
    assert.equal(accumulateInfluence(null, DEFAULT_INFLUENCE_WEIGHTS), 0);
});

test("accumulateInfluence：好感 delta 加权", () => {
    const inc = accumulateInfluence({ bonds: { 小红: { delta: 25 } } }, DEFAULT_INFLUENCE_WEIGHTS);
    assert.equal(inc, 25); // 25 * 1
});

test("accumulateInfluence：属性数值与文字混合", () => {
    const inc = accumulateInfluence({
        attributes: { courage: 4, luck: "气运加身" }
    }, DEFAULT_INFLUENCE_WEIGHTS);
    assert.equal(inc, 4 * 0.5 + 1 * 0.5); // 2 + 0.5 = 2.5
});

test("accumulateInfluence：事件/任务/结局/随机/技能", () => {
    const inc = accumulateInfluence({
        completed_events: ["e1", "e2"],
        goal_updates: [{ status: "completed" }, { status: "active" }],
        endings: [{ id: "end1" }],
        random_event_result: { title: "x" },
        skills: { 剑术: "习得新剑法", 火球: { result: "success" } }
    }, DEFAULT_INFLUENCE_WEIGHTS);
    // 2*10 + 1*15 + 1*40 + 1*5 + 2(剑术文字) + 1(火球result) = 20+15+40+5+2+1 = 83
    assert.equal(inc, 83);
});

test("accumulateInfluence：extra 携带关系升阶与 lore 解锁", () => {
    const inc = accumulateInfluence({ bonds: { 小红: { delta: 10 } } }, DEFAULT_INFLUENCE_WEIGHTS,
        { relUpgrades: 2, loreUnlocked: 3 });
    // 10*1 + 2*12 + 3*8 = 10 + 24 + 24 = 58
    assert.equal(inc, 58);
});

test("accumulateInfluence：世界覆盖权重生效", () => {
    const w = { parallel_narrative: { weights: { affinity_per_point: 2 } } };
    const inc = accumulateInfluence({ bonds: { 小红: { delta: 10 } } }, getInfluenceWeights(w));
    assert.equal(inc, 20); // 10 * 2
});

test("computeInfluence：基准比对（属性+好感差）", () => {
    const base = { attributes: { courage: 0 }, bonds: { 小红: { affinity: 0 } } };
    const cur = { attributes: { courage: 6 }, bonds: { 小红: { affinity: 20 } } };
    // |6|*0.5 + |20|*1 = 3 + 20 = 23
    assert.equal(computeInfluence(cur, base, DEFAULT_INFLUENCE_WEIGHTS), 23);
});

test("computeInfluence：无基准/无当前 → 0", () => {
    assert.equal(computeInfluence(null, {}, DEFAULT_INFLUENCE_WEIGHTS), 0);
    assert.equal(computeInfluence({}, null, DEFAULT_INFLUENCE_WEIGHTS), 0);
});

test("crossedInfluenceTier：单档首次越线返回档位", () => {
    assert.equal(crossedInfluenceTier(120, [100], []), 100);
    assert.equal(crossedInfluenceTier(50, [100], []), null);
});

test("crossedInfluenceTier：已消费档位不重复返回", () => {
    // 已消费 100，影响度 250 → 单档无后续档位 → null
    assert.equal(crossedInfluenceTier(250, [100], [100]), null);
});

test("crossedInfluenceTier：多档返回下一个未消费档位", () => {
    // thresholds [100,200,300]，consumed [100]，influence 250 → 返回 200
    assert.equal(crossedInfluenceTier(250, [100, 200, 300], [100]), 200);
});

test("crossedInfluenceTier：每回合至多一个未消费档位", () => {
    // influence 直接跳到 350，consumed [] → 只返回第一个 100（不一次返回多个）
    assert.equal(crossedInfluenceTier(350, [100, 200, 300], []), 100);
});

test("getInfluenceThresholds：世界自定义多档生效并排序", () => {
    const w = { parallel_narrative: { influence_thresholds: [200, 60] } };
    assert.deepEqual(getInfluenceThresholds(w), [60, 200]);
});

test("getMaxLayers：世界自定义生效", () => {
    const w = { parallel_narrative: { max_layers: 3 } };
    assert.equal(getMaxLayers(w), 3);
    assert.equal(getMaxLayers({}), 4);
});
