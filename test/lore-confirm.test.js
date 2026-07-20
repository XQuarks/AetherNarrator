// 知识晋升确认开关 · 单测
// 验证：开关关→自动应用（不打断）；开关开→弹窗待确认；弹窗摘要正确统计更新/新增/晋升。
import test from "node:test";
import assert from "node:assert/strict";
import { S } from "../src/store.js";
import { shouldAutoApplyLoreRevision, buildLoreRevisionSummaryHTML } from "../src/lore-ui.js";

test("开关关（默认）→ 应自动应用修订，不弹窗", () => {
    S.loreRequireConfirm = false;
    assert.equal(shouldAutoApplyLoreRevision(), true, "默认关闭时应为自动应用");
});

test("开关开 → 不自动应用，需玩家确认", () => {
    S.loreRequireConfirm = true;
    assert.equal(shouldAutoApplyLoreRevision(), false, "开启时应走手动确认弹窗");
});

test("弹窗摘要：正确统计更新/新增/记忆晋升条数", () => {
    const buf = {
        updates: [{ id: "lore_1", title: "旧条目" }, { id: "lore_2", title: "另一条" }],
        additions: [
            { id: "new_1", title: "新背景" },
            { id: "promote_rec_7", title: "晋升：某记忆" },
            { id: "promote_rec_9", title: "晋升：另记忆" }
        ]
    };
    const html = buildLoreRevisionSummaryHTML(buf);
    assert.ok(html.includes("更新 <b>2</b> 条已有知识"), "应统计 2 条更新");
    assert.ok(html.includes("新增 <b>3</b> 条知识"), "应统计 3 条新增");
    assert.ok(html.includes("其中 <b>2</b> 条为记忆晋升"), "应统计 2 条晋升（promote_ 前缀）");
});

test("弹窗摘要：无晋升时只显示更新/新增", () => {
    const buf = { updates: [{ id: "lore_1" }], additions: [{ id: "new_1" }] };
    const html = buildLoreRevisionSummaryHTML(buf);
    assert.ok(html.includes("更新 <b>1</b> 条已有知识"));
    assert.ok(html.includes("新增 <b>1</b> 条知识"));
    assert.ok(!html.includes("记忆晋升"), "无晋升不应出现晋升字样");
});

test("弹窗摘要：空缓冲 → 友好占位", () => {
    assert.ok(buildLoreRevisionSummaryHTML(null).includes("暂无待确认的修订"));
    assert.ok(buildLoreRevisionSummaryHTML({}).includes("暂无待确认的修订"));
});
