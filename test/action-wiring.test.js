import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("index.html 中声明的操作都在 src/app.js 接线", () => {
    const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    const declared = new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]));
    const actionBlock = app.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
    assert.ok(actionBlock, "src/app.js 应声明 ACTIONS 表");
    const wired = new Set([...actionBlock[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(match => match[1]));
    const handledOutsideTable = new Set(["statusPanelStop"]);
    const missing = [...declared].filter(name => !wired.has(name) && !handledOutsideTable.has(name));
    assert.deepEqual(missing, [], `缺少 ACTIONS 接线：${missing.join(", ")}`);
});
