// ============================================================
// AetherNarrator · store.js（由 app.js 模块化拆分自动生成）
// ============================================================

// 全局可变状态容器（跨模块共享，读写均用 S.xxx）
// ★ node 环境（如 npm test）无 localStorage，顶层读取需守卫，避免模块加载即崩
const _lsGet = (k, d) => (typeof localStorage !== "undefined" ? (localStorage.getItem(k) ?? d) : d);
export const S = {
  // ===== 分区 A · 运行时状态 runtime（游戏/世界/存档/对话核心数据；高频读写） =====
  gameState: null,
  loreKB: null,
  loreEmbeddings: null,
  activeLoreKB: null,   // ★ B7：当前存档的独立知识库副本（开局时从 world.lore_kb 深拷贝，编辑仅改此副本）
  activeBehaviorRecords: [], // 当前存档的独立行为记忆；世界对象只作旧数据迁移来源
  playerNotes: "", // ★ C4：玩家私人备忘（存档级，不进 world）；每轮注入中部槽位，让 AI 记得玩家意图
  aiEnhanced: false,    // 当前存档的额外 AI 检查总开关
  conversationHistory: [],
  chatHistory: [],
  chatSummary: [],
  // ===== 分区 B · 缓存 cache（提示词缓存/向量/会话统计；避免重复计算 token） =====
  systemPromptTemplate: "",
  cachedSystemPrompt: null,
  cachedSysPromptWorldId: null,
  // ★ Phase 5 L2：角色卡独立缓存断点（与 L1 core / 知识库硬约束段分离）
  cachedCharactersPrompt: null,
  cachedCharactersWorldId: null,
  // ★ Phase 5 L2：知识库硬约束独立缓存断点
  cachedLoreHardPrompt: null,
  cachedLoreHardWorldId: null,
  currentChoices: [],
  embeddingModel: null,
  currentWorld: null,
  worlds: [],
  saves: [],
  // ===== 分区 C · UI / 视图状态（主题/字体/打字机/弹窗焦点/loading） =====
  currentStatusTab: "profile",
  sourceFileContent: "",
  currentTheme: _lsGet("aigame_theme", "dark"),
  currentSession: { epoch: 0, worldId: null },
  currentAbortController: null,
  auxiliaryControllers: new Set(),
  isGenerating: false,
  lastCacheStats: { hitTokens: 0, missTokens: 0, totalTokens: 0, hitRate: "0%" },
  // ===== 分区 D · 调试数据 debug（导出诊断用，不参与玩法） =====
  debugLog: { sessionStart: new Date().toISOString(), worldCreations: [], chunkErrors: [], turns: [] },
  themeClickCount: 0,
  themeClickTimer: null,
  lastFocusedBeforeModal: null,
  fontSizeSetting: _lsGet("aigame_fontsize", "normal"),
  // ★ P0：叙事节奏 / 中文叙事字数 / 阅读速度（全局 UI 偏好，localStorage 持久化，不改存档结构）
  narrativePacing: _lsGet("aigame_pacing", "standard"),   // compact / standard / relaxed
  narrativeLength: _lsGet("aigame_narrlen", "standard"),  // short / standard / long
  readingSpeed: _lsGet("aigame_readspeed", "standard"),  // slow / standard / fast / instant
  renderedEntryCount: 0,
  typingTimer: null,
  typingIndex: -1,
  typingResolver: null,
  _zhSegmenter: null,
  vectorUnavailableWarned: false,
  toastTimer: null,
  loadingStartTime: 0,
  loadingInterval: null,
  // ===== 分区 E · 临时编辑缓冲（知识库/重开草稿；取消不影响原数据） =====
  _loreEdit: null,   // ★ B3：知识库编辑面板的临时草稿缓冲（取消编辑不影响原数据）
  _loreEditingWorldDefault: false,
  _restartWorldId: null, // ★ 修复：重新开始确认弹窗暂存目标世界 id（原生 confirm 在沙箱被吞，改用自定义弹窗）
  _loreRevisionBuffer: null, // ★ B5：AI 修订后待审阅的知识库条目缓冲
  lastLoreReviewMsgCount: 0,  // ★ B5：上次回写时的对话条数，用于触发阈值判断
  loreRequireConfirm: _lsGet("aigame_lore_confirm", "false") === "true", // ★ 知识晋升确认开关：默认关=自动同意+提示；开=弹窗手动确认
};

// Phase 2：规则 DSL 解释器（纯函数，无 store 反向依赖，避免循环引用）
import { evaluateRules, legacyBanEntry } from "./worldview.js";
import { validateStartDate, clampSyncRules } from "./calendar.js";
import { detectIp, matchKnownIp } from "./utils.js";

