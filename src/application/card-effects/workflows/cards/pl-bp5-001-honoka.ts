import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

const SELECT_DISCARD_STEP_ID = 'PL_BP5_001_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_TOP_CARD_STEP_ID = 'PL_BP5_001_SELECT_TOP_CARD_TO_HAND';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerBp5001HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startBp5001HonokaLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishBp5001HonokaDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
    SELECT_TOP_CARD_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
  );
}

function startBp5001HonokaLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !player.liveZone.cardIds.includes(ability.sourceCardId)) {
    return consumePendingWithoutEffect(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LIVE_NOT_IN_LIVE_ZONE'
    );
  }
  if (player.hand.cardIds.length === 0) {
    return consumePendingWithoutEffect(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_HAND_TO_DISCARD'
    );
  }

  const currentLiveScore = playerCurrentLiveScore(game, player.id);
  const topCount = currentLiveScore + 2;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_DISCARD_STEP_ID,
        selectableCardIds: player.hand.cardIds,
        orderedResolution,
        stepText: `可以将1张手牌放置入休息室。如此做的话，查看自己卡组顶${topCount}张卡，将其中1张加入手牌，其余放置入休息室。`,
        selectionLabel: '请选择要放置入休息室的手牌',
        skipSelectionLabel: '不发动',
        metadata: {
          currentLiveScore,
          topCount,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      currentLiveScore,
      topCount,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishBp5001HonokaDiscardCost(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
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

  const currentLiveScore = playerCurrentLiveScore(discardResult.gameState, player.id);
  const topCount = currentLiveScore + 2;
  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
    currentLiveScore,
    topCount,
  });

  return startLookTopSelectToHandWorkflow(
    stateAfterCost,
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    {
      effectText: effect.effectText,
      topCount,
      selector: () => true,
      countRule: { minCount: 0, maxCount: 1 },
      selectionRequiredWhenHasTargets: true,
      revealSelectedBeforeHand: false,
      selectStepId: SELECT_TOP_CARD_STEP_ID,
      selectStepText: '请选择其中1张卡加入手牌。其余放置入休息室。',
      noTargetStepText: '没有可加入手牌的卡。确认后其余卡片放置入休息室。',
      selectionLabel: '请选择要加入手牌的卡牌',
      confirmSelectionLabel: '加入手牌',
      startActionPayload: {
        discardCardId,
        currentLiveScore,
        topCount,
      },
      includeInspectedCardIdsInFinishAction: true,
      publicEffectSummaryContext: {
        effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
        sourceActionLabel: 'LIVE成功',
        discardedCostCardIds: discardResult.discardedCardIds,
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: topCount,
      },
    },
    {
      orderedResolution: effect.metadata?.orderedResolution === true,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
    }
  );
}

function consumePendingWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
    }),
    orderedResolution
  );
}

function playerCurrentLiveScore(game: GameState, playerId: string): number {
  return game.liveResolution.playerScores.get(playerId) ?? 0;
}
