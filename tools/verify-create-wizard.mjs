// 创建向导（docs/62 分步向导重构后）可视化核验脚本
// 用法：node tools/verify-create-wizard.mjs  [BASE_URL]
// 通过真实点击 [data-action="showCreateWorldModal"] 按钮打开弹窗，
// 断言：旧字段(世界类型/主角设定/类型编辑弹窗)已移除；6 步向导骨架（步骤条/pane/底部导航）就位。
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

// 跨平台取项目根目录（Windows 下 URL.pathname 形如 /C:/...，需去掉前导斜杠）
const rawPath = path.dirname(new URL(import.meta.url).pathname);
const ROOT = process.platform === "win32" && rawPath.startsWith("/")
  ? rawPath.slice(1)
  : rawPath;
const require = createRequire(path.join(ROOT, "noop.js"));
const { chromium } = require("playwright-core");

const BASE = process.argv[2] || "http://127.0.0.1:4173";

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

const clicked = await page.evaluate(() => {
  const btn = document.querySelector('[data-action="showCreateWorldModal"]');
  if (!btn) return "no-btn";
  btn.click();
  return "clicked";
});
await page.waitForTimeout(900);

const r = await page.evaluate(() => {
  const m = document.getElementById("createWorldModal");
  const cs = m ? getComputedStyle(m) : null;
  const q = s => document.querySelector(s);
  const all = s => Array.from(document.querySelectorAll(s));
  return {
    modalOpen: !!m && m.classList.contains("show") && cs && cs.display !== "none",
    hasWorldType: !!q("#worldType"),
    hasHeroDesc: !!q("#heroDesc"),
    hasIpName: !!q("#ipName"),
    hasWorldDesc: !!q("#worldDesc"),
    povSolo: !!q('input[name="povMode"][value="solo"]'),
    povEnsemble: !!q('input[name="povMode"][value="ensemble"]'),
    hasWorldTypeEditModal: !!q("#worldTypeEditModal"),
    stepNodes: all("#wzStepsBar .wz-step-node").map(b => (b.querySelector(".wz-step-name") || {}).textContent || ""),
    oldNavItems: all("#createWorldModal .cw-nav-item").length,
    worldSectionExists: !!q('[data-module="world"]'),
    step0Active: q('#createWorldModal .wz-pane[data-step="0"]') ? q('#createWorldModal .wz-pane[data-step="0"]').classList.contains("active") : false,
    otherPanesHidden: all("#createWorldModal .wz-pane").slice(1).every(p => !p.classList.contains("active")),
    nextVisible: q("#wzNextBtn") ? q("#wzNextBtn").style.display !== "none" : false,
    genHidden: q("#generateWorldBtn") ? q("#generateWorldBtn").style.display === "none" : true,
    cancelVisible: q("#wzCancelBtn") ? q("#wzCancelBtn").style.display !== "none" : false,
    refHint: !!q("#ipNameOptHint")
  };
});

await browser.close();

// 断言
const expect = {
  modalOpen: true,
  hasWorldType: false,
  hasHeroDesc: false,
  hasIpName: true,
  hasWorldDesc: true,
  povSolo: true,
  povEnsemble: true,
  hasWorldTypeEditModal: false,
  worldSectionExists: false,
  step0Active: true,
  otherPanesHidden: true,
  nextVisible: true,
  genHidden: true,
  cancelVisible: true,
  oldNavItems: 0,
  refHint: true,
  stepNodesLen: 6
};
const stepsOk = Array.isArray(r.stepNodes) && r.stepNodes.length === expect.stepNodesLen &&
  ["世界设定", "叙事风格", "叙事视角", "玩法时间", "角色资源", "确认生成"].every(n => r.stepNodes.includes(n));

const results = [
  ["弹窗通过按钮真实打开", r.modalOpen === expect.modalOpen],
  ["旧『世界类型』下拉已移除", r.hasWorldType === expect.hasWorldType],
  ["旧『主角设定』框已移除", r.hasHeroDesc === expect.hasHeroDesc],
  ["新『参考作品』输入框存在", r.hasIpName === expect.hasIpName],
  ["新『世界观知识与描述』存在", r.hasWorldDesc === expect.hasWorldDesc],
  ["pov 单选：单人主角 存在", r.povSolo === expect.povSolo],
  ["pov 单选：群像剧 存在", r.povEnsemble === expect.povEnsemble],
  ["旧『类型编辑弹窗』已移除", r.hasWorldTypeEditModal === expect.hasWorldTypeEditModal],
  ["旧『世界观』独立模块已合并", r.worldSectionExists === expect.worldSectionExists],
  ["旧左侧页签导航已移除", r.oldNavItems === expect.oldNavItems],
  ["默认激活第 1 步（世界设定）", r.step0Active === expect.step0Active],
  ["其余步骤页默认隐藏", r.otherPanesHidden === expect.otherPanesHidden],
  ["底部初始显示「下一步」", r.nextVisible === expect.nextVisible],
  ["「确认生成」初始隐藏", r.genHidden === expect.genHidden],
  ["第 1 步显示「取消」", r.cancelVisible === expect.cancelVisible],
  ["参考作品可选提示存在", r.refHint === expect.refHint],
  ["步骤条为 6 步（世界设定/叙事风格/叙事视角/玩法时间/角色资源/确认生成）", stepsOk]
];

let ok = true;
console.log("=== docs/62 创建向导分步向导核验 (" + BASE + ") ===");
for (const [name, pass] of results) {
  console.log((pass ? "✓ " : "✗ ") + name);
  if (!pass) ok = false;
}
if (errs.length) { console.log("页面 JS 错误:\n  " + errs.join("\n  ")); ok = false; }
console.log(ok ? "\n结论：全部通过 ✅" : "\n结论：存在失败项 ❌");
process.exit(ok ? 0 : 1);
