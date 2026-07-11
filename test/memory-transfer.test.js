import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryPack, mergeMemoryPack } from "../src/memory-transfer.js";

test("导出记忆包剔除向量并保留可迁移字段", () => {
    const pack = createMemoryPack([{
        id: "b1",
        text: "在庭院发现密道",
        importance: 4,
        pinned: true,
        type: "discovery",
        embedding: [1, 2, 3]
    }], { worldName: "大观园" });

    assert.equal(pack.format, "aethernarrator-memory-pack");
    assert.equal(pack.version, 1);
    assert.equal(pack.world_name, "大观园");
    assert.equal(pack.memories[0].embedding, undefined);
    assert.equal(pack.memories[0].text, "在庭院发现密道");
});

test("导入时合并重复记忆并保留更高重要性与置顶", () => {
    const existing = [{ id: "local", text: "黛玉 在潇湘馆咳血。", importance: 3, pinned: false }];
    const pack = createMemoryPack([
        { id: "remote", text: "黛玉在潇湘馆咳血", importance: 5, pinned: true },
        { id: "new", text: "宝玉得到通灵宝玉", importance: 4, pinned: false }
    ]);

    const result = mergeMemoryPack(existing, pack);

    assert.equal(result.memories.length, 2);
    assert.equal(result.added, 1);
    assert.equal(result.merged, 1);
    assert.equal(result.memories[0].importance, 5);
    assert.equal(result.memories[0].pinned, true);
});

test("拒绝未知格式的导入文件", () => {
    assert.throws(() => mergeMemoryPack([], { format: "other", memories: [] }), /不是有效的以太叙事记忆包/);
});
