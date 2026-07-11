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
| R-2 | partial | activeEffect step handler registry。 | `confirmActiveEffectStep` 已先查 step registry，未命中时直接保持状态不变并返回；look-top、抽后弃、回收等 workflow 已迁入 registry，runner 不再承载完整卡效 fallback。 |
| R-3 | partial | pending / starter registry。 | `startPendingAbilityEffect` 已先查 starter registry，未命中时直接保持状态不变并返回；新增 queued workflow 必须注册 starter。 |
| R-4 | partial | workflow family 迁出。 | look-top、discard look-top、draw-then-discard、waiting-room recovery、自送回收、支付能量回收、activated pay-energy draw、BP4-002 弃手回收、grouped recovery、fixed pay-energy gain-BLADE、arrange-top、opponent wait target、conditional live modifier 与 revealed-cheer selection 已离开 runner；grouped recovery 独立 family，不混入普通 recovery family。 |
| R-5 | partial | special card workflow 迁出。 | `HS_BP1_002`、`HS_BP5_001` activated、`HS_PB1_004`、`BP5_003`、`YOSHIKO`、`HANAYO` activated、`BP5_007` pending workflow 已迁出；`HS_BP5_003` 离场站位变换段与 LIVE 开始弃手加 Heart 段均已迁入 Rurino 单卡 workflow；runner 完整卡效 fallback 已清空，但仍保留若干 matcher / relay / trigger 条件胶水。 |
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

- `workflows/shared/activated-pay-energy-draw.ts`：由 `PL!SP-bp5-020` 起动段与 `PL!HS-bp1-007` 第二个真实样本证明；SP 的 LIVE_SUCCESS 段仍归单卡 workflow。
- `domain/rules/live-modifiers.ts#memberHasMoreEffectiveHeartsThanPrinted`：`PL!HS-pb1-029` / `PL!HS-PR-028` 共用的有效 Heart 数量纯 query，不承载结算。

- `workflows/shared/look-top-select-to-hand.ts`
- `workflows/shared/discard-look-top-select-to-hand.ts`
- `workflows/shared/named-hand-discard-live-start.ts`
- `workflows/shared/live-start-discard-gain-heart.ts`
- `workflows/shared/draw-then-discard.ts`
- `workflows/shared/discard-then-draw.ts`
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
- `workflows/cards/pl-bp6-024-sakkaku-crossroads.ts`
- `workflows/cards/pl-bp5-005-rin.ts`
- `workflows/cards/hs-bp6-004-ginko.ts`
- `workflows/cards/hs-bp6-031-fanfare.ts`
- `workflows/shared/wait-discard-look-top-select-to-hand.ts`
- `workflows/shared/mill-top-gain-live-modifier.ts`
- `workflows/cards/hs-pb1-009-kaho.ts`
- `workflows/cards/hs-sd1-001-kaho.ts`
- `workflows/cards/hs-sd1-006-hime.ts`
- `workflows/cards/pl-pr-017-nico.ts`
- `workflows/shared/play-waiting-room-member-to-source-slot.ts`
- `workflows/cards/hs-bp5-001-kaho.ts`
- `workflows/cards/hs-bp5-003-rurino.ts`
- `workflows/cards/hs-pb1-004-ginko.ts`
- `workflows/cards/hs-pb1-012-ginko.ts`
- `workflows/shared/on-enter-discard-place-waiting-energy.ts`
- `workflows/cards/pl-sd1-006-maki.ts`
- `workflows/cards/pl-bp5-003-kotori.ts`
- `workflows/cards/n-pb1-008-emma.ts`
- `workflows/cards/n-pb1-004-karin.ts`
- `workflows/cards/pl-sd1-007-nozomi.ts`
- `workflows/cards/pl-pb1-015-maki.ts`
- `workflows/shared/on-enter-wait-look-top-two-arrange.ts`
- `workflows/cards/sp-bp4-008-shiki.ts`
- `workflows/cards/s-bp2-024-kimikoko.ts`
- `workflows/cards/sp-bp5-003-chisato.ts`
- `workflows/cards/s-bp2-006-yoshiko.ts`

`discard-then-draw.ts` now owns the proven hand-discard-before-draw family for `PL!HS-pb1-003`, `PL!HS-bp1-005`, and `PL!HS-PR-031`. Its stable axes are selector, selection bounds/decline copy, and the narrow draw-policy union. Only the ON_ENTER segment moved out of `hs-pb1-003-rurino.ts`; that card's hand-to-waiting AUTO remains card-local.

Recent helper modules added outside `actions.ts`:

- `runtime/workflow-helpers.ts`: ability text lookup, ability-use action glue, and PAY_COST action-log glue.
- `runtime/active-effect.ts`: shared activeEffect start glue, optional discard-one-hand activeEffect shell, reveal-from-hand step glue, skip finish helper, and confirm-only pending bridge for activeEffect workflows.
- `runtime/source-member.ts`: source member slot lookup helper.
- `runtime/events.ts`: event-log delta queries for newly entered stage members, newly changed member orientation events, and newly moved member-slot events.
- `runtime/grouped-selection.ts`: validates per-group min/max card selections for grouped recovery.
- `effects/relay-entered-members.ts`: pure query helper for stage members that entered by relay this turn; it checks current stage presence, `movedToStageThisTurn`, matching `ON_ENTER_STAGE`, and non-empty `relayReplacements`.
- `domain/rules/member-effective-cost.ts`: shared pure query for current member effective cost; application helpers and domain continuous modifiers use the same cost semantics without changing cost payment rules.
- `starter-registry.ts` / `step-registry.ts` context now exposes `delegatePendingAbility` for workflows that need to start an already constructed synthetic pending ability; it does not discover abilities, pay costs, remove natural pending abilities, or change trigger matcher behavior.

