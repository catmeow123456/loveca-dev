# Runtime Action Helpers

> 文档类型：设计文档
> 适用范围：卡效 runtime 原子动作 helper 的参数轴、当前状态与迁移要求
> 当前状态：目标设计与当前落地记录；具体实现以 `src/application/card-effects/runtime/` 为准

runtime action helper 只表达原子动作，不表达完整卡文流程。它们的价值不是立刻减少总代码行数，而是让 workflow 不再重复实现同一套移动、抽牌、弃牌和结果记录语义。

## Design Rules

- helper 应返回新 `GameState` 与必要结果，例如抽到或弃置的 cardIds。
- helper 不调用 `continuePendingCardEffects`。
- helper 不创建完整 pending / activeEffect。
- helper 不改变费用支付时机或事件消费时机。
- helper 不吞掉现有 action payload 需要的事实。
- helper 有 focused unit test 或被 integration test 覆盖。

## Current Runtime Actions

当前 `src/application/card-effects/runtime/actions.ts` 已起步：

| helper | responsibility | current semantic boundary |
|---|---|---|
| `drawCardsForPlayer` | 单个玩家按现有卡效抽牌语义抽 N 张。 | 复用 `drawCardsFromMainDeckToHand`；牌库不足时保持既有语义，不刷新、不补抽。 |
| `drawCardsForEachPlayer` | 按传入玩家顺序让每名玩家抽同样张数。 | 返回 `drawnCardIdsByPlayer`；用于双方依次抽。 |
| `discardHandCardsToWaitingRoomForPlayer` | 指定玩家从手牌精确弃置若干张到休息室。 | exact count；可传候选集合；内部复用现有弃手费用移动语义。 |
| `discardOneHandCardToWaitingRoomForPlayer` | 单张手牌弃置便捷 helper。 | 基于 exact-count helper。 |
| `recoverCardsFromWaitingRoomToHandForPlayer` | 指定玩家将已选择的休息室卡加入手牌。 | 固定 `WAITING_ROOM -> HAND`；候选集合必传；支持 exact 或 min/max 计数；不创建 activeEffect。 |
| `shuffleWaitingRoomCardsToDeckBottomForPlayer` | 将 caller 已确定的休息室卡洗切后放到主卡组底。 | 固定 `WAITING_ROOM -> MAIN_DECK_BOTTOM`；不扫描 selector，不写 action，不处理奖励或后续 workflow。 |
| `addBladeLiveModifierForSourceMember` | 为指定来源成员写入本次 LIVE 期间的 BLADE live modifier。 | 只做 source member BLADE 写入；不处理支付、弃手、公开、洗回、成功区判断、target member BLADE 或 action payload。 |

## Draw Helper Parameters

### `drawCardsForPlayer`

| parameter | meaning |
|---|---|
| `game` | 当前 `GameState`。 |
| `playerId` | 抽牌玩家。 |
| `count` | 抽牌张数。 |

Return:

- `gameState`
- `drawnCardIds`

Rules:

- 只用于卡效步骤抽牌。
- 不接管开局、阶段规则抽牌或调试命令。
- 不改变牌库不足语义。

### `drawCardsForEachPlayer`

| parameter | meaning |
|---|---|
| `game` | 当前 `GameState`。 |
| `playerIds` | 按此顺序连续抽牌。 |
| `count` | 每名玩家抽同样张数。 |

Return:

- `gameState`
- `drawnCardIdsByPlayer`

当前不支持不同玩家不同抽牌数；没有实卡证明前不提前泛化。

## Discard Helper Parameters

### `discardHandCardsToWaitingRoomForPlayer`

| parameter | meaning |
|---|---|
| `game` | 当前 `GameState`。 |
| `playerId` | 手牌被弃置的玩家。 |
| `selectedCardIds` | 选择弃置的手牌实例。 |
| `count` | 必须精确弃置的张数。 |
| `candidateCardIds` | 可选候选集合；用于防止选择越界。 |

Return:

- `gameState`
- `discardedCardIds`

Current boundary:

- 只覆盖 exact count。
- 目的地固定为休息室。
- 不区分 `actingPlayerId` / `discardPlayerId` / `selectingPlayerId`；这部分属于 activeEffect step 层。
- 不表达“弃到 N 张”“可选弃置”“费用期间事件消费”等复杂语义。

