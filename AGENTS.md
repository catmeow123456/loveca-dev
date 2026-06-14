# Loveca Battle Agent Guide

本文件给后续接手本项目的 AI / Codex 使用。开始任何开发前，先读本文件，再读最新的 `PROJECT_PROGRESS_TODO_*.md`。

## 项目定位

- 本项目目标是实现 Loveca 的本地测试桌面、规则流程、卡牌效果和后续联机对战能力。
- 当前重点是“规则正确 + 玩家视角可测”，不是先做完整线上产品形态。
- 本地测试桌面和正式网页桌面共用 `GameBoard` / `PlayerArea`，不要把测试界面做成另一套分叉 UI。

## 常用入口

- 仓库目录：`/Users/meiyikai/Desktop/文件/个人/codex/loveca/loveca_battle`
- 当前本地测试页面通常在：`http://localhost:5173/`
- 用户通常会在 Codex in-app browser 中自己操作页面测试。如果需要用户测试，直接说明要测什么，不要擅自推进复杂对局。

## 聊天输出约定

- 在聊天更新和最终回复中提到具体卡牌编号时，同时写清费用/分数与卡名。成员卡格式示例：`PL!SP-bp4-008-P` 费用 13「若菜四季」；LIVE 卡格式示例：`PL!-sd1-019-SD` 分数 4「START:DASH!!」。
- 需要提交代码或创建 PR 时，commit message 和 PR title 都用中文。
- 卡效完成状态的主登记册是 `docs/card-effect-reuse-audit/existing_module_map.md`，按基础编号记录完整/部分/同型/partial 状态。每完成一张卡或一个效果段，优先实时更新该登记册，记录基础编号、费用/分数、卡名、同编号罕度覆盖、已实现段、暂未实现段、复用模块与测试文件。

## 卡效批处理文档节奏

连续实现多张卡效时，默认采用“快速卡效批处理模式”，不要每张卡都全量刷新设计类文档。

必须实时更新：

- `docs/card-effect-reuse-audit/existing_module_map.md`：主登记册，每张卡/每个效果段落地后更新。
- focused tests：对应能力登记、关键结算路径、同编号罕度同步或真实数据形态必须覆盖。
- `PROJECT_PROGRESS_TODO_20260612.md`：每个工作窗口只写短记录，列出本窗口完成卡牌、关键 bugfix、验证命令与下一步；不做长篇设计重写。

可以攒到 5-10 张卡后统一更新：

- `docs/card-effect-framework/card_effect_framework_design.md`
- `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`
- `docs/card-effect-reuse-audit/effect_module_coverage.md`
- `docs/card-effect-reuse-audit/card_effect_batch_expansions.md`
- `docs/card-effect-reuse-audit/module_gap_list.md`
- `docs/card-effect-reuse-audit/safe_refactor_plan.md`

例外：如果本批引入新抽象、新模块、新事件边界，或改变 resolver / cost calculator / live modifier registry / 同编号罕度同步机制，应在同一批内同步更新相关设计、覆盖和 gap 文档。若只是复用既有模块追加同构卡效，先保持主登记册与测试准确，把设计文档留到批末收束。

## 本地测试卡组与卡图

- 本地测试卡组 YAML 放在 `assets/decks/`。当前默认测试入口 `client/src/lib/localTestData.ts` 静态加载 `系统边界混合.yaml` 作为玩家1、`缪预组.yaml` 作为玩家2；`蓝紫.yaml` 仍保留为可切换测试资产，但不再是默认本地对局。
- 本地测试卡图下载脚本是 `scripts/download-local-test-card-images.mjs`。脚本会自动扫描 `assets/decks/*.yaml` / `*.yml`，从 `llocg_db/json/cards.json` 与 `llocg_db/json/cards_cn.json` 找图片元数据，下载原图到 `assets/card/`，并压缩到 `assets/images/{thumb,medium,large}/`。
- 本地测试卡牌数据源由 `scripts/generate-local-test-card-sources.mjs` 从所有 `assets/decks/*.yaml` / `*.yml` 自动生成到 `client/src/lib/localTestCardSources.generated.ts`。新增或删除本地测试卡组后，先跑生成脚本，再跑卡图下载脚本。
- 当前三套测试卡组需要 79 张唯一卡图；`assets/card/` 保存原 PNG，`assets/images/` 保存三档 WebP。
- 2026-06-14 起，为了让作者提供的一键测试环境更接近真实体验，曾临时从 `/Users/meiyikai/Desktop/文件/个人/codex/loveca/deck` 的外部 YAML 测试卡组补齐卡图，并让下载脚本支持 `--deck-dir=...`、同基础编号多罕度展开，以及 `P+` / `L+` 等文件名别名。这个补图方案只服务本地/测试服务器显示，不是生产卡图资产方案。
- 生产环境已有独立图片服务器/对象存储提供卡图；卡效实现与验证不要依赖这些临时图片是否存在。提交或上线前必须检查 `assets/card/` 与 `assets/images/` 的 diff，避免把临时补图作为生产资产带入 PR。若生产图片链路正常，临时补图可在上线前从工作树清理，不影响卡效逻辑。
- 重新生成本地测试卡牌数据源：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/generate-local-test-card-sources.mjs
```

- 预览新增卡组会下载哪些图：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs --dry-run
```

