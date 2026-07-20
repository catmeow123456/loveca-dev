import {
  isLiveCardData,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { GamePhase, HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs, memberHasHeartColor } from '../../../effects/card-selectors.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  moveInspectedCardsToWaitingRoomAndEnqueueTriggers,
  moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers,
} from '../../runtime/inspection-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const BP6_006_SELECT_DISCARD_COST_STEP_ID = 'BP6_006_SELECT_DISCARD_COST';
const BP6_006_SELECT_HEART_COLOR_STEP_ID = 'BP6_006_SELECT_HEART_COLOR';
const BP6_006_SELECT_MUSE_REVEALED_CARD_STEP_ID = 'BP6_006_SELECT_MUSE_REVEALED_CARD';

const MUSE = "μ's";
const NORMAL_HEART_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;
const HEART_COLOR_OPTION_TEXTS: Readonly<Record<HeartColor, string>> = {
  [HeartColor.PINK]: '指定[桃ハート]作为Heart颜色。',
  [HeartColor.RED]: '指定[赤ハート]作为Heart颜色。',
  [HeartColor.YELLOW]: '指定[黄ハート]作为Heart颜色。',
  [HeartColor.GREEN]: '指定[緑ハート]作为Heart颜色。',
  [HeartColor.BLUE]: '指定[青ハート]作为Heart颜色。',
  [HeartColor.PURPLE]: '指定[紫ハート]作为Heart颜色。',
  [HeartColor.RAINBOW]: '指定[虹ハート]作为Heart颜色。',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp6006MakiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
    (game, playerId, cardId) => startBp6006Activated(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
    BP6_006_SELECT_DISCARD_COST_STEP_ID,
    (game, input) =>
      finishBp6006DiscardCost(game, input.selectedCardId ?? null, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
    BP6_006_SELECT_HEART_COLOR_STEP_ID,
    (game, input, context) =>
      finishBp6006ChooseColor(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
    BP6_006_SELECT_MUSE_REVEALED_CARD_STEP_ID,
    (game, input, context) =>
      finishBp6006SelectMuseCard(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startBp6006Activated(game: GameState, playerId: string, cardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-bp6-006') ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0 ||
    hasTurnUse(
      game,
      player.id,
      BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
      cardId
    )
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID
        ),
        stepId: BP6_006_SELECT_DISCARD_COST_STEP_ID,
        stepText: '请选择1张手牌放置入休息室作为费用。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'START_SELECT_DISCARD_COST',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishBp6006DiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== BP6_006_SELECT_DISCARD_COST_STEP_ID ||
    !selectedCardId ||
    !effect.selectableCardIds?.includes(selectedCardId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(selectedCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  const stateAfterUse = recordAbilityUseForContext(stateAfterCost, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  return addAction(
    {
      ...stateAfterUse,
      activeEffect: {
        ...effect,
        stepId: BP6_006_SELECT_HEART_COLOR_STEP_ID,
        stepText: '请选择1种 Heart 颜色。',
        selectableCardIds: [],
        selectableOptions: undefined,
        effectChoice: {
          mode: 'SINGLE',
          options: NORMAL_HEART_COLORS.map((color) => ({
            id: color,
            text: HEART_COLOR_OPTION_TEXTS[color],
          })),
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: '选择 Heart 颜色',
        confirmSelectionLabel: '选择',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_COST_SELECT_HEART_COLOR',
      discardedCardId: selectedCardId,
    }
  );
}

function finishBp6006ChooseColor(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const selectedColor = isNormalHeartColor(selectedOptionId)
    ? (selectedOptionId as HeartColor)
    : null;
  if (!effect || effect.stepId !== BP6_006_SELECT_HEART_COLOR_STEP_ID || selectedColor === null) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, { count: 5, reveal: true });
  if (!inspection) {
    return game;
  }
  const inspectedCardIds = inspection.inspectedCardIds;
  const matchingColorCardIds = inspectedCardIds.filter((cardId) => {
    const card = getCardById(inspection.gameState, cardId);
    return card !== null && isCardMatchingBp6006ColorCondition(card, selectedColor);
  });
  const conditionMet = inspectedCardIds.length === 5 && matchingColorCardIds.length === 5;
  const museCandidateCardIds = conditionMet
    ? inspectedCardIds.filter((cardId) => {
        const card = getCardById(inspection.gameState, cardId);
        return card !== null && groupAliasIs(MUSE)(card);
      })
    : [];

  if (!conditionMet || museCandidateCardIds.length === 0) {
    const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
      inspection.gameState,
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
        step: conditionMet ? 'CONDITION_MET_NO_MUSE_TARGET' : 'CONDITION_NOT_MET',
        selectedHeartColor: selectedColor,
        inspectedCardIds,
        matchingColorCardIds,
        museCandidateCardIds,
        waitingRoomCardIds: moveResult.waitingRoomCardIds,
      }),
      false
    );
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        ...effect,
        stepId: BP6_006_SELECT_MUSE_REVEALED_CARD_STEP_ID,
        stepText: "条件满足。请选择1张公开的『μ's』卡加入手牌，其余放置入休息室。",
        inspectionCardIds: inspectedCardIds,
        selectableCardIds: museCandidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: undefined,
        effectChoice: undefined,
        selectionLabel: "选择要加入手牌的『μ's』卡",
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedHeartColor: selectedColor,
          matchingColorCardIds,
          museCandidateCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_TOP_FIVE_SELECT_MUSE_CARD',
      selectedHeartColor: selectedColor,
      inspectedCardIds,
      matchingColorCardIds,
      museCandidateCardIds,
    }
  );
}

function finishBp6006SelectMuseCard(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== BP6_006_SELECT_MUSE_REVEALED_CARD_STEP_ID ||
    !selectedCardId ||
    !effect.selectableCardIds?.includes(selectedCardId) ||
    !effect.inspectionCardIds?.includes(selectedCardId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const moveResult = moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    effect.inspectionCardIds,
    selectedCardId,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  let state: GameState = { ...moveResult.gameState, activeEffect: null };
  let bladeApplied = false;
  if (getSourceMemberSlot(state, player.id, effect.sourceCardId) !== null) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 3,
    });
    if (bladeResult) {
      state = bladeResult.gameState;
      bladeApplied = true;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TAKE_MUSE_CARD_GAIN_BLADE',
      selectedHeartColor: effect.metadata?.selectedHeartColor ?? null,
      selectedCardId,
      selectedCardIds: [selectedCardId],
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
      bladeBonus: bladeApplied ? 3 : 0,
      bladeApplied,
    }),
    false
  );
}

function isCardMatchingBp6006ColorCondition(card: CardInstance, color: HeartColor): boolean {
  if (isMemberCardData(card.data)) {
    return memberHasHeartColor(color)(card);
  }
  return (
    isLiveCardData(card.data) && (card.data.requirements.colorRequirements.get(color) ?? 0) > 0
  );
}

function isNormalHeartColor(value: string | null): value is HeartColor {
  return value !== null && NORMAL_HEART_COLORS.some((color) => color === value);
}

function hasTurnUse(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  return game.actionHistory.some(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.playerId === playerId &&
      action.payload.abilityId === abilityId &&
      action.payload.sourceCardId === sourceCardId &&
      action.payload.step === 'ABILITY_USE' &&
      action.payload.turnCount === game.turnCount
  );
}
