# Card Effect Runner Migration Roadmap

> 文档类型：历史/计划文档
> 适用范围：runner 去中心化、runtime helper、workflow module 与 steps-lite 的迁移顺序
> 当前状态：迁移计划；完成状态以代码、测试和本表同步为准

本文记录 runner 去中心化路线。它不是一次性大重写计划；每一阶段都必须保持行为可验证。

## Status Legend

| status | meaning |
|---|---|
| `planned` | 尚未开始。 |
| `in_progress` | 已有代码或测试起步。 |
| `partial` | 已迁移部分调用点，但仍有同类旧逻辑。 |
| `blocked` | 需要先确认规则语义或完成前置拆分。 |
| `done` | 已完成并由测试覆盖。 |

## Roadmap

| phase | status | target | completion standard |
|---|---|---|---|
| R-0 | done | 建立卡效框架总文档与权威关系。 | `README.md`、目标架构、模块边界、迁移路线和旧文档索引落地。 |
| R-1 | partial | runtime action helpers。 | 抽牌、弃牌、回收等原子动作已有 runtime helper 和测试；看顶仍由 `src/application/effects/look-top.ts` 原语承接，更多区域移动/公开确认 helper 待真实 workflow 推动。 |
| R-2 | partial | activeEffect step handler registry。 | `confirmActiveEffectStep` 已先查 step registry，未命中 fallback 旧分支；look-top、抽后弃、回收等 workflow 已迁入 registry，复杂旧分支仍在 runner。 |
| R-3 | partial | pending / starter registry。 | `startPendingAbilityEffect` 已先查 starter registry，未命中 fallback 旧 switch；新增 queued workflow 应优先注册 starter。 |
| R-4 | partial | workflow family 迁出。 | look-top、discard look-top、draw-then-discard、waiting-room recovery、自送回收、支付能量回收、BP4-002 弃手回收、grouped recovery、fixed pay-energy gain-BLADE、arrange-top、opponent wait target、conditional live modifier 与 revealed-cheer selection 已离开 runner；grouped recovery 独立 family，不混入普通 recovery family。 |
| R-5 | partial | special card workflow 迁出。 | `HS_BP1_002`、`HS_BP5_001` activated、`HS_PB1_004`、`BP5_003`、`YOSHIKO` 已迁出；`HS_BP5_003` 离场站位变换段与 LIVE 开始弃手加 Heart 段均已迁入 Rurino 单卡 workflow；錯覚CROSSROADS、东条希等复杂特殊卡仍在 runner。 |
| R-6 | planned | trigger matcher T-2。 | 在 enqueue 边界稳定后，用纯 matcher 替代部分旧 trigger 判定，并保留 shadow 一致性测试。 |
| R-7 | planned | steps-lite。 | 只对 proven workflow family 建 typed builder；不做完整 DSL。 |

## R-1 Current Focus

Current start:

- `src/application/card-effects/runtime/actions.ts`
- `tests/unit/card-effect-runtime-actions.test.ts`

Current helper families:

- draw cards
- discard hand cards to waiting room
- recover waiting-room cards to hand
- activate waiting energy cards
- source-member BLADE modifier
- waiting-room shuffle to deck bottom

Next runtime candidates:

- inspect top choose
- public reveal confirm
- grouped zone selection

## R-2 / R-3 Current State

The largest runner pressure is not draw/discard actions; it is activeEffect step dispatch and card-specific workflows.

Current dispatch registries:

- `src/application/card-effects/runtime/step-registry.ts`
- `src/application/card-effects/runtime/starter-registry.ts`
- `src/application/card-effects/runtime/activated-registry.ts`

They are registry-first / fallback-old-runner entry points. Remaining work is to keep moving old starter/step/activated cases into workflow modules.

## R-4 Current Workflow Modules

Current migrated workflow modules:

- `workflows/shared/look-top-select-to-hand.ts`
- `workflows/shared/discard-look-top-select-to-hand.ts`
- `workflows/shared/named-hand-discard-live-start.ts`
- `workflows/shared/live-start-discard-gain-heart.ts`
- `workflows/shared/draw-then-discard.ts`
- `workflows/shared/waiting-room-to-hand.ts`
- `workflows/shared/self-sacrifice-waiting-room-to-hand.ts`
- `workflows/shared/pay-energy-waiting-room-to-hand.ts`
- `workflows/shared/discard-cost-waiting-room-to-hand.ts`
- `workflows/shared/grouped-recovery.ts`
- `workflows/shared/pay-energy-gain-blade.ts`
- `workflows/shared/arrange-inspected-deck-top.ts`
- `workflows/shared/opponent-wait-target.ts`
- `workflows/shared/conditional-live-modifier.ts`
- `workflows/shared/revealed-cheer-selection.ts`
- `workflows/cards/bp6-024-success-replacement.ts`
- `workflows/cards/bp5-005-rin.ts`
- `workflows/cards/hs-bp6-004-ginko.ts`
- `workflows/cards/hs-bp5-008-izumi.ts`
- `workflows/cards/hs-pb1-009-kaho.ts`
- `workflows/cards/hs-sd1-001-kaho.ts`
- `workflows/cards/hs-sd1-006-hime.ts`
- `workflows/cards/pr-017-nico.ts`
- `workflows/cards/hs-bp1-002-sayaka.ts`
- `workflows/cards/hs-bp5-001-kaho.ts`
- `workflows/cards/hs-bp5-003-rurino.ts`
- `workflows/cards/hs-pb1-004-ginko.ts`
- `workflows/cards/maki-on-enter.ts`
- `workflows/cards/bp5-003-kotori.ts`
- `workflows/cards/n-pb1-008-emma.ts`
- `workflows/cards/pl-bp3-014-rin.ts`
- `workflows/cards/sp-bp4-008-shiki.ts`
- `workflows/cards/sp-bp5-003-chisato.ts`
- `workflows/cards/yoshiko-play-low-cost-members.ts`

