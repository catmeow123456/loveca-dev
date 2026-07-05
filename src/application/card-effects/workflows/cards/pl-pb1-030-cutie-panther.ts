import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { selectDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import {
  and,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { PL_PB1_030_LIVE_SUCCESS_DIFFERENT_BIBI_RECOVER_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from '../shared/waiting-room-to-hand.js';

const SELECT_BIBI_MEMBER_STEP_ID = 'PL_PB1_030_SELECT_BIBI_MEMBER_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb1030CutiePantherWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_PB1_030_LIVE_SUCCESS_DIFFERENT_BIBI_RECOVER_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startCutiePantherLiveSuccessWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PB1_030_LIVE_SUCCESS_DIFFERENT_BIBI_RECOVER_MEMBER_ABILITY_ID,
    SELECT_BIBI_MEMBER_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startCutiePantherLiveSuccessWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const differentNamedBiBiMembers = getDifferentNamedBiBiStageMembers(game, player.id);
  const candidateCardIds = getBiBiMemberWaitingRoomCardIds(game, player.id);
  if (differentNamedBiBiMembers.length < 2) {
    return consumeNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SKIP_CONDITION_NOT_MET',
      differentNamedBiBiMemberCount: differentNamedBiBiMembers.length,
      differentNamedBiBiMemberCardIds: differentNamedBiBiMembers.map((member) => member.cardId),
      differentNamedBiBiMemberNames: differentNamedBiBiMembers.map((member) => member.name),
      waitingRoomCandidateCount: candidateCardIds.length,
    });
  }
  if (candidateCardIds.length === 0) {
    return consumeNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SKIP_NO_TARGET',
      differentNamedBiBiMemberCount: differentNamedBiBiMembers.length,
      differentNamedBiBiMemberCardIds: differentNamedBiBiMembers.map((member) => member.cardId),
      differentNamedBiBiMemberNames: differentNamedBiBiMembers.map((member) => member.name),
      waitingRoomCandidateCount: 0,
    });
  }

  return startWaitingRoomToHandWorkflow(game, {
    ability,
    effectText: `${getAbilityEffectText(
      ability.abilityId
    )}（不同名BiBi成员 ${differentNamedBiBiMembers.length}名，休息室目标 ${candidateCardIds.length}张）`,
    stepId: SELECT_BIBI_MEMBER_STEP_ID,
    stepText: '请选择自己休息室中1张『BiBi』成员卡加入手牌。',
    candidateBuilder: (currentGame, playerId) => getBiBiMemberWaitingRoomCardIds(currentGame, playerId),
    countRule: { exactCount: 1 },
    optional: false,
    selectionRequiredWhenHasTargets: true,
    orderedResolution,
  });
}

function consumeNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function getBiBiMemberWaitingRoomCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, and(typeIs(CardType.MEMBER), unitAliasIs('BiBi')));
}

function getDifferentNamedBiBiStageMembers(
  game: GameState,
  playerId: string
): readonly { readonly cardId: string; readonly name: string }[] {
  return selectDifferentNamedCards(
    getStageMemberCardIdsMatching(game, playerId, and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'))),
    (cardId) => game.cardRegistry.get(cardId)?.data,
    { minCount: 1 }
  ).map((match) => ({
    cardId: match.item,
    name: match.name,
  }));
}
