// 定位「程序出现异常」（unhandledrejection: undefined.length）· 第二版
// 模拟用户环境：先构造数据（生成世界+保存知识库）→ 刷新页面（带数据加载）→ 收集堆栈
// 用法：node tools/verify-rejection-repro.mjs [BASE_URL]
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
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

const injectListener = () => page.evaluate(() => {
  window.__rej = [];
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    window.__rej.push({
      msg: String((r && r.message) || r),
      stack: (r && r.stack) ? String(r.stack).split("\n").slice(0, 10).join(" | ") : ""
    });
  });
});

// 阶段 0：构造数据（mock 生成世界 + 保存知识库 → 产生世界与存档数据）
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const m = document.getElementById("mockMode");
  if (m) m.checked = true;
});
await page.evaluate(() => document.querySelector('[data-action="showCreateWorldModal"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.getElementById("worldName").value = "带数据刷新复现";
  document.getElementById("worldDesc").value = "模拟用户已有数据的场景。";
});
await page.evaluate(() => document.getElementById("generateWorldBtn").click());
await page.waitForTimeout(3000);
// 保存知识库（模拟用户操作，产生存档数据）
await page.evaluate(() => {
  const b = document.querySelector('#loreReviewModal [data-action="saveLoreReview"]');
  if (b) b.click();
});
await page.waitForTimeout(2000);
// 再生成一个世界（多个世界更贴近真实）
await page.evaluate(() => document.querySelector('[data-action="showCreateWorldModal"]').click());
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.getElementById("worldName").value = "第二个世界";
  document.getElementById("worldDesc").value = "第二个测试世界。";
});
await page.evaluate(() => document.getElementById("generateWorldBtn").click());
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const b = document.querySelector('#loreReviewModal [data-action="closeModal"]');
  if (b) b.click();
});
await page.waitForTimeout(800);

// 阶段 1：带数据刷新页面（关键：保留 IndexedDB）
await injectListener();
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await injectListener(); // reload 后重新注入
await page.waitForTimeout(18000); // 静置 18 秒，覆盖"加载后 9 秒"窗口
let rej = await page.evaluate(() => window.__rej.map(x => x));

console.log("== 带数据刷新后静置 18s 的 unhandledrejection ==");
console.log(rej.length ? JSON.stringify(rej, null, 2) : "（无）");
console.log("== 页面 window error ==");
console.log(pageErrors.length ? JSON.stringify(pageErrors, null, 2) : "（无）");

await browser.close();
process.exit(0);
