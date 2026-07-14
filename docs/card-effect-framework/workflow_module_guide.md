# Workflow Module Guide

## ON_LEAVE_STAGE activate stage member

`workflows/shared/on-leave-activate-stage-member.ts` 服务 `PL!-PR-001` / `PL!-PR-002` 两个同文样本。固定轴为 `ON_LEAVE_STAGE`，且仅 `toZone === WAITING_ROOM` 时生效；候选仅包含双方主舞台的 WAITING 成员，可跳过。它不承载费用、奖励、团体筛选或任意状态 DSL。

Workflow finish handlers keep using the compatibility `continuePendingCardEffects`
callback, but must not choose the next ability or retain a private queue snapshot. The
runtime check-timing scheduler owns rule-processing re-entry, active/non-active priority,
and live-pool reselection. `orderedResolution` only applies to the selected batch; a newly
waiting ability cancels the shortcut and reopens player choice.

> 文档类型：编码标准
> 适用范围：卡效 workflow family、特殊卡 workflow、runner dispatch 的组织方式
> 当前状态：目标写法；现有旧 runner 逻辑按 `migration_roadmap.md` 分批迁移

workflow 是卡效流程的主要承载层。它可以是一类同型效果，也可以是一张特殊卡的单独流程。

`PL!S-bp3-001` 与 `PL!S-bp3-002` 是同一窗口但流程无关的两个单卡 ownership 样本：前者是主阶段选择成员待机费用并授予目标成员临时能力，后者是 LIVE_SUCCESS 从当前公开声援来源固定回手。它们分别保留在 `cards/s-bp3-001-chika.ts`、`cards/s-bp3-002-riko.ts`，只复用原子状态变化、modifier、声援移动和来源收集 helper，不拼成批次 workflow 或参数 DSL。

`workflows/shared/discard-cost-waiting-room-to-hand.ts` 也承接 `PL!-PR-003` / `PL!-PR-004`：两张卡因 Excel 玩家文本和指定 Heart 颜色不同而保留独立 abilityId，selector 分别读取 LIVE 自身印刷 `requirements.colorRequirements` 的黄 / 桃 Heart >=3。固定流程仍为强制弃2手牌、通过标准 enter-waiting-room wrapper 支付、支付后重扫自己的休息室、强制选1张合法目标并走 public-card-selection confirmation；因此本次弃置的合格 LIVE 可被回收。该扩展未新增 workflow/helper，也不需要 runner 注册。

## When To Create A Workflow Module

新增或迁移卡效时，满足任一条件就应放入 workflow module：

- 有多步 activeEffect。
- 有 start / finish 成对流程。
- 有弃牌后分支、看顶后选择、回收后奖励、替代放置等组合逻辑。
- 需要被 runner 用 `abilityId` dispatch。
- 是特殊卡，但流程超过简单确认或单个 runtime action。

## Family Workflow

`self-sacrifice-waiting-room-to-hand.ts` 承接“来源成员自送休息室后，从自己的休息室公开确认回收卡牌”的稳定 family。回收后的能量恢复只允许有限条件联合：成功 LIVE 区印刷分数总计，或本次实际回收 LIVE 自身的结构化团体与印刷分数；不接受任意 callback。`PL!-PR-017` 与 `PL!S-bp3-008` 是两个真实条件样本。

`live-start-discard-gain-blade.ts` 承接 LIVE_START queued 的“可选弃手，来源成员按实际弃置数获得 BLADE”稳定 family。当前配置轴仅为 abilityId、弃置 min/max、每张 BLADE，以及“弃置 LIVE 后抽1”的窄后处理；不接受任意 callback 或步骤 DSL。`PL!S-bp3-003` 证明多选与每张奖励轴，`PL!SP-PR-009/011/012` 保留 exactly 1 与弃 LIVE 抽1的旧语义。弃手统一走 trigger-safe wrapper，modifier 绑定来源成员实例，并通过统一 pending continuation 返回检查时点。

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

