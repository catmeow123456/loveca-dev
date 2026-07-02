import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addLiveModifier,
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import type { EnterWaitingRoomEvent } from '../../../../domain/events/game-events.js';
import { CardType, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
  PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

const SELECT_DISCARD_TWO_STEP_ID = 'PL_BP3_026_SELECT_DISCARD_TWO';
const SELECT_STAGE_MEMBER_TARGET_STEP_ID = 'PL_BP3_026_SELECT_STAGE_MEMBER_TARGET';
const DECLINE_OPTION_LABEL = '不发动';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
  }
) => GameState;

export function registerPlBp3026OhLovePeaceWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startOhLovePeaceLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getOhLovePeaceLiveSuccessConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveOhLovePeaceLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
  registerActiveEffectStepHandler(
    PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
    SELECT_DISCARD_TWO_STEP_ID,
    (game, input, context) =>
      finishOhLovePeaceDiscardTwo(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
    SELECT_STAGE_MEMBER_TARGET_STEP_ID,
    (game, input, context) =>
      finishOhLovePeaceTargetSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function getOhLovePeaceLiveSuccessConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player
    ? (game.players.find((candidate) => candidate.id !== player.id) ?? null)
    : null;
  const liveModifiers = collectLiveModifiers(game);
  const ownHeartTotal = player ? countStageHeartTotal(game, player.id, liveModifiers) : 0;
  const opponentHeartTotal = opponent ? countStageHeartTotal(game, opponent.id, liveModifiers) : 0;
  const conditionMet = ownHeartTotal > opponentHeartTotal;
  return `${getAbilityEffectText(ability.abilityId)}（自己舞台Heart合计 ${ownHeartTotal}，对方舞台Heart合计 ${opponentHeartTotal}，${conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'}）`;
}

function startOhLovePeaceLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stageMemberCardIds = getStageMemberCardIds(game, player.id);
  if (player.hand.cardIds.length < 2) {
    return finishOhLovePeaceLiveStartNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NOT_ENOUGH_HAND_TO_DISCARD',
      { handCount: player.hand.cardIds.length, stageMemberCardIds }
    );
  }
  if (stageMemberCardIds.length === 0) {
    return finishOhLovePeaceLiveStartNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_STAGE_MEMBER_TARGET',
      { handCount: player.hand.cardIds.length, stageMemberCardIds }
    );
  }

  const discardCost = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 2,
    maxCount: 2,
    optional: true,
  } as const;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_TWO_STEP_ID,
      stepText: '可以将2张手牌放置入休息室。如此做的场合，选择自己舞台1名成员获得[BLADE][BLADE][BLADE]。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: DECLINE_OPTION_LABEL,
      metadata: {
        orderedResolution,
        stageMemberCardIds,
        effectCosts: [discardCost],
        handToWaitingRoomCost: {
          minCount: discardCost.minCount,
          maxCount: discardCost.maxCount,
          optional: discardCost.optional,
        },
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_TWO',
      selectableCardIds: player.hand.cardIds,
      stageMemberCardIds,
    },
  });
}

function finishOhLovePeaceLiveStartNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: 'NOT_ENOUGH_HAND_TO_DISCARD' | 'NO_STAGE_MEMBER_TARGET',
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      ...payload,
    }),
    orderedResolution
  );
}

function finishOhLovePeaceDiscardTwo(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = getOhLovePeaceEffect(game, SELECT_DISCARD_TWO_STEP_ID);
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardIds.length === 0 && effect.canSkipSelection === true) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_DISCARD_TWO',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== 2 ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true ||
        !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: 2,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stageMemberCardIds = getStageMemberCardIds(discardResult.gameState, player.id);
  if (stageMemberCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...discardResult.gameState, activeEffect: null }, 'PAY_COST', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        liveCardId: effect.sourceCardId,
        step: 'DISCARD_TWO_NO_STAGE_MEMBER_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (stageMemberCardIds.length === 1) {
    return resolveOhLovePeaceBladeTarget(
      discardResult.gameState,
      effect,
      player.id,
      continuePendingCardEffects,
      stageMemberCardIds[0]!,
      discardResult.discardedCardIds
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_STAGE_MEMBER_TARGET_STEP_ID,
        stepText: '请选择自己舞台1名成员获得[BLADE][BLADE][BLADE]。',
        awaitingPlayerId: player.id,
        selectableCardIds: stageMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: '选择获得BLADE的成员',
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: discardResult.discardedCardIds,
          stageMemberCardIds,
        },
      },
    },
    'PAY_COST',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      liveCardId: effect.sourceCardId,
      step: 'DISCARD_TWO_SELECT_STAGE_MEMBER_TARGET',
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds: stageMemberCardIds,
    }
  );
}

function finishOhLovePeaceTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getOhLovePeaceEffect(game, SELECT_STAGE_MEMBER_TARGET_STEP_ID);
  if (!effect || !selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !getStageMemberCardIds(game, player.id).includes(selectedCardId)) {
    return game;
  }

  return resolveOhLovePeaceBladeTarget(
    game,
    effect,
    player.id,
    continuePendingCardEffects,
    selectedCardId,
    getStringArrayMetadata(effect, 'discardedHandCardIds')
  );
}

function resolveOhLovePeaceBladeTarget(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  targetMemberCardId: string,
  discardedHandCardIds: readonly string[]
): GameState {
  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId,
    sourceCardId: targetMemberCardId,
    abilityId: effect.abilityId,
    amount: 3,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      liveCardId: effect.sourceCardId,
      step: 'DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE',
      discardedHandCardIds,
      targetMemberCardId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveOhLovePeaceLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const liveModifiers = collectLiveModifiers(game);
  const ownHeartTotal = countStageHeartTotal(game, player.id, liveModifiers);
  const opponentHeartTotal = opponent
    ? countStageHeartTotal(game, opponent.id, liveModifiers)
    : 0;
  const conditionMet = ownHeartTotal > opponentHeartTotal;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier = conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: 1,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, 1)
    : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE',
      ownHeartTotal,
      opponentHeartTotal,
      conditionMet,
      scoreBonus: conditionMet ? 1 : 0,
    }),
    orderedResolution
  );
}

function getOhLovePeaceEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function getStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER));
}

function countStageHeartTotal(
  game: GameState,
  playerId: string,
  liveModifiers: ReturnType<typeof collectLiveModifiers>
): number {
  return getStageMemberCardIds(game, playerId)
    .flatMap((cardId) => getMemberEffectiveHeartIcons(game, playerId, cardId, liveModifiers))
    .reduce((total, heart) => total + heart.count, 0);
}

function refreshPlayerScoreDraft(
  game: GameState,
  playerId: string,
  scoreBonus: number
): GameState {
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

function getStringArrayMetadata(effect: ActiveEffectState, key: string): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
