# Loveca 当前进度及待办

更新时间：2026-08-01

> 本文件只保留当前基线、仍有效的缺口和下一步。已经完成的逐窗口施工记录不再重复保存；需要追溯时使用 Git 历史。卡效完成状态以主登记册为准，发布与迁移历史以对应 runbook 和 migration notes 为准。

## 当前基线

### 规则与对局

- `GameSession` / `GameService` 继续作为权威状态和命令处理边界；玩家输入统一通过语义化 `GameCommand` 和中央命令政策校验。
- 新对局默认使用权威 `ManualOperationMode=RULES`。本地调试、对墙打和远程调试可在安全时点直接切换；正式联机开启 `FREE` 需要双方协商，观战与回放始终只读。
- 普通登场、换手、费用支付、LIVE 设置、判定、成功 LIVE 选择、卡效 pending/activeEffect 和主要阶段流已经进入共享规则链路；LIVE 设置时点通过独立语义支持盖牌与撤回本轮里侧盖牌，不放宽规则模式的通用区域移动。
- 全卡池完整自动裁判尚未完成；未自动化能力不能依靠 UI 或具体卡牌特例绕过规则边界。

### 卡效框架

- 具体卡效定义集中在 `src/application/card-effects/definitions/index.ts`；单卡与 shared family 分别位于 `workflows/cards/` 和 `workflows/shared/`。
- `card-effect-runner.ts` 的完整卡效 fallback 已清空，只保留调度、生命周期、registry 和尚未迁出的 matcher/relay/trigger 条件胶水。
- 当前已登记的 implemented definition 和基础编号均可在 `docs/card-effect-reuse-audit/existing_module_map.md` 检索；该文件是卡效完成状态的唯一主登记册。
- 新卡效继续优先复用现有费用、检视、区域选择、成员状态、能量、抽弃、声援和 LIVE modifier 底座，不建立大型 resolver DSL。

### 联机、观战与回放