- 实际下载/压缩：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs
```

- 若新测试卡组使用当前 `client/src/lib/localTestCardSources.generated.ts` 未包含的新卡，先运行生成脚本；否则卡图即使存在，本地测试数据也会报“本地测试卡牌数据缺失”。

## 关键架构

- 权威状态与命令处理：`src/application/game-session.ts`
- 低层规则服务：`src/application/game-service.ts`
- 游戏状态实体：`src/domain/entities/game.ts`
- 区域/卡牌状态：`src/domain/entities/zone.ts`
- 费用计算入口：`src/domain/rules/cost-calculator.ts`
- 样例卡效入口：`src/application/card-effect-runner.ts`
- 联机/前端视图投影：`src/online/projector.ts`
- 前端 store：`client/src/store/gameStore.ts`
- 主桌面：`client/src/components/game/GameBoard.tsx`
- 玩家区域：`client/src/components/game/PlayerArea.tsx`

## 当前开发原则

- 规则状态必须通过 `GameSession` / `GameService` / command 层改变，不要让 React 组件直接改权威状态。
- 不要在 React 组件里硬写具体卡效。
- 不要在 action handler 里散落具体卡效。
- 具体卡效目前集中在 `card-effect-runner.ts` 做样例实现，后续应逐步抽象成可扩展 runner。
- 新增卡效前先在 `card-effect-runner.ts` 的 `CARD_ABILITY_DEFINITIONS` 中按规则分类登记，不要先写单卡散逻辑。
- 新增卡效时必须先用 `llocg_db/json/cards_cn.json` 或本地卡牌数据确认同基础编号的全部罕度。若同基础编号不同罕度效果文本一致，优先在 `CARD_ABILITY_DEFINITIONS.baseCardCodes` 登记基础编号，并在 resolver / cost calculator / live modifier registry 中使用基础编号判断；不要只给单一罕度写 `cardCodes` 或硬编码 `cardCode === '...-P'`。若只覆盖部分罕度，必须在 `existing_module_map.md` 说明原因。`tests/unit/card-effect-rarity-sync.test.ts` 会阻止 exact `cardCodes` 漏同步同编号罕度。
- 需要隐藏信息时，以 `projector` / visibility / inspection context 控制前端可见性。
- 本地测试和正式网页桌面应尽量复用同一套组件和命令，不做“双轨 UI”。
- 自动费用、撤销、检视区、效果弹窗等交互应以玩家视角自然为优先，但底层仍要记录可审计动作。
- 需要按左/中/右区域限定触发或适用的能力，优先在 `CARD_ABILITY_DEFINITIONS.requiredSourceSlots` 声明条件，并由触发入队阶段写入/检查 `PendingAbilityState.sourceSlot`；不要在单卡 resolver 中散落硬编码槽位判断。

## 卡效分类约定

- `CONTINUOUS`（常时）：不进效果队列，由对应计算层读取持续修正，例如声援张数、分数、必要 Heart 修正等。
- `ON_ENTER`（登场）：来源为刚登场成员，触发 `ON_ENTER_STAGE`，必须进入待处理效果队列。
- `ACTIVATED`（起动）：来源为舞台成员，由玩家在合法时点主动点击；费用、次数限制和目标选择在命令层/runner 校验。
- `LIVE_START`（LIVE开始）：来源可以是舞台成员或当前 LIVE 区的 LIVE 卡，触发 `ON_LIVE_START`，必须进入 LIVE 开始效果队列，由玩家选择同一时点顺序。
- `LIVE_SUCCESS`（LIVE成功）：来源为成功的 LIVE 卡或满足条件的卡，必须在对应 Live 成功后才进入 LIVE 成功效果队列。
- `AUTO`（自动）：其他诱发型自动能力按具体 `TriggerCondition` 入队，不应伪装成常时或结算时静默修正。

## 卡效步骤约定

- “可以将 N 张手牌放置入休息室：……”属于通用发动代价/费用步骤，不是具体卡牌特例。
- 当前 N=1 的手牌弃置步骤统一使用 `card-effect-runner.ts` 中的 `createDiscardHandToWaitingRoomActivationEffect` 创建选择步骤，并用 `src/application/effects/effect-costs.ts` 中的 `moveHandCardToWaitingRoomForEffect` 执行移动。
- 卡效发动费用应优先登记/执行为通用 `EffectCostDefinition`，当前已覆盖 `DISCARD_HAND_TO_WAITING_ROOM`、`TAP_ACTIVE_ENERGY`、`SEND_SOURCE_MEMBER_TO_WAITING_ROOM`、`SET_SOURCE_MEMBER_ORIENTATION`。新增 `[E]`、弃手、自送休息室、自身待机/活跃等费用时，先扩展/复用 `src/application/effects/effect-costs.ts` 的 `payImmediateEffectCosts` 或 `paySelectedDiscardHandCost`，不要在单张卡里手写横置能量、移动手牌、清空成员槽位或改变来源成员状态。
- 这类步骤的选择区文案应明确为“请选择要放置入休息室的卡牌”，跳过按钮应为“不发动”，不要写成“请选择要处理的卡牌”或“不加入”。
- 后续支持 N>1、指定名称/颜色/类型的手牌弃置时，应扩展同一个步骤 helper，而不是在单张卡效果里临时写 UI 文案和移动逻辑。
- “检视卡组顶 N 张 -> 选择其中若干张 -> 可选公开 -> 加入手牌 -> 其余放置入休息室”也是通用步骤；当前基础区域操作已落在 `src/application/effects/look-top.ts`，不要只为 `PL!-sd1-004-SD`、`PL!-sd1-015-SD` 或 `PL!-sd1-019-SD` 单独写检视/清理/移动流程。
- “抽 N 张牌”作为卡效步骤时，优先复用 `src/application/effects/draw.ts` 的 `drawCardsFromMainDeckToHand`。当前该 helper 只表达卡效步骤里的“主卡组顶 -> 手牌”，不接管开局/阶段/LIVE 判定等规则流程抽牌；涉及牌库为空后的刷新处理时，应先确认要保持的规则语义，不要悄悄改变既有流程。
- “抽 N 张后弃 1 张手牌”作为卡效步骤时，优先复用 `card-effect-runner.ts` 的 `startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect` 壳，并由它组合 `drawCardsFromMainDeckToHand` 与 `moveHandCardToWaitingRoomForEffect`。当前 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场用它验证 F02；后续弃 M 张时再扩多选，不要复制单卡流程。
- 能量区卡效步骤优先复用 `src/application/effects/energy.ts`。从能量卡组放置能量到能量区使用 `placeEnergyFromDeckToZone`；将能量变为待机/活跃使用 `setEnergyOrientation` / `setFirstEnergyCardsOrientation`。这些 helper 明确接收目标方向状态；`PL!SP-PR-004-PR` 费用 4「唐 可可」使用它从能量卡组顶放置 1 张待机能量，`PL!SP-bp4-008-P` 费用 13「若菜四季」右侧登场使用它将最多 2 张待机能量变为活跃，不改变普通能量阶段默认活跃放置逻辑。
- 能量没有个体差异；卡效需要处理 N 张能量时，默认由规则层按能量区顺序自动取符合条件的能量，不让玩家逐张选择具体能量卡。若卡牌文本存在“成员或能量”等分支选择，只保留分支选择；选择能量分支后直接处理能量。
- “从某区域按条件选择卡 -> 移动到目标区域”属于通用目标选择/移动步骤。当前已由 `src/application/effects/zone-selection.ts` 的 `ZoneCardSelectionConfig` / `moveSelectedCardsFromZone` 覆盖 `WAITING_ROOM -> HAND` 的单选路径，并由 `src/application/effects/card-selectors.ts` 提供 `typeIs` / `groupIs` / `unitIs` / `unitAliasIs` / `unitAliasOrTextAliasIs` / `costLte` / `costGte` / `cardNameIs` / `cardNameAliasIs` / `and` 等最小 selector；新增从休息室回收成员/LIVE、按费用/团体/小组/名称筛选等效果时，优先扩展这个底座，不要在单张卡里重复写移出休息室和加入手牌。小组名条件默认使用 `unitAliasIs` 匹配真实 `unitName`，当前别名覆盖 `Cerise Bouquet`/`スリーズブーケ`、`DOLLCHESTRA`、`Mira-Cra Park!`/`みらくらぱーく！`/`みらくらぱーく!`、`EdelNote`；只有需要处理“所有领域中此卡视为……”等文本身份时，才使用 `unitAliasOrTextAliasIs`。成员名条件默认优先用 `cardNameAliasIs`，当前按卡库常见角色覆盖中日名、空白/中点差异与组合卡 `&` 分隔组件；需要严格卡面名完全一致时才用 `cardNameIs`。
- “按条件选择舞台成员 -> 改变成员状态”已由 `src/application/effects/stage-member-target-selection.ts` 起步：用 `stage-targets.ts` + `card-selectors.ts` 生成候选 active effect，并在结算时调用 `setMemberOrientation`。新增选择自己/对方舞台成员并变为待机/活跃的效果时，优先复用该配置入口。
- “成员变为待机/活跃”与“站位变换”作为卡效步骤时，优先复用 `src/application/effects/member-state.ts` 的 `setMemberOrientation` / `moveMemberBetweenSlots`。普通规则流程里的自由横置、拖拽、手动区域移动仍归 `GameSession` / action handler / `zone-operations.ts`，不要为了卡效抽象反向改写桌面规则流程。
- “将此成员从舞台放置入休息室”作为发动费用时，仍优先走 `src/application/effects/effect-costs.ts` 的 `SEND_SOURCE_MEMBER_TO_WAITING_ROOM`；不要和 S01/S02/S05 的状态/站位步骤混成同一个概念。
- 若效果文本写“公开并加入手牌”，必须先把被选牌加入 `inspectionZone.revealedCardIds`，等待玩家确认后再移动到手牌；不能直接加入手牌。
- 若效果文本写“将 1 张加入手牌”而不是“可以将 1 张加入手牌”，选择阶段应强制选择；只有没有合法目标时才允许不选。

## 卡效高频场景底座

2026-06-12 已对 `llocg_db/json/cards_cn.json` 全量 2032 张卡做过一次只读统计，其中 1381 张有中文效果文本。高频动作包括：`手牌放置入休息室` 340 次、`检视自己卡组顶` 154 次、`公开并加入手牌` 74 次、`加入手牌` 384 次、`其余的卡片放置入休息室` 162 次、`从自己的休息室...加入手牌` 182 次、`将此成员从舞台放置入休息室` 60 次、`[E]` 费用 180 次、`LIVE开始时` 397 次、`LIVE成功时` 45 次、`分数+1/＋１` 约 131 次、`必要HEART减少` 18 次。

因此后续优先抽象这些共性场景：

- 时点与队列：`ON_ENTER`、`ACTIVATED`、`LIVE_START`、`LIVE_SUCCESS`、`AUTO` 按规则分类登记；同一时点多效果必须走待处理队列/顺序选择。
- 同一队列中玩家手动点选“无需选择对象/无需支付/无需决定”的 pending ability 时，优先走通用 confirm-only active effect：只展示来源卡、效果文本和“继续处理”按钮，确认后才真正 resolve；玩家点“顺序发动”时不逐个弹此确认壳。
- 发动费用/代价：手牌放置入休息室、公开手牌、支付能量、此成员从舞台放置入休息室都应是可复用步骤。
- 检视/公开/移动：私密检视、公开翻牌、选择目标、公开被选目标、加入手牌、其余入休息室、放回卡组顶/排序应拆成可组合步骤。
- 区域检索：从休息室按类型、费用、团体、名称等筛选加入手牌应共用筛选与移动逻辑。
- LIVE 修正：加 Heart、加分、加声援张数、增加/减少必要 Heart 等都应进入 LIVE 自动判定流水线，而不是在 UI 手填结果里静默处理。
- Live 修正统一入口为 `domain/rules/live-modifiers.ts`。结算读取使用 `collectLiveModifiers` 及相关 getter；新增“Live 结束前”临时修正应通过 `addLiveModifier` / `replaceLiveModifier` 写入 `liveResolution.liveModifiers` 的 `SCORE` / `HEART` / `BLADE` / `REQUIREMENT` modifier；常时修正（如 `PL!-sd1-001-SD` 加声援张数）不写入状态，由 continuous modifier registry 按当前场面动态收集。旧的 `playerScoreBonuses`、`playerHeartBonuses`、`liveRequirementReductions`、`liveRequirementModifiers` 只作为兼容投影保留，不作为新增逻辑的主写入路径。
- “必要HEART增加/减少”类效果应使用 `applyHeartRequirementModifiers`；它支持粉/黄/紫等指定颜色，也支持泛用/无色/All 需求，并兼容 `RAINBOW` 条目和 `totalRequired` 表达的两种数据形态。`PL!-sd1-022-SD` 这种减少 `[無ハート]` 的效果只是其中的 All 需求负修正。
- 前端判定面板读取必要 Heart 修正时要注意投影键：`playerViewState.match.liveResult.requirementModifiers` / `requirementReductions` 当前以 `obj_<cardId>` 为 key，而桌面组件通常使用 raw `cardId`。读取时必须兼容 raw/public 两种 key，否则 `022` 这类效果会在 UI 预览里显示未修正的需求。
- “1回合 N 次”属于能力定义的通用限制，应在 `CARD_ABILITY_DEFINITIONS.perTurnLimit` 登记，由通用 `ABILITY_USE` 记录与校验按 `playerId + abilityId + sourceCardId + turnCount` 计算；它限制的是此来源卡实例，不是同名卡或同一玩家同能力总次数。不要在单张卡效果里临时判断。

## 费用体系约定

- 活跃阶段进入时由规则层自动将当前玩家舞台成员和能量全部恢复为活跃状态；该流程在 `GameService` 的 `UNTAP_ALL` 自动阶段动作中处理，不应放到前端或具体卡效里补。
- 普通登场/换手成员不弹确认窗口，自动支付费用。
- 自动支付会横置前 N 张可用活跃能量，并记录 `PAY_COST` action。
- `CONFIRM_COST_PAYMENT` / `pendingCostPayment` 底层暂时保留，用于未来真的需要玩家选择支付对象的特殊费用。
- 换手减免通过 `costCalculator` 计算。
- 动态登场费用修正通过 `costCalculator` 计算，不在 UI 或具体命令里临时判断。当前 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已验证手牌中自身按“此卡以外的其他手牌数量”每张 -1 费；这张卡本身不计入数量。`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已验证手牌中自身在舞台存在待机状态『虹咲』成员时 -2 费。

