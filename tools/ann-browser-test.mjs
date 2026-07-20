// AetherNarrator · ann-browser-test.mjs（Phase 1 真实浏览器验证）
// 在真实浏览器中 import vendor/ann/hnswlib.js，构建 2000 条 512 维索引，
// 用 ANN 与暴力余弦分别跑 topK，对比重合度。验证修正后的 buildLoreIndex API 真能编译/构建/查询。
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8766;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function browserCandidates() {
    if (process.platform === "win32") {
        return [
            path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
            path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
            path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
            path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
        ];
    }
    return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

const executablePath = browserCandidates().find(c => c && fs.existsSync(c));
if (!executablePath) throw new Error("未找到可用于 ANN 实测的 Edge/Chrome/Chromium");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown" };
const server = http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, BASE_URL).pathname);
        const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep)) throw new Error("越界路径");
        const bytes = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(bytes);
    } catch (_) {
        res.writeHead(404);
        res.end("Not found");
    }
});

async function startServer() {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(PORT, "127.0.0.1", resolve);
    });
    for (let i = 0; i < 10; i++) {
        try { if ((await fetch(BASE_URL)).ok) return; } catch (_) {}
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("本地测试服务器启动超时");
}

let browser;
try {
    await startServer();
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    const consoleMsgs = [];
    page.on("pageerror", e => pageErrors.push(e.message));
    page.on("console", m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
    await page.goto(BASE_URL + "/index.html", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async () => {
     try {
        const ann = await import("/src/ann-index.js");
        const DIM = 512, N = 2000, K = 12;
        // 简易可复现 RNG
        let seed = 123456789;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const mkVec = () => {
            const v = new Array(DIM);
            let norm = 0;
            for (let i = 0; i < DIM; i++) { v[i] = rnd() * 2 - 1; norm += v[i] * v[i]; }
            norm = Math.sqrt(norm) || 1;
            for (let i = 0; i < DIM; i++) v[i] /= norm;
            return v;
        };
        const snips = [];
        for (let i = 0; i < N; i++) snips.push({ id: "s" + i, title: "词条" + i, embedding: mkVec() });

        const t0 = performance.now();
        const idx = await ann.getLoreAnnIndex({ snippets: snips }, "ann_browser_test", { dim: DIM });
        const buildMs = performance.now() - t0;

        // 取 30 个真实片段向量作探针（保证存在强匹配）
        const probeIdx = [];
        for (let i = 0; i < 30; i++) probeIdx.push(Math.floor(rnd() * N));
        let totalHit = 0, totalRecall = 0, minHit = 1;
        const t1 = performance.now();
        for (const pi of probeIdx) {
            const q = snips[pi].embedding;
            const annRes = idx.search(q, K).map(r => r.snippet.id);
            const bf = ann.embeddingRetrieveBruteforce(snips, q, K).map(r => r.snippet.id);
            const set = new Set(bf);
            const hit = annRes.filter(id => set.has(id)).length;
            totalHit += hit;
            totalRecall += hit / K;
            minHit = Math.min(minHit, hit / K);
        }
        const queryMs = (performance.now() - t1) / probeIdx.length;

        return {
            size: idx.size, buildMs: Math.round(buildMs), queryMsPerQuery: Math.round(queryMs * 100) / 100,
            avgHitRate: Math.round((totalHit / (probeIdx.length * K)) * 1000) / 1000,
            avgRecall: Math.round((totalRecall / probeIdx.length) * 1000) / 1000,
            minRecall: Math.round(minHit * 1000) / 1000
        };
     } catch (err) {
        return { __error: String(err && err.stack ? err.stack : err) };
     }
    });

    if (result && result.__error) {
        if (consoleMsgs.length) console.log("页面 console：\n" + consoleMsgs.join("\n"));
        if (pageErrors.length) console.log("页面错误：" + pageErrors.join("；"));
        throw new Error("ANN 浏览器实测失败：\n" + result.__error);
    }
    if (pageErrors.length) throw new Error("浏览器运行错误：" + pageErrors.join("；"));
    console.log("ANN 浏览器实测结果：", JSON.stringify(result, null, 2));
    const ok = result.size === 2000 && result.avgRecall >= 0.95 && result.minRecall >= 0.85;
    if (!ok) throw new Error(`ANN 召回不达标（avgRecall≥0.95? ${result.avgRecall>=0.95}, minRecall≥0.85? ${result.minRecall>=0.85}）`);
    console.log("✅ ANN 浏览器实测通过：2000 条索引构建+查询成功，topK 重合度达标");
} finally {
    if (browser) await browser.close();
    await new Promise(res => server.close(res));
}
