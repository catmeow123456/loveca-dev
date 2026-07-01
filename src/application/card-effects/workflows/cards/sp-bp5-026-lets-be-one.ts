import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
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
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { SP_BP5_026_LIVE_START_LIELLA_STAGE_HEART_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SCORE_BONUS = 1;
const HEART_THRESHOLD = 11;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5026LetsBeOneWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_026_LIVE_START_LIELLA_STAGE_HEART_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getLetsBeOneConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveLetsBeOneLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function getLetsBeOneConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const sourceIsCurrentLive = player
    ? sourceIsCurrentBp5026Live(game, player.id, ability.sourceCardId)
    : false;
  const liellaStageMemberHeartTotal =
    player && sourceIsCurrentLive ? countLiellaStageMemberEffectiveHearts(game, player.id) : 0;
  const conditionMet = sourceIsCurrentLive && liellaStageMemberHeartTotal >= HEART_THRESHOLD;
  return `${getAbilityEffectText(ability.abilityId)}（当前Liella!成员Heart合计 ${liellaStageMemberHeartTotal}，${
    conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'
  }）`;
}

function resolveLetsBeOneLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceIsCurrentLive = sourceIsCurrentBp5026Live(game, player.id, ability.sourceCardId);
  const liellaStageMemberHeartTotal = sourceIsCurrentLive
    ? countLiellaStageMemberEffectiveHearts(game, player.id)
    : 0;
  const conditionMet = sourceIsCurrentLive && liellaStageMemberHeartTotal >= HEART_THRESHOLD;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier = conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: SCORE_BONUS,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, SCORE_BONUS)
    : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'LIELLA_STAGE_HEART_ELEVEN_THIS_LIVE_SCORE' : 'CONDITION_NOT_MET',
      sourceIsCurrentLive,
      liellaStageMemberHeartTotal,
      heartThreshold: HEART_THRESHOLD,
      conditionMet,
      scoreBonus: conditionMet ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function sourceIsCurrentBp5026Live(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!sourceCard &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-026') &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function countLiellaStageMemberEffectiveHearts(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  const modifiers = collectLiveModifiers(game);
  return Object.values(player.memberSlots.slots).reduce((total, memberCardId) => {
    const card = memberCardId ? getCardById(game, memberCardId) : null;
    if (!memberCardId || !card || !isMemberCardData(card.data) || !cardBelongsToGroup(card.data, 'Liella!')) {
      return total;
    }
    return (
      total +
      getMemberEffectiveHeartIcons(game, playerId, memberCardId, modifiers).reduce(
        (heartTotal, heart) => heartTotal + heart.count,
        0
      )
    );
  }, 0);
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