- 正式联机已具备房间号双人房间、云端卡组锁定、双方准备、暗选猜拳、胜者决定先后手、服务端权威命令、轮询同步、请求式撤销/重开、主动认输和短暂断线恢复；认输以 `OPPONENT_SURRENDER` 结束对局并封存为 `SURRENDERED`，适用于普通与公共牌桌房间。
- 房间号观战使用授权玩家视角，支持同会话切换、跨重开等待和最多 10 个普通观战会话；观战不提供命令、上帝视角或对手隐藏信息。
- 正式联机对局已提供按 `matchId` 隔离的轻量局内聊天：双方可以发送纯文本，已授权观战者只读；消息跟随内存中的对局运行态并支持刷新/短暂断线游标补拉，不写入对局状态、历史记录、回放或数据库。
- 正式联机与服务端可记录对墙打已经写入历史根记录、参与者、卡组快照、timeline、authority checkpoint、public/private event 和部分 decision record。
- 完整历史回放默认保留最近 10 天；过期已封存对局可在停机维护窗口清理时间线、检查点、事件、决策与卡组明细，根记录、参与者和卡组来源元信息继续保留并标记为 `METADATA_ONLY`。
- 公共牌桌 Beta 一期已落下首个可运行闭环：PostgreSQL 只保留候场票据、配对预留和跨模式玩家占用三张运行表；锁定卡组直接内嵌在票据中，生命周期事件改走结构化应用日志。其余闭环包括 FIFO 原子认领、双方确认、带短租约和有限重试的封闭房间引导、`PUBLIC_TABLE` 对局来源，以及跨页面等待和确认 UI。公共牌桌自动房间使用 6 位易读房间号，房间号观战与普通房间一致默认开启；卡组数据通过 transport serde 无损保存 `Map` 等运行时类型，并覆盖从 JSONB 往返、猜拳开局到首个玩家快照的回归。联机页在对局快照失败时会保留明确的失败/重试界面。后续仍需在完整测试环境持续验证双浏览器真实流程、进行中房间恢复和运营聚合。
- 公共牌桌经过一段时间的实际使用观察后，玩家已经形成在统一入口持续候场的使用习惯，产品需求验证不再阻止下一阶段排位设计。首个赛季排位按独立赛季页面、固定活跃时段、单一 FIFO 排位池、Glicko rating 和复用正式联机房间的方向推进；休闲公共牌桌与房间号继续不计分。
- 赛季排位 R1 已完成首轮生产影子验证：2026-07-24 至 29 日的 491 局合格公共牌桌对局覆盖 50 名玩家，未显示明显首后手偏差；5 场资格会让仍高 RD 的短期连胜玩家直接进入榜首，因此当前候选提升为 `GLICKO1_PER_MATCH_SHADOW_V2`，只把定位/排行榜门槛提高到 10 场，Glicko 数学参数不变，V1 继续保留用于复现原报告。`glicko-shadow.ts` 可按 `settledAt + matchId` 稳定回放；临时生产脚本仍只读查询 `match_records` 并匿名生成 JSON/Markdown，V2 已补充排除状态与正确的卡牌数据统计口径。现有 `match_records.cardDataHash` 是本局双方卡组快照哈希，不能作为赛季全局卡牌环境身份。详细判断见 `docs/matchmaking-and-ladder/RANKED_SHADOW_REPORT_ANALYSIS_2026-07-30.md`；`SHADOW` 版本不得写入正式积分。
- 赛季排位首版闭环已在代码和本地完整测试环境落地：既有 `GLICKO1_PER_MATCH_V1` 与新赛季默认 `GLICKO1_PER_MATCH_V2` 正式算法（新玩家初始 RD 从 350 轻微下调到 300）、单一 `0010_add_ranked_system.sql` 数据迁移、赛季生命周期/开放窗口、独立排位票据与稳定 FIFO、幂等且可补偿的 `RANKED` 开局绑定、带在线代际保护的断线裁定、权威终局自动结算、追加式 `VOID / REPLACEMENT`、签名更正预览、软重置种子和确定性重建均已实现。排位重连期限为 1 分钟：双方都超时且最后在线时间相差不超过 5 秒时为平台无结果，超过 5 秒时由较早离线方判负；该政策作为不可缺省的赛季公告显示在赛季页、候场状态和局内房间菜单。软重置默认使用新赛季初始积分/RD，草稿期可由管理员选择并参数化向中心值保留公式；策略和参数随竞技环境冻结，种子积分在玩家首场结算前不展示。进入 `FINALIZING` 前已经形成的配对可继续开局，未开局预留消化完之前不能封存；收口任务先排空可靠结算，不能只改数据库状态终止仍在运行的对局。玩家侧已有精简赛季页、跨页面候场/确认、首场积分与变化回显、可配置参榜场次门槛、个人战绩、最近对局和排行榜；管理员侧已有“赛季 / 对局处理”页面，可在草稿或进行中赛季的前端表单配置 1–100 场参榜门槛，并修改名称和开放时段。参榜门槛只筛选排行榜，不改变竞技环境或重算积分；算法、竞技环境与赛季时间等计分事实保持冻结。生产迁移和首季开放尚未执行，详见 `docs/matchmaking-and-ladder/RANKED_INITIAL_IMPLEMENTATION.md`。
- 普通历史读取使用 `/api/battle/match-records...`，只返回对应玩家视角的只读 checkpoint 投影；旧 `/api/online/match-records...` 仅保留为已公开协议的临时 alias。
- 对墙打运行态缺失时可以从最近 authority checkpoint 恢复；正式联机进程重启后恢复进行中对局尚未闭环。

### 前端与数据

