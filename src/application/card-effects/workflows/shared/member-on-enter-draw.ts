import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
  PL_BP5_015_ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ABILITY_ID,
  PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
  HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
  SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
  SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID,
} from '../../ability-ids.js';
import {
  countSuccessfulLiveCards,
  hasStageMemberMatching,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { CardType } from '../../../../shared/types/enums.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MemberOnEnterDrawConfig {
  readonly abilityId: string;
  readonly drawCount: number;
  readonly actionStep: string;
  readonly minEnergyCount?: number;
  readonly minSuccessLiveCardCount?: number;
  readonly minSuccessLiveScore?: number;
  readonly minWaitingRoomCount?: number;
  readonly requiredOtherStageUnitAlias?: string;
}

const MEMBER_ON_ENTER_DRAW_CONFIGS: readonly MemberOnEnterDrawConfig[] = [
  {
    abilityId: PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE',
    minSuccessLiveCardCount: 1,
  },
  {
    abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_DRAW_ONE',
  },
  {
    abilityId: SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_ENERGY_SEVEN_DRAW_ONE',
    minEnergyCount: 7,
  },
  {
    abilityId: PL_BP5_015_ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ONE',
    minSuccessLiveScore: 3,
  },
  {
    abilityId: PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ONE',
    minSuccessLiveScore: 3,
  },
  {
    abilityId: HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE',
    minWaitingRoomCount: 10,
  },
  {
    abilityId: SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE',
    requiredOtherStageUnitAlias: '5yncri5e!',
  },
];

export function registerMemberOnEnterDrawWorkflowHandlers(): void {
  for (const config of MEMBER_ON_ENTER_DRAW_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveMemberOnEnterDraw(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveMemberOnEnterDraw(
  game: GameState,
  ability: PendingAbilityState,
  config: MemberOnEnterDrawConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterUseRecord = recordAbilityUseForContext(stateWithoutPending, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const energyCount = player.energyZone.cardIds.length;
  if (config.minEnergyCount !== undefined && energyCount < config.minEnergyCount) {
    return continuePendingCardEffects(
      addAction(stateAfterUseRecord, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'ENERGY_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        energyCount,
        requiredEnergyCount: config.minEnergyCount,
      }),
      orderedResolution
    );
  }
  const waitingRoomCount = player.waitingRoom.cardIds.length;
  if (config.minWaitingRoomCount !== undefined && waitingRoomCount < config.minWaitingRoomCount) {
    return continuePendingCardEffects(
      addAction(stateAfterUseRecord, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'WAITING_ROOM_COUNT_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        waitingRoomCount,
        requiredWaitingRoomCount: config.minWaitingRoomCount,
      }),
      orderedResolution
    );
  }
  const successLiveScore = sumSuccessfulLiveScore(game, player.id);
  const successLiveCardCount = countSuccessfulLiveCards(game, player.id);
  if (
    config.minSuccessLiveCardCount !== undefined &&
    successLiveCardCount < config.minSuccessLiveCardCount
  ) {
    return continuePendingCardEffects(
      addAction(stateAfterUseRecord, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SUCCESS_LIVE_CARD_COUNT_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        successLiveCardCount,
        requiredSuccessLiveCardCount: config.minSuccessLiveCardCount,
      }),
      orderedResolution
    );
  }
  if (
    config.minSuccessLiveScore !== undefined &&
    !successLiveScoreAtLeast(game, player.id, config.minSuccessLiveScore)
  ) {
    return continuePendingCardEffects(
      addAction(stateAfterUseRecord, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        successLiveScore,
        requiredSuccessLiveScore: config.minSuccessLiveScore,
      }),
      orderedResolution
    );
  }
  const hasRequiredOtherStageUnitMember =
    config.requiredOtherStageUnitAlias === undefined ||
    hasStageMemberMatching(
      game,
      player.id,
      and(typeIs(CardType.MEMBER), unitAliasIs(config.requiredOtherStageUnitAlias)),
      { excludeCardId: ability.sourceCardId }
    );
  if (!hasRequiredOtherStageUnitMember) {
    return continuePendingCardEffects(
      addAction(stateAfterUseRecord, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'OTHER_STAGE_UNIT_MEMBER_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        requiredOtherStageUnitAlias: config.requiredOtherStageUnitAlias,
        hasRequiredOtherStageUnitMember,
      }),
      orderedResolution
    );
  }

  const drawResult = drawCardsForPlayer(stateAfterUseRecord, player.id, config.drawCount);
  if (!drawResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      sourceSlot: ability.sourceSlot,
      energyCount,
      requiredEnergyCount: config.minEnergyCount,
      waitingRoomCount,
      requiredWaitingRoomCount: config.minWaitingRoomCount,
      successLiveScore,
      requiredSuccessLiveScore: config.minSuccessLiveScore,
      successLiveCardCount,
      requiredSuccessLiveCardCount: config.minSuccessLiveCardCount,
      requiredOtherStageUnitAlias: config.requiredOtherStageUnitAlias,
      hasRequiredOtherStageUnitMember,
      drawnCardIds: drawResult.drawnCardIds,
      drawCount: drawResult.drawnCardIds.length,
    }),
    orderedResolution
  );
}