Recent helper modules added outside `actions.ts`:

- `runtime/workflow-helpers.ts`: ability text lookup, ability-use action glue, and PAY_COST action-log glue.
- `runtime/active-effect.ts`: shared activeEffect start glue, skip finish helper, and confirm-only pending bridge for activeEffect workflows.
- `runtime/source-member.ts`: source member slot lookup helper.
- `runtime/events.ts`: event-log delta queries for newly entered stage members and newly changed member orientation events.
- `runtime/grouped-selection.ts`: validates per-group min/max card selections for grouped recovery.

Runner line count after R-4Q-c CHISATO / EMMA single-card workflow migration was about 5285 lines, down from about 5667 after R-4Q-b. R-5B `HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE` migration brought the runner to about 5058 lines. R-5C `HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART` migration brought the runner to about 4830 lines. R-5D `BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT` migration brought the runner to about 4595 lines. R-5E `MAKI_ON_ENTER` migration brought the runner to about 4432 lines. R-5F `LL_BP1_001` / `LL_BP2_001` named hand discard Live-start migration brings the runner to about 4239 lines. The runner is still registry-first with fallback old branches; it is not complete.

`PR_017` 已迁到单卡 workflow wrapper，仍没有并入纯 self-sacrifice recovery family。`HS_SD1_001`、`SHIKI`、`CHISATO`、`EMMA`、`HS_BP5_003` 两段效果、`BP6_024` 成功区替代 hook、`MAKI` 登场交换与 LL named hand discard Live-start family 已迁到 workflow wrapper / hook。Remaining near-term R-4/R-5 candidates include complex workflows and helper cleanup only when another stable repeated axis appears.

## R-4O Conditional Live Modifier Outcome 2026-06-18

R-4O migrated the Live-start confirm-only modifier family into `src/application/card-effects/workflows/shared/conditional-live-modifier.ts`.

Covered effects:

- `NICO_LIVE_START_SCORE_ABILITY_ID` / `NICO_SCORE_BONUS`: waiting-room Muse count controls a player score modifier.
- `BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID` / `BOKUIMA_REQUIREMENT_REDUCTION`: successful Live count controls a rainbow requirement modifier.
- `HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID` / `HS_BP5_019_REQUIREMENT_REDUCTION`: other Hasunosora Live-zone cards control a green requirement modifier.
- `HS_BP2_022_LIVE_START_SCORE_ABILITY_ID` / `HS_BP2_022_SCORE_BONUS`: waiting-room Cerise Bouquet Live count controls a source-Live score modifier.
- `BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID` / `BP4_021_SUCCESS_SCORE_MODIFIER`: successful Live score total independently controls requirement and score modifiers.

The shared workflow owns only the confirm window, recomputation on confirm, modifier add/replace/null semantics, old payload field names, and ordered pending continuation. Card-specific condition checks and modifier strategies stay in per-ability config/functions, not in the runtime helper.

`runtime/active-effect.ts` now also provides `startPendingActiveEffect` and `startConfirmOnlyActiveEffect`. The helpers remove the pending ability, install an `activeEffect`, and write the start `RESOLVE_ABILITY` action; they do not evaluate conditions, pay costs, mutate zones, create modifiers, enqueue triggers, or decide finish behavior. R-4O uses `startConfirmOnlyActiveEffect`, and existing `pay-energy-gain-blade.ts` uses the lower-level `startPendingActiveEffect`.

Current follow-up candidates after R-5K:

- keep `BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID` deferred because its hand-adjust, draw, pending, and event-order boundary remains higher risk.
- EMMA 0-target coverage remains a non-blocking follow-up for an active-energy / EMMA window, not this runner decentralization slice.

## R-5K HS_BP1_004 Live-Start Pay Energy Gain Blade Outcome 2026-06-19

R-5K migrated `HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID` into the existing shared workflow `src/application/card-effects/workflows/shared/pay-energy-gain-blade.ts`.

Covered flow:

