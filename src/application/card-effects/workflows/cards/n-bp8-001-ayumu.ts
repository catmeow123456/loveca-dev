import { isEnergyCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  moveSelectedEnergyBelowMemberToEnergyZoneByCardEffect,
  type EnqueueTriggeredCardEffectsForEnergyBelowPlacement,
} from '../../../effects/energy-below.js';
import {
  EnergySelectionRequiredError,
  getEnergySelectionCandidates,
  resolveEnergySelectionForOperation,
  withEnergySelectionResolutions,
} from '../../../effects/energy-selection.js';
import {
  N_BP8_001_ON_ENTER_STACK_ENERGY_SELF_AND_OTHER_NIJIGASAKI_ABILITY_ID as ENTER,
  N_BP8_001_LIVE_SUCCESS_RETURN_ONE_ENERGY_BELOW_DRAW_DISCARD_ABILITY_ID as SUCCESS,
} from '../../ability-ids.js';
import {
  getPendingAbilitySourceLifecycleId,
  getStageMemberLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers } from '../../runtime/energy-below-placement-triggers.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { getAbilityTemplateCardCode } from '../../runtime/on-enter-ability-invocation.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const OTHER = 'N_BP8_001_SELECT_OTHER_NIJIGASAKI';
const ALLOCATION = 'N_BP8_001_CHOOSE_ENERGY_ALLOCATION';
const BOTH = 'SELF_AND_OTHER';
const SELF_ONLY = 'SELF_ONLY';
const OTHER_ONLY = 'OTHER_ONLY';
const PLACEMENT_ENERGY = 'N_BP8_001_SELECT_PLACEMENT_ENERGY';
const MEMBER = 'N_BP8_001_SELECT_MEMBER_WITH_ENERGY_BELOW';
const ENERGY = 'N_BP8_001_SELECT_ONE_ENERGY_BELOW';
const DISCARD = 'N_BP8_001_DISCARD_AFTER_RETURN_ENERGY';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
type Enqueue = EnqueueTriggeredCardEffectsForEnergyBelowPlacement &
  EnqueueTriggeredCardEffectsForEnterWaitingRoom;
interface TargetSnapshot {
  readonly lifecycleId: string;
  readonly energyCardIds: readonly string[];
}
interface Placement {
  readonly memberCardId: string;
  readonly lifecycleId: string;
  readonly energyCardId?: string;
}

