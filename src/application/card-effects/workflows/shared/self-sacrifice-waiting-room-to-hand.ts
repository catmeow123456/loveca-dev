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
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import {
  BP4_003_ACTIVATED_ABILITY_ID,
  ELI_ACTIVATED_ABILITY_ID,
  HS_CL1_008_ACTIVATED_SELF_SACRIFICE_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
  RIN_ACTIVATED_ABILITY_ID,
  S_BP3_008_ACTIVATED_SELF_SACRIFICE_RECOVER_AQOURS_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
  SP_BP4_018_ACTIVATED_SELF_SACRIFICE_RECOVER_LIELLA_CARD_ABILITY_ID,
} from '../../ability-ids.js';
import { findCardAbilityDefinitionById } from '../../definitions/lookup.js';
import {
  activateWaitingEnergyCardsForPlayer,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { successLiveScoreAtLeast, sumSuccessfulLiveScore } from '../../../effects/conditions.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { clearPreviousStageMemberInstanceState } from '../../../effects/member-state.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';

const ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'ELI_SELECT_WAITING_ROOM_MEMBER';
const RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'RIN_SELECT_WAITING_ROOM_LIVE';
const BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'BP4_003_SELECT_WAITING_ROOM_LIVE';
const PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'PB1_019_SELECT_WAITING_ROOM_MEMBER';
const HS_CL1_008_SELECT_WAITING_ROOM_HASUNOSORA_CARD_STEP_ID =
  'HS_CL1_008_SELECT_WAITING_ROOM_HASUNOSORA_CARD';
const SP_BP4_018_SELECT_WAITING_ROOM_LIELLA_CARD_STEP_ID =
  'SP_BP4_018_SELECT_WAITING_ROOM_LIELLA_CARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForLeaveStage;

export interface SelfSacrificeWaitingRoomToHandWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

interface SelfSacrificeWaitingRoomToHandWorkflowConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly stepId: string;
  readonly selectablePredicate: (card: CardInstance) => boolean;
  readonly selectionRequiredWhenHasTargets?: boolean;
  readonly stepText?: string;
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly postRecovery?:
    | {
        readonly kind: 'SUCCESS_LIVE_PRINTED_SCORE_AT_LEAST';
        readonly threshold: number;
        readonly activateCount: number;
        readonly finishStep: string;
      }
    | {
        readonly kind: 'RECOVERED_AQOURS_LIVE_PRINTED_SCORE_AT_LEAST';
        readonly threshold: number;
        readonly activateCount: number;
        readonly finishStep: string;
      };
}

