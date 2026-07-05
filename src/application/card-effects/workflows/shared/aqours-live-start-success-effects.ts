import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import type { CheerEvent } from '../../../../domain/events/game-events.js';
import { selectRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import { CardType, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
  S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID,
  S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
  S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  clearRemainingHeartsForPlayer,
  drawCardsForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { and, groupAliasIs, hasScoreBladeHeart, typeIs } from '../../../effects/card-selectors.js';

const AQOURS = 'Aqours';
const MY_MAI_TONIGHT = 'MY舞☆TONIGHT';
const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSFutureWaterBatch3WorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveMyMaiTonightLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => ({
      effectText: getMyMaiTonightLiveStartConfirmationEffectText(game, ability),
    })
  );
  registerPendingAbilityStarterHandler(
    S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getRubyLiveSuccessConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveRubyLiveSuccessCenterCheerScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
  registerPendingAbilityStarterHandler(
    S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBp6020GrantedLiveSuccessDrawOne(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getEnergyLeadLiveSuccessConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveEnergyLeadLiveSuccessScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
  registerPendingAbilityStarterHandler(
    S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getOwnCheerLiveCardLiveSuccessConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveOwnCheerLiveCardLiveSuccessScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
  registerPendingAbilityStarterHandler(
    S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getOpponentRemainingHeartsLiveSuccessConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveOpponentRemainingHeartsLiveSuccessScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function getRubyLiveSuccessConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const matchingCardCount = player
    ? getRubyLiveSuccessMatchingCardIds(game, player.id).length
    : 0;
  return `${getAbilityEffectText(ability.abilityId)}（当前声援[スコア]Aqours LIVE ${matchingCardCount}张，${
    matchingCardCount > 0 ? '满足条件，分数+1' : '未满足条件，不增加分数'
  }）`;
}

function getMyMaiTonightLiveStartConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const otherAqoursLiveCardIds = player ? getOtherAqoursLiveCardIds(game, player.id) : [];
  const stageMemberCardIds = player ? getOwnStageMemberCardIds(game, player.id) : [];
  return `${getAbilityEffectText(ability.abilityId)}（此卡以外Aqours LIVE ${otherAqoursLiveCardIds.length}张，舞台成员 ${stageMemberCardIds.length}名，${
    otherAqoursLiveCardIds.length > 0 ? '满足条件，各获得[BLADE]+1' : '未满足条件，不获得[BLADE]'
  }）`;
}

function getEnergyLeadLiveSuccessConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const ownEnergyCount = player?.energyZone.cardIds.length ?? 0;
  const opponentEnergyCount = opponent?.energyZone.cardIds.length ?? 0;
  return `${getAbilityEffectText(ability.abilityId)}（自己能量 ${ownEnergyCount}张，对方能量 ${opponentEnergyCount}张，${
    opponentEnergyCount > ownEnergyCount ? '满足条件，分数+1' : '未满足条件，不增加分数'
  }）`;
}

function getOwnCheerLiveCardLiveSuccessConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const matchingCardCount = player
    ? getOwnLiveSuccessCheerLiveCardIds(game, player.id).length
    : 0;
  return `${getAbilityEffectText(ability.abilityId)}（本次自己声援公开 LIVE ${matchingCardCount}张，${
    matchingCardCount > 0 ? '满足条件，分数+1' : '未满足条件，不增加分数'
  }）`;
}

function getOpponentRemainingHeartsLiveSuccessConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const opponentRemainingHeartTotalCount = opponent
    ? getRemainingHeartTotalCount(game, opponent.id)
    : 0;
  return `${getAbilityEffectText(ability.abilityId)}（对方余Heart ${opponentRemainingHeartTotalCount}个，${
    opponentRemainingHeartTotalCount >= 2 ? '清除并满足分数+1' : '清除但不增加分数'
  }）`;
}

function resolveMyMaiTonightLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const otherAqoursLiveCardIds = getOtherAqoursLiveCardIds(game, player.id);
  const conditionMet = otherAqoursLiveCardIds.length > 0;
  const targetMemberCardIds = conditionMet ? getOwnStageMemberCardIds(game, player.id) : [];
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const appliedTargetMemberCardIds: string[] = [];

  for (const targetMemberCardId of targetMemberCardIds) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: targetMemberCardId,
      abilityId: ability.abilityId,
      amount: 1,
    });
    if (!bladeResult) {
      continue;
    }
    state = bladeResult.gameState;
    appliedTargetMemberCardIds.push(targetMemberCardId);
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE' : 'NO_OTHER_AQOURS_LIVE',
      otherAqoursLiveCardIds,
      targetMemberCardIds,
      appliedTargetMemberCardIds,
      bladeBonusPerMember: conditionMet ? 1 : 0,
    }),
    orderedResolution
  );
}

function getOtherAqoursLiveCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.liveZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      !!card &&
      card.ownerId === player.id &&
      isLiveCardData(card.data) &&
      card.data.name !== MY_MAI_TONIGHT &&
      groupAliasIs(AQOURS)(card)
    );
  });
}

function resolveRubyLiveSuccessCenterCheerScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const centerCheerCardIds = getOwnNonAdditionalCheerRevealedCardIds(game, player.id);
  const matchingCardIds = getRubyLiveSuccessMatchingCardIds(game, player.id);
  const scoreBonus = matchingCardIds.length > 0 ? 1 : 0;
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (scoreBonus > 0) {
    state = addScoreModifierAndRefresh(
      state,
      player.id,
      ability.sourceCardId,
      ability.abilityId,
      scoreBonus
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        scoreBonus > 0
          ? 'CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE'
          : 'NO_CENTER_CHEER_SCORE_AQOURS_LIVE',
      centerCheerCardIds,
      matchingCardIds,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveBp6020GrantedLiveSuccessDrawOne(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const guard = getBp6020GrantedDrawGuard(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let drawnCardIds: readonly string[] = [];
  if (guard.granted) {
    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (drawResult) {
      state = drawResult.gameState;
      drawnCardIds = drawResult.drawnCardIds;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: guard.granted ? 'GRANTED_LIVE_SUCCESS_DRAW_ONE' : 'GRANTED_DRAW_GUARD_NOT_MET',
      sourceLiveCardId: ability.sourceCardId,
      grantedTurnCount: guard.grantedTurnCount,
      currentTurnCount: game.turnCount,
      sourceLiveSucceeded: guard.sourceLiveSucceeded,
      drawnCardIds,
    }),
    orderedResolution
  );
}

function getBp6020GrantedDrawGuard(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly granted: boolean;
  readonly grantedTurnCount: number | null;
  readonly sourceLiveSucceeded: boolean;
} {
  const grantAction = [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID &&
        action.payload.step === 'GRANT_LIVE_SUCCESS_DRAW_ONE' &&
        action.payload.sourceLiveCardId === ability.sourceCardId &&
        action.payload.grantedTurnCount === game.turnCount
    );
  const sourceLiveSucceeded = game.liveResolution.liveResults.get(ability.sourceCardId) === true;
  return {
    granted: grantAction !== undefined && sourceLiveSucceeded,
    grantedTurnCount:
      typeof grantAction?.payload.grantedTurnCount === 'number'
        ? grantAction.payload.grantedTurnCount
        : null,
    sourceLiveSucceeded,
  };
}

function resolveEnergyLeadLiveSuccessScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const ownEnergyCount = player.energyZone.cardIds.length;
  const opponentEnergyCount = opponent.energyZone.cardIds.length;
  const scoreBonus = opponentEnergyCount > ownEnergyCount ? 1 : 0;
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (scoreBonus > 0) {
    state = addScoreModifierAndRefresh(
      state,
      player.id,
      ability.sourceCardId,
      ability.abilityId,
      scoreBonus,
      ability.sourceCardId
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        scoreBonus > 0
          ? 'OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE'
          : 'NO_OPPONENT_ENERGY_MORE',
      ownEnergyCount,
      opponentEnergyCount,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveOwnCheerLiveCardLiveSuccessScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const ownCheerCardIds = selectRevealedCheerCardIds(game, player.id);
  const matchingCardIds = getOwnLiveSuccessCheerLiveCardIds(game, player.id);
  const scoreBonus = matchingCardIds.length > 0 ? 1 : 0;
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (scoreBonus > 0) {
    state = addScoreModifierAndRefresh(
      state,
      player.id,
      ability.sourceCardId,
      ability.abilityId,
      scoreBonus,
      ability.sourceCardId
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: scoreBonus > 0 ? 'OWN_CHEER_LIVE_THIS_LIVE_SCORE' : 'NO_OWN_CHEER_LIVE',
      ownCheerCardIds,
      matchingCardIds,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveOpponentRemainingHeartsLiveSuccessScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const opponentRemainingHeartTotalCount = getRemainingHeartTotalCount(game, opponent.id);
  const clearResult = clearRemainingHeartsForPlayer(game, opponent.id);
  const scoreBonus = clearResult.lostTotalCount >= 2 ? 1 : 0;
  let state: GameState = {
    ...clearResult.gameState,
    pendingAbilities: clearResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  if (scoreBonus > 0) {
    state = addScoreModifierAndRefresh(
      state,
      player.id,
      ability.sourceCardId,
      ability.abilityId,
      scoreBonus,
      ability.sourceCardId
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        scoreBonus > 0
          ? 'OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE'
          : 'OPPONENT_LOSE_REMAINING_HEARTS_NO_SCORE',
      opponentId: opponent.id,
      opponentRemainingHeartTotalCount,
      lostHearts: clearResult.lostHearts,
      lostTotalCount: clearResult.lostTotalCount,
      scoreBonus,
    }),
    orderedResolution
  );
}

function getRubyLiveSuccessMatchingCardIds(game: GameState, playerId: string): readonly string[] {
  const centerCheerCardIds = getOwnNonAdditionalCheerRevealedCardIds(game, playerId);
  const isScoreAqoursLive = and(typeIs(CardType.LIVE), groupAliasIs(AQOURS), hasScoreBladeHeart());
  return centerCheerCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === playerId && isScoreAqoursLive(card);
  });
}

function getOwnLiveSuccessCheerLiveCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, (card) => isLiveCardData(card.data));
}

function getOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId && card && card.ownerId === player.id && isMemberCardData(card.data)
      ? [cardId]
      : [];
  });
}

function getOwnNonAdditionalCheerRevealedCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const latestCenterCheerEvent = game.eventLog
    .map((entry) => entry.event)
    .reverse()
    .find(
      (event): event is CheerEvent =>
        event.eventType === TriggerCondition.ON_CHEER &&
        'playerId' in event &&
        event.playerId === playerId &&
        event.additional !== true
    );
  if (!latestCenterCheerEvent) {
    return [];
  }

  const currentCheerCardIds = getCurrentLiveCheerCardIds(game, playerId);
  const currentCheerCardIdSet = new Set(currentCheerCardIds);
  return latestCenterCheerEvent.revealedCardIds.filter((cardId) =>
    currentCheerCardIdSet.has(cardId)
  );
}

function getCurrentLiveCheerCardIds(game: GameState, playerId: string): readonly string[] {
  const firstPlayerId = game.players[game.firstPlayerIndex]?.id ?? null;
  if (playerId === firstPlayerId) {
    return game.liveResolution.firstPlayerCheerCardIds;
  }
  return game.liveResolution.secondPlayerCheerCardIds;
}

function addScoreModifierAndRefresh(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string,
  scoreBonus: number,
  liveCardId?: string
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId,
    countDelta: scoreBonus,
    sourceCardId,
    abilityId,
    ...(liveCardId ? { liveCardId } : {}),
  };
  const stateAfterModifier = addLiveModifier(game, modifier);
  const playerScores = new Map(stateAfterModifier.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...stateAfterModifier,
    liveResolution: {
      ...stateAfterModifier.liveResolution,
      playerScores,
    },
  };
}
