import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  and,
  cardNameAliasAny,
  groupAliasIs,
  typeIs,
  type CardSelector,
} from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
  PL_N_PB1_003_ACTIVATED_PAY_TWO_ENERGY_HAND_DISCARD_SELF_DRAW_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { drawCardsForPlayer, addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

export const ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_BLADE_SELECT_MEMBER_STEP_ID =
  'ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_BLADE_SELECT_MEMBER';

interface ActivatedHandDiscardSelfDrawTargetBladeConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly energyCost: 0 | 2;
  readonly targetSelector: CardSelector;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly confirmSelectionLabel: string;
  readonly startSelectionActionStep: string;
  readonly noTargetActionStep: string;
  readonly targetActionStep: string;
}

const CONFIGS: readonly ActivatedHandDiscardSelfDrawTargetBladeConfig[] = [
  {
    abilityId: HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
    baseCardCode: 'PL!HS-bp6-014',
    energyCost: 0,
    targetSelector: cardNameAliasAny(['藤島慈', '大沢瑠璃乃']),
    stepText: '请选择自己舞台上的1名「藤岛慈」或「大泽瑠璃乃」，LIVE结束时为止获得[BLADE]。',
    selectionLabel: '选择获得[BLADE]的成员',
    confirmSelectionLabel: '获得[BLADE]',
    startSelectionActionStep: 'DISCARD_SELF_DRAW_ONE_START_SELECT_TARGET',
    noTargetActionStep: 'DISCARD_SELF_DRAW_ONE_NO_TARGET',
    targetActionStep: 'TARGET_MEGU_RURINO_GAIN_BLADE',
  },
  {
    abilityId:
      PL_N_PB1_003_ACTIVATED_PAY_TWO_ENERGY_HAND_DISCARD_SELF_DRAW_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
    baseCardCode: 'PL!N-pb1-003',
    energyCost: 2,
    targetSelector: and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲')),
    stepText: '请选择自己舞台上的1名『虹咲』的成员，LIVE结束时为止获得[BLADE]。',
    selectionLabel: '选择获得[BLADE]的虹咲成员',
    confirmSelectionLabel: '获得[BLADE]',
    startSelectionActionStep: 'PAY_COST_DRAW_ONE_START_SELECT_NIJIGASAKI_TARGET',
    noTargetActionStep: 'PAY_COST_DRAW_ONE_NO_NIJIGASAKI_TARGET',
    targetActionStep: 'TARGET_NIJIGASAKI_MEMBER_GAIN_BLADE',
  },
] as const;

const STAGE_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export function registerActivatedHandDiscardSelfDrawTargetBladeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of CONFIGS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startWorkflow(game, playerId, cardId, config, deps.enqueueTriggeredCardEffects)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_BLADE_SELECT_MEMBER_STEP_ID,
      (game, input) => finishTargetSelection(game, input.selectedCardId ?? null, config)
    );
  }
}

function startWorkflow(
  game: GameState,
  playerId: string,
  cardId: string,
  config: ActivatedHandDiscardSelfDrawTargetBladeConfig,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
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
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, config.baseCardCode) ||
    !player.hand.cardIds.includes(cardId)
  ) {
    return game;
  }

  const paymentResult = payImmediateEffectCosts(
    game,
    player.id,
    cardId,
    config.energyCost === 0 ? [] : [{ kind: 'TAP_ACTIVE_ENERGY', count: config.energyCost }]
  );
  if (!paymentResult) {
    return game;
  }

  // The activated handler is replayed after the standard energy-selection window. Revalidate the
  // hand source before any energy is committed, then discard it through the trigger-safe wrapper.
  const paidPlayer = getPlayerById(paymentResult.gameState, player.id);
  if (!paidPlayer?.hand.cardIds.includes(cardId)) {
    return game;
  }
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    paymentResult.gameState,
    player.id,
    cardId,
    { candidateCardIds: [cardId] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = discardResult.gameState;
  if (config.energyCost > 0) {
    state = recordPayCostAction(state, player.id, {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      paidEnergyCardIds: paymentResult.paidEnergyCardIds,
      energyCardIds: paymentResult.paidEnergyCardIds,
      discardedCardIds: discardResult.discardedCardIds,
      movedToWaitingRoomCardIds: discardResult.discardedCardIds,
      cause: { kind: 'CARD_EFFECT', abilityId: config.abilityId, sourceCardId: cardId },
    });
  }
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
  });

  const drawResult =
    getPlayerById(state, player.id)?.mainDeck.cardIds.length === 0
      ? { gameState: state, drawnCardIds: [] as readonly string[] }
      : drawCardsForPlayer(state, player.id, 1);
  if (!drawResult) {
    return game;
  }
  state = drawResult.gameState;

  const targetCardIds = getTargetMemberCardIds(state, player.id, config.targetSelector);
  const commonPayload = {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    effectText: getAbilityEffectText(config.abilityId),
    paidEnergyCardIds: paymentResult.paidEnergyCardIds,
    discardedCardIds: discardResult.discardedCardIds,
    drawnCardIds: drawResult.drawnCardIds,
  };
  if (targetCardIds.length === 0) {
    return addAction(state, 'RESOLVE_ABILITY', player.id, {
      ...commonPayload,
      step: config.noTargetActionStep,
      targetCardIds,
      bladeBonus: 0,
    });
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `activated-hand-discard-target-blade:turn-${state.turnCount}:action-${state.actionSequence}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_BLADE_SELECT_MEMBER_STEP_ID,
        stepText: config.stepText,
        awaitingPlayerId: player.id,
        selectableCardIds: targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: config.selectionLabel,
        confirmSelectionLabel: config.confirmSelectionLabel,
        canSkipSelection: false,
        metadata: {
          paidEnergyCardIds: paymentResult.paidEnergyCardIds,
          discardedCardIds: discardResult.discardedCardIds,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      ...commonPayload,
      step: config.startSelectionActionStep,
      targetCardIds,
    }
  );
}

function finishTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  config: ActivatedHandDiscardSelfDrawTargetBladeConfig
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_BLADE_SELECT_MEMBER_STEP_ID ||
    !player ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const currentTargetCardIds = getTargetMemberCardIds(game, player.id, config.targetSelector);
  if (!currentTargetCardIds.includes(selectedCardId)) {
    if (currentTargetCardIds.length > 0) {
      return {
        ...game,
        activeEffect: {
          ...effect,
          selectableCardIds: currentTargetCardIds,
        },
      };
    }
    return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      effectText: effect.effectText,
      step: `${config.noTargetActionStep}_AFTER_STALE_SELECTION`,
      targetCardIds: [],
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
      discardedCardIds: effect.metadata?.discardedCardIds ?? [],
      drawnCardIds: effect.metadata?.drawnCardIds ?? [],
      bladeBonus: 0,
    });
  }

  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    effectText: effect.effectText,
    step: config.targetActionStep,
    targetCardId: selectedCardId,
    paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
    discardedCardIds: effect.metadata?.discardedCardIds ?? [],
    drawnCardIds: effect.metadata?.drawnCardIds ?? [],
    bladeBonus: 1,
  });
}

function getTargetMemberCardIds(
  game: GameState,
  playerId: string,
  selector: CardSelector
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return STAGE_SLOT_ORDER.map((slot) => player.memberSlots.slots[slot])
    .filter((cardId): cardId is string => typeof cardId === 'string')
    .filter((cardId) => {
      const card = getCardById(game, cardId);
      return !!card && card.ownerId === playerId && isMemberCardData(card.data) && selector(card);
    });
}
