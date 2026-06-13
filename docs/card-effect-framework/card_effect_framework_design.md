# Loveca card effect framework design

日期：2026-06-13  
状态：设计草案；Stage 1A-1D 已落地，Stage 1E member-state / position-change 已起步，Stage 1F draw 已对当前 μ's 验证集收口。  
目标：面向当前全卡池高频效果片段设计卡效自动化框架，第一阶段用当前已实现的 `PL!-sd1` 与测试用 Karin 效果验证框架。

完整 fragment 覆盖矩阵见 `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`。本文负责说明框架形状；覆盖矩阵负责逐项确认 catalog 中 75 个 fragment 都被纳入设计、预留或 custom hook。

## 1. Design goal

卡效框架不应该只服务 `PL!-sd1`。`PL!-sd1` 的价值是：它已经有一批可运行、可测试、可对照的 golden behavior，适合做第一批迁移样本。

框架本身应面向 `loveca_effect_fragments_catalog.json` 中的全卡池片段，而不是只面向 `PL!-sd1`。下面列表是框架层级摘要；完整 fragment 逐项归属以覆盖矩阵为准：

- 触发/能力壳：登场、LIVE 开始、LIVE 成功、起动、常时、通用自动事件触发、每回合限制。
- 费用/前置动作：弃手、支付能量、自身进休息室、自身待机、复合费用、公开手牌、指定名称/团体弃手、休息室卡回到卡组。
- 检索/移动：抽牌、抽弃、看顶、公开、加入手牌、其余进休息室、控顶、堆墓、休息室回收、声援公开卡处理。
- 状态/站位/登场：成员待机、活跃、对方成员待机、站位变换、从手牌/休息室登场、成员离场/移动触发。
- 能量：支付能量、能量活跃、从能量卡组放置能量、成员下方能量、能量数量条件。
- Live/声援/特殊标记：BLADE、HEART、分数、必要 HEART 修正、ALL_BLADE、SCORE/DRAW 标记、不可进成功 LIVE 区。
- 条件/选择器/结构：类型、团体、名称、费用/分数/必要 HEART 阈值、区域数量、如此做的场合、多选一、身份覆盖、费用修正、能力引用。

原则是：新增卡效优先组合现有模块；如果命中 coverage matrix 中的 `core_v1/core_v2` fragment，应扩展已有模块参数，而不是写单卡逻辑；如果命中 `special_hook`，可以写受控 custom resolver，但 custom resolver 内部仍应复用公共 cost、selector、event、zone move、modifier API。

## 2. Important terminology

`自动` 不能被遗漏。这里建议把能力分成两层概念：

### Ability category

能力大的执行形态：

| category | meaning | examples |
|---|---|---|
| `CONTINUOUS` | 常时能力，不入队，按当前场面动态计算 | 成功 Live 每张得 BLADE |
| `ACTIVATED` | 起动能力，玩家在合法时点主动发动 | `[E][E]` 顶 10 入休息室 |
| `TRIGGERED_AUTO` | 自动/诱发能力，由事件触发并进入待处理队列 | 登场、LIVE 开始、LIVE 成功、移动时、从休息室离开时 |
| `CUSTOM` | 低频或复杂特例，挂接自定义 resolver | 复制能力、改变下一次阶段等 |

### Trigger timing

`TRIGGERED_AUTO` 的具体触发时点：

| trigger | fragment_ids | notes |
|---|---|---|
| `ON_ENTER_STAGE` | `T01` | 登场时能力，本质上是自动诱发的标准时点 |
| `ON_LIVE_START` | `T02` | LIVE 开始时能力 |
| `ON_LIVE_SUCCESS` | `T04` | LIVE 成功时能力 |
| `ON_CARD_MOVED` | future AUTO | 任意卡从区域 A 到区域 B 时 |
| `ON_MEMBER_STATE_CHANGED` | future AUTO | 成员变为待机/活跃时 |
| `ON_ENERGY_PAID` | future AUTO | 支付能量时 |
| `ON_CHEER_REVEALED` | future AUTO | 声援公开时 |
| `ON_PHASE_START/END` | future AUTO | 阶段开始/结束时 |

也就是说，登场、LIVE 开始、LIVE 成功不应该和 `自动` 对立；它们应该是 `TRIGGERED_AUTO` 下最常见、最标准的 trigger。

