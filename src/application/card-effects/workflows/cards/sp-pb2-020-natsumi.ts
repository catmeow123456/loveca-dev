import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, TriggerCondition } from '../../../../shared/types/enums.js';
import { revealCheerCardsFromMainDeck } from '../../../effects/cheer.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const SELECT_LIELLA_LIVE_STEP_ID = 'SP_PB2_020_SELECT_LIELLA_LIVE_DISCARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2020NatsumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2020NatsumiOnCheer(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID,
    SELECT_LIELLA_LIVE_STEP_ID,
    (game, input, context) =>
      finishSpPb2020NatsumiOnCheer(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpPb2020NatsumiOnCheer(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const ownCheerEventIds = getOwnPendingCheerEventIds(game, ability, player.id);
  const isOwnCheer = ownCheerEventIds.length > 0;
  const selectableCardIds = isOwnCheer ? getLiellaLiveHandCardIds(game, player.id) : [];
  if (selectableCardIds.length === 0) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: isOwnCheer ? 'NO_LIELLA_LIVE_HAND_TARGET' : 'NOT_OWN_CHEER',
      ownCheerEventIds,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_LIELLA_LIVE_STEP_ID,
      selectableCardIds,
      orderedResolution,
      stepText: '可以将手牌中的1张『Liella!』LIVE卡放置入休息室，追加进行2张声援。',
      selectionLabel: '选择要放置入休息室的 Liella! LIVE',
      metadata: {
        ownCheerEventIds,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LIELLA_LIVE_DISCARD',
      selectableCardIds,
      ownCheerEventIds,
    },
  });
}

function finishSpPb2020NatsumiOnCheer(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID ||
    effect.stepId !== SELECT_LIELLA_LIVE_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_LIELLA_LIVE_DISCARD_ADDITIONAL_CHEER',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = recordAbilityUseForContext(
    { ...discardResult.gameState, activeEffect: null },
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    }
  );
  const cheerResult = revealCheerCardsFromMainDeck(state, player.id, 2, {
    automated: true,
    additional: true,
  });
  state = cheerResult.gameState;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER',
      discardedCardIds: discardResult.discardedCardIds,
      additionalCheerCount: 2,
      additionalCheerCardIds: cheerResult.cheerCardIds,
      ownCheerEventIds: effect.metadata?.ownCheerEventIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getLiellaLiveHandCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const isLiellaLive = and(typeIs(CardType.LIVE), groupAliasIs('Liella!'));
  return player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isLiellaLive(card);
  });
}

function getOwnPendingCheerEventIds(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): readonly string[] {
  const eventIds = new Set(ability.eventIds);
  return game.eventLog.flatMap((entry) => {
    const event = entry.event;
    if (
      event.eventType === TriggerCondition.ON_CHEER &&
      'playerId' in event &&
      'additional' in event &&
      event.playerId === playerId &&
      event.additional !== true &&
      eventIds.has(event.eventId)
    ) {
      return [event.eventId];
    }
    return [];
  });
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
