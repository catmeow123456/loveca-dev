# Loveca existing card effect module map

审查日期：2026-06-13  
输入基准：`/Users/meiyikai/Desktop/文件/个人/codex/loveca/references/codex_loveca_reuse_audit_pack.zip` 中的 `loveca_effect_fragments_catalog.json`。  
范围：回扫当前 `CARD_ABILITY_DEFINITIONS` 已登记/实现的 `PL!-sd1` 样例卡、测试用 `PL!N-pb1-004-P+` 与 `系统边界混合` proving card。catalog 中果林卡号使用全角 `P＋`，代码中使用半角 `P+`，本审查按同一张卡处理。

## Catalog segments currently covered

| card | catalog fragments | current implementation status |
|---|---|---|
| `PL!-sd1-001-SD` | `T01,F07,F08,L01,L02,X01`; `T05,L01,L02,B08,X13` | 登场回收走 zone-selection；常时 BLADE 走 continuous live modifier registry。成功 Live 条件仍在 resolver 中。 |
| `PL!-sd1-002-SD` | `T03,C04,F07,F09` | 起动次数/费用/自送休息室/回收成员已走 effect-costs + zone-selection；移动 event 仍待 Stage 1G。 |
| `PL!-sd1-003-SD` | `T01,F07,F09,X04,X06`; `T02,C01,B03,B08` | 登场回收走 selector + zone-selection；Live 开始弃手走 effect-costs，Heart 写入 liveModifiers；Heart 颜色选择步骤仍在 runner。 |
| `PL!-sd1-004-SD` | `T01,F04,X04` | 看顶/检视/剩余入休息室走 look-top 原语；公开后确认加入手牌仍由 runner 串联。 |
| `PL!-sd1-005-SD` | `T03,C04,F07,F08` | 自送休息室和回收 Live 已走 effect-costs + zone-selection。 |
| `PL!-sd1-006-SD` | `T01,C07,L01,L02,X01,X02` | 仍是 inline 特例：公开手牌 Live、成功区 Live 入手、如此做后交换区域。 |
| `PL!-sd1-007-SD` | `T01,F01,F06,X01` | 公开顶 5 与入休息室走 look-top；额外抽 1 走 draw helper；是否翻到 Live 的条件仍在 resolver 中。 |
| `PL!-sd1-008-SD` | `T03,T07,F06,E01` | 每回合一次已统一；支付 `[E][E]` 走 effect-costs；顶 10 入休息室走 look-top top-deck move。 |
| `PL!-sd1-009-SD` | `T02,B05,X01,X04,X05` | Live 开始队列 OK；分数 +1 写入 liveModifiers；休息室 μ's 计数条件仍在 resolver 中。 |
| `PL!-sd1-011/012/016-SD` | `T01,C01,F03` | 共用弃 1 手牌 + 看顶 3 必选 1 流程；底层移动走 effect-costs/look-top，流程参数仍有 card runner 配置。 |
| `PL!-sd1-015-SD` | `T01,C01,F04` | 共用弃手看顶流程；看顶 5、成员 selector、公开后入手已复用 look-top 原语，流程参数仍在 runner。 |
| `PL!-sd1-019-SD` | `T04,F05` | Live 成功队列已实现；看顶 3、任意张按顺序回卡组顶、其余入休息室复用 look-top 原语，ordered workflow 仍在 runner。 |
| `PL!-sd1-022-SD` | `T02,B07,L01,L02,X06,X13` | Live 开始队列 OK；必要 Heart 减少写入 `REQUIREMENT` liveModifier，并投影 legacy 字段；成功 Live 数量倍率仍在 resolver。 |
| `PL!N-pb1-004-P+` | `T05,B08`; `T02,S05,X01,X06,F13` | Live 开始公开顶 1 与站位变换已分别复用 look-top/member-state；catalog 中常时未移动时 +2 BLADE 尚未实现，当前仍标记为测试用 partial sample。 |
| `PL!SP-PR-004-PR` | `T01,C01,E03` | 登场队列 OK；弃 1 手牌复用 effect-costs 选择步骤；能量卡组顶 1 张待机放置复用 energy helper。 |
| `PL!SP-bp4-008-P` 费用 13「若菜四季」 | `T01,F02,E02`; `T02,S05` | 左侧登场 F02、右侧登场 E02、LIVE 开始 S05 均已实现：来源槽位条件走 `requiredSourceSlots`，抽弃走 draw + hand discard 壳，待机能量变活跃走 energy helper，LIVE 开始可选站位变换走 `member-state.ts`。测试：`tests/integration/sample-card-effect-runner.test.ts`。 |
| `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下 花帆」 | `T01,F07,F09` | 登场段 `从休息室将1张成员卡加入手牌` 已复用 zone-selection + card-selectors。 |
| `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」 | `X11` | 手牌中的此成员卡按此卡以外的其他手牌数量每张减少 1 费，已复用/扩展 `cost-calculator.ts` 登场费用修正底座；自身不计入数量。暂未实现：无法因换手放置入休息室、LIVE 开始弃指定姓名手牌获得 BLADE。测试：`tests/unit/cost-calculator.test.ts`、`tests/integration/member-cost-payment.test.ts`。 |
| `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」 | `X11`; `T01,X03,S02,E02` | 手牌中的此成员卡在自己的舞台存在待机状态『虹咲』成员时费用减少 2，已复用/扩展 `cost-calculator.ts` 登场费用修正底座；活跃虹咲成员或待机非虹咲成员不触发。登场段已通过 `selectableOptions` 选择成员/能量分支；成员分支复用 `setMembersOrientation`，能量分支不手选具体能量卡，按能量区顺序自动复用 `setEnergyOrientation` 变为活跃状态。测试：`tests/unit/cost-calculator.test.ts`、`tests/integration/member-cost-payment.test.ts`、`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」 | `X11`; `S02,E02` | 舞台上的此成员使手牌中费用 10 的 Liella! 成员登场费用减少 2，已复用/扩展 `cost-calculator.ts` 舞台来源费用修正；换手登场时先应用费用修正，再计算换手减免。LIVE 开始中心位来源会将自己舞台上全部 Liella! 成员与全部能量变为活跃状态，复用 `member-state.ts` 与 `energy.ts`。测试：`tests/unit/cost-calculator.test.ts`、`tests/integration/member-cost-payment.test.ts`、`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!S-bp2-006-P` 费用 11「津岛善子」 | `T01,C03,S07` | 登场可以支付 4 能量，从休息室选择至多 2 张费用合计小于等于 4 的成员登场到空成员区；已打开 `playMembersFromWaitingRoomToEmptySlots` 卡效登场原语。当前边界：不走普通登场费用/换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力。测试：`tests/unit/member-state.test.ts`、`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!HS-PR-001-PR` 费用 10「日野下花帆」 | `T01,C01,F03` | 登场段 `可弃1，检视顶3，选1入手` 已完成：复用 `C01 + discard->look-top`。 |
| `PL!-bp3-010-N` 费用 9「高坂 穂乃果」 | `T01,C01,F04` | 登场段 `可弃1，检视顶5，公开并可选1张 LIVE 卡加入手牌，其余入休息室` 已完成：复用 `C01 + discard->look-top`。测试：`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!HS-bp2-002-P` 费用 13「村野 沙耶香」 | `T01,F07,F09` | 登场段 `从休息室将至多2张费用小于等于2的成员卡加入手牌` 已完成：复用 `zone-selection + card-selectors`，`maxCount=2`。测试：`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!HS-bp1-006-P` 费用 11「藤岛 慈」 | `T01,F02` | 登场后抽2张卡，再将1张手牌放置入休息室。复用 draw helper 与手牌弃置 shell；LIVE 开始弃手给 Heart 段尚未实现。测试：`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!HS-bp2-012-N` 费用 5「乙宗 梢」 | `T06,S08,F04` | AUTO：此成员从舞台放置入休息室时检视顶5，可以公开并加入手牌1张成员，其余放置入休息室。已打开最小 `ON_LEAVE_STAGE` 入队，复用 look-top 检视/公开/入手/其余进休息室；与同一动作的新成员登场能力共享顺序选择窗口。测试：`tests/unit/card-effect-classification.test.ts`、`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!-pb1-019-N` 费用 2「高坂穗乃果」 | `T03,C04,F07,F09` | 起动将此成员放入休息室并回收休息室成员卡。复用 effect-costs 自送 + zone-selection/member selector。测试：`tests/integration/sample-card-effect-runner.test.ts`。 |
| `PL!-bp4-003-P` 费用 2「南琴梨」 | `T03,C04,F07,F08` | 起动将此成员放入休息室并回收休息室 LIVE 卡。复用 effect-costs 自送 + zone-selection/live selector。测试：`tests/integration/sample-card-effect-runner.test.ts`。 |

