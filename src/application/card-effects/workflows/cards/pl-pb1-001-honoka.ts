import { isLiveCardData, isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, FaceState, GamePhase, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID } from '../../ability-ids.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers,
} from '../../runtime/inspection-waiting-room-triggers.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const SELECT_REVEAL_MODE_STEP_ID = 'PL_PB1_001_SELECT_REVEAL_MODE';
const SELECT_DISCARD_STEP_ID = 'PL_PB1_001_SELECT_DISCARD_HAND_COST';
const CONFIRM_REVEALED_CARDS_STEP_ID = 'PL_PB1_001_CONFIRM_REVEALED_CARDS';
const LIVE_OPTION_ID = 'LIVE_CARD';
const HIGH_COST_MEMBER_OPTION_ID = 'HIGH_COST_MEMBER';
const BASE_CARD_CODE = 'PL!-pb1-001';

type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type RevealMode = typeof LIVE_OPTION_ID | typeof HIGH_COST_MEMBER_OPTION_ID;

interface RevealUntilHitResult {
  readonly gameState: GameState;
  readonly inspectedCardIds: readonly string[];
  readonly hitCardId: string | null;
}

export function registerPlPb1001HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
    (game, playerId, cardId) => startHonokaRevealUntilChosen(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHonokaDiscardCost(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
    SELECT_REVEAL_MODE_STEP_ID,
    (game, input) =>
      revealHonokaCardsUntilChosen(
        game,
        input.selectedOptionId ?? null
      )
  );
  registerActiveEffectStepHandler(
    PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
    CONFIRM_REVEALED_CARDS_STEP_ID,
    (game, _input, context) =>
      finishHonokaRevealUntilChosen(
        game,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startHonokaRevealUntilChosen(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceOrientation = player?.memberSlots.cardStates.get(cardId)?.orientation ?? null;
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    sourceSlot !== SlotPosition.CENTER ||
    sourceOrientation === null ||
    sourceOrientation === OrientationState.WAITING ||
    player.hand.cardIds.length === 0
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation === OrientationState.WAITING) {
    return game;
  }

  const stateWithWaitCost = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', playerId, {
          abilityId: PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  ).gameState;
  const playerAfterWait = getPlayerById(stateWithWaitCost, playerId);
  const selectableCardIds = playerAfterWait?.hand.cardIds ?? [];
  if (selectableCardIds.length === 0) {
    return game;
  }

  return addAction(
    {
      ...stateWithWaitCost,
      activeEffect: {
        id: `${PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID}:${cardId}:turn-${stateWithWaitCost.turnCount}:action-${stateWithWaitCost.actionHistory.length}`,
        abilityId: PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。之后选择要公开直到命中的卡牌类型。',
        awaitingPlayerId: playerId,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          orderedResolution: false,
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'WAIT_SELF_START_SELECT_DISCARD_COST',
      selectableCardIds,
    }
  );
}

function finishHonokaDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  _continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getHonokaEffect(game, SELECT_DISCARD_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds,
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterDiscardCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId,
  });
  const stateAfterUse = recordAbilityUseForContext(stateAfterDiscardCost, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  return addAction(
    {
      ...stateAfterUse,
      activeEffect: {
        ...effect,
        stepId: SELECT_REVEAL_MODE_STEP_ID,
        stepText: '请选择要公开直到命中的卡牌类型。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        selectionLabel: undefined,
        selectableOptions: [
          { id: LIVE_OPTION_ID, label: 'LIVE卡' },
          { id: HIGH_COST_MEMBER_OPTION_ID, label: '费用10以上成员卡' },
        ],
        confirmSelectionLabel: '选择',
        metadata: {
          ...effect.metadata,
          discardedCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'DISCARD_COST_START_SELECT_REVEAL_MODE',
      discardedCardId: selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
      selectableOptionIds: [LIVE_OPTION_ID, HIGH_COST_MEMBER_OPTION_ID],
    }
  );
}

function revealHonokaCardsUntilChosen(
  game: GameState,
  selectedOptionId: string | null
): GameState {
  const effect = getHonokaEffect(game, SELECT_REVEAL_MODE_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const mode = normalizeRevealMode(selectedOptionId);
  if (!effect || !player || mode === null || !isSelectableOption(effect, mode)) {
    return game;
  }

  const revealResult = revealTopCardsUntilHit(game, player.id, mode);
  if (!revealResult) {
    return game;
  }

  return addAction(
    {
      ...revealResult.gameState,
      activeEffect: {
        ...effect,
        stepId: CONFIRM_REVEALED_CARDS_STEP_ID,
        stepText: formatRevealConfirmationStepText(revealResult, mode),
        inspectionCardIds: revealResult.inspectedCardIds,
        revealedCardIds: revealResult.inspectedCardIds,
        selectableOptions: undefined,
        confirmSelectionLabel: undefined,
        canSkipSelection: undefined,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedMode: mode,
          inspectedCardIds: revealResult.inspectedCardIds,
          hitCardId: revealResult.hitCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'REVEAL_UNTIL_HIT_START_CONFIRM',
      selectedOptionId: mode,
      selectedMode: mode,
      inspectedCardIds: revealResult.inspectedCardIds,
      hitCardId: revealResult.hitCardId,
    }
  );
}

function finishHonokaRevealUntilChosen(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getHonokaEffect(game, CONFIRM_REVEALED_CARDS_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const mode = normalizeRevealMode(readStringMetadata(effect, 'selectedMode'));
  const inspectedCardIds = effect?.inspectionCardIds ?? [];
  const hitCardId = readNullableStringMetadata(effect, 'hitCardId');
  if (
    !effect ||
    !player ||
    mode === null ||
    (hitCardId !== null && !inspectedCardIds.includes(hitCardId)) ||
    inspectedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId))
  ) {
    return game;
  }

  const moveResult = moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    inspectedCardIds,
    hitCardId,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step:
        hitCardId === null
          ? 'REVEAL_UNTIL_NO_HIT'
          : mode === LIVE_OPTION_ID
            ? 'REVEAL_UNTIL_LIVE_TO_HAND'
            : 'REVEAL_UNTIL_HIGH_COST_MEMBER_TO_HAND',
      selectedOptionId: mode,
      selectedMode: mode,
      inspectedCardIds,
      hitCardId,
      selectedCardIds: moveResult.selectedCardIds,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function revealTopCardsUntilHit(
  game: GameState,
  playerId: string,
  mode: RevealMode
): RevealUntilHitResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const hitIndex = player.mainDeck.cardIds.findIndex((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && doesCardMatchRevealMode(game, playerId, card, mode);
  });
  const revealCount = hitIndex >= 0 ? hitIndex + 1 : player.mainDeck.cardIds.length;
  const inspection = inspectTopCards(game, playerId, {
    count: revealCount,
    reveal: true,
  });
  if (!inspection) {
    return null;
  }

  return {
    gameState: inspection.gameState,
    inspectedCardIds: inspection.inspectedCardIds,
    hitCardId: hitIndex >= 0 ? inspection.inspectedCardIds.at(-1) ?? null : null,
  };
}

function doesCardMatchRevealMode(
  game: GameState,
  playerId: string,
  card: CardInstance,
  mode: RevealMode
): boolean {
  if (mode === LIVE_OPTION_ID) {
    return isLiveCardData(card.data);
  }
  return (
    isMemberCardData(card.data) &&
    card.data.cardType === CardType.MEMBER &&
    getMemberEffectiveCost(game, playerId, card.instanceId) >= 10
  );
}

function getHonokaEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function normalizeRevealMode(selectedOptionId: string | null): RevealMode | null {
  return selectedOptionId === LIVE_OPTION_ID || selectedOptionId === HIGH_COST_MEMBER_OPTION_ID
    ? selectedOptionId
    : null;
}

function isSelectableOption(effect: ActiveEffectState, optionId: RevealMode): boolean {
  return effect.selectableOptions?.some((option) => option.id === optionId) === true;
}

function formatRevealConfirmationStepText(
  result: RevealUntilHitResult,
  mode: RevealMode
): string {
  const targetText = mode === LIVE_OPTION_ID ? 'LIVE卡' : '费用10以上成员卡';
  if (result.hitCardId === null) {
    return `已公开${result.inspectedCardIds.length}张卡，未公开到${targetText}。确认后将公开的卡全部放置入休息室。`;
  }
  return `已公开${result.inspectedCardIds.length}张卡并公开到${targetText}。确认后将命中的卡加入手牌，其余公开的卡放置入休息室。`;
}

function readStringMetadata(effect: ActiveEffectState | null, key: string): string | null {
  const value = effect?.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function readNullableStringMetadata(effect: ActiveEffectState | null, key: string): string | null {
  return readStringMetadata(effect, key);
}
