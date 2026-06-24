import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addLiveModifier,
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

export function registerSpPb2045ZettaiLoverWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2045ZettaiLoverLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPb2045ZettaiLoverLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const liveModifiers = collectLiveModifiers(game);
  const checkedMembers = STAGE_SLOTS.map((slot) => {
    const memberCardId = player.memberSlots.slots[slot];
    const memberCard = memberCardId ? getCardById(game, memberCardId) : null;
    const isMember = memberCard !== null && isMemberCardData(memberCard.data);
    const isLiella =
      isMember && memberCard !== null && cardBelongsToGroup(memberCard.data, 'Liella!');
    const heartCount =
      memberCardId && isMember
        ? countHearts(getMemberEffectiveHeartIcons(game, player.id, memberCardId, liveModifiers))
        : 0;
    return {
      slot,
      memberCardId,
      isLiella,
      heartCount,
      qualifies: isLiella && heartCount >= 4,
    };
  });
  const qualifyingMemberCardIds = checkedMembers
    .filter((member) => member.qualifies && member.memberCardId !== null)
    .map((member) => member.memberCardId as string);
  const scoreBonus = qualifyingMemberCardIds.length;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
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
    scoreBonus > 0
      ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus)
      : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE',
      checkedMembers,
      qualifyingMemberCardIds,
      scoreBonus,
    }),
    orderedResolution
  );
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

function countHearts(hearts: readonly { readonly count: number }[]): number {
  return hearts.reduce((total, heart) => total + heart.count, 0);
}