const SELF_SACRIFICE_WAITING_ROOM_TO_HAND_WORKFLOWS: readonly SelfSacrificeWaitingRoomToHandWorkflowConfig[] =
  [
    {
      abilityId: PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
      expectedBaseCardCodes: ['PL!-PR-017'],
      stepId: 'PR_017_SELECT_WAITING_ROOM_MUSE_LIVE',
      selectablePredicate: and(typeIs(CardType.LIVE), groupAliasIs("μ's")),
      selectionRequiredWhenHasTargets: true,
      postRecovery: {
        kind: 'SUCCESS_LIVE_PRINTED_SCORE_AT_LEAST',
        threshold: 9,
        activateCount: 2,
        finishStep: 'RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_IF_SUCCESS_SCORE',
      },
    },
    {
      abilityId: S_BP3_008_ACTIVATED_SELF_SACRIFICE_RECOVER_AQOURS_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
      expectedBaseCardCodes: ['PL!S-bp3-008'],
      stepId: 'S_BP3_008_SELECT_WAITING_ROOM_LIVE',
      selectablePredicate: typeIs(CardType.LIVE),
      selectionRequiredWhenHasTargets: true,
      stepText: '请选择1张LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的LIVE卡',
      confirmSelectionLabel: '加入手牌',
      postRecovery: {
        kind: 'RECOVERED_AQOURS_LIVE_PRINTED_SCORE_AT_LEAST',
        threshold: 6,
        activateCount: 4,
        finishStep: 'RECOVER_LIVE_ACTIVATE_ENERGY_IF_AQOURS_SCORE',
      },
    },
    {
      abilityId: ELI_ACTIVATED_ABILITY_ID,
      expectedBaseCardCodes: ['PL!-sd1-002'],
      stepId: ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      selectablePredicate: typeIs(CardType.MEMBER),
    },
    {
      abilityId: RIN_ACTIVATED_ABILITY_ID,
      expectedBaseCardCodes: getCardAbilityBaseCardCodes(RIN_ACTIVATED_ABILITY_ID),
      stepId: RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      selectablePredicate: typeIs(CardType.LIVE),
    },
    {
      abilityId: PB1_019_ACTIVATED_ABILITY_ID,
      expectedBaseCardCodes: getCardAbilityBaseCardCodes(PB1_019_ACTIVATED_ABILITY_ID),
      stepId: PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      selectablePredicate: typeIs(CardType.MEMBER),
    },
    {
      abilityId: BP4_003_ACTIVATED_ABILITY_ID,
      expectedBaseCardCodes: ['PL!-bp4-003'],
      stepId: BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      selectablePredicate: typeIs(CardType.LIVE),
    },
    {
      abilityId: HS_CL1_008_ACTIVATED_SELF_SACRIFICE_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
      expectedBaseCardCodes: getCardAbilityBaseCardCodes(
        HS_CL1_008_ACTIVATED_SELF_SACRIFICE_RECOVER_HASUNOSORA_CARD_ABILITY_ID
      ),
      stepId: HS_CL1_008_SELECT_WAITING_ROOM_HASUNOSORA_CARD_STEP_ID,
      selectablePredicate: groupAliasIs('蓮ノ空'),
      selectionRequiredWhenHasTargets: true,
    },
    {
      abilityId: SP_BP4_018_ACTIVATED_SELF_SACRIFICE_RECOVER_LIELLA_CARD_ABILITY_ID,
      expectedBaseCardCodes: getCardAbilityBaseCardCodes(
        SP_BP4_018_ACTIVATED_SELF_SACRIFICE_RECOVER_LIELLA_CARD_ABILITY_ID
      ),
      stepId: SP_BP4_018_SELECT_WAITING_ROOM_LIELLA_CARD_STEP_ID,
      selectablePredicate: groupAliasIs('Liella!'),
      selectionRequiredWhenHasTargets: true,
    },
  ];

export function registerSelfSacrificeWaitingRoomToHandWorkflowHandlers(
  dependencies: SelfSacrificeWaitingRoomToHandWorkflowDependencies
): void {
  for (const config of SELF_SACRIFICE_WAITING_ROOM_TO_HAND_WORKFLOWS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startSelfSacrificeWaitingRoomToHandWorkflow(game, playerId, cardId, config, dependencies)
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishSelfSacrificeWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
    );
  }
}

function startSelfSacrificeWaitingRoomToHandWorkflow(
  game: GameState,
  playerId: string,
  cardId: string,
  config: SelfSacrificeWaitingRoomToHandWorkflowConfig,
  dependencies: SelfSacrificeWaitingRoomToHandWorkflowDependencies
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  if (activePlayerId !== playerId) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isDirectOrRenGrantedActivatedAbilitySource(
      game,
      playerId,
      cardId,
      config.abilityId,
      config.expectedBaseCardCodes
    ) ||
    !isMemberCardData(sourceCard.data)
  ) {
    return game;
  }
  const sourceSlot = findMemberSlot(player, cardId);
  if (!sourceSlot) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
  });
  const costPayment = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    state,
    player.id,
    cardId,
    dependencies.enqueueTriggeredCardEffects
  );
  if (!costPayment) {
    return game;
  }
  state = costPayment.gameState;
  state = clearPreviousStageMemberInstanceState(state, player.id, cardId);
  const movedToWaitingRoomCardIds = costPayment.movedToWaitingRoomCardIds;

  const selectableCardIds = selectWaitingRoomCardIds(state, player.id, config.selectablePredicate);
  const selectionRequired =
    config.selectionRequiredWhenHasTargets === true && selectableCardIds.length > 0;
  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: selectionRequired ? 1 : 0,
    optional: !selectionRequired,
  });

  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: config.abilityId,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: config.confirmSelectionLabel,
      metadata: {
        sourceSlot,
        movedToWaitingRoomCardIds,
      },
      zoneSelection,
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    step: 'PAY_COST',
    fromSlot: sourceSlot,
    movedToWaitingRoomCardIds,
    selectableCardIds,
  });
}

