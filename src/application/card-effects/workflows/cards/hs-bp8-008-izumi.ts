import { isMemberCardData } from '../../../../domain/entities/card.js';
import { captureIzumiReplay } from '../../../card-entrance.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_BP8_008_ACTIVATED_DISCARD_REPLAY_OTHER_EDELNOTE_MEMBER_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { canUseActivatedAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { createOptionalDiscardHandToWaitingRoomActiveEffect } from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import {
  replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers,
  type EnqueueReplayedMemberTriggers,
} from '../../runtime/replay-exact-stage-member.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  isCurrentStageMemberAbilitySource,
  getSourceMemberSlot,
} from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const DISCARD = 'HS_BP8_008_DISCARD_HAND_COST';
const TARGET = 'HS_BP8_008_SELECT_OTHER_EDELNOTE_MEMBER';
type Continue = (game: GameState, ordered: boolean) => GameState;
type Enqueue = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForLeaveStage &
  EnqueueReplayedMemberTriggers;

export function registerHsBp8008IzumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerActivatedAbilityHandler(
    ABILITY_ID,
    (game, playerId, sourceCardId) => {
      if (!canStart(game, playerId, sourceCardId)) return game;
      const player = getPlayerById(game, playerId)!;
      const ability = {
        id: `${ABILITY_ID}:${sourceCardId}:${game.actionSequence + 1}`,
        abilityId: ABILITY_ID,
        sourceCardId,
        controllerId: playerId,
      };
      return {
        ...game,
        activeEffect: {
          ...createOptionalDiscardHandToWaitingRoomActiveEffect({
            ability,
            playerId,
            effectText: getAbilityEffectText(ABILITY_ID),
            stepId: DISCARD,
            selectableCardIds: player.hand.cardIds,
            orderedResolution: false,
          }),
          sourceLifecycleId: getStageMemberLifecycleId(game, sourceCardId),
        },
      };
    },
    canStart
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    DISCARD,
    (game, input, context) => {
      const effect = game.activeEffect!;
      const selected = input.selectedCardId;
      if (selected == null)
        return finish(game, effect, context.continuePendingCardEffects, 'DECLINE');
      if (!isCurrentStageMemberAbilitySource(game, effect))
        return finish(
          game,
          effect,
          context.continuePendingCardEffects,
          'SOURCE_OBJECT_NOT_ON_STAGE'
        );
      const player = getPlayerById(game, effect.controllerId);
      if (
        !player ||
        !effect.selectableCardIds?.includes(selected) ||
        !player.hand.cardIds.includes(selected)
      )
        return game;
      const payment = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
        game,
        player.id,
        selected,
        {},
        deps.enqueueTriggeredCardEffects
      );
      if (!payment) return game;
      let state = addAction(payment.gameState, 'PAY_COST', player.id, {
        abilityId: ABILITY_ID,
        sourceCardId: effect.sourceCardId,
        discardedCardIds: [selected],
        pendingAbilityId: effect.id,
      });
      state = recordAbilityUseForContext(state, player.id, effect);
      return selectTarget(state, effect, context.continuePendingCardEffects);
    },
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    TARGET,
    (game, input, context) => {
      const effect = game.activeEffect!;
      const targets = eligibleTargets(game, effect);
      if (targets.length === 0)
        return finish(game, effect, context.continuePendingCardEffects, 'NO_TARGET');
      const selected = input.selectedCardId;
      if (!selected || !effect.selectableCardIds?.includes(selected)) return game;
      if (!targets.includes(selected))
        return selectTarget(game, effect, context.continuePendingCardEffects);
      const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        game,
        effect.controllerId,
        selected,
        deps.enqueueTriggeredCardEffects
      );
      if (!moved) return selectTarget(game, effect, context.continuePendingCardEffects);
      const played = replayExactWaitingRoomMemberToOriginalSlotAndEnqueueTriggers(
        moved.gameState,
        effect.controllerId,
        selected,
        moved.sourceSlot,
        deps.enqueueTriggeredCardEffects
      );
      return finish(
        played
          ? captureIzumiReplay(game, played, effect, selected, moved.sourceSlot)
          : moved.gameState,
        effect,
        context.continuePendingCardEffects,
        played ? 'REPLAY_EXACT_MEMBER' : 'REPLAY_TARGET_STALE',
        {
          targetCardId: selected,
          targetSlot: moved.sourceSlot,
          movedToWaitingRoomCardIds: moved.movedToWaitingRoomCardIds,
          playedCardId: played ? selected : null,
        }
      );
    },
    queryCardSelection
  );
}

function canStart(game: GameState, playerId: string, sourceCardId: string): boolean {
  const source = getCardById(game, sourceCardId);
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    !!source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, 'PL!HS-bp8-008') &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null &&
    (getPlayerById(game, playerId)?.hand.cardIds.length ?? 0) > 0 &&
    canUseActivatedAbilityThisTurn(game, playerId, ABILITY_ID, sourceCardId)
  );
}

function eligibleTargets(game: GameState, effect: ActiveEffectState): readonly string[] {
  return getStageMemberCardIdsMatching(game, effect.controllerId, unitAliasIs('EdelNote')).filter(
    (id) => id !== effect.sourceCardId && getCardById(game, id)?.ownerId === effect.controllerId
  );
}

function selectTarget(game: GameState, effect: ActiveEffectState, next: Continue): GameState {
  const targets = eligibleTargets(game, effect);
  if (!targets.length) return finish(game, effect, next, 'NO_TARGET');
  return {
    ...game,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceLifecycleId: effect.sourceLifecycleId,
      controllerId: effect.controllerId,
      effectText: effect.effectText,
      stepId: TARGET,
      awaitingPlayerId: effect.controllerId,
      stepText: '将此成员以外的1名『Edel Note』成员放置入休息室，再让该张成员卡登场至原区域。',
      selectableCardIds: targets,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要放置入休息室的成员',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      metadata: { orderedResolution: false },
    },
  };
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  step: string,
  payload: Record<string, unknown> = {}
): GameState {
  const state = addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    step,
    ...payload,
  });
  return state.entranceRuntime?.pending?.izumiReplay
    ? { ...state, entranceRuntime: { ...state.entranceRuntime, resumePendingEffects: false } }
    : next(state, false);
}
