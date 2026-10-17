import {
  isLiveCardData,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { groupAliasIs, type CardSelector } from '../../../effects/card-selectors.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import {
  N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
  SP_PR_016_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
  PL_BP8_008_LIVE_SUCCESS_DISCARD_RECOVER_MUSE_CHEER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID =
  'LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_CHEER_SELECT_DISCARD';
const SELECT_REVEALED_CHEER_STEP_ID =
  'LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_CHEER_SELECT_REVEALED_CHEER';

interface DiscardRecoverCheerConfig {
  readonly abilityId: string;
  readonly recoveryPredicate: CardSelector;
  readonly recoveryStepText: string;
}
const DISCARD_RECOVER_CHEER_CONFIGS: readonly DiscardRecoverCheerConfig[] = [
  ...[
    N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    SP_PR_016_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
  ].map((abilityId) => ({
    abilityId,
    recoveryPredicate: isLowCostMemberOrLowScoreLive,
    recoveryStepText: '请选择1张因声援公开的自己的费用2以下成员卡或分数2以下LIVE卡加入手牌。',
  })),
  {
    abilityId: PL_BP8_008_LIVE_SUCCESS_DISCARD_RECOVER_MUSE_CHEER_ABILITY_ID,
    recoveryPredicate: groupAliasIs("μ's"),
    recoveryStepText: '请选择1张因声援被公开的自己的『μ’s』卡片加入手牌。',
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLiveSuccessDiscardRecoverCheerWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of DISCARD_RECOVER_CHEER_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startLiveSuccessDiscardRecoverCheer(
        game,
        ability,
        config,
        options,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_DISCARD_STEP_ID,
      (game, input, context) =>
        input.selectedCardId
          ? finishDiscardCost(
              game,
              input.selectedCardId,
              config,
              context.continuePendingCardEffects,
              deps.enqueueTriggeredCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
              step: 'DECLINE_DISCARD_HAND_CARD',
            }),
      queryCardSelection
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_REVEALED_CHEER_STEP_ID,
      (game, input, context) =>
        finishRecoverRevealedCheer(
          game,
          input.selectedCardId ?? null,
          config,
          context.continuePendingCardEffects
        ),
      queryCardSelection
    );
  }
}

function startLiveSuccessDiscardRecoverCheer(
  game: GameState,
  ability: PendingAbilityState,
  config: DiscardRecoverCheerConfig,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player) {
    const manualConfirmation = maybeStartConfirmablePendingAbilityConfirmation(
      game,
      ability,
      options
    );
    if (manualConfirmation) {
      return manualConfirmation;
    }
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'PLAYER_NOT_FOUND'
    );
  }
  if (player.hand.cardIds.length === 0) {
    const manualConfirmation = maybeStartConfirmablePendingAbilityConfirmation(
      game,
      ability,
      options,
      {
        stepText: '没有可用于支付费用的手牌，不执行后续回收。',
      }
    );
    if (manualConfirmation) {
      return manualConfirmation;
    }
    return skipPendingAbility(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'NO_HAND_TO_DISCARD'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution: options.orderedResolution === true,
      metadata: {
        sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishDiscardCost(
  game: GameState,
  discardCardId: string,
  config: DiscardRecoverCheerConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
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

  const discardedCardId = discardResult.discardedCardIds[0] ?? discardCardId;
  const selectableCardIds = selectRevealedCheerCardIds(
    discardResult.gameState,
    player.id,
    config.recoveryPredicate
  );
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_HAND_CARD_NO_REVEALED_CHEER_TARGET',
        sourceSlot,
        discardedCardId,
        selectedCardId: null,
        movedCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_REVEALED_CHEER_STEP_ID,
        stepText: config.recoveryStepText,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要加入手牌的声援公开卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          sourceSlot,
          discardedCardId,
          publicCardSelectionConfirmation: {
            source: 'REVEALED_CHEER',
            destination: 'HAND',
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_START_SELECT_REVEALED_CHEER',
      sourceSlot,
      discardedCardId,
      selectableCardIds,
    }
  );
}

function finishRecoverRevealedCheer(
  game: GameState,
  selectedCardId: string | null,
  config: DiscardRecoverCheerConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== SELECT_REVEALED_CHEER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (
    !selectRevealedCheerCardIds(game, player.id, config.recoveryPredicate).includes(selectedCardId)
  ) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECTED_CHEER_CARD_NO_LONGER_ELIGIBLE',
        selectedCardId,
        movedCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  const moveResult = moveRevealedCheerCards(game, player.id, [selectedCardId], 'HAND');
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_MOVE_REVEALED_CHEER_TO_HAND',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId,
      selectedCardId,
      movedCardIds: moveResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isLowCostMemberOrLowScoreLive(card: CardInstance): boolean {
  if (isMemberCardData(card.data)) {
    return card.data.cost <= 2;
  }
  if (isLiveCardData(card.data)) {
    return card.data.score <= 2;
  }
  return false;
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
        sourceSlot: ability.sourceSlot,
        step,
      }
    ),
    orderedResolution
  );
}
