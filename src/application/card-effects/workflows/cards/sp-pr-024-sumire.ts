import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, hasScoreBladeHeart, typeIs } from '../../../effects/card-selectors.js';
import { SP_PR_024_AUTO_ON_CHEER_SCORE_LIELLA_LIVE_GAIN_PURPLE_HEART_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const scoreLiellaLive = and(typeIs(CardType.LIVE), groupAliasIs('Liella!'), hasScoreBladeHeart());

export function registerSpPr024SumireWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PR_024_AUTO_ON_CHEER_SCORE_LIELLA_LIVE_GAIN_PURPLE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPr024SumireOnCheer(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPr024SumireOnCheer(
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

  const cheerEvent = getLatestOwnNormalCheerEventByIds(game, player.id, ability.eventIds);
  if (!cheerEvent) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT',
        sourceSlot,
      }
    );
  }

  const matchingCardIds = cheerEvent.revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && scoreLiellaLive(card);
  });
  const conditionMet = matchingCardIds.length > 0;

  let state = removePendingAbility(game, ability.id);
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  if (conditionMet) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.PURPLE, count: 1 }],
    });
    if (!heartResult) {
      return game;
    }
    state = heartResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'CHECK_CHEER_SCORE_LIELLA_LIVE_GAIN_PURPLE_HEART',
      cheerEventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      matchingCardIds,
      conditionMet,
      hearts: conditionMet ? [{ color: HeartColor.PURPLE, count: 1 }] : [],
    }),
    orderedResolution
  );
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
