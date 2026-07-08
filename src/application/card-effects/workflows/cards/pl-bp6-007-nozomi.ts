import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addCardToZone } from '../../../../domain/entities/zone.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { hasBladeHeart } from '../../../effects/card-selectors.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp6007NozomiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolvePlBp6007NozomiLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolvePlBp6007NozomiLiveSuccess(
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

  if (player.mainDeck.cardIds.length === 0 && player.waitingRoom.cardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot,
        step: 'NO_TOP_CARD',
        revealedCardId: null,
        movedToHand: false,
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  const inspection = inspectTopCards(game, player.id, { count: 1, reveal: true });
  if (!inspection) {
    return game;
  }

  const revealedCardId = inspection.inspectedCardIds[0] ?? null;
  const revealedCard = revealedCardId ? getCardById(inspection.gameState, revealedCardId) : null;
  const scoreBonus =
    revealedCard && isMemberCardData(revealedCard.data) && !hasBladeHeart()(revealedCard) ? 1 : 0;

  let state = updatePlayer(inspection.gameState, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: revealedCardId ? addCardToZone(currentPlayer.hand, revealedCardId) : currentPlayer.hand,
  }));
  state = clearInspectionCards(state, inspection.inspectedCardIds);

  if (scoreBonus > 0) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: scoreBonus,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    });
    state = refreshPlayerScoreDraft(state, player.id, scoreBonus);
  }

  state = removePendingAbility(state, ability.id);
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'REVEAL_TOP_CARD_TO_HAND',
      revealedCardId,
      movedToHand: revealedCardId !== null,
      scoreBonus,
    }),
    orderedResolution
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