Runner line count after R-4Q-c CHISATO / EMMA single-card workflow migration was about 5285 lines, down from about 5667 after R-4Q-b. R-5B `HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE` migration brought the runner to about 5058 lines. R-5C `HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART` migration brought the runner to about 4830 lines. R-5D `BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT` migration brought the runner to about 4595 lines. R-5E `MAKI_ON_ENTER` migration brought the runner to about 4432 lines. R-5F `LL_BP1_001` / `LL_BP2_001` named hand discard Live-start migration brought the runner to about 4239 lines. After R-5U, complete card-effect fallback branches are empty; the runner still keeps matcher / relay / trigger condition glue until those framework boundaries are explicitly reopened.

`PR_017` 已迁到单卡 workflow wrapper，仍没有并入纯 self-sacrifice recovery family。`HS_SD1_001`、`SHIKI`、`CHISATO`、`EMMA`、`HS_BP5_003` 两段效果、`BP6_024` 成功区替代 hook、`MAKI` 登场交换、`PL!S-bp2-024` LIVE 成功抽弃 wrapper 与 LL named hand discard Live-start family 已迁到 workflow wrapper / hook。`PL!S-bp2-024` 不能放置入成功 LIVE 卡区只新增 `success-live-placement` 纯规则 helper，覆盖当前真实入区/替代/交换/手动移动入口；这不是完整 replacement DSL。Remaining near-term R-4/R-5 candidates include complex workflows and helper cleanup only when another stable repeated axis appears.

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

Current follow-up candidates after R-5U:

- runner complete card-effect fallbacks are now empty; keep remaining matcher / relay / trigger condition glue in runner until those framework boundaries are explicitly reopened.
- keep `target: 'PLAYER'` Heart type and `playerHeartBonuses` compatibility projection as a later domain cleanup candidate; no real application card effect currently writes PLAYER Heart.
- EMMA 0-target coverage remains a non-blocking follow-up for an active-energy / EMMA window, not this runner decentralization slice.

## N-sd1-010 Shioriko New Card Workflow Outcome 2026-06-19

This new-card slice completed only `PL!N-sd1-010-SD` plus the same-text `PL!HS-PR-002-PR` / `PL!HS-PR-005-PR` PR expansion.

Covered flow:

- `PL!HS-PR-002` and `PL!HS-PR-005` now reuse `GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` for the on-enter discard/look-top/take-one segment and `HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID` for the LIVE-start pay-two-energy gain-BLADE segment;
- the PR discard-look-top workflow keeps the existing `PL!HS-PR-001` mandatory take-one semantics and extends only the base-code text / selection-required branch;
- `PL!N-sd1-010` on-enter now reuses `MEMBER_ON_ENTER_DRAW_DISCARD_ABILITY_ID` / draw-then-discard shared workflow for draw 2 then discard 1;
- `PL!N-sd1-010` LIVE start originally lived in a narrow single-card workflow, then the `PL!SP-bp4-012` slice extracted it into `src/application/card-effects/workflows/shared/pay-energy-gain-heart.ts`;
- `PL!N-sd1-010` and `PL!SP-bp4-012` now both reuse the shared pay-energy-gain-Heart family;
- the Shioriko configuration opens a pay/decline activeEffect, pays exactly two active energy with `payImmediateEffectCosts`, records `PAY_COST`, then writes a `SOURCE_MEMBER` green Heart modifier through `addHeartLiveModifierForMember`;
- insufficient energy and decline paths do not pay cost, do not add Heart, clear `activeEffect`, and continue pending effects in order.

No pay-energy-gain-BLADE generalization, trigger matcher integration, cost-calculator change, steps DSL, or PLAYER Heart write was added.

## R-5U BP5_007 Nozomi Relay Hand Adjust Draw Workflow Outcome 2026-06-19

R-5U migrated only `BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID` pending starter / discard step / draw resolver into the new single-card workflow file `src/application/card-effects/workflows/cards/pl-bp5-007-nozomi.ts`.

Covered flow:

- the `enqueueSingleOnEnterCardEffect` low-cost relay filter and `isBp5007NozomiLowerCostRelayOnEnter` matcher glue remain in runner;
- the pending starter still removes the pending ability first, then either opens the next discard window or directly draws;
- discard player order remains `[controller, opponent]`;
- each discard count is recomputed from that player's current hand count minus 3, and players at 3 or fewer cards are skipped;
- discard windows keep `BP5_007_SELECT_HAND_DISCARD_TO_THREE`, awaiting-player-only ordered multi-select, exact min/max count, old labels, and `orderedResolution` / `discardPlayerIds` / `discardPlayerIndex` / `discardCount` metadata;
- discard confirmation keeps selected-card fallback, duplicate rejection, selectable-card validation, current-hand validation, and `discardHandCardsToWaitingRoomForPlayer` with the old count / candidate card ids;
- final draw still uses `drawCardsForEachPlayer([controller, opponent], 3)`, returns the original game on draw failure, and continues pending effects with the original ordered-resolution flag;
- `START_DISCARD_TO_THREE`, `DISCARD_TO_THREE`, and `DRAW_THREE_AFTER_HAND_ADJUST` payload names are preserved.

The workflow reuses existing helpers only: pending starter registry, active-effect step registry, `getAbilityEffectText`, `discardHandCardsToWaitingRoomForPlayer`, `drawCardsForEachPlayer`, and the registry-provided `continuePendingCardEffects` context. No runtime helper, hand-adjust DSL, shared family, trigger matcher integration, cost-calculator change, or new card effect was added. The workflow is 268 lines; it stays single-card because the two-player order, per-player skip windows, current-hand validation, activeEffect clear timing, final draw timing, and ordered continuation are all tightly coupled to this one card. A later helper cleanup candidate would need at least one more real card with the same two-player hand-adjust shape.