## Existing reusable modules

| existing module | covered fragments | current boundary | cards using it |
|---|---|---|---|
| `CARD_ABILITY_DEFINITIONS` in `src/application/card-effect-runner.ts` | `T01,T02,T03,T04,T05,T06,T07` | 已集中登记 category、trigger/source zone、queued、per-turn limit 与 cost definitions。resolver dispatch 仍是 switch + card-specific function。 | 当前所有登记卡 |
| Trigger enqueue functions in `src/application/card-effect-runner.ts` | `T01,T02,T04,T06,S08` | 支持登场、Live 开始、Live 成功、离场 AUTO 与同一时点/同事件队列；登场与舞台成员 LIVE 开始会记录来源槽位，能力可通过 `requiredSourceSlots` 统一过滤左/中/右区域条件。离场 AUTO 目前是 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」的最小 proving path，尚不是完整 `GameEvent -> trigger matcher`。 | 001,003,004,006,007,009,011,012,015,016,019,022,Karin,PR-004,Shiki,`PL!HS-bp2-012-N` |
| `src/application/effects/card-selectors.ts` | `X04,X05,X06` | 提供 `typeIs`、`groupIs`、`costLte`、`and/or/not` 等最小 selector。尚未覆盖名称、cardCode 集合、舞台状态、成功区分数等复杂条件。 | 001,002,003,004,005,015,Karin 等 |
| `src/application/effects/zone-selection.ts` | `F07,F08,F09` | 提供 `ZoneCardSelectionConfig`、`createWaitingRoomToHandEffectState`、`moveSelectedCardsFromZone`；当前主力是 `WAITING_ROOM -> HAND`，已支持单选与 `maxCount` 多选配置。 | 001,002,003,005,`PL!-pb1-019-N`,`PL!-bp4-003-P`,`PL!HS-bp2-002-P` |
| `src/application/effects/effect-costs.ts` | `C01,C02,C03,C04,E01` | 提供 `EffectCostDefinition`、弃手选择费用、即时横置能量、自送休息室。移动会记录 action，但还没有标准 `GameEvent`。 | 002,003 Live-start,005,008,011,012,015,016,`PL!-pb1-019-N`,`PL!-bp4-003-P` |
| `src/application/effects/look-top.ts` | `F03,F04,F05,F06,F13` | 提供看顶进入 inspection、清理 inspection、选中入手/其余入休息室、顶牌入休息室等原语；完整流程 orchestration 仍在 runner。 | 004,007,008,011,012,015,016,019,Karin |
| `src/application/effects/draw.ts` + draw-discard shell in runner | `F01,F02` | `drawCardsFromMainDeckToHand` 提供卡效步骤抽牌；`startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect` 组合抽 N 后弃 1。暂不接管开局/阶段/Live 判定抽牌，也不改变当前刷新语义。 | 007,Shiki,`PL!HS-bp1-006-P` |
| `src/application/effects/energy.ts` | `E02,E03` | 提供卡效步骤的 `placeEnergyFromDeckToZone`、`setEnergyOrientation`、`setFirstEnergyCardsOrientation`，表达能量卡组顶到能量区与能量区方向变更。普通能量阶段默认放置逻辑不并入此 helper。 | PR-004,Shiki,`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」 |
| `src/application/effects/member-state.ts` | `S01,S02,S05,S07` | 提供 `setMemberOrientation` / `setMembersOrientation`、`moveMemberBetweenSlots` 与 `playMembersFromWaitingRoomToEmptySlots`。普通规则横置/拖拽仍在 GameSession/action handler；当前 S07 卡效登场只进空槽。 | Karin position change, Shiki live-start position change, `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」, `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」, `PL!S-bp2-006-P` 费用 11「津岛善子」 |
| `src/domain/rules/live-modifiers.ts` | `T05,B03,B05,B07,B08` | `collectLiveModifiers` 是 Live 判定读路径；`addLiveModifier` / `replaceLiveModifier` 是临时 Live 修正主写入路径；legacy maps 作为兼容投影。 | 001,003,009,022,Live judgment |
| `src/domain/rules/live-requirement-modifiers.ts` | `B07` | `applyHeartRequirementModifiers` 负责彩色/泛用/All/Rainbow 必要 Heart 数学。effect 创建逻辑仍在 runner。 | 022,Live judgment tests |
| `src/domain/rules/cost-calculator.ts` | `X11` | 生成成员登场支付方案前先计算登场费用修正，保留基础费用、修正后费用、修正明细、换手减免与最终支付费用；当前支持手牌中自身按其他手牌数量减费、手牌中自身按舞台成员状态/团体条件减费，以及舞台来源修正其他手牌登场费用。 | `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」, `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」, `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」 |
| Active effect UI shape in `src/domain/entities/game.ts` and `client/src/components/game/GameBoard.tsx` | `X03,F05,B03,S05` | 支持 card selection、ordered multi-select、slot selection、option selection；这是 UI/状态形状，还不是 resolver DSL。 | 003 Heart choice,019 ordered top,Karin/Shiki position change,`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」 |

## Compatibility layers still present

| compatibility field/path | why it remains |
|---|---|
| `liveResolution.playerScoreBonuses` / `playerHeartBonuses` / `liveRequirementReductions` / `liveRequirementModifiers` | 现在由 `liveModifiers` 投影维护，供既有 UI/online projection/tests 兼容；新增 Live 修正不应主写这些字段。 |
| `GameService.drawTopMainDeckCard` / debug `DRAW_CARD_TO_HAND` | 规则流程抽牌和桌面调试命令暂不并入 card-effect draw helper，避免提前改变刷新/事件语义。 |
| runner 内 resolver switch | 当前仍作为稳定样例入口；等更多步骤模块稳定后再考虑 declarative resolver/step pipeline。 |

## Existing tests by coverage area

| area | tests |
|---|---|
| Ability classification and queue metadata | `tests/unit/card-effect-classification.test.ts` |
| Card selectors | `tests/unit/card-selectors.test.ts` |
| Zone selection/move | `tests/unit/zone-selection.test.ts` |
| Effect costs | `tests/unit/effect-costs.test.ts` |
| Look-top primitives | `tests/unit/look-top.test.ts` |
| Live modifiers | `tests/unit/live-modifiers.test.ts`, `tests/unit/live-judgment-settlement.test.ts`, `tests/unit/heart-live.test.ts` |
| Member state / position change | `tests/unit/member-state.test.ts` |
| Draw helper | `tests/unit/draw.test.ts` |
| Energy placement/orientation helper | `tests/unit/energy.test.ts` |
| Integrated sample behavior | `tests/integration/sample-card-effect-runner.test.ts` |

## Remaining inline behavior to track

- `PL!-sd1-006-SD` C07/exchange flow is still bespoke and intentionally not migrated in Stage 1A-1F.
- 003 Heart color choice uses generic UI shape but not a reusable option-choice effect step.
- 004/015/019/Karin look-top workflows use shared primitives, but step orchestration remains inline.
- 009/022/001 conditions are still hand-written resolver conditions, not condition AST.
- Karin catalog continuous `T05,B08` is not implemented; keep it marked as partial sample unless project decides to implement real card text.
- `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧/右侧登场确认流程仍在 runner 串联，但底层已复用 draw/discard/energy helper；LIVE 开始 S05 已通过通用站位变换壳复用 `member-state.ts`。
- `PL!HS-bp1-006-P` 费用 11「藤岛 慈」LIVE 开始弃手后给 Heart 段尚未实现；登场 F02 已作为 draw-discard 扩样本完成。
- `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」只完成手牌中自身费用减少段；“无法因换手放置入休息室”与 LIVE 开始弃指定姓名手牌获得 BLADE 尚未实现。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已完成手牌中自身费用减少段与登场成员/能量二选一活跃段；后续保留为 X11/X03/S02/E02 回归样例。
- `PL!S-bp2-006-P` 费用 11「津岛善子」已完成 S07 起步段；非手牌方式登场的成员已接入二次 ON_ENTER 入队。
- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」已完成第一条 `ON_LEAVE_STAGE` AUTO；look-top 解析仍在 runner 串联，完整 declarative workflow 与完整 `GameEvent` 层后续再抽。
- Standard movement/events for broader AUTO listeners are still incomplete; Stage 1O only covers the first S08 proving path.