// ★ B7：读取当前生效知识库——优先当前存档的独立副本（不污染 world 出厂默认）。
// 纯状态读取器，原在 rag.js；移入 store 以打破 rag↔prompt 循环依赖（docs/34 #1）。
export function getWorldLoreKB() {
    return S.activeLoreKB || (S.currentWorld && S.currentWorld.lore_kb) || S.loreKB;
}

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
// 时间系统统一配置（E 工作流：纪元 / 历法 / 时钟）
// 设计：世界生成时 AI 一次性按 IP 产出 schema.time_config，运行时纯本地渲染，零额外 token。
// ============================================================
export const DEFAULT_TIME_CONFIG = {
    era_label: "",            // 纪元/年份，如「建安十三年」「星际历70498」「明朝末年」，可为空
    calendar_mode: "day",     // day(第N天) | gregorian(月日+星期) | lunar(阴历月日) | custom_calendar(新历法) | none(不显示日期)
    calendar_start: null,     // 本模式独立起始日 {year,month,date}（gregorian/lunar/custom 用；day/none 为 null）—— 方案 B：消除「day:32 像跑了32天」
    custom_calendar: null,    // 自定义历法月历表 {label, months:[{name,days}]}
    mode: "single",           // single | multiverse（Phase 2 双世界穿梭）
    timelines: null,          // {<id>:{calendar_mode,calendar_start,current_date,...}}（multiverse 用，Phase 2 细化）
    clock_mode: "period",     // period(时段标签) | clock(具体时钟) | none(不显示时刻)
    weather: "",              // 当前天气，可随剧情变化
    show: true,               // 是否展示时间（false 等同 hidden）
    default_timetravel_strategy: "keep", // 世界级默认时间穿越策略（keep=保留记录 S1 / reset=重置回放 S3 / branch=分支隔离 S4）
    deadlines: []             // 世界级截止（方案 B：dated 模式用 {year,month,date,period}；day 模式用 {step,period}）
};

const CALENDAR_MONTH_LEN = 30; // 历法月长，用于把"第 N 天"推导为月/日

// S5-2 必带字段保底：dated 模式(公历/阴历)必须带起点；自定义历法必须带月历表；否则回退「第 N 天」模式。
// 仅在 normalizeTimeConfig 内对顶层 time_config 调用（不进 timeline 内部——线的 current_date 由 ensureTimelineState 保证，不会静默 year-1）。
function enforceTimeConfigRequired(cfg) {
    // 方案 22：gregorian/lunar 允许 calendar_start 为 null 或只含部分字段（纪元-only 世界），
    // 不再因缺 calendar_start 强制回退 day 模式；仅自定义历法缺月历表时才回退。
    if (cfg.calendar_mode === "custom_calendar" && !cfg.custom_calendar) {
        cfg.calendar_mode = "day";
        cfg.custom_calendar = null;
    }
    return cfg;
}