## Recovered Cards Helper Parameters

### `recoverCardsFromWaitingRoomToHandForPlayer`

| parameter | meaning |
|---|---|
| `game` | 当前 `GameState`。 |
| `playerId` | 休息室与手牌所属玩家。 |
| `selectedCardIds` | 已选择并按此顺序加入手牌的卡牌实例。 |
| `candidateCardIds` | 必传候选集合；用于防止选择越界。 |
| `exactCount` | 精确选择张数；与 min/max 互斥。 |
| `minCount` / `maxCount` | 选择数量范围；与 exactCount 互斥。 |

Return:

- `gameState`
- `movedCardIds`
- `selectedCardIds`
- `remainingCandidateIds`

Current boundary:

- source/destination 固定为 `WAITING_ROOM -> HAND`。
- 不扫描候选；selector 与 UI step 属于 workflow。
- 不处理 no-target 确认、公开确认、分组上限或后续奖励。
- 不表达费用支付或 pending 继续。

## Waiting Room Shuffle-To-Deck Helper Parameters

### `shuffleWaitingRoomCardsToDeckBottomForPlayer`

| parameter | meaning |
|---|---|
| `game` | 当前 `GameState`。 |
| `playerId` | 休息室与主卡组所属玩家。 |
| `cardIds` | caller 已确定要从休息室移走并洗切的卡牌实例。 |

Return:

- `gameState`
- `movedCardIds`
- `originalCardIds`

Current boundary:

- 只校验 player 存在、`cardIds` 无重复、且所有指定卡当前都在该玩家休息室。
- 只洗切 `cardIds` 这组卡，再追加到主卡组底；不洗整个主卡组。
- `cardIds=[]` 是 no-op，返回空 `movedCardIds`。
- 不扫描成员/LIVE 等 selector；`miraCraMemberCount`、合计移动数量、奖励、回收、activeEffect、pending continue 与 action payload 都由 caller 负责。
- 不作为万能 `moveAnyZoneToAnyZone`；休息室登场、grouped recovery、reveal confirm 仍暂缓。

## Live Modifier Action Parameters

### `addBladeLiveModifierForSourceMember`

| parameter | meaning |
|---|---|
| `game` | 当前 `GameState`。 |
| `playerId` | 获得 BLADE modifier 的玩家。 |
| `sourceCardId` | 获得 BLADE 的来源成员实例。 |
| `abilityId` | 写入 modifier 的能力来源。 |
| `amount` | 正整数 BLADE 数量；`amount <= 0` 返回 `null`。 |

Return:

- `gameState`
- `modifier`
- `bladeBonus`

Current boundary:

- 只验证 player 与 source member 归属，并调用 `addLiveModifier` 写入 `kind: 'BLADE'`。
- 不生成 action history；`bladeBonus`、费用、弃置、公开、洗回等 payload 仍由 caller 保持原样。
- 不处理 `TARGET_MEMBER` BLADE，例如 `PL!HS-bp6-031` 指定安养寺姬芽获得 BLADE +3。
- 不处理 `PL!-sd1-001`、`PL!N-pb1-004` 这类 continuous / dynamic projection。
- reveal / 公开确认 helper 仍暂缓，等待 reveal-hand wrapper 或更多真实样例稳定后再抽。

## Planned Helpers

### Inspect Top Choose

Target helper family:

- `createInspectTopChooseStep`
- `resolveInspectTopChooseStep`

Important axes:

- `playerId`
- `viewingPlayerId`
- `topCount`
- `chooseMin` / `chooseMax` / `exactCount`
- selector
- selected destination
- unselected destination
- selected reveal behavior
- order strategy
- no-target behavior

This family should not be named only `RevealTop` because many effects are private inspection and only reveal selected cards.

### Zone Move

Target helper family:

- public-zone selection and move helpers beyond `WAITING_ROOM -> HAND`
- grouped selection helpers
- destination-specific helpers for deck top / bottom / success zone / resolution zone

## Migration Requirement

When a runtime helper becomes available:

- New workflow must use it instead of hand-writing the same action.
- Existing runner call sites should be migrated in batches.
- Remaining hand-written call sites must be listed as either non-card-effect rule paths or explicit exceptions.
- If a helper only moves lines without reducing runner size, continue to the next layer: workflow module extraction and step handler registry.
