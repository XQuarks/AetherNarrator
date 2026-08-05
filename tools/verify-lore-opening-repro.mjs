// 复现核验：生成后知识库审阅弹窗为空 + 开局剧情不显示（mock 模式，不烧 token）
// 用法：node tools/verify-lore-opening-repro.mjs [BASE_URL]
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
const check = (name, pass, detail = "") => results.push([name, !!pass, detail]);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

// ① 开启模拟模式（不烧 token）
await page.evaluate(() => {
  const m = document.getElementById("mockMode");
  if (m) m.checked = true;
});

// ② 打开创建弹窗 → 填名称/描述 → 生成
await page.evaluate(() => document.querySelector('[data-action="showCreateWorldModal"]').click());
await page.waitForTimeout(500);
await page.evaluate(() => {
  document.getElementById("worldName").value = "复现测试世界";
  document.getElementById("worldDesc").value = "一个用于复现问题的小世界，包含魔法与冒险。";
});
await page.evaluate(() => document.getElementById("generateWorldBtn").click());
await page.waitForTimeout(2500); // mock 生成 + 一致性包 + 审阅弹窗

// ③ 问题 1 复现检查：生成后审阅弹窗内知识库条目数（修复后应非空）
const modalOpen = await page.evaluate(() => !!document.getElementById("loreReviewModal").classList.contains("show"));
const modalTreeItems = await page.evaluate(() => document.querySelectorAll("#loreReviewModal .lore-tree-item").length);
const modalEmptyShown = await page.evaluate(() => !!document.querySelector("#loreReviewModal .lore-tree-empty"));
check("生成后审阅弹窗已打开", modalOpen);
check("审阅弹窗知识库非空（问题1）", !modalEmptyShown && modalTreeItems > 0, `弹窗条目=${modalTreeItems} 空提示=${modalEmptyShown}`);

// ④ 在审阅弹窗点「保存知识库」（问题 2 关键：不应创建存档）
await page.evaluate(() => {
  const b = document.querySelector('#loreReviewModal [data-action="saveLoreReview"]');
  if (b) b.click();
});
await page.waitForTimeout(800);
const worldCardBtn = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".world-card")];
  const mine = cards.find(c => c.textContent.includes("复现测试世界"));
  const b = mine && mine.querySelector('[data-action="showWorldDetail"]');
  return b ? b.textContent.trim() : "";
});
check("保存知识库后未创建存档（问题2 关键：按钮应为「进入世界」非「继续游玩」）", worldCardBtn.includes("进入世界"), `按钮文案="${worldCardBtn}"`);

// ⑤ 点世界卡 → 详情 → 开始游玩 → 检查开局剧情与选项
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".world-card")];
  const mine = cards.find(c => c.textContent.includes("复现测试世界"));
  if (mine) mine.click();
});
await page.waitForTimeout(500);
const startBtnExists = await page.evaluate(() => !!document.querySelector('#worldDetailModal [data-action="startGame"]'));
check("详情页显示「开始游玩」按钮", startBtnExists);
await page.evaluate(() => {
  const b = document.querySelector('#worldDetailModal [data-action="startGame"]');
  if (b) b.click();
});
await page.waitForTimeout(4000); // 打字机完成

const logInfo = await page.evaluate(() => {
  const log = document.getElementById("gameLog");
  if (!log) return { entries: -1, narrLen: 0, narrText: "", choices: 0 };
  const entries = log.querySelectorAll(".log-entry");
  const first = entries[0];
  const narr = first ? first.querySelector(".narrative") : null;
  const choices = log.querySelectorAll("#choicesArea .choice-btn, #choicesArea .choice").length;
  return {
    entries: entries.length,
    narrLen: narr ? narr.textContent.length : 0,
    narrText: narr ? narr.textContent.slice(0, 60) : "",
    choices
  };
});
check("开局有剧情条目（问题2：剧情显示）", logInfo.entries >= 1 && logInfo.narrLen > 0, JSON.stringify(logInfo));
check("开局剧情为完整文本", logInfo.narrLen > 20, `narrative长度=${logInfo.narrLen} 文本="${logInfo.narrText}"`);

// ⑥ 无未捕获异常
check("全程无未捕获异常", errs.length === 0, errs.join(" | ").slice(0, 300));

await browser.close();

let failed = 0;
for (const [name, pass, detail] of results) {
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failed++;
}
console.log(failed === 0 ? `\n全部通过（${results.length} 项）` : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
