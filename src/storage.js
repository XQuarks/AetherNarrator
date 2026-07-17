// ============================================================
// AetherNarrator · storage.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { STORAGE_KEYS } from "./store.js";
import { deepClone, defaultWorldSchema } from "./utils.js";
import { closeModal, showToast } from "./render.js";
import { migrateSaveRecord, migrateWorldRecord, parseStoredArray, parseStoredObject } from "./migrations.js";
import { idbGet, idbSet, idbDel } from "./idb.js";
import { PROVIDERS, detectProvider } from "./providers.js";
import { EMBED_MODEL, EMBED_DIM } from "./rag.js";
import { mergeWorldPack } from "./world-transfer.js";

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
        createMagicAcademyWorld(),
        createHongLouMengWorld()
    ];
    const parsed = parseStoredArray(data, defaults);
    if (!parsed.ok) console.warn("世界数据损坏，已使用安全默认值；原 localStorage 未覆盖", parsed.error);
    S.worlds = parsed.value.map(migrateWorldRecord);
    // 迁移：旧世界的清理与新的 demo 注入
    let changed = false;
    // 删除旧的蒸汽与魔法 demo
    if (S.worlds.some(w => w.id === "demo_蒸汽与魔法")) {
        S.worlds = S.worlds.filter(w => w.id !== "demo_蒸汽与魔法");
        changed = true;
    }
    // 注入缺失的 demo 世界
    if (!S.worlds.some(w => w.id === "demo_红楼梦")) {
        S.worlds.push(createHongLouMengWorld());
        changed = true;
    }
    if (!S.worlds.some(w => w.id === "demo_magic_academy")) {
        S.worlds.push(createMagicAcademyWorld());
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

export function createHongLouMengWorld() {
    return {
        id: "demo_红楼梦",
        name: "红楼梦 · 大观园",
        type: "ip",
        desc: "清代乾隆年间，金陵四大家族之首的贾府煊赫一时。宁国府与荣国府比邻而居，园林之中，儿女情长、家族兴衰、命运纠葛交织成一部「千红一哭，万艳同悲」的大戏。",
        hero: "贾府中一位身份待定的年轻公子/小姐，寄居荣国府。",
        ip_name: "红楼梦",
        createdAt: new Date().toISOString().split("T")[0],
        tags: ["已有IP", "古典文学", "家族兴衰"],
        schema: {
            progression_label: "情缘",
            progression_path_label: "身份",
            has_skills: true,
            skill_label: "才艺",
            attribute_labels: {
                courage: "胆识", perception: "灵慧", patience: "涵养", luck: "机缘", will: "心性"
            },
            time_periods: { morning: "晨起", forenoon: "午前", afternoon: "午后", evening: "黄昏", night: "入夜" },
            time_config: { era_label: "大清乾隆年间", calendar_mode: "lunar", clock_mode: "period", season: "仲春", show: true, deadlines: [] },
            game_over_conditions: ["is_alive === false"]
        },
        initial_state: {
            name: "瑾玉",
            age: 15,
            background: "贾府旁支之后，父母早亡，由贾母作主接入荣国府抚养。自幼聪慧，琴棋书画皆有所涉，但性情敏感，常感寄人篱下之伤。",
            personality: ["聪慧敏感", "多愁善感", "心地纯良"],
            attributes: {
                courage: "你向来胆小，丫鬟们放个炮仗你都要捂耳。但若有人欺辱你亲近之人，你又能鼓起莫名的勇气。",
                perception: "你的眼睛总能捕捉到旁人忽略的细节——丫头们谁和谁走得近了、太太今天嘴角含笑还是暗沉，你总比别人先察觉。",
                patience: "你能在窗下临半天字帖不挪窝，也能为一首残诗翻来覆去琢磨到三更。",
                luck: "命运待你不薄不厚，恰似大观园里一阵穿堂风，不知会吹开哪扇门。",
                will: "心性绵软，凡事容易往心里去。但骨子里又有一股不服的倔劲。"
            },
            progression: { path: "贾府旁支", rank: "寄居", progress: 0 },
            relationships: {
                "贾母": "老太太疼你，说你眉眼间有几分她年轻时的样子。常唤你到跟前说话解闷。",
                "林黛玉": "她是老太太的外孙女，比你早来一年。你们一见如故，她常说你是这府里唯一懂她的人。",
                "贾宝玉": "荣国府的混世魔王，衔玉而生。他待你极好，可你总觉得他看你的眼神里藏着什么说不清的东西。",
                "薛宝钗": "皇商薛家的千金，端庄大方。你敬她事事周全，却也隐隐感到她对你有所保留。",
                "王熙凤": "荣国府的管事奶奶，精明强干。她对你还算客气，可你知道她眼里只有利益。",
                "袭人": "宝玉房里的大丫鬟，温柔体贴。你与她说过几句话，觉得她是个可托付的人。"
            },
            skills: {
                "诗词": "能凑出几首工整的五言七律，偶尔也有惊人之句。黛玉说你灵气有余、火候不足。",
                "琴艺": "能弹几支《平沙落雁》《梅花三弄》，技法尚可但情感还不够沉厚。",
                "书画": "临过几年帖，字迹清秀有余，筋骨不足。",
                "女红": "能绣些简单花样，但绣鸳鸯时总把两只绣得一模一样，被黛玉笑说是个呆子。"
            },
            inventory: [
                { item_id: "jade_pendant", name: "羊脂玉佩", count: 1 },
                { item_id: "poetry_book", name: "诗集手稿", count: 1 },
                { item_id: "silver", name: "碎银", count: 5 }
            ],
            completed_events: [],
            active_event: null,
            current_location: "荣国府 · 贾母院",
            current_date: { day: 1, period: "morning" },
            goals: [
                { goal_id: "greet_grandma", name: "给贾母请安", type: "完成事件", deadline: { day: 1, period: "morning" }, visible: true },
                { goal_id: "meet_cousins", name: "认识大观园里的兄弟姐妹", type: "关系变化", deadline: { day: 3, period: "night" }, visible: true }
            ],
            status_effects: [],
            npc_activity: { "贾母": "在花厅喝茶歇午", "林黛玉": "在潇湘馆窗前读书", "贾宝玉": "在怡红院与袭人说话", "王熙凤": "在议事厅处理府务", "薛宝钗": "在蘅芜苑做针线" },
            is_alive: true,
            death_reason: null
        },
        lore_kb: {
            ip: "红楼梦",
            snippets: [
                { id: "hlm1", category: "规则", title: "贾府规矩", content: "贾府是金陵四大家族之首，分为宁国府与荣国府。府中等级森严：老太君（贾母）为最高权威，然后是老爷太太、少爷小姐、大丫鬟、小丫鬟、婆子仆役。晨昏定省不可废，逢年过节祭祀、宴请各有规矩。", keywords: ["贾府", "规矩", "等级", "请安"] },
                { id: "hlm2", category: "规则", title: "男女大防", content: "虽是一家人，男女之间仍有内外之别。小姐们不可随意抛头露面，与外人接触须有人陪同。宝玉是例外——贾母特许他住在大观园中与众姐妹为伴。", keywords: ["男女", "内外", "大观园"] },
                { id: "hlm3", category: "规则", title: "世俗与出世", content: "红楼世界有现实与超现实两个层面：一面是贾府的日常起居、官场往来、家族兴衰；另一面是太虚幻境、通灵宝玉、绛珠仙草的宿世之缘。两者交织，不可分割。", keywords: ["太虚幻境", "宿命", "通灵宝玉"] },
                { id: "hlm4", category: "地点", title: "大观园", content: "为迎接贾元春省亲而建，元春省亲后命众姐妹与宝玉搬入居住。园中有潇湘馆（黛玉居所）、蘅芜苑（宝钗居所）、怡红院（宝玉居所）、稻香村、拢翠庵等多处院落。曲径通幽、花木扶疏，是一方世外桃源。", keywords: ["大观园", "潇湘馆", "蘅芜苑", "怡红院"] },
                { id: "hlm5", category: "地点", title: "荣国府", content: "贾母与贾政、王夫人所居。正房、耳房、穿堂、后院层次分明。贾母院在最深处，花厅日常摆着各色点心，丫头婆子往来不绝。", keywords: ["荣国府", "贾母", "贾政"] },
                { id: "hlm6", category: "地点", title: "宁国府", content: "贾珍、尤氏所居。与荣国府仅一墙之隔，格局相似，但风气更奢靡。府中有一座天香楼，常设宴席。", keywords: ["宁国府", "贾珍", "天香楼"] },
                { id: "hlm7", category: "人物", title: "贾宝玉", content: "荣国府贾政之子，衔玉而生。性格叛逆、厌恶仕途经济，却对女儿家极尽温柔。常住大观园怡红院，身边有袭人、晴雯、麝月等一众丫鬟。他与林黛玉青梅竹马、心灵相通，与薛宝钗则有金玉良缘之说。", keywords: ["贾宝玉", "怡红院", "黛玉", "宝钗", "袭人"] },
                { id: "hlm8", category: "人物", title: "林黛玉", content: "贾母外孙女，父母双亡后投奔贾府。才华横溢，诗词冠绝大观园，但体弱多病、性情敏感。居潇湘馆，与宝玉情投意合，却常因小事生隙。前世为绛珠仙草，以泪还神瑛侍者灌溉之恩。", keywords: ["林黛玉", "潇湘馆", "绛珠仙草", "诗词"] },
                { id: "hlm9", category: "人物", title: "薛宝钗", content: "皇商薛家之女，随母兄投奔贾府。端庄大方、处事周全，深得上下欢心。居蘅芜苑，佩戴金锁，与宝玉的通灵宝玉相传是一对「金玉良缘」。", keywords: ["薛宝钗", "蘅芜苑", "金锁", "金玉良缘"] },
                { id: "hlm10", category: "人物", title: "王熙凤", content: "荣国府管家奶奶，贾琏之妻。精明强干、心狠手辣，偌大贾府在她手里运转自如。嘴甜心苦，对下人恩威并施，对利益锱铢必较。人称「凤辣子」。", keywords: ["王熙凤", "管家", "凤辣子"] },
                { id: "hlm11", category: "人物", title: "贾母", content: "贾府最高权威，史老太君。年过七旬，经历了贾府的鼎盛与初显败象。极疼孙子宝玉和外孙女黛玉，是府中真正的定海神针。", keywords: ["贾母", "史老太君", "权威"] },
                { id: "hlm12", category: "人物", title: "其他姐妹", content: "大观园中还有贾迎春（懦弱温和）、贾探春（精明刚烈）、贾惜春（孤僻冷傲）三春姐妹，以及李纨（寡居的珠大奶奶）、史湘云（活泼豪爽的史家小姐）、妙玉（带发修行的拢翠庵主人）等一众女子。", keywords: ["迎春", "探春", "惜春", "湘云", "妙玉"] },
                { id: "hlm13", category: "事件", title: "前世之缘", content: "宝玉前世为赤瑕宫神瑛侍者，黛玉前世为灵河岸绛珠仙草。神瑛侍者以甘露灌溉，绛珠仙草得以久延岁月。终修成女体后，欲以一生之泪偿还灌溉之恩。", keywords: ["前世", "神瑛侍者", "绛珠仙草", "还泪"] },
                { id: "hlm14", category: "物品", title: "通灵宝玉", content: "宝玉出生时口中衔来的一块五彩晶莹的玉石，正面刻着'莫失莫忘，仙寿恒昌'，反面是'一除邪祟，二疗冤疾，三知祸福'。它不仅是宝玉的命根子，也是整部书的灵魂象征。", keywords: ["通灵宝玉", "莫失莫忘"] },
                { id: "hlm15", category: "势力", title: "四大家族", content: "贾、史、王、薛四大家族，祖上皆是勋贵。贾不假，白玉为堂金作马；阿房宫，三百里，住不下金陵一个史；东海缺少白玉床，龙王来请金陵王；丰年好大雪，珍珠如土金如铁。如今的四大家族已显颓势。", keywords: ["四大家族", "贾史王薛", "金陵"] },
                { id: "hlm16", category: "冲突", title: "金玉良缘 vs 木石前盟", content: "宝玉衔通灵宝玉而生，宝钗有金锁，长辈们认为这是天定的「金玉良缘」。但宝玉心中只有黛玉（前世木石前盟），黛玉因此常感不安、以泪试探。这对三角情感是大观园最核心的张力，牵动所有人的关系网。", keywords: ["金玉良缘", "木石前盟", "黛玉", "宝钗", "宝玉", "金锁", "前世"] },
                { id: "hlm17", category: "冲突", title: "仕途经济 vs 性情自由", content: "贾政等长辈期望宝玉走科举仕途之路，但宝玉极度厌恶八股文章和官场应酬，认为那些是「禄蠹」所为。这种价值观冲突是贾府内部的核心矛盾，也影响着宝玉与宝钗（支持仕途）和黛玉（理解宝玉）的关系走向。", keywords: ["仕途", "科举", "禄蠹", "贾政", "宝玉", "自由"] },
                { id: "hlm18", category: "事件", title: "海棠诗社", content: "探春发起海棠诗社，邀请大观园众人到秋爽斋集会。触发条件：白天时段 + 玩家在大观园 + 与探春关系不为冷淡。每位参与者需即兴赋诗，是展示才艺、增进关系的机会。", keywords: ["诗社", "探春", "海棠", "秋爽斋", "诗词", "才艺"], trigger: { periods: ["forenoon", "afternoon"], location: "大观园", npc: "探春", relNot: "冷淡" } },
                { id: "hlm19", category: "事件", title: "刘姥姥进大观园", content: "乡下老妪刘姥姥带着土产来贾府攀亲。触发条件：第 2-5 天 + 上午时段 + 玩家在荣国府。刘姥姥粗鄙但幽默，她的到来给大观园带来一阵新鲜空气，但也可能引出各人的真实面目。", keywords: ["刘姥姥", "攀亲", "乡下", "土产"], trigger: { dayMin: 2, dayMax: 5, periods: ["morning"], location: "荣国府" } },
                { id: "hlm20", category: "事件", title: "黛玉葬花", content: "暮春时节，黛玉见落花飘零，触景生情，在花冢边葬花边吟诗。触发条件：黄昏时段 + 玩家在大观园 + 与黛玉关系不为冷淡。这是了解黛玉内心世界的最佳时机，也是推动宝黛关系的关键场景。", keywords: ["葬花", "黛玉", "落花", "花冢", "暮春"], trigger: { periods: ["evening"], location: "大观园", npc: "林黛玉", relNot: "冷淡" } }
            ]
        },
        system_prompt: `你是《红楼梦》前八十回世界观的 AI 文字游戏叙事主持人。请严格遵循以下设定：

1. 时间：清代乾隆年间，地点：金陵贾府（宁国府/荣国府）及大观园。不得出现现代物品、观念或用语。
2. 语言风格：模仿曹雪芹的白话章回体，可用简洁雅致的文白夹杂。叙事要含蓄、留白、有诗意。对话需符合人物身份和性格。
3. 硬性约束：
   - 不可篡改原著核心设定的命运走向（如黛玉注定泪尽而亡、宝玉终将出家），但可以在细节上自由发挥。
   - 贾母为最高权威，宝玉不能做违逆贾母之事。
   - 男女大防不可逾越，小姐们不能随意与外人独处。
   - 超自然元素（太虚幻境、通灵宝玉的灵异）可以出现，但要保持神秘感和诗意，不可过度直白。
4. 输出必须是 JSON 格式。`,
        opening_narrative: `这一日正是仲春时节，荣国府里的海棠开得正盛，一阵风过，花瓣簌簌落了满庭。

你站在贾母院的花厅外，手里绞着帕子，心里七上八下的。老太太今早传话说要见你，你本就寄人篱下、处处小心，哪禁得起这般郑重其事的召唤？是福是祸，一时竟也猜不透。

耳边传来小丫鬟银钏的声音："姑娘，老太太请你进去呢。"

你深吸一口气，理了理鬓边碎发，迈步跨进那挂着湘帘的门——`,
        initial_choices: [
            { text: "向贾母恭敬请安，问老太太身子可好", hint: "礼数周全，讨老人家欢心" },
            { text: "悄悄打量屋内还有谁在，心里盘算应对", hint: "先弄清局面，再决定如何说话" },
            { text: "抬眼环顾，被墙上的一幅字画吸引", hint: "被风雅之物触动，或许会引出故事" }
        ],
        behavior_records: [],
        style_ref: "original",
        custom_style: "",
        plot_freedom: 2,
        custom_prefix: ""
    };
}

export function createMagicAcademyWorld() {
    return {
        id: "demo_magic_academy",
        name: "星辉魔法学院",
        type: "original",
        desc: "在大陆中央的翡翠森林深处，矗立着千年魔法学院「星辉」。这里招收所有拥有魔力天赋的少年少女，教授元素魔法、炼金术、星象学和魔兽驯养。学院依山而建，七座塔楼分别代表七大元素学派。对新生而言，这里既是梦想之地，也是初恋萌芽的温床——毕竟，谁不会对共赴星象塔观星的同学心动呢？",
        hero: "刚入学的魔法新生，魔力天赋尚未完全觉醒，对学院的一切充满好奇与期待。",
        ip_name: "",
        createdAt: new Date().toISOString().split("T")[0],
        tags: ["原创", "魔法学院", "恋爱冒险"],
        schema: {
            progression_label: "年级",
            progression_path_label: "学派",
            has_skills: true,
            skill_label: "魔法/课程",
            attribute_labels: { courage: "勇气", perception: "洞察", patience: "专注", luck: "幸运", will: "意志" },
            time_periods: { morning: "早课", forenoon: "上午课", afternoon: "午后", evening: "黄昏", night: "星夜" },
            time_config: { era_label: "", calendar_mode: "gregorian", clock_mode: "period", season: "初秋", show: true, deadlines: [] },
            game_over_conditions: ["is_alive === false"]
        },
        initial_state: {
            name: "新生",
            age: 15,
            background: "普通商人家庭出身，魔力天赋在一次意外中偶然显露，被学院导师发现后破格录取。你对魔法世界几乎一无所知，怀揣着紧张与憧憬踏入了星辉学院的大门。",
            personality: ["好奇", "腼腆", "善良"],
            attributes: {
                courage: "你连主动和人搭话都要深呼吸三次，但骨子里有一股不愿服输的倔劲。",
                perception: "你对周围人的情绪变化异常敏感，能察觉到谁开心、谁在强颜欢笑。",
                patience: "你能在图书馆泡一下午只为弄懂一条咒语，但实操课上三次放不出魔法球，也会急得咬笔头。",
                luck: "你的运气像一枚两面硬币——今天可能捡到一枚稀有魔石，明天可能在楼梯上摔一跤。",
                will: "虽然嘴上说着'我不行'，但每次想放弃的时候，你总能咬咬牙再试一次。"
            },
            progression: { path: "未定", rank: "一年级新生", progress: 0 },
            relationships: {
                "伊莉丝·风语者": "风元素学派的天才少女，银发紫瞳，总是独来独往。在入学仪式上她多看了你一眼，你不知道那意味着什么。",
                "艾伦·炎心": "火元素学派的阳光少年，你的室友，自来熟到令人发指。第一天就把你的名字记错成谐音绰号，你懒得纠正了。",
                "露娜·夜歌": "暗元素学派的学姐，三年级。温柔得像月光，但有点天然呆，经常迷路。她在开学第一天就撞上了你——字面意义上的。",
                "格雷教授": "水元素学派导师，中年儒雅，说话永远像是在念诗。他是第一个发现你魔力天赋的人，对你寄予厚望。",
                "费恩学长": "光元素学派，五年级的学院首席。英俊、温和、成绩全优，是所有新生仰望的存在——但他对谁都一视同仁地温柔，反而更难接近。"
            },
            skills: {
                "基础元素操控": "连一个完整的火苗都点不着，只能搓出几点可怜的火星。",
                "魔法理论": "昨天才领到课本，连目录都没翻完。",
                "炼金术": "你以为炼金术就是往锅里扔材料乱炖，结果差点炸了实验室——还好艾伦拉住了你。",
                "星象学": "你能认出北极星，仅限于此。",
                "魔兽驯养": "你对魔兽唯一的经验是家里养过一只猫。"
            },
            inventory: [
                { item_id: "wand", name: "新生魔杖", count: 1 },
                { item_id: "robe", name: "学院制服", count: 1 },
                { item_id: "textbook", name: "初级魔法理论", count: 1 },
                { item_id: "coin", name: "银币", count: 8 }
            ],
            completed_events: [],
            current_location: "星辉学院 · 中央广场",
            current_date: { day: 1, period: "morning" },
            goals: [
                { goal_id: "sorting", name: "完成学派分院仪式", type: "完成事件", deadline: { day: 1, period: "afternoon" }, visible: true },
                { goal_id: "make_friend", name: "认识一位同学", type: "关系变化", deadline: { day: 3, period: "night" }, visible: true }
            ],
            status_effects: [],
            npc_activity: { "艾伦·炎心": "在宿舍整理行李，等着和你一起去广场", "伊莉丝·风语者": "独自站在广场边缘的白桦树下", "露娜·夜歌": "在图书馆和某个书架之间迷路了", "格雷教授": "在教师席上翻阅新生名册", "费恩学长": "在广场中央协助新生报到" },
            is_alive: true,
            death_reason: null
        },
        lore_kb: {
            ip: "星辉魔法学院",
            snippets: [
                { id: "ma1", category: "规则", title: "魔法基础规则", content: "施法需要魔杖和咒语配合，还需集中精神力。新生在分院前只能施展基础元素魔法。学院内禁止在走廊斗法，违反者罚扫图书馆一周。", keywords: ["魔杖", "咒语", "魔法", "规则", "新生"] },
                { id: "ma2", category: "规则", title: "七大元素学派", content: "学院设有七大学派：风（速度与感知）、火（力量与激情）、水（治疗与变化）、土（防御与坚韧）、光（治愈与守护）、暗（隐匿与幻术）、雷（爆发与控制）。新生分院通过仪式由魔法水晶球判断最适合的学派。", keywords: ["学派", "元素", "风", "火", "水", "土", "光", "暗", "雷", "分院"] },
                { id: "ma3", category: "规则", title: "学院生活", content: "学生按年级分班，每班约20人。学期为一年，分为三阶段：基础期（1-4月）、专精期（5-8月）、考核期（9-12月）。考核不合格可补考一次，再不合格则退学。", keywords: ["学院", "年级", "学期", "考核", "补考"] },
                { id: "ma4", category: "地点", title: "中央广场", content: "学院核心区域，铺着白色魔石地砖，中央是一座巨大的星辉喷泉。每年开学典礼和重要仪式在此举行。周围环绕着食堂、行政楼和公告栏。", keywords: ["广场", "喷泉", "开学", "仪式"] },
                { id: "ma5", category: "地点", title: "七塔", content: "七座魔法塔分别属七大学派。每座塔有自己的风格：风塔轻盈高挑藤蔓缠绕、火塔外墙似有岩浆流淌、水塔有一道不息之泉从塔顶倾泻、光塔通体洁白绽放柔光、暗塔隐在紫色雾霭中、土塔方正敦实如堡垒、雷塔顶端总有电弧闪烁。", keywords: ["塔", "风塔", "火塔", "水塔", "光塔", "暗塔", "土塔", "雷塔"] },
                { id: "ma6", category: "地点", title: "星象塔", content: "学院最高建筑，专用于星象学教学。顶部有巨大的望远镜和露天观星台。传说在流星雨之夜登上星象塔许愿，愿望就会实现——因此这里也是恋人们最钟爱的约会地点。", keywords: ["星象塔", "观星", "流星雨", "许愿", "约会"] },
                { id: "ma7", category: "地点", title: "翡翠森林", content: "环绕学院的原始魔法森林，是魔兽课实践场地和炼金材料的来源地。林中有古老的魔法遗迹和一条会唱歌的清澈溪流。学院规定新生不得独自深入森林。", keywords: ["森林", "翡翠", "魔兽", "炼金", "遗迹"] },
                { id: "ma8", category: "人物", title: "伊莉丝·风语者", content: "风元素学派一年级，银发紫瞳，天才少女，却极度不善社交。日常行程：晨起在风塔顶练习风刃，上午课后在图书馆角落看书，黄昏时独自在翡翠森林边缘散步。她似乎背负着某个家族的秘密。", keywords: ["伊莉丝", "风语者", "风", "银发", "天才"] },
                { id: "ma9", category: "人物", title: "艾伦·炎心", content: "火元素学派一年级，你的室友。阳光开朗、话多、容易激动，是行走的气氛炸弹。日常行程：晚起急急忙忙跑去教室，午休和同学们在广场聊天，夜晚在宿舍练火球术（经常烧到窗帘）。", keywords: ["艾伦", "炎心", "火", "室友"] },
                { id: "ma10", category: "人物", title: "露娜·夜歌", content: "暗元素学派三年级学姐，温柔天然呆。日常行程：上午经常在教学楼迷路向你求救，下午在暗塔研究幻术，夜晚在星象塔顶独自看星星。她对星空的痴迷无人能及。", keywords: ["露娜", "夜歌", "暗", "学姐", "星空"] },
                { id: "ma11", category: "人物", title: "费恩学长", content: "光元素学派五年级，学院首席。完美而温柔，是所有人的榜样。日常行程：早晨在光塔顶冥想，白日在各教室协助教授授课，黄昏时在广场花坛旁看书。他喜欢在花坛边的长椅上安静地读书，偶尔会收下一两封匿名情书，但从未回应过。", keywords: ["费恩", "光", "首席", "学长"] },
                { id: "ma12", category: "人物", title: "格雷教授", content: "水元素学派导师，你的发掘者。为人儒雅温和，但上课时要求严苛。他喜欢在课堂上用诗歌比喻魔法原理。日常在办公室整理旧魔法手稿，常在深夜还能看到他办公室的灯亮着。", keywords: ["格雷", "教授", "水", "导师"] },
                { id: "ma13", category: "冲突", title: "元素学派间的微妙竞争", content: "七大学派表面上和睦，实则暗流涌动。火学派认为光学派软弱、暗学派认为风学派浮躁、土学派嫌水学派多变。但所有学派都一致推崇雷学派最强——雷塔的学生也确实常年霸占学年榜首。这种竞争有时会升级为塔楼间的斗法事件。", keywords: ["学派", "竞争", "冲突", "对立", "斗法"] },
                { id: "ma14", category: "冲突", title: "魔力天赋与社会出身", content: "学院中有两类学生：出身魔法世家的名门之后和像你一样偶然觉醒的普通学生。前者往往傲慢、自带高级魔杖和家传咒语；后者则靠学院给予的基础配备起步。这道隐形的阶级线常常引发摩擦。你的魔力天赋是否能证明——出身不等于上限？", keywords: ["名门", "平民", "阶级", "天赋", "出身"] },
                { id: "ma15", category: "事件", title: "分院仪式", content: "开学典礼上的重头戏。新生轮流触摸魔法水晶球，球体根据天赋显现对应元素的颜色。分院结果可能出乎意料——有时球会呈现两种颜色，意味着跨学派天赋。触发条件：第 1 天上午 + 玩家在中央广场。这是决定你学派归属的关键时刻。", keywords: ["分院", "水晶球", "元素", "学院", "典礼"], trigger: { day: 1, periods: ["morning"], location: "中央广场" } },
                { id: "ma16", category: "事件", title: "流星雨之夜", content: "每年入秋的第一个夜晚，星辉学院上空会降下魔法流星雨。传说如果两人一同在星象塔顶观看流星雨并在流星落下时牵手，他们的魔力会产生共鸣。触发条件：第 5-15 天 + 星夜时段 + 玩家在学院 + 与任意角色的关系不为冷淡。这是经典的恋爱事件触发器。", keywords: ["流星雨", "星象塔", "许愿", "牵手", "共鸣", "恋爱"], trigger: { dayMin: 5, dayMax: 15, periods: ["night"] } },
                { id: "ma17", category: "事件", title: "翡翠森林试炼", content: "新生第一学期的期中测试：三人一组进入翡翠森林，寻找指定的魔法植物并在日落前返回。途中可能遭遇幼年魔兽、迷路、或发现古代魔法遗迹。触发条件：第 6-10 天 + 早晨 + 玩家已在某学派。队友由教授分配，可能与好感最高或最低的同学组队。", keywords: ["森林", "试炼", "期中", "魔兽", "队友"], trigger: { dayMin: 6, dayMax: 10, periods: ["morning"] } }
            ]
        },
        system_prompt: `你是星辉魔法学院背景的 AI 文字游戏主持人。风格定位：青春校园 + 恋爱冒险。

世界观硬约束：
- 施法需要魔杖和咒语配合，新生不能施展高级魔法。
- 七大元素学派各有特色，分院后不能转学派但可选修其他元素。
- 学院纪律不能公然挑战——私下小动作可以，公开违规会被罚。
- 魔力天赋的发展需要时间沉淀，不可一夜成为顶尖法师。
- 魔法世界存在真实的危险，但学院范围通常安全。

叙事风格：
- 温暖轻快，带有青春期的朦胧感与悸动感。
- 日常对话要轻松自然，恋爱线要含蓄而不直白——更多是微妙的关心、不经意的脸红、夜空下的安静陪伴。
- 魔法描写要有画面感和诗意。
- 允许适当的幽默元素（艾伦是天然的笑点提供者）。`,
        opening_narrative: `九月的晨光穿过翡翠森林的树冠，在白色魔石铺就的广场上洒下斑驳的光影。

你站在这片陌生的开阔地上，手里攥着那封薄薄的录取通知书，上面用银色墨水写着你的名字，下面是一行烫金小字——「欢迎来到星辉魔法学院」。周围是和你一样穿着崭新制服的新生，有人兴奋地议论着即将看到的七座魔法塔，有人紧张地默背着从家里带来的基础咒语。

一阵微风拂过，广场中央的星辉喷泉忽然亮起柔和的蓝光——那是开学典礼即将开始的信号。

正在你踌躇着不知道该往哪走时，一个红发少年从人群中挤过来，大大咧咧地拍了拍你的肩膀：「嘿！你也是新生吧？我叫艾伦·炎心——咦，你这表情，该不会是在紧张吧？别怕，我打听好了，先集合听校长训话，然后就是重头戏——分院仪式！」

他叽里呱啦说了一通，你只来得及勉强记住他的名字。而就在此时，你的余光捕捉到广场边缘的一棵白桦树下，站着一个银色长发的女孩，她正静静望着喷泉，阳光在她的发梢上跳动着细碎的光。`,
        initial_choices: [
            { "text": "对艾伦微笑点头：「谢谢你，我叫……」，向他介绍自己", "hint": "主动结交第一个朋友，友好开局" },
            { "text": "目光被白桦树下的银发女孩吸引，忍不住多看了几眼", "hint": "被神秘气质吸引，可能开启特殊关系线" },
            { "text": "翻看录取通知书，研究上面提到的七大学派介绍", "hint": "理性派，了解世界观后再做选择" }
        ],
        behavior_records: [],
        style_ref: "none",
        custom_style: "",
        plot_freedom: 4,
        custom_prefix: ""
    };
}

export async function loadSaves() {
    const data = await idbGet(STORAGE_KEYS.saves);
    const parsed = parseStoredArray(data, []);
    if (!parsed.ok) console.warn("存档数据损坏，已进入空列表兼容模式；原 localStorage 未覆盖", parsed.error);
    const raw = parsed.value;
    S.saves = raw.map(save => migrateSaveRecord(
        save,
        S.worlds.find(world => world.id === save.worldId) || null
    ));
    if (parsed.ok && data && JSON.stringify(raw) !== JSON.stringify(S.saves)) saveSaves().catch(() => {});
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
