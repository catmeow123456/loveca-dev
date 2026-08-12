# Loveca 当前进度及待办

更新时间：2026-08-11

> 本文件只保留当前基线、仍有效的缺口和下一步。已经完成的逐窗口施工记录不再重复保存；需要追溯时使用 Git 历史。卡效完成状态以主登记册为准，发布与迁移历史以对应 runbook 和 migration notes 为准。

## 当前基线

### 规则与对局

- `GameSession` / `GameService` 继续作为权威状态和命令处理边界；玩家输入统一通过语义化 `GameCommand` 和中央命令政策校验。
- 新对局默认使用权威 `ManualOperationMode=RULES`。本地调试、对墙打和远程调试可在安全时点直接切换；正式联机开启 `FREE` 需要双方协商，观战与回放始终只读。
- 普通登场、换手、费用支付、LIVE 设置、判定、成功 LIVE 选择、卡效 pending/activeEffect 和主要阶段流已经进入共享规则链路；LIVE 设置时点通过独立语义支持盖牌与撤回本轮里侧盖牌，不放宽规则模式的通用区域移动。
- 声援规则的公共结算边界已统一：普通、追加、重做及 `FREE` 手动单张声援均在本批公开后立即且仅一次结算 DRAW BLADE HEART，然后才进入适用的 `ON_CHEER` 检查时点；玩家接受最终判定结果时不再抽牌。重做声援可替换当前 Heart/Score 贡献，不撤销原批已完成的抽牌。
- 全卡池完整自动裁判尚未完成；未自动化能力不能依靠 UI 或具体卡牌特例绕过规则边界。

### 卡效框架

- 具体卡效定义集中在 `src/application/card-effects/definitions/index.ts`；单卡与 shared family 分别位于 `workflows/cards/` 和 `workflows/shared/`。
- `card-effect-runner.ts` 的完整卡效 fallback 已清空，只保留调度、生命周期、registry 和尚未迁出的 matcher/relay/trigger 条件胶水。
- 当前已登记的 implemented definition 和基础编号均可在 `docs/card-effect-reuse-audit/existing_module_map.md` 检索；该文件是卡效完成状态的唯一主登记册。
- 新卡效继续优先复用现有费用、检视、区域选择、成员状态、能量、抽弃、声援和 LIVE modifier 底座，不建立大型 resolver DSL。
- HEART modifier 已按卡文显式区分 `SOURCE_MEMBER` / `TARGET_MEMBER` / `PLAYER`：self-selection 仍为 TARGET，真实来源与受益成员分别记录；RULES/FREE 离场、替换、memberBelow、同实例重登场和 authority checkpoint 复水共用严格生命周期边界。

### 联机、观战与回放

