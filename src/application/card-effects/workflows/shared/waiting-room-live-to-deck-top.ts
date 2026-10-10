import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { moveWaitingRoomCardsToDeckTopAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

/** Selection/movement segment only: trigger conditions and preceding choices stay with callers. */
export interface WaitingRoomLiveToDeckTopConfig {
  readonly abilityId: string;
  readonly groupAlias: string;
  readonly maxCount: number;
  readonly stepId: string;
  readonly stepText: string;
  readonly skipStep: string;
  readonly moveStep: string;
  readonly actionPayload?: Readonly<Record<string, unknown>>;
}

export function selectWaitingRoomLiveToDeckTopCandidates(
  game: GameState,
  playerId: string,
  groupAlias: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  const selector = and(typeIs(CardType.LIVE), groupAliasIs(groupAlias));
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === playerId && selector(card);
  });
}

export function createWaitingRoomLiveToDeckTopEffect(
  effect: ActiveEffectState,
  selectableCardIds: readonly string[],
  config: WaitingRoomLiveToDeckTopConfig
): ActiveEffectState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    controllerId: effect.controllerId,
    effectText: effect.effectText,
    stepId: config.stepId,
    stepText: config.stepText,
    awaitingPlayerId: effect.controllerId,
    selectableCardIds,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: 0,
    maxSelectableCards: Math.min(config.maxCount, selectableCardIds.length),
    canSkipSelection: true,
    skipSelectionLabel: '不放置',
    selectionLabel: '按放置顺序选择卡片',
    confirmSelectionLabel: '按此顺序放置于卡组顶',
    metadata: {
      orderedResolution: effect.metadata?.orderedResolution === true,
      sourceZone: ZoneType.WAITING_ROOM,
      destination: ZoneType.MAIN_DECK,
      publicCardSelectionConfirmation: {
        source: 'WAITING_ROOM',
        destination: 'MAIN_DECK_TOP',
        ordered: true,
        sourcePlayerId: effect.controllerId,
      },
    },
  };
}

export function finishWaitingRoomLiveToDeckTopSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  config: WaitingRoomLiveToDeckTopConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId)
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const initialCandidateCardIds = effect.selectableCardIds ?? [];
  const currentCandidateCardIds = selectWaitingRoomLiveToDeckTopCandidates(
    game,
    player.id,
    config.groupAlias
  );
  const maxCount = Math.min(config.maxCount, initialCandidateCardIds.length);
  const valid =
    selectedCardIds.length <= maxCount &&
    new Set(selectedCardIds).size === selectedCardIds.length &&
    selectedCardIds.every(
      (id) => initialCandidateCardIds.includes(id) && currentCandidateCardIds.includes(id)
    );
  if (!valid) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    if (currentCandidateCardIds.length === 0) {
      return finish(
        game,
        effect,
        config,
        continuePendingCardEffects,
        'STALE_STACK_SELECTION_NO_OP',
        {
          candidateCardIds: initialCandidateCardIds,
          selectedCardIds,
          currentCandidateCardIds,
          movedCardIds: [],
        }
      );
    }
    return addAction(
      {
        ...game,
        activeEffect: createWaitingRoomLiveToDeckTopEffect(effect, currentCandidateCardIds, config),
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'STALE_STACK_SELECTION_REFRESH',
        ...config.actionPayload,
        staleSelectedCardIds: selectedCardIds,
        currentCandidateCardIds,
      }
    );
  }
  const move = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(game, player.id, selectedCardIds, {
    candidateCardIds: initialCandidateCardIds,
    minCount: 0,
    maxCount,
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
  });
  if (!move) return game;
  return finish(
    move.gameState,
    effect,
    config,
    continuePendingCardEffects,
    selectedCardIds.length === 0 ? config.skipStep : config.moveStep,
    { candidateCardIds: initialCandidateCardIds, selectedCardIds, movedCardIds: move.movedCardIds }
  );
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  config: WaitingRoomLiveToDeckTopConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      orderedResolution: effect.metadata?.orderedResolution === true,
      ...config.actionPayload,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
