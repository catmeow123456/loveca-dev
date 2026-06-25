import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import type {
  EnterWaitingRoomEvent,
  MemberSlotMovedEvent,
} from '../../../../domain/events/game-events.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import {
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import {
  cardBelongsToGroup,
  getKnownCardGroupIdentityName,
} from '../../../../shared/utils/card-identity.js';
import { toPlayerLocalSlotForControllerPerspective } from '../../../../shared/utils/slot-perspective.js';
import {
  HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../runtime/member-slot-moved-triggers.js';

export const HS_BP5_003_SELECT_POSITION_MEMBER_STEP_ID = 'HS_BP5_003_SELECT_POSITION_CHANGE_MEMBER';
export const HS_BP5_003_SELECT_POSITION_SLOT_STEP_ID = 'HS_BP5_003_SELECT_POSITION_CHANGE_SLOT';
export const HS_BP5_003_SELECT_DISCARD_STEP_ID = 'HS_BP5_003_SELECT_DISCARD_FOR_MEMBER_HEART';
export const HS_BP5_003_SELECT_HEART_TARGET_STEP_ID =
  'HS_BP5_003_SELECT_SAME_GROUP_MEMBER_HEART_TARGET';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
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

  registerPendingAbilityStarterHandler(
    HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp5003RurinoLiveStartDiscard(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
    HS_BP5_003_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startHsBp5003RurinoSameGroupMemberSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
    HS_BP5_003_SELECT_HEART_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsBp5003RurinoTargetMemberHeart(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
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

  const currentControllerPerspectiveSlot = toPlayerLocalSlotForControllerPerspective(
    targetLocation.slot,
    targetLocation.playerId,
    player.id
  );
  const selectableSlots = MEMBER_SLOT_ORDER.filter(
    (slot) => slot !== currentControllerPerspectiveSlot
  );
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
          selectedMemberSourceControllerPerspectiveSlot: currentControllerPerspectiveSlot,
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
      fromControllerPerspectiveSlot: currentControllerPerspectiveSlot,
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
  const targetLocalSlot = toPlayerLocalSlotForControllerPerspective(
    selectedSlot,
    player.id,
    selectedMemberPlayerId
  );
  if (
    !currentLocation ||
    currentLocation.playerId !== selectedMemberPlayerId ||
    currentLocation.slot === targetLocalSlot
  ) {
    return game;
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    selectedMemberPlayerId,
    selectedMemberCardId,
    targetLocalSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'POSITION_CHANGE',
            targetPlayerId: selectedMemberPlayerId,
            targetCardId: selectedMemberCardId,
            fromSlot: result.fromSlot,
            controllerPerspectiveSlot: selectedSlot,
            targetLocalSlot,
            toSlot: result.toSlot,
            swappedCardId: result.swappedCardId,
          }
        ),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function startHsBp5003RurinoLiveStartDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.hand.cardIds.length === 0) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_HAND_TO_DISCARD',
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(
        HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID
      ),
      stepId: HS_BP5_003_SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function startHsBp5003RurinoSameGroupMemberSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const discardCard = getCardById(game, discardCardId);
  if (!player || !discardCard || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const discardedGroupName = getKnownCardGroupName(discardCard);
  const selectableCardIds =
    discardedGroupName !== null
      ? getStageMemberLocations(discardResult.gameState)
          .map((location) => ({
            ...location,
            card: getCardById(discardResult.gameState, location.cardId),
          }))
          .filter(
            (candidate): candidate is StageMemberLocation & { readonly card: CardInstance } =>
              candidate.card !== null &&
              isMemberCardData(candidate.card.data) &&
              cardBelongsToGroup(candidate.card.data, discardedGroupName)
          )
          .map((candidate) => candidate.cardId)
      : [];

  if (selectableCardIds.length === 0) {
    const state = {
      ...discardResult.gameState,
      activeEffect: null,
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_HAND_CARD_NO_SAME_GROUP_TARGET',
        sourceSlot: effect.metadata?.sourceSlot,
        discardedCardId: discardResult.discardedCardIds[0],
        discardedGroupName,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: HS_BP5_003_SELECT_HEART_TARGET_STEP_ID,
        stepText: '请选择与弃置卡片持有相同团体名的成员。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得桃Heart的成员',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardId: discardResult.discardedCardIds[0],
          discardedGroupName,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      discardedGroupName,
      selectableCardIds,
    }
  );
}

function finishHsBp5003RurinoTargetMemberHeart(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetLocation = findStageMemberLocation(game, selectedCardId);
  if (!player || !targetLocation) {
    return game;
  }

  const hearts = [{ color: HeartColor.PINK, count: 1 }];
  const modifierResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: targetLocation.playerId,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts,
    }
  );
  if (!modifierResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(modifierResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_TARGET_MEMBER_HEART',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      discardedGroupName: effect.metadata?.discardedGroupName ?? null,
      targetPlayerId: targetLocation.playerId,
      targetCardId: selectedCardId,
      heartColor: HeartColor.PINK,
    }),
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

function getKnownCardGroupName(card: CardInstance): string | null {
  return (
    getKnownCardGroupIdentityName(card.data) ??
    (typeof card.data.groupName === 'string' ? card.data.groupName : null)
  );
}

function getStageMemberPositionChangeCandidates(game: GameState): readonly StageMemberLocation[] {
  return getStageMemberLocations(game).filter((location) =>
    MEMBER_SLOT_ORDER.some((slot) => slot !== location.slot)
  );
}
