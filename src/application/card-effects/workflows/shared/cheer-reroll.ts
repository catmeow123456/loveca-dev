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
import { hasBladeHeart } from '../../../effects/card-selectors.js';
import {
  S_BP2_004_AUTO_ON_CHEER_NO_LIVE_REROLL_ABILITY_ID,
  S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { createPublicCardSelectionConfirmationWindowForCardIds } from '../../runtime/public-card-selection-confirmation.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';

const REROLL_OPTION_ID = 'reroll';

type CheerRerollConfig = {
  readonly abilityId: string;
  readonly sourceZone: 'STAGE_MEMBER' | 'LIVE_CARD';
  readonly condition: 'NO_LIVE' | 'AT_MOST_BLADE_HEART_CARDS';
  readonly maxBladeHeartCards?: number;
  readonly requireExactOriginalSet?: boolean;
  readonly decisionStepId: string;
  readonly afterPublicDisplayStepId: string;
  readonly stepText: string;
};

const CHEER_REROLL_CONFIGS: readonly CheerRerollConfig[] = [
  {
    abilityId: S_BP2_004_AUTO_ON_CHEER_NO_LIVE_REROLL_ABILITY_ID,
    sourceZone: 'STAGE_MEMBER',
    condition: 'NO_LIVE',
    decisionStepId: 'S_BP2_004_DECIDE_CHEER_REROLL',
    afterPublicDisplayStepId: 'S_BP2_004_REROLL_AFTER_PUBLIC_DISPLAY',
    stepText:
      '本次声援公开的卡片中不存在LIVE卡。可以将这些卡片全部放置入休息室；如此做时，失去本次声援获得的BLADE HEART，并重新进行声援。',
  },
  {
    abilityId: S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
    sourceZone: 'LIVE_CARD',
    condition: 'AT_MOST_BLADE_HEART_CARDS',
    maxBladeHeartCards: 2,
    requireExactOriginalSet: true,
    decisionStepId: 'S_BP3_020_DECIDE_CHEER_REROLL',
    afterPublicDisplayStepId: 'S_BP3_020_REROLL_AFTER_PUBLIC_DISPLAY',
    stepText:
      '可以将本次声援公开的卡片全部放置入休息室。如此做时，失去本次声援获得的BLADE HEART，并重新进行声援。',
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffectsForCheer = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: { readonly cheerEvents?: readonly CheerEvent[] }
) => GameState;

export function registerCheerRerollWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForCheer;
}): void {
  for (const config of CHEER_REROLL_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startOnCheerRerollWorkflow(
        game, ability, config, options.orderedResolution === true, context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.decisionStepId, (game, input, context) =>
      finishOnCheerRerollDecision(game, input.selectedOptionId, config, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(config.abilityId, config.afterPublicDisplayStepId, (game, _input, context) =>
      finishOnCheerRerollAfterPublicDisplay(game, config, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects)
    );
  }
}

function startOnCheerRerollWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: CheerRerollConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceValid = player ? isSourceValid(game, player.id, ability.sourceCardId, config) : false;
  if (!player || !sourceValid) {
    return finishPending(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
      sourceValid,
    });
  }

  const originalEvent = getLatestOwnNormalCheerEventByIds(game, player.id, ability.eventIds);
  if (!originalEvent) {
    return finishPending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT',
      sourceValid,
    });
  }
  if (originalEvent.revealedCardIds.length === 0 || !eventMeetsCondition(game, originalEvent, config)) {
    return finishPending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'ORIGINAL_CHEER_CONDITION_NOT_MET',
      cheerEventId: originalEvent.eventId,
    });
  }

  const movableCardIds = selectMovableOriginalRevealedCardIds(game, player.id, originalEvent);
  if (
    movableCardIds.length === 0 ||
    (config.requireExactOriginalSet === true && !isExactOriginalRevealedSet(originalEvent, movableCardIds))
  ) {
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
      stepId: config.decisionStepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: REROLL_OPTION_ID, label: '全部放置入休息室并重新进行声援' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        cheerReroll: true,
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
  config: CheerRerollConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.decisionStepId ||
    effect.metadata?.cheerReroll !== true
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

  const sourceValid = isSourceValid(game, player.id, effect.sourceCardId, config);
  const originalCheerEventId = effect.metadata?.originalCheerEventId;
  const originalEvent =
    typeof originalCheerEventId === 'string'
      ? getLatestOwnNormalCheerEventByIds(game, player.id, [originalCheerEventId])
      : null;
  if (!sourceValid || !originalEvent || !eventMeetsCondition(game, originalEvent, config)) {
    return finishActiveEffect(game, player.id, effect, continuePendingCardEffects, {
      step: 'REROLL_CONDITION_STALE',
      sourceValid,
      cheerEventId: originalCheerEventId,
    });
  }

  const movableCardIds = selectMovableOriginalRevealedCardIds(game, player.id, originalEvent);
  if (
    movableCardIds.length === 0 ||
    (config.requireExactOriginalSet === true && !isExactOriginalRevealedSet(originalEvent, movableCardIds))
  ) {
    return finishActiveEffect(game, player.id, effect, continuePendingCardEffects, {
      step: 'NO_MOVABLE_ORIGINAL_REVEALED_CARDS_ON_ACTIVATION',
      cheerEventId: originalEvent.eventId,
    });
  }
  const continuationEffect = {
    ...effect,
    stepId: config.afterPublicDisplayStepId,
    stepText: '公开展示结束后，重新校验并处理本次声援。',
    selectableOptions: undefined,
    canSkipSelection: false,
    skipSelectionLabel: undefined,
    metadata: {
      ...effect.metadata,
      publicDisplayedCheerCardIds: movableCardIds,
    },
  };
  return (
    createPublicCardSelectionConfirmationWindowForCardIds(
      game,
      continuationEffect,
      {},
      { source: 'REVEALED_CHEER', destination: 'WAITING_ROOM' },
      movableCardIds
    ) ?? game
  );
}