## 撤销约定

- 当前撤销是本地/调试桌面的“广义撤销一步”。
- 撤销通过 `GameSession` 保存权威状态快照实现，最多保留 50 步。
- 撤销覆盖玩家在同一操作时点内的桌面动作，例如登场、自动扣费、拖拽、横置、效果确认等。
- 一旦阶段、子阶段、活跃玩家或等待玩家变化，撤销历史会清空。
- 回合开始自动处理、先后攻操作时点交换、盖牌玩家切换后，不允许新操作者撤销上一时点。
- 远程对战暂不支持撤销。未来如要支持，应做双方同步/同意机制。

## 检视区与效果显示约定

- 翻牌类效果统一优先进入 `inspectionZone`，再执行下一步。
- 公开翻 X 张：双方都看正面，`revealedCardIds` 包含公开牌。
- 自己检视 X 张：控制者看正面，对手看背面。
- 选择后公开其中一张：先控制者看全部，选择后只公开被选牌，再移动到手牌或其他区域。
- 正在处理的效果应在桌面中央显示，标题使用“费用 + 卡名”，正文尽量显示卡牌原效果文本，不要加奇怪解释文案。
- 正在处理的效果如果需要玩家选择卡牌，应优先显示卡图网格，并支持 hover 查看卡牌详情；不要只用文字按钮让玩家猜卡。
- 舞台上可发动的起动效果按钮应显示完整效果文本；可以缩小字号和加宽文本框，但不要用省略号截断规则文本。

