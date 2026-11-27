import {
  addAction,
  getCardActiveEffect,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import {
  getCardUnitIdentities,
  hasAtLeastDifferentNamedCards,
} from '../../../../shared/utils/card-identity.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { S_PB2_039_LIVE_SUCCESS_SAME_AQOURS_UNIT_DRAW_AND_RECOVER_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from '../shared/waiting-room-to-hand.js';

const RECOVER_STEP_ID = 'S_PB2_039_SELECT_AQOURS_WAITING_ROOM_CARD';
const MEMBER_COUNT = 3;
const isAqours = groupAliasIs('Aqours');

function waitingRoomTargets(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, isAqours);
}

function getStageCondition(game: GameState, playerId: string) {
  const stageIds = getStageMemberCardIdsMatching(game, playerId, isAqours);
  const getData = (cardId: string) => getCardById(game, cardId)?.data;
  const cards = stageIds.flatMap((id) => getData(id) ?? []);
  const [firstUnits, ...otherUnitLists] = cards.map(getCardUnitIdentities);
  const sharedUnit =
    cards.length === MEMBER_COUNT
      ? firstUnits?.find((unit) =>
          otherUnitLists.every((units) => units.some((candidate) => candidate.key === unit.key))
        )
      : undefined;
  const distinctNames =
    sharedUnit !== undefined &&
    hasAtLeastDifferentNamedCards(stageIds, MEMBER_COUNT, getData, {
      nameComparison: 'MEMBER_IDENTITY',
    });
  return { sharedUnit, distinctNames };
}

export function registerSPb2039HopStepWaiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const player = getPlayerById(game, ability.controllerId);
    if (!player) return game;
    const stage = getStageCondition(game, player.id);
    const drawCount = Number(
      stage.sharedUnit !== undefined &&
        (player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0)
    );
    // Drawing the last card refreshes the waiting room before the recovery choice.
    const canOpenRecovery =
      stage.distinctNames &&
      player.mainDeck.cardIds.length > 1 &&
      waitingRoomTargets(game, player.id).length > 0;
    if (!canOpenRecovery) {
      const stageText = stage.sharedUnit
        ? `三名成员的共同UNIT为『${stage.sharedUnit.name}』，姓名${stage.distinctNames ? '各异' : '有重复'}`
        : '没有三名持有同一UNIT的Aqours成员';
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(ABILITY_ID)}（目前${stageText}。实际抽${drawCount}张，没有可加入手牌的休息室卡。）`,
      });
      if (confirmation) return confirmation;
    }

    const draw = stage.sharedUnit ? drawCardsForPlayer(game, player.id, 1) : null;
    const state = addAction(draw?.gameState ?? game, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      step: 'SAME_AQOURS_UNIT_DRAW',
      unitName: stage.sharedUnit?.name,
      distinctNames: stage.distinctNames,
      drawnCardIds: draw?.drawnCardIds ?? [],
    });
    const orderedResolution = options.orderedResolution === true;
    if (!stage.distinctNames || waitingRoomTargets(state, player.id).length === 0) {
      return context.continuePendingCardEffects(
        {
          ...state,
          pendingAbilities: state.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        orderedResolution
      );
    }

    return startWaitingRoomToHandWorkflow(state, {
      ability,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: RECOVER_STEP_ID,
      stepText: '请选择自己休息室中１张『Aqours』卡加入手牌。',
      selectionLabel: '选择要加入手牌的Aqours卡',
      confirmSelectionLabel: '加入手牌',
      candidateBuilder: waitingRoomTargets,
      countRule: { exactCount: 1 },
      optional: false,
      orderedResolution,
      trackWaitingRoomTargetLifecycle: true,
    });
  });

  registerActiveEffectStepHandler(
    ABILITY_ID,
    RECOVER_STEP_ID,
    (game, input, context) => {
      const effect = getCardActiveEffect(game);
      if (!effect) return game;
      return finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        {
          currentCandidateCardIds: waitingRoomTargets(game, effect.controllerId),
          trackWaitingRoomTargetLifecycle: true,
        }
      );
    },
    queryCardSelection
  );
}
