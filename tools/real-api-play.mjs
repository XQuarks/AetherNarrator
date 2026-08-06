// ============================================================
// real-api-play.mjs — 真实 API 端到端走查（找 bug 回归用）
// 用法（Git Bash，key 走环境变量避免落盘/泄密）：
//   AN_API_KEY=sk-xxx node tools/real-api-play.mjs
//   可选：AN_BASE_URL（默认 https://api.deepseek.com） AN_MODEL（默认 deepseek-v4-flash）
//   可选：AN_PORT（默认 8081，被占时顺延 8082…） --headed 显示浏览器窗口
//   可选：--shots=目录 保存截图（默认 <项目根>/_playtest-captures）
// 流程：
//   配 API → 创建向导建世界（真实 LLM 生成）→【生成质量验收（12 项标准 + UI 8 页签 +
//   知识库编辑器条目质量）】→ 进入游玩 → 10 回合对话（每回合用「输入框受理 + 叙事稳定」
//   双信号判定完成；被回合锁拦截时自动等锁释放重发）→ 时间推进检查 → 状态面板
//   → 存档（IDB 验证）→ 回首页读档 → 读档后连续对话
// 全程捕获：pageerror / console.error / 请求失败 / 4xx-5xx / 每次 LLM 请求耗时。
// 结果落盘到 <项目根>/_playtest-report.txt（写盘先于关浏览器，防进程残留丢报告）。
// ============================================================
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(path.join(import.meta.dirname, "noop.js"));
const { chromium } = require("playwright-core");

const ROOT = path.resolve(import.meta.dirname, ".."); // 脚本在 tools/，回到项目根
const PORT = parseInt(process.env.AN_PORT || "8081", 10); // 8081 被占时用 AN_PORT=8082 顺延
const BASE = `http://127.0.0.1:${PORT}`;
const API_KEY = process.env.AN_API_KEY || "";
const BASE_URL = process.env.AN_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.AN_MODEL || "deepseek-v4-flash";
const HEADED = process.argv.includes("--headed");
const SHOTS = (process.argv.find(a => a.startsWith("--shots=")) || "").replace("--shots=", "") || path.join(ROOT, "_playtest-captures");

// ---------- 结果收集 ----------
const results = [];
const issues = []; // { type, msg, at }
const llmCalls = []; // { status, ms, url }
const check = (name, pass, extra = "") => {
    results.push({ name, pass, extra });
    console.log((pass ? "✓ " : "✗ ") + name + (extra ? "  " + extra : ""));
};
const issue = (type, msg, at) => {
    issues.push({ type, msg, at });
    console.log(`  ⚠ [${type}] ${msg}${at ? " @" + at : ""}`);
};