- 正式联机已具备房间号双人房间、云端卡组锁定、双方准备、暗选猜拳、胜者决定先后手、服务端权威命令、轮询同步、请求式撤销/重开、主动认输和短暂断线恢复；认输以 `OPPONENT_SURRENDER` 结束对局并封存为 `SURRENDERED`，适用于普通与公共牌桌房间。
- 房间号观战使用授权玩家视角，支持同会话切换、跨重开等待和最多 10 个普通观战会话；观战不提供命令、上帝视角或对手隐藏信息。
- 正式联机对局已提供按 `matchId` 隔离的轻量局内通信：双方可发送纯文本或六种服务端白名单快捷表情，已授权观战者只读；文字聊天保持顶层一键直达，快捷表情入口位于己方身份旁，对手表情会在发送者身份旁短暂展示。文字与表情共用序号、游标补拉、未读、静音、幂等和综合限频，表情另有 2 秒冷却；消息跟随内存中的对局运行态，不写入对局状态、历史记录、回放或数据库。
- 正式联机与服务端可记录对墙打已经写入历史根记录、参与者、卡组快照、timeline、authority checkpoint、public/private event 和部分 decision record。
- 完整历史回放默认保留最近 10 天；过期已封存对局可在停机维护窗口清理时间线、检查点、事件、决策与卡组明细，根记录、参与者和卡组来源元信息继续保留并标记为 `METADATA_ONLY`。
- 公共牌桌 Beta 一期已落下首个可运行闭环：PostgreSQL 只保留候场票据、配对预留和跨模式玩家占用三张运行表；锁定卡组直接内嵌在票据中，生命周期事件改走结构化应用日志。其余闭环包括 FIFO 原子认领、双方确认、带短租约和有限重试的封闭房间引导、`PUBLIC_TABLE` 对局来源，以及跨页面等待和确认 UI。公共牌桌自动房间使用 6 位易读房间号，房间号观战与普通房间一致默认开启；卡组数据通过 transport serde 无损保存 `Map` 等运行时类型，并覆盖从 JSONB 往返、猜拳开局到首个玩家快照的回归。联机页在对局快照失败时会保留明确的失败/重试界面。后续仍需在完整测试环境持续验证双浏览器真实流程、进行中房间恢复和运营聚合。
- 公共牌桌经过一段时间的实际使用观察后，玩家已经形成在统一入口持续候场的使用习惯，产品需求验证不再阻止下一阶段排位设计。首个赛季排位按独立赛季页面、固定活跃时段、单一 FIFO 排位池、Glicko rating 和复用正式联机房间的方向推进；休闲公共牌桌与房间号继续不计分。
- 赛季排位 R1 已完成首轮生产影子验证：2026-07-24 至 29 日的 491 局合格公共牌桌对局覆盖 50 名玩家，未显示明显首后手偏差；5 场资格会让仍高 RD 的短期连胜玩家直接进入榜首，因此当前候选提升为 `GLICKO1_PER_MATCH_SHADOW_V2`，只把定位/排行榜门槛提高到 10 场，Glicko 数学参数不变，V1 继续保留用于复现原报告。`glicko-shadow.ts` 可按 `settledAt + matchId` 稳定回放；临时生产脚本仍只读查询 `match_records` 并匿名生成 JSON/Markdown，V2 已补充排除状态与正确的卡牌数据统计口径。现有 `match_records.cardDataHash` 是本局双方卡组快照哈希，不能作为赛季全局卡牌环境身份。详细判断见 `docs/matchmaking-and-ladder/RANKED_SHADOW_REPORT_ANALYSIS_2026-07-30.md`；`SHADOW` 版本不得写入正式积分。
- 赛季排位首版闭环已落地，名为 V1 的首个赛季已在生产开放并使用 `GLICKO1_PER_MATCH_V3`。正式 V1–V3 继续冻结以确定性重建旧流水；未来新赛季默认 V4，使用初始 `1500 / RD 300`、`ratingScale=800`、最低 `RD 100`、5 场定级和双方定级后的 1800 中心成长池；实时结算与 ledger 重放已收口到同一算法调度入口，正式 V4 在普通赛季配置中将定级与参榜门槛锁定为 5 场，不需要评分结构迁移。`0010_add_ranked_system.sql` 提供排位基线，`0018_add_ranked_season_announcement.sql` 增加可编辑纯文本赛季公告；赛季生命周期/开放窗口、独立排位票据与稳定 FIFO、幂等且可补偿的 `RANKED` 开局绑定、带在线代际保护的断线裁定、权威终局自动结算、追加式 `VOID / REPLACEMENT`、签名更正预览、软重置种子和确定性重建均已实现。排位重连期限为 1 分钟：双方都超时且最后在线时间相差不超过 5 秒时为平台无结果，超过 5 秒时由较早离线方判负；该政策作为不可缺省的固定公告内容显示在赛季页、候场状态和局内房间菜单，管理员填写的赛季说明显示在同一弹窗。软重置默认使用新赛季初始积分/RD，草稿期可由管理员选择并参数化向中心值保留公式；策略和参数随竞技环境冻结，种子积分在玩家首场结算前不展示。进入 `FINALIZING` 前已经形成的配对可继续开局，未开局预留消化完之前不能封存；收口任务先排空可靠结算，不能只改数据库状态终止仍在运行的对局。玩家侧已有精简赛季页、限高滚动卡组选择、跨页面候场/确认、首场积分与变化回显、参榜场次门槛、个人战绩、最近对局和排行榜；管理员侧已有“概览 / 赛季 / 对局处理”页面，概览按赛季展示运行健康、经营统计、玩家场次数与积分分布，V1–V3 可配置 1–100 场参榜门槛，正式 V4 普通配置锁定 5 场，并可修改名称、公告和开放时段；对局处理默认分页读取全部赛季，支持赛季、计分状态和用户筛选，并直接展示双方胜负、加减分、胜方与结果类型。V2→V3 停机迁移工具和 runbook 保留为历史审计与重现资料，V4 不使用该迁移路径。
- 赛季卡牌使用率首批已落地：排位注册事务会将双方锁定主卡组规范化为长期观察事实，不同罕度按基础编号合并，并保留未来卡组聚类所需的稳定构筑指纹。玩家页按赛季展示最终有效对局的 Top 30；管理员对局处理页可按需展开双方长期主卡组，并明确标识早期缺失观察的历史对局。使用率先计算每名玩家的采用比例再等权平均，避免高频玩家放大。`0020_add_ranked_deck_observations.sql` 提供持久表，当前赛季可通过默认 dry-run 的停机脚本从尚未被 10 天任务清空的卡组快照回填；回放清理会阻断尚未完整留存的排位候选。能量卡组与逐张实例不属于长期观察；卡组流派饼图和人工分类仍暂缓。
- 首届排位定级纪念徽章已作为可扩展玩家徽章基线落地：首届赛季由持久规则显式绑定，玩家的有效计分对局达到 3 场后在评分结算事务内幂等授予，授予时间和证据固定为当前有效流水中的第 3 场；异常更正可补发但不会撤回已授予纪念。本人可在个人中心徽章展示栏查看，当前不提供公开玩家徽章接口。`0019_add_player_badges.sql` 提供规则与授予记录，历史首届玩家通过默认 dry-run、显式赛季和 ledger revision 校验的停机脚本补发。
- 进行中 V3/V4 赛季已支持受限评分参数修订：15 分钟签名 dry-run 绑定 config 哈希、操作人与 ledger revision；应用只允许 `ACTIVE + PAUSED`、对局/票据/预留/占用清空且冻结环境一致，并在可串行化事务中创建唯一新修订身份、追加指令、全量回算投影/单局快照和保存完整新旧 config 审计。参数恢复也经同一预览/回算路径，不覆写 V1–V4 原始正式身份；V4 可调整成长补偿启用状态、基准分、单局总调整上限、高分局回收分配和过渡宽度，关闭时保留其余成长参数；回算预览按显示名称/用户名展示玩家，不再要求管理员识别 UUID。该增量 schema 由 `0017_add_ranked_rating_revisions.sql` 提供。
- 普通历史读取使用 `/api/battle/match-records...`，只返回对应玩家视角的只读 checkpoint 投影；旧 `/api/online/match-records...` 仅保留为已公开协议的临时 alias。
- 对墙打运行态缺失时可以从最近 authority checkpoint 恢复；正式联机进程重启后恢复进行中对局尚未闭环。

