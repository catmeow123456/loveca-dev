import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardNameIs, groupAliasIs } from '../../../effects/card-selectors.js';
import { S_CL1_012_LIVE_START_STACK_SAME_NAME_SUCCESS_AQOURS_LIVES_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  hasDistinctGroupedCardAssignment,
  readExclusiveCardSelectionInput,
  type DistinctCardSelectionGroup,
} from '../../runtime/grouped-selection.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckTopAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = S_CL1_012_LIVE_START_STACK_SAME_NAME_SUCCESS_AQOURS_LIVES_ABILITY_ID;
const STEP_ID = 'S_CL1_012_SELECT_SAME_NAME_SUCCESS_LIVES_TO_DECK_TOP';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSCl1012KisekiHikaruWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, STEP_ID, (game, input, context) => {
    const selected = readExclusiveCardSelectionInput(input);
    return selected === null ? game : finish(game, selected, context.continuePendingCardEffects);
  });
}

/** Each successful LIVE instance supplies its own optional slot, including duplicate names. */
function getGroups(game: GameState, playerId: string): readonly DistinctCardSelectionGroup[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return player.successZone.cardIds.flatMap((successId) => {
    const success = getCardById(game, successId);
    if (
      !success ||
      success.ownerId !== playerId ||
      !isLiveCardData(success.data) ||
      !groupAliasIs('Aqours')(success) ||
      !success.data.name.trim()
    )
      return [];
    const sameName = cardNameIs(success.data.name);
    return [
      {
        candidateCardIds: player.waitingRoom.cardIds.filter((cardId) => {
          const card = getCardById(game, cardId);
          return (
            card !== null &&
            card.ownerId === playerId &&
            isLiveCardData(card.data) &&
            sameName(card)
          );
        }),
        minCount: 0,
        maxCount: 1,
      },
    ];
  });
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  next: Continue
): GameState {
  const ordered = options.orderedResolution === true;
  const groups = getGroups(game, ability.controllerId);
  const candidates = [...new Set(groups.flatMap((group) => group.candidateCardIds))];
  if (candidates.length === 0) {
    return (
      (ordered
        ? null
        : maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
            effectText: `${getAbilityEffectText(ABILITY_ID)}（当前成功LIVE卡区有${groups.length}张『Aqours』LIVE卡，自己休息室没有符合配额的同名LIVE卡，不放置卡片。）`,
            stepText: '没有可放置于卡组顶的同名LIVE卡，确认后结束此效果。',
          })) ?? complete(game, ability, ordered, next, 'NO_SAME_NAME_WAITING_LIVE')
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: ability.sourceLifecycleId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: STEP_ID,
      stepText:
        '对于自己成功LIVE卡区的每张『Aqours』LIVE卡，可以从自己休息室分别选择至多1张同名LIVE卡。按放置于卡组顶的顺序选择。',
      awaitingPlayerId: ability.controllerId,
      selectableCardIds: candidates,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(groups.length, candidates.length),
      selectionLabel: '按放置顺序选择同名LIVE卡',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        orderedResolution: ordered,
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_TOP',
          ordered: true,
          sourcePlayerId: ability.controllerId,
          distinctGroupAssignment: true,
          groups,
        },
      },
    },
    actionPayload: {
      step: 'START_SELECT_SAME_NAME_SUCCESS_LIVES',
      candidateCardIds: candidates,
      successfulLiveCount: groups.length,
    },
  });
}

function finish(game: GameState, selected: readonly string[], next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== STEP_ID) return game;
  const ordered = effect.metadata?.orderedResolution === true;
  if (
    new Set(selected).size !== selected.length ||
    selected.length > (effect.maxSelectableCards ?? 0) ||
    selected.some((id) => !effect.selectableCardIds?.includes(id))
  )
    return game;
  if (selected.length === 0)
    return complete(game, effect, ordered, next, 'DECLINE_STACK_SAME_NAME_LIVES');
  const groups = getGroups(game, effect.controllerId);
  if (!hasDistinctGroupedCardAssignment(selected, groups)) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? complete(game, effect, ordered, next, 'STALE_SAME_NAME_LIVE_SELECTION')
      : game;
  }
  const moved = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(
    { ...game, activeEffect: null },
    effect.controllerId,
    selected,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: 0,
      maxCount: effect.maxSelectableCards ?? groups.length,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moved)
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? complete(game, effect, ordered, next, 'STALE_SAME_NAME_LIVE_SELECTION')
      : game;
  return complete(moved.gameState, effect, ordered, next, 'STACK_SAME_NAME_SUCCESS_LIVES', {
    selectedCardIds: selected,
    movedCardIds: moved.movedCardIds,
  });
}

function complete(
  game: GameState,
  source: PendingAbilityState | ActiveEffectState,
  ordered: boolean,
  next: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return next(
    addAction(
      {
        ...game,
        activeEffect: game.activeEffect?.id === source.id ? null : game.activeEffect,
        pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== source.id),
      },
      'RESOLVE_ABILITY',
      source.controllerId,
      {
        pendingAbilityId: source.id,
        abilityId: source.abilityId,
        sourceCardId: source.sourceCardId,
        step,
        movedCardIds: [],
        ...payload,
      }
    ),
    ordered
  );
}
