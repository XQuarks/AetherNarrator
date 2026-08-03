// docs/56 · 按剧情进度解锁 lore（隐形门禁）单测
// 锁定：① unlock_stage > 当前 story_progress → 锁（返回 false）
//       ② unlock_stage <= 当前 story_progress → 解锁（true）
//       ③ 缺 unlock_stage / 非法值 → 默认 1（不锁）
//       ④ 行为记录（behavior_ 开头）→ 不受限（true）
//       ⑤ 缺 gameState / 缺 story_progress → 按进度 1 处理（stage1 解锁、stage2 锁）
import test from "node:test";
import assert from "node:assert/strict";
import { loreStageUnlocked } from "../src/rag.js";
import { S } from "../src/store.js";

function setProgress(p) { S.gameState = (p == null) ? {} : { story_progress: p }; }

test("loreStageUnlocked：stage 等于当前进度 → 解锁", () => {
    setProgress(3);
    assert.equal(loreStageUnlocked({ id: "x1", unlock_stage: 3 }), true);
});

test("loreStageUnlocked：stage 小于当前进度 → 解锁", () => {
    setProgress(5);
    assert.equal(loreStageUnlocked({ id: "x2", unlock_stage: 1 }), true);
    assert.equal(loreStageUnlocked({ id: "x2b", unlock_stage: 4 }), true);
});

test("loreStageUnlocked：stage 大于当前进度 → 锁（防剧透）", () => {
    setProgress(2);
    assert.equal(loreStageUnlocked({ id: "end", unlock_stage: 6 }), false);
    // 结局卡片在开篇（进度 1）应被锁
    setProgress(1);
    assert.equal(loreStageUnlocked({ id: "end2", unlock_stage: 6 }), false);
});

test("loreStageUnlocked：缺字段 / 非法值 → 默认 1（不锁，向后兼容）", () => {
    setProgress(1);
    assert.equal(loreStageUnlocked({ id: "a" }), true);          // 无 unlock_stage
    assert.equal(loreStageUnlocked({ id: "b", unlock_stage: 0 }), true);  // 非法 → 默认 1
    assert.equal(loreStageUnlocked({ id: "c", unlock_stage: -3 }), true);
    assert.equal(loreStageUnlocked({ id: "d", unlock_stage: "x" }), true);
    assert.equal(loreStageUnlocked({ id: "e", unlock_stage: 1.7 }), true); // 向下取整
});

test("loreStageUnlocked：行为记录（behavior_）不受门禁影响", () => {
    setProgress(1);
    assert.equal(loreStageUnlocked({ id: "behavior_123", unlock_stage: 99 }), true);
    assert.equal(loreStageUnlocked({ id: "behavior_x" }), true);
});

test("loreStageUnlocked：缺 gameState / 缺 story_progress → 按进度 1", () => {
    S.gameState = undefined;
    assert.equal(loreStageUnlocked({ id: "a", unlock_stage: 1 }), true);   // 默认进度 1，stage1 可用
    assert.equal(loreStageUnlocked({ id: "b", unlock_stage: 2 }), false);  // stage2 在默认进度 1 下被锁
    setProgress(undefined);
    assert.equal(loreStageUnlocked({ id: "c", unlock_stage: 2 }), false);
});

test("loreStageUnlocked：边界 50 上限不影响比对", () => {
    setProgress(50);
    assert.equal(loreStageUnlocked({ id: "a", unlock_stage: 50 }), true);
    setProgress(49);
    assert.equal(loreStageUnlocked({ id: "a", unlock_stage: 50 }), false);
});