// ---------- 生成质量验收标准（WQ） ----------
// 生成结束后从 IndexedDB 读取 world 对象，逐项核对。任何一项不达标都记为生成质量问题。
function auditWorld(w) {
    const items = [];
    const t = (id, cond, detail) => items.push({ id, pass: !!cond, detail });
    t("WQ1 世界 ID 有效", w && w.id && w.id.length > 0, w?.id || "无");
    t("WQ2 名称/描述非空", w && (w.name || "").trim().length > 0 && (w.desc || "").trim().length > 0, `名 ${(w?.name || "").length} 字`);
    t("WQ3 pov 取值合法", ["solo", "ensemble"].includes(w?.pov), w?.pov || "无");
    const tc = w?.schema?.time_config || null;
    // ★ 修正：era_label 在 day 模式（第N天）允许为空（DEFAULT_TIME_CONFIG 注释明确"可为空"）；仅校验模式合法
    const calModes = ["day", "gregorian", "lunar", "custom_calendar", "none"];
    const clockModes = ["period", "clock", "none"];
    t("WQ4 时间配置完整", !!tc && calModes.includes(tc.calendar_mode) && clockModes.includes(tc.clock_mode),
        tc ? `${tc.era_label || "(无纪元,day模式合法)"} / ${tc.calendar_mode} / ${tc.clock_mode}` : "无 time_config");
    // ★ 修正：initial_state 的时间字段由运行时按 time_config 初始化（startGame），此处仅校验初始状态存在且含基础字段
    const is0 = w?.initial_state;
    t("WQ5 初始状态存在", !!is0 && typeof is0 === "object" && ((is0.name || "").trim() || (is0.background || "").trim()),
        is0 ? `含 ${is0.name ? "姓名" : ""}${is0.background ? "背景" : ""}${(!is0.name && !is0.background) ? "（缺姓名/背景）" : ""}` : "无 initial_state");
    t("WQ6 开场白 ≥100 字", (w?.opening_narrative || "").length >= 100, `${(w?.opening_narrative || "").length} 字`);
    const choices = w?.initial_choices || [];
    t("WQ7 初始选项 2~6 项且每项有文本", choices.length >= 2 && choices.length <= 6 && choices.every(c => (c?.text || "").trim().length > 0),
        `${choices.length} 项`);
    t("WQ8 系统提示词 ≥100 字", (w?.system_prompt || "").length >= 100, `${(w?.system_prompt || "").length} 字`);
    const snips = w?.lore_kb?.snippets || [];
    const snipsValid = snips.every(s => (s?.id || "").trim() && (s?.title || "").trim() && (s?.content || "").trim().length > 10);
    t("WQ9 知识库 ≥5 条且每条 id/标题/内容有效", snips.length >= 5 && snipsValid,
        `${snips.length} 条${snipsValid ? "" : "（存在空条目！）"}`);
    t("WQ10 风格预设生效", !!(w?.style_preset?.short_tag || "").trim(), w?.style_preset?.short_tag || "未套用");
    // ★ 修正：modules 规范形状是对象 {id:{enabled}}（modules.js sanitizeModules），含注册表 14 模块键
    const modKeys = w?.modules && typeof w.modules === "object" && !Array.isArray(w.modules) ? Object.keys(w.modules) : [];
    t("WQ11 玩法模块对象存在", modKeys.length >= 5, `${modKeys.length} 个模块`);
    // ★ 修正：characters 人物卡是"生成后手动/AI 补充"的设计（lore-editors.generateCharactersAI），允许为空数组
    t("WQ12 人物卡数组结构合法", Array.isArray(w?.characters), `${(w?.characters || []).length} 张（空=生成后补，合法）`);
    return items;
}

// 回复文本异常模式（命中即记 bug）
const BAD_PATTERNS = [
    [/^\{[\s\S]*\}$/m, "整段输出 JSON 原文"],
    [/生成失败|请稍后重试|服务器开小差/, "出现失败提示语"],
    [/HTTP [45]\d{2}/, "回复内含 HTTP 错误码"],
    [/^\s*$/, "空回复"]
];
function auditReply(text, len) {
    for (const [re, label] of BAD_PATTERNS) {
        if (re.test(text)) return label;
    }
    if (len < 30) return "回复过短(<30字)";
    return null;
}

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
if (!executablePath) { console.error("✗ 找不到 Edge/Chrome"); process.exit(2); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown", ".wasm": "application/wasm", ".onnx": "application/octet-stream" };
const server = http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, BASE).pathname);
        const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep)) throw new Error("越界");
        const bytes = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(bytes);
    } catch (_) { res.writeHead(404); res.end("Not found"); }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hostOf = u => { try { return new URL(u).host; } catch { return ""; } };
const API_HOST = hostOf(BASE_URL);

async function poll(fn, { timeout = 60000, interval = 1000, desc = "" } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { const v = await fn(); if (v) return v; } catch (_) {}
        await sleep(interval);
    }
    throw new Error("等待超时：" + desc);
}

// 从页面读 IndexedDB 里的世界列表
const readWorldsFromIDB = () => page.evaluate(async () => {
    return await new Promise((resolve) => {
        const req = indexedDB.open("aigame_db", 1);
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
            try {
                const db = req.result;
                const tx = db.transaction("kv", "readonly");
                const get = tx.objectStore("kv").get("aigame_worlds");
                get.onsuccess = () => {
                    try { resolve(JSON.parse(get.result || "[]")); } catch { resolve(null); }
                };
                get.onerror = () => resolve(null);
            } catch { resolve(null); }
        };
    });
});

// 从页面读 IndexedDB 里的存档列表
const readSavesFromIDB = () => page.evaluate(async () => {
    return await new Promise((resolve) => {
        const req = indexedDB.open("aigame_db", 1);
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
            try {
                const db = req.result;
                const tx = db.transaction("kv", "readonly");
                const get = tx.objectStore("kv").get("aigame_saves");
                get.onsuccess = () => {
                    try { resolve(JSON.parse(get.result || "[]")); } catch { resolve(null); }
                };
                get.onerror = () => resolve(null);
            } catch { resolve(null); }
        };
    });
});

// ---------- 主流程 ----------
if (!API_KEY) { console.error("✗ 未设置 AN_API_KEY 环境变量"); process.exit(2); }
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

