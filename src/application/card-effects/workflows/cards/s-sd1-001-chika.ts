import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { CheerEvent } from '../../../../domain/events/game-events.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, TriggerCondition } from '../../../../shared/types/enums.js';
import { S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

const MAX_RED_HEART_COUNT = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSSd1001ChikaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSSd1001ChikaOnCheer(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSSd1001ChikaOnCheer(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'SOURCE_NOT_ON_STAGE',
        sourceSlot,
      }
    );
  }

  const cheerEvent = getOwnNormalCheerEventForAbility(game, ability, player.id);
  if (!cheerEvent) {
    return finishPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT',
      sourceSlot,
    });
  }

  const matchingLiveCardIds = cheerEvent.revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isLiveCardData(card.data);
  });
  const gainedHeartCount = Math.min(matchingLiveCardIds.length, MAX_RED_HEART_COUNT);

  let state = removePendingAbility(game, ability.id);
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  if (gainedHeartCount > 0) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.RED, count: gainedHeartCount }],
    });
    if (heartResult) {
      state = heartResult.gameState;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'COUNT_OWN_CHEER_LIVE_CARDS_GAIN_RED_HEART',
      cheerEventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      matchingLiveCardIds,
      gainedHearts: [{ color: HeartColor.RED, count: gainedHeartCount }],
    }),
    orderedResolution
  );
}

function getOwnNormalCheerEventForAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): CheerEvent | null {
  const eventIds = new Set(ability.eventIds);
  const events = game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is CheerEvent =>
        event.eventType === TriggerCondition.ON_CHEER &&
        'playerId' in event &&
        'additional' in event &&
        event.playerId === playerId &&
        event.additional !== true &&
        eventIds.has(event.eventId)
    );
  return events.at(-1) ?? null;
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
