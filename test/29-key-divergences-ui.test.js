// ★ A2 #4：关键偏离(key_divergences)文本框 UI 接线静态测试
// 这些纯静态断言锁定"建世界卡有该输入框、generateWorld 读取并写入 world.canon"，
// 不依赖浏览器 DOM 运行，避免重构时静默丢失接线。注入逻辑由 29-consistency-pack.test.js 覆盖。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const game = readFileSync(join(root, "src", "game.js"), "utf8");
const prompt = readFileSync(join(root, "src", "prompt.js"), "utf8");

test("index.html 建世界卡含 keyDivergences 文本框", () => {
    assert.ok(html.includes('id="keyDivergences"'), "建世界卡应包含关键偏离文本框");
});

test("game.js 读取 keyDivergences 并写入 world.canon", () => {
    assert.ok(game.includes('getElementById("keyDivergences")'), "generateWorld 应读取该文本框");
    assert.ok(game.includes("world.canon.key_divergences = keyDivergences"), "应将输入写入 world.canon.key_divergences");
});

test("prompt.js 消费 key_divergences 并注入『关键偏离』章节（回归）", () => {
    assert.ok(prompt.includes("c.key_divergences"), "prompt.js 应读取 canon.key_divergences");
    assert.ok(prompt.includes("关键偏离"), "注入文案应包含『关键偏离』");
});
