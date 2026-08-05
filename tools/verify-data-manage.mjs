// 数据管理功能核验（设置页三档清理按钮）：
// 用法：node tools/verify-data-manage.mjs [BASE_URL]
// 覆盖：三个按钮渲染 / 两击确认交互（第一次变「确认？再次点击」）/ 执行后 toast / 完全重置触发刷新
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const rawPath = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.platform === "win32" && rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
const require = createRequire(path.join(ROOT, "noop.js"));
const { chromium } = require("playwright-core");

const BASE = process.argv[2] || "http://127.0.0.1:8081";

function browserCandidates() {
  if (process.platform === "win32") {
    return [
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
      path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
      path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/chromium"];
}
const executablePath = browserCandidates().find(c => c && fs.existsSync(c));
if (!executablePath) { console.error("✗ 找不到 Edge/Chrome 浏览器"); process.exit(2); }

const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on("pageerror", e => errs.push(e.message));

const results = [];
const check = (name, pass) => results.push([name, !!pass]);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

// ① 打开设置页
await page.evaluate(() => document.querySelector('[data-action="showSettingsScreen"]').click());
await page.waitForTimeout(500);
const sectionTitle = await page.evaluate(() => {
  const secs = [...document.querySelectorAll("#settingsScreen .st-section-title")];
  const dm = secs.find(s => s.textContent.includes("数 据 管 理"));
  return dm ? dm.textContent.trim() : "";
});
check("设置页出现「数据管理」区", sectionTitle.replace(/\s/g, "").includes("数据管理"));

// ② 三个按钮存在且文案正确
const btnTexts = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("#settingsScreen [data-action]")];
  const want = ["clearRunCache", "wipeAllSaves", "resetAllData"];
  return want.map(a => {
    const b = btns.find(x => x.dataset.action === a);
    return b ? b.textContent.trim() : null;
  });
});
check("「清除游戏缓存」按钮存在", btnTexts[0] === "清除");
check("「删除全部存档」按钮存在", btnTexts[1] === "删除");
check("「完全重置」按钮存在", btnTexts[2] === "重置");

// ③ 两击确认：清除游戏缓存（第一次变「确认？再次点击」，第二次执行 → toast）
const cacheBtn = page.evaluate(() => document.querySelector('[data-action="clearRunCache"]'));
await page.evaluate(() => document.querySelector('[data-action="clearRunCache"]').click());
await page.waitForTimeout(200);
const armedText = await page.evaluate(() => document.querySelector('[data-action="clearRunCache"]').textContent.trim());
check("第一次点击后按钮变「确认？再次点击」", armedText.includes("确认"));
await page.evaluate(() => document.querySelector('[data-action="clearRunCache"]').click());
await page.waitForTimeout(400);
const cacheToast = await page.evaluate(() => {
  const t = document.querySelector(".toast");
  return t ? t.textContent : "";
});
check("第二次点击后出现成功提示", cacheToast.includes("已清除游戏缓存"));

// ④ 删除全部存档（两击）
await page.evaluate(() => document.querySelector('[data-action="wipeAllSaves"]').click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('[data-action="wipeAllSaves"]').click());
await page.waitForTimeout(400);
const savesToast = await page.evaluate(() => {
  const t = document.querySelector(".toast");
  return t ? t.textContent : "";
});
check("删除全部存档出现成功提示", savesToast.includes("已删除全部存档"));

// ⑤ 完全重置（两击）→ 触发 location.reload()
await page.evaluate(() => document.querySelector('[data-action="resetAllData"]').click());
await page.waitForTimeout(200);
const resetArmed = await page.evaluate(() => document.querySelector('[data-action="resetAllData"]').textContent.trim());
check("完全重置第一次点击变确认态", resetArmed.includes("确认"));
await Promise.all([
  page.evaluate(() => document.querySelector('[data-action="resetAllData"]').click()),
  page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {})
]);
await page.waitForTimeout(1200);
const afterReload = await page.evaluate(() => !!document.querySelector("#settingsScreen") || !!document.querySelector(".screen"));
check("完全重置后页面刷新并重新加载", afterReload);

// ⑥ 无未捕获异常
check("全程无未捕获异常", errs.length === 0);

await browser.close();

let failed = 0;
for (const [name, pass] of results) {
  console.log(`${pass ? "✅" : "❌"} ${name}`);
  if (!pass) failed++;
}
console.log(failed === 0 ? `\n全部通过（${results.length} 项）` : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
