import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn } from '../../../../domain/rules/member-turn-state.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { PL_N_PB1_009_LIVE_START_NO_BLADE_HEART_MEMBER_LIVE_TO_WAITING_DRAW_GAIN_YELLOW_BLUE_PURPLE_HEART_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const HEART_BONUS = [
  { color: HeartColor.YELLOW, count: 1 },
  { color: HeartColor.BLUE, count: 1 },
  { color: HeartColor.PURPLE, count: 1 },
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPb1009RinaWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_PB1_009_LIVE_START_NO_BLADE_HEART_MEMBER_LIVE_TO_WAITING_DRAW_GAIN_YELLOW_BLUE_PURPLE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveRinaLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getConfirmationConfig
  );
}

function getConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const player = getPlayerById(game, ability.controllerId);
  const qualifyingMovedMemberCardIds =
    selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn(game, ability.controllerId);
  const conditionMet = qualifyingMovedMemberCardIds.length > 0;
  const canDraw =
    !!player && (player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0);
  const resultText = !conditionMet
    ? '未满足条件，实际不抽卡且不获得Heart'
    : canDraw
      ? '满足条件，实际将抽1张卡并获得[黄ハート][青ハート][紫ハート]'
      : '满足条件，当前没有可抽的卡，实际将抽0张卡并获得[黄ハート][青ハート][紫ハート]';

  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（本回合符合条件的成员卡 ${qualifyingMovedMemberCardIds.length}张，${resultText}。）`,
  };
}

function resolveRinaLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const qualifyingMovedMemberCardIds =
    selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn(game, player.id);
  const conditionMet = qualifyingMovedMemberCardIds.length > 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = conditionMet ? drawCardsForPlayer(stateWithoutPending, player.id, 1) : null;
  const stateAfterDraw = drawResult?.gameState ?? stateWithoutPending;
  const sourceSlot = getSourceMemberSlot(stateAfterDraw, player.id, ability.sourceCardId);
  const heartResult =
    conditionMet && sourceSlot !== null
      ? addHeartLiveModifierForMember(stateAfterDraw, {
          playerId: player.id,
          memberCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          hearts: HEART_BONUS,
        })
      : null;
  const stateAfterReward = heartResult?.gameState ?? stateAfterDraw;

  return continuePendingCardEffects(
    addAction(stateAfterReward, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: conditionMet
        ? 'CONDITION_MET_DRAW_GAIN_YELLOW_BLUE_PURPLE_HEART'
        : 'CONDITION_NOT_MET_NO_OP',
      qualifyingMovedMemberCardIds,
      conditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      heartBonus: heartResult?.heartBonus ?? [],
    }),
    orderedResolution
  );
}