On-enter waiting-room card to deck-top is a narrow shared family for the proven identical-text bases `PL!N-bp4-021` and `PL!SP-bp2-013/014/018`. It owns only the optional 0～1 waiting-room selection, public-card-selection confirmation metadata, authoritative deadline restoration, final target revalidation, deck-top move, and pending continuation. Keep the existing shared ability definition and `moveWaitingRoomCardsToDeckTopForPlayer`; do not widen this family into a general zone-movement DSL.

Waiting-room selections that move chosen cards to hand or a known main-deck position must use the shared public-selection confirmation lifecycle before movement. Ordinary waiting-room-to-hand workflows receive it from `createWaitingRoomToHandEffectState`; grouped/custom recovery and deck top/bottom/position workflows opt in with narrow destination metadata. The first submission only publishes the chosen IDs through `revealedCardIds`; the original workflow remains responsible for final stale validation, movement, rewards, and continuation after the second confirmation. Fixed targets, whole-zone shuffles, and choices that select only a destination rather than a card do not opt in.

Revealed-cheer selections use the same lifecycle with `source: 'REVEALED_CHEER'`, including destinations that are already public such as waiting room. The shared runtime validates only current-cheer movable membership and owns pause/display/deadline restoration; `revealed-cheer-selection.ts` or the card workflow still owns printed selectors, costs, turn-use recording, additional cheer, reroll, action payloads, and continuation. Do not treat event-inclusive `CheerEvent.revealedCardIds` condition facts as movable targets. Server-determined all-card actions such as `PL!S-bp2-004` may call the low-level card-id window entry and resume through a narrow synthetic step, but must reject the whole move when the displayed set is no longer exactly movable rather than silently moving a stale subset.

Fixed pay-energy gain-BLADE is a shared live-start family when the only stable axes are active energy cost and fixed BLADE amount. Keep the payment prompt, `PAY_COST` action log, source-member BLADE modifier, skip path, and pending continuation inside the workflow; do not fold payment execution into the action-log helper.

Activated pay-energy draw is a shared family proven by `PL!SP-bp5-020` and `PL!HS-bp1-007`. Keep its axes narrow to ability id, active energy cost, draw count, and action copy. The definition owns the once-per-turn limit; the workflow validates current-player main phase, source membership/definition match, pays through `TAP_ACTIVE_ENERGY`, records `PAY_COST`, then records ability use and draws. Do not add target selection, pending behavior, or a generic activated DSL.

The pure `memberHasMoreEffectiveHeartsThanPrinted` query compares the sum of each `HeartIcon.count` in `getMemberEffectiveHeartIcons` with the printed member Hearts using one collected modifier snapshot. It includes SOURCE_MEMBER and TARGET_MEMBER additions, rejects wrong-player/off-stage/non-member cards, and treats original-color replacement without a count increase as false. Card-specific unit filters remain in workflows such as `hs-pb1-029-zenhoui-kyun.ts`.

On-enter discard-then-recover-unit-card is a shared family when the stable operation is "optionally discard exactly one hand card, then recover exactly one waiting-room card from a named unit". Keep the axes to ability id, unit alias, step ids, action step labels, and UI text. The discard must use `discardOneHandCardToWaitingRoomAndEnqueueTriggers`, and the recovery target is a unit card of any card type, so the just-discarded card can be selected if it matches. If no hand exists, consume the pending ability without opening a window; if no target exists after payment, keep the paid cost and consume the pending ability. Do not merge this family into activated discard-cost recovery or a general steps DSL.

On-enter workflows may read `pending.metadata.fromZone` when the printed condition depends on where the member entered from. The runner may propagate `EnterStageEvent.fromZone` into ordinary ON_ENTER pending metadata, and normal hand-play fallback sources should mark `ZoneType.HAND`; card-specific source checks still belong in workflow modules, not in runner gates or trigger matcher experiments.

Member-on-enter draw is a shared family when the whole operation is "this played member draws N cards" with no discard, target selection, optional payment, or follow-up movement. Keep the axes narrow to ability id, base card codes, draw count, and action step label. Draw-only effects should not be folded into draw-then-discard unless they genuinely share the discard step semantics.