Existing sample coverage still locks both-player discard, direct draw when both players are already at 3 or fewer cards, non-relay no-trigger, and not-lower-cost relay no-trigger. R-5U added `tests/integration/pl-bp5-007-nozomi.test.ts` to lock the controller-skip / opponent-discard branch plus the key `START_DISCARD_TO_THREE`, `DISCARD_TO_THREE`, and `DRAW_THREE_AFTER_HAND_ADJUST` payloads. Runner line count after R-5U is about 2157 lines.

## R-5T SD1_008 Hanayo Activated Pay Energy Mill Workflow Outcome 2026-06-19

R-5T migrated only `HANAYO_ACTIVATED_ABILITY_ID` activated fallback into the new single-card workflow file `src/application/card-effects/workflows/cards/pl-sd1-008-hanayo.ts`.

Covered flow:

- `activateCardAbility` still checks `canUseActivatedAbilityThisTurn` before activated registry dispatch;
- the workflow still rejects existing `activeEffect`, non-main phase, non-active player, missing player/source card, non-owner source card, and non-`PL!-sd1-008` source card;
- action order remains ability-use recording, immediate `TAP_ACTIVE_ENERGY x2` payment, top-10 mill, `PAY_COST`, then `RESOLVE_ABILITY` with `MILL_TOP_TEN`;
- `PAY_COST` payload keeps only `abilityId`, `sourceCardId`, and `energyCardIds`, with no added `amount`;
- `RESOLVE_ABILITY` payload keeps `abilityId`, `sourceCardId`, `effectText`, `step: 'MILL_TOP_TEN'`, and `milledCardIds`;
- cost failure or mill failure returns the original game and does not half-commit ability-use or cost actions;
- per-turn limit remains owned by the existing activated ability gate, not the workflow.

The workflow reuses existing helpers only: activated ability registry, `recordAbilityUseForContext`, `recordPayCostAction`, `getAbilityEffectText`, `payImmediateEffectCosts`, and `moveTopDeckCardsToWaitingRoom`. No runtime helper, trigger matcher integration, cost-calculator change, steps DSL, or new card effect was added. The workflow is 71 lines, so no extraction was needed. Runner line count after R-5T is about 2383 lines.

Existing sample coverage still locks HANAYO success, `PAY_COST`, `ABILITY_USE`, same-card once-per-turn behavior, and another same-name card being usable. R-5T did not add a duplicate focused test. After R-5T, the remaining complete card-effect fallback candidate in runner is `BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID`.

## R-5S PB1_015 Own-Effect Wait Opponent Low-Cost Draw Resolver Outcome 2026-06-19

R-5S migrated only `PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID` pending resolution into the new single-card workflow file `src/application/card-effects/workflows/cards/pl-pb1-015-maki.ts`.

Covered flow:

- the resolver remains an immediate pending starter and does not open activeEffect;
- pending removal still happens before ability-use recording;
- ability-use recording now uses the existing `recordAbilityUseForContext` helper and keeps the old `ABILITY_USE` action shape;
- draw still uses `drawCardsForPlayer(..., 1)`;
- if drawing fails, the workflow returns the original game and does not half-commit pending removal or ability-use recording;
- finish action step remains `DRAW_CARD`;
- payload keeps `pendingAbilityId`, `abilityId`, `sourceCardId`, `sourceSlot`, `changedCardId`, `changedControllerId`, and `drawnCardIds`;
- ordered pending continuation still uses `options.orderedResolution`.

The workflow reuses existing helpers only: pending starter registry, `recordAbilityUseForContext`, `drawCardsForPlayer`, and the registry-provided `continuePendingCardEffects` context. No runtime helper, trigger matcher integration, cost-calculator change, or steps DSL was added. The existing PB1_015 matcher condition in `doesMemberStateChangedEventSatisfyAbility` remains in runner. Runner line count after R-5S is about 2445 lines.

Existing sample coverage still locks the trigger/action flow: the opponent low-cost member waits by own card effect, `TRIGGER_ABILITY` carries the changed card, and `RESOLVE_ABILITY` writes `DRAW_CARD` with the drawn card id. R-5S did not add a duplicate focused test.

## R-5R HS_PB1_012 On-Enter Recycle Recover Live Gain Blade Outcome 2026-06-19

R-5R migrated only `HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID` into the new single-card workflow file `src/application/card-effects/workflows/cards/hs-pb1-012-ginko.ts`.

Covered flow:

- step ids remain `HS_PB1_012_RECYCLE_MEMBERS_CONFIRM` and `HS_PB1_012_SELECT_WAITING_ROOM_LIVE`;
- starter still forces the `continue` option and writes `START_RECYCLE_BOTH_WAITING_ROOM_MEMBERS`;
- start payload and metadata keep `ownWaitingRoomMemberCardIds`, `opponentWaitingRoomMemberCardIds`, and `totalWaitingRoomMemberCount`;
- confirm still recomputes current own and opponent waiting-room members instead of trusting start metadata;
- confirm still recycles own waiting-room members first, then opponent waiting-room members;
- `totalMovedMemberCount < 20` still clears activeEffect, writes `RECYCLE_MEMBERS_CONDITION_NOT_MET`, and continues pending without recovering LIVE or adding BLADE;
- `totalMovedMemberCount >= 20` with no own waiting-room LIVE still gives the source member BLADE +2, writes `RECYCLE_MEMBERS_NO_LIVE_TARGET_GAIN_BLADE`, and continues pending;
- `totalMovedMemberCount >= 20` with own waiting-room LIVE still opens the waiting-room LIVE selection step, recovers exactly 1 selected LIVE to hand, gives the source member BLADE +2, writes `RECOVER_LIVE_GAIN_BLADE`, and continues pending;
- `RECOVER_LIVE_GAIN_BLADE` payload keeps `selectedCardId`, `movedOwnMemberCardIds`, `movedOpponentMemberCardIds`, `totalMovedMemberCount`, and `bladeBonus`;
- if the source-member BLADE helper returns null, the workflow returns the original game and does not half-commit the recovery / recycle branch.

