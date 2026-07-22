# Loveca card effect framework design

> 文档类型：设计文档
> 适用范围：卡效自动化框架形状、模块边界、事件/费用/选择/Live modifier 设计
> 当前状态：设计草案与阶段性落地说明；卡牌完成状态以 `docs/card-effect-reuse-audit/existing_module_map.md` 为准
> 最后更新：2026-07-06

状态摘要：Stage 1A-1S 已按真实卡效逐步落地 recovery/selector、费用、look-top、Live modifier、成员状态、抽弃、能量、登场费用修正、卡效登场、AUTO proving、舞台目标、公开手牌隐私投影与声援公开卡选择等边界。后续快速批处理已补齐 `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」、`LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」与 `PL!N-pb1-004` 费用 11「朝香果林」；新增验证指定姓名手牌多选弃置、换手禁止、登场不计入“移动”的成员区位置移动记录，以及未位置移动时 continuous BLADE。

目标：面向当前全卡池高频效果片段设计卡效自动化框架，第一阶段用当前已实现的 `PL!-sd1`、测试用 Karin 效果与 `系统边界混合` proving cards 验证框架。

完整 fragment 覆盖矩阵见 `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`。本文负责说明框架形状；覆盖矩阵负责逐项确认 catalog 中 75 个 fragment 都被纳入设计、预留或 custom hook。

## 1. Design goal

卡效框架不应该只服务 `PL!-sd1`。`PL!-sd1` 的价值是：它已经有一批可运行、可测试、可对照的 golden behavior，适合做第一批迁移样本。

框架本身应面向 `loveca_effect_fragments_catalog.json` 中的全卡池片段，而不是只面向 `PL!-sd1`。下面列表是框架层级摘要；完整 fragment 逐项归属以覆盖矩阵为准：

- 触发/能力壳：登场、LIVE 开始、LIVE 成功、起动、常时、通用自动事件触发、每回合限制。
- 费用/前置动作：弃手、支付能量、自身进休息室、自身待机、复合费用、公开手牌、指定名称/团体弃手、换手禁止、休息室卡回到卡组。
- 检索/移动：抽牌、抽弃、看顶、公开、加入手牌、其余进休息室、控顶、堆墓、休息室回收、声援公开卡处理。
- 状态/站位/登场：成员待机、活跃、对方成员待机、站位变换、从手牌/休息室登场、成员离场/移动触发、成员区位置移动记录。
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
| `CONTINUOUS` | 常时能力，不入队，按当前场面动态计算 | 成功 Live 每张得 BLADE、三面不同名加 LIVE 合计分数 |
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
| `ON_CHEER` | `E06` | 自己进行声援时；当前在自动声援公开后、判定确认前写入并消费 `CheerEvent` |
| `ON_PHASE_START/END` | future AUTO | 阶段开始/结束时 |

也就是说，登场、LIVE 开始、LIVE 成功不应该和 `自动` 对立；它们应该是 `TRIGGERED_AUTO` 下最常见、最标准的 trigger。

当前代码中的 `CardAbilityCategory.AUTO` 可以保留为“其他自动诱发”的兼容分类，但长期更建议语义统一为 `TRIGGERED_AUTO + trigger`。

2026-06-14 更新：`ON_LIVE_SUCCESS` 已不再只从成功的 LIVE 卡本身入队，也会在存在成功 LIVE 时扫描表演玩家舞台成员来源。`PL!HS-bp6-001-R＋` 费用 4「日野下花帆」验证了舞台成员来源 LIVE 成功时效果；`PL!HS-cl1-009-CL` 分数 1「水彩世界」与同卡共同打开 `effects/cheer-selection.ts`，通过 `liveResolution.first/secondPlayerCheerCardIds` 与 `resolutionZone.revealedCardIds` 选取“因声援公开且仍在处理区”的卡，再按卡效配置移动到手牌或卡组顶。

2026-06-15 更新：`ON_CHEER` 已以 `PL!HS-bp6-027-L` 分数 5「月夜見海月」落地。当前自动/手动/追加声援会写入 `CheerEvent`，入队优先消费 eventLog 中最新非追加事件，旧扫描表演玩家 LIVE 区来源只作 fallback；追加声援事件带 `additional=true`，只补公开卡与 `liveResolution.*CheerCardIds` 登记，不二次触发 `ON_CHEER`，避免为未来非一回合一次卡制造递归语义。`PL!S-bp2-004` 费用 11「黒澤ダイヤ」已验证另一条窄边界：重做声援会生成 `additional=false` 的普通 `CheerEvent`，显式重新走标准 `ON_CHEER` 入队；来源能力在新事件入队前记录 turn1，避免自身递归。

## 3. Proposed ability definition shape

理想情况下，一张卡的效果尽量不是直接写 resolver 函数，而是能力定义 + 模块组合：

```ts
defineAbility({
  id: 'PL!-sd1-004-SD:on-enter-look-five-take-muse-live',
  baseCardCodes: ['PL!-sd1-004'],
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
  baseCardCodes: ['PL!-sd1-008'],
  category: 'ACTIVATED',
  source: stageMember(),
  limit: perSourceCardPerTurn(1),
  cost: [tapActiveEnergy(2)],
  steps: [moveTopDeckToWaitingRoom({ count: 10 })],
});
```

自动能力：

```ts
defineAbility({
  id: 'future-card:auto-when-member-moved',
  baseCardCodes: ['future-card-base'],
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
  baseCardCodes: ['PL!-sd1-001'],
  category: 'CONTINUOUS',
  source: stageMember(),
  modifier: liveBladeModifier({
    amount: count(selfSuccessLiveCards()),
  }),
});
```

