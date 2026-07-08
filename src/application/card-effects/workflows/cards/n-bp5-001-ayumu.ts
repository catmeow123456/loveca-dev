import {
  isLiveCardData,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { CheerEvent } from '../../../../domain/events/game-events.js';
import {
  addHeartLiveModifierForMember,
  addLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import {
  BladeHeartEffect,
  HeartColor,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

const SCORE_BONUS = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5001AyumuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveNBp5001AyumuOnCheer(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveNBp5001AyumuOnCheer(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }

  const cheerEvent = getOwnCheerEventForAbility(game, ability, player.id);
  if (!cheerEvent) {
    return skipPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_MATCHING_OWN_CHEER_EVENT'
    );
  }

  const heartColors = collectBladeHeartColorsFromCheerEvent(game, player.id, cheerEvent);
  const bladeHeartTypeCount = heartColors.size;
  const shouldGainHeart = bladeHeartTypeCount >= 3;
  const shouldGainScore = bladeHeartTypeCount >= 6;

  let state = removePendingAbility(game, ability.id);
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  if (shouldGainHeart) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      memberCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    if (!heartResult) {
      return game;
    }
    state = heartResult.gameState;
  }

  if (shouldGainScore) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: SCORE_BONUS,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    });
    state = refreshPlayerScoreDraft(state, player.id, SCORE_BONUS);
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'COUNT_CHEER_BLADE_HEART_TYPES',
      cheerEventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      bladeHeartColors: [...heartColors],
      bladeHeartTypeCount,
      gainedPinkHeart: shouldGainHeart,
      scoreBonus: shouldGainScore ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function getOwnCheerEventForAbility(
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

function collectBladeHeartColorsFromCheerEvent(
  game: GameState,
  playerId: string,
  cheerEvent: CheerEvent
): ReadonlySet<HeartColor> {
  const colors = new Set<HeartColor>();
  const revealedCardIds = selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    eventIds: [cheerEvent.eventId],
    eventScope: 'NON_ADDITIONAL',
  });
  for (const cardId of revealedCardIds) {
    const card = getCardById(game, cardId);
    if (!card || card.ownerId !== playerId) {
      continue;
    }
    for (const color of getBladeHeartColors(card)) {
      colors.add(color);
    }
  }
  return colors;
}

function getBladeHeartColors(card: CardInstance): readonly HeartColor[] {
  if (!isMemberCardData(card.data) && !isLiveCardData(card.data)) {
    return [];
  }
  return (card.data.bladeHearts ?? []).flatMap((bladeHeart) =>
    bladeHeart.effect === BladeHeartEffect.HEART && bladeHeart.heartColor
      ? [bladeHeart.heartColor]
      : []
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step,
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

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}