The workflow reuses existing helpers only: pending starter registry, activeEffect step registry, `startPendingActiveEffect`, `getAbilityEffectText`, `shuffleWaitingRoomCardsToDeckBottomForPlayer`, `createWaitingRoomToHandSelectionConfig`, `createWaitingRoomToHandEffectState`, `recoverCardsFromWaitingRoomToHandForPlayer`, `addBladeLiveModifierForSourceMember`, plus existing opponent and selector/query helpers. R-5R deliberately does not introduce a recycle shared family or DSL. Runner line count after R-5R is about 2480 lines.

Existing sample coverage still locks the true path, the no-LIVE-but-BLADE path, and the `<20` no-BLADE path. R-5R added `tests/integration/hs-pb1-012-ginko.test.ts` to lock confirm-time reread of both waiting rooms and the recover-LIVE finish payload / BLADE ordering.

## R-5Q HS_BP6_031 Fanfare Recycle Workflow Outcome 2026-06-19

R-5Q migrated only `HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID` into the new single-card workflow file `src/application/card-effects/workflows/cards/hs-bp6-031-fanfare.ts`.

Covered flow:

- step ids remain `HS_BP6_031_RECYCLE_MEMBERS_OPTION` and `HS_BP6_031_SELECT_HIME_BLADE_TARGET`;
- starter still opens the activate / decline option window and writes `START_RECYCLE_WAITING_ROOM_MEMBERS_OPTION`;
- start payload and metadata keep `waitingRoomMemberCardIds` and `miraCraMemberCount`;
- activate finish still recomputes current waiting-room members and current `みらくらぱーく！` member count before recycling;
- member recycle still uses `shuffleWaitingRoomCardsToDeckBottomForPlayer`;
- `miraCraMemberCount < 15` still clears activeEffect, writes `RECYCLE_MEMBERS_CONDITION_NOT_MET`, and continues pending without BLADE;
- `miraCraMemberCount >= 15` with no own-stage `安養寺姫芽` target still clears activeEffect, writes `RECYCLE_MEMBERS_NO_HIME_TARGET`, and continues pending without BLADE;
- when an own-stage `安養寺姫芽` target exists, the workflow opens the Hime target selection step and writes `RECYCLE_MEMBERS_SELECT_HIME_TARGET`;
- target confirmation still gives the selected Hime BLADE +3, writes `TARGET_HIME_GAIN_BLADE`, clears activeEffect, and continues pending;
- decline still resolves through the shared skip finish path, writes `SKIP`, does not recycle waiting-room members, and does not add BLADE.

The workflow reuses existing helpers only: pending starter registry, activeEffect step registry, `startPendingActiveEffect`, `finishSkippedActiveEffect`, `getAbilityEffectText`, `shuffleWaitingRoomCardsToDeckBottomForPlayer`, and `addBladeLiveModifierForSourceMember`. The Hime BLADE modifier keeps the old internal shape by using the selected Hime as the modifier source card while the action payload keeps the original effect source card. R-5Q deliberately does not introduce a recycle shared family or DSL. Runner line count after R-5Q is about 2756 lines.

Existing sample coverage still locks the true path and the `<15` no-BLADE path. R-5Q added `tests/integration/hs-bp6-031-fanfare.test.ts` to lock decline and the `>=15` but no-Hime-target branch.

## R-5P KARIN Live-Start Reveal Position Change Outcome 2026-06-19

R-5P migrated only `KARIN_LIVE_START_ABILITY_ID` into the new single-card workflow file `src/application/card-effects/workflows/cards/n-pb1-004-karin.ts`.

Covered flow:

- step ids remain `KARIN_REVEAL_TOP_CARD` and `KARIN_POSITION_CHANGE`;
- main-deck-empty path still removes the pending ability, writes `FINISH`, keeps `inspectedCardIds: []` and `destination: null`, and continues pending;
- starter still inspects the top 1 card with public reveal and writes `START_INSPECTION`;
- activeEffect metadata keeps `sourceZone: ZoneType.MAIN_DECK` and `orderedResolution`;
- reveal finish still sends a revealed cost-9-or-less MEMBER to hand with `destination: HAND`, otherwise sends the revealed card to waiting room with `destination: WAITING_ROOM`;
- reveal finish clears `inspectionZone` / `inspectionContext`, writes `REVEAL_FINISH` with `inspectedCardIds`, `revealedCardId`, and `destination`, then either continues pending or opens the position-change step when the source KARIN remains on stage;
- position-change confirmation with no selected slot still returns the original game and does not write `SKIP`;
- successful position change still clears `activeEffect`, writes `POSITION_CHANGE`, enqueues `ON_MEMBER_SLOT_MOVED` triggers with the new slot-moved event delta, then continues pending.

The workflow reuses existing helpers only: pending starter registry, activeEffect step registry, `startPendingActiveEffect`, `getAbilityEffectText`, `inspectTopCards`, `clearInspectionCards`, `moveMemberBetweenSlots`, and the event delta helper. It deliberately does not introduce a mill reward DSL or position-change DSL. Runner line count after R-5P is about 2974 lines.

