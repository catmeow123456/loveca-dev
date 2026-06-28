import type { LiveModifierState } from '../../../../domain/entities/game.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { and, groupIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from '../shared/waiting-room-to-hand.js';

const SELECT_MUSE_MEMBER_TO_WAITING_ROOM_STEP_ID =
  'BP6_021_SELECT_MUSE_MEMBER_TO_WAITING_ROOM';
const SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID = 'BP6_021_SELECT_WAITING_ROOM_MUSE_LIVE';
const SCORE_BONUS = 1;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp6021WonderfulRushWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForLeaveStage;
}): void {
  registerPendingAbilityStarterHandler(
    BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startWonderfulRushOptionalCost(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID,
    SELECT_MUSE_MEMBER_TO_WAITING_ROOM_STEP_ID,
    (game, input, context) =>
      finishWonderfulRushMemberCost(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps
      )
  );
  registerActiveEffectStepHandler(
    BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID,
    SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startWonderfulRushOptionalCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getMuseStageMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumeWonderfulRushWithoutPayment(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_MUSE_MEMBER_TARGET'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_MUSE_MEMBER_TO_WAITING_ROOM_STEP_ID,
      stepText: "可以将自己舞台上1名[μ's]成员放置入休息室。",
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: "选择要放置入休息室的[μ's]成员",
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_MUSE_MEMBER_TO_WAITING_ROOM',
      selectableCardIds,
    },
  });
}

function finishWonderfulRushMemberCost(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForLeaveStage }
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_MUSE_MEMBER_TO_WAITING_ROOM_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (!player) {
    return game;
  }

  if (!selectedCardId) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'SKIP_MEMBER_COST',
        }
      ),
      orderedResolution
    );
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getMuseStageMemberCardIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const costResult = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    {
      ...game,
      activeEffect: null,
    },
    player.id,
    selectedCardId,
    deps.enqueueTriggeredCardEffects
  );
  if (!costResult) {
    return game;
  }

  const stateAfterCost = addAction(costResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    movedMemberCardId: selectedCardId,
    movedToWaitingRoomCardIds: costResult.movedToWaitingRoomCardIds,
    sourceSlot: costResult.sourceSlot,
    leaveStageEventIds: costResult.leaveStageEvents.map((event) => event.eventId),
  });
  const scoreModifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId: player.id,
    countDelta: SCORE_BONUS,
    liveCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  };
  const stateAfterScore = refreshPlayerScoreDraft(
    addLiveModifier(stateAfterCost, scoreModifier),
    player.id,
    SCORE_BONUS
  );

  const selectableCardIds = getWaitingRoomMuseLiveCardIds(stateAfterScore, player.id);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SCORE_NO_RECOVERY_TARGET',
        scoreBonus: SCORE_BONUS,
        movedMemberCardId: selectedCardId,
      }),
      orderedResolution
    );
  }

  return startWaitingRoomToHandWorkflow(stateAfterScore, {
    ability: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    effectText: effect.effectText,
    stepId: SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    stepText: "请选择自己的休息室中1张[μ's]的LIVE卡加入手牌。",
    candidateBuilder: () => selectableCardIds,
    countRule: { minCount: 0, maxCount: 1 },
    optional: false,
    orderedResolution,
    selectionRequiredWhenHasTargets: true,
  });
}

function consumeWonderfulRushWithoutPayment(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
      }
    ),
    orderedResolution
  );
}

function getMuseStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, and(typeIs(CardType.MEMBER), groupIs("μ's")));
}

function getWaitingRoomMuseLiveCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, and(typeIs(CardType.LIVE), groupIs("μ's")));
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
