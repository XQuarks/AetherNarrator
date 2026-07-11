import test from "node:test";
import assert from "node:assert/strict";

import {
    LATEST_SAVE_SCHEMA_VERSION,
    migrateSaveRecord,
    migrateWorldRecord
} from "../src/migrations.js";

test("旧存档迁移为独立的知识库、记忆和增强设置", () => {
    const world = {
        id: "w1",
        lore_kb: { snippets: [{ id: "l1", title: "规则" }] },
        behavior_records: [{ id: "b1", text: "旧世界记忆" }]
    };
    const save = { id: "s1", worldId: "w1", state: { name: "主角" } };

    const migrated = migrateSaveRecord(save, world);

    assert.equal(migrated.schema_version, LATEST_SAVE_SCHEMA_VERSION);
    assert.deepEqual(migrated.lore_kb, world.lore_kb);
    assert.deepEqual(migrated.behavior_records, world.behavior_records);
    assert.equal(migrated.ai_enhanced, false);
    assert.equal(migrated.last_lore_review_msg_count, 0);
    assert.equal(migrated.pending_lore_revision, null);
    assert.notStrictEqual(migrated.lore_kb, world.lore_kb);
    assert.notStrictEqual(migrated.behavior_records, world.behavior_records);
});

test("迁移不修改输入且可以重复执行", () => {
    const world = { id: "w1", lore_kb: { snippets: [] }, behavior_records: [] };
    const save = {
        id: "s1",
        worldId: "w1",
        schema_version: 1,
        behavior_records: [{ id: "b1", text: "存档记忆", pinned: true }],
        ai_enhanced: true,
        last_lore_review_msg_count: 20
    };
    const before = structuredClone(save);

    const once = migrateSaveRecord(save, world);
    const twice = migrateSaveRecord(once, world);

    assert.deepEqual(save, before);
    assert.deepEqual(twice, once);
    assert.notStrictEqual(once, save);
    assert.equal(once.ai_enhanced, true);
    assert.equal(once.last_lore_review_msg_count, 20);
});

test("世界迁移只保留模板默认值并补齐版本", () => {
    const world = {
        id: "w1",
        lore_kb: { snippets: [] },
        behavior_records: [{ id: "legacy" }],
        ai_enhanced_default: true
    };

    const migrated = migrateWorldRecord(world);

    assert.equal(migrated.schema_version, LATEST_SAVE_SCHEMA_VERSION);
    assert.equal(migrated.ai_enhanced_default, true);
    assert.deepEqual(migrated.behavior_records, world.behavior_records);
    assert.notStrictEqual(migrated, world);
});

test("损坏的可选集合迁移为安全默认值", () => {
    const migrated = migrateSaveRecord({
        id: "s1",
        behavior_records: "bad",
        lore_kb: "bad",
        pending_lore_revision: "bad"
    }, null);

    assert.deepEqual(migrated.behavior_records, []);
    assert.equal(migrated.lore_kb, null);
    assert.equal(migrated.pending_lore_revision, null);
});

test("旧版整库修订缓冲迁移为增量更新格式", () => {
    const migrated = migrateSaveRecord({
        id: "s1",
        pending_lore_revision: [{ id: "l1", title: "旧建议" }]
    }, null);

    assert.deepEqual(migrated.pending_lore_revision, {
        updates: [{ id: "l1", title: "旧建议" }],
        additions: []
    });
});