export function registerNBp8001AyumuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(ENTER, (game, ability, options, context) =>
    startEnter(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ENTER,
    ALLOCATION,
    (game, input, context) =>
      chooseAllocation(game, input.selectedOptionId ?? null, context.continuePendingCardEffects),
    queryOptionSelection
  );
  registerActiveEffectStepHandler(
    ENTER,
    OTHER,
    (game, input, context) =>
      chooseOther(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ENTER,
    PLACEMENT_ENERGY,
    (game, input, context) =>
      choosePlacementEnergy(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerPendingAbilityStarterHandler(SUCCESS, (game, ability, options, context) =>
    startReturn(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    SUCCESS,
    MEMBER,
    (game, input, context) =>
      chooseReturnMember(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    SUCCESS,
    ENERGY,
    (game, input, context) =>
      returnOneEnergy(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      ),
    queryCardSelection
  );
  registerActiveEffectStepHandler(SUCCESS, DISCARD, (game, input, context) =>
    finishDrawThenDiscardCardsWorkflow(
      game,
      input.selectedCardId ?? null,
      input.selectedCardIds,
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
}

function startEnter(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  next: Continue
): GameState {
  if (!getPlayerById(game, ability.controllerId)) return game;
  const effect: ActiveEffectState = {
    id: ability.id,
    abilityId: ENTER,
    sourceCardId: ability.sourceCardId,
    sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
    controllerId: ability.controllerId,
    onEnterInvocation: ability.onEnterInvocation,
    effectText: getAbilityEffectText(ENTER),
    stepId: ALLOCATION,
    stepText: '请选择能量的放置方式。此成员和其他的1名『虹咲』成员各可放置至多1张能量。',
    awaitingPlayerId: ability.controllerId,
    confirmSelectionLabel: '按此方式放置能量',
    canSkipSelection: true,
    skipSelectionLabel: '不放置',
    metadata: { orderedResolution: options.orderedResolution === true },
  };
  const otherIds = otherNijigasakiMembers(game, effect);
  const energyCount = availableEnergy(game, effect).length;
  const selfAvailable = selfIsCurrent(game, effect);
  const selectableOptions = [
    ...(selfAvailable && otherIds.length > 0 && energyCount >= 2
      ? [{ id: BOTH, label: '此成员和另一名成员各放置1张' }]
      : []),
    ...(selfAvailable && energyCount >= 1
      ? [{ id: SELF_ONLY, label: '只放置于此成员下方1张' }]
      : []),
    ...(otherIds.length > 0 && energyCount >= 1
      ? [{ id: OTHER_ONLY, label: '只放置于另一名成员下方1张' }]
      : []),
  ];
  const started = startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      ...effect,
      selectableOptions,
      metadata: {
        ...effect.metadata,
        targetLifecycles: Object.fromEntries(
          otherIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
        ),
      },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_STACK_ENERGY' },
  });
  if (!cardCodeMatchesBase(getAbilityTemplateCardCode(game, ability), 'PL!N-bp8-001'))
    return finish(started, effect, next, 'INVALID_ABILITY_SOURCE');
  return selectableOptions.length > 0
    ? started
    : finish(started, effect, next, 'NO_ENERGY_PLACEMENT');
}

function chooseAllocation(game: GameState, option: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ENTER || effect.stepId !== ALLOCATION) return game;
  if (option === null) return finish(game, effect, next, 'DECLINE_STACK_ENERGY');
  if (!effect.selectableOptions?.some((item) => item.id === option)) return game;
  const placements =
    option !== OTHER_ONLY && selfIsCurrent(game, effect) ? [selfPlacement(effect)] : [];
  if (option === SELF_ONLY) return collectPlacementEnergy(game, effect, placements, next);
  const lifecycles = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  const ids = otherNijigasakiMembers(game, effect).filter(
    (id) => lifecycles?.[id] === getStageMemberLifecycleId(game, id)
  );
  if (ids.length <= 1) {
    if (ids[0]) placements.push({ memberCardId: ids[0], lifecycleId: lifecycles![ids[0]]! });
    return collectPlacementEnergy(game, effect, placements, next);
  }
  return {
    ...game,
    activeEffect: {
      ...effectIdentity(effect),
      stepId: OTHER,
      stepText: '请选择自己舞台上其他的1名『虹咲』成员，按所选方式放置能量。',
      selectableCardIds: ids,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要放置能量的其他『虹咲』成员',
      confirmSelectionLabel: '放置于成员下方',
      canSkipSelection: false,
      metadata: { ...effect.metadata, placements },
    },
  };
}

function chooseOther(game: GameState, id: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ENTER || effect.stepId !== OTHER || !id) return game;
  const lifecycles = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  if (!lifecycles || !effect.selectableCardIds?.includes(id)) return game;
  const placements = effect.metadata?.placements as readonly Placement[] | undefined;
  const currentIds = otherNijigasakiMembers(game, effect).filter(
    (candidate) =>
      effect.selectableCardIds?.includes(candidate) &&
      lifecycles?.[candidate] === getStageMemberLifecycleId(game, candidate)
  );
  if (!currentIds.includes(id)) {
    if (currentIds.length === 0)
      return collectPlacementEnergy(game, effect, placements ?? [], next);
    return { ...game, activeEffect: { ...effect, selectableCardIds: currentIds } };
  }
  return collectPlacementEnergy(
    game,
    effect,
    [...(placements ?? []), { memberCardId: id, lifecycleId: lifecycles[id]! }],
    next
  );
}

/** Collect per-target selections first. No move/event is committed before all are valid. */
function collectPlacementEnergy(
  game: GameState,
  effect: ActiveEffectState,
  requested: readonly Placement[],
  next: Continue
): GameState {
  const placements = requested.filter((placement) => placementIsCurrent(game, effect, placement));
  const reserved = placements.flatMap((placement) =>
    placement.energyCardId ? [placement.energyCardId] : []
  );
  const currentEnergy = availableEnergy(game, effect);
  if (
    new Set(reserved).size !== reserved.length ||
    reserved.some((id) => !currentEnergy.includes(id))
  )
    return finish(game, effect, next, 'SELECTED_ENERGY_UNAVAILABLE');
  if (placements.length > currentEnergy.length)
    return finish(game, effect, next, 'INSUFFICIENT_ENERGY_TO_STACK');
  const collected: Placement[] = [...placements];
  for (let index = 0; index < collected.length; index += 1) {
    const placement = collected[index]!;
    if (placement.energyCardId) continue;
    const selectedIds = collected.flatMap((item) => (item.energyCardId ? [item.energyCardId] : []));
    // A temporary view supplies the same shared candidate order and special-energy rule,
    // while previously reserved cards remain in the authoritative energy zone until commit.
    const selectionGame = updatePlayer(game, effect.controllerId, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: currentEnergy.filter((id) => !selectedIds.includes(id)),
      },
    }));
    try {
      const selection = resolveEnergySelectionForOperation(
        selectionGame,
        effect.controllerId,
        'STACK_BELOW_MEMBER',
        1
      );
      if (!selection) return finish(game, effect, next, 'INSUFFICIENT_ENERGY_TO_STACK');
      collected[index] = { ...placement, energyCardId: selection.selectedEnergyCardIds[0]! };
    } catch (error) {
      if (!(error instanceof EnergySelectionRequiredError)) throw error;
      return {
        ...game,
        activeEffect: {
          ...effectIdentity(effect),
          stepId: PLACEMENT_ENERGY,
          stepText: `请选择要放置于${placement.memberCardId === effect.sourceCardId ? '此成员' : '所选其他成员'}「${memberName(game, placement.memberCardId)}」下方的1张能量。全部选择完成后放置能量。`,
          selectableCardIds: error.candidateEnergyCardIds,
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'SINGLE',
          selectionLabel: `选择放置于「${memberName(game, placement.memberCardId)}」下方的能量`,
          confirmSelectionLabel: '放置于成员下方',
          canSkipSelection: false,
          metadata: { ...effect.metadata, placements: collected, placementIndex: index },
        },
      };
    }
  }
  return commitPlacements(game, effect, collected, next);
}

