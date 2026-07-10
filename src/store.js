// ============================================================
// AetherNarrator · store.js（由 app.js 模块化拆分自动生成）
// ============================================================

// 全局可变状态容器（跨模块共享，读写均用 S.xxx）
export const S = {
  gameState: null,
  loreKB: null,
  loreEmbeddings: null,
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

export const DEFAULT_PERIOD_LABELS = {
    morning: "早晨", forenoon: "上午", afternoon: "下午", evening: "傍晚", night: "夜晚"
};

export const MAX_SOURCE_CHARS = 8000;

export const LORE_FULL_THRESHOLD = 12000;

export const SYSTEM_ROLES = new Set([
    "系统", "系统管理员", "架构师", "系统架构师", "开发者", "工程师",
    "管理员", "AI", "人工智能", "root", "Root", "Root Architect",
    "语言模型", "language model", "ChatGPT", "GPT", "Claude", "DeepSeek"
]);