- 未登录根路径已从纯登录表单调整为公开产品首页，以真实卡牌和共享对战桌预览建立 Loveca 视觉主题；卡组、对局与观战入口会进入对应任务，需要登录的操作在认证后继续原目标，离线模式直接进入对局准备。首页同时承担非官方中文资讯入口，当前展示带 Bushiroad 来源、发售日期和日本语版标识的近期官方商品。认证外壳、登录后玩家大厅和对局准备页，以及卡组管理/编辑/共享、公共牌桌/房间/排位/观战/历史、账户和管理后台，均已迁移到共享 `ProductHeader` / `PageHeader` 与 workbench/list/form/status 组件语言；顶部导航、公告入口、主题语义色和返回行为已统一，对局准备也包含赛季排位入口。共享卡组和公开观战入口使用同一品牌顶栏；沉浸式对局继续按规范不显示全站主导航。系统字体、400/600/700 字重角色、普通页密度、10px 面板和 8px 控件形状已形成共享 token，并提供 typed 的 Panel、SectionHeading、ActionButton、StatusBadge 与 TextInput 边界；固定主题/视口的 Playwright 截图差异测试覆盖首批代表页面。公开首页和子页面已经按中文文案规范统一“卡组 / 构筑 / 对战 / 对局 / LIVE”等玩家用语，并明确 Love Live! Series Official Card Game 非官方工具身份。
- 本地调试、对墙打、正式联机、远程调试、观战和历史回放继续复用共享 `GameBoard` / `PlayerArea`。
- 公共牌桌、房间联机、对墙打和调试入口复用卡图驱动的合法卡组选择网格与最近使用偏好；主页对局入口仅保留名称与模式标签，公共牌桌收敛为单一“找对手”主操作，候场/确认状态在可用页面区域居中，玩家文案不展示发布批次、状态机或具体分享渠道。
- 正式联机准备页已区分房间外与房间内场景：未进入房间时使用紧凑房间操作栏，不再展示空席位和未来流程；进入后以双席房间控制器集中呈现房间号、双方锁组/准备状态和唯一下一步操作，移动端主操作固定在底部。普通房间准备阶段可“退出房间”；开局猜拳页按沉浸式桌面隐藏返回与退出操作，公共牌桌配对会按到场或开局超时清理。未结束对局“返回大厅”保留房间恢复入口；进行中只保留“返回大厅 / 认输”，赛后“返回大厅”同时释放旧房间占用。公共牌桌会刷新当前票据，并为待确认、创建中和已匹配状态提供明确操作，同一配对只自动引导一次。
- 卡组管理的行级菜单入口已由低识别度的三点图标改为与“编辑”同层级的“更多”文字按钮，复制、分享和删除等菜单行为保持不变。
- 桌面和移动端已完成主要布局、能量牌架、撤销入口、休息室统计、弹层层级、reduced-motion 和异步竞态收口；本地调试与对墙打共用确认式“重开对局”入口，服务端对墙打会封存旧局并沿用锁定卡组快照创建新局。
- 判定面板显式订阅桌面区域与卡牌投影；对墙打或联机中放置、翻开 LIVE 卡后，LIVE 需求预览不再沿用开局时的空区域缓存。
- 卡牌数据已将新推出的官方 BLADE Heart 颜色 `ORANGE` 作为独立指定色，并区分 `GRAY` 无色 Heart 与 `RAINBOW` All Heart；`double` 展开为两个独立 `GRAY` 判心项。当前只保守补齐数据、判定与显示能力，不得因新增颜色而自动扩大旧卡文本明确列出的六色范围。
- 新云端卡组默认包含 12 张 `LL-E-001-SD` 能量卡，并支持复制为新版本、分享管理与 DeckLog/YAML 导入。
- 已登录用户可从首页进入个人中心，修改用户名、显示名称和密码；邮箱换绑采用新邮箱确认后生效并撤销旧会话的流程。
- 当前候选版本为 `3.9.1`。发布、镜像、数据库迁移和卡牌同步仍按 release skill、runbook 与 migration notes 执行，不能从本文件的旧窗口描述推断生产状态。

### AI 对战

