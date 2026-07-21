import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
  PL_BP5_015_ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ABILITY_ID,
  PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
  PL_BP3_009_ON_ENTER_COST_THIRTEEN_DRAW_ONE_ABILITY_ID,
  S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID,
  HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
  SP_BP1_008_ON_ENTER_DRAW_ONE_BONUS_IF_MEI_ABILITY_ID,
  SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID,
  SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
  SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID,
} from '../../ability-ids.js';
import {
  countSuccessfulLiveCards,
  hasStageMemberMatching,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import { and, cardNameAliasIs, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { CardType } from '../../../../shared/types/enums.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MemberOnEnterDrawConfig {
  readonly abilityId: string;
  readonly drawCount: number;
  readonly actionStep: string;
  readonly minEnergyCount?: number;
  readonly energyPerDraw?: number;
  readonly minSuccessLiveCardCount?: number;
  readonly minSuccessLiveScore?: number;
  readonly minWaitingRoomCount?: number;
  readonly requiredOtherStageUnitAlias?: string;
  readonly bonusDrawCount?: number;
  readonly bonusStageMemberName?: string;
  readonly minStageMemberEffectiveCost?: number;
  readonly requiredStageMemberGroupAlias?: string;
}

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

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
    abilityId: SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID,
    drawCount: 0,
    actionStep: 'ON_ENTER_DRAW_PER_SIX_ENERGY',
    energyPerDraw: 6,
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
  {
    abilityId: SP_BP1_008_ON_ENTER_DRAW_ONE_BONUS_IF_MEI_ABILITY_ID,
    drawCount: 1,
    actionStep: 'ON_ENTER_DRAW_ONE_BONUS_IF_MEI',
    bonusDrawCount: 1,
    bonusStageMemberName: '米女メイ',
  },
  {
    abilityId: PL_BP3_009_ON_ENTER_COST_THIRTEEN_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'COST_THIRTEEN_STAGE_MEMBER_DRAW_ONE',
    minStageMemberEffectiveCost: 13,
  },
  {
    abilityId: S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID,
    drawCount: 1,
    actionStep: 'AQOURS_COST_NINE_STAGE_MEMBER_DRAW_ONE',
    minStageMemberEffectiveCost: 9,
    requiredStageMemberGroupAlias: 'Aqours',
  },
];

export function registerMemberOnEnterDrawWorkflowHandlers(): void {
  for (const config of MEMBER_ON_ENTER_DRAW_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      if (config.minStageMemberEffectiveCost !== undefined) {
        const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
          game,
          ability,
          options,
          { effectText: getStageCostConfirmationEffectText(game, ability, config) }
        );
        if (confirmation) {
          return confirmation;
        }
      }
      return resolveMemberOnEnterDraw(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    });
  }
}

function getQualifyingStageMemberCardIds(
  game: GameState,
  playerId: string,
  config: MemberOnEnterDrawConfig
): readonly string[] {
  if (config.minStageMemberEffectiveCost === undefined) {
    return [];
  }
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    if (
      !cardId ||
      !card ||
      !isMemberCardData(card.data) ||
      getMemberEffectiveCost(game, playerId, cardId) < config.minStageMemberEffectiveCost! ||
      (config.requiredStageMemberGroupAlias !== undefined &&
        !cardBelongsToGroup(card.data, config.requiredStageMemberGroupAlias))
    ) {
      return [];
    }
    return [cardId];
  });
}

function getStageCostConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState,
  config: MemberOnEnterDrawConfig
): string {
  const player = getPlayerById(game, ability.controllerId);
  const qualifyingCardIds = getQualifyingStageMemberCardIds(game, ability.controllerId, config);
  const conditionMet = qualifyingCardIds.length > 0;
  const canDraw =
    !!player && (player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0);
  const groupText = config.requiredStageMemberGroupAlias
    ? `的『${config.requiredStageMemberGroupAlias}』`
    : '的';
  const resultText = !conditionMet
    ? '未满足条件，实际抽0张卡'
    : canDraw
      ? '满足条件，实际抽1张卡'
      : '满足条件，但当前没有可抽的卡，实际抽0张卡';
  return `${getAbilityEffectText(ability.abilityId)}（当前自己舞台费用大于等于${config.minStageMemberEffectiveCost}${groupText}成员 ${qualifyingCardIds.length}名，${resultText}。）`;
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

  const hasBonusStageMember =
    config.bonusStageMemberName !== undefined &&
    hasStageMemberMatching(game, player.id, cardNameAliasIs(config.bonusStageMemberName));
  const qualifyingStageMemberCardIds = getQualifyingStageMemberCardIds(game, player.id, config);
  const stageMemberCostConditionMet =
    config.minStageMemberEffectiveCost === undefined || qualifyingStageMemberCardIds.length > 0;
  const dynamicEnergyDrawCount =
    config.energyPerDraw === undefined ? 0 : Math.floor(energyCount / config.energyPerDraw);
  const requestedDrawCount = stageMemberCostConditionMet
    ? config.drawCount +
      dynamicEnergyDrawCount +
      (hasBonusStageMember ? (config.bonusDrawCount ?? 0) : 0)
    : 0;
  const drawResult =
    requestedDrawCount === 0
      ? { gameState: stateAfterUseRecord, drawnCardIds: [] as readonly string[] }
      : drawCardsForPlayer(stateAfterUseRecord, player.id, requestedDrawCount) ?? {
          gameState: stateAfterUseRecord,
          drawnCardIds: [] as readonly string[],
        };

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      sourceSlot: ability.sourceSlot,
      energyCount,
      requiredEnergyCount: config.minEnergyCount,
      energyPerDraw: config.energyPerDraw,
      waitingRoomCount,
      requiredWaitingRoomCount: config.minWaitingRoomCount,
      successLiveScore,
      requiredSuccessLiveScore: config.minSuccessLiveScore,
      successLiveCardCount,
      requiredSuccessLiveCardCount: config.minSuccessLiveCardCount,
      requiredOtherStageUnitAlias: config.requiredOtherStageUnitAlias,
      hasRequiredOtherStageUnitMember,
      bonusStageMemberName: config.bonusStageMemberName,
      hasBonusStageMember,
      minStageMemberEffectiveCost: config.minStageMemberEffectiveCost,
      requiredStageMemberGroupAlias: config.requiredStageMemberGroupAlias,
      qualifyingStageMemberCardIds,
      stageMemberCostConditionMet,
      requestedDrawCount,
      drawnCardIds: drawResult.drawnCardIds,
      drawCount: drawResult.drawnCardIds.length,
    }),
    orderedResolution
  );
}
