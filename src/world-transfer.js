// ============================================================
// AetherNarrator · world-transfer.js
// 世界（含知识库 lore_kb + 全部设定）导入 / 导出
// 关键点：导出的 pack 内 world 对象形状与运行时完全一致（字段 + 向量），
//         引擎（rag.js / prompt.js）只读 lore_kb JSON，因此零改动。
// 数据仍锁在 app 内（IndexedDB / world JSON）：导入导出是「app 内世界 JSON
// 的打包/解包」，不是真实文件系统 / .md 仓库（坑点2）。
// ============================================================
import { deepClone } from "./utils.js";
import { ensureLoreEmbeddings } from "./rag.js";

const WORLD_PACK_FORMAT = "aether-world";
const WORLD_PACK_VERSION = 1;

// 导出世界为 pack。
// includeEmbeddings=false 时剥离向量（体积小，导入时由 ensureLoreEmbeddings 重算），
// 契合离线/可移植诉求（坑点：embedding 体积）。
export function createWorldPack(world, { includeEmbeddings = true } = {}) {
    if (!world || typeof world !== "object") throw new Error("无效的世界对象");
    const w = deepClone(world);
    // 世界级行为记忆（运行期累积的 behavior_records）不随世界分享，
    // 避免双份真相互相打架（坑点8：状态库不进导入导出）。
    if ("behavior_records" in w) delete w.behavior_records;
    if (!includeEmbeddings && w.lore_kb && Array.isArray(w.lore_kb.snippets)) {
        for (const s of w.lore_kb.snippets) {
            delete s.embedding;
            delete s.embedDim;
            delete s.embedModel;
        }
    }
    return {
        format: WORLD_PACK_FORMAT,
        version: WORLD_PACK_VERSION,
        exported_at: new Date().toISOString(),
        world: w
    };
}

// 解析 pack（支持 JSON 字符串或已解析对象），含 format/version 校验。
export function parseWorldPack(raw) {
    let pack;
    if (typeof raw === "string") {
        try { pack = JSON.parse(raw); }
        catch (e) { throw new Error("文件不是有效的 JSON 文本"); }
    } else {
        pack = raw;
    }
    if (!pack || typeof pack !== "object") throw new Error("世界包格式错误");
    if (pack.format !== WORLD_PACK_FORMAT) throw new Error("不是有效的以太叙事世界包");
    if (pack.version !== WORLD_PACK_VERSION) throw new Error("世界包版本不兼容（需要 v" + WORLD_PACK_VERSION + "）");
    if (!pack.world || typeof pack.world !== "object") throw new Error("世界包缺少 world 数据");
    return pack;
}

// 合并导入到现有 worlds 列表，处理 ID 冲突。
// onConflict: 'rename'(默认,自动改名 _imported_N) | 'replace' | 'skip'
//             | 函数(返回 'replace' | 'rename' | 'skip')
// 返回 { worlds, imported, action, conflictId, needsEmbedding }
export async function mergeWorldPack(existingWorlds, pack, { onConflict = "rename" } = {}) {
    const src = parseWorldPack(pack);
    const world = deepClone(src.world);
    let worlds = Array.isArray(existingWorlds) ? existingWorlds.slice() : [];
    const conflict = worlds.some(w => w.id === world.id);

    let finalWorld = world;
    let action;
    if (conflict) {
        const decision = typeof onConflict === "function" ? onConflict(world) : onConflict;
        if (decision === "skip") {
            return { worlds, imported: null, action: "skipped", conflictId: world.id, needsEmbedding: false };
        } else if (decision === "replace") {
            worlds = worlds.filter(w => w.id !== world.id);
            action = "replaced";
        } else { // rename
            finalWorld = { ...world, id: uniqueWorldId(worlds, world.id) };
            action = "renamed";
        }
    } else {
        action = "added";
    }

    // 兜底字段：世界级行为记忆导入端统一清空（坑点8）
    if (!Array.isArray(finalWorld.behavior_records)) finalWorld.behavior_records = [];

    // 维度校验 + 向量重算（坑点7）：ensureLoreEmbeddings 幂等——
    // 已有匹配维度向量则跳过，缺失/不符才重算（走 Worker，不卡 UI）。
    let needsEmbedding = false;
    if (finalWorld.lore_kb && Array.isArray(finalWorld.lore_kb.snippets) && finalWorld.lore_kb.snippets.length) {
        await ensureLoreEmbeddings(finalWorld.lore_kb);
        // 重算后若仍有缺失（环境不支持 transformers/Worker），标记降级为关键词检索
        needsEmbedding = finalWorld.lore_kb.snippets.some(s => !Array.isArray(s.embedding) || !s.embedding.length);
    }

    worlds.push(finalWorld);
    return { worlds, imported: finalWorld, action, conflictId: conflict ? world.id : null, needsEmbedding };
}

function uniqueWorldId(worlds, baseId) {
    let n = 1;
    let candidate;
    do {
        candidate = `${baseId}_imported_${n}`;
        n++;
    } while (worlds.some(w => w.id === candidate));
    return candidate;
}
