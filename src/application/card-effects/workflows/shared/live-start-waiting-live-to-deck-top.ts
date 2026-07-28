import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  maybeStartConfirmablePendingAbilityConfirmation,
  getAbilityEffectText,
} from '../../runtime/workflow-helpers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckTopAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';

const SELECT_WAITING_LIVE_STEP_ID = 'PR_SELECT_WAITING_LIVE_TO_DECK_TOP';
const MAX_LIVE_CARDS = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface WaitingLiveContext {
  readonly waitingRoomCount: number;
  readonly selectableCardIds: readonly string[];
  readonly conditionMet: boolean;
}

export function registerLiveStartWaitingLiveToDeckTopWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStartWaitingLiveToDeckTop(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID,
    SELECT_WAITING_LIVE_STEP_ID,
    (game, input, context) =>
      input.selectedCardIds
        ? finishLiveStartWaitingLiveToDeckTop(
            game,
            input.selectedCardIds,
            context.continuePendingCardEffects
          )
        : input.selectedCardId
          ? finishLiveStartWaitingLiveToDeckTop(
              game,
              [input.selectedCardId],
              context.continuePendingCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
              step: 'SKIP_WAITING_LIVE_TO_DECK_TOP',
            })
  );
}

function startLiveStartWaitingLiveToDeckTop(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution?: boolean;
    readonly manualConfirmation?: boolean;
    readonly confirmBeforeResolution?: boolean;
    readonly skipManualConfirmation?: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const current = getWaitingLiveContext(game, player.id);
  if (!current.conditionMet || current.selectableCardIds.length === 0) {
    const confirmation =
      options.orderedResolution === true
        ? null
        : maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
            effectText: getNoOpConfirmationEffectText(ability.abilityId, current),
            stepText: current.conditionMet
              ? '自己的休息室中没有LIVE卡，确认后不放置卡片。'
              : `自己的休息室有${current.waitingRoomCount}张卡，条件未满足，确认后不放置卡片。`,
          });
    return (
      confirmation ??
      resolveNoOp(
        game,
        ability,
        current,
        options.orderedResolution === true,
        continuePendingCardEffects
      )
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
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_WAITING_LIVE_STEP_ID,
      stepText: '请选择自己休息室中至多3张LIVE卡，按放置顺序选择。也可以不放置。',
      awaitingPlayerId: player.id,
      selectableCardIds: current.selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(MAX_LIVE_CARDS, current.selectableCardIds.length),
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_TOP',
          ordered: true,
        },
        orderedResolution: options.orderedResolution === true,
        waitingRoomCountAtSelection: current.waitingRoomCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_WAITING_LIVE_TO_DECK_TOP',
      waitingRoomCount: current.waitingRoomCount,
      selectableCardIds: current.selectableCardIds,
      maxSelectableCards: Math.min(MAX_LIVE_CARDS, current.selectableCardIds.length),
    },
  });
}

function finishLiveStartWaitingLiveToDeckTop(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_LIVE_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > (effect.maxSelectableCards ?? MAX_LIVE_CARDS) ||
    uniqueSelectedCardIds.some((cardId) => effect.selectableCardIds?.includes(cardId) !== true)
  ) {
    return game;
  }
  if (uniqueSelectedCardIds.length === 0) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects, {
      step: 'SKIP_WAITING_LIVE_TO_DECK_TOP',
    });
  }

  const current = getWaitingLiveContext(game, player.id);
  const stale =
    !current.conditionMet ||
    uniqueSelectedCardIds.some((cardId) => !current.selectableCardIds.includes(cardId));
  if (stale) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishRestoredStaleSelection(
          game,
          effect,
          current,
          uniqueSelectedCardIds,
          continuePendingCardEffects
        )
      : game;
  }

  const moveResult = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      candidateCardIds: current.selectableCardIds,
      minCount: 0,
      maxCount: MAX_LIVE_CARDS,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moveResult) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishRestoredStaleSelection(
          game,
          effect,
          current,
          uniqueSelectedCardIds,
          continuePendingCardEffects
        )
      : game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_WAITING_LIVE_TO_DECK_TOP',
      waitingRoomCountAtResolution: current.waitingRoomCount,
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishRestoredStaleSelection(
  game: GameState,
  effect: ActiveEffectState,
  current: WaitingLiveContext,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RESTORED_SELECTION_STALE_NO_OP',
      waitingRoomCountAtResolution: current.waitingRoomCount,
      conditionMet: current.conditionMet,
      selectedCardIds,
      currentSelectableCardIds: current.selectableCardIds,
      movedCardIds: [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveNoOp(
  game: GameState,
  ability: PendingAbilityState,
  current: WaitingLiveContext,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
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
      step: current.conditionMet
        ? 'NO_WAITING_LIVE_TARGET'
        : 'WAITING_ROOM_COUNT_CONDITION_NOT_MET',
      waitingRoomCount: current.waitingRoomCount,
      conditionMet: current.conditionMet,
      selectableCardIds: current.selectableCardIds,
      movedCardIds: [],
    }),
    orderedResolution
  );
}

function getNoOpConfirmationEffectText(abilityId: string, current: WaitingLiveContext): string {
  const result = current.conditionMet
    ? '条件满足，但休息室中没有LIVE卡，实际不放置卡片'
    : `当前休息室${current.waitingRoomCount}张，条件未满足，实际不放置卡片`;
  return `${getAbilityEffectText(abilityId)}（${result}。）`;
}

function getWaitingLiveContext(game: GameState, playerId: string): WaitingLiveContext {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { waitingRoomCount: 0, selectableCardIds: [], conditionMet: false };
  }
  const selectableCardIds = player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === player.id && isLiveCardData(card.data);
  });
  return {
    waitingRoomCount: player.waitingRoom.cardIds.length,
    selectableCardIds,
    conditionMet: player.waitingRoom.cardIds.length <= 9,
  };
}
