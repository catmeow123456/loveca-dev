import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_BP5_015_ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ABILITY_ID,
  HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
  SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID,
} from '../../ability-ids.js';
import { successLiveScoreAtLeast, sumSuccessfulLiveScore } from '../../../effects/conditions.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MemberOnEnterDrawConfig {
  readonly abilityId: string;
  readonly drawCount: number;
  readonly actionStep: string;
  readonly minEnergyCount?: number;
  readonly minSuccessLiveScore?: number;
  readonly minWaitingRoomCount?: number;
}

const MEMBER_ON_ENTER_DRAW_CONFIGS: readonly MemberOnEnterDrawConfig[] = [
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
    abilityId: HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE',
    minWaitingRoomCount: 10,
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
      drawnCardIds: drawResult.drawnCardIds,
      drawCount: drawResult.drawnCardIds.length,
    }),
    orderedResolution
  );
}
