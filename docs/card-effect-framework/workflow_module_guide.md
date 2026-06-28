# Workflow Module Guide

> 文档类型：编码标准
> 适用范围：卡效 workflow family、特殊卡 workflow、runner dispatch 的组织方式
> 当前状态：目标写法；现有旧 runner 逻辑按 `migration_roadmap.md` 分批迁移

workflow 是卡效流程的主要承载层。它可以是一类同型效果，也可以是一张特殊卡的单独流程。

## When To Create A Workflow Module

新增或迁移卡效时，满足任一条件就应放入 workflow module：

- 有多步 activeEffect。
- 有 start / finish 成对流程。
- 有弃牌后分支、看顶后选择、回收后奖励、替代放置等组合逻辑。
- 需要被 runner 用 `abilityId` dispatch。
- 是特殊卡，但流程超过简单确认或单个 runtime action。

## Family Workflow

同型效果放 family 文件。例如：

```text
src/application/card-effects/workflows/activated/self-sacrifice-recover.ts
src/application/card-effects/workflows/on-enter/look-top-select-to-hand.ts
src/application/card-effects/workflows/live-start/pay-energy-gain-blade.ts
```

Family workflow 应包含：

- config map：按 ability id 记录差异轴。
- starter：创建第一步 activeEffect 或直接结算。
- step handler：处理选择输入。
- local validation：只验证本 family 的卡文差异。

Before promoting more complex cards into a family workflow, run a small family audit. The audit should check whether at least three remaining effects share the same game operation and have stable parameter axes. Report:

- ability ids and step ids;
- real differences in cost, optionality, preconditions, target groups, counts, no-target behavior, and action payload;
- whether an existing shared workflow can absorb them;
- pending order, payment timing, event enqueue, cancel path, and no-target risks;
- minimum tests needed before extraction.

Do not keep moving only single-card wrappers when a stable family has emerged. Also do not merge grouped recovery into ordinary waiting-room-to-hand recovery before the group rules are documented and tested.

Grouped recovery is a dedicated shared family. Keep workflows that recover one card per named group in `workflows/shared/grouped-recovery.ts` or a similarly explicit module; represent the differences as discard count, preconditions, group selectors, per-group required/optional counts, no-target action step, and payload field names. Use a small validation helper for per-group selection bounds, but do not turn these rules into a general steps DSL or route them through ordinary `waiting-room-to-hand.ts`.

Fixed pay-energy gain-BLADE is a shared live-start family when the only stable axes are active energy cost and fixed BLADE amount. Keep the payment prompt, `PAY_COST` action log, source-member BLADE modifier, skip path, and pending continuation inside the workflow; do not fold payment execution into the action-log helper.

On-enter discard-then-recover-unit-card is a shared family when the stable operation is "optionally discard exactly one hand card, then recover exactly one waiting-room card from a named unit". Keep the axes to ability id, unit alias, step ids, action step labels, and UI text. The discard must use `discardOneHandCardToWaitingRoomAndEnqueueTriggers`, and the recovery target is a unit card of any card type, so the just-discarded card can be selected if it matches. If no hand exists, consume the pending ability without opening a window; if no target exists after payment, keep the paid cost and consume the pending ability. Do not merge this family into activated discard-cost recovery or a general steps DSL.

Arrange-top workflows may share a core when they inspect the deck top, let the player choose an ordered subset for deck top, and move unselected inspected cards to waiting room. Keep card-specific opt-in costs, such as waiting the source member before inspection, in a thin card wrapper that calls the shared core after the cost has fully resolved.

`CardAbilitySourceZone.WAITING_ROOM` is a narrow source-zone marker for real activated abilities whose source card is in its owner's waiting room. Keep support source-zone-aware in definitions, command validation, and UI entry points; do not broaden it into a generic DSL or trigger matcher surface.

Relay-enter draw/discard is a shared on-enter family when the operation is "if this member entered by relay from a named member, draw N then discard M". Keep the relay condition bound to the current pending ability's `relayReplacements` metadata, use `cardNameAliasIs` for the named replacement check, consume the pending ability as a no-op when the condition fails, and delegate the actual draw/discard step to the existing draw-then-discard workflow so hand discards continue to enqueue enter-waiting-room triggers.

Draw-then-discard may also carry a narrow `requiredSourceSlot` axis for real side-locked on-enter cards. Check the current authoritative source slot before drawing; when the side condition fails, consume the pending ability as a no-op and do not open the discard window.

Discard-look-top-select-to-hand may combine an alias selector with `memberOnly` when the real text says "named group/unit member card". Keep the discard cost on `discardOneHandCardToWaitingRoomAndEnqueueTriggers`, then build the reveal selector as `typeIs(CardType.MEMBER)` plus the alias predicate so LIVE cards from the same group remain in the inspected remainder.