## 当前样例卡效

- `PL!-sd1-007-SD`：东条希，费用 7。
  - 登场：公开卡组顶 5 张放入休息室；其中有 LIVE 卡则抽 1。
  - 当前实现会先进入公开检视区，确认后通过 look-top 底座放入休息室；只有翻到 LIVE 时才通过 `drawCardsFromMainDeckToHand` 抽 1，未翻到 LIVE 不抽。
- `PL!-sd1-004-SD`：园田海未，费用 11。
  - 登场：检视卡组顶 5 张，可选 1 张 LIVE 公开并加入手牌，其余放入休息室。
  - 当前实现会先私密检视，选择后公开被选 LIVE，再确认加入手牌。
- `PL!N-pb1-004-P+`：朝香果林，费用 5。
  - LIVE 开始时：公开卡组顶 1 张，费用 9 以下成员加入手牌并进行站位变换，否则放入休息室。
  - 当前实现支持多个 LIVE 开始时效果由玩家选择顺序，也支持“顺序发动”。
- `PL!-sd1-002-SD`：绚濑绘里，费用 2。
  - 起动：将此成员从舞台放置入休息室，从自己的休息室将 1 张成员卡加入手牌。
  - 当前实现会先支付代价，再用卡图网格选择休息室成员；原本休息室没有成员时也可发动并选择自身。