- step id remains `HS_BP1_004_LIVE_START_PAY_ENERGY`;
- starter still writes `START_PAY_ENERGY_OPTION`;
- HS_BP1_004 start payload keeps `activeEnergyCardIds` and `liveZoneCardCount`;
- activeEffect metadata keeps `orderedResolution`, `activeEnergyCardIds`, and `liveZoneCardCount`;
- pay / decline options are unchanged, and insufficient active energy still exposes only decline;
- decline still resolves through `finishSkippedActiveEffect`;
- pay finish still uses `payImmediateEffectCosts` with `TAP_ACTIVE_ENERGY` count 1;
- PAY_COST payload still keeps `pendingAbilityId`, `abilityId`, `sourceCardId`, `energyCardIds`, and `amount`;
- finish recomputes the BLADE bonus from the current `liveZone.cardIds.length` after paying, rather than trusting start metadata;
- when the recomputed live-zone count is 0, the workflow skips the BLADE modifier but still clears activeEffect, writes `PAY_ENERGY_GAIN_BLADE`, and continues pending;
- finish action still writes `PAY_ENERGY_GAIN_BLADE` with `paidEnergyCardIds` and `bladeBonus`.

The shared workflow gained only one narrow configuration axis: fixed BLADE bonus versus current live-zone card count. The new axis is sourced by the real HS_BP1_004 card text and is not a general formula or reward DSL. The existing fixed-bonus configs for HS_SD1_006, BP4_010, and HS_PR_001 retain their old metadata, payload, cost payment, and modifier semantics. Runner line count after R-5K is about 3707 lines.

Existing sample coverage still locks HS_BP1_004 paying 1 energy with 2 LIVE-zone cards for BLADE +2, plus the fixed-bonus pay-energy paths. R-5K added `tests/integration/pay-energy-gain-blade.test.ts` to lock HS_BP1_004 with 3 LIVE-zone cards: start step/options/metadata, paid energy orientation, BLADE modifier countDelta 3, and `PAY_ENERGY_GAIN_BLADE` payload `bladeBonus: 3`.

## R-5J BP5_005 Success-Score Active Energy Workflow Outcome 2026-06-19

R-5J migrated only `BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID` into the new single-card file `src/application/card-effects/workflows/cards/bp5-005-rin.ts`.

Covered flow:

- this remains an immediate pending starter and does not open an activeEffect;
- missing player still returns the original game state;
- `successLiveScore` still comes from `sumSuccessfulLiveScore(game, player.id)`;
- `conditionMet` still comes from `successLiveScoreAtLeast(game, player.id, 6)`;
- when `conditionMet` is true, the workflow still calls `placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.ACTIVE)`;
- when `conditionMet` is false, or energy placement returns null, the workflow still removes the pending ability, writes the resolve action, and continues pending with `placedEnergyCardIds: []`;
- action step remains `PLACE_ACTIVE_ENERGY_IF_SUCCESS_LIVE_SCORE`;
- payload keeps `pendingAbilityId`, `abilityId`, `sourceCardId`, `successLiveScore`, `conditionMet`, and `placedEnergyCardIds`;
- ordered pending continuation still uses the starter registry's `orderedResolution` option.

The workflow reuses existing helpers only: starter registry, `sumSuccessfulLiveScore`, `successLiveScoreAtLeast`, `placeEnergyFromDeckToZone`, and `OrientationState.ACTIVE`. No runtime helper, trigger matcher integration, or steps DSL was added. Runner line count after R-5J is about 3836 lines.

Existing sample coverage locks the `conditionMet: true` path at successful Live score 6 and active energy placement. R-5J added `tests/integration/bp5-005-rin.test.ts` to lock the `conditionMet: false` path: no energy placement, pending removal, resolve action, and `placedEnergyCardIds: []`.

## R-5I HS_BP6_004 Live-Start Discard Gain Blade Outcome 2026-06-19

R-5I migrated only `HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID` into the new single-card file `src/application/card-effects/workflows/cards/hs-bp6-004-ginko.ts`.

Covered flow:

- `HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID` and `HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID` remain in their existing paths;
- starter still writes `START_SELECT_DISCARD`, opens `HS_BP6_004_SELECT_DISCARD_FOR_BLADE`, and keeps `sourceSlot` plus `selectableCardIds` in the action payload;
- discard activeEffect keeps the old optional hand-to-waiting-room cost metadata, `AWAITING_PLAYER_ONLY` card visibility, selection label, and `不发动` skip label;
- skip still resolves through `finishSkippedActiveEffect` and continues pending;
- finish still validates that the selected card id is in the activeEffect candidates and still in hand;
- discard still uses `discardOneHandCardToWaitingRoomForPlayer` with `candidateCardIds` from the activeEffect;
- `discardedWasGinko` still uses the old selector shape `and(typeIs(CardType.MEMBER), cardNameIs('百生吟子'))`;
- BLADE modifier still uses `addBladeLiveModifierForSourceMember` with amount 2 for discarded Ginko and 1 otherwise;
- finish still writes `DISCARD_HAND_CARD_GAIN_BLADE` with `sourceSlot`, `discardedCardId`, `discardedWasGinko`, and `bladeBonus`.

