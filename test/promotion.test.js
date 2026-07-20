// B6 记忆晋升 · 纯函数单测
// 覆盖：selectPromotionCandidates（阈值/置顶/排除/空输入）、
// markPromotedRecords（promote_ 前缀反解标记、普通 addition 不标记、不突变、空 diff）。
import test from "node:test";
import assert from "node:assert/strict";
import { selectPromotionCandidates, markPromotedRecords, PROMOTE_MIN_IMPORTANCE } from "../src/promotion.js";

const rec = (over = {}) => Object.assign(
    { id: "b1", text: "测试记忆", importance: 3, pinned: false, type: "other", time: "", location: "" },
    over
);

test("importance >= 阈值 入选", () => {
    const list = [rec({ importance: 5 }), rec({ importance: 4 }), rec({ importance: PROMOTE_MIN_IMPORTANCE })];
    const got = selectPromotionCandidates(list);
    assert.equal(got.length, 3);
    assert.deepEqual(got.map(r => r.id), ["b1", "b1", "b1"]);
});

test("pinned 即使低 importance 也入选", () => {
    const got = selectPromotionCandidates([rec({ importance: 1, pinned: true })]);
    assert.equal(got.length, 1);
    assert.equal(got[0].pinned, true);
});

test("importance 低于阈值且未置顶 排除", () => {
    const got = selectPromotionCandidates([rec({ importance: 3 }), rec({ importance: 2 }), rec({ importance: 1 })]);
    assert.equal(got.length, 0);
});

test("已 promoted 的记忆不再当候选（防重复建议）", () => {
    const list = [
        rec({ id: "bA", importance: 5, promoted: true }), // 已晋升，应排除
        rec({ id: "bB", importance: 5, promoted: false }), // 未晋升，应入选
        rec({ id: "bC", importance: 5 })                    // 无标记，应入选
    ];
    const got = selectPromotionCandidates(list);
    assert.deepEqual(got.map(r => r.id), ["bB", "bC"]);
});

test("空 / 非法输入返回 [] 不崩", () => {
    assert.deepEqual(selectPromotionCandidates(null), []);
    assert.deepEqual(selectPromotionCandidates(undefined), []);
    assert.deepEqual(selectPromotionCandidates("x"), []);
    assert.deepEqual(selectPromotionCandidates([null, 1, {}]), []);
});

test("返回深拷贝，不突变原记录", () => {
    const src = [rec({ importance: 5 })];
    const got = selectPromotionCandidates(src);
    got[0].text = "被改";
    assert.equal(src[0].text, "测试记忆");
});

test("markPromotedRecords：promote_ 前缀 addition 标记原记忆 promoted", () => {
    const records = [rec({ id: "bX", importance: 5 }), rec({ id: "bY", importance: 5 })];
    const diff = { updates: [], additions: [{ id: "promote_bX", title: "晋升条目", content: "..." }] };
    const out = markPromotedRecords(records, diff);
    assert.equal(out.find(r => r.id === "bX").promoted, true);
    assert.equal(out.find(r => r.id === "bY").promoted, undefined);
});

test("markPromotedRecords：普通 addition 不标记", () => {
    const records = [rec({ id: "bX", importance: 5 })];
    const diff = { updates: [], additions: [{ id: "nl1", title: "新条目", content: "..." }] };
    const out = markPromotedRecords(records, diff);
    assert.equal(out.find(r => r.id === "bX").promoted, undefined);
});

test("markPromotedRecords：不突变入参、空 diff 原样返回", () => {
    const records = [rec({ id: "bX", importance: 5 })];
    const before = JSON.stringify(records);
    const out1 = markPromotedRecords(records, { updates: [], additions: [] });
    const out2 = markPromotedRecords(records, null);
    assert.equal(JSON.stringify(records), before, "入参被突变");
    assert.equal(out1.find(r => r.id === "bX").promoted, undefined);
    assert.equal(out2.find(r => r.id === "bX").promoted, undefined);
});