// 归一化 time_config，丢弃非法字段，保证后续渲染安全（无 schema 时回退默认）
export function normalizeTimeConfig(raw) {
    const cfg = { ...DEFAULT_TIME_CONFIG, deadlines: [] };
    if (raw && typeof raw === "object") {
        if (typeof raw.era_label === "string") cfg.era_label = raw.era_label.slice(0, 40);
        const calModes = ["day", "gregorian", "lunar", "custom_calendar", "none"];
        if (calModes.includes(raw.calendar_mode)) cfg.calendar_mode = raw.calendar_mode;
        // 方案 22：calendar_start 各字段独立可选（年/月/日均可缺），仅保留存在的字段；并做日期合法性校验+自动纠正
        if (raw.calendar_start && typeof raw.calendar_start === "object") {
            const cs = {};
            if (Number.isFinite(raw.calendar_start.year)) cs.year = raw.calendar_start.year | 0;
            if (Number.isFinite(raw.calendar_start.month)) cs.month = Math.min(12, Math.max(1, raw.calendar_start.month | 0));
            if (Number.isFinite(raw.calendar_start.date)) cs.date = Math.max(1, raw.calendar_start.date | 0);
            if (Object.keys(cs).length > 0) {
                cfg.calendar_start = validateStartDate(cs, cfg.calendar_mode, cfg.era_label).corrected || cs;
            } else {
                cfg.calendar_start = null;
            }
        }
        // 自定义历法月历表
        if (raw.custom_calendar && Array.isArray(raw.custom_calendar.months) && raw.custom_calendar.months.length) {
            cfg.custom_calendar = {
                label: typeof raw.custom_calendar.label === "string" ? raw.custom_calendar.label.slice(0, 20) : "",
                months: raw.custom_calendar.months.slice(0, 24).map(m => ({
                    name: String(m && m.name != null ? m.name : "").slice(0, 10),
                    days: Math.min(400, Math.max(1, (m && m.days) | 0))
                }))
            };
        }
        // 多世界穿梭（Phase 2）：仅当 mode 为 multiverse 时保留 timelines / active_timeline
        if (raw.mode === "multiverse") {
            cfg.mode = "multiverse";
            if (raw.timelines && typeof raw.timelines === "object") {
                const calModes = ["day", "gregorian", "lunar", "custom_calendar", "none"];
                const norm = {};
                for (const [id, line] of Object.entries(raw.timelines)) {
                    const l = line && typeof line === "object" ? line : {};
                    const nl = {
                        name: typeof l.name === "string" ? l.name.slice(0, 30) : id,
                        calendar_mode: calModes.includes(l.calendar_mode) ? l.calendar_mode : "day",
                        // 方案 22：时间线 calendar_start 同样支持部分字段 + 校验自动纠正
                        calendar_start: (l.calendar_start && typeof l.calendar_start === "object")
                            ? (() => {
                                const tcs = {};
                                if (Number.isFinite(l.calendar_start.year)) tcs.year = l.calendar_start.year | 0;
                                if (Number.isFinite(l.calendar_start.month)) tcs.month = Math.min(12, Math.max(1, l.calendar_start.month | 0));
                                if (Number.isFinite(l.calendar_start.date)) tcs.date = Math.max(1, l.calendar_start.date | 0);
                                return (Object.keys(tcs).length > 0) ? (validateStartDate(tcs, l.calendar_mode, l.era_label).corrected || null) : null;
                            })()
                            : null,
                        current_date: (l.current_date && typeof l.current_date === "object") ? l.current_date : null,
                        era_label: typeof l.era_label === "string" ? l.era_label.slice(0, 40) : "",
                        weather: typeof l.weather === "string" ? l.weather.slice(0, 20) : ""
                    };
                    // UI-3：流速比同步规则（格式校验；ref 存在性由 clampSyncRules 统一过滤）
                    if (Array.isArray(l.sync_rules)) {
                        nl.sync_rules = l.sync_rules
                            .filter(r => r && typeof r.ref === "string" && r.ref.trim() && Number.isFinite(r.ratio) && r.ratio > 0)
                            .map(r => ({ ref: r.ref.trim().slice(0, 30), ratio: r.ratio }));
                    }
                    // UI-4：线级默认穿越策略（缺省无，回落世界级）
                    if (l.timetravel_strategy === "keep" || l.timetravel_strategy === "reset" || l.timetravel_strategy === "branch") {
                        nl.timetravel_strategy = l.timetravel_strategy;
                    }
                    if (l.custom_calendar && Array.isArray(l.custom_calendar.months) && l.custom_calendar.months.length) {
                        nl.custom_calendar = {
                            label: typeof l.custom_calendar.label === "string" ? l.custom_calendar.label.slice(0, 20) : "",
                            months: l.custom_calendar.months.slice(0, 24).map(m => ({ name: String(m && m.name != null ? m.name : "").slice(0, 10), days: Math.min(400, Math.max(1, (m && m.days) | 0)) }))
                        };
                    }
                    norm[id] = nl;
                }
                cfg.timelines = norm;
            }
            // S5-2 保底：双界必须带 timelines；active 线必须指向存在的线，否则取第一条
            if (!cfg.timelines || !Object.keys(cfg.timelines).length) {
                cfg.mode = "single";
                cfg.timelines = null;
                cfg.active_timeline = null;
            } else if (!raw.active_timeline || !cfg.timelines[raw.active_timeline]) {
                cfg.active_timeline = Object.keys(cfg.timelines)[0];
            } else {
                cfg.active_timeline = raw.active_timeline;
            }
        }
        clampSyncRules(cfg); // UI-3：过滤 timelines 内无效的 sync_rules（ref 不存在/自指/ratio<=0）
        const clkModes = ["period", "none"]; // 仅允许「时段标签」或「不显示」；禁用「具体时钟」以免界面出现具体小时
        if (clkModes.includes(raw.clock_mode)) cfg.clock_mode = raw.clock_mode;
        if (typeof raw.weather === "string" && raw.weather.trim()) cfg.weather = raw.weather.slice(0, 20);
        if (typeof raw.show === "boolean") cfg.show = raw.show;
        // UI-4：世界级默认时间穿越策略（缺省 keep）
        if (raw.default_timetravel_strategy === "keep" || raw.default_timetravel_strategy === "reset" || raw.default_timetravel_strategy === "branch") cfg.default_timetravel_strategy = raw.default_timetravel_strategy;
        if (Array.isArray(raw.deadlines)) {
            cfg.deadlines = raw.deadlines.slice(0, 12).map(d => {
                const out = {
                    id: typeof d.id === "string" ? d.id.slice(0, 40) : "",
                    title: typeof d.title === "string" ? d.title.slice(0, 60) : "",
                    day: typeof d.day === "number" ? d.day : 0,
                    period: typeof d.period === "string" ? d.period : "",
                    year: typeof d.year === "number" ? d.year : null,
                    month: typeof d.month === "number" ? Math.min(12, Math.max(1, d.month)) : null,
                    date: typeof d.date === "number" ? Math.max(1, d.date) : null
                };
                // S3-1：重触发策略（默认 once；repeatable 可带 max_repeats/cooldown_steps，0 或缺失=不限次）
                if (d.retrigger_policy && typeof d.retrigger_policy === "object" && d.retrigger_policy.mode === "repeatable") {
                    out.retrigger_policy = {
                        mode: "repeatable",
                        max_repeats: Number.isFinite(d.retrigger_policy.max_repeats) ? Math.max(1, d.retrigger_policy.max_repeats) : 0,
                        cooldown_steps: Number.isFinite(d.retrigger_policy.cooldown_steps) ? Math.max(0, d.retrigger_policy.cooldown_steps) : 0
                    };
                } else {
                    out.retrigger_policy = "once";
                }
                return out;
            }).filter(d => d.title);
        }
    }
    // S5-2 必带字段保底（顶层）：dated 模式须带起点、自定义历法须带月历表，否则回退「第 N 天」
    enforceTimeConfigRequired(cfg);
    return cfg;
}