This is intentionally a single-card workflow because the 「百生吟子」 extra BLADE branch is card-specific. No shared discard-gain-BLADE family, runtime helper, trigger matcher integration, or steps DSL was added. Runner line count after R-5I is about 3875 lines.

Existing sample coverage already locks the LIVE-start order selection with the wait-opponent-member effect, the Ginko-discard `bladeBonus: 2` path, and continuation with other LIVE-start pending effects. R-5I did not add duplicate tests.

## R-5H HS_PB1_009 Enter-Stage Blade Workflow Outcome 2026-06-19

R-5H migrated only `HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID` into the existing single-card file `src/application/card-effects/workflows/cards/hs-pb1-009-kaho.ts`.

Covered flow:

- trigger matching, center-slot requirement, and per-turn-limit enqueue rules remain in the existing runner/GameSession path;
- manual order selection still uses the confirm-only pending bridge via `startConfirmOnlyPendingAbilityEffect`;
- the bridge still keeps the pending ability in place and does not write a `START_CONFIRM` action;
- confirming the bridge returns to the starter with `skipManualConfirmation`, then removes the pending ability;
- real resolution still records `ABILITY_USE`, applies `addBladeLiveModifierForSourceMember` with amount 2, writes `APPLY_BLADE_BONUS`, and continues pending;
- `APPLY_BLADE_BONUS` keeps `pendingAbilityId`, `abilityId`, `sourceCardId`, `bladeBonus: 2`, and `sourceSlot`;
- if the BLADE modifier helper cannot apply, resolution returns the original game state without partially removing pending or recording ability use.

The workflow reuses existing helpers only: `startConfirmOnlyPendingAbilityEffect`, `getAbilityEffectText`, `recordAbilityUseForContext`, `addBladeLiveModifierForSourceMember`, and the starter registry. No runtime helper, trigger matcher integration, or steps DSL was added. Runner line count after R-5H is about 3977 lines.

Existing `sample-card-effect-runner.test.ts` coverage already locks the auto BLADE +2 path with `ABILITY_USE`, manual confirm-only pending bridge, ordered resolution without confirm-only, and the per-turn limit of two uses. R-5H did not add duplicate tests.

## R-5G Live-Start Discard Gain Heart Outcome 2026-06-19

R-5G migrated only the two existing LIVE-start discard-to-gain-Heart effects into `src/application/card-effects/workflows/shared/live-start-discard-gain-heart.ts`.

Covered effects:

- `KOTORI_LIVE_START_HEART_ABILITY_ID`: discard 1 hand card, then choose only PINK / YELLOW / PURPLE Heart.
- `HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID`: discard 1 hand card, require another stage member before Heart selection, then choose from the six standard Heart colors.

Covered flow:

- starter still writes `START_SELECT_DISCARD` and opens `KOTORI_LIVE_START_SELECT_DISCARD`;
- discard activeEffect keeps the old optional hand-to-waiting-room cost metadata, selection label, skip label, and `AWAITING_PLAYER_ONLY` card visibility;
- skip still resolves through `finishSkippedActiveEffect` and writes old `SKIP` semantics;
- discard still uses `discardOneHandCardToWaitingRoomForPlayer` with `candidateCardIds` from the activeEffect;
- discard finish still writes `DISCARD_HAND_CARD`, then opens `KOTORI_LIVE_START_SELECT_HEART`;
- HS_BP1_006 no-other-member path clears the activeEffect, writes `DISCARD_HAND_CARD_NO_OTHER_MEMBER`, and continues pending without a Heart modifier;
- Heart confirmation still writes `APPLY_HEART_BONUS` with only `heartColor` in the action payload and adds a `HEART` live modifier targeting `SOURCE_MEMBER`.

This shared family deliberately supports only the two proven configuration axes from these cards: whether another stage member is required, and the exact Heart color options. It is not a general discard or reward DSL. Runner line count after R-5G is about 4026 lines.

Existing sample coverage still locks Kotori yellow Heart, HS_BP1_006 blue Heart with another member, and HS_BP1_006 no-other-member no-Heart paths. R-5G also added `tests/integration/live-start-discard-gain-heart.test.ts` to lock HS_BP1_006's six standard Heart color options after the discard step.

## R-5F Named Hand Discard Live-Start Outcome 2026-06-19

R-5F migrated only the two existing named hand discard Live-start effects into `src/application/card-effects/workflows/shared/named-hand-discard-live-start.ts`.

Covered effects:

- `LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID`: named candidates are 上原歩夢 / 澁谷かのん / 日野下花帆, discard exactly 3, gain SCORE +3.
- `LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID`: named candidates are 渡辺曜 / 鬼塚夏美 / 大沢瑠璃乃, discard at least 1 and at most the current selectable count, gain BLADE equal to discarded count.

Covered flow:

