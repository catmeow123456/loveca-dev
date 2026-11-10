import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { drawCardsFromMainDeckToHand } from '../../../effects/draw.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { SP_AD1_001_LIVE_START_DISCARD_RECOVER_LIVE_OR_DRAW_AND_SEVENTH_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { hasWaitingRoomSelectionReenteredAfter } from '../../../effects/waiting-room-selection-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  registerActiveEffectStepHandler,
  type ActiveEffectStepHandlerInput,
} from '../../runtime/step-registry.js';
import {
  getWaitingRoomCardsMovedToMainDeckEventsFromLog,
  moveWaitingRoomCardToDeckPositionAndEnqueueTriggers,
} from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const SELECT_DISCARD = 'SP_AD1_001_SELECT_HAND_TO_WAITING_ROOM';
const SELECT_LIVE = 'SP_AD1_001_SELECT_WAITING_ROOM_LIVE';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpAd1001KanonWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const player = getPlayerById(game, ability.controllerId);
    const source = getCardById(game, ability.sourceCardId);
    if (
      !player ||
      !source ||
      source.ownerId !== player.id ||
      !isMemberCardData(source.data) ||
      !cardCodeMatchesBase(source.data.cardCode, 'PL!SP-ad1-001')
    ) {
      return context.continuePendingCardEffects(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter(({ id }) => id !== ability.id),
        },
        options.orderedResolution === true
      );
    }
    if (player.hand.cardIds.length === 0) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(ABILITY_ID)}（当前没有手牌，本次不放置卡片。）`,
        stepText: '确认后结算此效果。',
      });
      if (confirmation) return confirmation;
      return context.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter(({ id }) => id !== ability.id),
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY_ID,
            sourceCardId: ability.sourceCardId,
            step: 'NO_HAND_CARD',
          }
        ),
        options.orderedResolution === true
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: player.id,
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: SELECT_DISCARD,
        stepText: '请选择1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        autoSubmitSingleSelection: true,
        selectionLabel: '选择放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: { orderedResolution: options.orderedResolution === true },
      },
      actionPayload: { sourceCardId: ability.sourceCardId, step: 'SELECT_HAND_TO_WAITING_ROOM' },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_DISCARD,
    (game, input, context) =>
      discardAndResolve(
        game,
        input,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_LIVE,
    (game, input, context) => recoverLive(game, input, context.continuePendingCardEffects),
    queryCardSelection
  );
}

function selectedSingleCard(input: ActiveEffectStepHandlerInput): string | null {
  // A mandatory exact-one choice must not silently accept a multi-selection or skip.
  return input.selectedCardIds === undefined && typeof input.selectedCardId === 'string'
    ? input.selectedCardId
    : null;
}

function discardAndResolve(
  game: GameState,
  input: ActiveEffectStepHandlerInput,
  continuePending: Continue,
  enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const selectedCardId = selectedSingleCard(input);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const card = selectedCardId ? getCardById(game, selectedCardId) : null;
  if (
    !effect ||
    !player ||
    !selectedCardId ||
    !card ||
    card.ownerId !== player.id ||
    !effect.selectableCardIds?.includes(selectedCardId) ||
    !player.hand.cardIds.includes(selectedCardId)
  )
    return game;
  const discard = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueue
  );
  if (!discard || discard.discardedCardIds.length !== 1) return game;
  const state = addAction(discard.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'DISCARD_HAND_BY_EFFECT',
    discardedCardIds: discard.discardedCardIds,
  });
  if (isMemberCardData(card.data)) {
    const ids = liveCandidates(state, player.id);
    if (ids.length === 0) return finish(state, effect, continuePending, 'NO_LIVE_TO_RECOVER');
    return {
      ...state,
      activeEffect: {
        ...createWaitingRoomToHandEffectState({
          id: effect.id,
          abilityId: ABILITY_ID,
          sourceCardId: effect.sourceCardId,
          controllerId: player.id,
          effectText: effect.effectText,
          stepId: SELECT_LIVE,
          awaitingPlayerId: player.id,
          selectableCardIds: ids,
          stepText: '请选择自己休息室中的1张LIVE卡加入手牌。',
          selectionLabel: '选择加入手牌的LIVE卡',
          confirmSelectionLabel: '加入手牌',
          canSkipSelection: false,
          metadata: { ...effect.metadata, waitingSelectionSequence: state.eventSequence },
          zoneSelection: createWaitingRoomToHandSelectionConfig({
            minCount: 1,
            maxCount: 1,
            optional: false,
          }),
        }),
        autoSubmitSingleSelection: true,
      },
    };
  }
  if (!isLiveCardData(card.data))
    return finish(state, effect, continuePending, 'DISCARD_OTHER_CARD');
  const afterDiscardEventIndex = state.eventLog.length;
  const draw = drawCardsFromMainDeckToHand(state, player.id, 1);
  const drawnState = draw?.gameState ?? state;
  // The draw is atomic. A refresh can move this exact card out and even return it
  // to the waiting room as its penalty; that new rules object is not the discard.
  const leftWaitingRoom = getWaitingRoomCardsMovedToMainDeckEventsFromLog(
    drawnState,
    afterDiscardEventIndex
  ).some((event) => event.playerId === player.id && event.movedCardIds.includes(selectedCardId));
  const placement = leftWaitingRoom
    ? null
    : moveWaitingRoomCardToDeckPositionAndEnqueueTriggers(drawnState, player.id, selectedCardId, {
        candidateCardIds: [selectedCardId],
        positionFromTop: 7,
        cause: {
          kind: 'CARD_EFFECT',
          playerId: player.id,
          sourceCardId: effect.sourceCardId,
          abilityId: ABILITY_ID,
          pendingAbilityId: effect.id,
        },
      });
  return finish(
    placement?.gameState ?? drawnState,
    effect,
    continuePending,
    'DRAW_AND_PLACE_ORIGINAL_DISCARD_SEVENTH',
    {
      drawnCardIds: draw?.drawnCardIds ?? [],
      discardedCardId: selectedCardId,
      movedCardId: placement?.movedCardId ?? null,
      positionFromTop: 7,
      insertIndex: placement?.insertIndex ?? null,
      discardedCardLeftWaitingRoom: leftWaitingRoom,
    }
  );
}

function recoverLive(
  game: GameState,
  input: ActiveEffectStepHandlerInput,
  continuePending: Continue
): GameState {
  const effect = game.activeEffect;
  const selectedCardId = selectedSingleCard(input);
  if (!effect) return game;
  const currentCandidateCardIds = liveCandidates(game, effect.controllerId).filter(
    (id) =>
      effect.selectableCardIds?.includes(id) &&
      !hasWaitingRoomSelectionReenteredAfter(game, [id], effect.metadata?.waitingSelectionSequence)
  );
  if (currentCandidateCardIds.length === 0)
    return finish(game, effect, continuePending, 'NO_REMAINING_LIVE_TO_RECOVER');
  if (!selectedCardId || !effect.selectableCardIds?.includes(selectedCardId)) return game;
  return finishWaitingRoomToHandWorkflow(game, selectedCardId, undefined, continuePending, {
    currentCandidateCardIds,
    trackWaitingRoomTargetLifecycle: true,
  });
}

function liveCandidates(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, (card) => isLiveCardData(card.data));
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  continuePending: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePending(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