### 前端与数据

- 未登录根路径已从纯登录表单调整为公开产品首页，以真实卡牌和共享对战桌预览建立 Loveca 视觉主题；卡组、对局与观战入口会进入对应任务，需要登录的操作在认证后继续原目标，离线模式直接进入对局准备。首页同时承担非官方中文资讯入口，当前展示带 Bushiroad 来源、发售日期和日本语版标识的近期官方商品。认证外壳、登录后玩家大厅和对局准备页，以及卡组管理/编辑/共享、公共牌桌/房间/排位/观战/历史、账户和管理后台，均已迁移到共享 `ProductHeader` / `PageHeader` 与 workbench/list/form/status 组件语言；顶部导航、公告入口、主题语义色和返回行为已统一，对局准备也包含赛季排位入口。共享卡组和公开观战入口使用同一品牌顶栏；沉浸式对局继续按规范不显示全站主导航。系统字体、400/600/700 字重角色、普通页密度、10px 面板和 8px 控件形状已形成共享 token，并提供 typed 的 Panel、SectionHeading、ActionButton、StatusBadge 与 TextInput 边界；固定主题/视口的 Playwright 截图差异测试覆盖首批代表页面。公开首页和子页面已经按中文文案规范统一“卡组 / 构筑 / 对战 / 对局 / LIVE”等玩家用语，并明确 Love Live! Series Official Card Game 非官方工具身份。
- 本地调试、对墙打、正式联机、远程调试、观战和历史回放继续复用共享 `GameBoard` / `PlayerArea`。
- 公共牌桌、房间联机、对墙打和调试入口复用卡图驱动的合法卡组选择网格与最近使用偏好；主页对局入口仅保留名称与模式标签，公共牌桌收敛为单一“找对手”主操作，候场/确认状态在可用页面区域居中，玩家文案不展示发布批次、状态机或具体分享渠道。
- 正式联机准备页已区分房间外与房间内场景：未进入房间时使用紧凑房间操作栏，不再展示空席位和未来流程；进入后以双席房间控制器集中呈现房间号、双方锁组/准备状态和唯一下一步操作，移动端主操作固定在底部。普通房间准备阶段可“退出房间”；开局猜拳页按沉浸式桌面隐藏返回与退出操作，公共牌桌配对会按到场或开局超时清理。未结束对局“返回大厅”保留房间恢复入口；进行中只保留“返回大厅 / 认输”。私有 `ONLINE_ROOM` 与公共牌桌赛后直接提供双方同意的“再来一局”，返回大厅继续保留房间入口，另以确认式“离开房间”释放占用；赛季排位赛后返回大厅仍释放旧房间占用。公共牌桌会刷新当前票据，并为待确认、创建中和已匹配状态提供明确操作，同一配对只自动引导一次。
- 卡组管理的行级菜单入口已由低识别度的三点图标改为与“编辑”同层级的“更多”文字按钮，复制、分享和删除等菜单行为保持不变。
- 桌面和移动端已完成主要布局、能量牌架、撤销入口、休息室统计、弹层层级、reduced-motion 和异步竞态收口；本地调试与对墙打共用确认式“重开对局”入口，服务端对墙打会封存旧局并沿用锁定卡组快照创建新局。
- 判定面板显式订阅桌面区域与卡牌投影；对墙打或联机中放置、翻开 LIVE 卡后，LIVE 需求预览不再沿用开局时的空区域缓存。
- 卡牌数据已将新推出的官方 BLADE Heart 颜色 `ORANGE` 作为独立指定色，并区分 `GRAY` 无色 Heart 与 `RAINBOW` All Heart；`double` 展开为两个独立 `GRAY` 判心项。当前只保守补齐数据、判定与显示能力，不得因新增颜色而自动扩大旧卡文本明确列出的六色范围。
- 新云端卡组默认包含 12 张 `LL-E-001-SD` 能量卡，并支持复制为新版本、分享管理与 DeckLog/YAML 导入。
- 已登录用户可从首页进入个人中心，修改用户名、显示名称和密码；邮箱换绑采用新邮箱确认后生效并撤销旧会话的流程。
- 当前候选版本为 `3.9.3`。发布、镜像、数据库迁移和卡牌同步仍按 release skill、runbook 与 migration notes 执行，不能从本文件的旧窗口描述推断生产状态。

