// ★ docs/74：技能成长容器——确定性判定引擎（纯函数，不碰 DOM/S，可单测）
// 设计原则：引擎管状态（确定性累加 successCount + 阈值判定），LLM 管叙事（信封上报 result）。
// 星级由 successCount 重算，绝不信任 AI 自报的 stars（防泄漏 / 防作弊）。

export const DEFAULT_SKILL_THRESHOLDS = [3, 8, 15]; // 第 3/8/15 次成功升 1/2/3 星
export const DEFAULT_MAX_STARS = 3;

// 由累计成功次数确定性算出当前星数（不依赖、也不信任任何外部传入的 stars）
export function computeStars(successCount, thresholds, maxStars) {
    const sc = (typeof successCount === "number" && successCount >= 0) ? successCount : 0;
    const th = (Array.isArray(thresholds) && thresholds.length) ? thresholds : DEFAULT_SKILL_THRESHOLDS;
    const max = (typeof maxStars === "number" && maxStars > 0) ? maxStars : DEFAULT_MAX_STARS;
    let s = 0;
    for (const t of th) {
        if (typeof t === "number" && sc >= t) s++;
        else break; // 阈值须单调递增，遇第一个未达即停
    }
    return Math.min(s, max);
}

// 处理一次运用结果，返回新状态与是否升星（纯函数，无副作用）
// skillState: 既有运行时对象（可能含 stars/successCount，来自 gameState.skills[name]）
// result: "success" | "fail" | "use"（由 LLM 信封 state_changes.skills[name].result 上报）
// cfg: { thresholds?, maxStars? } 可选覆盖
export function applySkillResult(skillState, result, cfg) {
    const st = (skillState && typeof skillState === "object") ? skillState : {};
    // 优先用运行时 state 自带阈值/上限（Phase B 中 gameState.skills[name] 已携带），cfg 为可选覆盖，再回退默认
    const thresholds = (Array.isArray(st.thresholds) && st.thresholds.length)
        ? st.thresholds
        : (cfg && Array.isArray(cfg.thresholds) && cfg.thresholds.length ? cfg.thresholds : DEFAULT_SKILL_THRESHOLDS);
    const maxStars = (typeof st.maxStars === "number" && st.maxStars > 0)
        ? st.maxStars
        : (cfg && typeof cfg.maxStars === "number" && cfg.maxStars > 0 ? cfg.maxStars : DEFAULT_MAX_STARS);
    const next = {
        stars: (typeof st.stars === "number" && st.stars >= 0) ? st.stars : 0,
        successCount: (typeof st.successCount === "number" && st.successCount >= 0) ? st.successCount : 0,
        thresholds,
        maxStars,
        lastNotifiedRound: (typeof st.lastNotifiedRound === "number") ? st.lastNotifiedRound : null
    };
    // 仅"成功运用"累加一次
    if (result === "success") next.successCount += 1;
    const oldStars = next.stars;
    // ★ 星级由 successCount 重算，忽略任何外部/AI 声明的 stars
    next.stars = computeStars(next.successCount, thresholds, maxStars);
    return { state: next, leveledUp: next.stars > oldStars, oldStars, newStars: next.stars };
}

// 在某个技能被上报运用时，确保 gameState.skill_growth[name] 存在（懒创建，默认阈值）。
// 幂等：已有时直接返回既有运行时对象（保留成长进度与自定义阈值）。
// 注意：技能的"文字描述"仍存放在 gameState.skills（字符串映射，见 docs/60），本模块只管成长进度，
// 放进独立的 skill_growth 字段，避免破坏 s.skills 的既有字符串契约（渲染层/rag/多测试依赖）。
export function ensureGrowthEntry(skillGrowth, name) {
    const map = (skillGrowth && typeof skillGrowth === "object" && !Array.isArray(skillGrowth)) ? skillGrowth : {};
    if (map[name] && typeof map[name] === "object" && !Array.isArray(map[name])
        && typeof map[name].stars === "number" && typeof map[name].successCount === "number") {
        return map[name]; // 已是运行时对象，原样返回（保留 thresholds/maxStars/进度）
    }
    const entry = {
        stars: 0,
        successCount: 0,
        thresholds: DEFAULT_SKILL_THRESHOLDS,
        maxStars: DEFAULT_MAX_STARS,
        lastNotifiedRound: null
    };
    map[name] = entry;
    return entry;
}
