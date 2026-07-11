// ============================================================
// AetherNarrator · store.js（由 app.js 模块化拆分自动生成）
// ============================================================

// 全局可变状态容器（跨模块共享，读写均用 S.xxx）
export const S = {
  gameState: null,
  loreKB: null,
  loreEmbeddings: null,
  activeLoreKB: null,   // ★ B7：当前存档的独立知识库副本（开局时从 world.lore_kb 深拷贝，编辑仅改此副本）
  activeBehaviorRecords: [], // 当前存档的独立行为记忆；世界对象只作旧数据迁移来源
  aiEnhanced: false,    // 当前存档的额外 AI 检查总开关
  conversationHistory: [],
  chatHistory: [],
  chatSummary: [],
  systemPromptTemplate: "",
  cachedSystemPrompt: null,
  cachedSysPromptWorldId: null,
  currentChoices: [],
  embeddingModel: null,
  currentWorld: null,
  worlds: [],
  saves: [],
  currentStatusTab: "profile",
  sourceFileContent: "",
  currentTheme: localStorage.getItem("aigame_theme") || "dark",
  currentSession: { epoch: 0, worldId: null },
  currentAbortController: null,
  isGenerating: false,
  lastCacheStats: { hitTokens: 0, missTokens: 0, totalTokens: 0, hitRate: "0%" },
  debugLog: { sessionStart: new Date().toISOString(), worldCreations: [], turns: [] },
  themeClickCount: 0,
  themeClickTimer: null,
  lastFocusedBeforeModal: null,
  fontSizeSetting: localStorage.getItem("aigame_fontsize") || "normal",
  temperatureSetting: parseFloat(localStorage.getItem("aigame_temperature") || "0.5"),
  renderedEntryCount: 0,
  typingTimer: null,
  typingIndex: -1,
  typingResolver: null,
  _zhSegmenter: null,
  vectorUnavailableWarned: false,
  toastTimer: null,
  loadingStartTime: 0,
  loadingInterval: null,
  _loreEdit: null,   // ★ B3：知识库编辑面板的临时草稿缓冲（取消编辑不影响原数据）
  _restartWorldId: null, // ★ 修复：重新开始确认弹窗暂存目标世界 id（原生 confirm 在沙箱被吞，改用自定义弹窗）
  _loreRevisionBuffer: null, // ★ B5：AI 修订后待审阅的知识库条目缓冲
  lastLoreReviewMsgCount: 0,  // ★ B5：上次回写时的对话条数，用于触发阈值判断
  loreSpoilerHidden: true,     // ★ B8：知识库防剧透——默认隐藏正文，玩家手动解除
};

export const MAX_CHAT_MESSAGES = 40;

export const CHAT_ANCHOR_MSGS = 8;

export const CHAT_RECENT_MSGS = 8;

export const STORAGE_KEYS = {
    config: "aigame_config",
    state: "aigame_state",
    history: "aigame_history",
    chatHistory: "aigame_chathistory",
    chatSummary: "aigame_chat_summary",
    worlds: "aigame_worlds",
    saves: "aigame_saves"
};

export const DEFAULT_PERIOD_ORDER = ["morning", "forenoon", "afternoon", "evening", "night"];

export const MEMORY_TYPES = ["event", "relationship", "item", "discovery", "other"];
export const MEMORY_TYPE_LABELS = { event: "事件", relationship: "关系", item: "物品", discovery: "发现", other: "其他" };

export const LINK_RELATIONS = ["causal", "related", "explains", "contains"];
export const LINK_RELATION_LABELS = { causal: "因果", related: "相关", explains: "解释", contains: "包含" };

export const DEFAULT_PERIOD_LABELS = {
    morning: "早晨", forenoon: "上午", afternoon: "下午", evening: "傍晚", night: "夜晚"
};

