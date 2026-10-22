import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs, type CardSelector } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  PL_BP8_012_ACTIVATED_WAIT_SELF_DISCARD_TWO_RECOVER_MUSE_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

type Enqueue = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
interface Config {
  readonly abilityId: string;
  readonly baseCardCodes: readonly string[];
  readonly discardCount: number;
  readonly selector: CardSelector;
  readonly groupLabel: string;
  readonly discardStepId: string;
  readonly recoverStepId: string;
  readonly recoverActionStep: string;
}
const CONFIGS: readonly Config[] = [
  {
    abilityId: PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!N-bp3-004'],
    discardCount: 1,
    selector: and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲')),
    groupLabel: '虹咲',
    discardStepId: 'PL_N_BP3_004_SELECT_HAND_CARD_TO_DISCARD',
    recoverStepId: 'PL_N_BP3_004_SELECT_NIJIGASAKI_LIVE_TO_RECOVER',
    recoverActionStep: 'RECOVER_NIJIGASAKI_LIVE',
  },
  {
    abilityId: PL_BP8_012_ACTIVATED_WAIT_SELF_DISCARD_TWO_RECOVER_MUSE_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!-bp8-012'],
    discardCount: 2,
    selector: and(typeIs(CardType.LIVE), groupAliasIs("μ's")),
    groupLabel: 'μ’s',
    discardStepId: 'PL_BP8_012_SELECT_TWO_HAND_CARDS_TO_DISCARD',
    recoverStepId: 'PL_BP8_012_SELECT_MUSE_LIVE_TO_RECOVER',
    recoverActionStep: 'RECOVER_MUSE_LIVE',
  },
];

export function registerActivatedWaitSelfDiscardRecoverLiveWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  for (const config of CONFIGS) {
    registerActivatedAbilityHandler(
      config.abilityId,
      (game, playerId, cardId) =>
        start(game, playerId, cardId, config, deps.enqueueTriggeredCardEffects),
      (game, playerId, cardId) => getActivationSlot(game, playerId, cardId, config) !== null
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.discardStepId,
      (game, input, context) =>
        finishDiscard(
          game,
          input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
          config,
          deps.enqueueTriggeredCardEffects,
          context.continuePendingCardEffects
        ),
      queryCardSelection
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.recoverStepId,
      (game, input, context) =>
        finishRecovery(
          game,
          input.selectedCardId ?? null,
          config,
          context.continuePendingCardEffects
        ),
      queryCardSelection
    );
  }
}

function getActivationSlot(game: GameState, playerId: string, cardId: string, config: Config) {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return null;
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  const slot = getSourceMemberSlot(game, playerId, cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !card ||
    card.ownerId !== playerId ||
    !isMemberCardData(card.data) ||
    !config.baseCardCodes.some((base) => cardCodeMatchesBase(card.data.cardCode, base)) ||
    slot === null ||
    player.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length < config.discardCount
  )
    return null;
  return slot;
}