Discard-then-draw is a separate shared family when the stable order is private hand multi-selection, optional decline, one grouped hand-to-waiting move, draw count derived from the actual discarded cards or the post-discard hand size, resolve action, then pending continuation. Keep the axes narrow to ability/step ids, selector, min/max selection, Chinese prompt/skip copy, and a small draw-policy union (`discarded count + offset` or `until hand size`). Use `discardHandCardsToWaitingRoomAndEnqueueTriggers`; do not merge this family with draw-then-discard or a general steps DSL. Current real samples are `PL!HS-pb1-003`, `PL!HS-bp1-005`, `PL!HS-PR-031`, and same-text `PL!N-PR-028`; the latter two share one ability identity and workflow configuration.

Arrange-top workflows may share a core when they inspect the deck top, let the player choose an ordered subset for deck top, and move unselected inspected cards to waiting room. The shared summary label can describe 登场, LIVE开始, or LIVE成功 sources, but the workflow must still own only the inspection / ordered deck-top / inspected-to-waiting-room flow. Keep card-specific opt-in costs, such as waiting the source member before inspection, in a thin card wrapper that calls the shared core after the cost has fully resolved.

When such a thin wrapper pays a discard cost before delegating, it may pass the narrow optional `discardedCostCardIds` summary context so STARTED and COMPLETED public summaries report the real cost. The shared arrange core does not select or pay that cost; callers without a discard cost continue to report an empty list.

`CardAbilitySourceZone.WAITING_ROOM` is a narrow source-zone marker for real activated abilities whose source card is in its owner's waiting room. Keep support source-zone-aware in definitions, command validation, and UI entry points; do not broaden it into a generic DSL or trigger matcher surface.

`CardAbilitySourceZone.HAND` is the matching narrow marker for real activated abilities printed as usable only while the source card is in hand. Definitions, command validation, and hand-zone UI entry points should carry the source zone explicitly; the workflow still owns card-specific cost payment, post-cost target checks, and no-target no-op semantics.

Relay-enter draw/discard is a shared on-enter family when the operation is "if this member entered by relay from a named member, draw N then discard M". Keep the relay condition bound to the current pending ability's `relayReplacements` metadata, use `cardNameAliasIs` for the named replacement check, consume the pending ability as a no-op when the condition fails, and delegate the actual draw/discard step to the existing draw-then-discard workflow so hand discards continue to enqueue enter-waiting-room triggers.

`workflows/shared/relay-enter-lower-cost-unit.ts` is only a pure condition helper. It reads the current pending ability's `relayReplacements` event-snapshot costs, the source member's effective cost at resolution, and the replaced cards' structured unit aliases. Payment, modifiers, skip behavior, and pending continuation remain in each card workflow; this helper is not a relay DSL and must not become a runner gate.

`workflows/shared/low-cost-relay-play-hand-member.ts` owns the stable full-flow family proven by `PL!SP-PR-020` and `PL!-PR-015`. Keep the cards' ability identities and Excel effectText separate while sharing the relay snapshot comparison, optional hand selection, empty-slot selection, stale refresh, `playMemberFromZoneToEmptySlot`, ON_ENTER enqueue, and continuation order. The replaced member uses its effective-cost snapshot captured by the production relay action; the entered source uses effective cost at resolution. The hand threshold uses the card's printed cost through `costLte`, not the separate play-cost payment modifier pipeline. Player copy is fixed to “选择要登场的成员 / 登场 / 不登场” and “选择登场区域 / 登场”. Do not add card-number branches or relay gates to the runner.

Draw-then-discard may also carry a narrow `requiredSourceSlot` axis for real side-locked on-enter cards. Check the current authoritative source slot before drawing; when the side condition fails, consume the pending ability as a no-op and do not open the discard window.

