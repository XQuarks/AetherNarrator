// 氛围提示（atmosphere）净化逻辑验证 · docs/ui-redesign
import { test } from "node:test";
import assert from "node:assert";
import { sanitizeAtmosphere } from "../src/utils.js";

test("atmosphere 正常字符串原样保留", () => {
    assert.strictEqual(sanitizeAtmosphere("理智轻微波动：窗外的风声里似乎混入了别的什么"),
        "理智轻微波动：窗外的风声里似乎混入了别的什么");
});

test("atmosphere 压缩多余空白", () => {
    assert.strictEqual(sanitizeAtmosphere("  走廊尽头的\n脚步声   停了 "), "走廊尽头的 脚步声 停了");
});

test("atmosphere 超长截断到 60 字", () => {
    const long = "一".repeat(100);
    assert.strictEqual(sanitizeAtmosphere(long).length, 60);
});

test("atmosphere 非法值归一为 null", () => {
    assert.strictEqual(sanitizeAtmosphere(null), null);
    assert.strictEqual(sanitizeAtmosphere(undefined), null);
    assert.strictEqual(sanitizeAtmosphere(""), null);
    assert.strictEqual(sanitizeAtmosphere("   "), null);
    assert.strictEqual(sanitizeAtmosphere(42), null);
    assert.strictEqual(sanitizeAtmosphere({ text: "x" }), null);
    assert.strictEqual(sanitizeAtmosphere(["x"]), null);
});