Opponent wait target is a shared family when the operation is "choose one opponent stage member and change it to WAITING". Keep selector differences, action step, step text, and selection label in config. The workflow may reuse stage-member orientation selection helpers and event-log delta helpers, but it must enqueue `ON_MEMBER_STATE_CHANGED` only after the orientation change and resolve action have been recorded. Do not merge this family into activation-energy or other orientation-changing workflows unless their event timing, target side, and payload fields are identical.

Stage formation change is a shared family when the operation is "let the player move/swap current own main stage members, then commit the final stage atomically". Keep trigger timing, source zone, pre-draw, condition predicate, unit/group predicates such as "only 5yncri5e! stage members", and action step names in config. The workflow should expose `stageFormation` activeEffect state instead of enumerating `selectableOptions`, consume decline/skip without moving, and apply confirmed `moveHistory` through `rearrangeStageMembersByMoveHistoryAndEnqueueTriggers` so `RESOLVE_ABILITY` is recorded before all `ON_MEMBER_SLOT_MOVED` triggers are enqueued. Do not trust frontend `movedCardIds`: replay history from the current authoritative stage state, ignore same-slot moves, treat swaps as moving both members, and emit at most one moved event per member while preserving the full `moveHistory` in action payloads.

Conditional live modifier is a shared Live-start family when the operation is "open a confirm-only effect window, recompute a condition on confirm, then add/replace/clear Live modifiers". Keep the stable axes in config or local finish functions: counted zone, count threshold, requirement color, modifier target, add/replace/null behavior, start payload fields, and finish payload fields. Reuse activeEffect start glue for the window itself, but do not move card-specific condition checks or modifier strategy into the runtime helper.

On-move self Heart is a shared AUTO family when the operation is "this moved source member gains one fixed Heart color until Live end". Keep the stable axes to ability id, base card code, Heart color, and action payload labels. The workflow should consume the current `ON_MEMBER_SLOT_MOVED` pending, rely on definition-level `perTurnLimit`, write `SOURCE_MEMBER` Heart through `addHeartLiveModifierForMember`, and avoid filtering out movement caused by an opponent card effect. Do not merge BLADE or conditional movement rewards into this family.

Member-slot-moved observer glue is allowed only for exact card text that observes movement beyond the ordinary "the moved card's ON_MEMBER_SLOT_MOVED definition always queues" shape, such as requiring a specific `CARD_EFFECT` cause. Register those handlers through `runtime/member-slot-moved-observers.ts`; runner should only call the generic observer hook after the ordinary member-slot-moved path and any legacy observers. If a definition is only a classification/documentation surface for an observer-owned route, mark it `observerOnly` so the ordinary runner path cannot create unfiltered pending abilities.

For abilities whose printed once-per-turn limit is shared across multiple trigger routes, use the narrow definition queue guard `skipQueueWhenTurnLimitReached` instead of adding ability-id-specific checks in runner. The runner may skip queueing a definition with this flag when `canUseAbilityThisTurn` is already false, but the workflow must still recheck validity and consume stale pending abilities safely.

Resolved-ability observer glue is allowed only for exact card text that triggers after another ability has already recorded `RESOLVE_ABILITY`, such as `PL!-bp6-020`. Register those handlers through `runtime/resolved-ability-observers.ts`; runner should only call the generic observer hook before opening the next pending window. Keep each observer narrow: inspect the latest resolved action, validate the resolved definition category/source zone, source slot, source group, current LIVE card, and per-turn limit, then enqueue a card-specific pending ability. For exact energy-placement observers such as `PL!SP-bp5-004`, only trust an explicit non-empty `placedEnergyCardIds` payload and recheck that those cards are now in the controller's `energyZone`; do not treat paid/tapped energy payloads, energy-below moves, or empty placement arrays as placement triggers. Do not turn this into a broad trigger matcher or steps DSL.

Self position-change is a shared family when the operation is "optionally move this source member to a different member slot, swapping with an occupied target slot if needed". It covers proven on-enter examples through `GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID` and the `PL!SP-pb2-011` LIVE_START self-move ability id; keep the axes narrow to ability id / trigger timing / source zone. Finish must re-read the source slot, record `RESOLVE_ABILITY`, and use `moveMemberBetweenSlotsAndEnqueueTriggers` so downstream `ON_MEMBER_SLOT_MOVED` abilities can observe both normal moves and swaps.

Activated pay-energy self position-change is a shared family only for the proven pair `PL!SP-bp2-008` and `PL!SP-sd2-002`. Keep the stable axes to ability id, base card code, active energy cost count, and action payload labels. The workflow must pay `TAP_ACTIVE_ENERGY` and record `PAY_COST` before opening the mandatory movement activeEffect; finish must re-read the source stage slot, record the position-change `RESOLVE_ABILITY`, and only then enqueue `ON_MEMBER_SLOT_MOVED` through `moveMemberBetweenSlotsAndEnqueueTriggers`. Do not broaden this into a generic position-change DSL.