R-5P also promoted the duplicated local `getNewMemberSlotMovedEvents(before, after)` helper into `src/application/card-effects/runtime/events.ts`. The helper only reads the eventLog delta and filters newly added `ON_MEMBER_SLOT_MOVED` events; it does not enqueue triggers or decide timing. `SHIKI`, `HS_BP5_003` Rurino, and KARIN now use this shared helper.

Existing sample coverage already locks KARIN's low-cost member reveal-to-hand path, position-change payload, and ordered resolution. R-5P strengthened that sample to assert the `ON_MEMBER_SLOT_MOVED` eventLog entry and `POSITION_CHANGE` payload including `swappedCardId`. `tests/unit/card-effect-runtime-actions.test.ts` also now locks that the event delta helper returns only newly added member-slot-moved events.

## R-5O NOZOMI On-Enter Mill Draw Outcome 2026-06-19

R-5O migrated only `NOZOMI_ON_ENTER_ABILITY_ID` into the new single-card workflow file `src/application/card-effects/workflows/cards/pl-sd1-007-nozomi.ts`.

Covered flow:

- step id remains `NOZOMI_REVEAL_TOP_FIVE`;
- starter still inspects the top 5 cards with public reveal, removes the pending ability, and opens activeEffect;
- start action remains `START_INSPECTION` and keeps `pendingAbilityId`, `abilityId`, `sourceCardId`, and `inspectedCardIds`;
- activeEffect keeps `inspectionCardIds`, `sourceZone: ZoneType.MAIN_DECK`, and `orderedResolution`;
- finish validates ability id and step id before resolving;
- finish moves inspected cards with `moveInspectedCardsToWaitingRoom`;
- draw condition still uses `hasCardIdsMatchingSelector(game, inspectedCardIds, typeIs(CardType.LIVE))`;
- when a LIVE card was milled, the workflow draws 1 with `drawCardsForPlayer`;
- when no LIVE card was milled, it does not draw and writes `drawnCardId: null`;
- if the draw branch fails, the workflow returns the original game and does not half-commit the mill;
- the inspection context is cleared when the inspection zone is empty;
- finish action step remains `FINISH` with `milledCardIds`, `hasMilledLiveCard`, and `drawnCardId`;
- ordered pending continuation uses the activeEffect metadata.

The workflow reuses existing helpers only: pending starter registry, activeEffect step registry, `startPendingActiveEffect`, `getAbilityEffectText`, `inspectTopCards`, `moveInspectedCardsToWaitingRoom`, `hasCardIdsMatchingSelector`, and `drawCardsForPlayer`. No runtime helper, trigger matcher integration, cost-calculator change, or steps DSL was added. Runner line count after R-5O is about 3204 lines.

Existing sample coverage already locks both major paths: PL!-sd1-007-SD mills a LIVE and draws 1 with `drawnCardId`, and the no-LIVE path mills 5 without drawing with `hasMilledLiveCard: false` and `drawnCardId: null`. R-5O did not add a duplicate focused test.

## Reveal-From-Hand Helper Cleanup Outcome 2026-06-19

This cleanup did not migrate a runner fallback. It added `revealHandCardForActiveEffect` to `src/application/card-effects/runtime/active-effect.ts` for the stable “select a hand card, reveal it to both players, and advance the same activeEffect to the next step” shape.

Current real users:

- `HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID` in `workflows/cards/hs-bp5-001-kaho.ts`;
- `MAKI_ON_ENTER_ABILITY_ID` in `workflows/cards/pl-sd1-006-maki.ts`.

Helper boundary:

- validates activeEffect, candidate membership, player existence, and that the selected card is still in that player's hand;
- preserves and de-duplicates existing `activeEffect.revealedCardIds`;
- switches to the caller-provided next step, next text, candidate visibility, metadata patch, and action payload;
- defaults the next selectable-card visibility to `PUBLIC`;
- does not pay costs, move cards, recover cards, swap success-zone cards, compute same-name targets, clear activeEffect, continue pending, or decide skip semantics.

HS_BP5_001 kept the old `REVEAL_HAND_LIVE` action step and `revealedHandLiveCardId` / `revealedHandLiveCardName` payload and metadata. MAKI kept the old `REVEAL_HAND_LIVE` action step and `handLiveCardId` payload and metadata. The cleanup also fixes MAKI's reveal visibility: after revealing the hand LIVE, the activeEffect now includes `revealedCardIds: [handLiveCardId]`, matching the projection model used by HS_BP5_001.

Runner line count is unchanged at about 3204 lines.

## Optional Discard-One-Hand ActiveEffect Shell Cleanup Outcome 2026-06-19

This cleanup did not migrate a runner fallback. It added `createOptionalDiscardHandToWaitingRoomActiveEffect` to `src/application/card-effects/runtime/active-effect.ts` for the stable “open an optional discard 1 hand card to waiting room selection window” shape.

The helper only constructs `ActiveEffectState`. It keeps the old default discard-window semantics:

- step text `请选择要放置入休息室的手牌。也可以选择不发动此效果。`;
- `selectableCardVisibility: AWAITING_PLAYER_ONLY`;
- selection label `请选择要放置入休息室的卡牌`;
- `canSkipSelection: true`;
- skip label `不发动`;
- `effectCosts: [{ kind: DISCARD_HAND_TO_WAITING_ROOM, minCount: 1, maxCount: 1, optional: true }]`;
- matching `handToWaitingRoomCost`;
- caller metadata plus `orderedResolution`.