- AI 对战 Phase 0 已完成：冻结 `loveca.deck-content/v1` canonical schema、SHA-256 公共内容身份入口、μ's 预组/绿莲 6 弹两个精确内容哈希、规则/权威卡牌数据/场景/证据版本键、八个卡组角色/先后手基础单元、确定性保守排序、双层进展语义和数值化 headless 门槛。
- 两套卡组已按日文权威卡文逐能力段核对 definitions，并要求全部通过 `baseCardCodes` 覆盖、标记为 implemented、具有正确来源/队列/触发/卡面限制元数据且在卡效主登记册标为完整或同型完整；每个 `baseCardCode + abilityId` 均绑定实际行为测试证据，八个单元使用权威卡牌数据与正式 `DeckLoader` 完成可重复执行的 `RULES` 流程 smoke。卡效完成状态仍只引用主登记册，Phase 0 证据清单不是第二份完成登记册。
- Phase 1A / 1B / 1C 已完成。Phase 1A typed contract core 覆盖认证范围内的换牌、主要阶段、LIVE 设置、自动判定确认、卡效输入、分数、成功 LIVE 与阶段确认，并提供 contract-local ID、validator、witness、sampler 和安全命令适配；`ai-battle.phase-one-a-window-matrix/v2` 锁定真实状态证据和 Phase 0 能力集合指纹。Phase 1B 已完成按局 FIFO 临界区、显式锁内 capability、lease 获取与重验、SYSTEM expected-revision 提交、`OnlineMatchService` 权威写入收口、公开展示 deadline owner、只消费 typed contract 的保守策略、逐回调单决策调度、双层进展指纹、冻结活性/机器故障终局与去重 `SYSTEM_NOTICE`。Phase 1C 已完成生产安全、测试 seeded 和严格 replay 的规则随机源与权威事实记录，只消费 typed contract 的可复现随机合法策略、版本化失败诊断与严格失败 tape 重放、固定失败种子语料、8 局 PR smoke、模型全程不可用/中局降级整局验证，以及 8 × 32＝256 局专用 headless 回归；每周定时/手动专用 CI 会在失败时上传完整重放 tape。机器可读完成基线见 `phase-one-c-baseline.ts`。
- Phase 2 已完成。`ai-battle.observation/v1` 只从对应席位 `PlayerViewState + typed decision contract` 生成绑定 seat/revision/`RULES` 的 allowlist 局面，不输出 match/player/authority object ID、隐藏身份、聊天、权限提示或用户显示文本；`strategy-context/v1` 组合版本化压缩规则、绑定两个 Phase 0 精确内容哈希的固定卡组 playbook 与 `selected-history/v2` 的按席位定长精选可见历史。历史只从脱敏 observation 与权威接受后的结构化策略决策增量生成，不回读权威状态、事件日志或聊天，也不保留 contract-local ID；策略决策记录行动席位，纯视图差异只记录受影响席位与“新近可见”事实，不臆测行动者或具体移动原因。无 LLM 的 `explainable-policy/v1` 将窗口分为 `RULE_FORCED / DETERMINISTIC / HEURISTIC`，只消费 strategy context，输出短 reason code/summary 与结构化选择；`strategy-decision-audit/v2` / `strategy-decision-record/v2` 额外锁定 decision contract 与 command adapter 版本，并记录脱敏上下文哈希、哈希化 contract 身份、层级、候选、选择、命令执行结果与规则随机事实引用。`strategy-evaluation/v1` 冻结完成率、拒绝数、历史覆盖、策略层级、成员展开、LIVE 设置与成功 LIVE 选择指标。八个认证卡组/先后手单元各 8 个种子的 64 局专用回归全部完成，14,975 次选择零权威拒绝，14,847 次上下文携带非空精选历史，覆盖率 99.15%；机器可读完成基线见 `phase-two-baseline.ts`。
- Phase 3 已完成。`ai-battle.system-participant-identity/v1` 建立不可登录 SYSTEM 身份，并按局绑定精确 YAML 内容哈希、Phase 0 认证版本、decision contract / command adapter、压缩规则、playbook、strategy context、无 LLM 可解释策略及赛前/生命周期政策版本；Phase 4 在兼容要求之外按停机升级原则将当前身份提升为 v2，追加模型边界版本。卡牌规则与卡牌数据变更由版本发布、Phase 0 认证和 focused tests 共同管理；不另建重复的 runtime 规则语义哈希。`ONLINE` SYSTEM 只有在 `AI_BATTLE` 且存在单一完整认证 binding 时才能建局和进入全局机器调度，普通入口、未绑定或篡改 binding 均被拒绝，`SOLITAIRE` 不进入战术调度。正式主策略只保留 authority progress watchdog，保守策略的 3 回合/256 决策/5 分钟阈值只在真实降级后计数。管理员受控入口继续使用标准 `ONLINE` runtime、投影、聊天、历史与共享猜拳规则；八个认证单元均验证自然规则终局、正式策略记录存在、所有策略提交零权威拒绝且未触发机器故障/活性认输。机器可读完成基线见 `phase-three-baseline.ts`。普通玩家入口、LLM 调用和公共牌桌补位不在本阶段范围内。
- Phase 4 已完成。`ai-battle.model-request-envelope/v1`、`ai-battle.model-system-prompt/v1` 与严格的 `ai-battle.model-decision-output/v1` 只接受 Phase 2 allowlist strategy context，模型输出仍需通过同一 typed contract validator，不能直接返回 `GameCommand`。服务端当前固定接入 DashScope `qwen3.7-flash`，凭据只从环境读取；机械窗口继续直接处理，战术窗口的模型等待移出按局临界区，返回后重验 lease/revision/window。调用具有 12 秒超时、每决策最多两次尝试、状态变化取消、全站/账号/单局并发与速率、单局请求/token/费用上限。成功选择和确认失败通过 `strategy-decision-record/v3` 只记录版本、请求哈希、结构化选择、单行短摘要、执行结果、延迟、token、费用与哈希化 provider request id；不保存完整原始响应、供应商错误、聊天或凭据。确认失败会在一次玩家可见提示后让本局固定改用保守策略。开发环境可用 `AI_BATTLE_DEBUG_TRACE_ENABLED=1` 打开仅参与者可见的局内决策轨迹，展示脱敏短摘要、选择类别、延迟、token、费用和执行结果；轨迹仅保存在当前进程内存，生产环境强制关闭，且不提供私有思维链、完整 Prompt、原始响应或凭据。首页和独立 AI 对战页允许登录玩家选择双方固定卡组与 AI 先后手，明确显示 AI 身份并复用 `GameBoard`；AI 桌面挂载共享局内聊天与终局面板，刷新恢复、离开、同配置重开和历史继续走正式联机链路。Phase 4 已完成真实 provider 四场景、完整 runtime 整局和浏览器真人换牌后 AI 接手验证；模型切换后的真实 provider 复验按同一场景执行。机器可读完成基线见 `phase-four-baseline.ts`；公共牌桌 AI 补位仍属于 Phase 5。
- Phase 4.5“语义决策上下文与事实自检”是当前最高优先级，先于 Phase 5。真实对局已确认现有 v1 上下文虽然能给出正确卡牌、槽位、费用计划和合法 action，但逐动作的来源、替换/保留对象、动作后场面和能力归属仍需模型跨对象拼接；typed validator 只能证明选择合法，不能发现模型把其他卡牌能力或旧场面当成依据。下一阶段将从 allowlist observation 与 typed contract 生成权威派生的语言化局面和逐行动后果，让 LLM 负责卡文理解、取舍和规划；服务端只校验事实引用与合法性，不建设复杂收益值/后悔值引擎。精选历史将停止把模型自由文本摘要当作事实。开发调试窗口将改为管理员专用的实际模型上下文检查器，展示生效的 system prompt、playbook、权威事实、逐行动后果、精选历史、输出约束和解析后结构化结果；普通参与者与生产环境不可访问，也不保存原始 provider 响应、凭据或私有思维链。