Activated wait-self discard-draw is a shared family when the stable operation is "source member ACTIVE -> WAITING, discard exactly one hand card to waiting room, then draw N cards". Keep the axes narrow to ability id, base card codes, and draw count. The source orientation cost must use member-state event enqueue, the hand discard must use the enter-waiting-room trigger wrapper, and no-hand / non-active source failures must happen before paying costs or consuming the turn-once limit.

Energy-below effects should first reuse the atomic helpers in `src/application/effects/energy-below.ts`: `stackEnergyFromEnergyZoneBelowMember` for automatic "put N energy from energy zone below this member" costs/effects, and `returnEnergyBelowMemberToEnergyDeck` / `returnEnergyBelowMemberToEnergyDeckForPlayer` for the leave-stage invariant. Do not promote a full shared workflow family until real cards prove stable axes for timing, optional payment, follow-up reward, and no-target behavior.

Original Heart color replacement uses `MEMBER_ORIGINAL_HEART_REPLACEMENT` as a Live modifier for "this member's printed original Heart becomes the chosen color". `getMemberEffectiveHeartIcons` applies that replacement to the printed Heart total before appending normal member Heart bonuses; it is not a PLAYER Heart write or a member "gain Heart" bonus.

Original Blade count replacement uses `MEMBER_ORIGINAL_BLADE_REPLACEMENT` as a Live modifier for "this member's printed original Blade count becomes N". `getMemberEffectiveBladeCount` applies the latest replacement as the original Blade count first, then appends normal member Blade bonuses; it is not equivalent to adding or subtracting a BLADE modifier, because printed Blade counts above the replacement value must also be overwritten.

Revealed-cheer selection is a shared family when the operation is "choose cards revealed by the current cheer and still in the processing zone, then move them or perform additional cheer". Keep selector differences, destination, min/max count, optional/skip behavior, additional-cheer count calculation, whether a successful move records a turn-once ability use, and payload field names in config. Reuse `effects/cheer-selection.ts` for current-cheer eligibility and `effects/cheer.ts` for additional cheer; do not reimplement resolution-zone movement, cheer context checks, or the non-recursive additional-cheer guard inside a workflow.

Success-zone placement prohibitions are not workflow families by themselves. Keep pure "can this LIVE enter SUCCESS_ZONE" rules in `domain/rules/success-live-placement.ts`, and call them from the natural success Live selection, replacement candidates, exchange candidates, and manual move validation. If the same card also has a LIVE_SUCCESS reward, implement that reward as a normal workflow wrapper, as `PL!S-bp2-024` does with draw-then-discard.

Example shape:

```ts
export function startSelfSacrificeRecoverWorkflow(game, params): GameState {
  const config = getSelfSacrificeRecoverConfig(params.abilityId);
  // send source member to waiting room
  // create recover selection step
}

export function finishSelfSacrificeRecoverWorkflow(game, input): GameState {
  // validate activeEffect and selected card
  // move waiting-room card to hand
  // clear activeEffect and continue pending
}
```

## Card-Specific Workflow

Loveca 很多卡是复杂复合效果，不需要强行塞进 family。对于无稳定同型的特殊卡，可以一张卡一个 workflow 文件。

Example:

```text
src/application/card-effects/workflows/live-start/hs-bp5-003-rurino.ts
```

This file may export:

```ts
export function startHsBp5003RurinoLiveStart(...)
export function finishHsBp5003RurinoDiscard(...)
export function finishHsBp5003RurinoTarget(...)
```

Rules:

- 特殊卡 workflow 可以包含卡文分支逻辑。
- 仍必须复用 runtime action 和 query helper。
- 不重复实现候选可见性、手牌移动、pending 继续等基础设施。
- 不为了 family 化把参数塞爆；特殊卡独立文件是可接受目标态。

## Runner Dispatch

Target start dispatch:

```ts
const PENDING_EFFECT_STARTERS = {
  [HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID]: startHsBp5003RurinoLiveStart,
};
```

Target step dispatch:

```ts
registerActiveEffectStepHandler(
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
  HS_BP5_003_SELECT_DISCARD_STEP_ID,
  finishHsBp5003RurinoDiscard
);
```

Runner should not need to know the internal step sequence of the workflow.

## Workflow File Checklist

Each workflow module should make these facts easy to see:

- handled ability ids
- trigger or activated entry point
- step ids it owns
- runtime helpers it uses
- metadata it writes
- no-target behavior
- whether selection is optional or mandatory
- tests that cover it

## Tests

Preferred tests:

- Keep behavior tests in `tests/integration/sample-card-effect-runner.test.ts` when the workflow spans pending / activeEffect.
- Add focused unit tests for runtime helper behavior.
- Keep ability registration tests in `tests/unit/card-effect-classification.test.ts`.

Workflow extraction should preserve existing tests. If behavior changes are intended, they must be a separate, explicitly reviewed change.