- starter still writes `START_SELECT_NAMED_HAND_DISCARD` and opens `SELECT_NAMED_HAND_DISCARD`;
- metadata keeps `namedHandDiscardNames`, `namedHandDiscardRewardKind`, `namedHandDiscardRewardAmount`, `sourceSlot`, and `orderedResolution`;
- candidates still come only from current hand cards matching `cardNameAliasAny(names)`;
- finish validates de-duplicated selected card ids, min/max count, selectable membership, and current hand membership before discarding;
- no selected card ids still resolves through the shared skip helper and old `SKIP` semantics;
- discard still uses `discardHandCardsToWaitingRoomForPlayer` with `candidateCardIds` from the activeEffect;
- finish writes `DISCARD_NAMED_HAND_CARDS_GAIN_SCORE` or `DISCARD_NAMED_HAND_CARDS_GAIN_BLADE`, then appends the SCORE / BLADE live modifier and continues pending.

This shared family deliberately supports only the two proven reward kinds from these cards: fixed SCORE and BLADE per discarded card. It is not a general cost/reward DSL. Runner line count after R-5F is about 4239 lines.

Existing sample coverage still locks LL-bp1-001 SCORE +3 and LL-bp2-001 BLADE per discarded-card success paths. R-5F also added `tests/integration/named-hand-discard-live-start.test.ts` to lock the LL-bp2 default max-count behavior when only one named card is selectable.

## R-5E MAKI On-Enter Workflow Outcome 2026-06-18

R-5E migrated only `MAKI_ON_ENTER_ABILITY_ID` into `src/application/card-effects/workflows/cards/maki-on-enter.ts`.

Covered flow:

- starter still opens `MAKI_SELECT_HAND_LIVE` even when no hand Live is selectable, writes `START_SELECT_HAND_LIVE`, and preserves ordered pending metadata;
- selecting a hand Live advances to `MAKI_SELECT_SUCCESS_LIVE`, writes `REVEAL_HAND_LIVE`, and preserves `metadata.handLiveCardId`;
- both selection steps remain skippable through the old `SKIP` action semantics;
- finish first calls `startSuccessZoneReplacementEffect` with `origin: 'MAKI_HAND_SUCCESS_SWAP'`; when BP6_024 opens a replacement activeEffect, MAKI returns immediately and does not natural-swap;
- when no replacement hook opens, the natural swap moves the selected hand Live to successZone, returns the selected success Live to hand, writes `FINISH`, clears activeEffect, and continues pending.

The workflow reuses `startPendingActiveEffect`, `finishSkippedActiveEffect`, `getAbilityEffectText`, the starter/step registries, and the BP6_024 hook. It does not introduce a replacement DSL or new runtime helper. Runner line count after R-5E is about 4432 lines.

Test coverage added one GameSession regression in `sample-card-effect-runner.test.ts` for the no-BP6_024 natural swap path, locking the two MAKI steps, final hand/successZone zones, and `FINISH` payload.

## R-5D BP6_024 Success-Zone Replacement Hook Outcome 2026-06-18

R-5D migrated only `BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID` success-zone replacement hook and step into `src/application/card-effects/workflows/cards/bp6-024-success-replacement.ts`.

Covered flow:

- GameSession's successful-Live placement command still tries `startSuccessZoneReplacementEffect` before the natural `createSelectSuccessCardAction` path;
- MAKI finish still calls the same hook for `MAKI_HAND_SUCCESS_SWAP`; MAKI itself was later migrated in R-5E;
- `LIVE_SUCCESS` replacement success keeps the original BP6_024 Live in liveZone, moves the selected waiting-room `μ's` Live to successZone, and marks `successCardMovedBy` / `liveResults`;
- `LIVE_SUCCESS` skip or no candidate keeps the natural move from liveZone to successZone;
- `MAKI_HAND_SUCCESS_SWAP` replacement success keeps the original BP6_024 Live in hand, returns the prior success Live to hand, and moves the selected waiting-room `μ's` Live to successZone;
- `MAKI_HAND_SUCCESS_SWAP` skip keeps the natural hand/success-zone swap;
- action steps remain `START_SUCCESS_ZONE_REPLACEMENT`, `FINISH_REPLACE`, and `FINISH_SKIP`, with the old origin / original-card / success-live / ordered-resolution metadata shape.

The module registers the BP6_024 activeEffect step handler through the step registry and exports `startSuccessZoneReplacementEffect` for GameSession and MAKI. It deliberately does not introduce a replacement DSL or shared replacement family. Runner line count after R-5D is about 4595 lines.

No new runtime helpers were added. Existing sample coverage already locks ordinary successful Live replacement, skip, no-candidate natural placement, and the MAKI swap replacement path.

## R-5C HS_BP5_003 Live-Start Same-Group Heart Outcome 2026-06-18

R-5C migrated only `HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID` into `src/application/card-effects/workflows/cards/hs-bp5-003-rurino.ts`.

Covered flow:

