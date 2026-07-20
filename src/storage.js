// ============================================================
// AetherNarrator · storage.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { STORAGE_KEYS } from "./store.js";
import { deepClone, defaultWorldSchema } from "./utils.js";
import { closeModal, showToast } from "./render.js";
import { parseStoredArray, parseStoredObject } from "./migrations.js";
import { idbGet, idbSet, idbDel } from "./idb.js";
import { PROVIDERS, detectProvider } from "./providers.js";
import { EMBED_MODEL, EMBED_DIM } from "./rag.js";
import { mergeWorldPack } from "./world-transfer.js";
import { createCthulhuWorld, createUrbanLegendWorld } from "./new-worlds.js";

export async function loadConfig() {
    const parsed = parseStoredObject(await idbGet(STORAGE_KEYS.config), {});
    if (!parsed.ok) console.warn("API 配置损坏，已使用默认配置；原 localStorage 未覆盖", parsed.error);
    const cfg = parsed.value;
    document.getElementById("baseUrl").value = cfg.baseUrl || "https://api.deepseek.com";
    document.getElementById("corsProxy").value = cfg.corsProxy || "";
    document.getElementById("apiKey").value = cfg.apiKey || "";
    document.getElementById("modelName").value = cfg.modelName || "deepseek-v4-flash";
    document.getElementById("mockMode").checked = cfg.mockMode === true;
    document.getElementById("noStreamMode").checked = cfg.noStreamMode === true;
    const cc = document.getElementById("chunkConcurrency");
    if (cc) cc.value = (cfg.chunkConcurrency != null) ? cfg.chunkConcurrency : 100;
    const ec = document.getElementById("embedConcurrency");
    if (ec) ec.value = (cfg.embedConcurrency != null) ? cfg.embedConcurrency : 100;
    // 高亮当前模型预设下拉（按存储的 provider 或 baseUrl 自动识别）
    const sel = document.getElementById("providerSelect");
    if (sel) sel.value = cfg.provider || detectProvider(cfg.baseUrl || "");
}

export async function loadWorlds() {
    const data = await idbGet(STORAGE_KEYS.worlds);
    const defaults = [
        createCthulhuWorld(),
        createUrbanLegendWorld()
    ];
    const parsed = parseStoredArray(data, defaults);
    if (!parsed.ok) console.warn("世界数据损坏，已使用安全默认值；原 localStorage 未覆盖", parsed.error);
    // ★ Phase 0：移除 migrateWorldRecord（不兼容旧存档/世界）。仅保留最小形状兜底，读取点已有 undefined 兜底。
    S.worlds = parsed.value.map(w => {
        const out = (w && typeof w === "object") ? w : {};
        if (!Array.isArray(out.behavior_records)) out.behavior_records = [];
        return out;
    });
    // 迁移：删除全部旧的 demo 世界（红楼梦/魔法学院/蒸汽与魔法），注入新世界
    let changed = false;
    const OLD_DEMO_IDS = ["demo_红楼梦", "demo_magic_academy", "demo_蒸汽与魔法"];
    for (const oldId of OLD_DEMO_IDS) {
        if (S.worlds.some(w => w.id === oldId)) {
            S.worlds = S.worlds.filter(w => w.id !== oldId);
            changed = true;
        }
    }
    // 注入新世界
    if (!S.worlds.some(w => w.id === "demo_cthulhu")) {
        S.worlds.push(createCthulhuWorld());
        changed = true;
    }
    if (!S.worlds.some(w => w.id === "demo_urban_legend")) {
        S.worlds.push(createUrbanLegendWorld());
        changed = true;
    }
    if (changed) saveWorlds().catch(() => {});
}

// ★ P0-3-C：默认世界优先用「构建期预计算」的中文向量知识库（data/lore_kb_with_embeddings.json），
// 免去玩家首次进入时的模型下载/推理开销；仅当预计算文件缺失或模型版本不符时，回落到无向量模板（运行时经 Worker 重算）。
function pickDefaultLoreKB() {
    const pre = S.loreEmbeddings;
    if (pre && pre.embedModel === EMBED_MODEL && pre.embedDim === EMBED_DIM && Array.isArray(pre.snippets)) {
        return pre;
    }
    return S.loreKB || { ip: name, snippets: [] };
}