### AI 对战

- AI 对战 Phase 0 已完成：冻结 `loveca.deck-content/v1` canonical schema、SHA-256 公共内容身份入口、μ's 预组/绿莲 6 弹两个精确内容哈希、规则/权威卡牌数据/场景/证据版本键、八个卡组角色/先后手基础单元、确定性保守排序、双层进展语义和数值化 headless 门槛。
- 两套卡组已按日文权威卡文逐能力段核对 definitions，并要求全部通过 `baseCardCodes` 覆盖、标记为 implemented、具有正确来源/队列/触发/卡面限制元数据且在卡效主登记册标为完整或同型完整；每个 `baseCardCode + abilityId` 均绑定实际行为测试证据，八个单元使用权威卡牌数据与正式 `DeckLoader` 完成可重复执行的 `RULES` 流程 smoke。卡效完成状态仍只引用主登记册，Phase 0 证据清单不是第二份完成登记册。
- Phase 1A / 1B / 1C 已完成。Phase 1A typed contract core 覆盖认证范围内的换牌、主要阶段、LIVE 设置、自动判定确认、卡效输入、分数、成功 LIVE 与阶段确认，并提供 contract-local ID、validator、witness、sampler 和安全命令适配；`ai-battle.phase-one-a-window-matrix/v2` 锁定真实状态证据和 Phase 0 能力集合指纹。Phase 1B 已完成按局 FIFO 临界区、显式锁内 capability、lease 获取与重验、SYSTEM expected-revision 提交、`OnlineMatchService` 权威写入收口、公开展示 deadline owner、只消费 typed contract 的保守策略、逐回调单决策调度、双层进展指纹、冻结活性/机器故障终局与去重 `SYSTEM_NOTICE`。Phase 1C 已完成生产安全、测试 seeded 和严格 replay 的规则随机源与权威事实记录，只消费 typed contract 的可复现随机合法策略、版本化失败诊断与严格失败 tape 重放、固定失败种子语料、8 局 PR smoke、模型全程不可用/中局降级整局验证，以及 8 × 32＝256 局专用 headless 回归；每周定时/手动专用 CI 会在失败时上传完整重放 tape。机器可读完成基线见 `phase-one-c-baseline.ts`。
- Phase 2 已完成，当前出站边界已随 Phase 4.5 停机升级为 `ai-battle.observation/v3` / `strategy-context/v4`。它只从对应席位 `PlayerViewState + typed decision contract` 生成绑定 seat/revision/`RULES` 的 allowlist 局面，不输出 match/player/authority object ID、隐藏身份、聊天、权限提示或用户显示文本；v3 为公开成员补充印刷/当前有效费用、BLADE 与 HEART，并为 active effect 保留投影允许的来源卡、控制方和当前可见区域。`strategy-context/v4` 另带 `deck-knowledge/v1` 与 `strategic-objectives/v1`：结构化目标只根据可见局面跨窗口维护 LIVE 入口、舞台进展和能量效率，不采信模型自由文本；完整卡组知识按卡号合并张数，包含编号、名称、类型、卡文、费用、BLADE、HEART、LIVE 分数与必要 HEART，但不包含洗牌顺序或实体 ID。`selected-history/v4` 继续按席位保留定长精选可见历史，只从脱敏 observation 与权威接受后的结构化策略决策增量生成；已跳过的可选时点会明确记录为已经结束、不能延后再用。无 LLM 的 `explainable-policy/v1` 仍提供保守 witness；特殊登场、可跳过的选择以及存在多个合法组合的强制选卡窗口改为 `HEURISTIC` 交给模型，只有唯一合法组合等机械步骤才直接执行。`strategy-decision-audit/v3` / `strategy-decision-record/v4` 记录脱敏上下文与权威执行事实。八个认证卡组/先后手单元各 8 个种子的 64 局专用回归仍保留 14,975 次选择零权威拒绝、14,847 次非空精选历史的 Phase 2 完成证据；机器可读完成基线见 `phase-two-baseline.ts`。
- Phase 3 已完成。`ai-battle.system-participant-identity/v1` 建立不可登录 SYSTEM 身份，并按局绑定精确 YAML 内容哈希、Phase 0 认证版本、decision contract / command adapter、压缩规则、playbook、strategy context、无 LLM 可解释策略及赛前/生命周期政策版本；Phase 4 与 Phase 4.5 按停机升级原则追加模型边界，当前身份为 v8，绑定 v3 observation、v4 strategy context、v5 semantic decision context、v6 model strategy context、v7 request/prompt 与 v3 output；运行时只读当前版本，不保留旧协议 dual-read。卡牌规则与卡牌数据变更由版本发布、Phase 0 认证和 focused tests 共同管理；不另建重复的 runtime 规则语义哈希。`ONLINE` SYSTEM 只有在 `AI_BATTLE` 且存在单一完整认证 binding 时才能建局和进入全局机器调度，普通入口、未绑定或篡改 binding 均被拒绝，`SOLITAIRE` 不进入战术调度。正式主策略只保留 authority progress watchdog，保守策略的 3 回合/256 决策/5 分钟阈值只在真实整局降级后计数。管理员受控入口继续使用标准 `ONLINE` runtime、投影、聊天、历史与共享猜拳规则；八个认证单元均验证自然规则终局、正式策略记录存在、所有策略提交零权威拒绝且未触发机器故障/活性认输。机器可读完成基线见 `phase-three-baseline.ts`。普通玩家入口、LLM 调用和公共牌桌补位不在本阶段范围内。
- Phase 4 已完成；当前模型边界随 Phase 4.5 停机升级为 `model-request-envelope/v7`、`model-system-prompt/v7`、`model-strategy-context/v6` 与 `model-decision-output/v3`。provider 的 system 消息包含可信的压缩规则、输出契约和本局 AI 完整卡组知识；user 消息只包含当前语义局面、服务端结构化战略目标、合法选择和精选历史，不再发送固定卡组 playbook 或硬编码打法指令。模型只必须返回 typed `selection`；`tradeoff` 与 `nextPlan` 是可选、低信任说明，缺失或格式不理想不会否决合法选择。服务端依据通过 typed contract validator 的选择自动派生事实审计引用，模型不返回事实编号，也不能直接返回 `GameCommand`。服务端固定接入 DashScope `qwen3.7-flash`，凭据只从环境读取；机械步骤继续直接处理，战术选择的模型等待移出按局临界区，返回后重验 lease/revision/window。调用具有 12 秒超时、每决策最多两次尝试、状态变化取消、全站/账号/单局并发与速率、单局请求/token/费用上限。协议格式在两次尝试后仍失败时，只为当前步骤使用保守选择，下一步继续尝试模型；供应商不可用、超时或预算拒绝才会在一次玩家可见提示后让本局固定改用保守策略。`strategy-decision-record/v4` 只记录版本、请求哈希、结构化选择、服务端派生事实引用、可选短摘要、执行结果、延迟、token、费用与哈希化 provider request id；不保存完整原始响应、供应商错误、聊天或凭据。每场 AI 对局同时默认维护独立的 `reflection-history/v2` 内存历史，把已经脱敏的当前局面、结构化战略目标、合法选择、显式取舍、后续计划、最终选择和权威执行结果组织为带自动复盘摘要、决策速览与完整审计附录的 Markdown；管理员可在共享桌面中途下载当前快照。该文档不含完整 Prompt、原始响应、聊天、凭据或私有思维链，且不作为后续模型的状态事实。开发环境仍可用 `AI_BATTLE_DEBUG_TRACE_ENABLED=1` 打开更敏感的管理员上下文检查器；其内容仅在当前进程内存中保留，生产环境强制关闭。首页和独立 AI 对战页继续允许登录玩家选择双方固定卡组与 AI 先后手并复用共享桌面；服务端现可按账号返回唯一尚未离开的 AI 对局，应用启动、入口页和创建冲突都会据此回到原局，浏览器不再保存或承担 AI 对局生命周期索引。Phase 4 原有真实 provider 四场景、完整 runtime 整局和浏览器真人换牌后 AI 接手验证继续作为完成证据；新协议需在 Phase 4.5 重新评测。机器可读完成基线见 `phase-four-baseline.ts`；公共牌桌 AI 补位仍属于 Phase 5。
- Phase 4.5“语义决策上下文与服务端事实审计”已进入实施，仍是 Phase 5 之前的最高优先级。`observation/v3`、`strategy-context/v4`、`semantic-decision-context/v5` 与实际送模的 `model-strategy-context/v6` 已按停机升级落地。当前状态按通俗中文组织阶段、双方舞台与下方卡、资源、公开区域、共享处理区和 LIVE 结果；主要阶段会列出当前完整合法动作，并对每个成员登场动作显示支付、换手对象、登场前后舞台、有效费用/BLADE/HEART 合计、下回合换手基础、手牌/休息室变化和本回合成员区锁定。system prompt 的 `compact-rules/v4 + deck-knowledge/v1` 只提供规则约束和本方完整卡组事实，并已明确 `[E]`、冒号前复合费用、完整支付、可选不发动与换手费用差额语义；不再发送两套固定 playbook 的通用策略指令，模型据当前与未来合法空间自行比较。特殊登场、可跳过的卡牌、选项、槽位和站位选择，以及存在多个合法组合的强制选卡不再被通用保守逻辑自动处理，只在真正模型失败时使用保守 witness。精选历史继续区分已完成选择与新近可见变化，并明确跳过的时点已经结束。自送回收 family 已修正强制回收被误作可选的问题，`PL!HS-PR-014-RM` 费用 2「日野下花帆」作为回归样例锁定有合法目标时必须选择。模型现在只选行动，服务端从通过校验的选择派生审计事实；可选说明会规范化或丢弃，不回灌事实历史。管理员上下文检查器继续只在开发开关、管理员认证和本人测试局三项条件同时满足时开放。当前 observation/context/history/envelope 版本字符串、完整嵌套 fixture 和 fake model 选择类型仍在多个测试中重复维护；主设计已将“集中版本清单 + 分层 builder + 通用 fake model + 少量出站契约快照”列为继续扩大语义覆盖前的测试基建收口。当前尚未完成这项收口、更广泛的服务端动作事实审计覆盖、真实 provider v7 协议评测和更广真人抽样复盘，因此 Phase 4.5 仍为 `IN_PROGRESS`。

