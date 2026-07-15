import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
  SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
  SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember, drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type BladeReward =
  | { readonly kind: 'PER_DISCARD'; readonly amountPerCard: number }
  | { readonly kind: 'FIXED_TOTAL'; readonly amount: number };

interface LiveStartDiscardGainBladeConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly minDiscardCount: number;
  readonly maxDiscardCount: number;
  readonly bladeReward: BladeReward;
  readonly drawOneIfDiscardedLive: boolean;
  readonly stepText: string;
  readonly actionStep: string;
  readonly liveDiscardActionStep?: string;
}

const CONFIGS: readonly LiveStartDiscardGainBladeConfig[] = [
  {
    abilityId: SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
    stepId: 'SP_PR_LIVE_START_SELECT_DISCARD_FOR_BLADE_DRAW',
    minDiscardCount: 1,
    maxDiscardCount: 1,
    bladeReward: { kind: 'PER_DISCARD', amountPerCard: 1 },
    drawOneIfDiscardedLive: true,
    stepText: '可以将1张手牌放置入休息室。',
    actionStep: 'DISCARD_GAIN_BLADE',
    liveDiscardActionStep: 'DISCARD_LIVE_GAIN_BLADE_DRAW_ONE',
  },
  {
    abilityId: S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
    stepId: 'S_BP3_003_LIVE_START_SELECT_UP_TO_TWO_DISCARD',
    minDiscardCount: 1,
    maxDiscardCount: 2,
    bladeReward: { kind: 'PER_DISCARD', amountPerCard: 2 },
    drawOneIfDiscardedLive: false,
    stepText: '可以将至多2张手牌放置入休息室；每放置1张，此成员获得[BLADE][BLADE]。',
    actionStep: 'DISCARD_UP_TO_TWO_GAIN_TWO_BLADE_EACH',
  },
  {
    abilityId: SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID,
    stepId: 'SP_SD1_003_LIVE_START_SELECT_TWO_DISCARD',
    minDiscardCount: 2,
    maxDiscardCount: 2,
    bladeReward: { kind: 'FIXED_TOTAL', amount: 5 },
    drawOneIfDiscardedLive: false,
    stepText:
      '可以将2张手牌放置入休息室：LIVE结束时为止，获得[BLADE][BLADE][BLADE][BLADE][BLADE]。',
    actionStep: 'DISCARD_TWO_GAIN_FIVE_BLADE',
  },
] as const;

export function registerLiveStartDiscardGainBladeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startLiveStartDiscardGainBlade(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishLiveStartDiscardGainBlade(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        config,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startLiveStartDiscardGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveStartDiscardGainBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbility(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, 'SOURCE_NOT_ON_STAGE');
  }
  if (player.hand.cardIds.length < config.minDiscardCount) {
    return skipPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      player.hand.cardIds.length === 0
        ? 'NO_HAND_TO_DISCARD'
        : 'INSUFFICIENT_HAND_TO_DISCARD'
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
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: config.minDiscardCount,
      maxSelectableCards: Math.min(config.maxDiscardCount, player.hand.cardIds.length),
      selectionLabel: '选择要放置入休息室的卡',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution, sourceSlot },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, sourceSlot, step: 'START_SELECT_DISCARD', selectableCardIds: player.hand.cardIds },
  });
}

function finishLiveStartDiscardGainBlade(
  game: GameState,
  selectedCardIds: readonly string[],
  config: LiveStartDiscardGainBladeConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId) return game;
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return consumeActiveEffectNoOp(game, continuePendingCardEffects, 'SOURCE_NOT_ON_STAGE');
  }
  if (selectedCardIds.length === 0) {
    return consumeActiveEffectNoOp(game, continuePendingCardEffects, 'DECLINE_DISCARD');
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    selectedCardIds.length !== uniqueSelectedCardIds.length ||
    selectedCardIds.length < config.minDiscardCount ||
    selectedCardIds.length > config.maxDiscardCount ||
    uniqueSelectedCardIds.some((cardId) => effect.selectableCardIds?.includes(cardId) !== true || !player.hand.cardIds.includes(cardId))
  ) return game;

  const discardedLive = config.drawOneIfDiscardedLive && uniqueSelectedCardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return card ? isLiveCardData(card.data) : false;
  });
  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    { count: uniqueSelectedCardIds.length, candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  const bladeBonus =
    config.bladeReward.kind === 'FIXED_TOTAL'
      ? config.bladeReward.amount
      : discardResult.discardedCardIds.length * config.bladeReward.amountPerCard;
  const bladeResult = addBladeLiveModifierForSourceMember(discardResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: bladeBonus,
  });
  if (!bladeResult) return consumeActiveEffectNoOp(discardResult.gameState, continuePendingCardEffects, 'SOURCE_NOT_ON_STAGE');

  const drawResult = discardedLive ? drawCardsForPlayer(bladeResult.gameState, player.id, 1) : null;
  const stateAfterEffect = discardedLive && drawResult ? drawResult.gameState : bladeResult.gameState;
  return continuePendingCardEffects(
    addAction({ ...stateAfterEffect, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: discardedLive
        ? config.liveDiscardActionStep ?? `${config.actionStep}_DRAW_ONE`
        : config.actionStep,
      sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      discardedCardIds: discardResult.discardedCardIds,
      discardedLive,
      bladeBonus,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function consumeActiveEffectNoOp(game: GameState, continuePendingCardEffects: ContinuePendingCardEffects, step: string): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}
