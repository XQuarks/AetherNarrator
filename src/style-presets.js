// ============================================================
// W2-Style · 叙事风格预设模板库
// ------------------------------------------------------------
// 内置 12 个常用叙事风格模板，供创作向导"叙事风格"模块一键套用。
// 选中某模板即自动把 narrative_style（文风长文本）与 recommended_temperature（AI 温度）
// 填进创建表单；玩家可在此基础上改写，也可完全清空写自定义风格。
//
// 每个模板字段：
//   preset_id            唯一 ID
//   name / short_tag     显示名 / 顶部标签
//   source               "template"（套用模板）；自定义时为 "custom"
//   narrative_style      核心文风约束（注入 {STYLE_GUIDE} 主体）
//   genre/tropes/taste/pov/style/custom_tag  结构化标签（喂 buildStyleGuide）
//   recommended_temperature  推荐 AI 温度
//   system_addendum      追加系统指令
// ============================================================

export const STYLE_PRESETS = [
    {
        preset_id: "daily_healing",
        name: "日常治愈",
        short_tag: "日常治愈",
        source: "template",
        narrative_style: "以日常生活片段为主，冲突轻柔且可被化解；注重氛围、细节与人物互动中的小确幸。语气温暖舒缓，多用具体的感官描写（光线、食物香气、雨声）烘托情绪，避免宏大阴谋与剧烈转折。节奏不紧不慢，允许留白与平静的对话，让玩家在细微处获得安抚。",
        genre: "都市",
        tropes: ["治愈", "日常"],
        taste: "温暖",
        pov: "第二人称",
        style: "舒缓",
        custom_tag: "",
        recommended_temperature: 0.5,
        system_addendum: "多描写光影、声音与触感；每次交互结尾可点出一处微小的安心感。"
    },
    {
        preset_id: "cyberpunk_cold",
        name: "赛博冷峻",
        short_tag: "赛博冷峻",
        source: "template",
        narrative_style: "高科技、低生活。用冷光、雨水、金属与数据意象构建质感；对话带犬儒、锋利与距离感。情感压抑在冷硬外壳之下，通过反差与细节流露。科技描写重代价（义体、神经接口、监控），而非炫技。禁用轻佻语气，节奏紧凑、信息密度高。",
        genre: "赛博朋克",
        tropes: ["反乌托邦", "成长"],
        taste: "冷峻",
        pov: "第二人称",
        style: "冷峻",
        custom_tag: "",
        recommended_temperature: 0.4,
        system_addendum: "用冷光、雨水、数据噪声营造都市质感；避免甜腻语气词。"
    },
    {
        preset_id: "wuxia_vivid",
        name: "武侠江湖",
        short_tag: "武侠江湖",
        source: "template",
        narrative_style: "快意恩仇的江湖气。对白简练有力，动作描写行云流水；重侠义、恩怨与人物风骨。少用现代词汇，多用意象化的自然与兵器描写。冲突多源于情义两难，结局未必圆满但需有侠者担当。节奏明快，招式与心理并重。",
        genre: "武侠",
        tropes: ["成长", "复仇"],
        taste: "豪爽",
        pov: "第二人称",
        style: "写意",
        custom_tag: "",
        recommended_temperature: 0.6,
        system_addendum: "对白简练；动作描写如行云流水，重侠义与风骨。"
    },
    {
        preset_id: "lovecraft_dread",
        name: "克苏鲁恐惧",
        short_tag: "克苏鲁恐惧",
        source: "template",
        narrative_style: "用不确定性、留白与不可名状感制造恐惧：不要细写怪物全貌，写它带来的错位与不安。避免任何轻佻或亲密语气，保持疏离与压抑；叙事节奏克制，信息碎片化释放。理智与认知的动摇是核心张力，可通过感知扭曲、记忆不可靠来体现。",
        genre: "克苏鲁",
        tropes: ["悬疑", "救赎"],
        taste: "暗黑",
        pov: "第二人称",
        style: "克制",
        custom_tag: "",
        recommended_temperature: 0.4,
        system_addendum: "禁用 emoji；用留白与不可名状制造恐惧，信息碎片化释放。"
    },
    {
        preset_id: "hp_canon",
        name: "英国魔幻",
        short_tag: "英国魔幻",
        source: "template",
        narrative_style: "英式奇幻的典雅与惊奇并存。世界观细腻、充满细节与隐秘规则；成长线是核心，主角在未知中逐渐掌握力量。语调温和但暗藏危险，魔法既浪漫也有代价。允许多彩角色与学院式幽默，同时保持史诗般的命运感。描写重氛围与仪式的庄重。",
        genre: "西幻",
        tropes: ["成长", "救赎"],
        taste: "史诗",
        pov: "第二人称",
        style: "华丽",
        custom_tag: "",
        recommended_temperature: 0.5,
        system_addendum: "保持英式奇幻的典雅；成长线为核心，魔法有代价。"
    },
    {
        preset_id: "xianxia_grand",
        name: "仙侠史诗",
        short_tag: "仙侠史诗",
        source: "template",
        narrative_style: "宏大世界观下的修行史诗。重境界、因果与天道轮回；力量体系层级分明，突破需机缘与磨砺。文风飘逸而有重量，多用山河、云霄、剑意等意象。冲突常关涉正邪、门派与长生执念。节奏可舒缓可磅礴，重人物在天地间的渺小与倔强。",
        genre: "仙侠",
        tropes: ["成长", "逆袭"],
        taste: "史诗",
        pov: "第二人称",
        style: "写意",
        custom_tag: "",
        recommended_temperature: 0.5,
        system_addendum: "重境界与因果；力量体系层级分明，突破需磨砺。"
    },
    {
        preset_id: "noir_moody",
        name: "黑色电影",
        short_tag: "黑色电影",
        source: "template",
        narrative_style: "阴郁、犬儒、宿命感。多用雨夜、霓虹与烟雾意象；内心独白揭示疲惫与欲望。对话简短、充满潜台词；是非边界模糊，结局常带代价。禁用轻松语气，节奏沉缓，重人物在泥沼中的挣扎与偶有微光。",
        genre: "都市",
        tropes: ["悬疑", "救赎"],
        taste: "暗黑",
        pov: "第二人称",
        style: "冷峻",
        custom_tag: "",
        recommended_temperature: 0.4,
        system_addendum: "内心独白揭示疲惫；是非模糊，结局带代价。"
    },
    {
        preset_id: "cozy_mystery",
        name: "舒适悬疑",
        short_tag: "舒适悬疑",
        source: "template",
        narrative_style: "轻推理披着日常外衣。谜题存在但不可怖，真相在温情与机智中揭晓。节奏明快，人物可爱、对话俏皮；线索公平铺设，让玩家乐于参与推演。氛围像午后茶会，紧张感点到为止。重人物关系与社区感。",
        genre: "悬疑",
        tropes: ["悬疑", "日常"],
        taste: "轻松",
        pov: "第二人称",
        style: "轻松",
        custom_tag: "",
        recommended_temperature: 0.6,
        system_addendum: "线索公平铺设；紧张感点到为止，重人物关系。"
    },
    {
        preset_id: "romcom_sweet",
        name: "甜宠恋爱",
        short_tag: "甜宠恋爱",
        source: "template",
        narrative_style: "轻松甜美的恋爱日常。心理活动丰富、语气亲昵；互动多糖分与心跳瞬间，冲突温和且易化解。允许多 emoji 与心形符号增强亲密感，但需贴合人设。节奏轻快，重双向奔赴与细腻情绪流动。",
        genre: "现代",
        tropes: ["甜宠", "成长"],
        taste: "轻松",
        pov: "第二人称",
        style: "轻松",
        custom_tag: "",
        recommended_temperature: 0.7,
        system_addendum: "可适度 emoji 与心形符号；语气亲昵，重双向奔赴。"
    },
    {
        preset_id: "grimdark",
        name: "暗黑残酷",
        short_tag: "暗黑残酷",
        source: "template",
        narrative_style: "道德灰色的残酷世界。没有绝对善恶，生存即代价；伤亡、背叛与腐败写实呈现。文风冷硬、句子短促，情感通过动作与环境流露。避免为残酷而残酷的炫技，重在人在绝境中的选择与代价。希望稀缺但珍贵。",
        genre: "西幻",
        tropes: ["复仇", "生存"],
        taste: "暗黑",
        pov: "第二人称",
        style: "冷峻",
        custom_tag: "",
        recommended_temperature: 0.4,
        system_addendum: "道德灰色；伤亡写实但避免炫技，重选择与代价。"
    },
    {
        preset_id: "slice_of_life",
        name: "校园日常",
        short_tag: "校园日常",
        source: "template",
        narrative_style: "青春群像的细腻日常。重同窗、课堂、社团与微小心事；对话自然带少年气，情绪真实不矫饰。冲突多为成长的烦恼，可被理解与化解。节奏舒缓，留白多，重人物间的羁绊与慢慢生长的情感。",
        genre: "校园",
        tropes: ["成长", "日常"],
        taste: "轻松",
        pov: "第二人称",
        style: "轻松",
        custom_tag: "",
        recommended_temperature: 0.6,
        system_addendum: "语气带少年气；重羁绊与慢慢生长的情感。"
    },
    {
        preset_id: "epic_fantasy",
        name: "史诗奇幻",
        short_tag: "史诗奇幻",
        source: "template",
        narrative_style: "宏大叙事、多线交织、命运感厚重。世界观广阔，种族、王国与古老预言并存；人物在时代洪流中抉择。文风庄重有重量，重史诗感与仪式描写。冲突关乎存亡与信念，牺牲常被需要。线索绵长，伏笔深远。",
        genre: "西幻",
        tropes: ["成长", "救赎"],
        taste: "史诗",
        pov: "第二人称",
        style: "华丽",
        custom_tag: "",
        recommended_temperature: 0.5,
        system_addendum: "宏大叙事、多线交织；重史诗感与命运抉择。"
    }
];

