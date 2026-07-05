import { isLiveCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const SELECT_LOW_SCORE_LIELLA_LIVE_STEP_ID =
  'SP_BP4_007_SELECT_LOW_SCORE_LIELLA_LIVE_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp4007MeiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp4007MeiOnMoveRecovery(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID,
    SELECT_LOW_SCORE_LIELLA_LIVE_STEP_ID,
    (game, input, context) =>
      finishSpBp4007MeiOnMoveRecovery(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpBp4007MeiOnMoveRecovery(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(
    game,
    player.id,
    isLowScoreLiellaLiveCard
  );
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_VALID_LOW_SCORE_LIELLA_LIVE',
        sourceSlot: ability.sourceSlot,
        fromSlot: ability.metadata?.fromSlot,
        toSlot: ability.metadata?.toSlot,
        swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
        selectableCardIds,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_LOW_SCORE_LIELLA_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张[スコア]3以下的『Liella!』LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          orderedResolution,
          sourceSlot: ability.sourceSlot,
          fromSlot: ability.metadata?.fromSlot,
          toSlot: ability.metadata?.toSlot,
          swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LOW_SCORE_LIELLA_LIVE',
      sourceSlot: ability.sourceSlot,
      fromSlot: ability.metadata?.fromSlot,
      toSlot: ability.metadata?.toSlot,
      swappedCardInstanceId: ability.metadata?.swappedCardInstanceId,
      selectableCardIds,
    }
  );
}

function finishSpBp4007MeiOnMoveRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_LOW_SCORE_LIELLA_LIVE_STEP_ID ||
    selectedCardId === null
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const stateAfterUseRecord = recordAbilityUseForContext(recoveryResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  const state: GameState = {
    ...stateAfterUseRecord,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_LOW_SCORE_LIELLA_LIVE',
      sourceSlot: effect.metadata?.sourceSlot,
      fromSlot: effect.metadata?.fromSlot,
      toSlot: effect.metadata?.toSlot,
      swappedCardInstanceId: effect.metadata?.swappedCardInstanceId,
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isLowScoreLiellaLiveCard(card: CardInstance): boolean {
  return (
    isLiveCardData(card.data) &&
    groupAliasIs('Liella!')(card) &&
    card.data.score <= 3
  );
}