// UI-5：归一化单条事件的重触发策略（S1/S2）。
//   "once"（默认）/ {mode:"repeatable",max_repeats,cooldown_steps}（max_repeats=0 表示不限次）。
// 与 normalizeTimeConfig 内 deadlines 的 retrigger_policy 归一化一致，供事件/截止编辑器复用与单测。
export function normalizeRetriggerPolicy(p) {
    if (p && typeof p === "object" && p.mode === "repeatable") {
        return {
            mode: "repeatable",
            max_repeats: Number.isFinite(p.max_repeats) ? Math.max(1, p.max_repeats | 0) : 0,
            cooldown_steps: Number.isFinite(p.cooldown_steps) ? Math.max(0, p.cooldown_steps | 0) : 0
        };
    }
    return "once";
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

// ★ Plan A：全书分块抽取知识库——放宽源文件截断上限。
// 12M 字符 ≈ 远超 20MB 上传上限可提取的文本量，确保全书原文能进入分块流程（不再只截前 8000 字）。
export const MAX_SOURCE_CHARS = 12000000;

export const LORE_FULL_THRESHOLD = 12000;

export const SYSTEM_ROLES = new Set([
    "系统", "系统管理员", "架构师", "系统架构师", "开发者", "工程师",
    "管理员", "AI", "人工智能", "root", "Root", "Root Architect",
    "语言模型", "language model", "ChatGPT", "GPT", "Claude", "DeepSeek"
]);

// 现代/科技概念的解锁标签：当世界进入这些时代后，相关概念即被「合法化」。
const MODERN_UNLOCK = ["era_industrial", "era_modern", "era_future"];
// 火器按「时期 / 现代」拆分两套解锁标签，让规则守卫能区分左轮（1920 合理）与 AK-47（现代不应出现）。
// · 时期火器：左轮 / 手枪 / 栓动步枪 / 猎枪 / 火枪等 1900 前后合理的武器，解锁标签 has_firearm
//   （也可由 era_industrial+ 时代标签解锁）。
// · 现代火器：突击步枪 / 自动步枪 / 冲锋枪 / 机枪 / 加特林等，解锁标签 has_modern_firearm
//   （也可由 era_modern/era_future 解锁）。
// 两者不互相包含：持有左轮（has_firearm）不会放行 AK-47（需 has_modern_firearm）。
const PERIOD_FIREARM_UNLOCK = ["era_industrial", "era_modern", "era_future", "has_firearm"];
const MODERN_FIREARM_UNLOCK = ["era_modern", "era_future", "has_modern_firearm"];

// 时期火器关键词：背包物品名称命中任一即自动激活 has_firearm。
// 注意：不含单字「枪」，避免「冲锋枪/机枪」被误判为时期火器；纯拉丁写法（如 AK-47）无法命中，交由 A7 语义兜底。
const PERIOD_FIREARM_KEYWORDS = ["左轮", "手枪", "火枪", "猎枪", "霰弹枪", "栓动", "步枪", "子弹", "弹药", "火器"];
// 现代火器关键词：背包物品名称命中任一即自动激活 has_modern_firearm。
const MODERN_FIREARM_KEYWORDS = ["冲锋枪", "机枪", "突击步枪", "自动步枪", "加特林"];

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
    // —— 火器按「时期 / 现代」拆分：移除单字「枪」，避免含「枪」的现代武器被泛放行 ——
    { concept: "手枪", unlockTags: PERIOD_FIREARM_UNLOCK },
    { concept: "左轮", unlockTags: PERIOD_FIREARM_UNLOCK },
    { concept: "霰弹枪", unlockTags: PERIOD_FIREARM_UNLOCK },
    { concept: "火枪", unlockTags: PERIOD_FIREARM_UNLOCK },
    { concept: "子弹", unlockTags: PERIOD_FIREARM_UNLOCK },
    { concept: "突击步枪", unlockTags: MODERN_FIREARM_UNLOCK },
    { concept: "自动步枪", unlockTags: MODERN_FIREARM_UNLOCK },
    { concept: "冲锋枪", unlockTags: MODERN_FIREARM_UNLOCK },
    { concept: "机枪", unlockTags: MODERN_FIREARM_UNLOCK },
    { concept: "加特林", unlockTags: MODERN_FIREARM_UNLOCK },
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
            // ★ 系统性修复（按时期/现代拆分）：背包持有名称含时期火器 → 自动激活 has_firearm；
            //   含现代火器 → 自动激活 has_modern_firearm。现代火器优先（如「突击步枪」含「步枪」但属现代），
            //   只激活 has_modern_firearm、不误激活 has_firearm，使左轮解锁但不放行 AK-47。
            //   覆盖内置世界（克苏鲁左轮手枪漏打标签）与 AI 生成世界的初始物品，现有存档无需重开。
            if (it && typeof it.name === "string") {
                if (MODERN_FIREARM_KEYWORDS.some(k => it.name.includes(k))) {
                    tags.add("has_modern_firearm");
                } else if (PERIOD_FIREARM_KEYWORDS.some(k => it.name.includes(k))) {
                    tags.add("has_firearm");
                }
            }
        }
    }
    if (gs && Array.isArray(gs.present_npcs)) {
        for (const n of gs.present_npcs) if (n) tags.add("char:" + n);
    }
    return tags;
}

