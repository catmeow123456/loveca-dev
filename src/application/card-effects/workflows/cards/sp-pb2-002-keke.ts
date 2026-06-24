import {
  isMemberCardData,
  type CardInstance,
  type HeartIcon,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID } from '../../ability-ids.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';

const SELECT_DISCARD_LIELLA_STEP_ID = 'SP_PB2_002_SELECT_DISCARD_LIELLA';
const SELECT_RESOLUTION_OPTION_STEP_ID = 'SP_PB2_002_SELECT_RESOLUTION_OPTION';
const SELECT_HEART_TARGET_STEP_ID = 'SP_PB2_002_SELECT_HEART_TARGET';

const ENERGY_OPTION_ID = 'energy';
const HEART_OPTION_ID = 'heart';
const ENERGY_AND_HEART_OPTION_ID = 'energy-and-heart';
const HEART_BONUS: readonly HeartIcon[] = [{ color: HeartColor.PURPLE, count: 2 }];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom;

const liellaCard = groupAliasIs('Liella!');
const noBladeHeartMember = (card: CardInstance): boolean =>
  typeIs(CardType.MEMBER)(card) && not(hasBladeHeart())(card);

export function registerSpPb2002KekeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
    (game, playerId, cardId) => startSpPb2002KekeActivatedEffect(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
    SELECT_DISCARD_LIELLA_STEP_ID,
    (game, input, context) =>
      finishDiscardLiellaCost(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
    SELECT_RESOLUTION_OPTION_STEP_ID,
    (game, input, context) =>
      resolveSelectedOption(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
    SELECT_HEART_TARGET_STEP_ID,
    (game, input, context) =>
      finishHeartTargetSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpPb2002KekeActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-pb2-002') ||
    !isMemberCardData(sourceCard.data) ||
    !isSourceOnStage(game, playerId, cardId)
  ) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((handCardId) => {
    const handCard = getCardById(game, handCardId);
    return handCard ? liellaCard(handCard) : false;
  });
  if (
    selectableCardIds.length === 0 ||
    getAvailableOptionIds(game, playerId, cardId, false).length === 0
  ) {
    return game;
  }

  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_LIELLA_STEP_ID,
        stepText: '请选择1张手牌中的『Liella!』卡放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的『Liella!』手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID,
      sourceCardId: cardId,
      step: 'PAY_COST',
      selectableCardIds,
      availableOptionIds: getAvailableOptionIds(state, player.id, cardId, false),
    }
  );
}

function finishDiscardLiellaCost(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const selectedCard = selectedCardId ? getCardById(game, selectedCardId) : null;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_LIELLA_STEP_ID ||
    !player ||
    !selectedCardId ||
    !selectedCard ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId) ||
    !liellaCard(selectedCard)
  ) {
    return game;
  }

  const discardedNoBladeHeartMember = noBladeHeartMember(selectedCard);
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterDiscard = addAction(discardResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'DISCARD_LIELLA_CARD',
    discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    discardedNoBladeHeartMember,
  });

  return startOptionSelection(
    stateAfterDiscard,
    effect,
    discardResult.discardedCardIds[0] ?? selectedCardId,
    discardedNoBladeHeartMember,
    continuePendingCardEffects
  );
}

function startOptionSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  discardedCardId: string,
  discardedNoBladeHeartMember: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const availableOptionIds = getAvailableOptionIds(
    game,
    player.id,
    effect.sourceCardId,
    discardedNoBladeHeartMember
  );
  if (availableOptionIds.length === 0) {
    return finishWithPayload(
      game,
      player.id,
      effect,
      {
        step: 'FINISH',
        discardedCardId,
        discardedNoBladeHeartMember,
        selectedOptionIds: [],
        placedEnergyCardIds: [],
        targetMemberCardId: null,
        heartBonus: [],
      },
      continuePendingCardEffects
    );
  }

  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_RESOLUTION_OPTION_STEP_ID,
      stepText: discardedNoBladeHeartMember ? '请选择1个或2个结算选项。' : '请选择1个结算选项。',
      awaitingPlayerId: player.id,
      selectableCardIds: undefined,
      selectableCardVisibility: undefined,
      selectableCardMode: undefined,
      minSelectableCards: undefined,
      maxSelectableCards: undefined,
      selectableOptions: availableOptionIds.map((optionId) => ({
        id: optionId,
        label: getOptionLabel(optionId),
      })),
      selectionLabel: undefined,
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        discardedCardId,
        discardedNoBladeHeartMember,
      },
    },
  };
}