`baseCardCodes` 是默认推荐形态：同基础编号不同罕度视为同一张卡，效果文本一致时应自动同步。`cardCodes` 只用于确实需要限制到某个具体印刷版本的例外，并应在 `existing_module_map.md` 说明原因。

## 4. Framework layers

### 4.1 Ability registry

职责：

- 记录卡号、能力 ID、分类、来源区域、触发条件、次数限制、展示文本。
- 作为 UI、命令层、runner 的统一事实来源。

当前状态：

- `CARD_ABILITY_DEFINITIONS` 已从 runner 拆到 `src/application/card-effects/definitions/index.ts`；ability id 在 `src/application/card-effects/ability-ids.ts`，definition 类型在 `src/application/card-effects/ability-definition-types.ts`。
- 仍需要把 resolver dispatch 从大量 `switch abilityId` 逐步变成按 `steps` 执行。

### 4.2 Event and trigger layer

职责：

- 所有规则动作、区域移动、状态变化、阶段变化，都生成标准 game event。
- 自动能力通过 trigger matcher 监听 event。
- 同一时点多个自动能力进入 pending queue，由玩家选择顺序。

当前状态：

- `GameState.eventLog` / `eventSequence` 与 `emitGameEvent` 已落地，作为后续 trigger matcher 的不可变事件事实来源；`actionHistory` 仍保留用于审计、投影与既有 fallback。
- `EventBus` 保留为非权威运行时/调试工具，不作为规则触发、联机同步或回放来源。
- `member-state.ts` 已在成员方向变化、成员槽位移动与交换时写入 `ON_MEMBER_STATE_CHANGED` / `ON_MEMBER_SLOT_MOVED`；普通 `TAP_MEMBER` 与活跃阶段重置也会写入成员状态变化事件，普通 `MOVE_MEMBER_TO_SLOT` 也写入成员槽位移动事件。`enqueueTriggeredCardEffects` 已开始消费 `ON_MEMBER_STATE_CHANGED` 与 `ON_MEMBER_SLOT_MOVED`。
- `ON_ENTER_STAGE` 已开始消费 `eventLog`：普通手牌登场写入 `EnterStageEvent(fromZone=HAND)`，卡效从休息室登场写入 `EnterStageEvent(fromZone=WAITING_ROOM)`；入队仍保留 action-history fallback。
- `ON_LEAVE_STAGE` 已开始消费 `eventLog`：普通舞台成员进休息室、换手替换离场、自送休息室费用会写入 `LeaveStageEvent`；入队仍保留 action-history fallback。
- `ON_LIVE_START` 已开始消费 `eventLog`：PERFORMANCE 阶段翻开 LIVE 后写入 `LiveStartEvent(performerId, liveCardIds)`，LIVE 开始队列优先使用该事件的表演者、LIVE 卡列表与 `eventId`，仍保留旧 synthetic fallback。
- `ON_LIVE_SUCCESS` 已开始消费 `eventLog`：LIVE 成功效果窗口写入 `LiveSuccessEvent(playerId, successfulLiveCardIds, score)`，LIVE 成功队列优先使用该事件的成功玩家、成功 LIVE 卡列表与 `eventId`，仍保留 `liveResults` 推导 fallback。

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
- 统一计算登场费用修正，再和换手减免共同生成支付方案。
- 费用成功与否可被 `X02` “如此做的场合”引用。
- 费用本身也应产生标准 event/action。

P0/P1 覆盖：

| fragment_ids | module |
|---|---|
| `C01,C02` | `discardHand(count, optional, selector?)` |
| `C03,E01` | `tapActiveEnergy(count)` / `payEnergy(count)` |
| `C04` | `moveSourceMemberToWaitingRoom()` |
| `C07` | `revealFromHand(selector, count, optional)` |
| `X11` | `playCostModifier(condition, amount)` |

2026-06-14 补充：公开手牌、弃手费用、私有检视区选择等步骤若在确定公开前使用 `activeEffect.selectableCardIds`，必须通过 `selectableCardVisibility: 'AWAITING_PLAYER_ONLY'` 标明候选只投影给当前等待玩家。在线投影层同时保留兜底：若候选牌对象对当前视角不存在或不是正面可见，则不投影 `selectableObjectIds`、选择标题与跳过按钮，避免对手通过占位数量读出隐藏区候选数。已公开给双方的隐藏区卡牌使用 `activeEffect.revealedCardIds` 承载，投影为 `revealedObjectIds` 并强制正面可见，用于公开手牌等“公开后继续处理”的确认窗口。公开区候选（休息室、舞台等）继续按 `PUBLIC` 或默认正面可见规则投影给双方。

2026-07-11 补充：卡文明确要求等待玩家从自己不可见的隐藏区卡牌中选择时，使用 `selectableCardVisibility: 'AWAITING_PLAYER_BLIND'`。该模式只向等待玩家投影匿名牌背与不可关联真实实例的位置 token，不提供 `frontInfo`、`cardType` 或稳定真实对象 ID；非等待玩家不接收候选标记。选择提交经过 GameSession token 校验后，由具体 workflow 映射回权威候选并重查当前区域，公开阶段再转入 `revealedCardIds`。不要用普通 `AWAITING_PLAYER_ONLY` 暴露真实对象 ID，也不要把盲选替换为随机自动选择。

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

