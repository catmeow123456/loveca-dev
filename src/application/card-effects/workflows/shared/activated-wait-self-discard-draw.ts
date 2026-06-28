import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const PR_WAIT_SELF_SELECT_DISCARD_STEP_ID = 'PR_WAIT_SELF_SELECT_DISCARD_DRAW_ONE';

type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface ActivatedWaitSelfDiscardDrawConfig {
  readonly abilityId: string;
  readonly baseCardCodes: readonly string[];
  readonly drawCount: number;
}

const ACTIVATED_WAIT_SELF_DISCARD_DRAW_CONFIGS: readonly ActivatedWaitSelfDiscardDrawConfig[] = [
  {
    abilityId: PR_WAIT_SELF_DISCARD_DRAW_ONE_ABILITY_ID,
    baseCardCodes: ['PL!-PR-012', 'PL!S-PR-038', 'PL!SP-PR-017'],
    drawCount: 1,
  },
];

export function registerActivatedWaitSelfDiscardDrawWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const config of ACTIVATED_WAIT_SELF_DISCARD_DRAW_CONFIGS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startActivatedWaitSelfDiscardDraw(game, playerId, cardId, config, deps)
    );
    registerActiveEffectStepHandler(config.abilityId, PR_WAIT_SELF_SELECT_DISCARD_STEP_ID, (game, input, context) =>
      finishActivatedWaitSelfDiscardDraw(
        game,
        input.selectedCardId ?? null,
        config,
        deps,
        context.continuePendingCardEffects
      )
    );
  }
}

function startActivatedWaitSelfDiscardDraw(
  game: GameState,
  playerId: string,
  cardId: string,
  config: ActivatedWaitSelfDiscardDrawConfig,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
  }
): GameState {
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
    !config.baseCardCodes.some((baseCode) => cardCodeMatchesBase(sourceCard.data.cardCode, baseCode)) ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, player.id, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: cardId,
    abilityId: config.abilityId,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', player.id, {
          abilityId: config.abilityId,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  const playerAfterWait = getPlayerById(stateWithMemberStateTriggers.gameState, player.id);
  const selectableCardIds = playerAfterWait?.hand.cardIds ?? [];
  if (selectableCardIds.length === 0) {
    return game;
  }

  return addAction(
    {
      ...stateWithMemberStateTriggers.gameState,
      activeEffect: {
        id: `${config.abilityId}:${cardId}:turn-${stateWithMemberStateTriggers.gameState.turnCount}:action-${stateWithMemberStateTriggers.gameState.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: PR_WAIT_SELF_SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。之后抽1张卡。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          drawCount: config.drawCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      sourceSlot,
      step: 'START_WAIT_SELF_DISCARD_DRAW',
      selectableCardIds,
      drawCount: config.drawCount,
    }
  );
}

function finishActivatedWaitSelfDiscardDraw(
  game: GameState,
  selectedCardId: string | null,
  config: ActivatedWaitSelfDiscardDrawConfig,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== PR_WAIT_SELF_SELECT_DISCARD_STEP_ID ||
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
    deps.enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterDiscardCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  const stateAfterAbilityUse = recordAbilityUseForContext(stateAfterDiscardCost, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  const drawCount =
    typeof effect.metadata?.drawCount === 'number' && effect.metadata.drawCount > 0
      ? Math.floor(effect.metadata.drawCount)
      : config.drawCount;
  const drawResult = drawCardsForPlayer(stateAfterAbilityUse, player.id, drawCount);
  const stateAfterDraw = drawResult?.gameState ?? stateAfterAbilityUse;

  const stateWithResolveAction = addAction(
    {
      ...stateAfterDraw,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'WAIT_SELF_DISCARD_DRAW',
      discardedCardId: selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      drawCount,
    }
  );
  return continuePendingCardEffects(stateWithResolveAction, false);
}