function choosePlacementEnergy(game: GameState, id: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ENTER ||
    effect.stepId !== PLACEMENT_ENERGY ||
    !id ||
    !effect.selectableCardIds?.includes(id)
  )
    return game;
  const placements = effect.metadata?.placements as readonly Placement[] | undefined;
  const index = effect.metadata?.placementIndex;
  if (!placements || typeof index !== 'number' || !placements[index]) return game;
  const selected = placements[index]!;
  // The chosen energy belongs to this exact destination. If that destination left,
  // discard its reservation rather than applying it to the next member.
  if (!placementIsCurrent(game, effect, selected))
    return collectPlacementEnergy(
      game,
      effect,
      placements.filter((_, i) => i !== index),
      next
    );
  if (
    !effect.selectableCardIds?.some((candidate) =>
      availableEnergy(game, effect).includes(candidate)
    )
  )
    return finish(game, effect, next, 'SELECTED_ENERGY_UNAVAILABLE');
  if (
    !availableEnergy(game, effect).includes(id) ||
    placements.some((placement, i) => i !== index && placement.energyCardId === id)
  )
    return game;
  return collectPlacementEnergy(
    game,
    effect,
    placements.map((placement, i) =>
      i === index ? { ...placement, energyCardId: id } : placement
    ),
    next
  );
}