- `PL!SP-PR-004-PR`：唐可可，费用 4。
  - 登场：可将 1 张手牌放置入休息室；如此做时，从能量卡组顶放置 1 张待机能量到能量区。
  - 当前实现复用弃手选择步骤，并通过 `placeEnergyFromDeckToZone` 明确放置为等待状态。
- `PL!SP-bp4-008-P`：若菜四季，费用 13。
  - 登场左侧：抽 2 张卡，将 1 张手牌放置入休息室。
  - 登场右侧：将 2 张能量变为活跃状态。
  - LIVE 开始：可以进行站位变换。
  - 当前实现先登记区域限定条件：左侧 `requiredSourceSlots: [LEFT]` 走抽 2 弃 1 壳，右侧 `requiredSourceSlots: [RIGHT]` 走能量活跃 helper；LIVE 开始走同一 LIVE 开始队列，并复用 `member-state.ts` 的 `moveMemberBetweenSlots` 完成可选站位变换。
- `LL-bp2-001-R+`：渡边 曜&鬼冢夏美&大泽瑠璃乃，费用 20。
  - 常时：手牌中的此成员卡，按此卡以外的自己的手牌数量每张减少 1 费。
  - 当前实现走 `costCalculator` 的登场费用修正底座；手牌只有此卡时仍为 20 费，其他手牌数量足够时最低可降到 0 费。该卡“无法因换手放置入休息室”与 LIVE 开始弃指定姓名手牌获得 BLADE 段尚未实现。
