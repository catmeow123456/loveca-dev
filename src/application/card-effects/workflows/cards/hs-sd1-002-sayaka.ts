import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  moveInspectedCardsToWaitingRoomAndEnqueueTriggers,
  moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers,
} from '../../runtime/inspection-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'HS_SD1_002_SELECT_DISCARD_TWO';
const SELECT_INSPECTED_MEMBER_STEP_ID = 'HS_SD1_002_SELECT_INSPECTED_MEMBER';
const DISCARD_COUNT = 2;
const LOOK_TOP_COUNT = 5;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsSd1002SayakaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1002LiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHsSd1002Discard(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
    SELECT_INSPECTED_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHsSd1002InspectedMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startHsSd1002LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const discardCandidateIds = player.hand.cardIds;
  if (discardCandidateIds.length < DISCARD_COUNT) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_OP_NOT_ENOUGH_HAND_TO_DISCARD',
      { handCardIds: discardCandidateIds }
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
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText:
        '可以将2张手牌放置入休息室。如此做时，检视自己卡组顶5张卡，可以公开1张成员卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: discardCandidateIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: DISCARD_COUNT,
      maxSelectableCards: DISCARD_COUNT,
      selectionLabel: '选择要放置入休息室的2张手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_TWO',
      selectableCardIds: discardCandidateIds,
    },
  });
}

function finishHsSd1002Discard(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getHsSd1002Effect(game, SELECT_DISCARD_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  if (selectedCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_DISCARD_LOOK_TOP',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== DISCARD_COUNT ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: DISCARD_COUNT,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const inspection = inspectTopCards(discardResult.gameState, player.id, {
    count: LOOK_TOP_COUNT,
    selectablePredicate: typeIs(CardType.MEMBER),
  });
  if (!inspection) {
    return game;
  }

  if (inspection.inspectedCardIds.length === 0 || inspection.selectableCardIds.length === 0) {
    const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
      inspection.gameState,
      player.id,
      inspection.inspectedCardIds,
      enqueueTriggeredCardEffects
    );
    if (!moveResult) {
      return game;
    }
    return continuePendingCardEffects(
      addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step:
          inspection.inspectedCardIds.length === 0
            ? 'NO_TOP_CARDS_AFTER_DISCARD'
            : 'NO_MEMBER_TO_REVEAL',
        discardedHandCardIds: discardResult.discardedCardIds,
        inspectedCardIds: inspection.inspectedCardIds,
        waitingRoomCardIds: moveResult.waitingRoomCardIds,
        gainedHeartBlade: false,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_INSPECTED_MEMBER_STEP_ID,
        stepText:
          '请选择至多1张成员卡公开并加入手牌。可以不公开，将检视的卡全部放置入休息室。',
        inspectionCardIds: inspection.inspectedCardIds,
        selectableCardIds: inspection.selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: '选择要公开并加入手牌的成员卡',
        confirmSelectionLabel: '公开并加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: '不公开',
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_INSPECTED_MEMBER',
      discardedHandCardIds: discardResult.discardedCardIds,
      inspectedCardIds: inspection.inspectedCardIds,
      selectableCardIds: inspection.selectableCardIds,
    }
  );
}

function finishHsSd1002InspectedMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getHsSd1002Effect(game, SELECT_INSPECTED_MEMBER_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  if (selectedCardId === null) {
    const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
      game,
      player.id,
      inspectedCardIds,
      enqueueTriggeredCardEffects
    );
    if (!moveResult) {
      return game;
    }
    return continuePendingCardEffects(
      addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_SELECTION_MOVE_INSPECTED_TO_WAITING_ROOM',
        discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
        inspectedCardIds,
        waitingRoomCardIds: moveResult.waitingRoomCardIds,
        gainedHeartBlade: false,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !game.inspectionZone.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const selectedCard = getCardById(game, selectedCardId);
  if (!selectedCard || !isMemberCardData(selectedCard.data)) {
    return game;
  }

  const revealedCardIds = game.inspectionZone.revealedCardIds.includes(selectedCardId)
    ? game.inspectionZone.revealedCardIds
    : [...game.inspectionZone.revealedCardIds, selectedCardId];
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
    },
    player.id,
    inspectedCardIds,
    selectedCardId,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  const selectedIsHasunosora = and(typeIs(CardType.MEMBER), groupAliasIs('蓮ノ空'))(selectedCard);
  const stateAfterBonus = selectedIsHasunosora
    ? addSourceBlueHeartAndBlade(moveResult.gameState, player.id, effect.sourceCardId, effect.abilityId)
    : moveResult.gameState;
  if (!stateAfterBonus) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...stateAfterBonus, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: selectedIsHasunosora
        ? 'ADD_HASUNOSORA_MEMBER_TO_HAND_GAIN_BLUE_HEART_BLADE'
        : 'ADD_NON_HASUNOSORA_MEMBER_TO_HAND',
      discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
      selectedCardId,
      inspectedCardIds,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
      gainedHeartBlade: selectedIsHasunosora,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function addSourceBlueHeartAndBlade(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string
): GameState | null {
  const heartResult = addHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId,
    hearts: [{ color: HeartColor.BLUE, count: 1 }],
  });
  if (!heartResult) {
    return null;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
    playerId,
    sourceCardId,
    abilityId,
    amount: 1,
  });
  return bladeResult?.gameState ?? null;
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getHsSd1002Effect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function getStringArrayMetadata(effect: ActiveEffectState, key: string): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