// ============================================================
// 时间系统统一配置（E 工作流：纪元 / 历法 / 时钟 / 季节）
// 设计：世界生成时 AI 一次性按 IP 产出 schema.time_config，运行时纯本地渲染，零额外 token。
// ============================================================
export const DEFAULT_TIME_CONFIG = {
    era_label: "",            // 纪元/年份，如「建安十三年」「星际历70498」「明朝末年」，可为空
    calendar_mode: "day",     // day(第N天) | gregorian(月日+星期) | lunar(阴历月日) | custom_calendar(新历法) | none(不显示日期)
    clock_mode: "period",     // period(时段标签) | clock(具体时钟) | none(不显示时刻)
    season: "",               // 春/夏/秋/冬/自定义，可为空，用于驱动节日/氛围（E11）
    show: true,               // 是否展示时间（false 等同 hidden）
    deadlines: []             // 世界级截止 [{id,title,day,period}]（E8）
};

const CALENDAR_MONTH_LEN = 30; // 历法月长，用于把"第 N 天"推导为月/日

// 归一化 time_config，丢弃非法字段，保证后续渲染安全（无 schema 时回退默认）
export function normalizeTimeConfig(raw) {
    const cfg = { ...DEFAULT_TIME_CONFIG, deadlines: [] };
    if (raw && typeof raw === "object") {
        if (typeof raw.era_label === "string") cfg.era_label = raw.era_label.slice(0, 40);
        const calModes = ["day", "gregorian", "lunar", "custom_calendar", "none"];
        if (calModes.includes(raw.calendar_mode)) cfg.calendar_mode = raw.calendar_mode;
        const clkModes = ["period", "clock", "none"];
        if (clkModes.includes(raw.clock_mode)) cfg.clock_mode = raw.clock_mode;
        if (typeof raw.season === "string" && raw.season.trim()) cfg.season = raw.season.slice(0, 10);
        if (typeof raw.show === "boolean") cfg.show = raw.show;
        if (Array.isArray(raw.deadlines)) {
            cfg.deadlines = raw.deadlines.slice(0, 12).map(d => ({
                id: typeof d.id === "string" ? d.id.slice(0, 40) : "",
                title: typeof d.title === "string" ? d.title.slice(0, 60) : "",
                day: typeof d.day === "number" ? d.day : 0,
                period: typeof d.period === "string" ? d.period : ""
            })).filter(d => d.title);
        }
    }
    return cfg;
}

// 把"第 N 天"推导为月/日标签（E3 历法）；monthLen 可配置（默认每月 30 天）
export function calendarLabel(day, mode, monthLen = CALENDAR_MONTH_LEN) {
    const d = Math.max(1, day | 0);
    if (mode === "gregorian") {
        const month = Math.ceil(d / monthLen);
        const date = ((d - 1) % monthLen) + 1;
        const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        const wd = weekdays[(d - 1) % 7];
        return `第${month}月${date}日 · 周${wd}`;
    }
    if (mode === "lunar") {
        const month = Math.ceil(d / monthLen);
        const date = ((d - 1) % monthLen) + 1;
        const num = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
        let dayStr;
        if (date <= 10) dayStr = "初" + num[date - 1];
        else if (date <= 20) dayStr = "十" + num[date - 11];
        else if (date <= 30) dayStr = "廿" + num[date - 21];
        else dayStr = "卅";
        const monthCn = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
        const mCn = monthCn[(month - 1) % 12] || (month + "月");
        return `${mCn}月${dayStr}`;
    }
    if (mode === "custom_calendar") {
        const month = Math.ceil(d / monthLen);
        const date = ((d - 1) % monthLen) + 1;
        return `新月${month}·${date}日`;
    }
    return `第${d}天`;
}

export const MAX_SOURCE_CHARS = 8000;

export const LORE_FULL_THRESHOLD = 12000;

export const SYSTEM_ROLES = new Set([
    "系统", "系统管理员", "架构师", "系统架构师", "开发者", "工程师",
    "管理员", "AI", "人工智能", "root", "Root", "Root Architect",
    "语言模型", "language model", "ChatGPT", "GPT", "Claude", "DeepSeek"
]);

