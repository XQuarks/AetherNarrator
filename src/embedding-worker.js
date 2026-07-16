// ============================================================
// AetherNarrator · embedding-worker.js（★ P0-3-E：Web Worker，ESM module worker）
// 在后台线程跑中文 embedding 推理，避免阻塞主线程 UI。
// transformers 运行时以 ESM import 加载（vendor/transformers/transformers.min.js 为单文件 ESM），
// 与页面共用同一模型，保证维度/数值一致。
// ============================================================
// ★ 内置化：transformers 运行时与中文模型随项目发布（vendor/ + models/），
// 不再依赖外部 jsdelivr / HuggingFace，玩家彻底摆脱 CDN 下载失败风险。
import * as transformers from '../vendor/transformers/transformers.min.js';

const EMBED_MODEL = "Xenova/bge-small-zh-v1.5";
// bge 系列官方约定：查询句加检索前缀、文档句不加
const BGE_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";

// 本地模型 + 本地 wasm，禁止远程下载
try {
    const e = transformers.env;
    e.allowRemoteModels = false;                        // 禁止回退到远程下载
    e.localModelPath = "../models";                    // 相对 worker(src/) → 项目根/models/
    if (e.backends && e.backends.onnx && e.backends.onnx.wasm) {
        e.backends.onnx.wasm.wasmPaths = "../vendor/transformers/"; // 与 transformers.min.js 同目录，双保险
    }
} catch (_) { /* env 结构异常时忽略，仍尝试默认同目录加载 */ }

let extractor = null;

async function loadModel() {
    if (!extractor) {
        self.postMessage({ type: "progress", data: "正在加载中文向量模型…" });
        extractor = await transformers.pipeline("feature-extraction", EMBED_MODEL);
    }
}

self.onmessage = async (e) => {
    const msg = e.data || {};
    try {
        if (msg.type === "warmup") {
            await loadModel();
            self.postMessage({ id: msg.id, type: "ready" });
            return;
        }
        const { id, text, isQuery } = msg;
        await loadModel();
        const input = isQuery ? BGE_QUERY_PREFIX + text : text;
        const out = await extractor(input, { pooling: "mean", normalize: true });
        self.postMessage({ id, type: "result", data: Array.from(out.data) });
    } catch (err) {
        const reason = String((err && err.message) || err);
        // warmup 失败也走 error；主线程对无 pending 的 id 会直接忽略
        self.postMessage({ id: msg.id, type: "error", data: reason });
    }
};