- `PL!N-pb1-008-P+`：艾玛·维尔德，费用 17。
  - 常时：只要自己的舞台存在待机状态的『虹咲』成员，手牌中的此成员卡费用减少 2。
  - 登场：将 1 名舞台成员或 2 张能量变为活跃状态。
  - 当前实现走 `costCalculator` 的登场费用修正底座，并通过舞台成员 `orientation` 与虹咲系列匹配判断条件。登场段复用 `selectableOptions` 做成员/能量分支选择；成员分支调用 `setMembersOrientation` 处理玩家选择的待机成员，能量分支按能量区顺序自动调用 `setEnergyOrientation` 将至多 2 张待机能量变为活跃状态。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」。
  - 常时：手牌中费用 10 的『Liella!』成员登场费用减少 2。
  - LIVE 开始：中心位时，将舞台上所有 Liella! 成员和所有能量变为活跃状态。
  - 当前实现走 `costCalculator` 的舞台来源费用修正：目标必须是 10 费 Liella! 成员，来源可以是舞台上的同名 bp5 千砂都；换手登场时会先应用费用减少，再计算换手减免。LIVE 开始段走同一 LIVE 开始队列，并复用 `setMembersOrientation` / `setEnergyOrientation` 批量活跃成员与能量。
- `PL!S-bp2-006-P` 费用 11「津岛善子」。
  - 登场：可以支付 4 能量；从自己的休息室选择至多 2 张费用合计小于等于 4 的成员卡登场到舞台。
  - 当前实现打开 `S07` 卡效登场底座：先可选支付 4 张活跃能量，再多选休息室成员并逐张选择空成员区登场。该卡效登场不走普通登场费用、不计算换手。非手牌方式登场的成员会通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力；触发入队不写进 `playMembersFromWaitingRoomToEmptySlots` 移动原语。
