// 测试：温度改为「每世界独立」后，getTemperature 读取世界 temperature_preset，
// 且 tempLabelText 分段正确。对应改动：docs/26 + 用户「去全局温度、接单世界温度 UI」。
import test from "node:test";
import assert from "node:assert";
import { S } from "../src/store.js";
import { getTemperature, tempLabelText } from "../src/theme.js";

test("getTemperature 返回当前世界的 temperature_preset", () => {
    const saved = S.currentWorld;
    try {
        S.currentWorld = { temperature_preset: 0.3 };
        assert.strictEqual(getTemperature(), 0.3);
    } finally { S.currentWorld = saved; }
});

test("getTemperature 世界字段缺失时回落 0.5", () => {
    const saved = S.currentWorld;
    try {
        S.currentWorld = { name: "无温度世界" };
        assert.strictEqual(getTemperature(), 0.5);
    } finally { S.currentWorld = saved; }
});

test("getTemperature temperature_preset 非数字时回落 0.5", () => {
    const saved = S.currentWorld;
    try {
        S.currentWorld = { temperature_preset: "hot" };
        assert.strictEqual(getTemperature(), 0.5);
    } finally { S.currentWorld = saved; }
});

test("getTemperature 无当前世界时回落 0.5", () => {
    const saved = S.currentWorld;
    try {
        S.currentWorld = null;
        assert.strictEqual(getTemperature(), 0.5);
    } finally { S.currentWorld = saved; }
});

test("tempLabelText 分段：严谨/剧情/均衡/创意", () => {
    assert.strictEqual(tempLabelText(0.2), "严谨模式（高度一致）");
    assert.strictEqual(tempLabelText(0.3), "严谨模式（高度一致）");
    assert.strictEqual(tempLabelText(0.5), "剧情模式（稳定连贯）");
    assert.strictEqual(tempLabelText(0.7), "均衡模式（适中开放）");
    assert.strictEqual(tempLabelText(0.9), "创意模式（自由发散）");
    assert.strictEqual(tempLabelText(1), "创意模式（自由发散）");
});
