import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { CardType } from '../../../../shared/types/enums.js';
import {
  selectCurrentLiveRevealedCheerCardIds,
  selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts,
} from '../../../effects/cheer-selection.js';
import { S_PB2_038_LIVE_SUCCESS_AQOURS_CHEER_DRAW_AND_SCORE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../runtime/live-card-score.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

function getConditions(game: GameState, ability: PendingAbilityState) {
  const playerId = ability.controllerId;
  const source = getCardById(game, ability.sourceCardId);
  const sourceMatches =
    source?.ownerId === playerId &&
    source.data.cardType === CardType.LIVE &&
    cardCodeMatchesBase(source.data.cardCode, 'PL!S-pb2-038');
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
  const canModifySource =
    sourceMatches && isCurrentLiveCardAbilitySource(game, { ...ability, sourceLifecycleId });

  const liveCards = selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    cardTypes: CardType.LIVE,
    groupAliases: ['Aqours'],
  });
  const noBladeHeartMembers = selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts(
    game,
    playerId,
    {
      cardTypes: CardType.MEMBER,
      groupAliases: ['Aqours'],
    }
  );
  return {
    liveCards,
    noBladeHeartMembers,
    canDraw: sourceMatches && liveCards.length > 0,
    canModifySource,
    scoreBonus: canModifySource && noBladeHeartMembers.length >= 2 ? 1 : 0,
  };
}

export function registerSPb2038AqoursHeroesWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, context) => {
      const conditions = getConditions(game, ability);
      let state: GameState = {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      };
      const draw = conditions.canDraw ? drawCardsForPlayer(state, ability.controllerId, 1) : null;
      state = draw?.gameState ?? state;
      if (conditions.canModifySource) {
        state = replaceSourceLiveCardScoreModifierAndRefresh(state, ability, conditions.scoreBonus);
      }
      return context.continuePendingCardEffects(
        addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'AQOURS_CHEER_DRAW_AND_SCORE',
          revealedLiveCardIds: conditions.liveCards,
          revealedNoBladeHeartMemberIds: conditions.noBladeHeartMembers,
          drawnCardIds: draw?.drawnCardIds ?? [],
          scoreBonus: conditions.scoreBonus,
        }),
        options.orderedResolution === true
      );
    },
    (game, ability) => {
      const conditions = getConditions(game, ability);
      const player = getPlayerById(game, ability.controllerId);
      const drawCount = Number(
        conditions.canDraw &&
          !!player &&
          (player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0)
      );
      return {
        effectText: `${getAbilityEffectText(ABILITY_ID)}（本次声援公开的『Aqours』LIVE有${conditions.liveCards.length}张，无BLADE HEART的『Aqours』成员卡有${conditions.noBladeHeartMembers.length}张。实际抽${drawCount}张，此卡分数＋${conditions.scoreBonus}。）`,
      };
    }
  );
}