// 按 ID 取模板
export function getStylePreset(id) {
    if (!id) return null;
    return STYLE_PRESETS.find(p => p.preset_id === id) || null;
}

// 自定义（清空模板后手写）风格的默认骨架
export function emptyCustomPreset() {
    return {
        preset_id: "custom",
        name: "自定义风格",
        short_tag: "自定义",
        source: "custom",
        narrative_style: "",
        genre: null,
        tropes: [],
        taste: null,
        pov: null,
        style: null,
        custom_tag: "",
        recommended_temperature: 0.6,
        system_addendum: ""
    };
}

// 把模板/自定义风格对象序列化为写入 world.style_preset 的形态（去掉仅 UI 用的冗余）
export function serializeStylePreset(preset) {
    const p = preset || emptyCustomPreset();
    return {
        preset_id: p.preset_id || "custom",
        name: p.name || "自定义风格",
        short_tag: p.short_tag || "自定义",
        source: p.source || "custom",
        narrative_style: p.narrative_style || "",
        genre: p.genre || null,
        tropes: Array.isArray(p.tropes) ? p.tropes : [],
        taste: p.taste || null,
        pov: p.pov || null,
        style: p.style || null,
        custom_tag: p.custom_tag || "",
        recommended_temperature: typeof p.recommended_temperature === "number" ? p.recommended_temperature : 0.6,
        system_addendum: p.system_addendum || ""
    };
}
