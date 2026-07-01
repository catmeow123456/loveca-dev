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
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

export function registerSpPb2045ZettaiLoverWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2045ZettaiLoverLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSpPb2045ConfirmationConfig
  );
}

function getSpPb2045ConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const checkedMembers = getCheckedMembers(game, ability.controllerId);
  const qualifyingMemberCount = checkedMembers.filter((member) => member.qualifies).length;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前满足4Heart以上的Liella!成员 ${qualifyingMemberCount}名，分数+${qualifyingMemberCount}）`,
  };
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

  const checkedMembers = getCheckedMembers(game, player.id);
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

function getCheckedMembers(game: GameState, playerId: string) {
  const player = getPlayerById(game, playerId);
  const liveModifiers = collectLiveModifiers(game);
  return STAGE_SLOTS.map((slot) => {
    const memberCardId = player?.memberSlots.slots[slot] ?? null;
    const memberCard = memberCardId ? getCardById(game, memberCardId) : null;
    const isMember = memberCard !== null && isMemberCardData(memberCard.data);
    const isLiella =
      isMember && memberCard !== null && cardBelongsToGroup(memberCard.data, 'Liella!');
    const heartCount =
      memberCardId && isMember
        ? countHearts(getMemberEffectiveHeartIcons(game, playerId, memberCardId, liveModifiers))
        : 0;
    return {
      slot,
      memberCardId,
      isLiella,
      heartCount,
      qualifies: isLiella && heartCount >= 4,
    };
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

function countHearts(hearts: readonly { readonly count: number }[]): number {
  return hearts.reduce((total, heart) => total + heart.count, 0);
}