// 获取当前世界「仍被禁用」的概念字符串数组（已解锁的概念不在此列）。
// ★ A2 #5：从世界派生"当前禁项概念"列表（供 prompt 禁律段 + worldview 守卫）。
// 来源：① 旧版 world.bannedConcepts（兼容历史世界）② world.rules 里的 ban 类型规则（玩家可编辑的主来源）。
// 解锁语义（与旧 getBannedConcepts 一致）：条目带 unlockTags 时，仅当"任一解锁标签处于活跃"才放行（不禁用）；
//   不带 unlockTags 或标签未活跃 → 禁用。不再包含全局 DEFAULT_BANNED_CONCEPTS。
function collectBannedConcepts(world, activeTags) {
    const set = new Set();
    const out = [];
    const push = (concept, unlockTags) => {
        const c = (concept == null ? "" : String(concept)).trim();
        if (!c || set.has(c)) return;
        const ut = Array.isArray(unlockTags) ? unlockTags : [];
        // 解锁语义（与旧 getBannedConcepts 一致）：仅当"带解锁标签且任一标签活跃"才放行（不禁用）；
        //   无解锁标签（默认禁用）或标签未活跃 → 禁用。
        const released = ut.length > 0 && activeTags && ut.some(t => activeTags.has(t));
        if (released) return;
        set.add(c);
        out.push(c);
    };
    if (world && Array.isArray(world.bannedConcepts)) {
        for (const e of world.bannedConcepts) {
            const concept = typeof e === "string" ? e : (e && e.concept);
            const ut = typeof e === "string" ? [] : (e && Array.isArray(e.unlockTags) ? e.unlockTags : []);
            push(concept, ut);
        }
    }
    if (world && Array.isArray(world.rules)) {
        for (const r of world.rules) {
            if (!r || r.enabled === false) continue;
            const then = r.then;
            if (then && then.type === "ban" && then.concept) push(then.concept, then.unlockTags);
        }
    }
    return out;
}

// - 自由度 4–5 级：设计允许自由发挥，返回空（守卫放宽）
// - ★ A2 #5：去掉全局 DEFAULT_BANNED_CONCEPTS 强加；禁项来自 world.rules 的 ban 规则 + 旧 world.bannedConcepts
export function getBannedConcepts() {
    const w = S.currentWorld;
    const freedom = (w && typeof w.plot_freedom === "number") ? w.plot_freedom : 3;
    if (freedom >= 4) return [];
    return collectBannedConcepts(w, getActiveConditionTags());
}

// 返回当前世界「仍被禁用」的概念规则数组（喂给 worldview 守卫）。
// - 自由度 4–5 级：设计允许自由发挥，返回空（守卫放宽）
// - 旧版 bannedConcepts 优先（与旧行为一致），DSL 里的 ban 规则叠加其上
// - 既无 bannedConcepts 又无 DSL ban 规则时，用默认词表
// - 解释执行由 worldview.evaluateRules 统一完成
export function getBannedConceptRules() {
    const w = S.currentWorld;
    if (!w) return [];
    const freedom = (typeof w.plot_freedom === "number") ? w.plot_freedom : 3;
    if (freedom >= 4) return [];
    const ev = evaluateRules(w, S.gameState);
    // ★ A2 #5：去掉全局 DEFAULT_BANNED_CONCEPTS 回退。ev.bannedConcepts 已含 rules 的 ban 规则 + 旧 bannedConcepts（worldview.evaluateRules 合并）。
    return ev.bannedConcepts;
}