`workflows/shared/on-enter-choose-draw-discard-or-wait-opponent-low-cost.ts` owns the stable same-text family proven by `PL!-PR-005`, `PL!-PR-006`, and `PL!-PR-008`: a mandatory two-option ON_ENTER window followed by either draw-one-discard-one or an immediate batch change of every matching opponent main-stage member to WAITING. The draw branch delegates `startDrawThenDiscardCardsWorkflow` / `finishDrawThenDiscardCardsWorkflow`; that core exposes only narrow optional `selectionLabel` / `confirmSelectionLabel` copy overrides, leaving all existing registered configs unchanged. The wait branch uses printed-cost selectors, `setMembersOrientation`, and the member-state trigger wrapper, records the resolve action before enqueue, and emits no event for already-WAITING matches. Do not merge this family into `opponent-wait-target.ts`, whose stable contract is a second single-target player-selection window, or into a general branch DSL. Runner ownership remains one import and one register call.

Discard-look-top-select-to-hand may combine an alias selector with `memberOnly` when the real text says "named group/unit member card". Keep the discard cost on `discardOneHandCardToWaitingRoomAndEnqueueTriggers`, then build the reveal selector as `typeIs(CardType.MEMBER)` plus the alias predicate so LIVE cards from the same group remain in the inspected remainder.

Opponent wait target is a shared family when the operation is "choose one opponent stage member and change it to WAITING". Keep selector differences, action step, step text, and selection label in config. The workflow may reuse stage-member orientation selection helpers and event-log delta helpers, but it must enqueue `ON_MEMBER_STATE_CHANGED` only after the orientation change and resolve action have been recorded. A queued LIVE_START no-target branch may opt into a narrow `confirmNoTargetWithRealtimeText` axis when the real card has no interaction after target absence; the appended text must describe the current target count and actual no-op result, and real target selection windows must not receive an extra confirm-only wrapper. Do not merge this family into activation-energy or other orientation-changing workflows unless their event timing, target side, and payload fields are identical.

Stage formation change is a shared family when the operation is "let the player move/swap current own main stage members, then commit the final stage atomically". Keep trigger timing, source zone, pre-draw, condition predicate, unit/group predicates such as "only 5yncri5e! stage members", and action step names in config. The workflow should expose `stageFormation` activeEffect state instead of enumerating `selectableOptions`, consume decline/skip without moving, and apply confirmed `moveHistory` through `rearrangeStageMembersByMoveHistoryAndEnqueueTriggers` so `RESOLVE_ABILITY` is recorded before all `ON_MEMBER_SLOT_MOVED` triggers are enqueued. Do not trust frontend `movedCardIds`: replay history from the current authoritative stage state, ignore same-slot moves, treat swaps as moving both members, and emit at most one moved event per member while preserving the full `moveHistory` in action payloads.

Conditional live modifier is a shared Live-start family when the operation is "open a confirm-only effect window, recompute a condition on confirm, then add/replace/clear Live modifiers". Keep the stable axes in config or local finish functions: counted zone, count threshold, requirement color, modifier target, add/replace/null behavior, start payload fields, and finish payload fields. Reuse activeEffect start glue for the window itself, but do not move card-specific condition checks or modifier strategy into the runtime helper.

Opponent wait target is a shared member-target family for "select one opponent stage member matching a printed selector and change it to WAITING". Stable axes are ability id, target selector, UI labels, start action label, and narrow own-stage gates proven by card text: minimum effective Heart total, minimum different named BiBi members, or minimum printed member cost. Do not add arbitrary predicates, a DSL, or effective-cost semantics. The target must use the stage orientation selection and member-state trigger wrapper; already WAITING or stale targets must not create a state-change event. For no-input LIVE_START no-op branches, the single pending confirmation must show real-time rule counts and result, while ordered resolution continues automatically.

On-move self Heart is a shared AUTO family when the operation is "this moved source member gains one fixed Heart color until Live end". Keep the stable axes to ability id, base card code, Heart color, and action payload labels. The workflow should consume the current `ON_MEMBER_SLOT_MOVED` pending, rely on definition-level `perTurnLimit`, write `SOURCE_MEMBER` Heart through `addHeartLiveModifierForMember`, and avoid filtering out movement caused by an opponent card effect. Do not merge BLADE or conditional movement rewards into this family.

On-move self BLADE is a shared AUTO family when the operation is "this moved source member gains fixed BLADE until Live end". Keep the stable axes to ability id, base card code, BLADE amount, and action step label. The workflow should consume the current `ON_MEMBER_SLOT_MOVED` pending, rely on definition-level `perTurnLimit`, write source-member BLADE through `addBladeLiveModifierForSourceMember`, and leave conditional movement observers or target selection in card-specific workflows.