## 当前事实来源

| 主题               | 权威来源                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目范围与产品能力 | `docs/PROJECT_REQUIREMENTS.md`、`docs/system-design.md`                                                                                                                                                                                                                                                                                           |
| 对战模式与只读边界 | `docs/battle-mode-purpose-and-boundaries.md`                                                                                                                                                                                                                                                                                                      |
| 联机现状与限制     | `docs/online-mode/preparation.md`、`docs/current-limitations.md`                                                                                                                                                                                                                                                                                  |
| 对局记录与回放     | `docs/match-replay/requirements.md`、`docs/match-replay/design.md`、`docs/match-replay/serialization-contract.md`                                                                                                                                                                                                                                 |
| 卡效完成状态       | `docs/card-effect-reuse-audit/existing_module_map.md`                                                                                                                                                                                                                                                                                             |
| 卡效开发规范       | `AGENTS.md`、`docs/card-effect-framework/`、`docs/card-effect-reuse-audit/`                                                                                                                                                                                                                                                                       |
| AI 对战阶段基线    | `src/server/ai-battle/phase-zero-baseline.ts`、`src/server/ai-battle/phase-one-a-window-evidence.ts`、`src/server/ai-battle/phase-one-b-baseline.ts`、`src/server/ai-battle/phase-one-c-baseline.ts`、`src/server/ai-battle/phase-two-baseline.ts`、`src/server/ai-battle/phase-three-baseline.ts`、`src/server/ai-battle/phase-four-baseline.ts` |
| 版本与发布         | `VERSION`、package 版本、release runbook、`drizzle/migration-notes/`                                                                                                                                                                                                                                                                              |
| 历史施工过程       | Git 提交历史                                                                                                                                                                                                                                                                                                                                      |