function commitPlacements(
  game: GameState,
  effect: ActiveEffectState,
  placements: readonly Placement[],
  next: Continue
): GameState {
  const current = placements.filter((placement) => placementIsCurrent(game, effect, placement));
  const ids = current.map((placement) => placement.energyCardId);
  if (
    ids.some((id) => !id || !availableEnergy(game, effect).includes(id)) ||
    new Set(ids).size !== ids.length
  )
    return game;
  let state = game;
  const completed: { memberCardId: string; energyCardIds: readonly string[] }[] = [];
  // The two real event-safe moves form one local transaction. Any failure returns
  // the original authority state; newly enqueued abilities never interrupt it.
  const moved = withEnergySelectionResolutions(
    current.map((placement) => ({
      playerId: effect.controllerId,
      operation: 'STACK_BELOW_MEMBER' as const,
      requiredCount: 1,
      selectedEnergyCardIds: [placement.energyCardId!],
    })),
    () => {
      for (const placement of current) {
        if (!placementIsCurrent(state, effect, placement)) return false;
        const slot = currentOwnMember(state, effect.controllerId, placement.memberCardId)!;
        const result = stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
          state,
          effect.controllerId,
          slot,
          1,
          cause(effect)
        );
        if (!result || result.stackedEnergyCardIds[0] !== placement.energyCardId) return false;
        state = result.gameState;
        completed.push({
          memberCardId: placement.memberCardId,
          energyCardIds: result.stackedEnergyCardIds,
        });
      }
      return true;
    }
  );
  return moved
    ? finish(state, effect, next, 'STACK_ENERGY_BELOW_MEMBERS', { placements: completed })
    : game;
}

function selfIsCurrent(game: GameState, effect: ActiveEffectState): boolean {
  return (
    currentOwnMember(game, effect.controllerId, effect.sourceCardId) !== null &&
    isCurrentStageMemberAbilitySource(game, effect)
  );
}
function selfPlacement(effect: ActiveEffectState): Placement {
  return { memberCardId: effect.sourceCardId, lifecycleId: effect.sourceLifecycleId! };
}
function placementIsCurrent(
  game: GameState,
  effect: ActiveEffectState,
  placement: Placement
): boolean {
  return (
    currentOwnMember(game, effect.controllerId, placement.memberCardId) !== null &&
    placement.lifecycleId === getStageMemberLifecycleId(game, placement.memberCardId) &&
    (placement.memberCardId === effect.sourceCardId ||
      otherNijigasakiMembers(game, effect).includes(placement.memberCardId))
  );
}
function availableEnergy(game: GameState, effect: ActiveEffectState): readonly string[] {
  return getEnergySelectionCandidates(game, effect.controllerId, 'STACK_BELOW_MEMBER').filter(
    (id) => {
      const card = getCardById(game, id);
      return card?.ownerId === effect.controllerId && isEnergyCardData(card.data);
    }
  );
}
function memberName(game: GameState, id: string): string {
  return getCardById(game, id)?.data.name ?? '成员';
}

function startReturn(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  next: Continue
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const snapshots: Record<string, TargetSnapshot> = {};
  for (const slot of SLOTS) {
    const id = player.memberSlots.slots[slot];
    if (!id || !currentOwnMember(game, player.id, id)) continue;
    const energyCardIds = (player.memberSlots.energyBelow[slot] ?? []).filter((energyId) => {
      const card = getCardById(game, energyId);
      return card?.ownerId === player.id && isEnergyCardData(card.data);
    });
    if (energyCardIds.length > 0)
      snapshots[id] = { lifecycleId: getStageMemberLifecycleId(game, id), energyCardIds };
  }
  const ids = Object.keys(snapshots);
  if (ids.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      stepText: '没有可选择的目标。确认后结算此效果。',
    });
    if (confirmation) return confirmation;
    return next(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: SUCCESS,
          sourceCardId: ability.sourceCardId,
          step: 'NO_ENERGY_BELOW_TARGET',
        }
      ),
      options.orderedResolution === true
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: SUCCESS,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      effectText: getAbilityEffectText(SUCCESS),
      stepId: MEMBER,
      stepText:
        '可以选择自己舞台上1名下方有能量的成员，将其下方1张能量以待机状态放置于能量区，然后抽1张卡并将1张手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableCardIds: ids,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要取出下方1张能量的成员',
      confirmSelectionLabel: '选择下方能量',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        targetSnapshots: snapshots,
      },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_RETURN_ONE_ENERGY_BELOW' },
  });
}