Member-slot-moved observer glue is allowed only for exact card text that observes movement beyond the ordinary "the moved card's ON_MEMBER_SLOT_MOVED definition always queues" shape, such as requiring a specific `CARD_EFFECT` cause. Register those handlers through `runtime/member-slot-moved-observers.ts`; runner should only call the generic observer hook after the ordinary member-slot-moved path and any legacy observers. If a definition is only a classification/documentation surface for an observer-owned route, mark it `observerOnly` so the ordinary runner path cannot create unfiltered pending abilities.

For abilities whose printed once-per-turn limit is shared across multiple trigger routes, use the narrow definition queue guard `skipQueueWhenTurnLimitReached` instead of adding ability-id-specific checks in runner. The runner may skip queueing a definition with this flag when `canUseAbilityThisTurn` is already false, but the workflow must still recheck validity and consume stale pending abilities safely.

Resolved-ability observer glue is allowed only for exact card text that triggers after another ability has already recorded `RESOLVE_ABILITY`, such as `PL!-bp6-020`. Register those handlers through `runtime/resolved-ability-observers.ts`; runner should only call the generic observer hook before opening the next pending window. Keep each observer narrow: inspect the latest resolved action, validate the resolved definition category/source zone, source slot, source group, current LIVE card, and per-turn limit, then enqueue a card-specific pending ability. For exact energy-placement observers such as `PL!SP-bp5-004`, only trust an explicit non-empty `placedEnergyCardIds` payload and recheck that those cards are now in the controller's `energyZone`; do not treat paid/tapped energy payloads, energy-below moves, or empty placement arrays as placement triggers. Do not turn this into a broad trigger matcher or steps DSL.

Self position-change is a shared family when the operation is "optionally move this source member to a different member slot, swapping with an occupied target slot if needed". It covers proven on-enter examples through `GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID` and the `PL!SP-pb2-011` LIVE_START self-move ability id; keep the axes narrow to ability id / trigger timing / source zone. Finish must re-read the source slot, record `RESOLVE_ABILITY`, and use `moveMemberBetweenSlotsAndEnqueueTriggers` so downstream `ON_MEMBER_SLOT_MOVED` abilities can observe both normal moves and swaps.

Activated pay-energy self position-change is a shared family only for the proven pair `PL!SP-bp2-008` and `PL!SP-sd2-002`. Keep the stable axes to ability id, base card code, active energy cost count, and action payload labels. The workflow must pay `TAP_ACTIVE_ENERGY` and record `PAY_COST` before opening the mandatory movement activeEffect; finish must re-read the source stage slot, record the position-change `RESOLVE_ABILITY`, and only then enqueue `ON_MEMBER_SLOT_MOVED` through `moveMemberBetweenSlotsAndEnqueueTriggers`. Do not broaden this into a generic position-change DSL.

Activated wait-self discard-draw is a shared family when the stable operation is "source member ACTIVE -> WAITING, discard exactly one hand card to waiting room, then draw N cards". Keep the axes narrow to ability id, base card codes, and draw count. The source orientation cost must use member-state event enqueue, the hand discard must use the enter-waiting-room trigger wrapper, and no-hand / non-active source failures must happen before paying costs or consuming the turn-once limit.

Wait-self opponent-wait is a shared ON_ENTER / LIVE_START family proven by `PL!N-bp5-004` and the identical-text pair `PL!N-bp3-017` / `PL!N-bp3-023`. The source must still be the controller's ACTIVE main-stage member before it may become WAITING as an optional cost; after payment, the workflow rescans the opponent's main-stage targets and uses the configured selector (`memberPrintedBladeEquals(4)` or `typeIs(MEMBER) + costLte(4)`). Source and target changes both enqueue `ON_MEMBER_STATE_CHANGED`, and a no-target result after payment keeps the paid cost. Keep the family axes to ability ids, target selector, and player-facing target copy; do not expand it into an arbitrary cost/target DSL or merge it into the direct-target `opponent-wait-target` family.

