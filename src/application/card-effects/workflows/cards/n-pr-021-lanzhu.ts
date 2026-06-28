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
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import { N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID } from '../../ability-ids.js';
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
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const N_PR_021_SELECT_DISCARD_STEP_ID = 'N_PR_021_SELECT_DISCARD_FOR_REVEALED_CHEER';
const N_PR_021_SELECT_REVEALED_CHEER_STEP_ID =
  'N_PR_021_SELECT_LOW_COST_OR_SCORE_REVEALED_CHEER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPr021LanzhuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    (game, ability, options, context) =>
      startNPr021LanzhuLiveSuccess(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    N_PR_021_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishNPr021LanzhuDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_HAND_CARD',
          })
  );
  registerActiveEffectStepHandler(
    N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID,
    N_PR_021_SELECT_REVEALED_CHEER_STEP_ID,
    (game, input, context) =>
      finishNPr021LanzhuRecoverRevealedCheer(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startNPr021LanzhuLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (!player || sourceSlot === null) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
    if (manualConfirmation) {
      return manualConfirmation;
    }
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }
  if (player.hand.cardIds.length === 0) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
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
      effectText: getAbilityEffectText(
        N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID
      ),
      stepId: N_PR_021_SELECT_DISCARD_STEP_ID,
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

function finishNPr021LanzhuDiscardCost(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID ||
    effect.stepId !== N_PR_021_SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null || !player.hand.cardIds.includes(discardCardId)) {
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
  const selectableCardIds = selectNPr021RevealedCheerCardIds(discardResult.gameState, player.id);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        { ...discardResult.gameState, activeEffect: null },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'DISCARD_HAND_CARD_NO_REVEALED_CHEER_TARGET',
          sourceSlot,
          discardedCardId,
          selectedCardId: null,
          movedCardIds: [],
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: N_PR_021_SELECT_REVEALED_CHEER_STEP_ID,
        stepText:
          '请选择1张因声援公开的自己的费用2以下成员卡或分数2以下LIVE卡加入手牌。',
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

function finishNPr021LanzhuRecoverRevealedCheer(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      N_PR_021_LIVE_SUCCESS_DISCARD_RECOVER_LOW_COST_OR_SCORE_REVEALED_CHEER_ABILITY_ID ||
    effect.stepId !== N_PR_021_SELECT_REVEALED_CHEER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
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

function selectNPr021RevealedCheerCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, isLowCostMemberOrLowScoreLive);
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
