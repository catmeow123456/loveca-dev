import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  and,
  costGte,
  groupAliasIs,
  typeIs,
  type CardSelector,
} from '../../../effects/card-selectors.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import {
  S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
  S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
  S_BP7_017_ON_ENTER_MILL_BOTTOM_ONE_COST_TEN_MEMBER_GAIN_RED_BLUE_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MillBottomGainSourceMemberHeartsConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly count: number;
  readonly condition: 'GROUP_MEMBER_AQOURS' | 'CARD_TYPE_LIVE' | 'MEMBER_COST_GTE_10';
  readonly hearts: readonly {
    readonly color: HeartColor;
    readonly count: number;
  }[];
  readonly revealStepId: string;
  readonly conditionLabel: string;
  readonly rewardLabel: string;
  readonly actionStep: string;
}

const CONFIGS: readonly MillBottomGainSourceMemberHeartsConfig[] = [
  {
    abilityId:
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
    baseCardCode: 'PL!S-bp7-006',
    count: 3,
    condition: 'GROUP_MEMBER_AQOURS',
    hearts: [{ color: HeartColor.GREEN, count: 1 }],
    revealStepId: 'S_BP7_006_REVEAL_MILLED_BOTTOM_THREE',
    conditionLabel: '『Aqours』成员卡',
    rewardLabel: '[緑ハート]',
    actionStep: 'MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART',
  },
  {
    abilityId: S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
    baseCardCode: 'PL!S-bp7-015',
    count: 1,
    condition: 'CARD_TYPE_LIVE',
    hearts: [{ color: HeartColor.RED, count: 1 }],
    revealStepId: 'S_BP7_015_REVEAL_MILLED_BOTTOM_ONE',
    conditionLabel: 'LIVE卡',
    rewardLabel: '[赤ハート]',
    actionStep: 'MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART',
  },
  {
    abilityId: S_BP7_017_ON_ENTER_MILL_BOTTOM_ONE_COST_TEN_MEMBER_GAIN_RED_BLUE_HEART_ABILITY_ID,
    baseCardCode: 'PL!S-bp7-017',
    count: 1,
    condition: 'MEMBER_COST_GTE_10',
    hearts: [
      { color: HeartColor.RED, count: 1 },
      { color: HeartColor.BLUE, count: 1 },
    ],
    revealStepId: 'S_BP7_017_REVEAL_MILLED_BOTTOM_ONE',
    conditionLabel: '费用大于等于10的成员卡',
    rewardLabel: '[赤ハート][青ハート]',
    actionStep: 'MILL_BOTTOM_ONE_COST_TEN_MEMBER_GAIN_RED_BLUE_HEART',
  },
];

export function registerMillBottomAllMatchGainSourceMemberHeartsWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startMillBottomGainSourceMemberHeartsReveal(
        game,
        ability,
        config,
        options.orderedResolution === true,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.revealStepId,
      (game, _input, context) =>
        finishMillBottomGainSourceMemberHearts(game, config, context.continuePendingCardEffects)
    );
  }
}

function startMillBottomGainSourceMemberHeartsReveal(
  game: GameState,
  ability: PendingAbilityState,
  config: MillBottomGainSourceMemberHeartsConfig,
  orderedResolution: boolean,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const source = getCardById(game, ability.sourceCardId);
  const sourceValid =
    player !== null &&
    source !== null &&
    source.ownerId === ability.controllerId &&
    source.data.cardType === CardType.MEMBER &&
    cardCodeMatchesBase(source.data.cardCode, config.baseCardCode) &&
    getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) !== null;

  if (!player || !sourceValid) {
    const state = addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE',
        movedCardIds: [],
        conditionMet: false,
        heartBonus: [],
      }
    );
    return continuePendingCardEffects(state, orderedResolution);
  }

  const selector = getConditionSelector(config);
  const moveResult = moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    config.count,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
    }
  );
  if (!moveResult) {
    return game;
  }

  const movedCardIds = moveResult.movedCardIds;
  const conditionMet =
    movedCardIds.length === config.count &&
    movedCardIds.length > 0 &&
    allCardIdsMatchingSelector(moveResult.gameState, movedCardIds, selector);
  const refreshText = moveResult.refreshCount > 0 ? '期间发生卡组更新。' : '';
  const rewardText = conditionMet
    ? `这些卡均为${config.conditionLabel}。展示结束后获得${config.rewardLabel}。`
    : `这些卡不满足均为${config.conditionLabel}。展示结束后不获得${config.rewardLabel}。`;

  return startPendingActiveEffect(moveResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: withPublicRevealDwell({
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: config.revealStepId,
      stepText: `已将卡组底合计${movedCardIds.length}张放置入休息室。${refreshText}${rewardText}`,
      awaitingPlayerId: player.id,
      revealedCardIds: [...new Set(movedCardIds)],
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
        movedCardIds,
        conditionMet,
        refreshCount: moveResult.refreshCount,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_BOTTOM_CARDS',
      movedCardIds,
      conditionMet,
      refreshCount: moveResult.refreshCount,
    },
  });
}

function finishMillBottomGainSourceMemberHearts(
  game: GameState,
  config: MillBottomGainSourceMemberHeartsConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.revealStepId) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const movedCardIds = getStringArrayMetadata(effect.metadata?.movedCardIds);
  const conditionMet = effect.metadata?.conditionMet === true;
  let state: GameState = { ...game, activeEffect: null };
  let modifierApplied = false;
  if (conditionMet && getSourceMemberSlot(state, player.id, effect.sourceCardId) !== null) {
    const modifierResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: config.hearts,
    });
    if (modifierResult) {
      state = modifierResult.gameState;
      modifierApplied = true;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.actionStep,
      movedCardIds,
      refreshCount:
        typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0,
      conditionMet,
      heartBonus: modifierApplied ? config.hearts : [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getConditionSelector(config: MillBottomGainSourceMemberHeartsConfig): CardSelector {
  if (config.condition === 'CARD_TYPE_LIVE') {
    return typeIs(CardType.LIVE);
  }
  if (config.condition === 'MEMBER_COST_GTE_10') {
    return and(typeIs(CardType.MEMBER), costGte(10));
  }
  const member = typeIs(CardType.MEMBER);
  const aqours = groupAliasIs('Aqours');
  return (card) => member(card) && aqours(card);
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