// ★ A2：统一"权威设定"模型的最小初始化（不破坏既有字段）
export function ensureWorldCanon(world) {
    if (!world || typeof world !== "object") return;
    if (!world.canon || typeof world.canon !== "object") {
        world.canon = {
            mode: (world.ip_name || world.type === "ip") ? "ip_adaptation" : "original",
            ip_name: world.ip_name || null,
            source: "none",
            detected: [],
            key_divergences: "",
            consistency_pack: null,
            pack_source: null
        };
    }
    const c = world.canon;
    if (c.mode == null) c.mode = (c.ip_name || world.type === "ip") ? "ip_adaptation" : "original";
    if (c.source == null) c.source = "none";
    if (!Array.isArray(c.detected)) c.detected = [];
    if (typeof c.key_divergences !== "string") c.key_divergences = "";
    if (c.consistency_pack === undefined) c.consistency_pack = null;
    if (c.pack_source === undefined) c.pack_source = null;
    return c;
}

// ★ B1：人物卡模型兜底——保证 world.characters 始终是数组（与 ensureWorldCanon 同族）。
// 每张卡字段见 docs/30_B1人物卡方案.md；只保证数组存在，不覆盖已有内容。
export function ensureWorldCharacters(world) {
    if (!world || typeof world !== "object") return;
    if (!Array.isArray(world.characters)) world.characters = [];
    // 兜底单张卡的必要字段（id / role），避免脏数据导致 UI / 注入崩溃
    world.characters = world.characters.filter(c => c && typeof c === "object").map((c, i) => {
        if (typeof c.id !== "string" || !c.id) c.id = "c" + Date.now().toString(36) + "_" + i;
        if (c.role !== "protagonist" && c.role !== "npc") c.role = c.role || "npc";
        // ★ B4：兜底 affinity / rel_tags，避免脏数据导致 UI / 注入崩溃
        if (typeof c.affinity !== "number" || !isFinite(c.affinity)) c.affinity = 0;
        else c.affinity = Math.max(-100, Math.min(100, c.affinity));
        if (!Array.isArray(c.rel_tags)) c.rel_tags = [];
        return c;
    });
    return world.characters;
}

// ★ B1：新建一张空白人物卡（供编辑器「＋ 添加角色」使用）。
export function defaultCharacter(role) {
    return {
        id: "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        role: role === "protagonist" ? "protagonist" : "npc",
        name: "",
        identity: "",
        gender_age: "",
        appearance: "",
        personality: "",
        motivation: "",
        relationship: "",
        attitude: "",
        current_state: "",
        voice: "",
        untouchable: "",
        notes: "",
        affinity: 0,        // ★ B4：初始好感度（NPC 对主角），-100~100，默认 0；主角卡忽略
        rel_tags: []        // ★ B4：关系标签，如 ["盟友","宿敌"]
    };
}

// ============================================================
// ★ B4 羁绊 / 好感度（数值层叠加在 B1 文字关系层之上；可选默认零压力）
// - 运行时 bonds：{ [npcName]: { affinity:number, tags:string[], desc:string } }，按 NPC 名索引
//   （与 S.gameState.relationships 一致用名字，AI 天然给名字、免 id 映射）
// - 创作层：人物卡加 affinity / rel_tags（defaultCharacter 已含默认）
// - AI 通过 state_changes.bonds 返回相对 delta，applyStateChanges 累加
// ============================================================

// 由世界定义初始化好感度 map（仅新游戏 startGame 调用，不用于读旧档 → 不兼容旧档）
export function initBondsFromWorld(world) {
    const bonds = {};
    const chars = (world && Array.isArray(world.characters)) ? world.characters : [];
    for (const c of chars) {
        if (!c || c.role === "protagonist") continue;
        const name = (typeof c.name === "string" && c.name.trim()) ? c.name.trim() : null;
        if (!name) continue;
        const aff = (typeof c.affinity === "number" && isFinite(c.affinity)) ? Math.max(-100, Math.min(100, c.affinity)) : 0;
        bonds[name] = {
            affinity: aff,
            tags: Array.isArray(c.rel_tags) ? c.rel_tags.filter(t => typeof t === "string") : [],
            desc: (typeof c.relationship === "string") ? c.relationship : ""
        };
    }
    // 预设 NPC 常写在 initial_state.relationships（文字层）：新游戏一并纳入 bonds，
    // 使好感可从 0 起演化；若同名已在 characters 中则不被覆盖。
    const rels = (world && world.initial_state && world.initial_state.relationships && typeof world.initial_state.relationships === "object")
        ? world.initial_state.relationships : {};
    for (const [name, desc] of Object.entries(rels)) {
        if (!bonds[name]) bonds[name] = { affinity: 0, tags: [], desc: (typeof desc === "string") ? desc : "" };
    }
    return bonds;
}

