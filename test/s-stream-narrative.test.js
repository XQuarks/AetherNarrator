// 实时流式：extractPartialNarrative 增量抽取叙事字段
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPartialNarrative } from "../src/llm.js";

test("narrative 尚未出现时返回 null", () => {
    assert.equal(extractPartialNarrative('{"choices":[]}'), null);
});

test("narrative 值非字符串（null）时返回 null", () => {
    assert.equal(extractPartialNarrative('{"narrative":null,"x":1}'), null);
});

test("narrative 流式中间态返回部分文本（无收尾引号）", () => {
    const raw = '{"narrative":"你站在门前，夜风"}';
    // 模拟还没收到收尾引号：截断到引号之前
    const partial = raw.slice(0, raw.length - 1); // 去掉末尾 "
    assert.equal(extractPartialNarrative(partial), "你站在门前，夜风");
});

test("narrative 完整返回后返回完整文本", () => {
    const raw = '{"narrative":"你站在门前，夜风正凉。","choices":[]}';
    assert.equal(extractPartialNarrative(raw), "你站在门前，夜风正凉。");
});

test("narrative 含转义引号/换行时正确还原", () => {
    const raw = '{"narrative":"他说：\\"走吧\\"。\\n于是你迈步。","x":1}';
    assert.equal(extractPartialNarrative(raw), '他说："走吧"。\n于是你迈步。');
});

test("narrative 出现在其它字段之后仍可抽取", () => {
    const raw = '{"choices":[],"narrative":"尾声已至。"}';
    assert.equal(extractPartialNarrative(raw), "尾声已至。");
});