Replaced pure optional-discard-one windows:

- `workflows/shared/on-enter-discard-place-waiting-energy.ts`;
- `workflows/cards/hs-bp6-004-ginko.ts`;
- `workflows/cards/hs-bp5-003-rurino.ts` for only the LIVE-start discard Heart segment;
- `workflows/shared/live-start-discard-gain-heart.ts`;
- `workflows/shared/discard-look-top-select-to-hand.ts`.

The helper deliberately does not remove pending abilities, write action history, execute `discardOneHandCardToWaitingRoomForPlayer`, pay costs, continue pending, decide skip semantics, process extra costs, grouped recovery, or hand-adjust logic. These more complex discard windows remain explicit follow-up candidates rather than helper users:

- `workflows/cards/pl-bp5-003-kotori.ts`;
- `workflows/cards/hs-pb1-004-ginko.ts`;
- `workflows/shared/wait-discard-look-top-select-to-hand.ts`;
- `workflows/shared/grouped-recovery.ts`;
- `workflows/shared/discard-cost-waiting-room-to-hand.ts`.

Runner line count is unchanged at about 3204 lines.

## HEART Modifier Helper Cleanup Outcome 2026-06-19

This cleanup did not migrate a card workflow. It consolidated real “member gains HEART” writes through domain helpers in `src/domain/rules/live-modifiers.ts`:

- `createHeartLiveModifierForMember(game, options)` validates and creates a member HEART modifier without mutating game state;
- `addHeartLiveModifierForMember(game, options)` calls the builder, writes the modifier with `addLiveModifier`, and returns the new state, modifier, and `heartBonus`.

The helper deliberately lives in the domain rule module because continuous HEART effects are also collected there; placing it in application runtime actions would make domain rules depend back on application code. The public game action is now “a member gains HEART”. Internally it keeps existing modifier compatibility:

- when `memberCardId === sourceCardId`, the helper creates the old `target: SOURCE_MEMBER` shape;
- when `memberCardId !== sourceCardId`, the helper creates the old `target: TARGET_MEMBER` shape with `targetMemberCardId`;
- `playerId` means the player who owns the member receiving HEART, not necessarily the effect controller.

Read-only scan found no real application card effect writing `target: PLAYER`. The `LiveModifierState` `PLAYER` union branch and `playerHeartBonuses` compatibility projection remain in place for a future type/compat cleanup window.

Updated HEART users:

- `workflows/shared/live-start-discard-gain-heart.ts`: Kotori and HS_BP1_006 source-member HEART now use `addHeartLiveModifierForMember`;
- `workflows/shared/mill-top-gain-live-modifier.ts`: HS_PR_019 green source-member HEART now uses `addHeartLiveModifierForMember`;
- `workflows/cards/hs-bp5-003-rurino.ts`: Rurino same-group pink target-member HEART now uses `addHeartLiveModifierForMember` while preserving opponent-stage targets and actionHistory execution by the effect controller;
- continuous HEART definitions for BP5_008, BP4_002, and BP5_003 now use `createHeartLiveModifierForMember` and filter nulls.

`tests/unit/live-modifiers.test.ts` now locks source-member helper output, target-member helper output, member HEART staying out of `playerHeartBonuses` / `getPlayerLiveHeartModifiers`, and invalid member/heart inputs returning null. Existing integration coverage continues to lock Kotori / HS_BP1_006, HS_PR_019, Rurino target-member HEART, and continuous HEART modifier behavior. Runner line count is unchanged by this helper cleanup.

## R-5N KEKE On-Enter Place Waiting Energy Outcome 2026-06-19

R-5N migrated only `KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID` into the new single-card workflow file `src/application/card-effects/workflows/shared/on-enter-discard-place-waiting-energy.ts`.

Covered flow:

- step id remains `KEKE_SELECT_DISCARD_FOR_WAITING_ENERGY`;
- starter still builds discard candidates from the current hand excluding the source card id;
- starter removes the pending ability, opens the discard-hand activeEffect, and writes `START_SELECT_DISCARD`;
- activeEffect keeps awaiting-player-only card visibility, optional discard cost metadata, `orderedResolution`, and the old selection / skip labels;
- start action payload keeps `sourceCardId`, `step: START_SELECT_DISCARD`, and `selectableCardIds`;
- missing selected card still resolves through the shared skip finish path and writes the old `SKIP` action;
- finish validates the selected card is in `selectableCardIds` and still in hand;
- discard still uses `discardOneHandCardToWaitingRoomForPlayer` with activeEffect candidates;
- energy placement still uses `placeEnergyFromDeckToZone(..., 1, OrientationState.WAITING)`;
- if placement returns null, the workflow returns the original game and does not half-commit the discard;
- finish clears activeEffect, writes `PLACE_WAITING_ENERGY`, and continues pending from the activeEffect metadata;
- finish payload keeps `discardCardId` and `placedEnergyCardIds`.

The workflow reuses existing helpers only: pending starter registry, activeEffect step registry, `startPendingActiveEffect`, `finishSkippedActiveEffect`, `getAbilityEffectText`, `discardOneHandCardToWaitingRoomForPlayer`, and `placeEnergyFromDeckToZone`. No runtime helper, trigger matcher integration, cost-calculator change, or steps DSL was added. Runner line count after R-5N is about 3314 lines.

Existing sample coverage still locks KEKE success and source-only skip paths. R-5N added `tests/integration/on-enter-discard-place-waiting-energy.test.ts` to lock that the source card is excluded from discard candidates and skip does not place energy while writing `SKIP`.

## R-5M HS_PR_019 On-Enter Mill Gain Green Heart Outcome 2026-06-19