当前状态：`src/application/effects/conditions.ts` 已提供第一版纯函数 condition/query helper，包括区域计数、selector 计数/阈值、按 selector 返回 cardIds、成功 LIVE 数、舞台成员数/存在性、其他舞台成员、LIVE 区排除来源卡计数与来源成员有效 BLADE 阈值查询。它只作为 runner 内联条件的复用层，不引入 condition AST、声明式 steps 或通用公式 builder。

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
| `F06` | `moveTopDeckToWaitingRoom(count, reveal?)` / `inspectTopThenMoveToWaitingRoom(count, reveal?)` |
| `F07,F08,F09` | `selectFromZoneToHand(config)` |
| `F13` | `peekOrRevealDeckTop(config)` |
| `S01,S02` | `setMemberState(targets, state)` |
| `S05` | `positionChange(target, destination, swap)` |
| `E02` | `setEnergyOrientation(targets, orientation)` |
| `E03` | `placeEnergyFromDeck(count, orientation)` |
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
| `PL!N-pb1-004-P+` | 常时未移动 BLADE；Live 开始公开顶 1 后按条件站位变换 | `continuous -> if not positionMovedThisTurn(source) then grantBlade(2)`；`onLiveStart -> revealTop(1) -> if member cost<=9 then toHand + positionChange else toWR` |
| `PL!SP-PR-004-PR` | 登场可弃 1 手牌，从能量卡组放置 1 张待机能量 | `optional discard -> placeEnergyFromDeck(count=1, orientation=WAITING)` |
| `PL!SP-bp4-008-P` 费用 13「若菜四季」 | 左侧登场抽弃、右侧登场能量活跃、LIVE 开始可选站位变换 | `onEnter(requiredSourceSlots=[LEFT]) -> drawThenDiscard(draw=2, discard=1)`；`onEnter(requiredSourceSlots=[RIGHT]) -> setFirstEnergyCardsOrientation(count=2, from=WAITING, to=ACTIVE)`；`onLiveStart -> optional positionChange(member-state)` |
| `PL!HS-bp5-019-L` 分数 6「花结」 | LIVE 开始按 LIVE 区其他「莲之空」卡减少绿色必要 Heart | `onLiveStart(liveCard) -> modifyRequiredHearts(color=GREEN, delta=count(otherHasunosoraLiveZoneCards)*-2)` |
| `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」 | LIVE 开始按休息室 Cerise Bouquet LIVE 数量使此卡分数 +1 | `onLiveStart(liveCard) -> if zoneCount(WR, live & unitAlias(Cerise Bouquet))>=3 -> modifyThisLiveScore(+1)` |
| `PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」 | 登场按舞台相关成员条件活跃能量并回收 LIVE；LIVE 开始支付能量得 BLADE | `onEnter -> if stage has nameAlias(Rurino/Ginko/Kosuzu) -> setEnergyActive(1) + selectFromZoneToHand(hasunosora LIVE)`；`onLiveStart -> optional tapEnergy(1) -> grantBlade(2)` |
| `PL!HS-bp5-008-R` 费用 4「桂城泉」 | 登场可自身待机并弃手，看顶 5 公开高费莲之空成员 | `onEnter -> optional cost(setSourceState(WAITING)+discard1) -> lookTopSelectToHand(5, upTo1, member & hasunosora & cost>=9, reveal=true)` |
| `PL!HS-pb1-004-R` 费用 4「百生吟子」 | 登场可支付能量并弃手，顶 3 入休息室后回收 Cerise Bouquet LIVE | `onEnter -> optional cost(tapEnergy(1)+discard1) -> moveTopDeckToWaitingRoom(3) -> selectFromZoneToHand(live & unitAlias(Cerise Bouquet))` |
| `PL!HS-PR-019-RM` 费用 2「百生吟子」 | 登场公开检视顶 3，确认后入休息室，若均为绿色 Heart 成员则得绿色 Heart | `onEnter -> inspectTop(3, reveal=true) -> confirm -> moveInspectedToWaitingRoom -> if all(member & hasGreenHeart) -> grantHeart(GREEN,1)` |
| `PL!HS-bp5-001` 费用 11「日野下花帆」 | 登场公开检视顶 4 后入休息室并按是否存在 LIVE 得 BLADE；起动公开手牌 LIVE 回收同名 LIVE | `onEnter -> inspectTop(4, reveal=true) -> confirm -> moveInspectedToWR -> if any(LIVE) grantBlade(2)`；`activated(cost=tapEnergy(2)+revealFromHand(LIVE)) -> selectFromZoneToHand(sameName LIVE)` |
| `PL!HS-bp1-003` 费用 13「乙宗梢」 | 起动回收低费莲之空成员；常时三面不同名莲之空成员时 LIVE 合计分数 +1 | `activated(limit=oncePerTurn,cost=tapEnergy(1)) -> selectFromZoneToHand(member & hasunosora & cost<=4)`；`continuous -> if allStageSlots(hasunosora & distinctName) -> modifyLiveTotalScore(+1)` |
| `PL!HS-bp1-002` 费用 11「村野沙耶香」 | 起动支付 2 能量并自送，从休息室登场低费莲之空成员到来源原区域 | `activated(cost=tapEnergy(2)+moveSelfToWR) -> playMemberFromWR(member & hasunosora & cost<=15, sourceSlot)` |
| `PL!HS-sd1-001` 费用 9「日野下花帆」 | 被费用大于等于 10 的莲之空成员换手放置入休息室时，活跃 2 张能量 | `onLeaveStage -> if replacingCard(member & hasunosora & cost>=10) -> setEnergyActive(2)` |
| `PL!HS-pb1-020` 费用 9「百生吟子」 | 登场时休息室 LIVE >=3 可弃 2 手牌，回收 Cerise Bouquet 成员 + 莲之空 LIVE | `onEnter -> if zoneCount(WR,LIVE)>=3 -> optional discard(2) -> groupedSelectFromWRToHand([ceriseMember, hasunosoraLive])` |
| `PL!HS-bp6-001` 费用 4「日野下花帆」 | 登场按舞台成员数 + 2 动态检视并控顶；LIVE 成功时可将声援公开卡回顶 | `onEnter -> lookTop(stageMemberCount+2) -> chooseOneToDeckTop(rest=WR)`；`onLiveSuccess(stageMember) -> selectCheerRevealedCard(destination=deckTop)` |
| `PL!HS-cl1-009` 分数 1「水彩世界」 | LIVE 成功时从声援公开卡中回收费用 4-9 成员 | `onLiveSuccess(liveCard) -> selectCheerRevealedCard(member & cost4to9, destination=hand)` |
| `PL!HS-bp6-027` 分数 5「月夜見海月」 | 自己进行声援时，可将至多3张本次声援公开的无 BLADE HEART「莲之空」卡入休息室并追加等量声援 | `onCheer(liveCard) -> selectCheerRevealedCard(hasunosora & noBladeHeart, max3, destination=WR) -> additionalCheer(movedCount)` |

