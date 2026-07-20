// Phase 4 · 知识图谱浏览器实测：注入含 relations 的世界，打开图谱页签，
// 校验「关系边 + 实体节点 + 图例两组」真实渲染（force-graph 主路径）。
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8766;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PNG = path.join(ROOT, "_kg_graph_preview.png");

const WORLDS = [{
    id: "test_kg", name: "知识图谱测试世界", rules: [], desc: "用于 Phase 4 图谱实测", tags: ["测试"], type: "original",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lore_kb: {
        ip: "测试",
        snippets: [
            { id: "m1", title: "哈利", category: "人物", content: "哈利", links: [{ target: "m2", relation: "related" }],
              relations: [{ from: "哈利", relation: "敌对", to: "伏地魔" }, { from: "哈利", relation: "校友", to: "赫敏" }] },
            { id: "m2", title: "霍格沃茨", category: "地点", content: "霍格沃茨", links: [],
              relations: [{ from: "霍格沃茨", relation: "位于", to: "英国" }] },
            { id: "m3", title: "英国", category: "地点", content: "英国", links: [], relations: [] }
        ]
    }
}];

function browserCandidates() {
    if (process.platform === "win32") {
        return [
            path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
            path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
            path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
        ];
    }
    return ["/usr/bin/google-chrome", "/usr/bin/chromium"];
}
const executablePath = browserCandidates().find(c => c && fs.existsSync(c));
if (!executablePath) throw new Error("未找到可用于测试的 Edge/Chrome");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown" };
const server = http.createServer(async (req, res) => {
    try {
        const name = decodeURIComponent(new URL(req.url, BASE_URL).pathname).replace(/^\/+/, "") || "index.html";
        const file = path.resolve(ROOT, name);
        if (!file.startsWith(ROOT + path.sep)) throw new Error("越界");
        const bytes = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(bytes);
    } catch { res.writeHead(404); res.end("Not found"); }
});

async function startServer() {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve); });
}

let browser;
try {
    await startServer();
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    // 注入含 relations 的世界到 IndexedDB
    await page.evaluate(async (worldsJson) => {
        const open = indexedDB.open("aigame_db", 1);
        await new Promise((res, rej) => {
            open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains("kv")) open.result.createObjectStore("kv"); };
            open.onsuccess = res; open.onerror = () => rej(open.error);
        });
        const db = open.result;
        await new Promise((res, rej) => {
            const tx = db.transaction("kv", "readwrite");
            tx.objectStore("kv").put(worldsJson, "aigame_worlds");
            tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
    }, JSON.stringify(WORLDS));
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.locator('[data-action="showWorldList"]').click();
    await page.locator('[data-action="showWorldDetail"][data-id="test_kg"]').click();
    await page.locator('[data-action="editWorldLore"][data-id="test_kg"]').click();
    await page.locator('.lore-view-tab[data-lore-view="graph"]').click();
    await page.waitForTimeout(1400); // 等 force-graph 渲染 + 引擎稳定

    const stats = (await page.locator("#graphStats").textContent()) || "";
    const legend = (await page.locator("#graphLegend").textContent()) || "";
    const childCount = await page.evaluate(() => document.getElementById("loreGraph").childElementCount);
    await page.screenshot({ path: PNG });

    const statsOk = /5 节点（含 2 实体）· 1 关联 · 3 关系/.test(stats);
    const legendOk = legend.includes("链接") && legend.includes("抽取关系");
    if (!statsOk) throw new Error("graphStats 不符合预期：" + stats);
    if (!legendOk) throw new Error("图例缺少「链接」或「抽取关系」分组：" + legend);
    if (childCount < 1) throw new Error("图谱容器未渲染任何内容");
    if (pageErrors.length) throw new Error("浏览器运行错误：" + pageErrors.join("；"));

    console.log("✅ Phase 4 图谱浏览器实测通过");
    console.log("   graphStats:", stats);
    console.log("   legend 含「链接」「抽取关系」:", legendOk);
    console.log("   loreGraph 子节点数:", childCount, "（force-graph 已渲染）");
    console.log("   截图已保存:", PNG);
} finally {
    if (browser) await browser.close();
    await new Promise(res => server.close(res));
}
