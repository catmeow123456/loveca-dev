import {
  isLiveCardData,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
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
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  PL_S_PB1_007_LIVE_SUCCESS_CHEER_LIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
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
const MY_MAI_TONIGHT_CN = '我的舞蹈☆今夜';
const MY_MAI_TONIGHT_BASE_CARD_CODE = 'PL!S-bp2-023';
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
    PL_S_PB1_007_LIVE_SUCCESS_CHEER_LIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getPb1007LiveSuccessConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolvePb1007LiveSuccessPlaceWaitingEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
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

function getPb1007LiveSuccessConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const sourceOnStage = player ? isOwnMainStageMember(player, ability.sourceCardId) : false;
  const liveCheerCardIds = player ? getPb1007LiveSuccessCheerLiveCardIds(game, player.id) : [];
  const canPlaceEnergy = sourceOnStage && liveCheerCardIds.length > 0;
  return `${getAbilityEffectText(ability.abilityId)}（本次自己声援公开 LIVE ${liveCheerCardIds.length}张，${
    canPlaceEnergy
      ? '满足条件，将放置1张待机能量'
      : sourceOnStage
        ? '未满足条件，不放置能量'
        : '来源不在自己的舞台，不放置能量'
  }）`;
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
  const otherAqoursLiveCardIds = player
    ? getOtherAqoursLiveCardIds(game, player.id, ability.sourceCardId)
    : [];
  const stageMemberCardIds = player ? getOwnStageMemberCardIds(game, player.id) : [];
  return `${getAbilityEffectText(ability.abilityId)}（可计入的其他Aqours LIVE ${otherAqoursLiveCardIds.length}张，舞台成员 ${stageMemberCardIds.length}名，${
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

function resolvePb1007LiveSuccessPlaceWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceOnStage = isOwnMainStageMember(player, ability.sourceCardId);
  const liveCheerCardIds = getPb1007LiveSuccessCheerLiveCardIds(game, player.id);
  const conditionMet = sourceOnStage && liveCheerCardIds.length > 0;
  const placement = conditionMet
    ? placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.WAITING)
    : null;
  const stateAfterPlacement = placement?.gameState ?? game;
  const stateWithoutPending: GameState = {
    ...stateAfterPlacement,
    pendingAbilities: stateAfterPlacement.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? placement && placement.placedEnergyCardIds.length > 0
          ? 'CHEER_LIVE_PLACE_WAITING_ENERGY'
          : 'NO_OP_ENERGY_DECK_EMPTY'
        : sourceOnStage
          ? 'NO_OWN_CHEER_LIVE'
          : 'SOURCE_NOT_ON_STAGE',
      sourceOnStage,
      conditionMet,
      ownCheerLiveCardIds: liveCheerCardIds,
      ownCheerLiveCardCount: liveCheerCardIds.length,
      placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
      orientation: OrientationState.WAITING,
    }),
    orderedResolution
  );
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

  const otherAqoursLiveCardIds = getOtherAqoursLiveCardIds(
    game,
    player.id,
    ability.sourceCardId
  );
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

function getOtherAqoursLiveCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.liveZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      !!card &&
      cardId !== sourceCardId &&
      card.ownerId === player.id &&
      isLiveCardData(card.data) &&
      !isMyMaiTonightLiveCard(card) &&
      groupAliasIs(AQOURS)(card)
    );
  });
}

function isMyMaiTonightLiveCard(card: CardInstance): boolean {
  if (!isLiveCardData(card.data)) {
    return false;
  }
  return (
    cardCodeMatchesBase(card.data.cardCode, MY_MAI_TONIGHT_BASE_CARD_CODE) ||
    card.data.name === MY_MAI_TONIGHT ||
    card.data.nameJp === MY_MAI_TONIGHT ||
    card.data.nameCn === MY_MAI_TONIGHT_CN
  );
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

  const ownCheerCardIds = selectCurrentLiveRevealedCheerCardIds(game, player.id);
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
  return selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    cardTypes: CardType.LIVE,
  });
}

function getPb1007LiveSuccessCheerLiveCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return getOwnLiveSuccessCheerLiveCardIds(game, playerId);
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

function isOwnMainStageMember(
  player: NonNullable<ReturnType<typeof getPlayerById>>,
  cardId: string
): boolean {
  return STAGE_SLOTS.some((slot) => player.memberSlots.slots[slot] === cardId);
}

function getOwnNonAdditionalCheerRevealedCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    eventScope: 'NON_ADDITIONAL',
  });
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
