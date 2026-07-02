import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot, type PlayerState } from '../../../../domain/entities/player.js';
import {
  addHeartLiveModifierForMember,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../ability-definition-types.js';
import {
  N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
  N_BP5_030_AUTO_STAGE_MEMBER_LIVE_SUCCESS_RESOLVED_DRAW_ABILITY_ID,
} from '../../ability-ids.js';
import {
  findCardAbilityDefinitionById,
  getCardAbilityDefinitionsForCardCode,
} from '../../definitions/lookup.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerResolvedAbilityObserver } from '../../runtime/resolved-ability-observers.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const LIVE_START_UNRESOLVED_STEPS = new Set([
  'CHECK_DISCARD_COST',
  'NOT_ENOUGH_ACTIVE_ENERGY',
  'NOT_ENOUGH_HAND_TO_DISCARD',
  'SKIP_DISCARD',
  'SKIP_DISCARD_COST',
  'SKIP_NOT_ENOUGH_HAND_TO_DISCARD',
  'SKIP_PAY_ENERGY_DISCARD_COST',
  'SKIP_PAY_FAILED',
]);

export function registerNBp5030RyouranVictoryRoadWorkflowHandlers(): void {
  registerResolvedAbilityObserver((game, context) =>
    enqueueNBp5030ResolvedAbilityObserver(game, context.resolvedAction)
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveStartResolvedGainAllHeart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLiveStartConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_030_AUTO_STAGE_MEMBER_LIVE_SUCCESS_RESOLVED_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveSuccessResolvedDraw(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    () => ({
      stepText: '确认后抽1张卡。',
    })
  );
}

function enqueueNBp5030ResolvedAbilityObserver(
  game: GameState,
  resolvedAction: GameAction
): GameState {
  const resolved = getResolvedOwnStageMemberLiveAbility(game, resolvedAction);
  if (!resolved) {
    return game;
  }

  const observerAbilityId =
    resolved.category === CardAbilityCategory.LIVE_START
      ? N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID
      : N_BP5_030_AUTO_STAGE_MEMBER_LIVE_SUCCESS_RESOLVED_DRAW_ABILITY_ID;
  const player = getPlayerById(game, resolved.playerId);
  if (!player) {
    return game;
  }

  let state = game;
  for (const liveCardId of player.liveZone.cardIds) {
    const liveCard = getCardById(state, liveCardId);
    if (!liveCard || liveCard.ownerId !== player.id || !isLiveCardData(liveCard.data)) {
      continue;
    }
    const hasRyouranAbility = getCardAbilityDefinitionsForCardCode(liveCard.data.cardCode).some(
      (definition) =>
        definition.abilityId === observerAbilityId &&
        definition.sourceZone === CardAbilitySourceZone.LIVE_CARD &&
        definition.category === CardAbilityCategory.AUTO
    );
    if (!hasRyouranAbility) {
      continue;
    }

    const pendingAbilityId = `${observerAbilityId}:${liveCardId}:resolved-${resolvedAction.id}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId: observerAbilityId,
      sourceCardId: liveCardId,
      controllerId: player.id,
      mandatory: true,
      timingId:
        resolved.category === CardAbilityCategory.LIVE_START
          ? TriggerCondition.ON_LIVE_START
          : TriggerCondition.ON_LIVE_SUCCESS,
      eventIds: [resolvedAction.id],
      metadata: {
        resolvedObserverImmediate: true,
        resolvedActionId: resolvedAction.id,
        resolvedAbilityId: resolved.abilityId,
        resolvedMemberCardId: resolved.memberCardId,
        resolvedSourceSlot: resolved.sourceSlot,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      player.id,
      {
        pendingAbilityId,
        abilityId: observerAbilityId,
        sourceCardId: liveCardId,
        timingId: pendingAbility.timingId,
        resolvedActionId: resolvedAction.id,
        resolvedAbilityId: resolved.abilityId,
        resolvedMemberCardId: resolved.memberCardId,
        resolvedSourceSlot: resolved.sourceSlot,
      }
    );
  }

  return state;
}

function resolveLiveStartResolvedGainAllHeart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = removePending(game, ability.id);
  const sourceLiveInLiveZone = isOwnLiveCardInLiveZone(
    stateWithoutPending,
    player.id,
    ability.sourceCardId
  );
  const targetMemberId = getResolvedMemberCardId(ability);
  const target = targetMemberId
    ? getOwnStageMemberContext(stateWithoutPending, player.id, targetMemberId)
    : null;
  const allHeartCountBefore = target
    ? countAllHearts(
        getMemberEffectiveHeartIcons(stateWithoutPending, player.id, target.memberCardId)
      )
    : 0;
  const conditionMet = sourceLiveInLiveZone && target !== null && allHeartCountBefore === 0;
  const heartResult = conditionMet
    ? addHeartLiveModifierForMember(stateWithoutPending, {
        playerId: player.id,
        memberCardId: target.memberCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      })
    : null;
  const stateAfterModifier = heartResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'RYOURAN_GAIN_ALL_HEART' : 'RYOURAN_GAIN_ALL_HEART_CONDITION_NOT_MET',
      sourceLiveInLiveZone,
      targetMemberId,
      targetStillOnStage: target !== null,
      targetSlot: target?.sourceSlot ?? null,
      allHeartCountBefore,
      conditionMet,
      heartBonus: heartResult?.heartBonus ?? [],
      resolvedAbilityId: ability.metadata?.resolvedAbilityId ?? null,
      resolvedActionId: ability.metadata?.resolvedActionId ?? null,
    }),
    orderedResolution
  );
}

function resolveLiveSuccessResolvedDraw(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = removePending(game, ability.id);
  const sourceLiveInLiveZone = isOwnLiveCardInLiveZone(
    stateWithoutPending,
    player.id,
    ability.sourceCardId
  );
  const drawResult = sourceLiveInLiveZone
    ? drawCardsForPlayer(stateWithoutPending, player.id, 1)
    : null;
  const stateAfterDraw = drawResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterDraw, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: sourceLiveInLiveZone ? 'RYOURAN_DRAW_ONE' : 'RYOURAN_DRAW_ONE_CONDITION_NOT_MET',
      sourceLiveInLiveZone,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      resolvedAbilityId: ability.metadata?.resolvedAbilityId ?? null,
      resolvedActionId: ability.metadata?.resolvedActionId ?? null,
      resolvedMemberCardId: ability.metadata?.resolvedMemberCardId ?? null,
    }),
    orderedResolution
  );
}

function getLiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const targetMemberId = getResolvedMemberCardId(ability);
  const target =
    player && targetMemberId ? getOwnStageMemberContext(game, player.id, targetMemberId) : null;
  if (!player || !targetMemberId || !target) {
    return {
      effectText: `${getAbilityEffectText(ability.abilityId)}（目标成员已不在自己舞台，确认后不获得[ALLハート]。）`,
      stepText: '确认后继续处理此效果。',
    };
  }

  const allHeartCount = countAllHearts(
    getMemberEffectiveHeartIcons(game, player.id, target.memberCardId)
  );
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前目标成员[ALLハート] ${allHeartCount}个，${
      allHeartCount === 0 ? '满足条件，确认后获得[ALLハート]' : '未满足条件，不获得[ALLハート]'
    }。）`,
    stepText:
      allHeartCount === 0 ? '确认后该成员获得[ALLハート]。' : '确认后不增加该成员的Heart。',
  };
}

function getResolvedOwnStageMemberLiveAbility(
  game: GameState,
  action: GameAction
): {
  readonly abilityId: string;
  readonly category: CardAbilityCategory.LIVE_START | CardAbilityCategory.LIVE_SUCCESS;
  readonly memberCardId: string;
  readonly playerId: string;
  readonly sourceSlot: SlotPosition;
} | null {
  if (!isResolvedAbilityFinalResolutionAction(action)) {
    return null;
  }

  const abilityId = typeof action.payload.abilityId === 'string' ? action.payload.abilityId : null;
  const sourceCardId =
    typeof action.payload.sourceCardId === 'string' ? action.payload.sourceCardId : null;
  if (!abilityId || !sourceCardId) {
    return null;
  }

  const definition = findCardAbilityDefinitionById(abilityId);
  if (
    !definition ||
    definition.sourceZone !== CardAbilitySourceZone.STAGE_MEMBER ||
    (definition.category !== CardAbilityCategory.LIVE_START &&
      definition.category !== CardAbilityCategory.LIVE_SUCCESS)
  ) {
    return null;
  }

  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard || !isMemberCardData(sourceCard.data)) {
    return null;
  }

  const player = getPlayerById(game, sourceCard.ownerId);
  if (!player) {
    return null;
  }
  const sourceSlot = getSourceSlotForResolvedStageMember(action, player, sourceCardId);
  if (!sourceSlot) {
    return null;
  }

  return {
    abilityId,
    category: definition.category,
    memberCardId: sourceCardId,
    playerId: player.id,
    sourceSlot,
  };
}

function isResolvedAbilityFinalResolutionAction(action: GameAction): boolean {
  const step = typeof action.payload.step === 'string' ? action.payload.step : '';
  if (step.length === 0) {
    return true;
  }
  if (step === 'ABILITY_USE' || step === 'ACTIVATED_ABILITY_USE') {
    return false;
  }
  if (step === 'START_CONFIRM' || step.startsWith('START_')) {
    return false;
  }
  if (step === 'SKIP' || step.startsWith('DECLINE_')) {
    return false;
  }
  return !LIVE_START_UNRESOLVED_STEPS.has(step);
}

function getSourceSlotForResolvedStageMember(
  action: GameAction,
  player: PlayerState,
  sourceCardId: string
): SlotPosition | null {
  const payloadSlot =
    action.payload.sourceSlot === SlotPosition.LEFT ||
    action.payload.sourceSlot === SlotPosition.CENTER ||
    action.payload.sourceSlot === SlotPosition.RIGHT
      ? action.payload.sourceSlot
      : null;
  if (payloadSlot && player.memberSlots.slots[payloadSlot] === sourceCardId) {
    return payloadSlot;
  }
  return findMemberSlot(player, sourceCardId);
}

function getOwnStageMemberContext(
  game: GameState,
  playerId: string,
  memberCardId: string
): {
  readonly memberCardId: string;
  readonly sourceSlot: SlotPosition;
} | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, memberCardId);
  if (!player || !card || card.ownerId !== player.id || !isMemberCardData(card.data)) {
    return null;
  }
  const sourceSlot = findMemberSlot(player, memberCardId);
  return sourceSlot ? { memberCardId, sourceSlot } : null;
}

function isOwnLiveCardInLiveZone(game: GameState, playerId: string, liveCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, liveCardId);
  return (
    player !== null &&
    card !== null &&
    card.ownerId === player.id &&
    isLiveCardData(card.data) &&
    player.liveZone.cardIds.includes(liveCardId)
  );
}

function countAllHearts(
  hearts: readonly { readonly color: HeartColor; readonly count: number }[]
): number {
  return hearts.reduce(
    (total, heart) => total + (heart.color === HeartColor.RAINBOW ? heart.count : 0),
    0
  );
}

function getResolvedMemberCardId(ability: PendingAbilityState): string | null {
  return typeof ability.metadata?.resolvedMemberCardId === 'string'
    ? ability.metadata.resolvedMemberCardId
    : null;
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}