当前代码中的 `CardAbilityCategory.AUTO` 可以保留为“其他自动诱发”的兼容分类，但长期更建议语义统一为 `TRIGGERED_AUTO + trigger`。

## 3. Proposed ability definition shape

理想情况下，一张卡的效果尽量不是直接写 resolver 函数，而是能力定义 + 模块组合：

```ts
defineAbility({
  id: 'PL!-sd1-004-SD:on-enter-look-five-take-muse-live',
  cardCodes: ['PL!-sd1-004-SD'],
  category: 'TRIGGERED_AUTO',
  trigger: onEnterStage(),
  source: playedMember(),
  mandatory: true,
  steps: [
    lookTopSelectToHand({
      lookN: 5,
      take: upTo(1),
      selector: and(typeIs('LIVE'), groupIs("μ's")),
      revealSelected: true,
      rest: toWaitingRoom(),
      optional: true,
    }),
  ],
});
```

起动能力：

```ts
defineAbility({
  id: 'PL!-sd1-008-SD:activated-pay-two-mill-ten',
  cardCodes: ['PL!-sd1-008-SD'],
  category: 'ACTIVATED',
  source: stageMember(),
  limit: oncePerTurn(),
  cost: [tapActiveEnergy(2)],
  steps: [moveTopDeckToWaitingRoom({ count: 10 })],
});
```

自动能力：

```ts
defineAbility({
  id: 'future-card:auto-when-member-moved',
  cardCodes: ['future-card'],
  category: 'TRIGGERED_AUTO',
  trigger: onCardMoved({
    from: 'MEMBER_SLOT',
    to: 'WAITING_ROOM',
    controller: 'self',
  }),
  condition: sourceMatches(selector.member()),
  steps: [drawCards(1)],
});
```

常时能力：

```ts
defineAbility({
  id: 'PL!-sd1-001-SD:continuous-extra-blade',
  cardCodes: ['PL!-sd1-001-SD'],
  category: 'CONTINUOUS',
  source: stageMember(),
  modifier: liveBladeModifier({
    amount: count(selfSuccessLiveCards()),
  }),
});
```

## 4. Framework layers

### 4.1 Ability registry

职责：

- 记录卡号、能力 ID、分类、来源区域、触发条件、次数限制、展示文本。
- 作为 UI、命令层、runner 的统一事实来源。

当前状态：

- `CARD_ABILITY_DEFINITIONS` 已经是雏形。
- 仍需要把 resolver dispatch 从大量 `switch abilityId` 逐步变成按 `steps` 执行。

### 4.2 Event and trigger layer

职责：

- 所有规则动作、区域移动、状态变化、阶段变化，都生成标准 game event。
- 自动能力通过 trigger matcher 监听 event。
- 同一时点多个自动能力进入 pending queue，由玩家选择顺序。

必要事件示例：

```ts
type GameEvent =
  | { type: 'CARD_MOVED'; cardId: string; from: ZoneRef; to: ZoneRef; reason: 'COST' | 'EFFECT' | 'RULE' | 'MANUAL' }
  | { type: 'MEMBER_STATE_CHANGED'; cardId: string; from: 'ACTIVE' | 'WAITING'; to: 'ACTIVE' | 'WAITING' }
  | { type: 'ENERGY_PAID'; playerId: string; cardIds: string[]; sourceAbilityId?: string }
  | { type: 'PHASE_STARTED'; phase: GamePhase; subPhase: SubPhase }
  | { type: 'LIVE_STARTED'; playerId: string; liveCardIds: string[] }
  | { type: 'LIVE_SUCCEEDED'; playerId: string; liveCardId: string };
```

这是支持未来 `AUTO` 的关键。没有标准事件层，后续“当某卡移动时”“当成员待机时”这类自动能力会被迫散落在具体效果里。

### 4.3 Cost layer

职责：

- 统一支付和记录费用。
- 费用成功与否可被 `X02` “如此做的场合”引用。
- 费用本身也应产生标准 event/action。

P0/P1 覆盖：

| fragment_ids | module |
|---|---|
| `C01,C02` | `discardHand(count, optional, selector?)` |
| `C03,E01` | `tapActiveEnergy(count)` / `payEnergy(count)` |
| `C04` | `moveSourceMemberToWaitingRoom()` |
| `C07` | `revealFromHand(selector, count, optional)` |

### 4.4 Selector and condition layer

职责：

- 不把名称、团体、费用阈值写死在卡牌 resolver 内。
- selector 可以用于检索、费用、条件、目标选择。

