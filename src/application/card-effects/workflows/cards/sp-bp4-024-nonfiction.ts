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
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import {
  SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID,
  SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  type AddBladeLiveModifierForSourceMemberResult,
} from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp4024NonfictionWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveCenterLiellaHigherCostScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getCenterLiellaHigherCostConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLeftLiellaRedHeartBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLeftLiellaRedHeartConfirmationConfig
  );
}

function getCenterLiellaHigherCostConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getCenterLiellaHigherCostContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（自己中央费用 ${context.ownCenterCost ?? '-'}，对方中央费用 ${context.opponentCenterCost ?? '-'}，${context.conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'}）`,
  };
}

function getLeftLiellaRedHeartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getLeftLiellaRedHeartContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（左侧Liella!成员：${context.leftMemberIsLiella ? '存在' : '不存在'}，[赤ハート]${context.leftRedHeartCount}个，${context.conditionMet ? '满足条件' : '未满足条件'}）`,
  };
}

function resolveCenterLiellaHigherCostScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const {
    ownCenterCardId,
    opponentCenterCardId,
    ownCenterIsLiella,
    ownCenterCost,
    opponentCenterCost,
    conditionMet,
  } = getCenterLiellaHigherCostContext(game, ability);
  const scoreBonus = conditionMet ? 1 : 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier = conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: scoreBonus,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus)
    : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE',
      ownCenterCardId,
      opponentCenterCardId,
      ownCenterIsLiella,
      ownCenterCost,
      opponentCenterCost,
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveLeftLiellaRedHeartBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const { leftMemberCardId, leftMemberIsLiella, leftRedHeartCount, conditionMet } =
    getLeftLiellaRedHeartContext(game, ability);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const bladeResult =
    conditionMet && leftMemberCardId
      ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
          playerId: player.id,
          sourceCardId: leftMemberCardId,
          abilityId: ability.abilityId,
          amount: 2,
        })
      : null;
  const stateAfterModifier = getStateAfterBladeModifier(stateWithoutPending, bladeResult);
  const bladeBonus = bladeResult?.bladeBonus ?? 0;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE',
      targetMemberCardId: leftMemberCardId,
      leftMemberIsLiella,
      leftRedHeartCount,
      conditionMet,
      bladeBonus,
    }),
    orderedResolution
  );
}

function getCenterLiellaHigherCostContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly ownCenterCardId: string | null;
  readonly opponentCenterCardId: string | null;
  readonly ownCenterIsLiella: boolean;
  readonly ownCenterCost: number | null;
  readonly opponentCenterCost: number | null;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId);
  if (!player) {
    return {
      ownCenterCardId: null,
      opponentCenterCardId: opponent?.memberSlots.slots[SlotPosition.CENTER] ?? null,
      ownCenterIsLiella: false,
      ownCenterCost: null,
      opponentCenterCost: null,
      conditionMet: false,
    };
  }

  const ownCenterCardId = player.memberSlots.slots[SlotPosition.CENTER];
  const opponentCenterCardId = opponent?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  const ownCenterCard = ownCenterCardId ? getCardById(game, ownCenterCardId) : null;
  const opponentCenterCard = opponentCenterCardId ? getCardById(game, opponentCenterCardId) : null;
  const ownCenterCost =
    ownCenterCardId && ownCenterCard && isMemberCardData(ownCenterCard.data)
      ? getMemberEffectiveCost(game, player.id, ownCenterCardId)
      : null;
  const opponentCenterCost =
    opponentCenterCardId &&
    opponent &&
    opponentCenterCard &&
    isMemberCardData(opponentCenterCard.data)
      ? getMemberEffectiveCost(game, opponent.id, opponentCenterCardId)
      : null;
  const ownCenterIsLiella =
    ownCenterCard !== null &&
    isMemberCardData(ownCenterCard.data) &&
    cardBelongsToGroup(ownCenterCard.data, 'Liella!');
  const conditionMet =
    ownCenterIsLiella &&
    ownCenterCost !== null &&
    opponentCenterCost !== null &&
    ownCenterCost > opponentCenterCost;

  return {
    ownCenterCardId,
    opponentCenterCardId,
    ownCenterIsLiella,
    ownCenterCost,
    opponentCenterCost,
    conditionMet,
  };
}

function getLeftLiellaRedHeartContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly leftMemberCardId: string | null;
  readonly leftMemberIsLiella: boolean;
  readonly leftRedHeartCount: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      leftMemberCardId: null,
      leftMemberIsLiella: false,
      leftRedHeartCount: 0,
      conditionMet: false,
    };
  }

  const leftMemberCardId = player.memberSlots.slots[SlotPosition.LEFT];
  const leftMemberCard = leftMemberCardId ? getCardById(game, leftMemberCardId) : null;
  const leftMemberIsLiella =
    leftMemberCard !== null &&
    isMemberCardData(leftMemberCard.data) &&
    cardBelongsToGroup(leftMemberCard.data, 'Liella!');
  const leftRedHeartCount = leftMemberCardId
    ? countRedHearts(getMemberEffectiveHeartIcons(game, player.id, leftMemberCardId))
    : 0;
  return {
    leftMemberCardId,
    leftMemberIsLiella,
    leftRedHeartCount,
    conditionMet: leftMemberIsLiella && leftRedHeartCount >= 3,
  };
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

function getStateAfterBladeModifier(
  fallbackState: GameState,
  bladeResult: AddBladeLiveModifierForSourceMemberResult | null
): GameState {
  return bladeResult?.gameState ?? fallbackState;
}

function countRedHearts(
  hearts: readonly { readonly color: HeartColor; readonly count: number }[]
): number {
  return hearts.reduce(
    (total, heart) => total + (heart.color === HeartColor.RED ? heart.count : 0),
    0
  );
}
