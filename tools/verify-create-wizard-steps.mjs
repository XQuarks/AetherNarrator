// 创建向导分步交互核验（docs/62）：真实点击走完整流程
// 用法：node tools/verify-create-wizard-steps.mjs [BASE_URL]
// 覆盖：必填校验拦截 / 跳过 / 步骤条回跳限制 / 末步摘要与按钮切换 / 摘要「修改」回跳
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

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

// 打开创建弹窗
await page.evaluate(() => document.querySelector('[data-action="showCreateWorldModal"]').click());
await page.waitForTimeout(600);

const activeStep = () => page.evaluate(() => {
  const p = document.querySelector("#createWorldModal .wz-pane.active");
  return p ? parseInt(p.dataset.step, 10) : -1;
});
const click = (id) => page.evaluate((i) => document.getElementById(i).click(), id);
const results = [];
const check = (name, pass) => results.push([name, !!pass]);

// ① 空表单调下一步 → 应被必填校验拦截在第 1 步
await click("wzNextBtn");
await page.waitForTimeout(300);
check("空表单点「下一步」被拦截在第 1 步", (await activeStep()) === 0);

// ② 步骤条不可跳到未到达的步骤（点第 5 节点应无反应）
await page.evaluate(() => {
  const n = document.querySelector('#wzStepsBar .wz-step-node[data-step="4"]');
  if (n) n.click();
});
await page.waitForTimeout(300);
check("未到达的步骤不可点击跳转", (await activeStep()) === 0);

// ③ 只填名称不填描述 → 仍被拦截
await page.fill("#worldName", "雾都诡事");
await click("wzNextBtn");
await page.waitForTimeout(300);
check("只填名称不填描述仍被拦截", (await activeStep()) === 0);

// ④ 补描述 → 进入第 2 步
await page.fill("#worldDesc", "浓雾笼罩的维多利亚式都市，怪谈在煤气灯下滋生。");
await click("wzNextBtn");
await page.waitForTimeout(300);
check("名称+描述齐备后进入第 2 步", (await activeStep()) === 1);

// ⑤ 连续跳过 2/3/4 步 → 到第 5 步（角色资源）
await click("wzSkipBtn"); await page.waitForTimeout(200);
await click("wzSkipBtn"); await page.waitForTimeout(200);
await click("wzSkipBtn"); await page.waitForTimeout(200);
check("连续跳过可跳步骤后到第 5 步（角色资源）", (await activeStep()) === 4);

// ⑥ 上一步回退 → 第 4 步（玩法时间）
await click("wzPrevBtn"); await page.waitForTimeout(200);
check("「上一步」回退到第 4 步", (await activeStep()) === 3);

// ⑦ 步骤条回跳到已到达的第 2 步
await page.evaluate(() => {
  const n = document.querySelector('#wzStepsBar .wz-step-node[data-step="1"]');
  if (n) n.click();
});
await page.waitForTimeout(200);
check("已到达的步骤可点击回跳", (await activeStep()) === 1);

// ⑧ 走到末步：摘要 8 项、确认生成可见、下一步隐藏
await click("wzSkipBtn"); await page.waitForTimeout(200); // →2
await click("wzSkipBtn"); await page.waitForTimeout(200); // →3
await click("wzSkipBtn"); await page.waitForTimeout(200); // →4
await click("wzNextBtn"); await page.waitForTimeout(300); // →5
check("进入末步（确认生成）", (await activeStep()) === 5);
const lastState = await page.evaluate(() => ({
  sumItems: document.querySelectorAll("#wzSummary .wz-sum-item").length,
  sumHasName: (document.getElementById("wzSummary") || {}).textContent.includes("雾都诡事"),
  genVisible: document.getElementById("generateWorldBtn").style.display !== "none",
  nextHidden: document.getElementById("wzNextBtn").style.display === "none",
  skipHidden: document.getElementById("wzSkipBtn").style.display === "none",
  valPanelShown: document.getElementById("wizardValidationPanel").style.display !== "none"
}));
check("摘要渲染 8 项配置卡", lastState.sumItems === 8);
check("摘要含已填世界名称", lastState.sumHasName);
check("末步显示「确认生成」", lastState.genVisible);
check("末步隐藏「下一步」", lastState.nextHidden);
check("末步隐藏「跳过」", lastState.skipHidden);
check("末步校验面板可见", lastState.valPanelShown);

// ⑨ 摘要「修改」回跳第 1 步
await page.evaluate(() => document.querySelector('#wzSummary .wz-sum-edit[data-step="0"]').click());
await page.waitForTimeout(300);
check("摘要「修改」回跳到第 1 步", (await activeStep()) === 0);
check("回跳后世界名称仍在（表单未丢）", (await page.inputValue("#worldName")) === "雾都诡事");

await browser.close();

let ok = true;
console.log("=== docs/62 创建向导分步交互核验 (" + BASE + ") ===");
for (const [name, pass] of results) {
  console.log((pass ? "✓ " : "✗ ") + name);
  if (!pass) ok = false;
}
if (errs.length) { console.log("页面 JS 错误:\n  " + errs.join("\n  ")); ok = false; }
console.log(ok ? "\n结论：全部通过 ✅" : "\n结论：存在失败项 ❌");
process.exit(ok ? 0 : 1);