function chooseReturnMember(game: GameState, id: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== SUCCESS || effect.stepId !== MEMBER) return game;
  if (id === null) return finish(game, effect, next, 'DECLINE_RETURN_ENERGY');
  if (!effect.selectableCardIds?.includes(id)) return game;
  const snapshot = (
    effect.metadata?.targetSnapshots as Readonly<Record<string, TargetSnapshot>> | undefined
  )?.[id];
  const slot = currentOwnMember(game, effect.controllerId, id);
  if (!snapshot || slot === null || snapshot.lifecycleId !== getStageMemberLifecycleId(game, id))
    return finish(game, effect, next, 'TARGET_UNAVAILABLE');
  const below = getPlayerById(game, effect.controllerId)!.memberSlots.energyBelow[slot] ?? [];
  const ids = snapshot.energyCardIds.filter((energyId) => below.includes(energyId));
  if (ids.length === 0) return finish(game, effect, next, 'TARGET_UNAVAILABLE');
  return {
    ...game,
    activeEffect: {
      ...effectIdentity(effect),
      stepId: ENERGY,
      stepText:
        '请选择此成员下方1张能量，以待机状态放置于能量区，然后抽1张卡并将1张手牌放置入休息室。',
      selectableCardIds: ids,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要放置于能量区的1张能量',
      confirmSelectionLabel: '放置于能量区',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        ...effect.metadata,
        targetMemberCardId: id,
        targetLifecycleId: snapshot.lifecycleId,
      },
    },
  };
}

function returnOneEnergy(
  game: GameState,
  id: string | null,
  enqueue: Enqueue,
  next: Continue
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== SUCCESS || effect.stepId !== ENERGY) return game;
  if (id === null) return finish(game, effect, next, 'DECLINE_RETURN_ENERGY');
  if (!effect.selectableCardIds?.includes(id)) return game;
  const memberId = effect.metadata?.targetMemberCardId;
  if (
    typeof memberId !== 'string' ||
    effect.metadata?.targetLifecycleId !== getStageMemberLifecycleId(game, memberId)
  )
    return finish(game, effect, next, 'TARGET_UNAVAILABLE');
  const movement = moveSelectedEnergyBelowMemberToEnergyZoneByCardEffect(game, {
    playerId: effect.controllerId,
    targetMemberCardId: memberId,
    selectedEnergyCardIds: [id],
    cause: cause(effect),
    enqueueTriggeredCardEffects: enqueue,
  });
  if (!movement) return finish(game, effect, next, 'TARGET_UNAVAILABLE');
  const state = addAction(movement.gameState, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: SUCCESS,
    sourceCardId: effect.sourceCardId,
    step: 'RETURN_ONE_ENERGY_BELOW',
    targetMemberCardId: memberId,
    movedEnergyCardIds: movement.movedEnergyCardIds,
    energyPlacedEventId: movement.energyPlacedEvent.eventId,
  });
  return startDrawThenDiscardCardsWorkflow(state, {
    ability: effect,
    effectText: effect.effectText,
    drawCount: 1,
    discardCount: 1,
    stepId: DISCARD,
    orderedResolution: effect.metadata?.orderedResolution === true,
    continuePendingCardEffects: next,
    confirmSelectionLabel: '放置入休息室',
  });
}

function currentOwnMember(game: GameState, playerId: string, id: string): SlotPosition | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, id);
  return player && card?.ownerId === player.id && isMemberCardData(card.data)
    ? findMemberSlot(player, id)
    : null;
}

function otherNijigasakiMembers(game: GameState, effect: ActiveEffectState): readonly string[] {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return [];
  return SLOTS.flatMap((slot) => {
    const id = player.memberSlots.slots[slot];
    const card = id ? getCardById(game, id) : null;
    return id &&
      id !== effect.sourceCardId &&
      card &&
      currentOwnMember(game, player.id, id) !== null &&
      groupAliasIs('虹ヶ咲')(card)
      ? [id]
      : [];
  });
}

function cause(effect: ActiveEffectState) {
  return {
    kind: 'CARD_EFFECT' as const,
    playerId: effect.controllerId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    pendingAbilityId: effect.id,
  };
}

function effectIdentity(effect: ActiveEffectState): ActiveEffectState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    onEnterInvocation: effect.onEnterInvocation,
    controllerId: effect.controllerId,
    effectText: effect.effectText,
    stepId: effect.stepId,
    stepText: effect.stepText,
    awaitingPlayerId: effect.awaitingPlayerId,
  };
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