基础 selector：

```ts
typeIs('MEMBER' | 'LIVE' | 'ENERGY')
groupIs("μ's")
cardNameIs('高坂 穂乃果')
costLte(4)
scoreGte(3)
hasBladeCountLte(3)
cardCodeIn([...])
and(...)
or(...)
not(...)
```

基础 condition：

```ts
zoneCount('self', 'WAITING_ROOM', selector).gte(25)
successLiveCount('self').gte(2)
previousStepSucceeded()
sourceMovedThisTurn().isFalse()
```

### 4.5 Effect step layer

职责：

- 把高频动作变成可组合步骤。

P0/P1 初始模块：

| fragment_ids | effect step |
|---|---|
| `F01` | `drawCards(count)` |
| `F02` | `drawThenDiscard(drawCount, discardCount)` |
| `F03,F04` | `lookTopSelectToHand(config)` |
| `F05` | `lookTopReorderTopRestWaitingRoom(config)` |
| `F06` | `moveTopDeckToWaitingRoom(count, reveal?)` |
| `F07,F08,F09` | `selectFromZoneToHand(config)` |
| `F13` | `peekOrRevealDeckTop(config)` |
| `S01,S02` | `setMemberState(targets, state)` |
| `S05` | `positionChange(target, destination, swap)` |
| `X03` | `chooseOption(config)` |

### 4.6 Modifier and duration layer

职责：

- 所有 Live 结束前修正统一写入 modifier。
- 常时 modifier 由当前场面动态收集。
- 支持 duration，例如 `untilLiveEnd`、`whileCondition`、`thisTurn`。

P0/P1 覆盖：

| fragment_ids | modifier |
|---|---|
| `B01` | `grantBlade(target, count, duration)` |
| `B02,B03` | `grantHeart(target, color/count, duration)` |
| `B05` | `modifyLiveTotalScore(player, delta, duration)` |
| `B06` | `modifyThisLiveScore(liveCard, delta, condition?)` |
| `B07` | `modifyRequiredHearts(liveCard, modifiers, duration)` |
| `B08,T05` | `continuousPrintedStatsModifier(condition)` |

当前 `liveModifiers` 已成为临时 Live 修正主写入路径；`addLiveModifier` / `replaceLiveModifier` 负责写入，旧 Map 字段只由 `projectLiveModifierCompatibility` 派生给 UI/在线投影兼容。`applyHeartRequirementModifiers` 继续作为必要 Heart 修正的判定读取侧工具。

## 5. How current cards map to the framework