R-5M migrated only `HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID`; the flow now lives in `src/application/card-effects/workflows/shared/mill-top-gain-live-modifier.ts` after the later shared-workflow naming cleanup.

Covered flow:

- no manual-confirmation pending bridge was added; the old flow still opens the inspection activeEffect directly;
- step id remains `HS_PR_019_REVEAL_TOP_THREE`;
- starter still inspects the top 3 cards with public reveal, removes the pending ability, and opens activeEffect;
- start payload keeps `inspectedCardIds`;
- activeEffect keeps `inspectionCardIds`, `sourceZone: ZoneType.MAIN_DECK`, and `orderedResolution`;
- finish validates ability id and step id before resolving;
- `conditionMet` remains `inspectedCardIds.length === 3 && allCardIdsMatchingSelector(game, inspectedCardIds, memberHasHeartColor(HeartColor.GREEN))`;
- finish moves the inspected cards with `moveInspectedCardsToWaitingRoom` before writing the modifier;
- the inspection context is cleared when the inspection zone is empty;
- if `conditionMet` is true, the workflow writes a `HEART` / `SOURCE_MEMBER` green Heart modifier with count 1;
- if `conditionMet` is false, no modifier is written;
- finish action step remains `FINISH_MILL_TOP_THREE_CHECK_GREEN_HEART_MEMBERS` with `milledCardIds`, `conditionMet`, and `heartBonus`;
- ordered pending continuation uses the activeEffect metadata.

The workflow reuses existing helpers only: pending starter registry, activeEffect step registry, `startPendingActiveEffect`, `getAbilityEffectText`, `inspectTopCards`, `moveInspectedCardsToWaitingRoom`, `allCardIdsMatchingSelector`, `memberHasHeartColor`, and now the domain member HEART helper. No runtime helper, trigger matcher integration, cost-calculator change, or steps DSL was added. Runner line count after R-5M is about 3460 lines.

Existing sample coverage still locks the three-green-Heart-member path and green Heart modifier. R-5M added focused coverage, now under `tests/integration/mill-top-gain-live-modifier.test.ts`, to lock the false path: when one revealed card is not a green-Heart member, all 3 revealed cards move to waiting room, no HEART modifier is added, and the resolve payload writes `conditionMet: false` with `heartBonus: []`.

## R-5L HS_BP5_001 On-Enter Mill Gain Blade Outcome 2026-06-19

R-5L migrated only `HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID` into the existing single-card workflow file `src/application/card-effects/workflows/cards/hs-bp5-001-kaho.ts`. The activated HS_BP5_001 path in the same file was left intact.

Covered flow:

- manual confirmation still uses the confirm-only pending bridge via `startConfirmOnlyPendingAbilityEffect`;
- step id remains `HS_BP5_001_REVEAL_TOP_FOUR`;
- starter still inspects the top 4 cards with public reveal and writes `START_INSPECTION`;
- start payload keeps `inspectedCardIds`;
- activeEffect keeps `inspectionCardIds`, `sourceZone: ZoneType.MAIN_DECK`, and `orderedResolution`;
- finish validates ability id and step id before resolving;
- finish moves the inspected cards with `moveInspectedCardsToWaitingRoom`;
- LIVE detection still uses `typeIs(CardType.LIVE)` over the inspected cards;
- if a LIVE card is present, `addBladeLiveModifierForSourceMember` adds BLADE +2;
- if no LIVE card is present, `bladeBonus` is 0 and no modifier is written;
- the inspection context is cleared when the inspection zone is empty;
- finish action step remains `MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE` with `milledCardIds`, `liveCardIds`, and `bladeBonus`;
- ordered pending continuation uses the activeEffect metadata.

The workflow reuses existing helpers only: pending starter registry, activeEffect step registry, `startConfirmOnlyPendingAbilityEffect`, `getAbilityEffectText`, `inspectTopCards`, `moveInspectedCardsToWaitingRoom`, selector queries, and `addBladeLiveModifierForSourceMember`. No runtime helper, trigger matcher integration, cost-calculator change, or steps DSL was added. Runner line count after R-5L is about 3581 lines.

Existing sample coverage still locks the path where a revealed LIVE gives BLADE +2. R-5L added `tests/integration/hs-bp5-001-kaho.test.ts` to lock the no-LIVE path: all 4 revealed cards move to waiting room, no BLADE modifier is added, and the resolve payload writes `bladeBonus: 0` with `liveCardIds: []`.

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

R-5J migrated only `BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID` into the new single-card file `src/application/card-effects/workflows/cards/pl-bp5-005-rin.ts`.

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

Existing sample coverage locks the `conditionMet: true` path at successful Live score 6 and active energy placement. R-5J added `tests/integration/pl-bp5-005-rin.test.ts` to lock the `conditionMet: false` path: no energy placement, pending removal, resolve action, and `placedEnergyCardIds: []`.

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

R-5E migrated only `MAKI_ON_ENTER_ABILITY_ID` into `src/application/card-effects/workflows/cards/pl-sd1-006-maki.ts`.

Covered flow:

- starter still opens `MAKI_SELECT_HAND_LIVE` even when no hand Live is selectable, writes `START_SELECT_HAND_LIVE`, and preserves ordered pending metadata;
- selecting a hand Live advances to `MAKI_SELECT_SUCCESS_LIVE`, writes `REVEAL_HAND_LIVE`, and preserves `metadata.handLiveCardId`;
- both selection steps remain skippable through the old `SKIP` action semantics;
- finish first calls `startSuccessZoneReplacementEffect` with `origin: 'MAKI_HAND_SUCCESS_SWAP'`; when BP6_024 opens a replacement activeEffect, MAKI returns immediately and does not natural-swap;
- when no replacement hook opens, the natural swap moves the selected hand Live to successZone, returns the selected success Live to hand, writes `FINISH`, clears activeEffect, and continues pending.