- `PL!HS-bp1-004-P` 费用 15「夕雾缀理」。
  - 起动：`[1回合1次][E][E][E]`，从自己的休息室将 1 张『莲之空』LIVE 卡加入手牌。
  - LIVE 开始：可以支付 `[E]`；LIVE 结束时为止，每存在 1 张自己的 LIVE 中的卡片，获得 BLADE。
  - 当前实现起动段复用 `perTurnLimit`、`TAP_ACTIVE_ENERGY` 与 `WAITING_ROOM -> HAND` zone-selection；LIVE 开始段用 option 选择支付/不发动，支付 1 张活跃能量后按自己的 LIVE 区数量通过 `addLiveModifier` 写入 BLADE。
- `PL!HS-bp5-019-L` 分数 6「花结」。
  - LIVE 开始：自己的 LIVE 卡区每存在 1 张此卡以外的『莲之空』卡片，此卡所需的必要绿 Heart 减少 2 个。
  - 当前实现登记为 LIVE 卡来源的 `LIVE_START` 队列能力；确认后按 LIVE 区中此卡以外的莲之空卡数量，通过 `replaceLiveModifier` 写入绿色 `REQUIREMENT` modifier。
- `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」。
  - LIVE 开始：自己的休息室存在大于等于 3 张『Cerise Bouquet』LIVE 卡时，此卡分数 +1。
  - 当前实现按基础编号覆盖 `L / L+`，登记为 LIVE 卡来源的 `LIVE_START` 队列能力；确认后条件满足时通过 `addLiveModifier` 写入 `SCORE` modifier。
- `PL!HS-bp1-006-P` 费用 11「藤岛 慈」。
  - 登场：抽 2 张卡，将 1 张手牌放置入休息室。
  - LIVE 开始：可以将 1 张手牌放置入休息室；自己的舞台上存在其他成员的场合，指定 1 个任意 Heart 颜色，LIVE 结束时为止获得 1 个该颜色 Heart。
  - 当前实现登场段复用抽牌 helper 与手牌弃置壳；LIVE 开始段复用弃 1 手牌 active effect、Heart 颜色 option、`addLiveModifier` 写入路径，并在弃手后检查“其他成员”条件，不满足时只支付费用并结束。
- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」。
  - 自动：此成员从舞台放置入休息室时，检视卡组顶 5 张；可以公开并加入手牌 1 张成员，其余放置入休息室。
  - 当前实现打开最小 AUTO / `S08` proving 底座：`ON_LEAVE_STAGE` 入队，复用 look-top 检视/公开/入手/其余进休息室原语。普通手动从舞台进休息室、被换手登场替换、以及自送休息室费用的显式来源都可进入离场 AUTO 入队路径。若同一动作同时产生离场 AUTO 与新成员登场能力，按共享 event window 进入同一个顺序选择窗口。
- `PL!HS-bp6-017-N` 费用 11「日野下花帆」。
  - 自动：此成员从舞台放置入休息室时，可以将 1 张手牌放置入休息室；如此做的场合，从休息室将 LIVE 卡和成员卡至多各 1 张加入手牌。
  - 当前实现复用 `ON_LEAVE_STAGE` AUTO 入队、弃手费用与 `WAITING_ROOM -> HAND` 移动原语；新增选择约束为 LIVE/成员各至多 1 张，来源成员自身进入休息室后也会成为合法成员候选。
- `PL!HS-bp6-004-R` 费用 13「百生 吟子」。
  - 登场 / LIVE 开始：将对方舞台上费用小于等于 9 的 1 名成员变为待机状态。
  - LIVE 开始：可以将 1 张手牌放置入休息室；LIVE 结束时为止获得 BLADE。若因此弃置的是「百生吟子」成员卡，则共获得 BLADE +2。
  - 当前实现复用舞台成员目标 helper、`setMemberOrientation`、可选弃手步骤与 `addLiveModifier`。同一张此卡在 LIVE 开始产生两条待处理能力时，顺序选择窗口会切到具体效果文本 option，避免同源卡图无法区分。

## 桌面 UI 约定

- LIVE 区是 3 个横置槽位。
- 成功 Live 区也是横置卡位。
- 能量区活跃/等待需要视觉区分；等待能量横置。
- 成员卡横置/等待使用 `orientation` 传给通用 `Card`。
- 撤销按钮位于己方成功 Live 卡区下方，不放左上角。
- 对局桌面可显示“已自动化卡效”的轻量卡面标记：只在前端对局组件中给正面卡牌加卡顶中间约 4px 小点和 1px 圆角外描边，当前可处理/可发动时点和描边变亮；不写入卡牌数据库、不影响后端规则。当前实现入口为 `client/src/lib/cardEffectAutomationVisuals.ts`，通用卡牌组件只接收可选 `effectVisualState` prop。默认开启；构建时可设置 `VITE_CARD_EFFECT_VISUAL_MARKERS=false` / `0` / `off` 关闭。若后续所有卡效都已完成并决定剥离，删除该 helper、`CardEffectMarker`、`Card.effectVisualState` prop 以及 `PlayerArea` 中的传参即可，不应影响权威规则状态。

## 推荐验证命令

只在用户要求验证、或你做了容易破坏编译/核心规则的改动时运行。

```bash
pnpm test:run tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

