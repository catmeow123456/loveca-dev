# Loveca existing card effect module map

审查日期：2026-06-13  
输入基准：`/Users/meiyikai/Desktop/文件/个人/codex/loveca/references/codex_loveca_reuse_audit_pack.zip` 中的 `loveca_effect_fragments_catalog.json`。  
范围：回扫当前 `CARD_ABILITY_DEFINITIONS` 已登记/实现的 `PL!-sd1` 样例卡与测试用 `PL!N-pb1-004-P+`。catalog 中果林卡号使用全角 `P＋`，代码中使用半角 `P+`，本审查按同一张卡处理。

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

## Existing reusable modules

| existing module | covered fragments | current boundary | cards using it |
|---|---|---|---|
| `CARD_ABILITY_DEFINITIONS` in `src/application/card-effect-runner.ts` | `T01,T02,T03,T04,T05,T07` | 已集中登记 category、trigger/source zone、queued、per-turn limit 与 cost definitions。resolver dispatch 仍是 switch + card-specific function。 | 当前所有登记卡 |
| Trigger enqueue functions in `src/application/card-effect-runner.ts` | `T01,T02,T04` | 支持登场、Live 开始、Live 成功与同一时点队列。尚不是通用 `GameEvent -> trigger matcher`。 | 001,003,004,006,007,009,011,012,015,016,019,022,Karin |
| `src/application/effects/card-selectors.ts` | `X04,X05,X06` | 提供 `typeIs`、`groupIs`、`costLte`、`and/or/not` 等最小 selector。尚未覆盖名称、cardCode 集合、舞台状态、成功区分数等复杂条件。 | 001,002,003,004,005,015,Karin 等 |
| `src/application/effects/zone-selection.ts` | `F07,F08,F09` | 提供 `ZoneCardSelectionConfig`、`createWaitingRoomToHandEffectState`、`moveSelectedCardsFromZone`；当前主力是 `WAITING_ROOM -> HAND` 单选/可选。 | 001,002,003,005 |
| `src/application/effects/effect-costs.ts` | `C01,C02,C03,C04,E01` | 提供 `EffectCostDefinition`、弃手选择费用、即时横置能量、自送休息室。移动会记录 action，但还没有标准 `GameEvent`。 | 002,003 Live-start,005,008,011,012,015,016 |
| `src/application/effects/look-top.ts` | `F03,F04,F05,F06,F13` | 提供看顶进入 inspection、清理 inspection、选中入手/其余入休息室、顶牌入休息室等原语；完整流程 orchestration 仍在 runner。 | 004,007,008,011,012,015,016,019,Karin |
| `src/application/effects/draw.ts` | `F01` | 提供卡效步骤的 `drawCardsFromMainDeckToHand`，不接管开局/阶段/Live 判定抽牌，也不改变当前刷新语义。 | 007 |
| `src/application/effects/member-state.ts` | `S01,S02,S05` | 提供 `setMemberOrientation` 与 `moveMemberBetweenSlots`。普通规则横置/拖拽仍在 GameSession/action handler。 | Karin position change |
| `src/domain/rules/live-modifiers.ts` | `T05,B03,B05,B07,B08` | `collectLiveModifiers` 是 Live 判定读路径；`addLiveModifier` / `replaceLiveModifier` 是临时 Live 修正主写入路径；legacy maps 作为兼容投影。 | 001,003,009,022,Live judgment |
| `src/domain/rules/live-requirement-modifiers.ts` | `B07` | `applyHeartRequirementModifiers` 负责彩色/泛用/All/Rainbow 必要 Heart 数学。effect 创建逻辑仍在 runner。 | 022,Live judgment tests |
| Active effect UI shape in `src/domain/entities/game.ts` and `client/src/components/game/GameBoard.tsx` | `X03,F05,B03,S05` | 支持 card selection、ordered multi-select、slot selection、option selection；这是 UI/状态形状，还不是 resolver DSL。 | 003 Heart choice,019 ordered top,Karin position change |

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
| Integrated sample behavior | `tests/integration/sample-card-effect-runner.test.ts` |

## Remaining inline behavior to track

- `PL!-sd1-006-SD` C07/exchange flow is still bespoke and intentionally not migrated in Stage 1A-1F.
- 003 Heart color choice uses generic UI shape but not a reusable option-choice effect step.
- 004/015/019/Karin look-top workflows use shared primitives, but step orchestration remains inline.
- 009/022/001 conditions are still hand-written resolver conditions, not condition AST.
- Karin catalog continuous `T05,B08` is not implemented; keep it marked as partial sample unless project decides to implement real card text.
- Standard movement/events for future AUTO listeners are still deferred with Step 12 / Stage 1G.
