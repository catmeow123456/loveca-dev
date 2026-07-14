import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { countStageMembers } from '../../../effects/conditions.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  drawCardsForPlayer,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from '../../runtime/actions.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const ON_ENTER_SELECT_DISCARD_STEP_ID = 'PL_BP3_004_ON_ENTER_SELECT_DISCARD_AFTER_DRAW';
const LIVE_START_SELECT_DISCARD_STEP_ID = 'PL_BP3_004_LIVE_START_SELECT_DISCARD_COST';
const LIVE_START_SELECT_RECOVERY_STEP_ID = 'PL_BP3_004_LIVE_START_SELECT_MUSE_LIVE';

const museLiveSelector = and(typeIs(CardType.LIVE), groupAliasIs("μ's"));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3004UmiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startPlBp3004UmiOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID,
    ON_ENTER_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishPlBp3004UmiOnEnterDiscard(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startPlBp3004UmiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    LIVE_START_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId === null
        ? finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_COST',
          })
        : finishPlBp3004UmiLiveStartDiscard(
            game,
            input.selectedCardId ?? null,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
  );
  registerActiveEffectStepHandler(
    PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    LIVE_START_SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishPlBp3004UmiLiveStartRecovery(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

export function startPlBp3004UmiOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stageMemberCount = countStageMembers(game, player.id);
  const drawResult =
    stageMemberCount > 0
      ? drawCardsForPlayer(game, player.id, stageMemberCount)
      : { gameState: game, drawnCardIds: [] as readonly string[] };
  if (!drawResult) {
    return game;
  }
  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  if (!playerAfterDraw) {
    return game;
  }
  const selectableCardIds = [...playerAfterDraw.hand.cardIds];
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(consumePendingAbility(drawResult.gameState, ability), 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot ?? null,
        step: 'DRAW_NO_HAND_TO_DISCARD',
        stageMemberCount,
        drawnCardIds: drawResult.drawnCardIds,
        discardedHandCardIds: [],
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(drawResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: ON_ENTER_SELECT_DISCARD_STEP_ID,
      stepText: '请选择1张手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot ?? null,
        stageMemberCount,
        drawnCardIds: drawResult.drawnCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot ?? null,
      step: 'DRAW_PER_STAGE_MEMBER_START_DISCARD',
      stageMemberCount,
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    },
  });
}

export function finishPlBp3004UmiOnEnterDiscard(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID ||
    effect.stepId !== ON_ENTER_SELECT_DISCARD_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(selectedCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'DISCARD_AFTER_DRAW',
      stageMemberCount: effect.metadata?.stageMemberCount,
      drawnCardIds: effect.metadata?.drawnCardIds,
      discardedHandCardIds: discardResult.discardedCardIds,
      enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

export function startPlBp3004UmiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const hasSuccessfulLive = (player?.successZone.cardIds.length ?? 0) > 0;
  if (!player || !hasSuccessfulLive || player.hand.cardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(consumePendingAbility(game, ability), 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot ?? null,
        step: !player
          ? 'NO_CONTROLLER'
          : !hasSuccessfulLive
            ? 'NO_SUCCESSFUL_LIVE'
            : 'NO_HAND_TO_DISCARD',
        successLiveCardCount: player?.successZone.cardIds.length ?? 0,
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_START_SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        sourceSlot: ability.sourceSlot ?? null,
        successLiveCardCount: player.successZone.cardIds.length,
      },
      stepText: '可以选择1张手牌放置入休息室。如此做时，从自己的休息室将1张『μ\'s』的LIVE卡加入手牌。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot ?? null,
      step: 'START_OPTIONAL_DISCARD_COST',
      successLiveCardCount: player.successZone.cardIds.length,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

export function finishPlBp3004UmiLiveStartDiscard(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID ||
    effect.stepId !== LIVE_START_SELECT_DISCARD_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(selectedCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }
  const stateAfterCost = recordPayCostAction(discardResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    discardedHandCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterCost,
    player.id,
    museLiveSelector
  );
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot ?? null,
        step: 'PAID_COST_NO_MUSE_LIVE_TO_RECOVER',
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...stateAfterCost,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: effect.effectText,
      stepId: LIVE_START_SELECT_RECOVERY_STEP_ID,
      stepText: "请选择自己的休息室中1张『μ's』的LIVE卡加入手牌。",
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectionLabel: "选择要加入手牌的『μ's』LIVE卡",
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        discardedHandCardIds: discardResult.discardedCardIds,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

export function finishPlBp3004UmiLiveStartRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID ||
    effect.stepId !== LIVE_START_SELECT_RECOVERY_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'RECOVER_MUSE_LIVE',
      discardedHandCardIds: effect.metadata?.discardedHandCardIds,
      recoveredCardIds: recoveryResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}
