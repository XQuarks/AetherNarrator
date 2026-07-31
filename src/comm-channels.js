// ============================================================
// 动态渠道系统（docs/53）
// ------------------------------------------------------------
// 联系方式不写死：两个来源汇成"可用渠道集合"
//   1) 玩家自选：world.contact_channels（受 requires 约束）
//   2) 系统按情境提供：suggestChannels(world, scene)
// NPC 联系方式 consent 存于 gameState.bonds[npc].shared_contacts
// ============================================================

export const CHANNEL_KINDS = ["magic", "tech", "social", "physical"];

// 由世界类型/描述推导该世界具备的通讯能力标签
export function worldCapabilities(world) {
    const type = (world && world.type) || "";
    const era = (world && (world.era_label || (world.time_config && world.time_config.era_label))) || "";
    const desc = (world && world.desc) || "";
    const text = (type + " " + era + " " + desc).toLowerCase();
    const caps = [];
    if (/现代|科技|赛博|都市|modern|sci|cyber|tech/.test(text)) caps.push("tech_allowed");
    if (/魔法|奇幻|魔幻|magic|fantasy|修仙|仙侠|西幻|harry|hp/.test(text)) caps.push("magic_allowed");
    if (/中世纪|古风|古代|武侠|medieval|ancient/.test(text)) caps.push("physical_allowed");
    if (caps.length === 0) caps.push("tech_allowed", "magic_allowed", "physical_allowed"); // 默认都允许，由 AI/场景判定
    return caps;
}

// 系统依世界类型 + 当前场景动态提供的渠道（不落库）
export function suggestChannels(world, scene = {}) {
    const caps = worldCapabilities(world);
    const loc = String(scene.location || (world && world.current_location) || "").toLowerCase();
    const out = [];
    if (caps.includes("tech_allowed")) out.push({ id: "phone", name: "手机推送", kind: "tech" });
    if (caps.includes("magic_allowed")) {
        out.push({ id: "patronus", name: "守护神传信", kind: "magic" });
        out.push({ id: "mirror", name: "双面镜", kind: "magic" });
    }
    out.push({ id: "raven", name: "信鸦", kind: "physical" });
    out.push({ id: "messenger", name: "信使", kind: "physical" });
    if (/酒馆|客栈|旅店|inn|tavern|酒保/.test(loc)) out.push({ id: "tavern_whisper", name: "酒保传话", kind: "social" });
    if (/公寓|家|屋|房|home|apartment|宿舍/.test(loc)) out.push({ id: "home_note", name: "门缝留言", kind: "social" });
    if (/广场|市集|market|square/.test(loc)) out.push({ id: "town_crier", name: "广场公告", kind: "social" });
    const seen = new Set();
    return out.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

// 校验单个渠道是否满足 requires（world_flags 需在能力集内；item_id 需背包持有）
export function validateChannel(channel, capabilities, gameState) {
    const req = channel.requires || {};
    if (req.world_flags && Array.isArray(req.world_flags)) {
        const caps = capabilities || [];
        if (!req.world_flags.every(f => caps.includes(f))) return false;
    }
    if (req.item_id) {
        const inv = (gameState && gameState.inventory) || [];
        if (!inv.some(i => i.item_id === req.item_id)) return false;
    }
    return true;
}

// 合并玩家自选 + 系统提供，按 requires 过滤，去重（玩家优先）
export function resolveChannels(world, gameState, scene = {}) {
    const player = Array.isArray(world && world.contact_channels)
        ? world.contact_channels.map(c => ({ ...c, source: "player" })) : [];
    const sys = suggestChannels(world, scene).map(c => ({ ...c, source: "system" }));
    const caps = worldCapabilities(world);
    const all = [...player, ...sys].filter(c => validateChannel(c, caps, gameState));
    const seen = new Map();
    for (const c of all) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()];
}

// 把系统提供的渠道"固化"为玩家自选，并作为物品进背包 B3
export function commitChannel(world, gameState, channel) {
    if (!world) return { added: false, itemAdded: false };
    if (!Array.isArray(world.contact_channels)) world.contact_channels = [];
    const id = channel.id || ("sys_" + (channel.name || "channel"));
    const exists = world.contact_channels.some(c => c.id === id || c.name === channel.name);
    if (!exists) {
        world.contact_channels.push({
            id, name: channel.name, kind: channel.kind || "social",
            requires: channel.requires || {}, source: "player"
        });
    }
    const inv = (gameState && gameState.inventory) || (gameState.inventory = []);
    const itemId = "contact_" + id;
    let itemAdded = false;
    if (!inv.some(i => i.item_id === itemId)) {
        inv.push({ item_id: itemId, name: channel.name, count: 1, category: "联系方式", tags: ["contact"] });
        itemAdded = true;
    }
    return { added: !exists, itemAdded };
}
