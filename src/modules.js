// ============================================================
// C1 · 模块化世界开关 —— 单一真相源（Registry）
// ------------------------------------------------------------
// 设计目标：把"本世界启用哪些系统"抽象成统一的模块描述对象，集中登记在此表。
// 开关 UI、提示词注入、状态 Tab 显隐、逻辑门禁全部从本表自动派生。
// 以后新增一个可开关系统 = 往 MODULE_REGISTRY 加一条描述，几乎不动业务代码。
//
// 字段说明（每条 module 描述）：
//   id          唯一 ID（存档 / 配置 / 门禁都靠它）
//   name        显示名（UI / 提示词用）
//   desc        一句话描述（UI 用）
//   defaultEnabled  新世界默认是否启用（false = 开箱关闭）
//   core        核心模块：不可由创作者关闭（永远启用）
//   statusTab   启用时在右侧状态栏显示的页签 key（可空 = 不占状态栏）
//   promptFragment(world)  启用时拼进系统提示的行为指令（纯函数，可空）
// ============================================================

// ★ 占位模块（quest / map / schedule）：本期仅登记，不实现业务，
// 用于证明"加新模块 = 加一条描述"的易扩展性；AI 会因它们未启用而少编造相关机制。
export const MODULE_REGISTRY = [
    // —— 核心三件套：永远开启，不可关闭 ——
    { id: "lore", name: "知识库", desc: "世界观设定库（规则/地点/人物/事件/物品/势力/冲突）", defaultEnabled: true, core: true },
    { id: "characters", name: "角色卡", desc: "人物档案与 AI 一致性锚点", defaultEnabled: true, core: true },
    { id: "memory", name: "行为记忆", desc: "AI 自动记录的关键事实（记忆面板可查看/置顶/删除）", defaultEnabled: true, core: true, statusTab: "memory" },

    // —— 默认开启的系统 ——
    { id: "time", name: "时间系统", desc: "年份/纪元/日期/时段的推进与显示", defaultEnabled: true, statusTab: "timeline",
        promptFragment: () => "【时间系统】本世界存在时间推进（年份/纪元/日期/时段），剧情应体现时间流逝、期限与时段变化；你不推进时间，时间就不会变。" },
    { id: "inventory", name: "背包物品", desc: "玩家持有与消耗的物品", defaultEnabled: true, statusTab: "items",
        promptFragment: () => "【背包物品】本世界存在可持有与消耗的物品，物品可作为反复触发的叙事道具。" },
    { id: "goals", name: "目标系统", desc: "玩家目标的追踪、推进与揭示", defaultEnabled: true, statusTab: "goals",
        promptFragment: () => "【目标系统】本世界存在玩家目标（goal），可推进、达成与揭示隐藏目标。" },

    // —— 默认关闭的系统（开箱无数字压力，创作者按需开启）——
    { id: "variables", name: "玩家变量", desc: "数值/文本/开关型变量（如理智/声望）", defaultEnabled: false, statusTab: "variables",
        promptFragment: () => "【玩家变量】本世界追踪玩家变量（数值/文本/开关），剧情推进应体现变量变化。" },
    { id: "affinity", name: "羁绊好感度", desc: "与角色的好感度（bonds）与关系标签", defaultEnabled: false, statusTab: "relations",
        promptFragment: () => "【羁绊好感度】本世界追踪与角色的好感度（bonds 中的 affinity 与关系标签），选项与剧情应反映关系变化。" },
    { id: "skills", name: "技能系统", desc: "技能/功法的习得、运用与成长", defaultEnabled: false, statusTab: "skills",
        promptFragment: () => "【技能系统】本世界存在技能/功法，可在剧情中成长、运用与展现。" },

    // —— 未来占位（本期只登记，不实现业务）——
    { id: "quest", name: "任务系统", desc: "可接取/交付的任务（占位，未实现）", defaultEnabled: false },
    { id: "map", name: "地图系统", desc: "地点与地图探索（占位，未实现）", defaultEnabled: false },
    { id: "schedule", name: "日程系统", desc: "日程与章节化回溯（占位，未实现）", defaultEnabled: false }
];

export function getModuleRegistry() {
    return MODULE_REGISTRY;
}

export function getModuleById(id) {
    return MODULE_REGISTRY.find(m => m.id === id) || null;
}

// 新世界默认开关对象（按注册表 defaultEnabled 生成）
export function defaultModules() {
    const o = {};
    for (const m of MODULE_REGISTRY) o[m.id] = { enabled: m.defaultEnabled !== false };
    return o;
}

// 旧世界迁移 / 读档兜底：确保 world.modules 含全部注册表模块（缺则补默认）。
// 直接写回 world.modules，返回归一后的对象。
export function sanitizeModules(world) {
    if (!world || typeof world !== "object") return {};
    const cur = (world.modules && typeof world.modules === "object") ? world.modules : {};
    const out = defaultModules();
    for (const m of MODULE_REGISTRY) {
        if (cur[m.id] && typeof cur[m.id].enabled === "boolean") {
            out[m.id] = { enabled: cur[m.id].enabled };
        }
    }
    world.modules = out;
    return out;
}

// 统一的门禁判断：所有业务逻辑只问这一个函数。
// 核心模块永远返回 true；world.modules 缺失时回退到注册表 defaultEnabled。
export function isModuleEnabled(world, id) {
    const reg = MODULE_REGISTRY.find(m => m.id === id);
    if (!reg) return false;
    if (reg.core) return true; // 核心模块不可关
    const m = world && world.modules && world.modules[id];
    if (!m) return reg.defaultEnabled !== false;
    return m.enabled !== false;
}

// 已启用模块列表（按注册表顺序）
export function enabledModuleList(world) {
    return MODULE_REGISTRY.filter(m => isModuleEnabled(world, m.id));
}

// 未启用模块显示名（用于提示词约束，告诉 AI 不要自行引入这些机制）
export function disabledModuleNames(world) {
    return MODULE_REGISTRY.filter(m => !isModuleEnabled(world, m.id)).map(m => m.name);
}

// 纯函数：生成"世界模块开关"系统提示段（启用指令 + 未启用约束）。
// 与 DOM 无关，便于单测。prompt.js 直接拼接其返回值。
export function buildModulePromptContext(world) {
    const enabled = enabledModuleList(world);
    const disabled = disabledModuleNames(world);
    let ctx = "\n\n# 世界模块开关\n\n";
    ctx += "本世界已启用的系统：" + (enabled.length ? enabled.map(m => m.name).join("、") : "（无）") + "。\n";
    for (const m of enabled) {
        if (typeof m.promptFragment === "function") {
            const frag = m.promptFragment(world);
            if (frag) ctx += "\n" + frag + "\n";
        }
    }
    if (disabled.length) {
        ctx += "\n以下系统在本世界**未启用**，剧情中不要自行引入相关机制（例如未启用经济/货币类系统则不要编造货币、商店、物价）："
            + disabled.join("、") + "。";
    }
    return ctx;
}