| card | current effect | framework expression |
|---|---|---|
| `PL!-sd1-001-SD` | 登场回收 Live；常时按成功 Live 加 BLADE | `onEnter -> if successLiveCount>=2 -> selectFromZoneToHand(type=LIVE)`；`continuous -> grantBlade(count=successLiveCount)` |
| `PL!-sd1-002-SD` | 起动，自身进休息室，回收成员 | `activated(cost=moveSelfToWR) -> selectFromZoneToHand(type=MEMBER)` |
| `PL!-sd1-003-SD` | 登场回收低费 μ's 成员；Live 开始可弃手得指定 Heart | `onEnter -> selectFromZoneToHand(member & group μ's & cost<=4)`；`onLiveStart -> optional discard -> chooseHeart -> grantHeart(untilLiveEnd)` |
| `PL!-sd1-004-SD` | 看顶 5，公开 μ's Live 入手，其余进休息室 | `lookTopSelectToHand(5, upTo1, live & group μ's, reveal=true, rest=WR)` |
| `PL!-sd1-005-SD` | 起动，自身进休息室，回收 Live | `activated(cost=moveSelfToWR) -> selectFromZoneToHand(type=LIVE)` |
| `PL!-sd1-006-SD` | 可公开手牌 Live，交换成功 Live | `optional revealFromHand(type=LIVE) -> if succeeded -> exchange(handLive, successLive)` |
| `PL!-sd1-007-SD` | 顶 5 入休息室，有 Live 则抽 1 | `moveTopDeckToWaitingRoom(5, reveal=true) -> if movedCards has LIVE -> draw(1)` |
| `PL!-sd1-008-SD` | 起动 1/turn，支付 2 能量，顶 10 入休息室 | `activated(limit=oncePerTurn,cost=tapEnergy(2)) -> moveTopDeckToWaitingRoom(10)` |
| `PL!-sd1-009-SD` | Live 开始，休息室 μ's >=25 时合计分数 +1 | `onLiveStart -> if zoneCount(WR, group μ's)>=25 -> modifyLiveTotalScore(+1, untilLiveEnd)` |
| `PL!-sd1-011/012/016-SD` | 可弃手，看顶 3，必须选 1 入手，其余进休息室 | `optional discard -> lookTopSelectToHand(3, exactly1, any, reveal=false, rest=WR)` |
| `PL!-sd1-015-SD` | 可弃手，看顶 5，可公开成员入手，其余进休息室 | `optional discard -> lookTopSelectToHand(5, upTo1, member, reveal=true, rest=WR)` |
| `PL!-sd1-019-SD` | Live 成功，看顶 3，任意张按顺序放回顶，其余进休息室 | `onLiveSuccess -> lookTopReorderTopRestWaitingRoom(3, chooseAnyOrdered)` |
| `PL!-sd1-022-SD` | Live 开始，按成功 Live 数减少无色必要 Heart | `onLiveStart -> modifyRequiredHearts(color=RAINBOW, delta=successLiveCount * -2)` |
| `PL!N-pb1-004-P+` | 当前只测试 Live 开始效果 | `onLiveStart -> revealTop(1) -> if member cost<=9 then toHand + positionChange else toWR`；常时 BLADE 是已确认暂未实现的样例范围外效果 |

## 6. First implementation stage

第一阶段不要实现全卡池所有模块。建议只做能被当前 golden behavior 验证的框架底座。

### Stage 1A: Recovery and selector

目标片段：`F07,F08,F09,X04,X06`

当前落地：

- `src/application/effects/card-selectors.ts` 提供第一版函数式 selector：`typeIs`、`groupIs`、`costLte`、`and`、`or`、`not`。
- `src/application/effects/zone-selection.ts` 提供第一版 `WAITING_ROOM -> HAND` 单选底座：候选筛选、selection metadata、确认后移动。
- `PL!-sd1-001-SD`、`PL!-sd1-002-SD`、`PL!-sd1-003-SD`、`PL!-sd1-005-SD` 的休息室回收路径已迁入该底座，并补了 001/003/005 golden tests。

做法：

1. 抽出 `selector` 最小 API：`typeIs`、`groupIs`、`costLte`、`and`。
2. 抽出 `selectFromZoneToHand`。
3. 迁移 001、002、003、005。
4. 补 001/003/005 golden tests。

原因：风险低，复用率高，当前已有局部 helper。

### Stage 1B: Cost

目标片段：`C01,C03,C04,E01`

当前落地：

- `src/application/effects/effect-costs.ts` 已提供 `EffectCostDefinition`、`paySelectedDiscardHandCost`、`moveHandCardToWaitingRoomForEffect`、`payImmediateEffectCosts`。
- 当前覆盖 `DISCARD_HAND_TO_WAITING_ROOM`、`TAP_ACTIVE_ENERGY`、`SEND_SOURCE_MEMBER_TO_WAITING_ROOM`，并保持既有自动支付行为。
- 已补 `tests/unit/effect-costs.test.ts`，直接验证弃手、横置活跃能量、自身进休息室并清理成员下方附属卡。

做法：

1. 抽出 `EffectCostDefinition` 与支付函数。
2. 保留当前自动支付行为。
3. 迁移 002、005、008、003 Live-start、011/012/015/016。

注意：费用产生的移动/横置应逐步补标准 event，但第一步可先保持行为不变。

### Stage 1C: Look-top

目标片段：`F03,F04,F05,F06,F13`

当前落地：

- `src/application/effects/look-top.ts` 已提供 `inspectTopCards`、`moveInspectedSelectionToHandRestToWaitingRoom`、`moveInspectedCardsToWaitingRoom`、`moveTopDeckCardsToWaitingRoom`、`clearInspectionCards`。
- 已补 `tests/unit/look-top.test.ts`，直接验证看顶进入检视区、立即公开、选中入手其余入休息室、检视牌全入休息室、卡组顶 N 张直接入休息室、局部清理检视区。
- `PL!-sd1-004-SD`、`PL!-sd1-007-SD`、`PL!-sd1-011/012/015/016-SD`、`PL!-sd1-019-SD`、`PL!N-pb1-004-P+` 的看顶/公开检视入口已开始复用该底座；各自复杂后续结算仍保留在 runner 中。

做法：

1. 抽出 `lookTopSelectToHand`。
2. 先迁移 011/012/016，再迁移 015，再迁移 004。
3. 抽出 `lookTopReorderTopRestWaitingRoom` 迁移 019。
4. 抽出 `moveTopDeckToWaitingRoom` 迁移 007/008。

### Stage 1D: Live modifier

目标片段：`B03,B05,B07,B08,T05`

当前落地：

- `src/domain/rules/live-modifiers.ts` 已提供 `addLiveModifier`、`replaceLiveModifier`、`projectLiveModifierCompatibility`。
- `003` Heart、`009` 分数、`022` 必要 Heart 已改为先写 `liveResolution.liveModifiers`，旧的 `playerHeartBonuses`、`playerScoreBonuses`、`liveRequirementReductions`、`liveRequirementModifiers` 由投影派生。
- continuous modifier registry 已起步，`001` 常时 BLADE 由 `collectLiveModifiers` 按当前舞台与成功 Live 数动态收集，不写入临时状态。
- `tests/unit/live-modifiers.test.ts` 覆盖临时 modifier 写入、替换和兼容投影；既有 Live 判定 / runner tests 覆盖自动判定结果不变。
- 前端判定面板读取 `requirementModifiers` / `requirementReductions` 时需兼容 raw card id 与 `obj_<cardId>` public object id。2026-06-13 修复过一次 022 UI 预览未应用必要 Heart 减少的回归，根因就是该投影键不一致。

后续：

1. 为更多 `B08/T05` 条件型常时修正增加 registry definition。
2. 如出现 `B06`“此 Live 卡分数增加”，扩展 `LiveModifierState` 或细分 `SCORE` target。
3. 若 UI/在线投影完成 `liveModifiers` 原生读取，可逐步删除旧 Map 兼容字段。

### Stage 1E: Member state and position movement

目标片段：`S01,S02,S03,S05`

当前落地：

- `src/application/effects/member-state.ts` 已提供 `setMemberOrientation` 与 `moveMemberBetweenSlots`。
- `setMemberOrientation` 是卡效层 S01/S02 的基础原语，只设置舞台成员的 `ACTIVE` / `WAITING` 状态；普通规则流程的 TAP_MEMBER / 活跃阶段重置仍保留在现有规则层。
- `moveMemberBetweenSlots` 是卡效层 S05 的第一版站位变换原语；它支持移动到空槽，也支持与目标槽位成员交换，并携带双方 `energyBelow` / `memberBelow`。
- `PL!N-pb1-004-P+` 的 Live-start 站位变换已迁入该 helper；`tests/unit/member-state.test.ts` 和 Karin golden test 验证行为不变。
- `SEND_SOURCE_MEMBER_TO_WAITING_ROOM` 仍归 `effect-costs.ts`，作为发动费用/代价处理，不和 S01/S02/S05 混在同一个 helper。

后续：

1. 如果接入“将自身转为待机”或“将成员变为活跃/待机”的卡效，优先接 `setMemberOrientation`，再补对应 effect runner 选择/目标步骤。
2. `S03` 对方成员待机需要目标选择与对手舞台 selector，先不要为 μ's 预组预先实现。
3. 站位变换若出现“只能移动到空位”“必须交换”等文本差异，再扩展 `moveMemberBetweenSlots` 的配置参数。

### Stage 1F: Draw and hand/deck basics

目标片段：`F01` 以及后续抽弃/手牌放回卡组等基础动作。

当前落地：

- `src/application/effects/draw.ts` 已提供 `drawCardsFromMainDeckToHand`。
- 当前 helper 定位为卡效步骤底座，表达“主卡组顶 -> 手牌”的抽牌移动；它不接管开局、阶段、LIVE 判定等规则流程抽牌，也不改变 `GameService.drawTopMainDeckCard` 的即时刷新语义。
- `PL!-sd1-007-SD` 的额外抽 1 已迁入该 helper，action payload 仍保留单个 `drawnCardId` 以保持 golden behavior。
- `tests/unit/draw.test.ts` 覆盖抽 N、牌库不足、空牌库与非法数量；007 focused tests 覆盖翻到 LIVE 抽 1 与未翻到 LIVE 不抽。
- 对当前 μ's 预组验证集，F01 已完成最小模块化收口；`F02/F12` 与抽牌刷新语义等待真实样例再扩展。

后续：

1. 如果接 `F02` 抽弃，优先组合 `drawCardsFromMainDeckToHand` 与 effect discard cost/step。
2. 若卡效文本要求抽牌时触发刷新，应先统一规则语义，再决定 helper 是否注入 refresh handler，而不是悄悄改变 007。
3. 手动调试命令 `DRAW_CARD_TO_HAND` 与规则流程抽牌可暂时保留在 `GameSession` / `GameService`，等事件层明确后再考虑合流。

### Stage 1G: Event layer for AUTO

目标片段：未来自动能力、`S08/S09`、移动/状态变化触发等。

当前决策：

- 2026-06-13 暂缓实现。μ's 预组当前没有合适 AUTO proving case，先不为了框架本身改事件层。
- 待后续接入真正自动能力卡牌时，再设计并最小实现事件模型，用该卡验证行为。

预留做法：

1. 定义标准 `GameEvent`。
2. 让 effect step 和 cost step 产生 event。
3. 让 trigger matcher 从 event 发现 `TRIGGERED_AUTO`。
4. 用具体 AUTO 卡验证 once per turn / when-if 条件 / 触发来源 / UI 选择窗口。

这是支持全卡池的关键，但实现风险较高，应在前面模块稳定后做。

### Stage 1H: Catalog rescan

2026-06-13 已用 `loveca_effect_fragments_catalog.json` 回扫当前已登记/实现卡牌：

- 当前样例集覆盖 19 个 catalog segments，包括 `PL!-sd1` 与测试用 `PL!N-pb1-004-P+`。
- `existing_module_map` 已刷新为 Stage 1A-1F 后的真实模块图。
- `module_gap_list` 已把 `zone-selection`、`effect-costs`、`look-top`、`draw`、`live-modifiers`、`member-state` 从 P0 缺口中移出，改为追踪仍 inline 的 orchestration、condition AST、option choice、C07/exchange、AUTO event layer 等。
- `safe_refactor_plan` 已更新下一批建议：先选非 `PL!-sd1` 低风险 proving card，证明当前底座不是 starter-deck-only，再做配置化。

优先候选：

1. `LL-bp1-001-R＋`：登场从休息室回收成员，验证 `T01,F07,F09`。
2. `PL!HS-PR-001-PR` / `PL!HS-PR-002-PR`：登场看顶 3 选 1，验证 `T01,C01,F03`。
3. `PL!-pb1-019-N`：起动自送休息室回收成员，验证 `T03,C04,F07,F09`。

## 7. Custom resolver policy

不是所有效果都要立刻模块化。建议规则：

- P0/P1 高频片段：优先模块化。
- P2 或 unmatched 特例：允许 `CUSTOM` resolver。
- 同类 custom resolver 出现 2-3 次，再考虑抽模块。
- custom resolver 也必须走公共 cost、selector、zone move、modifier API；不要直接随意改状态。

## 8. Open decisions

1. `AUTO` 命名：保留当前 `CardAbilityCategory.AUTO`，还是迁移为 `TRIGGERED_AUTO`？
   - 建议：代码可渐进，文档语义先统一为 `TRIGGERED_AUTO`。
2. 移动事件层何时上？
   - 建议：先抽低风险模块，之后专门做 event layer。
3. selector 是否先做函数谓词，还是 AST？
   - 建议：第一阶段用函数谓词 + 可序列化描述字段；后续联机/回放需要时再完整 AST。
4. 是否把全部能力写成数据配置？
   - 建议：P0/P1 优先配置化；P2 保留 custom resolver。

## 9. Recommended next concrete task

Stage 1A-1F 已完成当前 μ's 验证集的主要底座抽取；Step 13 / Stage 1H 已完成 catalog 回扫和 audit 文档刷新。

下一步建议继续小步推进：

1. 选择一张非 `PL!-sd1` 低风险 proving card，优先 `LL-bp1-001-R＋` 的登场回收成员，验证 zone-selection / selector 跨系列复用。
2. 如果选择 look-top 路线，则用 `PL!HS-PR-001-PR` 或 `PL!HS-PR-002-PR` 推动 look-top workflow 参数化。
3. Stage 1G AUTO/event layer 继续暂缓，等真实 AUTO proving card 再设计。
3. selector 后续可按实际卡效继续补 `nameIs`、`cardCodeIn`、`scoreGte`、`requirement...` 等数值/身份选择器。

这样仍然保持“一个底座、一组可运行卡、一组 focused tests”的节奏。