function finishSelfSacrificeWaitingRoomToHandWorkflow(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedSelections =
    Array.isArray(selectedCardIds) && selectedCardIds.length > 0 ? selectedCardIds : [];
  const selectedCardIdsToMove =
    orderedSelections.length > 0
      ? orderedSelections
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const zoneSelection = getZoneSelectionConfig(effect);
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    selectedCardIdsToMove,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: zoneSelection.minCount,
      maxCount: zoneSelection.maxCount,
    }
  );
  if (!recoveryResult) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECTED_CARD_LEFT_WAITING_ROOM',
        selectedCardId: selectedCardIdsToMove[0] ?? null,
        selectedCardIds: selectedCardIdsToMove,
        movedCardIds: [],
        activatedEnergyCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const config = SELF_SACRIFICE_WAITING_ROOM_TO_HAND_WORKFLOWS.find(
    (item) => item.abilityId === effect.abilityId
  );
  const recoveredCard =
    recoveryResult.movedCardIds.length === 1
      ? getCardById(recoveryResult.gameState, recoveryResult.movedCardIds[0])
      : null;
  let conditionMet = false;
  let conditionValue: number | null = null;
  if (config?.postRecovery?.kind === 'SUCCESS_LIVE_PRINTED_SCORE_AT_LEAST') {
    conditionValue = sumSuccessfulLiveScore(recoveryResult.gameState, player.id);
    conditionMet = successLiveScoreAtLeast(
      recoveryResult.gameState,
      player.id,
      config.postRecovery.threshold
    );
  } else if (config?.postRecovery?.kind === 'RECOVERED_AQOURS_LIVE_PRINTED_SCORE_AT_LEAST') {
    conditionValue =
      recoveredCard && isLiveCardData(recoveredCard.data) ? recoveredCard.data.score : null;
    conditionMet =
      recoveredCard !== null &&
      isLiveCardData(recoveredCard.data) &&
      groupAliasIs('Aqours')(recoveredCard) &&
      (recoveredCard.data.score ?? 0) >= config.postRecovery.threshold;
  }
  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    recoveryResult.gameState,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount =
    conditionMet && config?.postRecovery
      ? Math.min(config.postRecovery.activateCount, waitingEnergyCount)
      : 0;
  const orientationChange =
    conditionMet && activationCount > 0
      ? activateWaitingEnergyCardsForPlayer(recoveryResult.gameState, player.id, activationCount)
      : null;
  if (conditionMet && activationCount > 0 && !orientationChange) {
    return game;
  }
  const stateAfterEnergy = orientationChange?.gameState ?? recoveryResult.gameState;

  const state = {
    ...stateAfterEnergy,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config?.postRecovery?.finishStep ?? 'FINISH',
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
      publicEffectSummary: {
        effectKind: 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM',
        recoveredCardIds: recoveryResult.movedCardIds,
        noRecoveredCards: recoveryResult.movedCardIds.length === 0,
      },
      conditionValue,
      ...(config?.postRecovery?.kind === 'SUCCESS_LIVE_PRINTED_SCORE_AT_LEAST'
        ? { successLiveScore: conditionValue }
        : {}),
      conditionMet,
      activatedEnergyCardIds: orientationChange?.activatedEnergyCardIds ?? [],
      previousOrientations: orientationChange?.previousOrientations ?? [],
      nextOrientation: orientationChange?.nextOrientation ?? OrientationState.ACTIVE,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getCardAbilityBaseCardCodes(abilityId: string): readonly string[] {
  const definition = findCardAbilityDefinitionById(abilityId);
  if (!definition) {
    return [];
  }
  if (definition.baseCardCodes && definition.baseCardCodes.length > 0) {
    return definition.baseCardCodes;
  }
  return definition.cardCodes ?? [];
}