Energy-below effects should first reuse the atomic helpers in `src/application/effects/energy-below.ts`: `stackEnergyFromEnergyZoneBelowMember` for automatic "put N energy from energy zone below this member" costs/effects, and `returnEnergyBelowMemberToEnergyDeck` / `returnEnergyBelowMemberToEnergyDeckForPlayer` for the leave-stage invariant. Do not promote a full shared workflow family until real cards prove stable axes for timing, optional payment, follow-up reward, and no-target behavior.

Original Heart color replacement uses `MEMBER_ORIGINAL_HEART_REPLACEMENT` as a Live modifier for "this member's printed original Heart becomes the chosen color". `getMemberEffectiveHeartIcons` applies that replacement to the printed Heart total before appending normal member Heart bonuses; it is not a PLAYER Heart write or a member "gain Heart" bonus.

Original Blade count replacement uses `MEMBER_ORIGINAL_BLADE_REPLACEMENT` as a Live modifier for "this member's printed original Blade count becomes N". `getMemberEffectiveBladeCount` applies the latest replacement as the original Blade count first, then appends normal member Blade bonuses; it is not equivalent to adding or subtracting a BLADE modifier, because printed Blade counts above the replacement value must also be overwritten.

Revealed-cheer selection is a shared family when the operation is "choose cards revealed by the current cheer and still in the processing zone, then move them or perform additional cheer". Keep selector differences, destination, min/max count, optional/skip behavior, additional-cheer count calculation, whether a successful move records a turn-once ability use, and payload field names in config. Reuse `effects/cheer-selection.ts` for current-cheer eligibility and `effects/cheer.ts` for additional cheer; do not reimplement resolution-zone movement, cheer context checks, or the non-recursive additional-cheer guard inside a workflow.

On-cheer no-BLADE-HEART gain-Heart is a narrow shared AUTO family proven by `PL!SP-bp2-015/020/021`. Keep the stable axes to ability id, Heart color, and action step. Resolve only the pending-linked own normal `CheerEvent`, require at least one actually revealed own card, and use `hasBladeHeart()` across every blade-heart entry, including ALL, SCORE, and DRAW. The condition reads `revealedCardIds` event facts even after cards leave `resolutionZone`; a valid normal cheer consumes turn1 even when a BLADE HEART makes the condition fail, while no event/zero own reveals/additional cheer/source departure does not. Write only a source-bound `SOURCE_MEMBER` Heart modifier and do not add activeEffect or confirm-only UI.

On-cheer same-group member triple gain-Hearts is a narrow shared AUTO family proven by `PL!N-PR-023` and `PL!S-PR-040`. Keep separate ability identities and definition text while sharing only the no-input resolver. Read the pending-linked own normal `CheerEvent.revealedCardIds` history, de-duplicate card ids, accept only own member cards with structured `getCardGroupIdentityKeys`, and require one canonical group bucket to contain at least three different members; do not group by unitName or replace event facts with the current movable revealed set. A valid source/event consumes turn1 even when the threshold fails; additional/opponent/missing events and stale sources do not. Write one `SOURCE_MEMBER` modifier containing pink and green Heart and continue through the unified scheduler without activeEffect.

Cheer reroll is a narrow shared family proven by `PL!S-bp2-004` and `PL!S-bp3-020`, and remains separate from revealed-cheer selection. Its finite configuration axes are ability id, source requirement (`STAGE_MEMBER` or own `LIVE_CARD`), condition kind (`NO_LIVE` or at-most-N Blade-Heart cards), the threshold, whether every historical revealed card must still be the exact movable set, and stable player-facing step text. The family reads the pending-linked normal `CheerEvent` fact, uses shared public display with `REVEALED_CHEER -> WAITING_ROOM`, records source-instance turn1 only after the complete move, rerolls with the original `totalBlade`, and explicitly enqueues the replacement `additional=false` event through the normal `ON_CHEER` path. Do not add arbitrary callbacks, a condition DSL, generic steps, different costs, selectable subsets, or continuation scripts. `replaceCurrentCheerCards=true` replaces only the acting player's current cheer IDs; default/false remains additive registration and opponent IDs remain unchanged.