- no hand still resolves without opening an activeEffect and writes `NO_HAND_TO_DISCARD`;
- the discard selection keeps `HS_BP5_003_SELECT_DISCARD_FOR_MEMBER_HEART`, optional skip label `不发动`, awaiting-player-only visibility, and the old hand-to-waiting-room cost metadata;
- skipped selection still goes through `finishSkippedActiveEffect`, writes `SKIP`, and continues ordered pending resolution;
- selected hand cards move through `discardOneHandCardToWaitingRoomForPlayer`, then same-group stage targets are found from both players using the discarded card's identity group fallback;
- no same-group target writes `DISCARD_HAND_CARD_NO_SAME_GROUP_TARGET`;
- target confirmation writes a `TARGET_MEMBER` pink Heart +1 live modifier and `APPLY_TARGET_MEMBER_HEART`, then continues pending.

Together with R-5B, both `HS_BP5_003` segments now live in the Rurino single-card workflow file. The workflow remains card-specific and does not introduce a shared Heart, discard, or position-change family. Runner line count after R-5C is about 4830 lines.

Test coverage added one GameSession regression in `sample-card-effect-runner.test.ts` that skips the discard selection, verifies the old `SKIP` action and unchanged hand/waiting-room zones, then verifies pending resolution returns to the ability-order selection and can continue to the next Live-start pending effect.

## R-5B HS_BP5_003 Leave-Stage Position Change Outcome 2026-06-18

R-5B migrated only `HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID` into `src/application/card-effects/workflows/cards/hs-bp5-003-rurino.ts`.

Covered flow:

- starter skips remain `LEAVE_STAGE_NOT_TO_WAITING_ROOM` and `NO_POSITION_CHANGE_TARGETS`;
- `HS_BP5_003_SELECT_POSITION_CHANGE_MEMBER` opens the optional public member selection with skip label `不发动`;
- `HS_BP5_003_SELECT_POSITION_CHANGE_SLOT` preserves selected member metadata and slot selection;
- finish still calls `moveMemberBetweenSlots`, writes `POSITION_CHANGE`, then enqueues `ON_MEMBER_SLOT_MOVED` using only the newly emitted member-slot-moved events before continuing pending.

The workflow reuses `getAbilityEffectText`, `startPendingActiveEffect`, `finishSkippedActiveEffect`, the starter/step registries, and `moveMemberBetweenSlots`. It deliberately keeps the position-change candidates and stage-location lookup as local card workflow helpers, not a shared position-change family or DSL.

Not migrated in R-5B:

- `HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID` remained in runner at R-5B and was later migrated in R-5C.
- `BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID`, `BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID`, and `MAKI_ON_ENTER_ABILITY_ID` remain deferred.

Test coverage added one GameSession regression in `sample-card-effect-runner.test.ts` that locks the `POSITION_CHANGE` action before `ON_MEMBER_SLOT_MOVED` trigger consumption and verifies the following pending effect continues.

## R-4Q-c CHISATO / EMMA Workflow Outcome 2026-06-18

R-4Q-c migrated `CHISATO` and `EMMA` into single-card workflow wrappers without introducing a shared activation-energy family.

Covered effects:

- `CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID` / `CHISATO_LIVE_START_ACTIVATE_ALL`: Live-start confirm window rechecks current own-stage Liella! members and all own energy cards, then activates those members and every energy card with the old `ACTIVATE_MEMBERS_AND_ENERGY` payload fields.
- `EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID` / `EMMA_SELECT_ACTIVATE_TARGET_TYPE` / `EMMA_SELECT_MEMBER_TO_ACTIVATE`: on-enter target-type selection can activate one current waiting stage member or up to two waiting energy cards in energy-zone order, preserving old no-target, member, and energy payload fields.

New workflow files:

- `src/application/card-effects/workflows/cards/sp-bp5-003-chisato.ts`
- `src/application/card-effects/workflows/cards/n-pb1-008-emma.ts`

Both workflows reuse `getAbilityEffectText` and `startPendingActiveEffect`; `EMMA` also reuses `activateWaitingEnergyCardsForPlayer` with an up-to-two waiting-energy count. `CHISATO` deliberately keeps `setEnergyOrientation(..., allEnergyCardIds, ACTIVE)` because the old effect activates all energy, not only waiting energy.

Current candidates after R-5F:

- keep `BP5_007` deferred; EMMA 0-target coverage remains a separate active-energy / EMMA follow-up;
- reveal / public-confirm helper cleanup only after another stable repeated axis appears.

## R-4Q-b SHIKI Workflow Outcome 2026-06-18

R-4Q-b migrated the two `SHIKI` effects into `src/application/card-effects/workflows/cards/sp-bp4-008-shiki.ts`.

Covered effects:

- `SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID` / `SHIKI_RIGHT_ACTIVATE_ENERGY`: right-side on-enter confirmation activates up to two waiting energy cards.
- `SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID` / `SHIKI_LIVE_START_POSITION_CHANGE`: Live-start optional position change moves SHIKI to another member slot or skips.