## 6. First implementation stage

第一阶段不要实现全卡池所有模块。建议只做能被当前 golden behavior 验证的框架底座。

### Stage 1A: Recovery and selector

目标片段：`F07,F08,F09,X04,X06`

当前落地：

- `src/application/effects/card-selectors.ts` 提供第一版函数式 selector：`typeIs`、`groupIs`、`unitIs`、`unitAliasIs`、`unitAliasOrTextAliasIs`、`costLte`、`costGte`、`cardNameIs`、`cardNameAliasIs`、`and`、`or`、`not`。普通小组名条件默认用 `unitAliasIs` 匹配真实 `unitName`；需要处理“此卡视为某小组”等文本身份时，再显式使用 `unitAliasOrTextAliasIs`。成员名条件优先用 `cardNameAliasIs` 处理中日名、空白/中点和早期中文误译/异体。
- `src/application/effects/stage-targets.ts` 提供第一版舞台成员目标扫描 helper：按 `playerId + CardSelector` 从左/中/右成员区取合法成员 ID。
- `src/application/effects/stage-member-target-selection.ts` 提供第一版舞台成员目标 active effect 配置入口：生成目标候选、创建单选 active effect，并在结算时调用 `setMemberOrientation`。
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
- 当前覆盖 `DISCARD_HAND_TO_WAITING_ROOM`、`TAP_ACTIVE_ENERGY`、`SEND_SOURCE_MEMBER_TO_WAITING_ROOM`、`SET_SOURCE_MEMBER_ORIENTATION`，并保持既有自动支付行为；`PL!HS-bp5-008-R` 费用 4「桂城泉」验证自身待机费用，`PL!HS-pb1-004-R` 费用 4「百生吟子」验证能量+弃手复合费用。
- `PL!HS-bp1-004-P` 费用 15「夕雾缀理」已同时验证起动支付 3 能量与 LIVE 开始支付 1 能量两种卡效能量费用路径。
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
- `PL!-sd1-004-SD`、`PL!-sd1-007-SD`、`PL!-sd1-011/012/015/016-SD`、`PL!-sd1-019-SD`、`PL!N-pb1-004-P+`、`PL!HS-bp5-008-R` 费用 4「桂城泉」、`PL!HS-pb1-004-R` 费用 4「百生吟子」和 `PL!HS-PR-019-RM` 费用 2「百生吟子」的看顶/公开检视/顶牌入休息室入口已开始复用该底座；各自复杂后续结算仍保留在 runner 中。`PL!HS-PR-019-RM` 费用 2「百生吟子」明确采用“先公开检视，再点击继续处理后入休息室”的玩家窗口。

做法：

1. 抽出 `lookTopSelectToHand`。
2. 先迁移 011/012/016，再迁移 015，再迁移 004。
3. 抽出 `lookTopReorderTopRestWaitingRoom` 迁移 019。
4. 抽出 `moveTopDeckToWaitingRoom` 迁移 007/008。

### Stage 1D: Live modifier

目标片段：`B03,B05,B07,B08,T05`

当前落地：

