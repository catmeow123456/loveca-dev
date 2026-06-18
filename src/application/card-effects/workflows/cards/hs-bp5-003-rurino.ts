import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { moveMemberBetweenSlots } from '../../../effects/member-state.js';

export const HS_BP5_003_SELECT_POSITION_MEMBER_STEP_ID =
  'HS_BP5_003_SELECT_POSITION_CHANGE_MEMBER';
export const HS_BP5_003_SELECT_POSITION_SLOT_STEP_ID = 'HS_BP5_003_SELECT_POSITION_CHANGE_SLOT';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly memberSlotMovedEvents?: readonly MemberSlotMovedEvent[];
  }
) => GameState;

interface StageMemberLocation {
  readonly playerId: string;
  readonly cardId: string;
  readonly slot: SlotPosition;
}

export function registerHsBp5003RurinoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp5003RurinoLeaveStagePositionChange(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
    HS_BP5_003_SELECT_POSITION_MEMBER_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startHsBp5003RurinoPositionSlotSelection(game, input.selectedCardId)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
    HS_BP5_003_SELECT_POSITION_SLOT_STEP_ID,
    (game, input, context) =>
      finishHsBp5003RurinoPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startHsBp5003RurinoLeaveStagePositionChange(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (ability.metadata?.toZone !== ZoneType.WAITING_ROOM) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'LEAVE_STAGE_NOT_TO_WAITING_ROOM',
      continuePendingCardEffects
    );
  }

  const selectableCardIds = getStageMemberPositionChangeCandidates(game).map(
    (candidate) => candidate.cardId
  );
  if (selectableCardIds.length === 0) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_POSITION_CHANGE_TARGETS',
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID),
      stepId: HS_BP5_003_SELECT_POSITION_MEMBER_STEP_ID,
      stepText: '请选择要进行站位变换的成员。也可以选择不发动此效果。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要站位变换的成员',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_POSITION_CHANGE_MEMBER',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
    },
  });
}

function startHsBp5003RurinoPositionSlotSelection(
  game: GameState,
  selectedMemberCardId: string
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID ||
    effect.selectableCardIds?.includes(selectedMemberCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetLocation = findStageMemberLocation(game, selectedMemberCardId);
  if (!player || !targetLocation) {
    return game;
  }

  const selectableSlots = MEMBER_SLOT_ORDER.filter((slot) => slot !== targetLocation.slot);
  if (selectableSlots.length === 0) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: HS_BP5_003_SELECT_POSITION_SLOT_STEP_ID,
        stepText: '请选择该成员要移动到的成员区。',
        selectableCardIds: [],
        selectableCardVisibility: 'PUBLIC',
        selectableSlots,
        selectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedMemberCardId,
          selectedMemberPlayerId: targetLocation.playerId,
          selectedMemberSourceSlot: targetLocation.slot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_POSITION_CHANGE_MEMBER',
      selectedMemberCardId,
      targetPlayerId: targetLocation.playerId,
      fromSlot: targetLocation.slot,
      selectableSlots,
    }
  );
}

function finishHsBp5003RurinoPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID ||
    !selectedSlot ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedMemberCardId =
    typeof effect.metadata?.selectedMemberCardId === 'string'
      ? effect.metadata.selectedMemberCardId
      : null;
  const selectedMemberPlayerId =
    typeof effect.metadata?.selectedMemberPlayerId === 'string'
      ? effect.metadata.selectedMemberPlayerId
      : null;
  if (!player || !selectedMemberCardId || !selectedMemberPlayerId) {
    return game;
  }

  const currentLocation = findStageMemberLocation(game, selectedMemberCardId);
  if (
    !currentLocation ||
    currentLocation.playerId !== selectedMemberPlayerId ||
    currentLocation.slot === selectedSlot
  ) {
    return game;
  }

  const moveResult = moveMemberBetweenSlots(
    game,
    selectedMemberPlayerId,
    selectedMemberCardId,
    selectedSlot
  );
  if (!moveResult) {
    return game;
  }

  const state = {
    ...moveResult.gameState,
    activeEffect: null,
  };
  const stateWithMemberMoveTriggers = enqueueTriggeredCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'POSITION_CHANGE',
      targetPlayerId: selectedMemberPlayerId,
      targetCardId: selectedMemberCardId,
      fromSlot: moveResult.fromSlot,
      toSlot: moveResult.toSlot,
      swappedCardId: moveResult.swappedCardId,
    }),
    [TriggerCondition.ON_MEMBER_SLOT_MOVED],
    {
      memberSlotMovedEvents: getNewMemberSlotMovedEvents(game, moveResult.gameState),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberMoveTriggers,
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function getStageMemberLocations(game: GameState): readonly StageMemberLocation[] {
  return game.players.flatMap((player) =>
    MEMBER_SLOT_ORDER.flatMap((slot) => {
      const cardId = player.memberSlots.slots[slot];
      return cardId ? [{ playerId: player.id, cardId, slot }] : [];
    })
  );
}

function findStageMemberLocation(game: GameState, cardId: string): StageMemberLocation | null {
  return getStageMemberLocations(game).find((location) => location.cardId === cardId) ?? null;
}

function getStageMemberPositionChangeCandidates(game: GameState): readonly StageMemberLocation[] {
  return getStageMemberLocations(game).filter((location) =>
    MEMBER_SLOT_ORDER.some((slot) => slot !== location.slot)
  );
}

function getNewMemberSlotMovedEvents(
  before: GameState,
  after: GameState
): readonly MemberSlotMovedEvent[] {
  return after.eventLog
    .slice(before.eventLog.length)
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberSlotMovedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
}