## 仍有效的主要缺口

1. 全卡池完整自动裁判、完整 trigger matcher 接线和更广泛的事件语义仍需按真实卡效分批推进。
2. 正式联机运行态持久恢复、完整随机记录、完整 decision record、自由拖拽/手动处理原因结构化和确定性重演尚未闭环。
3. 公共牌桌 Beta 的进行中房间跨进程恢复、开局到场超时后的无过错方自动回队、完整指标聚合与运行后台仍需收束；赛季排位首版功能已完成，剩余前置是预发布/生产迁移演练、告警渠道、运营指标看板、首季配置与 POC 判断口径，生产报告仍不能细分旧样本中 34 条非终局记录的具体状态。AI 对战已完成 Phase 0～4，但 Phase 4.5 的语义决策上下文、事实自检、纯净精选历史、管理员上下文检查器和真实对局质量回归尚未实现；其完成前不推进 Phase 5。Phase 5 的公共牌桌补位、presence、多实例互斥、进行中恢复、跨实例模型容量与运营监控也尚未实现。
4. 非对局页面已进入统一视觉系统，首批 macOS 固定主题/视口截图基线已建立；仍需在统一 Chromium 与 CJK 字体环境补 Linux CI 基线、扩大代表页面覆盖，并在不改变规则桌内部布局的前提下推进对局外层 UI。
5. 前端仍有大 chunk 告警，后续需要继续拆分由全局 store 拉入的 battle runtime。
6. 发布、镜像推送、生产迁移、卡牌数据正式同步和对象存储写入均是独立高风险动作，必须按对应流程取得授权。

## 下一步优先级

1. AI 对战下一阶段为 Phase 4.5：先完成权威局面/行动后果的语言化、模型事实引用与一致性校验、模型摘要与事实历史隔离，以及管理员专用的实际 system prompt/动态上下文检查器；策略质量以事实一致性、取舍完整性、计划连贯性和真人抽样复盘验证，不建设通用收益值或后悔值裁决器。
2. Phase 4.5 完成后再进入 Phase 5，设计公共牌桌 AI 补位政策、玩家拒绝权、双方确认、AI presence、多实例决策互斥、进行中恢复、跨实例模型容量与运营监控；此前不把 AI 自动放入真人候场。
3. 赛季排位下一步是在预发布环境 dry-run 单一 `0010_add_ranked_system.sql`，演练赛季创建、候场开关、自动收口、异常更正和封存，补齐告警/运营指标并冻结首季 POC 口径；经独立发布授权后再执行生产迁移和小规模开放。
4. 公共牌桌方向先在完整测试环境完成双账号端到端验证，补齐配对确认超时、房间引导失败恢复、开局失联恢复、维护状态矩阵和聚合指标读取，再进入外部社群 Beta。
5. 卡效开发继续以主登记册选择能推进真实事件边界、when-if、selector、公开/检视 workflow 或 LIVE modifier 的样例；每张卡实时更新登记册和 focused tests。
6. 继续缩小 runner 胶水和重复 workflow，但只在出现第二个真实样例时晋升 shared family，不建立任意步骤解释器。
7. 继续完善 LIVE 自动判定、效果顺序、撤销、每回合限制和跨回合事件边界测试。
8. 回放方向只维护当前需求、设计和序列化契约；已完成阶段不再新增实施流水账。
9. UI 统一下一步只收束对局外层导航、状态与品牌外壳，不改变 `GameBoard` / `PlayerArea` 的规则布局；同时持续维护非对局页面的多主题、多视口截图基线。