## 当前事实来源

| 主题               | 权威来源                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目范围与产品能力 | `docs/PROJECT_REQUIREMENTS.md`、`docs/system-design.md`                                                                                                                                                                                                                                                                                                                                               |
| 对战模式与只读边界 | `docs/battle-mode-purpose-and-boundaries.md`                                                                                                                                                                                                                                                                                                                                                          |
| 联机现状与限制     | `docs/online-mode/preparation.md`、`docs/current-limitations.md`                                                                                                                                                                                                                                                                                                                                      |
| 对局记录与回放     | `docs/match-replay/requirements.md`、`docs/match-replay/design.md`、`docs/match-replay/serialization-contract.md`                                                                                                                                                                                                                                                                                     |
| 卡效完成状态       | `docs/card-effect-reuse-audit/existing_module_map.md`                                                                                                                                                                                                                                                                                                                                                 |
| 卡效开发规范       | `AGENTS.md`、`docs/card-effect-framework/`、`docs/card-effect-reuse-audit/`                                                                                                                                                                                                                                                                                                                           |
| AI 对战阶段基线    | `src/server/ai-battle/phase-zero-baseline.ts`、`src/server/ai-battle/phase-one-a-window-evidence.ts`、`src/server/ai-battle/phase-one-b-baseline.ts`、`src/server/ai-battle/phase-one-c-baseline.ts`、`src/server/ai-battle/phase-two-baseline.ts`、`src/server/ai-battle/phase-three-baseline.ts`、`src/server/ai-battle/phase-four-baseline.ts`、`src/server/ai-battle/phase-four-five-baseline.ts` |
| 版本与发布         | `VERSION`、package 版本、release runbook、`drizzle/migration-notes/`                                                                                                                                                                                                                                                                                                                                  |
| 历史施工过程       | Git 提交历史                                                                                                                                                                                                                                                                                                                                                                                          |