function start(
  game: GameState,
  playerId: string,
  cardId: string,
  config: Config,
  enqueue: Enqueue
): GameState {
  const sourceSlot = getActivationSlot(game, playerId, cardId, config);
  if (sourceSlot === null) return game;
  const sourceLifecycleId = getAbilitySourceLifecycleId(game, config.abilityId, cardId);
  const wait = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: config.abilityId,
  });
  if (!wait || wait.previousOrientation !== OrientationState.ACTIVE) return game;
  const waiting = enqueueMemberStateChangedTriggersFromOrientationResult(game, wait, enqueue, {
    prepareGameStateBeforeEnqueue: (state, result, events) =>
      addAction(state, 'PAY_COST', playerId, {
        abilityId: config.abilityId,
        sourceCardId: cardId,
        sourceSlot,
        waitedMemberCardId: cardId,
        previousOrientation: result.previousOrientation,
        nextOrientation: result.nextOrientation,
        memberStateChangedEventIds: events.map((event) => event.eventId),
      }),
  });
  const player = getPlayerById(waiting.gameState, playerId)!;
  return addAction(
    {
      ...waiting.gameState,
      activeEffect: {
        id: `${config.abilityId}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        sourceLifecycleId,
        controllerId: playerId,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.discardStepId,
        stepText: `请选择${config.discardCount}张手牌放置入休息室。之后从自己的休息室将1张『${config.groupLabel}』的LIVE卡加入手牌。`,
        awaitingPlayerId: playerId,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: config.discardCount === 1 ? 'SINGLE' : 'ORDERED_MULTI',
        minSelectableCards: config.discardCount,
        maxSelectableCards: config.discardCount,
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          memberStateChangedEventIds: waiting.memberStateChangedEvents.map(
            (event) => event.eventId
          ),
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    { abilityId: config.abilityId, sourceCardId: cardId, sourceSlot, step: 'START_DISCARD_COST' }
  );
}

function finishDiscard(
  game: GameState,
  selectedIds: readonly string[],
  config: Config,
  enqueue: Enqueue,
  next: Continue
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.discardStepId ||
    !player ||
    selectedIds.length !== config.discardCount ||
    new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some(
      (id) => !effect.selectableCardIds?.includes(id) || !player.hand.cardIds.includes(id)
    )
  )
    return game;
  const discarded = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedIds,
    { count: config.discardCount, candidateCardIds: effect.selectableCardIds ?? [] },
    enqueue
  );
  if (!discarded) return game;
  const paid = recordAbilityUseForContext(
    addAction(discarded.gameState, 'PAY_COST', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      discardedCardId: selectedIds[0],
      discardedCardIds: discarded.discardedCardIds,
      enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId ?? null,
    }),
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceLifecycleId: effect.sourceLifecycleId,
    }
  );
  const candidates = selectWaitingRoomCardIds(paid, player.id, config.selector);
  if (candidates.length === 0)
    return next(
      addAction({ ...paid, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot ?? null,
        step: 'PAID_COST_NO_TARGET',
        waitedMemberCardId: effect.sourceCardId,
        discardedCardIds: discarded.discardedCardIds,
        recoveredCardIds: [],
        memberStateChangedEventIds: effect.metadata?.memberStateChangedEventIds,
        enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId ?? null,
      }),
      false
    );
  return addAction(
    {
      ...paid,
      activeEffect: {
        ...createWaitingRoomToHandEffectState({
          id: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          controllerId: player.id,
          effectText: effect.effectText,
          stepId: config.recoverStepId,
          stepText: `请选择自己休息室中1张『${config.groupLabel}』的LIVE卡加入手牌。`,
          awaitingPlayerId: player.id,
          selectableCardIds: candidates,
          selectionLabel: `选择要加入手牌的『${config.groupLabel}』LIVE卡`,
          confirmSelectionLabel: '加入手牌',
          canSkipSelection: false,
          metadata: {
            ...effect.metadata,
            discardedCardIds: discarded.discardedCardIds,
            enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId ?? null,
          },
          zoneSelection: createWaitingRoomToHandSelectionConfig({
            minCount: 1,
            maxCount: 1,
            optional: false,
          }),
        }),
        sourceLifecycleId: effect.sourceLifecycleId,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_RECOVERY',
      discardedCardIds: discarded.discardedCardIds,
      selectableCardIds: candidates,
    }
  );
}

function finishRecovery(
  game: GameState,
  selectedId: string | null,
  config: Config,
  next: Continue
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.recoverStepId ||
    !player ||
    !selectedId ||
    !effect.selectableCardIds?.includes(selectedId)
  )
    return game;
  const candidates = selectWaitingRoomCardIds(game, player.id, config.selector);
  const recovered = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedId], {
    candidateCardIds: (effect.selectableCardIds ?? []).filter((id) => candidates.includes(id)),
    exactCount: 1,
  });
  if (!recovered && !wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
  return next(
    addAction(
      { ...(recovered?.gameState ?? game), activeEffect: null },
      'RESOLVE_ABILITY',
      player.id,
      {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot ?? null,
        step: recovered ? config.recoverActionStep : 'SELECTED_CARD_LEFT_WAITING_ROOM',
        waitedMemberCardId: effect.sourceCardId,
        discardedCardIds: effect.metadata?.discardedCardIds,
        recoveredCardIds: recovered?.movedCardIds ?? [],
        memberStateChangedEventIds: effect.metadata?.memberStateChangedEventIds,
        enterWaitingRoomEventId: effect.metadata?.enterWaitingRoomEventId ?? null,
      }
    ),
    false
  );
}
