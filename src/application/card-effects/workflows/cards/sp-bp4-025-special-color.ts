import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier, replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { hasMemberPositionMovedThisTurn } from '../../../../domain/rules/member-turn-state.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import {
  SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
  SP_BP4_025_LIVE_SUCCESS_CENTER_LIELLA_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp4025SpecialColorWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_025_LIVE_START_CENTER_LIELLA_ORIGINAL_BLADE_THREE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveOriginalBladeThree(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    SP_BP4_025_LIVE_SUCCESS_CENTER_LIELLA_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveMovedCenterLiellaScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveOriginalBladeThree(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const centerMemberId = player.memberSlots.slots[SlotPosition.CENTER];
  const centerMember = centerMemberId ? getCardById(game, centerMemberId) : null;
  const applies =
    centerMember !== null &&
    centerMember.ownerId === player.id &&
    isMemberCardData(centerMember.data) &&
    cardBelongsToGroup(centerMember.data, 'Liella!');

  const stateWithoutPending = removePending(game, ability.id);
  const stateAfterModifier =
    applies && centerMemberId
      ? replaceLiveModifier(
          stateWithoutPending,
          {
            kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
            playerId: player.id,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
          },
          {
            kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
            playerId: player.id,
            memberCardId: centerMemberId,
            count: 3,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
          }
        )
      : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CENTER_LIELLA_ORIGINAL_BLADE_THREE',
      centerMemberId,
      applies,
      replacementBladeCount: applies ? 3 : 0,
    }),
    orderedResolution
  );
}

function resolveMovedCenterLiellaScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const centerMemberId = player.memberSlots.slots[SlotPosition.CENTER];
  const centerMember = centerMemberId ? getCardById(game, centerMemberId) : null;
  const isCenterLiella =
    centerMember !== null &&
    centerMember.ownerId === player.id &&
    isMemberCardData(centerMember.data) &&
    cardBelongsToGroup(centerMember.data, 'Liella!');
  const movedThisTurn =
    centerMemberId !== null && hasMemberPositionMovedThisTurn(game, player.id, centerMemberId);
  const scoreBonus = isCenterLiella && movedThisTurn ? 1 : 0;
  const stateWithoutPending = removePending(game, ability.id);
  const stateAfterModifier =
    scoreBonus > 0
      ? addLiveModifier(stateWithoutPending, {
          kind: 'SCORE',
          playerId: player.id,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        })
      : stateWithoutPending;
  const stateAfterScoreRefresh =
    scoreBonus > 0 ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus) : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CENTER_LIELLA_MOVED_THIS_LIVE_SCORE',
      centerMemberId,
      isCenterLiella,
      movedThisTurn,
      scoreBonus,
    }),
    orderedResolution
  );
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
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
