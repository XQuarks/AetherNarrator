import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeStars, applySkillResult, ensureGrowthEntry,
    DEFAULT_SKILL_THRESHOLDS, DEFAULT_MAX_STARS
} from "../src/skill-growth.js";

// ============ computeStars ============
test("computeStars：默认阈值 0/2→0、3→1、8→2、15→3、20→3（封顶）", () => {
    assert.equal(computeStars(0), 0);
    assert.equal(computeStars(2), 0);
    assert.equal(computeStars(3), 1);
    assert.equal(computeStars(7), 1);
    assert.equal(computeStars(8), 2);
    assert.equal(computeStars(14), 2);
    assert.equal(computeStars(15), 3);
    assert.equal(computeStars(999), 3); // 封顶 maxStars=3
});

test("computeStars：负数/非数字 successCount 视为 0", () => {
    assert.equal(computeStars(-5), 0);
    assert.equal(computeStars(undefined), 0);
    assert.equal(computeStars(null), 0);
    assert.equal(computeStars("x"), 0);
});

test("computeStars：空阈值回退默认，自定义阈值与 maxStars 生效", () => {
    assert.equal(computeStars(10, [], 5), 2);                 // 空阈值→默认[3,8,15]，10→2星，max5→2
    assert.equal(computeStars(3, [2, 4], 2), 1);              // 自定义阈值[2,4]，3→1星
    assert.equal(computeStars(100, [2, 4], 1), 1);            // maxStars 钳制升星上限
    assert.equal(computeStars(100, [2, 4], 0), 2);            // maxStars<=0 回退默认3，但本身仅2星
    assert.equal(computeStars(100, [2, 4], -1), 2);           // 同上
});

// ============ applySkillResult ============
test("applySkillResult：result=success 累加一次且可升星", () => {
    const r1 = applySkillResult({ stars: 0, successCount: 2 }, "success");
    assert.equal(r1.state.successCount, 3);
    assert.equal(r1.leveledUp, true);
    assert.equal(r1.oldStars, 0);
    assert.equal(r1.newStars, 1);
});

test("applySkillResult：result=fail/use 不累加、不升星", () => {
    const rFail = applySkillResult({ stars: 1, successCount: 5 }, "fail");
    assert.equal(rFail.state.successCount, 5);
    assert.equal(rFail.leveledUp, false);
    assert.equal(rFail.newStars, 1);

    const rUse = applySkillResult({ stars: 1, successCount: 5 }, "use");
    assert.equal(rUse.state.successCount, 5);
    assert.equal(rUse.leveledUp, false);
});

test("applySkillResult：连续成功跨多阈值（3→升1，8→升2，15→升3）", () => {
    let st = { stars: 0, successCount: 0 };
    const log = [];
    for (let i = 1; i <= 16; i++) {
        const r = applySkillResult(st, "success");
        st = r.state;
        if (r.leveledUp) log.push({ round: i, stars: r.newStars });
    }
    assert.deepEqual(log, [{ round: 3, stars: 1 }, { round: 8, stars: 2 }, { round: 15, stars: 3 }]);
    assert.equal(st.successCount, 16);
    assert.equal(st.stars, 3);
});

test("applySkillResult：不信任 AI 自报星级（desync 自动自愈）", () => {
    // AI 谎报 stars=99 但 successCount=0，引擎重算为 0，leveledUp=false
    const r = applySkillResult({ stars: 99, successCount: 0 }, "success");
    assert.equal(r.state.successCount, 1);
    assert.equal(r.state.stars, 0);          // 由 successCount 重算，忽略 99
    assert.equal(r.leveledUp, false);        // oldStars(99) > newStars(0)
});

test("applySkillResult：maxStars 钳制升星上限", () => {
    const r = applySkillResult({ stars: 0, successCount: 0 }, "success", { thresholds: [1, 2], maxStars: 2 });
    assert.equal(r.state.stars, 1);
    const r2 = applySkillResult(r.state, "success"); // 第2次，达阈值2
    assert.equal(r2.state.stars, 2);
    const r3 = applySkillResult(r2.state, "success"); // 第3次，已封顶
    assert.equal(r3.state.stars, 2);
    assert.equal(r3.leveledUp, false);
});

test("applySkillResult：缺省 state 视为新技能，忽略外部 stars 字段", () => {
    // 即便传入含 stars 但非运行时对象结构，仍从 0 重算
    const r = applySkillResult({ stars: 5 }, "success");
    assert.equal(r.state.successCount, 1);
    assert.equal(r.state.stars, 0);
    assert.equal(r.leveledUp, false);
});

// ============ ensureGrowthEntry ============
test("ensureGrowthEntry：缺字段时懒创建默认运行时对象（幂等）", () => {
    const map = {};
    const e1 = ensureGrowthEntry(map, "火焰咒");
    assert.deepEqual(e1, {
        stars: 0, successCount: 0,
        thresholds: DEFAULT_SKILL_THRESHOLDS, maxStars: DEFAULT_MAX_STARS, lastNotifiedRound: null
    });
    // 第二次返回同一对象（已存在，不重建）
    const e2 = ensureGrowthEntry(map, "火焰咒");
    assert.equal(e1, e2);
    assert.equal(Object.keys(map).length, 1);
});

test("ensureGrowthEntry：已有时原样返回（保留成长进度与自定义阈值）", () => {
    const map = { "剑术": { stars: 2, successCount: 9, thresholds: [3, 8, 15], maxStars: 3, lastNotifiedRound: 4 } };
    const e = ensureGrowthEntry(map, "剑术");
    assert.equal(e.stars, 2);
    assert.equal(e.successCount, 9);
    assert.equal(e.thresholds[0], 3);
    // 不覆盖既有进度（直接引用同一对象）
    e.successCount += 1;
    assert.equal(map["剑术"].successCount, 10);
});

test("ensureGrowthEntry：非法 map 输入不抛错（创建本地条目）", () => {
    const e = ensureGrowthEntry(null, "X");
    assert.equal(e.stars, 0);
    assert.equal(e.successCount, 0);
});

// ============ 与 s.skills 字符串契约解耦 ============
test("applySkillResult 仅写成长进度，绝不触碰 s.skills 字符串描述", () => {
    const skills = { "火焰咒": "基础攻击法术（玩家预设）" };
    const growth = {};
    const entry = ensureGrowthEntry(growth, "火焰咒");
    const r = applySkillResult(entry, "success");
    growth["火焰咒"] = r.state;
    // 文字描述层原样保留
    assert.equal(skills["火焰咒"], "基础攻击法术（玩家预设）");
    // 成长进度在独立字段
    assert.equal(growth["火焰咒"].successCount, 1);
    assert.equal(growth["火焰咒"].stars, 0);
});