await new Promise((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve); });
for (let i = 0; i < 10; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch (_) {} await sleep(100); }

let browser;
let page;
try {
    browser = await chromium.launch({ headless: !HEADED, executablePath });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // ---------- 事件监听（找 bug 的核心） ----------
    page.on("pageerror", e => issue("pageerror", e.message, "全局"));
    page.on("console", m => { if (m.type() === "error") issue("console.error", m.text().slice(0, 300)); });
    page.on("requestfailed", r => issue("requestfailed", `${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText || ""}`));
    // LLM 请求发起日志（生成/回合等所有 API 调用，看是否发出、耗时多少）
    page.on("request", r => {
        if (hostOf(r.url()) === API_HOST && r.method() === "POST") {
            console.log(`  ↦ LLM请求发起 ${new Date().toISOString().slice(11, 19)} ${r.url().slice(0, 60)}`);
        }
    });
    page.on("response", r => {
        const u = r.url();
        if (hostOf(u) === API_HOST && r.request().method() === "POST") {
            const ms = r.request().timings ? (r.request().timings().responseEnd || -1) : -1;
            llmCalls.push({ status: r.status(), ms: ms < 0 ? 0 : ms, url: u.slice(0, 100) });
            console.log(`  ↦ LLM响应 ${r.status()} 耗时 ${(ms / 1000).toFixed(1)}s ${u.slice(0, 60)}`);
            if (r.status() >= 400) issue("LLM响应异常", `HTTP ${r.status()} ${u.slice(0, 120)}`);
        } else if (r.status() >= 400) {
            issue("资源响应异常", `HTTP ${r.status()} ${u.slice(0, 120)}`);
        }
    });

    const shot = async name => { try { await page.screenshot({ path: path.join(SHOTS, name + ".png") }); } catch (_) {} };
    const clickAction = async act => { await page.evaluate(a => document.querySelector(`[data-action="${a}"]`)?.click(), act); await sleep(400); };
    // 向导按钮（wzNextBtn/wzSkipBtn/generateWorldBtn）的 data-action 是 wizardNextStep 等，需按 ID 点击
    const clickById = async id => { await page.evaluate(i => document.getElementById(i)?.click(), id); await sleep(400); };
    const fillById = async (id, val) => { await page.fill("#" + id, val); };
    const loadingHidden = () => page.evaluate(() => { const el = document.getElementById("loadingIndicator"); return !el || el.style.display === "none" || getComputedStyle(el).display === "none"; });
    const skipType = async () => { try { await page.evaluate(() => document.querySelector('[data-action="skipTypewriter"]')?.click()); } catch (_) {} };

    console.log("== 0. 打开游戏 ==");
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await sleep(3000); // 等初始化完成（embedding/IndexedDB/事件绑定），避免点击落在初始化尾巴上
    const homeOk = await page.evaluate(() => ({
        btn: document.querySelectorAll('[data-action="showApiModal"]').length,
        title: document.title
    }));
    check("首页渲染正确（以太叙事）", homeOk.btn >= 1 && homeOk.title.includes("以太叙事"), `${homeOk.title} / 按钮 ${homeOk.btn} 个`);

    console.log("== 1. 配置真实 API ==");
    // 弹窗真实可见判定：.show class + 有实际渲染尺寸（fixed 元素的 offsetParent 恒为 null，不能用它判断）
    const modalVisible = id => page.evaluate(i => {
        const el = document.getElementById(i);
        return !!el && el.classList.contains("show") && el.getBoundingClientRect().height > 0;
    }, id);
    // Playwright 原生点击（等待可见可点），比 evaluate click 更真实
    await page.locator('[data-action="showApiModal"]').first().click({ timeout: 10000 });
    await sleep(500);
    let apiOpen = false;
    try {
        await poll(() => modalVisible("apiModal"), { timeout: 10000, interval: 400, desc: "API 弹窗真实可见" });
        apiOpen = true;
    } catch (e) {
        const diag = await page.evaluate(() => {
            const m = document.getElementById("apiModal");
            const b = document.getElementById("baseUrl");
            return {
                apiClass: m ? m.className : "无弹窗元素",
                baseUrl: b ? (b.offsetParent !== null ? "可见" : "不可见") : "无输入框",
                otherShows: Array.from(document.querySelectorAll(".modal-overlay.show")).map(x => x.id)
            };
        });
        issue("API 弹窗未打开", JSON.stringify(diag));
        throw new Error("API 弹窗未打开，流程中止");
    }
    check("API 弹窗打开且输入框可见", apiOpen);
    // #baseUrl 等高级配置藏在 <details class="advanced-details"> 折叠区内，需先展开
    await page.evaluate(() => { const d = document.querySelector(".advanced-details"); if (d) d.setAttribute("open", ""); });
    await sleep(200);
    await fillById("baseUrl", BASE_URL);
    await fillById("apiKey", API_KEY);
    await fillById("modelName", MODEL);
    await shot("01-api-configured");
    await page.evaluate(() => document.querySelector('[data-action="saveApiConfig"]')?.click());
    await sleep(800);
    await clickAction("showApiModal");
    const keySaved = await page.evaluate(() => (document.getElementById("apiKey")?.value || "").length > 8);
    await page.evaluate(() => document.querySelector('[data-action="closeModal"][data-modal="apiModal"]')?.click());
    await sleep(300);
    check("API 配置已保存并回填", keySaved);

    console.log("== 2. 创建向导：新建世界 ==");
    await clickAction("showCreateWorldModal");
    await poll(() => page.evaluate(() => document.querySelector("#createWorldModal .wz-pane.active") !== null), { timeout: 8000, desc: "创建向导打开" });
    const worldName = "真实API走查·" + new Date().toISOString().slice(5, 10);
    await fillById("worldName", worldName);
    await fillById("worldDesc", "一座被永夜笼罩的滨海老城，退潮时海底露出通往旧神的石阶。主角是一名刚调任此地的档案管理员。");
    await clickById("wzNextBtn");
    await sleep(500);
    const step1 = await page.evaluate(() => parseInt(document.querySelector("#createWorldModal .wz-pane.active")?.dataset.step, 10));
    check("名称+描述后可进入第 2 步", step1 === 1, `实际步骤 ${step1}`);

    const templateClicked = await page.evaluate(() => {
        const card = document.querySelector("#styleTemplateGrid [data-action], #styleTemplateGrid .style-card, #styleTemplateGrid [class*='card']");
        if (card) { card.click(); return true; }
        return false;
    });
    if (templateClicked) await sleep(600);
    check("叙事风格模板可点击套用", templateClicked);
    await clickById("wzSkipBtn"); await sleep(300); // →3 视角
    await clickById("wzSkipBtn"); await sleep(300); // →4 玩法时间
    await clickById("wzSkipBtn"); await sleep(300); // →5 角色资源
    await clickById("wzNextBtn"); await sleep(400); // →6 确认生成
    const step5 = await page.evaluate(() => parseInt(document.querySelector("#createWorldModal .wz-pane.active")?.dataset.step, 10));
    check("进入末步「确认生成」", step5 === 5, `实际步骤 ${step5}`);
    await shot("02-wizard-confirm");

    console.log("== 3. 真实生成世界（调用 LLM） ==");
    const genT0 = Date.now();
    await clickById("generateWorldBtn");
    let genDone = false, genErr = "";
    try {
        await poll(async () => page.evaluate(n => {
            const btn = document.getElementById("generateWorldBtn");
            const btnBack = btn && (btn.textContent.includes("确认生成") || btn.disabled === false);
            const modalHidden = document.getElementById("createWorldModal")?.style.display === "none";
            const listHas = Array.from(document.querySelectorAll(".world-card")).some(el => el.textContent.includes(n));
            return (btnBack && modalHidden) || listHas;
        }, worldName), { timeout: 900000, interval: 2000, desc: "世界生成完成" });
        genDone = true;
    } catch (e) { genErr = e.message; }
    check("AI 生成世界完成", genDone, `耗时 ${((Date.now() - genT0) / 1000).toFixed(1)}s${genErr ? "，" + genErr : ""}`);
    await sleep(1500);
    await shot("03-world-created");

    // 找新世界 ID
    const found = await page.evaluate(n => {
        const cards = Array.from(document.querySelectorAll('[data-action="showWorldDetail"]'));
        return cards.find(c => (c.textContent || "").includes(n))?.dataset?.id || null;
    }, worldName);
    check("新世界出现在世界列表", !!found, found || "");
    if (!found) throw new Error("新世界未出现在列表，流程中止");

    console.log("== 4. 生成质量验收（标准 12 项 + UI） ==");
    // 生成后 saveWorlds() 为 fire-and-forget，轮询等待 IndexedDB 落盘
    let wNew = null;
    try {
        await poll(async () => {
            const ws = await readWorldsFromIDB();
            wNew = ws ? ws.find(w => w.id === found) : null;
            return !!wNew;
        }, { timeout: 20000, interval: 800, desc: "IndexedDB 写入新世界" });
    } catch (e) { issue("IndexedDB 读世界失败", e.message); }
    if (!wNew) { issue("IndexedDB 读世界失败", "新世界不在 aigame_worlds 中"); }
    else {
        const audit = auditWorld(wNew);
        for (const a of audit) {
            check("生成验收 " + a.id, a.pass, a.pass ? "" : "✗ " + a.detail);
            if (!a.pass) issue("生成质量", `${a.id} 不达标：${a.detail}`);
        }
        // 抽样知识库条目内容质量（前 3 条）
        const snips = (wNew.lore_kb?.snippets || []).slice(0, 3);
        snips.forEach((s, i) => console.log(`  └ 知识库样本[${i}] ${s.title.slice(0, 24)} | 触发:${(s.activation_keys || []).join("、").slice(0, 24) || "无"} | 内容${s.content.length}字`));
    }

    // UI 验收：世界详情 8 页签
    await page.evaluate(id => { document.querySelector(`[data-action="showWorldDetail"][data-id="${id}"]`)?.click(); }, found);
    await poll(() => page.evaluate(() => document.getElementById("worldDetailModal")?.classList.contains("show")), { timeout: 8000, desc: "世界详情打开" });
    await sleep(600);
    const tabChecks = [
        ["lore", "知识库"],
        ["time", "时间体系"],
        ["characters", "角色"],
        ["variables", "变量"],
        ["items", "物品"],
        ["modules", "模块开关"]
    ];
    for (const [key, label] of tabChecks) {
        await page.evaluate(k => { document.querySelector(`.detail-tab[data-detail-tab="${k}"]`)?.click(); }, key);
        await sleep(350);
        const info = await page.evaluate(k => {
            const c = document.querySelector(`.detail-tab-content[data-detail-tab-content="${k}"]`);
            const stat = c?.querySelector(".stat-num")?.textContent || "";
            const text = (c?.textContent || "").trim();
            const cards = c?.querySelectorAll(".char-card, .char-list > div, .rule-item").length || 0;
            return { stat, len: text.length, cards, text: text.slice(0, 120).replace(/\s+/g, " ") };
        }, key);
        check(`详情页签「${label}」渲染非空`, info.len > 20, `${info.stat ? "条目数 " + info.stat + " · " : ""}${info.cards ? "卡片 " + info.cards + " · " : ""}${info.text.slice(0, 60)}`);
    }
    // 知识库 tab 条目数应与 IndexedDB 一致
    const loreCountUI = await page.evaluate(() => parseInt(document.querySelector('.detail-tab-content[data-detail-tab-content="lore"] .stat-num')?.textContent, 10) || 0);
    const loreCountDB = wNew?.lore_kb?.snippets?.length ?? -1;
    check("知识库条目数与底层数据一致", loreCountUI === loreCountDB, `UI ${loreCountUI} / 数据 ${loreCountDB}`);

    // 打开知识库编辑器：检查条目树渲染与单条内容质量
    await page.evaluate(id => { document.querySelector(`[data-action="editWorldLore"][data-id="${id}"]`)?.click(); }, found);
    await poll(() => page.evaluate(() => document.getElementById("loreReviewModal")?.classList.contains("show")), { timeout: 8000, desc: "知识库编辑器打开" });
    await sleep(800);
    const loreTree = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll("#loreReviewModal .lore-tree-item"));
        return { count: items.length, first: items[0]?.textContent?.replace(/\s+/g, " ").slice(0, 60) || "" };
    });
    check("知识库编辑器条目树渲染", loreTree.count === loreCountDB, `条目 ${loreTree.count} 个${loreTree.first ? " · " + loreTree.first : ""}`);
    await shot("04-lore-editor");
    await page.evaluate(() => document.querySelector('[data-action="closeModal"][data-modal="loreReviewModal"]')?.click());
    await sleep(400);
    await page.evaluate(() => document.querySelector('[data-action="closeModal"][data-modal="worldDetailModal"]')?.click());
    await sleep(500);

    console.log("== 5. 进入世界并开始游玩 ==");
    await page.evaluate(id => { document.querySelector(`[data-action="showWorldDetail"][data-id="${id}"]`)?.click(); }, found);
    await poll(() => page.evaluate(() => document.getElementById("worldDetailModal")?.classList.contains("show")), { timeout: 8000, desc: "世界详情重开" });
    await page.evaluate(() => document.querySelector('#worldDetailModal [data-action="startGame"]')?.click());
    await sleep(800);
    let openingOk = false;
    try {
        await poll(async () => page.evaluate(() => {
            const entries = document.querySelectorAll("#gameLog .log-entry");
            return entries.length >= 1 && (entries[entries.length - 1].querySelector(".narrative")?.textContent || "").trim().length > 20;
        }), { timeout: 180000, interval: 1500, desc: "开局叙事渲染" });
        openingOk = true;
    } catch (e) { issue("开局叙事超时", e.message); }
    check("开局叙事正常渲染", openingOk);
    await skipType(); await sleep(300);
    await shot("05-opening");

    console.log("== 6. 10 回合真实对话 ==");
    const msgs = [
        "我清点了一下随身物品：档案袋、笔记本、怀表、以及一把旧钥匙。我想确认钥匙对应的锁在哪里。",
        "我翻看档案袋里的第一份卷宗，想了解这座城市最近一年发生过的异常事件。",
        "傍晚我去码头找守塔人老陈，问他最近退潮时在海底的石阶上看到过什么。",
        "我按守塔人的指点，去退潮后的浅滩近距离观察那些刻着符号的石阶。",
        "我发现档案里有一份 1907 年的失踪人口报告，决定带着它去找当地警长比对。",
        "回到档案室，我检查自己这几天的精神状态和身体有没有异样。",
        "奔波一天后我决定在码头旅店住一晚，好好休息恢复体力。",
        "睡前我整理这几天的发现，把石阶符号、失踪报告和守塔人的话串起来，写下推断。",
        "夜里我听到窗外传来潮声，似乎有人在低声念着什么——我决定起身查看。",
        "天亮了，我站在窗前看着退潮的海面，规划今天最重要的一步行动。"
    ];
    const dayInfos = [];
    const replyLog = [];
    // ★ 回合发送+完成判定（v3）：输入框被清空 = 回合被受理（被锁拦截时输入框保留，等待后重发）；
    //   受理后等叙事文本长度稳定（连续 3 次 ≈2.4s 不变）= 流式真正打完。
    const sendAndWaitTurn = async (msg, timeout = 240000) => {
        const t0 = Date.now();
        let accepted = false;
        while (Date.now() - t0 < timeout) {
            await page.fill("#playerInput", msg);
            await page.evaluate(() => document.querySelector('[data-action="submitInput"]')?.click());
            try {
                await poll(() => page.evaluate(() => {
                    const el = document.getElementById("playerInput");
                    return el && el.value.trim() === "";
                }), { timeout: 6000, interval: 300, desc: "回合受理" });
                accepted = true;
                break;
            } catch (_) {
                await sleep(2000); // 上一回合仍在生成 → 等锁释放后重发
            }
        }
        if (!accepted) return { ok: false, err: "回合未被受理（锁未释放）" };
        let lastLen = -1, stable = 0;
        while (Date.now() - t0 < timeout) {
            const len = await page.evaluate(() => {
                const entries = document.querySelectorAll("#gameLog .log-entry");
                return (entries[entries.length - 1]?.querySelector(".narrative")?.textContent || "").trim().length;
            });
            const hid = await loadingHidden();
            if (hid && len > 0 && len === lastLen) { stable++; if (stable >= 3) return { ok: true }; }
            else stable = 0;
            lastLen = len;
            await sleep(800);
        }
        return { ok: false, err: "回合完成判定超时" };
    };
    for (let i = 0; i < msgs.length; i++) {
        const t0 = Date.now();
        let ok = false, waitErr = "";
        try {
            const r = await sendAndWaitTurn(msgs[i], 240000);
            ok = r.ok; waitErr = r.err || "";
        } catch (e) { waitErr = e.message; }
        await sleep(400);
        await skipType(); await sleep(200);
        const snap = await page.evaluate(() => {
            const entries = Array.from(document.querySelectorAll("#gameLog .log-entry"));
            const last = entries[entries.length - 1];
            return {
                player: last?.querySelector(".player-text")?.textContent || "",
                narrative: (last?.querySelector(".narrative")?.textContent || "").trim(),
                count: entries.length,
                dayInfo: document.getElementById("gameDayInfo")?.textContent?.replace(/\s+/g, " ") || ""
            };
        });
        const dur = ((Date.now() - t0) / 1000).toFixed(1);
        const len = snap.narrative.length;
        const bad = auditReply(snap.narrative, len);
        check(`回合 ${i + 1}：AI 回复完成且内容正常`, ok && !bad, `耗时 ${dur}s · 回复 ${len} 字${waitErr ? " · " + waitErr : ""}${bad ? " · ⚠ " + bad : ""}`);
        if (bad) issue("回复异常", `回合${i + 1}：${bad}`);
        if (snap.dayInfo) dayInfos.push(snap.dayInfo);
        replyLog.push({ i: i + 1, len, head: snap.narrative.slice(0, 50).replace(/\s+/g, " ") });
        await shot("06-turn-" + (i + 1));
    }
    // 时间推进检查：回合 3 与回合 7（休息跨天）的时间信息应有变化
    if (dayInfos.length >= 7) {
        const t3 = dayInfos[2], t7 = dayInfos[6];
        check("时间系统在游玩中推进（回合3 vs 回合7）", t3 !== t7, `「${t3}」 → 「${t7}」`);
    }
    console.log("  └ 回合回复抽样：");
    replyLog.slice(0, 10).forEach(r => console.log(`     #${r.i} (${r.len}字) ${r.head}`));

    console.log("== 7. 状态面板 ==");
    await clickAction("showStatusPanel");
    await poll(() => page.evaluate(() => document.getElementById("statusPanelModal")?.classList.contains("show") || !!document.querySelector(".status-panel")), { timeout: 8000, desc: "状态面板打开" });
    await sleep(600);
    const panelText = await page.evaluate(() => (document.querySelector(".status-panel")?.textContent || document.getElementById("statusPanelModal")?.textContent || "").slice(0, 200));
    check("角色状态面板渲染非空", panelText.length > 30, panelText.length + " 字");
    await page.evaluate(() => document.querySelector('[data-action="closeStatusPanel"]')?.click() || document.querySelector('[data-action="closeModal"]')?.click());
    await sleep(400);

    console.log("== 8. 存档 + 读档 + 连续性 ==");
    await clickAction("openSaveMenu");
    await poll(() => page.evaluate(() => document.getElementById("saveMenuModal")?.classList.contains("show")), { timeout: 8000, desc: "存档菜单打开" });
    // 每回合结束已自动存档（createOrUpdateSave），此处再手动保存当前档验证按钮功能
    await page.evaluate(() => document.querySelector('[data-action="saveCurrentSlot"]')?.click());
    await sleep(1500);
    // 存档验证从 IndexedDB 读（#saveListContent 只在存档页渲染，游戏界面读不到）
    let saves = [];
    try { await poll(async () => { saves = (await readSavesFromIDB()) || []; return saves.length >= 1; }, { timeout: 15000, interval: 800, desc: "存档落盘" }); }
    catch (_) {}
    check("存档成功（IndexedDB 存档条目）", saves.length >= 1, `存档 ${saves.length} 个`);

    // 回首页 → 打开存档列表页 → 点存档详情 → 继续游戏（loadSave）
    await page.evaluate(() => document.querySelector('[data-action="goHome"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('[data-action="showSaveList"]')?.click());
    await sleep(1000);
    const historyBefore = await page.evaluate(() => document.querySelectorAll("#gameLog .log-entry").length);
    let reloaded = false;
    try {
        await poll(() => page.evaluate(() => document.querySelector("#saveListContent .save-item [data-action='showSaveDetail']") !== null), { timeout: 8000, interval: 400, desc: "存档列表渲染" });
        await page.evaluate(() => document.querySelector("#saveListContent .save-item [data-action='showSaveDetail']")?.click());
        await poll(() => page.evaluate(() => document.getElementById("saveDetailModal")?.classList.contains("show")), { timeout: 8000, interval: 400, desc: "存档详情打开" });
        await page.evaluate(() => document.querySelector('#saveDetailModal [data-action="loadSave"]')?.click());
        reloaded = true;
    } catch (e) { issue("读档失败", e.message); }
    await sleep(2500);
    const historyAfter = await page.evaluate(() => document.querySelectorAll("#gameLog .log-entry").length);
    check("读档后回到游戏并恢复对话历史", reloaded && historyAfter >= historyBefore, `对话条目 ${historyAfter}（读档前 ${historyBefore}）`);
    await shot("07-after-reload");

    // 读档后连续性：再发一条消息（尽力而为；曾出现卡死，整体套 90s 保险，避免拖垮报告生成）
    if (reloaded && historyAfter >= historyBefore) {
        let ok = false, waitErr = "";
        try {
            const r = await Promise.race([
                sendAndWaitTurn("我带上那份 1907 年的报告，动身前往警局。", 60000),
                new Promise(res => setTimeout(() => res({ ok: false, err: "读档后回合超时(90s)" }), 90000))
            ]);
            ok = r.ok; waitErr = r.err || "";
        } catch (e) { waitErr = e.message; }
        await sleep(400);
        try { await skipType(); } catch (_) {}
        await sleep(200);
        const after = await page.evaluate(() => {
            const entries = document.querySelectorAll("#gameLog .log-entry");
            const last = entries[entries.length - 1];
            return { count: entries.length, len: (last?.querySelector(".narrative")?.textContent || "").trim().length };
        });
        check("读档后能继续对话（会话记忆未断）", ok && after.count > historyAfter && after.len > 30,
            `新条目 +${after.count - historyAfter} · 回复 ${after.len} 字${waitErr ? " · " + waitErr : ""}`);
    }

    console.log("\n== 汇总 ==");
    const llmOk = llmCalls.filter(c => c.status >= 200 && c.status < 300);
    const llmFail = llmCalls.filter(c => c.status >= 400);
    console.log(`LLM 调用 ${llmCalls.length} 次：成功 ${llmOk.length}，失败 ${llmFail.length}` +
        (llmOk.length ? `，平均 ${(llmOk.reduce((a, b) => a + b.ms, 0) / llmOk.length / 1000).toFixed(1)}s/次` : ""));
    console.log(`捕获问题 ${issues.length} 条：` + (issues.length ? "" : "无"));
    issues.slice(0, 20).forEach(i => console.log(`  ⚠ [${i.type}] ${i.msg}`));
    if (issues.length > 20) console.log(`  … 其余 ${issues.length - 20} 条略`);

    const failed = results.filter(r => !r.pass);
    console.log(`\n走查结果：${results.length - failed.length}/${results.length} 项通过`);
    if (failed.length) {
        console.log("未通过项：");
        failed.forEach(f => console.log("  ✗ " + f.name + (f.extra && f.extra.startsWith("✗") ? "  " + f.extra : "")));
        process.exitCode = 1;
    }
} finally {
    // ★ 报告落盘必须在关浏览器之前——browser.close() 在页面无响应时可能挂起，先落盘保底（正常/异常路径都写）
    try {
        const ok = llmCalls.filter(c => c.status >= 200 && c.status < 300);
        const L = [];
        L.push("=== AetherNarrator 真实 API 实操走查报告 ===");
        L.push("时间：" + new Date().toLocaleString("zh-CN"));
        L.push(`API: ${BASE_URL} / 模型 ${MODEL}`);
        L.push("");
        L.push(`LLM 调用 ${llmCalls.length} 次：成功 ${ok.length}，失败 ${llmCalls.length - ok.length}` +
            (ok.length ? `，平均 ${(ok.reduce((a, b) => a + b.ms, 0) / ok.length / 1000).toFixed(1)}s/次` : ""));
        llmCalls.forEach((c, i) => L.push(`  #${i + 1} HTTP ${c.status} ${c.ms ? (c.ms / 1000).toFixed(1) + "s" : "?"} ${c.url}`));
        L.push("");
        L.push(`捕获问题 ${issues.length} 条：` + (issues.length ? "" : "无"));
        issues.forEach(i => L.push(`  ⚠ [${i.type}] ${i.msg}${i.at ? " @" + i.at : ""}`));
        L.push("");
        const failed = results.filter(r => !r.pass);
        L.push(`走查结果：${results.length - failed.length}/${results.length} 项通过`);
        results.forEach(r => L.push(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.extra ? "  " + r.extra : ""}`));
        L.push("");
        L.push("失败项：" + (failed.length ? "" : " 无"));
        failed.forEach(f => L.push(`  ✗ ${f.name}${f.extra && f.extra.startsWith("✗") ? "  " + f.extra : ""}`));
        fs.writeFileSync(path.join(ROOT, "_playtest-report.txt"), L.join("\n"), "utf8");
        console.log("\n报告已写入 _playtest-report.txt");
    } catch (e) { console.log("报告写盘失败:", e.message); }
    if (browser) await browser.close().catch(() => {});
    // 强制释放服务器与退出（页面残留流式请求会让 server.close 卡住 → 进程残留）
    try { if (server.closeAllConnections) server.closeAllConnections(); } catch (_) {}
    await new Promise(r => { server.close(r); setTimeout(r, 1500); });
    process.exit(process.exitCode || 0);
}