- `src/domain/rules/live-modifiers.ts` 已提供 `addLiveModifier`、`replaceLiveModifier`、`projectLiveModifierCompatibility`。
- `003` Heart、`009` 分数、`022` 必要 Heart 已改为先写 `liveResolution.liveModifiers`，旧的 `playerHeartBonuses`、`playerScoreBonuses`、`liveRequirementReductions`、`liveRequirementModifiers` 由投影派生；`PL!HS-bp1-004-P` 费用 15「夕雾缀理」LIVE 开始段已验证支付能量后按 LIVE 区数量写入 `BLADE` modifier；`PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」进一步验证 LIVE 卡来源也可写入绿色 `REQUIREMENT` 与 `SCORE` modifier；其中 `SCORE` 不带 `liveCardId` 表示玩家 LIVE 合计分数修正，携带 `liveCardId` 表示此 Live 卡分数修正；玩家合计分数修正只在至少一首 LIVE 成功时进入最终分数草案，全部失败时分数仍为 0。`PL!HS-PR-019-RM` 费用 2「百生吟子」验证登场公开检视后按条件写入绿色 `HEART` modifier。
- continuous modifier registry 已起步，`001` 常时 BLADE 由 `collectLiveModifiers` 按当前舞台与成功 Live 数动态收集，不写入临时状态；`PL!HS-bp1-003` 费用 13「乙宗梢」验证条件型常时 `SCORE` modifier，三面均为不同名「莲之空」成员时投影 LIVE 合计分数 +1。
- `tests/unit/live-modifiers.test.ts` 覆盖临时 modifier 写入、替换和兼容投影；既有 Live 判定 / runner tests 覆盖自动判定结果不变。
- 前端判定面板读取 `requirementModifiers` / `requirementReductions` 时需兼容 raw card id 与 `obj_<cardId>` public object id。2026-06-13 修复过一次 022 UI 预览未应用必要 Heart 减少的回归，根因就是该投影键不一致。

后续：

1. 为更多 `B08/T05` 条件型常时修正增加 registry definition。
2. 为 `B06` 继续补更多样例；当前 `SCORE.liveCardId` 已区分“此 Live 卡分数增加”，在线投影通过 `liveCardScoreModifiers` 给判定窗口显示修正后的单卡分数。
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
- 当前 helper 定位为卡效步骤底座，表达“主卡组顶 -> 手牌”的抽牌移动；它不接管开局、阶段、LIVE 判定等规则流程抽牌，也不合并 `GameService.drawTopMainDeckCard` 的调试/规则流程入口。
- 卡效抽 N 张按逐张抽牌处理，抽牌过程中会沿用主卡组更新规则：主卡组为空且休息室有卡时先刷新再继续抽；刷新后仍无可抽卡时只抽实际可抽数量。
- `PL!-sd1-007-SD` 费用 7「东条希」的额外抽 1 已迁入该 helper，action payload 仍保留单个 `drawnCardId` 以保持 golden behavior。
- `tests/unit/draw.test.ts` 覆盖抽 N、牌库不足、空牌库、刷新后继续抽与非法数量；007 focused tests 覆盖翻到 LIVE 抽 1 与未翻到 LIVE 不抽。
- 对当前 μ's 预组验证集，F01 已完成最小模块化收口；`PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场已用 `startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect` 打开 F02 抽 2 弃 1 组合步骤；`F12` 等抽后放回卡组顶/底语义等待真实样例再扩展。

后续：

1. 若后续出现弃 M 张或抽后放回卡组顶/底，先扩展现有抽弃壳的多选/目标区域配置，不要复制单卡流程。
2. 若后续卡效需要不同于当前逐张抽牌刷新规则的处理，先确认规则语义并补 focused tests，不要在单卡 workflow 中临时绕过抽牌 helper。
3. 手动调试命令 `DRAW_CARD_TO_HAND` 与规则流程抽牌可暂时保留在 `GameSession` / `GameService`，等事件层明确后再考虑合流。

### Stage 1G: Event layer for AUTO

目标片段：未来自动能力、`S08/S09`、移动/状态变化触发等。

当前决策：

