import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import type { CheerEvent } from '../../../../domain/events/game-events.js';
import { CardType, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
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
}

function getRubyLiveSuccessConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const matchingCardCount = player
    ? getRubyLiveSuccessMatchingCardIds(game, player.id).length
    : 0;
  return `${getAbilityEffectText(ability.abilityId)}（当前中心声援[スコア]Aqours LIVE ${matchingCardCount}张，${
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

function getRubyLiveSuccessMatchingCardIds(game: GameState, playerId: string): readonly string[] {
  const centerCheerCardIds = getOwnNonAdditionalCheerRevealedCardIds(game, playerId);
  const isScoreAqoursLive = and(typeIs(CardType.LIVE), groupAliasIs(AQOURS), hasScoreBladeHeart());
  return centerCheerCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === playerId && isScoreAqoursLive(card);
  });
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
  scoreBonus: number
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId,
    countDelta: scoreBonus,
    sourceCardId,
    abilityId,
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
