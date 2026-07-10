import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { CheerEvent } from '../../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../../shared/types/enums.js';
import { revealCheerCardsFromMainDeck } from '../../../effects/cheer.js';
import { moveRevealedCheerCards } from '../../../effects/cheer-selection.js';
import { S_BP2_004_AUTO_ON_CHEER_NO_LIVE_REROLL_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';

const ABILITY_ID = S_BP2_004_AUTO_ON_CHEER_NO_LIVE_REROLL_ABILITY_ID;
const REROLL_DECISION_STEP_ID = 'S_BP2_004_DECIDE_CHEER_REROLL';
const REROLL_OPTION_ID = 'reroll';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffectsForCheer = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: { readonly cheerEvents?: readonly CheerEvent[] }
) => GameState;

export function registerSBp2004DiaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForCheer;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startOnCheerRerollWorkflow(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, REROLL_DECISION_STEP_ID, (game, input, context) =>
    finishOnCheerRerollDecision(
      game,
      input.selectedOptionId,
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
}

function startOnCheerRerollWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return finishPending(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
      sourceSlot,
    });
  }

  const originalEvent = getLatestOwnNormalCheerEventByIds(game, player.id, ability.eventIds);
  if (!originalEvent) {
    return finishPending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT',
      sourceSlot,
    });
  }
  if (eventContainsLiveCard(game, originalEvent)) {
    return finishPending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'ORIGINAL_CHEER_CONTAINED_LIVE',
      cheerEventId: originalEvent.eventId,
    });
  }

  const movableCardIds = selectMovableOriginalRevealedCardIds(game, player.id, originalEvent);
  if (movableCardIds.length === 0) {
    return finishPending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_MOVABLE_ORIGINAL_REVEALED_CARDS',
      cheerEventId: originalEvent.eventId,
    });
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
      stepId: REROLL_DECISION_STEP_ID,
      stepText:
        '本次声援公开的卡片中不存在LIVE卡。可以将这些卡片全部放置入休息室；如此做时，失去本次声援获得的BLADE HEART，并重新进行声援。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: REROLL_OPTION_ID, label: '全部放置入休息室并重新进行声援' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sBp2004CheerReroll: true,
        originalCheerEventId: originalEvent.eventId,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CHEER_REROLL_DECISION',
      cheerEventId: originalEvent.eventId,
      movableCardIds,
    },
  });
}

function finishOnCheerRerollDecision(
  game: GameState,
  selectedOptionId: string | null | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForCheer
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== REROLL_DECISION_STEP_ID ||
    effect.metadata?.sBp2004CheerReroll !== true
  ) {
    return game;
  }
  if (selectedOptionId !== undefined && selectedOptionId !== REROLL_OPTION_ID) {
    return game;
  }
  if (selectedOptionId === REROLL_OPTION_ID && effect.selectableOptions?.some((option) => option.id === REROLL_OPTION_ID) !== true) {
    return game;
  }
  if (selectedOptionId === undefined) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_CHEER_REROLL',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  const originalCheerEventId = effect.metadata?.originalCheerEventId;
  const originalEvent =
    typeof originalCheerEventId === 'string'
      ? getLatestOwnNormalCheerEventByIds(game, player.id, [originalCheerEventId])
      : null;
  if (sourceSlot === null || !originalEvent || eventContainsLiveCard(game, originalEvent)) {
    return finishActiveEffect(game, player.id, effect, continuePendingCardEffects, {
      step: 'REROLL_CONDITION_STALE',
      sourceSlot,
      cheerEventId: originalCheerEventId,
    });
  }

  const movableCardIds = selectMovableOriginalRevealedCardIds(game, player.id, originalEvent);
  if (movableCardIds.length === 0) {
    return finishActiveEffect(game, player.id, effect, continuePendingCardEffects, {
      step: 'NO_MOVABLE_ORIGINAL_REVEALED_CARDS_ON_ACTIVATION',
      cheerEventId: originalEvent.eventId,
    });
  }
  const moveResult = moveRevealedCheerCards(game, player.id, movableCardIds, 'WAITING_ROOM');
  if (!moveResult || moveResult.movedCardIds.length === 0) {
    return game;
  }

  const recordedState = recordAbilityUseForContext(
    { ...moveResult.gameState, activeEffect: null },
    player.id,
    { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId }
  );
  const rerollResult = revealCheerCardsFromMainDeck(recordedState, player.id, originalEvent.totalBlade, {
    automated: true,
    additional: false,
    replaceCurrentCheerCards: true,
  });
  const stateWithTriggeredEffects = enqueueTriggeredCardEffects(
    rerollResult.gameState,
    [TriggerCondition.ON_CHEER],
    { cheerEvents: [rerollResult.cheerEvent] }
  );

  return continuePendingCardEffects(
    addAction(stateWithTriggeredEffects, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot,
      step: 'MOVE_ORIGINAL_CHEER_CARDS_AND_REROLL',
      originalCheerEventId: originalEvent.eventId,
      movedCardIds: moveResult.movedCardIds,
      rerollCheerEventId: rerollResult.cheerEvent.eventId,
      rerollCheerCardIds: rerollResult.cheerCardIds,
      totalBlade: originalEvent.totalBlade,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function eventContainsLiveCard(game: GameState, event: CheerEvent): boolean {
  return event.revealedCardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
}

function selectMovableOriginalRevealedCardIds(
  game: GameState,
  playerId: string,
  event: CheerEvent
): readonly string[] {
  const resolutionCardIds = new Set(game.resolutionZone.cardIds);
  const revealedCardIds = new Set(game.resolutionZone.revealedCardIds);
  return event.revealedCardIds.filter(
    (cardId) =>
      resolutionCardIds.has(cardId) &&
      revealedCardIds.has(cardId) &&
      getCardById(game, cardId)?.ownerId === playerId
  );
}

function finishPending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      { ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) },
      'RESOLVE_ABILITY',
      playerId,
      { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, ...payload }
    ),
    orderedResolution
  );
}

function finishActiveEffect(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
