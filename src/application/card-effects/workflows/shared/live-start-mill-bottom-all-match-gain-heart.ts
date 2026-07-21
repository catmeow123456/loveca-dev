import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs, typeIs, type CardSelector } from '../../../effects/card-selectors.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import {
  S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
  S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MillBottomGainHeartConfig {
  readonly abilityId: string;
  readonly exactCardCode: string;
  readonly count: number;
  readonly condition: 'GROUP_MEMBER_AQOURS' | 'CARD_TYPE_LIVE';
  readonly heartColor: HeartColor;
  readonly revealStepId: string;
  readonly conditionLabel: string;
  readonly rewardLabel: string;
  readonly actionStep: string;
}

const CONFIGS: readonly MillBottomGainHeartConfig[] = [
  {
    abilityId:
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
    exactCardCode: 'PL!S-bp7-006-P',
    count: 3,
    condition: 'GROUP_MEMBER_AQOURS',
    heartColor: HeartColor.GREEN,
    revealStepId: 'S_BP7_006_REVEAL_MILLED_BOTTOM_THREE',
    conditionLabel: '『Aqours』成员卡',
    rewardLabel: '[緑ハート]',
    actionStep: 'MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART',
  },
  {
    abilityId: S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
    exactCardCode: 'PL!S-bp7-015-N',
    count: 1,
    condition: 'CARD_TYPE_LIVE',
    heartColor: HeartColor.RED,
    revealStepId: 'S_BP7_015_REVEAL_MILLED_BOTTOM_ONE',
    conditionLabel: 'LIVE卡',
    rewardLabel: '[赤ハート]',
    actionStep: 'MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART',
  },
];

export function registerLiveStartMillBottomAllMatchGainHeartWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startMillBottomGainHeartReveal(
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
        finishMillBottomGainHeart(game, config, context.continuePendingCardEffects)
    );
  }
}

function startMillBottomGainHeartReveal(
  game: GameState,
  ability: PendingAbilityState,
  config: MillBottomGainHeartConfig,
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
    source.data.cardCode === config.exactCardCode &&
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
    ? `这些卡均为${config.conditionLabel}。确认后获得${config.rewardLabel}。`
    : `这些卡不满足均为${config.conditionLabel}。确认后不获得${config.rewardLabel}。`;

  return startPendingActiveEffect(moveResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
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
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_BOTTOM_CARDS',
      movedCardIds,
      conditionMet,
      refreshCount: moveResult.refreshCount,
    },
  });
}

function finishMillBottomGainHeart(
  game: GameState,
  config: MillBottomGainHeartConfig,
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
      hearts: [{ color: config.heartColor, count: 1 }],
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
      heartBonus: modifierApplied ? [{ color: config.heartColor, count: 1 }] : [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getConditionSelector(config: MillBottomGainHeartConfig): CardSelector {
  if (config.condition === 'CARD_TYPE_LIVE') {
    return typeIs(CardType.LIVE);
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