- 2026-06-15 已新增 `GameState.eventLog` / `eventSequence` 与 `emitGameEvent`，并让 `member-state.ts`、普通 `TAP_MEMBER` 与活跃阶段重置对成员状态变化写入 `ON_MEMBER_STATE_CHANGED`，成员状态变化事件可携带 `PLAYER_ACTION` / `RULE_ACTION` / `CARD_EFFECT` cause；站位变换与成员交换写入 `ON_MEMBER_SLOT_MOVED`。同日已接入 `ON_MEMBER_STATE_CHANGED` 与 `ON_MEMBER_SLOT_MOVED` 的最小消费路径：`PL!N-bp4-018-N` 验证自身 `ACTIVE -> WAITING` 时抽 1 弃 1，`PL!-pb1-015-P＋/R` 验证自己的卡效使对方费用 <= 4 成员 `ACTIVE -> WAITING` 时抽 1，`PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」验证自身登场或成员区移动后横置对方原本 BLADE <= 3 成员。
- 2026-06-15 已把 `ON_ENTER_STAGE` 主路径接入 `eventLog`：普通手牌登场与卡效从休息室登场均写入 `EnterStageEvent`，`enqueueTriggeredCardEffects` 优先从事件流入队。默认检查时机只消费最近登场事件，卡效登场显式传入本次新事件列表。
- 2026-06-15 已把 `ON_LEAVE_STAGE` 主路径接入 `eventLog`：手动离场、换手替换离场与自送费用均写入 `LeaveStageEvent`，`enqueueTriggeredCardEffects` 优先从事件流入队。
- 2026-06-15 已把 `ON_LIVE_START` 主路径接入 `eventLog`：LIVE 翻开后写入 `LiveStartEvent`，LIVE 开始 pending ability 的 `eventIds` 绑定真实事件 ID；`PL!HS-bp5-019-L` 分数 6「花结」验证 LIVE 卡来源，`PL!HS-bp6-004-R` 费用 13「百生 吟子」验证舞台成员来源同源双 LIVE 开始能力共享本次事件。
- 2026-06-15 已把 `ON_LIVE_SUCCESS` 主路径接入 `eventLog`：成功效果窗口写入 `LiveSuccessEvent`，LIVE 成功 pending ability 的 `eventIds` 绑定真实事件 ID；`PL!HS-bp6-001` 费用 4「日野下花帆」验证舞台成员来源，`PL!HS-cl1-009` 分数 1「水彩世界」验证 LIVE 卡来源可只从事件事实入队。
- 2026-06-13 已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」最小起步：先支持 `ON_LEAVE_STAGE` 来源入队，证明舞台成员进休息室时的 AUTO 可以走待处理队列。
- `PL!HS-bp6-017-N` 费用 11「日野下花帆」继续复用同一离场 AUTO 底座，并验证可选弃手后从休息室按类型分组回收 LIVE/成员各至多 1 张。
- 2026-06-14 `PL!HS-sd1-001-SD` 费用 9「日野下花帆」为同一离场来源补了 `replacingCardId` 薄元数据；2026-06-15 起该元数据直接来自 `LeaveStageEvent`，入队前即可校验“曾与费用 >= 10 的莲之空成员换手”这类来源条件。
- 当前触发入队仍是逐事件类型迁移；`ON_ENTER_STAGE`、`ON_MEMBER_STATE_CHANGED`、`ON_MEMBER_SLOT_MOVED`、`ON_LEAVE_STAGE`、`ON_LIVE_START` 与 `ON_LIVE_SUCCESS` 已优先扫描 `eventLog`，仍保留旧 fallback。这还不是完整 `GameEvent -> trigger matcher`。
- 当同一动作同时产生离场 AUTO 与登场能力时，pending ability 顺序选择按同 controller 且同 timing、共享 eventId 或换手 `replacingCardId` 关系聚合，玩家可选择先后顺序。

预留做法：

1. 定义标准 `GameEvent`。
2. 让 effect step 和 cost step 产生 event。
3. 让 trigger matcher 从 event 发现 `TRIGGERED_AUTO`。
4. 用更多具体 AUTO 卡验证 once per turn / when-if 条件 / 触发来源 / UI 选择窗口。

这是支持全卡池的关键，但实现风险较高；当前已通过 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」与 `PL!HS-bp6-017-N` 费用 11「日野下花帆」证明最小路径，后续应继续小步扩事件来源。

### Stage 1H: Catalog rescan

2026-06-13 已用 `loveca_effect_fragments_catalog.json` 回扫当前已登记/实现卡牌：

- 当前样例集覆盖 19 个 catalog segments，包括 `PL!-sd1` 与测试用 `PL!N-pb1-004-P+`。
- `existing_module_map.md` 已改为按基础编号记录完整/部分/同型/partial 状态；模块覆盖拆到 `effect_module_coverage.md`，同构批量扩样本拆到 `card_effect_batch_expansions.md`。
- `module_gap_list` 已把 `zone-selection`、`effect-costs`、`look-top`、`draw`、`live-modifiers`、`member-state` 从 P0 缺口中移出，改为追踪仍 inline 的 orchestration、condition AST、option choice、C07/exchange、AUTO event layer 等。
- `safe_refactor_plan` 已更新下一批建议：`PL!SP-bp4-008-P` 费用 13「若菜四季」当前三段收口后，下一批优先转向费用减少 `X11` proving cards，再继续按需要穿插低风险扩样本。

已完成的非 `PL!-sd1` 低风险候选：

1. `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」：登场从休息室回收成员，LIVE 开始弃 3 张指定姓名手牌后 LIVE 合计分数 +3，验证 `T01,T02,F07,F09,C08,B05,X05`。
2. `PL!HS-PR-001-PR` 费用 10「日野下花帆」：登场看顶 3 选 1，验证 `T01,C01,F03`。
3. `PL!-bp3-010-N` 费用 9「高坂穗乃果」：登场弃手看顶 5 公开 Live 入手，验证 `T01,C01,F04`。

### Stage 1I: Energy placement and orientation

目标片段：`E03,E02`

当前落地：