// 现代/科技概念的解锁标签：当世界进入这些时代后，相关概念即被「合法化」。
const MODERN_UNLOCK = ["era_industrial", "era_modern", "era_future"];
// 火器类额外支持「已合法持有火器」(has_firearm) 物品标签解锁
const FIREARM_UNLOCK = ["era_industrial", "era_modern", "era_future", "has_firearm"];

// 默认「禁用概念」词表（A2/A4 世界观守卫）：通用现代/科技概念，适用于奇幻/古代/武侠等世界。
// 每个条目为 { concept, unlockTags }：当 unlockTags 中「任一标签」在游戏状态里处于活跃状态时，该概念被解锁（不再禁用）。
// 标签可由世界 initial_state.tags 设定，也可由 AI 在 state_changes.tags 里 add/remove 动态推进。
// 标签类型示例（三者皆以「激活的标签」表达解锁条件，与具体命名无关）：
//   · 时代  —— era_ancient / era_medieval / era_industrial / era_modern / era_future
//   · 物品  —— has_firearm / has_vehicle …（由背包物品的 item.tags 自动激活）
//   · 人物  —— char:铁匠 / char:科学家 …（由 gameState.present_npcs 自动激活为 char:<姓名>）
// 世界可通过 currentWorld.bannedConcepts（同结构）覆盖；自由度 ≥4 时整体放宽（见 getBannedConcepts）。
export const DEFAULT_BANNED_CONCEPTS = [
    { concept: "手机", unlockTags: MODERN_UNLOCK },
    { concept: "智能手机", unlockTags: MODERN_UNLOCK },
    { concept: "电脑", unlockTags: MODERN_UNLOCK },
    { concept: "计算机", unlockTags: MODERN_UNLOCK },
    { concept: "笔记本", unlockTags: MODERN_UNLOCK },
    { concept: "平板", unlockTags: MODERN_UNLOCK },
    { concept: "电视", unlockTags: MODERN_UNLOCK },
    { concept: "电话", unlockTags: MODERN_UNLOCK },
    { concept: "网络", unlockTags: MODERN_UNLOCK },
    { concept: "互联网", unlockTags: MODERN_UNLOCK },
    { concept: "wifi", unlockTags: MODERN_UNLOCK },
    { concept: "无线网", unlockTags: MODERN_UNLOCK },
    { concept: "汽车", unlockTags: MODERN_UNLOCK },
    { concept: "卡车", unlockTags: MODERN_UNLOCK },
    { concept: "摩托", unlockTags: MODERN_UNLOCK },
    { concept: "高铁", unlockTags: MODERN_UNLOCK },
    { concept: "火车", unlockTags: MODERN_UNLOCK },
    { concept: "地铁", unlockTags: MODERN_UNLOCK },
    { concept: "飞机", unlockTags: MODERN_UNLOCK },
    { concept: "轮船", unlockTags: MODERN_UNLOCK },
    { concept: "坦克", unlockTags: MODERN_UNLOCK },
    { concept: "枪", unlockTags: FIREARM_UNLOCK },
    { concept: "手枪", unlockTags: FIREARM_UNLOCK },
    { concept: "步枪", unlockTags: FIREARM_UNLOCK },
    { concept: "子弹", unlockTags: FIREARM_UNLOCK },
    { concept: "炸弹", unlockTags: MODERN_UNLOCK },
    { concept: "导弹", unlockTags: MODERN_UNLOCK },
    { concept: "卫星", unlockTags: MODERN_UNLOCK },
    { concept: "火箭", unlockTags: MODERN_UNLOCK },
    { concept: "科技", unlockTags: MODERN_UNLOCK },
    { concept: "现代", unlockTags: MODERN_UNLOCK },
    { concept: "公元", unlockTags: MODERN_UNLOCK },
    { concept: "蒸汽机", unlockTags: MODERN_UNLOCK },
    { concept: "电灯", unlockTags: MODERN_UNLOCK },
    { concept: "核电", unlockTags: MODERN_UNLOCK },
    { concept: "核能", unlockTags: MODERN_UNLOCK },
    { concept: "激光", unlockTags: MODERN_UNLOCK },
    { concept: "无人机", unlockTags: MODERN_UNLOCK },
    { concept: "机器人", unlockTags: MODERN_UNLOCK },
    { concept: "芯片", unlockTags: MODERN_UNLOCK },
    { concept: "程序", unlockTags: MODERN_UNLOCK },
    { concept: "软件", unlockTags: MODERN_UNLOCK },
    { concept: "app", unlockTags: MODERN_UNLOCK },
    { concept: "信用卡", unlockTags: MODERN_UNLOCK },
    { concept: "纸币", unlockTags: MODERN_UNLOCK },
    { concept: "银行卡", unlockTags: MODERN_UNLOCK }
];

