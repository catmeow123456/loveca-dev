import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { GamePhase, HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import { stackEnergyFromEnergyZoneBelowMember } from '../../../effects/energy-below.js';
import {
  N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID,
  N_BP5_012_LIVE_SUCCESS_LEADING_SCORE_PLACE_WAITING_ENERGY_BY_BELOW_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5012LanzhuWorkflowHandlers(): void {
  registerActivatedAbilityHandler(
    N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID,
    startLanzhuActivatedStackEnergyDrawHeart
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_012_LIVE_SUCCESS_LEADING_SCORE_PLACE_WAITING_ENERGY_BY_BELOW_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLanzhuLiveSuccessEnergyPlacement(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      ),
    getLanzhuLiveSuccessConfirmationConfig
  );
}

function startLanzhuActivatedStackEnergyDrawHeart(
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
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp5-012') ||
    sourceSlot === null ||
    player.energyZone.cardIds.length === 0
  ) {
    return game;
  }

  const stackResult = stackEnergyFromEnergyZoneBelowMember(game, player.id, sourceSlot, 1);
  if (!stackResult) {
    return game;
  }

  let state = recordPayCostAction(stackResult.gameState, player.id, {
    abilityId: N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    costType: 'STACK_ENERGY_BELOW',
    energyCardId: stackResult.stackedEnergyCardIds[0] ?? null,
    stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID,
    sourceCardId: cardId,
  });

  const drawResult = drawCardsForPlayer(state, player.id, 1);
  if (!drawResult) {
    return game;
  }
  const heartResult = addHeartLiveModifierForMember(drawResult.gameState, {
    playerId: player.id,
    memberCardId: cardId,
    sourceCardId: cardId,
    abilityId: N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID,
    hearts: [{ color: HeartColor.PINK, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
    abilityId: N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    step: 'STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART',
    stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
    drawnCardIds: drawResult.drawnCardIds,
    heartBonus: heartResult.heartBonus,
  });
}

function getLanzhuLiveSuccessConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const context = getLanzhuLiveSuccessContext(game, ability);
  const previewText = getLanzhuLiveSuccessPreviewText(context);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: previewText,
  };
}

function resolveLanzhuLiveSuccessEnergyPlacement(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getLanzhuLiveSuccessContext(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let placedEnergyCardIds: readonly string[] = [];

  if (context.conditionMet && context.requestedEnergyCount > 0) {
    const placementResult = placeEnergyFromDeckToZone(
      state,
      player.id,
      context.requestedEnergyCount,
      OrientationState.WAITING
    );
    if (!placementResult) {
      return game;
    }
    state = placementResult.gameState;
    placedEnergyCardIds = placementResult.placedEnergyCardIds;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: context.conditionMet ? 'PLACE_WAITING_ENERGY_BY_ENERGY_BELOW' : context.noOpStep,
      sourceOnStage: context.sourceOnStage,
      ownScore: context.ownScore,
      opponentScore: context.opponentScore,
      energyBelowCount: context.energyBelowCount,
      requestedEnergyCount: context.requestedEnergyCount,
      availableEnergyCount: context.availableEnergyCount,
      placedEnergyCardIds,
    }),
    options.orderedResolution === true
  );
}

function getLanzhuLiveSuccessContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceSlot: ReturnType<typeof getSourceMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly scoreLeading: boolean;
  readonly energyBelowCount: number;
  readonly requestedEnergyCount: number;
  readonly availableEnergyCount: number;
  readonly actualPlacementCount: number;
  readonly conditionMet: boolean;
  readonly noOpStep: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  const sourceOnStage = sourceSlot !== null;
  const ownScore = game.liveResolution.playerScores.get(ability.controllerId) ?? 0;
  const opponentScore = opponent ? game.liveResolution.playerScores.get(opponent.id) ?? 0 : 0;
  const scoreLeading = ownScore > opponentScore;
  const energyBelowCount =
    player && sourceSlot !== null ? (player.memberSlots.energyBelow[sourceSlot] ?? []).length : 0;
  const conditionMet = sourceOnStage && scoreLeading;
  const requestedEnergyCount = conditionMet ? energyBelowCount + 1 : 0;
  const availableEnergyCount = player
    ? Math.min(requestedEnergyCount, player.energyDeck.cardIds.length)
    : 0;
  const noOpStep = !sourceOnStage
    ? 'SOURCE_NOT_ON_STAGE'
    : scoreLeading
      ? 'NO_ENERGY_TO_PLACE'
      : 'SCORE_NOT_LEADING';

  return {
    sourceSlot,
    sourceOnStage,
    ownScore,
    opponentScore,
    scoreLeading,
    energyBelowCount,
    requestedEnergyCount,
    availableEnergyCount,
    actualPlacementCount: availableEnergyCount,
    conditionMet,
    noOpStep,
  };
}

function getLanzhuLiveSuccessPreviewText(
  context: ReturnType<typeof getLanzhuLiveSuccessContext>
): string {
  if (!context.sourceOnStage) {
    return '此成员已不在舞台，不放置能量。';
  }
  if (!context.scoreLeading) {
    return `当前LIVE合计分数为${context.ownScore}对${context.opponentScore}，自己没有领先，不放置能量。`;
  }
  if (context.availableEnergyCount === 0) {
    return `当前LIVE合计分数为${context.ownScore}对${context.opponentScore}，自己分数更高；此成员下方有${context.energyBelowCount}张能量，但能量卡组没有可放置的能量，不放置能量。`;
  }
  if (context.availableEnergyCount < context.requestedEnergyCount) {
    return `当前LIVE合计分数为${context.ownScore}对${context.opponentScore}，自己分数更高；此成员下方有${context.energyBelowCount}张能量。能量卡组只剩${context.availableEnergyCount}张，放置${context.availableEnergyCount}张待机状态能量。`;
  }
  return `当前LIVE合计分数为${context.ownScore}对${context.opponentScore}，自己分数更高；此成员下方有${context.energyBelowCount}张能量。放置${context.actualPlacementCount}张待机状态能量。`;
}
