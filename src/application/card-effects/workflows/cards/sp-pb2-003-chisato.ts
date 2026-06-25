import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { hasMemberPositionMovedThisTurn } from '../../../../domain/rules/member-turn-state.js';
import { TriggerCondition } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { SP_PB2_003_LIVE_SUCCESS_OWN_LIELLA_EFFECT_MOVED_THIS_MEMBER_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2003ChisatoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_003_LIVE_SUCCESS_OWN_LIELLA_EFFECT_MOVED_THIS_MEMBER_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2003ChisatoLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPb2003ChisatoLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const matchingMoveEventIds = getOwnLiellaCardEffectMoveEventIds(
    game,
    player.id,
    ability.sourceCardId
  );
  const movedThisTurn = hasMemberPositionMovedThisTurn(game, player.id, ability.sourceCardId);
  const conditionMet = movedThisTurn && matchingMoveEventIds.length > 0;
  const stateAfterModifier = conditionMet
    ? addLiveModifier(game, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: 1,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : game;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, 1)
    : stateAfterModifier;
  const stateWithoutPending: GameState = {
    ...stateAfterScoreRefresh,
    pendingAbilities: stateAfterScoreRefresh.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'OWN_LIELLA_EFFECT_MOVED_THIS_MEMBER_SCORE',
      movedThisTurn,
      conditionMet,
      matchingMoveEventIds,
      scoreBonus: conditionMet ? 1 : 0,
    }),
    orderedResolution
  );
}

function getOwnLiellaCardEffectMoveEventIds(
  game: GameState,
  playerId: string,
  memberCardId: string
): readonly string[] {
  const isLiella = groupAliasIs('Liella!');
  return game.eventLog.flatMap((entry) => {
    const event = entry.event;
    if (
      event.eventType !== TriggerCondition.ON_MEMBER_SLOT_MOVED ||
      !('cause' in event) ||
      event.cardInstanceId !== memberCardId ||
      event.controllerId !== playerId ||
      event.cause?.kind !== 'CARD_EFFECT' ||
      event.cause.playerId !== playerId
    ) {
      return [];
    }
    const sourceCard = getCardById(game, event.cause.sourceCardId);
    if (!sourceCard || sourceCard.ownerId !== playerId || !isLiella(sourceCard)) {
      return [];
    }
    return [event.eventId];
  });
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