- `src/application/effects/energy.ts` 已提供 `placeEnergyFromDeckToZone(game, playerId, count, orientation)`。
- 该 helper 表达卡效步骤里的“能量卡组顶 -> 能量区”，并显式指定放置后的 `ACTIVE` / `WAITING` 状态；它不改变普通能量阶段 `drawEnergy` 默认活跃放置的规则流程。
- `energy.ts` 也已提供 `setEnergyOrientation` / `setFirstEnergyCardsOrientation`，用于卡效步骤把能量区指定卡或前 N 张符合条件的能量设为目标方向。
- `PL!SP-PR-004-PR` 费用 4「唐 可可」已作为第一张 `系统边界混合` proving card：登场后可弃 1 手牌，弃牌成功时放置 1 张待机能量。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」右侧登场 E02 已起步：能力定义通过 `requiredSourceSlots: [RIGHT]` 声明来源槽位条件，入队阶段从登场事件记录 `sourceSlot` 并统一过滤，执行时将最多 2 张待机能量变为活跃。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场 F02 也已起步：能力定义通过 `requiredSourceSlots: [LEFT]` 声明来源槽位条件，执行时抽 2 后选择 1 张手牌放置入休息室。
- `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场段已作为 F02 扩样本：执行时抽 2 后选择 1 张手牌放置入休息室；LIVE 开始段也已补齐，复用弃 1 手牌 active effect、Heart 颜色 option 与 `addLiveModifier`，并在支付后检查“自己的舞台存在其他成员”条件。
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」与 `PL!-bp4-003-P` 费用 2「南琴梨」已作为起动扩样本：复用 effect-costs 自送休息室与 zone-selection，分别回收成员卡/LIVE 卡。
- `tests/unit/energy.test.ts` 覆盖能量放置与方向 helper；`tests/integration/sample-card-effect-runner.test.ts` 覆盖 PR-004 不发动/发动，以及四季左侧触发、右侧触发、中心不触发、LIVE 开始可选站位变换。

后续若出现从能量卡组放置多张、公开/检视后放置、或放置到成员下方，应在 `energy.ts` 上扩展参数或另建同层 helper，不要在 runner 内直接改能量区。

### Stage 1L: Play cost modifiers and relay restrictions

目标片段：`X08,X11`

当前落地：

- `src/domain/rules/cost-calculator.ts` 已在支付方案中保留 `totalCost`、`modifiedCost`、`costModifiers`、`costModifierAmount`、`relayDiscount` 与 `actualEnergyCost`，让费用修正与换手减免在规则层统一计算。
- `GameSession.preparePlayMemberCostPayment` 向 `costCalculator` 传入来源卡 ID、当前手牌列表与舞台成员状态，普通登场继续自动扣费，UI/命令层不写单卡特例。
- `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已验证“手牌中的此成员卡，此卡以外的其他手牌每有 1 张费用减少 1”；此卡本身不计入数量，手牌只有此卡时仍为 20 费，最低可降到 0 费。
- `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已验证“此成员无法因换手放置入休息室”：`costCalculator` 不生成把该成员换下去的支付方案，`play-member.handler.ts` 在实际登场动作里也会拦截。
- `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」LIVE 开始段已验证指定姓名手牌多选弃置，并按弃置张数写入 `BLADE` modifier。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已验证“手牌中的此成员卡，自己的舞台存在待机状态『虹咲』成员时费用减少 2”；活跃虹咲成员或待机非虹咲成员不会触发减费。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」登场段已验证 `X03` 目标类型二选一：选择待机舞台成员时复用 `setMembersOrientation` 变活跃；选择能量分支时不让玩家逐张选择能量，而是按能量区顺序复用 `setEnergyOrientation` 将至多 2 张能量变活跃。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已验证“舞台来源成员使手牌中费用 10 的 Liella! 成员登场费用减少 2”；目标必须同时满足 10 费与 Liella!，换手登场时先应用费用修正，再计算换手减免。
- focused tests 覆盖不计自身、按其他手牌数量减费、最低 0 费、与换手减免叠加、待机虹咲成员条件、场上来源修正目标筛选，以及真实 `PLAY_MEMBER_TO_SLOT` 自动扣费路径。
- 当前本地 `系统边界混合` 缺少合适的 10 费 Liella! 目标，`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」先用构造数据证明规则底座；后续补入目标卡后可做前端手测。

### Stage 1M: Batch activation and effect play from waiting room

目标片段：`S02,E02,S07`

当前落地：

- `src/application/effects/member-state.ts` 新增 `setMembersOrientation`，用于卡效批量改变舞台成员方向；`setMemberOrientation` 单体原语仍保留。
- `src/application/effects/member-state.ts` 新增 `playMembersFromWaitingRoomToEmptySlots`，用于卡效从休息室将成员登场到空成员区；helper 统一把实际登场的成员实例记入 `movedToStageThisTurn`，使普通登场的同回合区域限制跟随成员。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始段已完成：中心位来源入队，确认后将自己舞台上全部 Liella! 成员与全部能量变为活跃状态；非 Liella! 成员不受影响。
- `PL!S-bp2-006-P` 费用 11「津岛善子」登场段已完成：可以支付 4 能量，从休息室选择至多 2 张费用合计小于等于 4 的成员，逐张选择空成员区登场。
- 当前 S07 边界：卡效登场不走普通登场费用、不计算换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力；触发入队不写进 `playMembersFromWaitingRoomToEmptySlots` 移动原语。占用区域的卡效登场则先产生新成员登场事实，再执行重复成员规则，不产生换手 metadata。
- focused tests 覆盖 helper、能力登记、千砂都 LIVE 开始批量活跃，以及善子支付后从休息室登场。

### Stage 1O: Minimal AUTO leave-stage proving

目标片段：`T06,S08`

当前落地：

- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」登记为 `AUTO` / `STAGE_MEMBER` / `ON_LEAVE_STAGE` 队列能力。
- `PL!HS-bp6-017-N` 费用 11「日野下花帆」登记为第二张同触发 AUTO：离场后可弃 1 手牌，若弃手成功，从休息室选择 LIVE 卡和成员卡至多各 1 张加入手牌。
- `enqueueTriggeredCardEffects` 支持 `ON_LEAVE_STAGE`，当前优先从 `eventLog` 的 `LeaveStageEvent` 构造离场来源；最近 `PLAY_MEMBER` 替换、从成员区移动到休息室的 `MOVE_CARD` 等 action-history 来源仍作为兼容回退。
- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」解析流程复用 look-top：检视顶 5，选择成员后先公开，确认后入手，其余检视牌放置入休息室。
- `PL!HS-bp6-017-N` 费用 11「日野下花帆」解析流程复用弃手费用与 `WAITING_ROOM -> HAND` 移动原语；新增分组选择约束为 LIVE/成员各至多 1 张。
- 待处理队列的顺序选择窗口支持同 controller 且同 timingId、共享 eventId 或换手 `replacingCardId` 关系，因此 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」被换手替换时，其离场 AUTO 会和新成员登场能力一起让玩家选择顺序。
- 当前边界：还没有完整标准 `GameEvent -> trigger matcher`，只先覆盖成员槽位移动与舞台离场事件消费；更多区域移动/状态变化 AUTO 后续真实样例继续推动。
- focused tests 覆盖直接离场触发、公开入手/其余进休息室、弃手后分组回收 LIVE/成员、同类双选拒绝，以及与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场能力同事件排序。

### Stage 1P: AUTO enter-stage listener and member effective BLADE

目标片段：`T06,T07,T02,B01,F02`

当前落地：

- `PL!HS-pb1-009-R` 费用 15「日野下花帆」第一段登记为 `AUTO` / `STAGE_MEMBER` / `ON_ENTER_STAGE`，来源槽位要求 `CENTER`，`perTurnLimit: 2`。
- `enqueueTriggeredCardEffects` 的 `ON_ENTER_STAGE` 同时处理登场者自己的 `ON_ENTER` 能力与舞台成员监听登场事件的 AUTO；2026-06-15 起优先消费 `eventLog` / 显式 `EnterStageEvent`，最近 `PLAY_MEMBER` fallback 继续保留。
- `perTurnLimit` 已从起动专用校验提升为能力通用限制，按 `playerId + abilityId + sourceCardId + turnCount` 统计；`PL!-sd1-008-SD` 费用未登记「小泉 花陽」也同步修正为同一来源卡实例每回合 1 次。
- 效果段通过 `addLiveModifier` 写入 BLADE +2，FAQ 覆盖自己登场至中央时也触发。
- `PL!HS-pb1-009-R` 费用 15「日野下花帆」第二段登记为 `LIVE_START` / `STAGE_MEMBER` 队列能力；LIVE 开始时通过 `getMemberEffectiveBladeCount` 统计印刷 BLADE + 同来源成员 BLADE modifier，达到 8 时复用 F02 抽 2 弃 1 流程。
- confirm-only active effect 已起步：玩家从顺序选择窗口手动点选无输入 pending ability 时，先显示来源卡、效果文本与“继续处理”按钮，确认后再 resolve；“顺序发动”仍自动连续处理。`PL!HS-pb1-009-R` 费用 15「日野下花帆」第一段用于验证该 UI/runner 壳。
- 当前边界：完整 `GameEvent -> trigger matcher`、when-if、更多移动或状态事件仍后续分批抽取。

### Stage 1S: Cheer-revealed selection

目标片段：`T04,F14,F15`

当前落地：

- `src/application/effects/cheer-selection.ts` 提供声援公开卡选择 helper：以 `liveResolution.first/secondPlayerCheerCardIds` 与 `resolutionZone.revealedCardIds` 找到“因本次声援公开且仍在处理区”的卡，再按卡效 selector 与目的地执行移动。
- `enqueueLiveSuccessCardEffects` 在存在成功 LIVE 时同时扫描成功 LIVE 卡来源与表演玩家舞台成员来源。
- `PL!HS-bp6-001-R＋` 费用 4「日野下花帆」LIVE 成功段验证舞台成员来源 `LIVE_SUCCESS`，并可将 1 张本次声援公开卡放回卡组顶。
- `PL!HS-cl1-009-CL` 分数 1「水彩世界」LIVE 成功段验证成功 LIVE 卡来源从本次声援公开卡中选择 1 张费用 4-9 成员加入手牌。
- 2026-06-15：目的地扩展到休息室，多选上限已可配置；`PL!HS-bp6-027-L` 分数 5「月夜見海月」验证从本次声援公开卡中选择至多3张无 BLADE HEART「莲之空」卡入休息室。

### Stage 1T: Additional cheer

目标片段：`E06`

当前落地：

- `src/application/effects/cheer.ts` 抽出声援公开 helper，负责从主卡组顶公开到解决区、登记 `liveResolution.first/secondPlayerCheerCardIds` / `secondPlayerCheerCardIds`、写入 `CheerEvent`，并沿用即时 refresh 检查。
- `PL!HS-bp6-027-L` 分数 5「月夜見海月」结算时按实际移动入休息室张数追加等量声援。
- 当前边界：追加声援仍不再次触发 `ON_CHEER`。`PL!S-bp2-004` 费用 11「黒澤ダイヤ」已验证重做声援：`replaceCurrentCheerCards=true` 只替换当前玩家的 current cheer IDs，默认/false 仍保持追加登记；新普通事件显式重新入队，Q107 的后续查询只看到第二次声援。该窄选项不构成通用 cheer loop、替代效果 DSL 或全部声援重置语义。

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

Stage 1A-1T 已完成当前主要底座抽取与多批真实卡效验证；最新一批 `绿莲-6弹ver.yaml` 已补齐 `PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-bp6-031` 分数 8「ファンファーレ！！！」与 `PL!HS-bp6-027` 分数 5「月夜見海月」。`PL!S-bp2-004` 费用 11「黒澤ダイヤ」已补齐首个重做声援样本；`PL!S-bp2-021-L` 分数 4「未体験HORIZON」已验证声援公开卡置卡组底。

下一步建议继续小步推进：

1. 后续再按实际卡效抽 condition / look-top / reveal-hand / grouped selection 配置，不一次性上完整事件系统。
2. 如果需要穿插低风险扩样本，再选 `PL!HS-PR-002-PR` 费用 10「村野さやか」的登场看顶 3 选 1。
3. 后续重做声援文本先比对 004 的窄语义；不要把该样本泛化为 cheer loop、替代效果 DSL 或所有声援重置语义，也不要复用 additional-cheer helper 触发递归。

这样仍然保持“一个底座、一组可运行卡、一组 focused tests”的节奏。