## 仍有效的主要缺口

1. 全卡池完整自动裁判、完整 trigger matcher 接线和更广泛的事件语义仍需按真实卡效分批推进。
2. 正式联机运行态持久恢复、完整随机记录、完整 decision record、自由拖拽/手动处理原因结构化和确定性重演尚未闭环。
3. 公共牌桌 Beta 的进行中房间跨进程恢复、开局到场超时后的无过错方自动回队、完整指标聚合与运行后台仍需收束；赛季排位首版、V1 生产开放、当前赛季 V3 切换及基础运营概览已经完成，当前缺口是外部告警渠道、跨日运营趋势以及 V4 新赛季上线前的回放参数验证；生产报告仍不能细分旧样本中 34 条非终局记录的具体状态。AI 对战已完成 Phase 0～4，Phase 4.5 已覆盖主要阶段/LIVE 设置、active effect 来源、可选费用、可见目标、历史优先级、站位编排、复合分组选择与 LIVE 结算语义，真实 provider 新协议评测和真人抽样质量回归仍未完成；其完成前不推进 Phase 5。Phase 5 的公共牌桌补位、presence、多实例互斥、进行中恢复、跨实例模型容量与运营监控也尚未实现。
4. 非对局页面已进入统一视觉系统，首批 macOS 固定主题/视口截图基线已建立；仍需在统一 Chromium 与 CJK 字体环境补 Linux CI 基线、扩大代表页面覆盖，并在不改变规则桌内部布局的前提下推进对局外层 UI。
5. 前端仍有大 chunk 告警，后续需要继续拆分由全局 store 拉入的 battle runtime。
6. 发布、镜像推送、生产迁移、卡牌数据正式同步和对象存储写入均是独立高风险动作，必须按对应流程取得授权。