// 计算当前「活跃的解锁标签」集合：
// = gameState.tags（显式条件标签） ∪ 背包物品自带 tags（item.tags） ∪ 在场角色标签（char:<姓名>）
// 任一处激活，对应概念即解锁。无 gameState 时返回空集（典型于未进入游戏时构建 prompt）。
export function getActiveConditionTags() {
    const tags = new Set();
    const gs = S.gameState;
    if (gs && Array.isArray(gs.tags)) gs.tags.forEach(t => tags.add(t));
    if (gs && Array.isArray(gs.inventory)) {
        for (const it of gs.inventory) {
            if (it && Array.isArray(it.tags)) it.tags.forEach(t => tags.add(t));
        }
    }
    if (gs && Array.isArray(gs.present_npcs)) {
        for (const n of gs.present_npcs) if (n) tags.add("char:" + n);
    }
    return tags;
}

// 获取当前世界「仍被禁用」的概念字符串数组（已解锁的概念不在此列）。
// - 自由度 4–5 级：设计允许自由发挥，返回空（守卫放宽）
// - 世界若配置了 bannedConcepts（同结构）则用世界配置，否则用默认词表
// - 任一 unlockTag 处于活跃状态的概念被解锁；不兼容旧版纯字符串条目（视为永远禁用）
// 注意：本函数依赖当前 gameState 的活跃标签，调用时机应在状态变更之后（A2 在 processTurn 里即如此）。
export function getBannedConcepts() {
    const w = S.currentWorld;
    const freedom = (w && typeof w.plot_freedom === "number") ? w.plot_freedom : 3;
    if (freedom >= 4) return [];
    const list = (w && Array.isArray(w.bannedConcepts) && w.bannedConcepts.length)
        ? w.bannedConcepts
        : DEFAULT_BANNED_CONCEPTS;
    const active = getActiveConditionTags();
    const banned = [];
    for (const entry of list) {
        // 兼容旧格式：纯字符串条目 → 永远禁用
        const concept = (typeof entry === "string") ? entry : (entry && entry.concept);
        if (!concept) continue;
        const unlockTags = (typeof entry === "string") ? [] : (entry && Array.isArray(entry.unlockTags) ? entry.unlockTags : []);
        const unlocked = unlockTags.some(t => active.has(t));
        if (!unlocked) banned.push(concept);
    }
    return banned;
}

// 返回当前世界的原始结构化规则；过滤与解释由 worldview.js 统一完成。
export function getBannedConceptRules() {
    const w = S.currentWorld;
    const freedom = (w && typeof w.plot_freedom === "number") ? w.plot_freedom : 3;
    if (freedom >= 4) return [];
    return (w && Array.isArray(w.bannedConcepts) && w.bannedConcepts.length)
        ? w.bannedConcepts
        : DEFAULT_BANNED_CONCEPTS;
}