Cheer-card Heart color replacement is a shared no-input LIVE_START family for effects that say cards revealed by your own cheer have specific Heart colors treated as another Heart color until LIVE end. Real samples are `PL!SP-bp4-023` and `PL!N-bp4-025`. Keep the stable axes to `abilityId`, definition-owned card coverage, `fromColors`, `toColor`, confirm/preview text, and action step label. The workflow owns manual confirm-only versus ordered-resolution behavior, source LIVE still being in the controller's liveZone, writing `CHEER_CARD_HEART_COLOR_REPLACEMENT`, `RESOLVE_ABILITY` payload, and `continuePendingCardEffects`. Do not fold in VIVID WORLD's LIVE_SUCCESS score check, Dazzling Game's member BLADE selection, or other LIVE_START modifier families.

Success-zone placement prohibitions are not workflow families by themselves. Keep pure "can this LIVE enter SUCCESS_ZONE" rules in `domain/rules/success-live-placement.ts`, and call them from the natural success Live selection, replacement candidates, exchange candidates, and manual move validation. If the same card also has a LIVE_SUCCESS reward, implement that reward as a normal workflow wrapper, as `PL!S-bp2-024` does with draw-then-discard.

Choose-player / bottom-one-waiting-LIVE / draw-one is a narrow shared family proven by `PL!S-bp3-007` and `PL!S-PR-041`. Its stable core is: the effect controller chooses self or opponent, selects exactly one LIVE from that player's waiting room, publishes that choice through the shared deadline confirmation, revalidates owner/zone/type/original-candidate membership after resume, moves the card to that player's main-deck bottom, then draws one for the effect controller only after a successful move. Keep the activated entry's main-phase/current-player/stage-source gates, `[E]` and special-energy payment, turn1 use, activatedUi, action/payload contract, and legacy persisted step IDs separate from the queued ON_ENTER entry's no-cost/no-limit pending consumption, orderedResolution, and unified continuation. Do not add arbitrary zone, destination, reward, or step DSL axes. `PL!N-bp3-010` is excluded because it selects up to two ordered members with no draw; `PL!S-bp2-008` is excluded because it only targets its controller's waiting room, allows zero or one LIVE, and has no draw.

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

### LIVE_SUCCESS availability gate

`runtime/live-success-ability-availability-gates.ts` 是只作用于入队前的窄 registry：按
`abilityId` 注册 predicate，未注册的能力默认允许。runner 只在 LIVE_SUCCESS 循环中调用通用
查询；gate 为 false 时不构造 pending，也不记录 `TRIGGER_ABILITY`。它不结算效果、不构造
pending、不推进队列，也不承载卡牌专属条件。当前真实样本是 `PL!S-bp2-008`：其单卡 workflow
用该 gate 判断自己 LEFT/CENTER/RIGHT 顶层成员是否均为不同名 Aqours，再决定授予的 pseudo
LIVE_SUCCESS ability 是否入队。

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

# conditional LIVE draw-one family

`workflows/shared/conditional-live-draw-one.ts` is the behavior-named family proven across `PL!N-bp4-003`, `PL!S-bp3-005`, `PL!-bp4-001`, and `PL!-bp4-023`. It owns the shared LIVE_START/LIVE_SUCCESS and STAGE_MEMBER/LIVE_CARD pending lifecycle, source-safe resolution, confirm-only/manual bridge, ordered continuation, real-time condition reread, and one-card draw through `drawCardsForPlayer`.

Its finite discriminated-union configuration has only the ability id, expected base card codes, source kind, condition type, exact action/no-op step labels, and condition-specific structured values needed for confirmation text. The proven conditions are LIVE score, event-inclusive cheer counts, stage effective-cost totals, and a specified remaining-HEART color with existing rebalance semantics; it is not a general condition callback or DSL.
# conditional-live-modifier 的成员登场次数配置