The workflow reuses `startPendingActiveEffect`, `finishSkippedActiveEffect`, `getAbilityEffectText`, the starter/step registries, and the BP6_024 hook. It does not introduce a replacement DSL or new runtime helper. Runner line count after R-5E is about 4432 lines.

Test coverage added one GameSession regression in `sample-card-effect-runner.test.ts` for the no-BP6_024 natural swap path, locking the two MAKI steps, final hand/successZone zones, and `FINISH` payload.

## R-5D BP6_024 Success-Zone Replacement Hook Outcome 2026-06-18

R-5D migrated only `BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID` success-zone replacement hook and step into `src/application/card-effects/workflows/cards/pl-bp6-024-sakkaku-crossroads.ts`.

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
- selected hand cards move through `discardOneHandCardToWaitingRoomForPlayer`, then same-group stage targets are found from both players using the discarded card's structured `groupNames` identity;
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
- `BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID`, `BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID`, and `MAKI_ON_ENTER_ABILITY_ID` remained deferred at R-5B; they were migrated in later R-5 slices.

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

Current candidates after R-5F, before later R-5U cleanup:

- `BP5_007` was still deferred at this checkpoint and later migrated in R-5U; EMMA 0-target coverage remains a separate active-energy / EMMA follow-up;
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

Current candidates after R-5F, before later R-5U cleanup:

- `BP5_007` was still deferred at this checkpoint and later migrated in R-5U; EMMA 0-target coverage remains a separate active-energy / EMMA follow-up;
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

- Wait-self opponent-wait family: the former single-card `workflows/cards/n-bp5-004-karin.ts` moved to `workflows/shared/wait-self-opponent-wait.ts` when `PL!N-bp3-017` / `PL!N-bp3-023` supplied the next real same-flow samples. The migration only parameterizes target selector and player-facing target copy, preserving optional source WAITING payment, post-payment rescan, event-wrapper timing, no-target cost retention, and pending continuation; it does not claim a general cost DSL or change `opponent-wait-target.ts`.

- Opponent wait target family: R-4M migrated `HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER`, `HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER`, and `SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER` into `src/application/card-effects/workflows/shared/opponent-wait-target.ts`. The config axes are target selector, start action step, step text, and selection label; the workflow preserves `SKIP_NO_TARGET`, `WAIT_OPPONENT_MEMBER`, member-state event enqueue timing, and source/target payload fields.
- Fixed pay-energy gain-BLADE family: R-4K migrated `HS_SD1_006`, `BP4_010`, and `HS_PR_001` into `src/application/card-effects/workflows/shared/pay-energy-gain-blade.ts`. The config axes are energy cost count and fixed BLADE bonus. `recordPayCostAction` now lives in `runtime/workflow-helpers.ts` and is also used by `workflows/cards/hs-bp5-001-kaho.ts`.
- Arrange top family: R-4L migrated `START_DASH` and `HS_BP6_001` into `src/application/card-effects/workflows/shared/arrange-inspected-deck-top.ts`, with `PL_BP3_014` handled by the thin wrapper `src/application/card-effects/workflows/shared/on-enter-wait-look-top-two-arrange.ts`. The shared core owns inspection, ordered deck-top return, unselected waiting-room movement, and inspection cleanup; the wrapper owns only the source-wait option and PAY_COST action before entering the shared core.
- Activation energy helper cleanup: R-4Q-a migrated `HS_SD1_001` into a single-card workflow, R-4Q-b migrated `SHIKI`, and R-4Q-c migrated `CHISATO` / `EMMA`. Do not retroactively collapse them into a shared activation-energy family unless another stable repeated axis appears.

## R-5 Special Workflow Candidates

These effects may remain card-specific, but should leave runner only after a narrow review:

- `PL!HS-bp5-003` 费用 2「大泽瑠璃乃」：LIVE 开始弃手后同团成员获得桃 Heart 与离场站位变换均已迁入 Rurino 单卡 workflow。
- `PL!-bp6-024-L` 分数 3「錯覚CROSSROADS」：成功区放置替代 hook 已迁入 BP6_024 单卡 hook 模块。
- `MAKI_ON_ENTER_ABILITY_ID`：已迁入 MAKI 单卡 workflow，保留对 BP6_024 replacement hook 的调用。
- `PL!-bp5-007` 费用 13「东条希」：换手登场后双方弃到 3 并各抽 3，已迁入 `workflows/cards/pl-bp5-007-nozomi.ts`；runner 仅保留 relay/有效费用触发门禁胶水。

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
# PL!N-bp3-005 event-ordinal query/filter

- `src/domain/rules/member-turn-state.ts` 新增只读的本回合成员登场次数与指定 `ON_ENTER_STAGE` 事件 ordinal query；以最近 `ON_TURN_START`（缺失时最近 `ON_TURN_END`，再缺失时完整测试事件流）作为稳定回合边界。
- `OnEnterStageTriggerFilter.enteredOrdinalThisTurn` 是无卡号的通用入队前过滤轴；runner 仅调用 query 做薄 matcher 胶水，不接 T-2 matcher，也不改变 pending 顺序。
# Waiting-room ON_ENTER delegation boundary

已由 `PL!N-bp3-003` 与 `PL!SP-bp2-006` 建立窄 family：definition 显式 opt-in、休息室来源、空 source slot、无真实登场事件。当前不扩展为通用 timing delegation 或 steps DSL。