## 下一步优先级

1. 继续收束 AI 对战 Phase 4.5：先按主设计 11.5 节完成测试基建收口，集中协议版本，建立相互分离的场景/observation/语义/envelope builder 与通用 fake model，把完整快照限制在真实出站边界；随后在已落地的当前状态/精选历史分层、场上成员/手牌/能量/休息室资源比较、主要阶段/LIVE 设置后果、自送成员即时费用、active effect 来源/可选费用/可见目标、站位编排、复合分组选择、LIVE 处理语义、服务端派生事实审计和管理员实际请求上下文检查器之上，继续扩展能力归属/站位/资源后果的服务端审计覆盖，并执行真实 provider v7 请求协议评测与更广真人抽样复盘；优先重放首回合 `PL!HS-PR-014-RM` 费用 2「日野下花帆」登场后的主要阶段，验证模型能保留场面，或确实选到足以补偿离场的即时收益。策略质量以选择与当前事实一致、资源取舍合理和连续对局表现验证；可选说明仅用于调试与评测，不作为合法选择的运行时否决条件，不建设通用收益值或后悔值裁决器，也不解析私有思维链。
2. Phase 4.5 完成后再进入 Phase 5，设计公共牌桌 AI 补位政策、玩家拒绝权、双方确认、AI presence、多实例决策互斥、进行中恢复、跨实例模型容量与运营监控；此前不把 AI 自动放入真人候场。
3. 赛季排位下一步是用已有对局数据回放验证 V4 的排行榜分布、单局极值和玩家时段净变化，并在现有运营概览基础上补齐外部告警与跨日趋势。
4. 公共牌桌继续收束配对确认超时、房间引导失败恢复、开局失联恢复、维护状态矩阵和聚合指标读取。
5. 卡效开发继续以主登记册选择能推进真实事件边界、when-if、selector、公开/检视 workflow 或 LIVE modifier 的样例；每张卡实时更新登记册和 focused tests。
6. 继续缩小 runner 胶水和重复 workflow，但只在出现第二个真实样例时晋升 shared family，不建立任意步骤解释器。
7. 继续完善 LIVE 自动判定、效果顺序、撤销、每回合限制和跨回合事件边界测试。
8. 回放方向只维护当前需求、设计和序列化契约；已完成阶段不再新增实施流水账。
9. UI 统一下一步只收束对局外层导航、状态与品牌外壳，不改变 `GameBoard` / `PlayerArea` 的规则布局；同时持续维护非对局页面的多主题、多视口截图基线。