// 纯函数：按 AI 返回的 state_changes.bonds 计算下一帧 bonds。
// - delta：相对变化（±），累加并夹取 [-100, 100]
// - tags：合并去重
// - desc：可选，更新该 NPC 关系文字描述（同时回写 S.gameState.relationships）
// 返回 { next, applied }，applied 为变化清单（供手记 / 本回合变化渲染）
export function computeBondUpdates(changes, currentBonds) {
    const cur = (currentBonds && typeof currentBonds === "object" && !Array.isArray(currentBonds)) ? { ...currentBonds } : {};
    const applied = [];
    if (changes && typeof changes === "object" && !Array.isArray(changes)) {
        for (const [name, upd] of Object.entries(changes)) {
            if (!upd || typeof upd !== "object") continue;
            const prev = cur[name] || { affinity: 0, tags: [], desc: "" };
            let affinity = (typeof prev.affinity === "number" && isFinite(prev.affinity)) ? prev.affinity : 0;
            let deltaApplied = false;
            if (typeof upd.delta === "number" && isFinite(upd.delta)) {
                affinity = Math.max(-100, Math.min(100, affinity + upd.delta));
                applied.push({ name, delta: upd.delta, affinity });
                deltaApplied = true;
            }
            let tags = Array.isArray(prev.tags) ? prev.tags.slice() : [];
            if (Array.isArray(upd.tags)) {
                for (const t of upd.tags) {
                    if (typeof t === "string" && t.trim() && !tags.includes(t)) tags.push(t);
                }
            }
            let desc = (typeof prev.desc === "string") ? prev.desc : "";
            if (typeof upd.desc === "string" && upd.desc.trim()) {
                desc = upd.desc.trim();
                if (!deltaApplied) applied.push({ name, delta: 0, affinity }); // 仅更新文字层也记入变化
            }
            cur[name] = { affinity, tags, desc };
        }
    }
    return { next: cur, applied };
}

// ============================================================
// ★ B2 玩家变量（创作者可配：数值/文本/开关；默认空=开箱无数字压力）
// 复用现有 state_changes 通道：AI 在 state_changes.variables 返回变化后的值，
// applyStateChanges → computeVariableUpdates 按 schema 校验/夹取/类型转换。
// 变量定义（静态）进 system 段；当前值（动态）进每轮 user 消息，不破缓存。
// ============================================================

export function getVariableSchema(world) {
    const v = world && world.variable_schema;
    return Array.isArray(v) ? v : [];
}

// 取"启用中"的变量定义（filter 出 enabled !== false）
export function getEnabledVariables(world) {
    return getVariableSchema(world).filter(v => v && v.id && v.enabled !== false);
}

// 按 schema 初始化/同步运行时变量值：
// - 启用的变量若缺值则用 default 补
// - 已删/未启用的 key 清除（避免脏数据残留）
// - 类型兜底：number→数字，text→字符串，toggle→布尔
export function syncVariablesToSchema(world, vars) {
    const out = (vars && typeof vars === "object" && !Array.isArray(vars)) ? { ...vars } : {};
    const enabled = getEnabledVariables(world);
    // 清掉不在启用集合里的 key
    const validIds = new Set(enabled.map(v => v.id));
    for (const k of Object.keys(out)) {
        if (!validIds.has(k)) delete out[k];
    }
    for (const def of enabled) {
        if (!(def.id in out)) {
            out[def.id] = def.default;
        } else {
            // 类型兜底（老存档/异常值纠正）
            out[def.id] = coerceVariableValue(out[def.id], def);
        }
    }
    return out;
}

// 把任意值按变量定义纠正为合法类型（不夹取范围，仅保证类型正确）
export function coerceVariableValue(val, def) {
    if (!def) return val;
    if (def.type === "number") {
        const n = typeof val === "number" ? val : parseFloat(val);
        return Number.isFinite(n) ? n : (typeof def.default === "number" ? def.default : 0);
    }
    if (def.type === "toggle") {
        if (val === true || val === 1) return true;
        if (val === false || val === 0) return false;
        const s = String(val == null ? "" : val).trim().toLowerCase();
        return s === "true" || s === "yes" || s === "on" || s === "1";
    }
    // text
    return (val == null) ? (def.default != null ? String(def.default) : "") : String(val);
}

// ★ 纯函数：根据 AI 返回的 changes.variables（变化后的值）计算更新结果。
// 返回 { next: 新变量表, applied: 人类可读的变化条目数组 }。
// - 仅处理 schema 中启用且存在的变量；未知/未启用 id 直接忽略
// - number：夹取到 [min,max]（未设边界则不限），非数字忽略该条目
// - text：转字符串
// - toggle：转布尔
// 不触碰 DOM、不改全局状态，便于单测。
export function computeVariableUpdates(changes, world, currentVars) {
    const enabled = getEnabledVariables(world);
    const defMap = {};
    for (const d of enabled) defMap[d.id] = d;
    const current = (currentVars && typeof currentVars === "object" && !Array.isArray(currentVars))
        ? currentVars
        : (S && S.gameState && S.gameState.variables) || {};
    const next = { ...current };
    const applied = [];
    if (!changes || typeof changes !== "object") return { next, applied };

    for (const [id, raw] of Object.entries(changes)) {
        const def = defMap[id];
        if (!def) continue; // 忽略未知/未启用的变量
        const from = (id in next) ? next[id] : def.default;
        let to;
        if (def.type === "number") {
            const n = typeof raw === "number" ? raw : parseFloat(raw);
            if (!Number.isFinite(n)) continue; // 非数字忽略
            let clamped = n;
            if (typeof def.min === "number") clamped = Math.max(def.min, clamped);
            if (typeof def.max === "number") clamped = Math.min(def.max, clamped);
            to = clamped;
        } else if (def.type === "toggle") {
            to = raw === true || raw === "true" || raw === 1;
        } else {
            to = (raw == null) ? "" : String(raw);
        }
        if (to === from) continue; // 无变化不记录
        next[id] = to;
        applied.push({ id, name: def.name || id, type: def.type, from, to, unit: def.unit || "" });
    }
    return { next, applied };
}