全量验证更重，只有需要时再跑：

```bash
pnpm test:run
pnpm --dir client build
```

## 下一步优先级

1. `PL!HS-bp2-012-N` 费用 5「乙宗 梢」与 `PL!HS-bp6-017-N` 费用 11「日野下花帆」已完成离场 AUTO proving set 的前两张，`PL!HS-pb1-009-R` 费用 15「日野下花帆」已完成中心位监听己方「莲之空」成员登场、实例级每回合 2 次、获得 BLADE 的 AUTO 第一段，LIVE 开始“此成员 BLADE >= 8 则抽2弃1”第二段，以及手动顺序选择时的 confirm-only 无输入确认壳。`PL!HS-bp6-004-R` 费用 13「百生 吟子」已完成登场/LIVE 开始对手低费成员待机、LIVE 开始指定姓名弃手加 BLADE、同源双 LIVE 开始能力区分，并已抽出舞台成员目标选择 active effect 配置入口。`PL!HS-bp1-006-P` 费用 11「藤岛 慈」已完成 LIVE 开始弃手后按其他成员条件选择 Heart；`PL!HS-bp1-004-P` 费用 15「夕雾缀理」已完成起动支付 3 能量回收莲之空 LIVE 与 LIVE 开始支付 1 能量按 LIVE 区数量获得 BLADE；本批 `绿莲-6弹ver.yaml` 已完成 `PL!HS-bp5-019-L` 分数 6「花结」、`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」、`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」、`PL!HS-bp5-008-R` 费用 4「桂城泉」、`PL!HS-pb1-004-R` 费用 4「百生吟子」与 `PL!HS-PR-019-RM` 费用 2「百生吟子」。下一批建议继续从 `绿莲-6弹ver.yaml` 中选择真实 AUTO / LIVE 成功 / LIVE 开始卡，小步扩 `GameEvent` / trigger matcher / when-if / 公开看顶 workflow / 更多移动或状态事件边界。
2. 继续减少 effect runner 的 inline orchestration，但不要直接上大型 resolver DSL。优先把重复出现的 recovery / look-top workflow / Live modifier builder 配置化。
3. Step 12 / Stage 1G 自动能力框架已由离场与登场监听两类 AUTO 最小起步；完整 `GameEvent` / trigger matcher / when-if / 更广泛移动或状态变化事件仍后续分批做。
4. 仍然 inline 的效果要明确标注：`PL!-sd1-006-SD` 公开手牌 + 成功区交换、003/`PL!HS-bp1-006-P` Heart 选项步骤、009/022/001 条件/倍率、Karin catalog continuous 缺口。
5. 继续完善 LIVE 自动判定流水线，确保加棒、加心、加分、必要 Heart 增减、抽卡等结果都进入同一套预判和人工确认入口。
6. 为撤销、LIVE 自动判定、起动次数限制、效果队列顺序补更多边界测试。