export function createDemoWorld(name, type, desc, tags) {
    return {
        id: "demo_" + name,
        name,
        type,
        desc,
        hero: "",
        createdAt: new Date().toISOString().split("T")[0],
        tags,
        schema: defaultWorldSchema("修仙"),
        initial_state: null,
        lore_kb: deepClone(pickDefaultLoreKB()),
        system_prompt: "",
        behavior_records: [],
        initial_choices: []
    };
}

// 新世界工厂（实现在 new-worlds.js 中）
export { createCthulhuWorld, createUrbanLegendWorld } from "./new-worlds.js";

export async function loadSaves() {
    const data = await idbGet(STORAGE_KEYS.saves);
    const parsed = parseStoredArray(data, []);
    if (!parsed.ok) console.warn("存档数据损坏，已进入空列表兼容模式；原 localStorage 未覆盖", parsed.error);
    const raw = parsed.value;
    // ★ Phase 0：移除 migrateSaveRecord（不兼容旧存档/世界）；prepareSessionFromSave 已对所有字段做 undefined 兜底。
    S.saves = raw;
}

export async function saveWorlds() {
    await idbSet(STORAGE_KEYS.worlds, JSON.stringify(S.worlds));
}

export async function saveSaves() {
    await idbSet(STORAGE_KEYS.saves, JSON.stringify(S.saves));
}

export async function saveState(serialized) {
    // 如果调用方已预序列化，直接使用，避免重复 JSON.stringify
    const stateStr = serialized ? serialized.state : JSON.stringify(S.gameState);
    const historyStr = serialized ? serialized.history : JSON.stringify(S.conversationHistory);
    const chatStr = serialized ? serialized.chatHistory : JSON.stringify(S.chatHistory);
    // 索引数据库写入为异步；idbSet 内部已吞错，调用方可不等待（fire-and-forget）
    await idbSet(STORAGE_KEYS.state, stateStr);
    await idbSet(STORAGE_KEYS.history, historyStr);
    await idbSet(STORAGE_KEYS.chatHistory, chatStr);
    await idbSet(STORAGE_KEYS.chatSummary, JSON.stringify(S.chatSummary));
}

export async function saveConfig() {
    const cfg = {
        baseUrl: document.getElementById("baseUrl").value.trim(),
        corsProxy: document.getElementById("corsProxy").value.trim(),
        apiKey: document.getElementById("apiKey").value.trim(),
        modelName: document.getElementById("modelName").value.trim(),
        mockMode: document.getElementById("mockMode").checked,
        noStreamMode: document.getElementById("noStreamMode").checked,
        chunkConcurrency: (() => { const v = parseInt(document.getElementById("chunkConcurrency").value, 10); return Number.isFinite(v) && v >= 1 ? v : 100; })(),
        embedConcurrency: (() => { const v = parseInt(document.getElementById("embedConcurrency").value, 10); return Number.isFinite(v) && v >= 1 ? v : 100; })(),
        provider: detectProvider(baseUrl)
    };
    await idbSet(STORAGE_KEYS.config, JSON.stringify(cfg));
}

// 模型预设下拉切换时：自动填入对应默认 Base URL 与模型名称
export function applyProviderPreset(key) {
    const p = PROVIDERS[key];
    if (!p) return;
    if (p.defaultBaseUrl) document.getElementById("baseUrl").value = p.defaultBaseUrl;
    if (p.defaultModel) document.getElementById("modelName").value = p.defaultModel;
    saveConfig();
}

export async function saveApiConfig() {
    await saveConfig();
    closeModal("apiModal");
    showToast("API 配置已保存", "success");
}

// 删除世界时，清除该世界对应的当前运行态（主状态/历史/聊天）；fire-and-forget
export function clearCurrentRunState() {
    idbDel(STORAGE_KEYS.state).catch(() => {});
    idbDel(STORAGE_KEYS.history).catch(() => {});
    idbDel(STORAGE_KEYS.chatHistory).catch(() => {});
}

// 导入世界包（字符串或已解析对象）：合并进现有 worlds 并持久化。
// 委托 world-transfer.mergeWorldPack 处理 ID 冲突与维度校验/向量重算。
// 返回 { worlds, imported, action, conflictId, needsEmbedding }。
export async function importWorldPack(raw, options) {
    const result = await mergeWorldPack(S.worlds, raw, options);
    if (result.imported) {
        S.worlds = result.worlds;
        await saveWorlds();
    }
    return result;
}