// ★ A2：统一协调器——把"这是哪个 IP / 是否改编"收口成单一模型。
// 协调三路信号：① 用户下拉选的 type（original/ip）② 用户填的 IP 名 ipName ③ 描述/上传文本里 detectIp() 检测到的 IP。
// 规则（符合"上传文本优先、IP 识别辅助"）：
//   - mode：用户显式选 ip 或填了 IP 名 → ip_adaptation；否则 original（尊重用户"原创"选择，不凭检测自动改判）。
//   - ip_name：用户填的优先；用户选了"基于IP"但留空（允许上传源文件后留空）→ 用检测到的单一 IP 补足；原创世界不自动断言 IP。
//   - source：有上传文本 → uploaded_text，否则 description。
//   - conflicts：仅当"用户填的 IP 与文本检测到的 IP 不一致"或"检测到多个 IP 且未声明"时返回，供 #4 的 UI 弹一次确认（日常无感）。
// 纯函数、无副作用、可单测；不碰任何 DOM / 不调用 LLM。
export function resolveCanonContext({ type, ipName, desc, sourceFileContent } = {}) {
    const userIp = (ipName && String(ipName).trim()) ? String(ipName).trim() : null;
    const detected = detectIp([desc, sourceFileContent].filter(Boolean).join("\n"));
    const conflicts = [];
    if (userIp) {
        const matchedUser = matchKnownIp(userIp);
        if (detected.length && matchedUser && !detected.includes(matchedUser)) {
            conflicts.push({ type: "ip_mismatch", userIp, detected, matchedUser });
        }
    } else if (detected.length > 1) {
        conflicts.push({ type: "ambiguous_ip", detected });
    }
    const mode = (type === "ip" || type === "ip_adaptation" || userIp) ? "ip_adaptation" : "original";
    let ip_name = userIp || null;
    if (!ip_name && type === "ip" && detected.length === 1) ip_name = detected[0];
    const source = sourceFileContent ? "uploaded_text" : "description";
    return { mode, ip_name, source, detected, conflicts };
}

// ★ A2 #5：把一致性包落到世界上。
// - 禁项（banned）转成 world.rules 的「禁止概念」规则（玩家可在规则编辑器增删改——单一可编辑来源），
//   不再写入全局强加的禁项；旧 world.bannedConcepts 仅作兼容层，会同步成派生结果。
// - 完整包（banned/must_read/style_anchor）存进 world.canon.consistency_pack 作记录，供 buildCanonRules 注入必读/文风。
// - pack._seed=true 表示来自预设世界种子包（pack_source="seed"），否则 "generated"。
export function applyConsistencyPack(world, pack) {
    if (!world || typeof world !== "object") return;
    const c = ensureWorldCanon(world);
    const p = pack || { banned: [], must_read: [], style_anchor: "" };
    const banned = (Array.isArray(p.banned) ? p.banned : [])
        .filter(x => typeof x === "string" && x.trim())
        .map(x => x.trim());
    if (!Array.isArray(world.rules)) world.rules = [];
    const existing = new Set();
    for (const r of world.rules) {
        if (r && r.then && r.then.type === "ban" && r.then.concept) existing.add(r.then.concept.trim());
    }
    for (const concept of banned) {
        if (existing.has(concept)) continue;
        world.rules.push({
            id: "auto_ban_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
            name: "禁项：" + concept,
            enabled: true,
            when: { type: "always" },
            then: { type: "ban", concept, aliases: [], severity: "hard", unlockTags: [] }
        });
        existing.add(concept);
    }
    // 同步旧兼容层 bannedConcepts（含 rules ban + 历史 bannedConcepts），保证旧管线行为一致
    world.bannedConcepts = collectBannedConcepts(world, getActiveConditionTags());
    c.consistency_pack = {
        banned: banned.slice(),
        must_read: (Array.isArray(p.must_read) ? p.must_read : []).filter(x => typeof x === "string" && x.trim()),
        style_anchor: (typeof p.style_anchor === "string") ? p.style_anchor : ""
    };
    c.pack_source = (p && p._seed) ? "seed" : "generated";
    return c;
}
