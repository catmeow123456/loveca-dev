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
| R-5 | partial | special card workflow 迁出。 | `HS_BP1_002`、`HS_BP5_001` activated、`HS_PB1_004`、`BP5_003`、`YOSHIKO` 已迁出；瑠璃乃、錯覚CROSSROADS、东条希等复杂特殊卡仍在 runner。 |
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
- `workflows/cards/hs-bp5-008-izumi.ts`
- `workflows/cards/hs-pb1-009-kaho.ts`
- `workflows/cards/hs-sd1-001-kaho.ts`
- `workflows/cards/hs-sd1-006-hime.ts`
- `workflows/cards/pr-017-nico.ts`
- `workflows/cards/hs-bp1-002-sayaka.ts`
- `workflows/cards/hs-bp5-001-kaho.ts`
- `workflows/cards/hs-pb1-004-ginko.ts`
- `workflows/cards/bp5-003-kotori.ts`
- `workflows/cards/pl-bp3-014-rin.ts`
- `workflows/cards/sp-bp4-008-shiki.ts`
- `workflows/cards/yoshiko-play-low-cost-members.ts`

Recent helper modules added outside `actions.ts`:

- `runtime/workflow-helpers.ts`: ability text lookup, ability-use action glue, and PAY_COST action-log glue.
- `runtime/active-effect.ts`: shared activeEffect start glue, skip finish helper, and confirm-only pending bridge for activeEffect workflows.
- `runtime/source-member.ts`: source member slot lookup helper.
- `runtime/events.ts`: event-log delta queries for newly entered stage members and newly changed member orientation events.
- `runtime/grouped-selection.ts`: validates per-group min/max card selections for grouped recovery.

Runner line count after R-4Q-b SHIKI single-card workflow migration is about 5667 lines, down from about 5944 after R-4Q-a. The runner is still registry-first with fallback old branches; it is not complete.

`PR_017` 已迁到单卡 workflow wrapper，仍没有并入纯 self-sacrifice recovery family。`HS_SD1_001` 与 `SHIKI` 已迁到单卡 workflow wrapper。Remaining near-term R-4/R-5 candidates include activation-energy helper cleanup / card workflow wrappers 与若干复杂单卡；暂不强行 family 化 `CHISATO`、`EMMA`。

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

Current follow-up candidates:

- activation-energy helper cleanup for `CHISATO` and `EMMA`; `SHIKI` was later migrated in R-4Q-b as a card workflow wrapper;
- complex single-card workflows such as `HS_BP5_003`, `BP6_024`, `BP5_007`, and `MAKI`, handled as card workflows unless a real family emerges.

## R-4Q-b SHIKI Workflow Outcome 2026-06-18

R-4Q-b migrated the two `SHIKI` effects into `src/application/card-effects/workflows/cards/sp-bp4-008-shiki.ts`.

Covered effects:

- `SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID` / `SHIKI_RIGHT_ACTIVATE_ENERGY`: right-side on-enter confirmation activates up to two waiting energy cards.
- `SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID` / `SHIKI_LIVE_START_POSITION_CHANGE`: Live-start optional position change moves SHIKI to another member slot or skips.

The workflow reuses `getAbilityEffectText`, `startPendingActiveEffect`, and `activateWaitingEnergyCardsForPlayer`. It passes an up-to-two waiting-energy count so 0, 1, or 2 waiting energy cards all resolve. The position-change branch remains card-specific, and `ON_MEMBER_SLOT_MOVED` enqueue still happens after the move and `POSITION_CHANGE` action through the injected runner lifecycle hook.

Current activation-energy candidates remain:

- `CHISATO` and `EMMA` as separate card workflow wrappers unless another stable shared axis appears.

## R-4Q-a HS_SD1_001 Relay-Replaced Energy Outcome 2026-06-18

R-4Q-a migrated `HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID` into `src/application/card-effects/workflows/cards/hs-sd1-001-kaho.ts`.

The runner still owns the `ON_LEAVE_STAGE` enqueue lifecycle and high-cost Hasunosora replacement prefilter, but the pending starter now lives in the workflow. The workflow rechecks the replacement condition at resolve time, preserves `CONDITION_NOT_MET` and `ACTIVATE_TWO_ENERGY_AFTER_RELAY` payload fields, and uses `activateWaitingEnergyCardsForPlayer` with an up-to-two waiting-energy count so 0, 1, or 2 waiting energy cards all resolve.

`runtime/active-effect.ts` now also provides `startConfirmOnlyPendingAbilityEffect` and `finishConfirmOnlyPendingAbilityEffect`. This bridge is for manual ordered pending selection: it installs a confirm-only `activeEffect` without removing the pending ability, then resumes the starter through a callback with `skipManualConfirmation`. It is distinct from `startConfirmOnlyActiveEffect`, which removes pending and writes a start action.

Current activation-energy candidates after R-4Q-b:

- `CHISATO` and `EMMA` as separate card workflow wrappers unless another stable shared axis appears.

## R-4P Revealed-Cheer Selection Outcome 2026-06-18

R-4P migrated the "choose from this cheer's revealed cards" family into `src/application/card-effects/workflows/shared/revealed-cheer-selection.ts`. The runner now only registers the workflow handlers and no longer owns the start / confirm branches for these effects.

Covered effects:

- `HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID` / `HS_BP6_001_SELECT_REVEALED_CHEER_TO_TOP`: choose one card revealed by the current cheer and still in the processing zone, then put it on top of the main deck.
- `HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID` / `HS_CL1_009_SELECT_REVEALED_CHEER_MEMBER_TO_HAND`: choose one eligible revealed MEMBER from the current cheer and add it to hand.
- `HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID` / `HS_BP6_027_SELECT_REVEALED_CHEER_TO_WAITING_ROOM`: choose up to three eligible revealed cheer cards, move them to the waiting room, then perform the same count of additional cheer with the existing non-recursive additional-cheer guard.

The shared workflow reuses `effects/cheer-selection.ts` for selecting cards that were revealed by the current cheer and are still in the processing zone, and `effects/cheer.ts` for additional cheer. It preserves old skip/no-target payload fields and does not change cheer context consumption, processing-zone cleanup, event-log timing, or pending continuation.

Current candidates after R-4Q-b:

- activation-energy helper cleanup / card workflow wrappers for `CHISATO` and `EMMA`;
- complex single-card workflows such as `HS_BP5_003`, `BP6_024`, `BP5_007`, and `MAKI`, handled as card workflows unless a real family emerges;
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
- Activation energy helper cleanup: R-4Q-a migrated `HS_SD1_001` into a single-card workflow, and R-4Q-b migrated `SHIKI` into a card workflow wrapper. `CHISATO` and `EMMA` still activate waiting energy/member orientations, but targets and event context differ. Keep as helper cleanup unless two or more step shapes become identical.

## R-5 Special Workflow Candidates

These effects may remain card-specific, but should leave runner:

- `PL!HS-bp5-003` 费用 2「大泽瑠璃乃」：LIVE 开始弃手后同团成员获得桃 Heart；离场站位变换。
- `PL!-bp6-024-L` 分数 3「錯覚CROSSROADS」：成功区放置替代。
- `PL!-bp5-007` 费用 13「东条希」：换手登场后双方弃到 3 并各抽 3。

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