The workflow reuses `getAbilityEffectText`, `startPendingActiveEffect`, and `activateWaitingEnergyCardsForPlayer`. It passes an up-to-two waiting-energy count so 0, 1, or 2 waiting energy cards all resolve. The position-change branch remains card-specific, and `ON_MEMBER_SLOT_MOVED` enqueue still happens after the move and `POSITION_CHANGE` action through the injected runner lifecycle hook.

Later follow-up:

- `CHISATO` and `EMMA` were later migrated as separate card workflow wrappers; R-5B later migrated the `HS_BP5_003` leave-stage position-change segment only.

## R-4Q-a HS_SD1_001 Relay-Replaced Energy Outcome 2026-06-18

R-4Q-a migrated `HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID` into `src/application/card-effects/workflows/cards/hs-sd1-001-kaho.ts`.

The runner still owns the `ON_LEAVE_STAGE` enqueue lifecycle and high-cost Hasunosora replacement prefilter, but the pending starter now lives in the workflow. The workflow rechecks the replacement condition at resolve time, preserves `CONDITION_NOT_MET` and `ACTIVATE_TWO_ENERGY_AFTER_RELAY` payload fields, and uses `activateWaitingEnergyCardsForPlayer` with an up-to-two waiting-energy count so 0, 1, or 2 waiting energy cards all resolve.

`runtime/active-effect.ts` now also provides `startConfirmOnlyPendingAbilityEffect` and `finishConfirmOnlyPendingAbilityEffect`. This bridge is for manual ordered pending selection: it installs a confirm-only `activeEffect` without removing the pending ability, then resumes the starter through a callback with `skipManualConfirmation`. It is distinct from `startConfirmOnlyActiveEffect`, which removes pending and writes a start action.

Later follow-up:

- `CHISATO` and `EMMA` were later migrated as separate card workflow wrappers; R-5B later migrated the `HS_BP5_003` leave-stage position-change segment only.

## R-4P Revealed-Cheer Selection Outcome 2026-06-18

R-4P migrated the "choose from this cheer's revealed cards" family into `src/application/card-effects/workflows/shared/revealed-cheer-selection.ts`. The runner now only registers the workflow handlers and no longer owns the start / confirm branches for these effects.

Covered effects:

- `HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID` / `HS_BP6_001_SELECT_REVEALED_CHEER_TO_TOP`: choose one card revealed by the current cheer and still in the processing zone, then put it on top of the main deck.
- `HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID` / `HS_CL1_009_SELECT_REVEALED_CHEER_MEMBER_TO_HAND`: choose one eligible revealed MEMBER from the current cheer and add it to hand.
- `HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID` / `HS_BP6_027_SELECT_REVEALED_CHEER_TO_WAITING_ROOM`: choose up to three eligible revealed cheer cards, move them to the waiting room, then perform the same count of additional cheer with the existing non-recursive additional-cheer guard.

The shared workflow reuses `effects/cheer-selection.ts` for selecting cards that were revealed by the current cheer and are still in the processing zone, and `effects/cheer.ts` for additional cheer. It preserves old skip/no-target payload fields and does not change cheer context consumption, processing-zone cleanup, event-log timing, or pending continuation.

Current candidates after R-5F:

- keep `BP5_007` deferred; EMMA 0-target coverage remains a separate active-energy / EMMA follow-up;
- reveal / public-confirm helper cleanup only after another stable repeated axis appears.

## R-4I Family Audit Snapshot 2026-06-18

### Grouped Recovery Audit And R-4J Outcome

Covered runner points:

- `HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID`
  - starter: `startPendingAbilityEffect` case near runner line 2733.
  - steps: `HS_BP6_017_SELECT_DISCARD_STEP_ID`, `HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID` near lines 2163 and 2172.
  - functions: `startHsBp6KahoLeaveStageDiscard`, `startHsBp6KahoWaitingRoomSelectionAfterDiscard`, `finishHsBp6KahoRecoverCards`.
- `HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID`
  - starter: case near line 2739.
  - steps: `HS_PB1_020_SELECT_DISCARD_STEP_ID`, `HS_PB1_020_SELECT_WAITING_ROOM_CARDS_STEP_ID` near lines 2195 and 2205.
  - functions: `startHsPb1GinkoDiscardTwoRecoverCeriseMemberAndHasunosoraLive`, `startHsPb1GinkoWaitingRoomSelectionAfterDiscardTwo`, `finishHsPb1GinkoRecoverCeriseMemberAndHasunosoraLive`.
- `BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID`
  - starter: case near line 2731.
  - steps: `BP6_005_SELECT_DISCARD_STEP_ID`, `BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS_STEP_ID` near lines 2213 and 2222.
  - functions: `startBp6005RinDiscardTwoRecoverYellowHeartCards`, `startBp6005RinWaitingRoomSelectionAfterDiscardTwo`, `finishBp6005RinRecoverYellowHeartCards`.

Shared shape:

- optional discard choice opens an activeEffect;
- chosen hand cards move to waiting room as cost;
- waiting-room candidates are selected by grouped predicates;
- recovery uses `recoverCardsFromWaitingRoomToHandForPlayer`;
- group-specific ids are preserved in action payload.

Stable axes to parameterize before implementation:

| axis | HS_BP6_017 | HS_PB1_020 | BP6_005 |
|---|---|---|---|
| discard count | 1 | 2 | 2 |
| discard optional | yes | yes | yes |
| start when cannot discard | activeEffect with empty/available hand and skip | direct `CONDITION_NOT_MET` or `NOT_ENOUGH_HAND_TO_DISCARD` | direct `SKIP_NOT_ENOUGH_HAND_TO_DISCARD` |
| precondition | none beyond pending source/player | waiting-room LIVE count >= 3 and hand >= 2 | hand >= 2 |
| recovery groups | LIVE up to 1 + MEMBER up to 1 | Cerise Bouquet MEMBER exactly if available + Hasunosora LIVE exactly if available | yellow-Heart MEMBER up to 1 + yellow-requirement LIVE up to 1 |
| recovery min/max | 0..2 optional | required count from available groups | 0..2 optional |
| no target after discard | selection step with 0 candidates can finish no selection | immediate `DISCARD_TWO_NO_RECOVERY_TARGET` | selection step with 0 candidates can finish no selection |
| cost after no target | kept | kept | kept |
| payload fields | `discardCardId`, `liveCardIds`, `memberCardIds` | `discardedHandCardIds`, `ceriseMemberCardIds`, `hasunosoraLiveCardIds`, `requiredRecoveryCount` | `discardedHandCardIds`, `yellowHeartMemberCardIds`, `yellowRequirementLiveCardIds` |

R-4J implemented this as `src/application/card-effects/workflows/shared/grouped-recovery.ts`, with `src/application/card-effects/runtime/grouped-selection.ts` for per-group min/max validation. The workflow registers the three pending starters and their discard/recovery step handlers, while preserving the old action payload fields and no-target behavior.

Tests now cover existing success paths plus HS_BP6_017 empty-hand skip, HS_PB1_020 precondition failures, HS_PB1_020 no-target-after-discard cost retention, single-group required recovery, and BP6_005 grouped selection rejection. The family remains deliberately separate from ordinary `waiting-room-to-hand.ts`.

### Other Audit Candidates

- Opponent wait target family: R-4M migrated `HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER`, `HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER`, and `SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER` into `src/application/card-effects/workflows/shared/opponent-wait-target.ts`. The config axes are target selector, start action step, step text, and selection label; the workflow preserves `SKIP_NO_TARGET`, `WAIT_OPPONENT_MEMBER`, member-state event enqueue timing, and source/target payload fields.
- Fixed pay-energy gain-BLADE family: R-4K migrated `HS_SD1_006`, `BP4_010`, and `HS_PR_001` into `src/application/card-effects/workflows/shared/pay-energy-gain-blade.ts`. The config axes are energy cost count and fixed BLADE bonus. `recordPayCostAction` now lives in `runtime/workflow-helpers.ts` and is also used by `workflows/cards/hs-bp5-001-kaho.ts`.
- Arrange top family: R-4L migrated `START_DASH` and `HS_BP6_001` into `src/application/card-effects/workflows/shared/arrange-inspected-deck-top.ts`, with `PL_BP3_014` handled by the thin wrapper `src/application/card-effects/workflows/cards/pl-bp3-014-rin.ts`. The shared core owns inspection, ordered deck-top return, unselected waiting-room movement, and inspection cleanup; the wrapper owns only the source-wait option and PAY_COST action before entering the shared core.
- Activation energy helper cleanup: R-4Q-a migrated `HS_SD1_001` into a single-card workflow, R-4Q-b migrated `SHIKI`, and R-4Q-c migrated `CHISATO` / `EMMA`. Do not retroactively collapse them into a shared activation-energy family unless another stable repeated axis appears.

## R-5 Special Workflow Candidates

These effects may remain card-specific, but should leave runner only after a narrow review:

- `PL!HS-bp5-003` 费用 2「大泽瑠璃乃」：LIVE 开始弃手后同团成员获得桃 Heart 与离场站位变换均已迁入 Rurino 单卡 workflow。
- `PL!-bp6-024-L` 分数 3「錯覚CROSSROADS」：成功区放置替代 hook 已迁入 BP6_024 单卡 hook 模块。
- `MAKI_ON_ENTER_ABILITY_ID`：已迁入 MAKI 单卡 workflow，保留对 BP6_024 replacement hook 的调用。
- `PL!-bp5-007` 费用 13「东条希」：换手登场后双方弃到 3 并各抽 3，继续暂缓。

## Guardrails

Every migration phase must preserve:

- pending order
- event consumption timing
- cost semantics
- cost payment timing
- ability registration semantics
- online projection visibility

Do not:

- connect trigger matcher to runner before T-2 is explicitly opened
- introduce full steps DSL
- change card text behavior while moving code
- clean or include long-term untracked asset/database directories