function resolveSelectedOption(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const discardedNoBladeHeartMember = effect?.metadata?.discardedNoBladeHeartMember === true;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_RESOLUTION_OPTION_STEP_ID ||
    !player ||
    !selectedOptionId ||
    !getAvailableOptionIds(
      game,
      player.id,
      effect.sourceCardId,
      discardedNoBladeHeartMember
    ).includes(selectedOptionId)
  ) {
    return game;
  }

  const selectedOptionIds = getSelectedOptionIds(selectedOptionId);
  let state = game;
  let placedEnergyCardIds: readonly string[] = [];
  if (selectedOptionIds.includes(ENERGY_OPTION_ID)) {
    const energyResult = placeEnergyFromDeckToZone(state, player.id, 1, OrientationState.WAITING);
    if (!energyResult || energyResult.placedEnergyCardIds.length === 0) {
      return game;
    }
    state = energyResult.gameState;
    placedEnergyCardIds = energyResult.placedEnergyCardIds;
  }

  const stateAfterEnergy = addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: selectedOptionIds.includes(ENERGY_OPTION_ID) ? 'PLACE_WAITING_ENERGY' : 'SELECT_OPTION',
    discardedCardId: effect.metadata?.discardedCardId,
    discardedNoBladeHeartMember,
    selectedOptionIds,
    placedEnergyCardIds,
  });

  if (!selectedOptionIds.includes(HEART_OPTION_ID)) {
    return finishWithPayload(
      stateAfterEnergy,
      player.id,
      effect,
      {
        step: 'FINISH',
        discardedCardId: effect.metadata?.discardedCardId,
        discardedNoBladeHeartMember,
        selectedOptionIds,
        placedEnergyCardIds,
        targetMemberCardId: null,
        heartBonus: [],
      },
      continuePendingCardEffects
    );
  }

  const targetMemberCardIds = getHeartTargetMemberCardIds(
    stateAfterEnergy,
    player.id,
    effect.sourceCardId
  );
  if (targetMemberCardIds.length === 0) {
    return game;
  }

  return {
    ...stateAfterEnergy,
    activeEffect: {
      ...effect,
      stepId: SELECT_HEART_TARGET_STEP_ID,
      stepText: '请选择自己舞台上此成员以外的1名『Liella!』成员，获得 heart06 heart06。',
      awaitingPlayerId: player.id,
      selectableOptions: undefined,
      selectableCardIds: targetMemberCardIds,
      selectableCardMode: 'SINGLE',
      selectableCardVisibility: undefined,
      selectionLabel: '选择获得 heart06 heart06 的『Liella!』成员',
      confirmSelectionLabel: '给予Heart',
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        selectedOptionIds,
        placedEnergyCardIds,
      },
    },
  };
}

function finishHeartTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_002_ACTIVATED_DISCARD_LIELLA_OPTION_ENERGY_OR_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_HEART_TARGET_STEP_ID ||
    !player ||
    !selectedCardId ||
    !getHeartTargetMemberCardIds(game, player.id, effect.sourceCardId).includes(selectedCardId)
  ) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    memberCardId: selectedCardId,
    hearts: HEART_BONUS,
  });
  if (!heartResult) {
    return game;
  }

  const selectedOptionIds = getMetadataStringArray(effect.metadata?.selectedOptionIds);
  const placedEnergyCardIds = getMetadataStringArray(effect.metadata?.placedEnergyCardIds);

  const heartPayload = {
    discardedCardId: effect.metadata?.discardedCardId,
    discardedNoBladeHeartMember: effect.metadata?.discardedNoBladeHeartMember === true,
    selectedOptionIds,
    placedEnergyCardIds,
    targetMemberCardId: selectedCardId,
    heartBonus: heartResult.heartBonus,
  };
  const stateAfterHeartAction = addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'GAIN_HEART',
    ...heartPayload,
  });

  return finishWithPayload(
    stateAfterHeartAction,
    player.id,
    effect,
    {
      step: 'FINISH',
      ...heartPayload,
    },
    continuePendingCardEffects
  );
}

function finishWithPayload(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isSourceOnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player
    ? Object.values(player.memberSlots.slots).some((cardId) => cardId === sourceCardId)
    : false;
}

function getAvailableOptionIds(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  allowMultiple: boolean
): string[] {
  const options: string[] = [];
  const player = getPlayerById(game, playerId);
  if (!player) {
    return options;
  }
  if (player.energyDeck.cardIds.length > 0) {
    options.push(ENERGY_OPTION_ID);
  }
  if (getHeartTargetMemberCardIds(game, playerId, sourceCardId).length > 0) {
    options.push(HEART_OPTION_ID);
  }
  if (allowMultiple && options.includes(ENERGY_OPTION_ID) && options.includes(HEART_OPTION_ID)) {
    options.push(ENERGY_AND_HEART_OPTION_ID);
  }
  return options;
}

function getHeartTargetMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return (Object.values(SlotPosition) as SlotPosition[]).flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId &&
      cardId !== sourceCardId &&
      card &&
      card.ownerId === playerId &&
      isMemberCardData(card.data) &&
      liellaCard(card)
      ? [cardId]
      : [];
  });
}

function getSelectedOptionIds(optionId: string): readonly string[] {
  return optionId === ENERGY_AND_HEART_OPTION_ID ? [ENERGY_OPTION_ID, HEART_OPTION_ID] : [optionId];
}

function getOptionLabel(optionId: string): string {
  if (optionId === ENERGY_OPTION_ID) {
    return '从能量卡组放置1张待机能量';
  }
  if (optionId === HEART_OPTION_ID) {
    return '使此成员以外的1名『Liella!』成员获得heart06 heart06';
  }
  return '放置待机能量，并给予1名成员heart06 heart06';
}

function getMetadataStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
