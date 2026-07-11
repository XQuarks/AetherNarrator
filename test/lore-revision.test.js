import test from "node:test";
import assert from "node:assert/strict";

import { applyLoreRevisionDiff, buildLoreRevisionDiff, parseLoreRevisionResponse } from "../src/lore-revision.js";

test("解析 AI 知识库修订 JSON 字符串", () => {
    const snippets = parseLoreRevisionResponse('{"snippets":[{"id":"l1","title":"人物"}]}');
    assert.equal(snippets[0].id, "l1");
});

test("修订 diff 仅包含新增和实际变化的条目", () => {
    const current = [
        { id: "l1", title: "黛玉", content: "原内容" },
        { id: "l2", title: "宝玉", content: "不变" }
    ];
    const proposed = [
        { id: "l1", title: "黛玉", content: "新内容" },
        { id: "l2", title: "宝玉", content: "不变" },
        { id: "l3", title: "湘云", content: "新增" }
    ];

    const diff = buildLoreRevisionDiff(current, proposed);

    assert.deepEqual(diff.updates.map(item => item.id), ["l1"]);
    assert.deepEqual(diff.additions.map(item => item.id), ["l3"]);
});

test("应用 diff 时保留 AI 未返回的原条目", () => {
    const current = [
        { id: "l1", title: "黛玉", content: "原内容" },
        { id: "l2", title: "宝玉", content: "必须保留" }
    ];
    const result = applyLoreRevisionDiff(current, {
        updates: [{ id: "l1", title: "黛玉", content: "新内容" }],
        additions: []
    });

    assert.equal(result.length, 2);
    assert.equal(result.find(item => item.id === "l2").content, "必须保留");
});