- `PL!N-bp3-005` 是该 family 的 player-level SCORE 样本：manual confirm-only 预览与最终 finish 均实时调用成员登场事件 query；modifier key 由 `kind + playerId + sourceCardId + abilityId` 区分，不绑定 `liveCardId`。
- replacement 后以旧值和新值的 delta 刷新 `liveResolution.playerScores`，保证 resolver 重入不重复累计、不同来源实例可以叠加。

# LIVE_START 自身待机后中央 μ's 获得 BLADE family

`workflows/shared/live-start-wait-self-center-muse-gain-blade.ts` 由第二个真实样本 `PL!-bp4-011` 触发晋升；原 `PL!-bp4-017` 单卡 workflow 与 focused test 已迁入行为命名 shared ownership。稳定参数轴仅为 `abilityId`、`bladeAmount` 与兼容 action step：两张卡都固定由来源自身从 ACTIVE 变 WAITING 作为可选费用，固定查询自己中央结构化 μ's 成员，并写目标成员 BLADE modifier。当前不泛化团体、区域、费用状态或 modifier 类型。

该 family 使用“发动 / 不发动”且不生成固定来源的 `selectableCardIds`；打开窗口与确认发动时都重查来源，支付走成员状态事件 wrapper，支付后才重读中央目标。来源自身位于中央时，变为 WAITING 后仍可成为目标；中央无合法目标时保留费用并正常继续 pending。

# conditional-live-modifier 的中央 μ's 有效 BLADE 分数配置

`PL!-bp4-022` 在 confirm-only 与最终结算时都读取当前中央结构化 μ's 成员，并通过 `collectLiveModifiers` + `getMemberEffectiveBladeCount` 使用印刷 BLADE、临时 modifier 与 replacement 后的有效值。满足 9 个阈值且来源 LIVE 仍合法时，用绑定来源 `liveCardId` 的 SCORE replacement 写 +2；`playerScores` 只按旧/新 modifier 差值刷新，重复结算不累计，条件失效会清理旧状态。玩家动态文案只展示中央身份、有效 BLADE、条件与实际 +2/+0，不展示来源区域门禁。

# ON_ENTER_STAGE AUTO 的换手事实过滤

`OnEnterStageTriggerFilter.enteredViaRelay` 只比较已发生的 `EnterStageEvent` 事实：`relayReplacements` 非空，或 legacy `replacedMemberCardId` 存在时视为换手。ON_ENTER_STAGE AUTO source 同时传递 `enteredFromZone`，并在入队前通用应用 definition `triggerFromZones`。未配置这两个轴的既有 AUTO 保持原行为；workflow 不应回查最近事件或根据槽位替换情况猜测换手。`PL!N-PR-025` 是首个组合 `triggerFromZones: [HAND]` 与 `enteredViaRelay: true` 的生产样本。

# Waiting-room ON_ENTER delegation

`activate-waiting-room-member-on-enter-ability.ts` 是窄 shared family，不是 ability DSL。它只委托显式审计并 opt-in 的已实现、queued、`ON_ENTER`/`PLAYED_MEMBER` definition；目标留在休息室，来源槽位为空，不创建真实登场事件，费用仍由原 workflow 支付。

该范围默认拒绝且并不覆盖所有历史/未来合法成员。后续新增费用4以下的虹ヶ咲或 Liella! 成员及新的已实现 ON_ENTER workflow 形状时，维护者应单独审计来源费用、槽位和 continuation，再决定是否 opt-in；普通 ON_ENTER workflow 无需感知本特殊机制。

# Activate-own-stage-member family

`workflows/shared/activate-own-stage-member.ts` 承担“从控制者三个主舞台槽中至多选择1名当前非 ACTIVE 成员并变为 ACTIVE”的稳定可选流程。配置只保留 abilityId、stepId，以及来源在结算时是否仍须位于己方舞台：`PL!-bp3-001` 的 LIVE_START 保留来源 gate，`PL!S-bp3-010/011` 的 ON_ENTER 入队后不要求来源仍在场。状态变化统一走成员状态事件 wrapper，并通过统一 continuation 返回检查时点。这里没有 callback、任意条件组合或 steps-lite，因此是行为命名的 shared workflow，不是通用状态变化 DSL。