function finishOnCheerRerollAfterPublicDisplay(
  game: GameState,
  config: CheerRerollConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForCheer
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.afterPublicDisplayStepId ||
    effect.metadata?.cheerReroll !== true
  ) {
    return game;
  }

  const sourceValid = isSourceValid(game, player.id, effect.sourceCardId, config);
  const originalCheerEventId = effect.metadata?.originalCheerEventId;
  const originalEvent =
    typeof originalCheerEventId === 'string'
      ? getLatestOwnNormalCheerEventByIds(game, player.id, [originalCheerEventId])
      : null;
  if (!sourceValid || !originalEvent || !eventMeetsCondition(game, originalEvent, config)) {
    return finishActiveEffect(game, player.id, effect, continuePendingCardEffects, {
      step: 'REROLL_CONDITION_STALE_AFTER_PUBLIC_DISPLAY',
      sourceValid,
      cheerEventId: originalCheerEventId,
    });
  }

  const movableCardIds = selectMovableOriginalRevealedCardIds(game, player.id, originalEvent);
  const publicDisplayedCheerCardIds = effect.metadata?.publicDisplayedCheerCardIds;
  if (
    !Array.isArray(publicDisplayedCheerCardIds) ||
    !publicDisplayedCheerCardIds.every((cardId) => typeof cardId === 'string') ||
    movableCardIds.length !== publicDisplayedCheerCardIds.length ||
    movableCardIds.some((cardId, index) => cardId !== publicDisplayedCheerCardIds[index])
  ) {
    return finishActiveEffect(game, player.id, effect, continuePendingCardEffects, {
      step: 'PUBLIC_DISPLAYED_CHEER_TARGETS_STALE',
      cheerEventId: originalEvent.eventId,
      publicDisplayedCheerCardIds,
      movableCardIds,
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
      sourceValid,
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

function eventMeetsCondition(game: GameState, event: CheerEvent, config: CheerRerollConfig): boolean {
  if (config.condition === 'NO_LIVE') {
    return !eventContainsLiveCard(game, event);
  }
  const bladeHeartCardCount = event.revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && hasBladeHeart()(card);
  }).length;
  return bladeHeartCardCount <= (config.maxBladeHeartCards ?? 0);
}

function isSourceValid(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  config: CheerRerollConfig
): boolean {
  if (config.sourceZone === 'STAGE_MEMBER') {
    return getSourceMemberSlot(game, playerId, sourceCardId) !== null;
  }
  return getPlayerById(game, playerId)?.liveZone.cardIds.includes(sourceCardId) === true;
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

function isExactOriginalRevealedSet(
  event: CheerEvent,
  movableCardIds: readonly string[]
): boolean {
  return (
    event.revealedCardIds.length > 0 &&
    movableCardIds.length === event.revealedCardIds.length &&
    movableCardIds.every((cardId, index) => cardId === event.revealedCardIds[index])
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
