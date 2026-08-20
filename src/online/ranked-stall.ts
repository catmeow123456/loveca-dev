import { isPublicCardSelectionAutoAdvanceEffect } from '../application/card-effects/runtime/public-card-selection-confirmation.js';
import { isPublicEffectChoiceAutoAdvanceEffect } from '../application/card-effects/runtime/public-effect-choice-confirmation.js';
import { isPublicRevealDwellEffect } from '../application/card-effects/runtime/public-reveal-dwell.js';
import type { GameState } from '../domain/entities/game.js';
import { getCurrentSuccessLiveSettlementPlayerId } from '../domain/rules/success-live-placement.js';
import { getActivePlayerIds } from '../shared/phase-config/index.js';
import { GamePhase, SubPhase } from '../shared/types/enums.js';

export interface RankedSinglePlayerWait {
  readonly key: string;
  readonly playerId: string;
}

/**
 * 描述排位对局中当前唯一能够提交下一条推进命令的玩家。
 *
 * 该查询只读取权威状态，不把 HTTP 轮询、前端焦点或卡牌可见信息当作
 * 行动责任依据。任一参与者都能安全推进的公开展示窗口也不会归责给单方。
 */
export function describeRankedSinglePlayerWait(state: GameState): RankedSinglePlayerWait | null {
  if (!state.isStarted || state.isEnded || state.currentPhase === GamePhase.GAME_END) {
    return null;
  }

  const pendingSpecialMemberPlay = state.pendingSpecialMemberPlay ?? null;
  if (pendingSpecialMemberPlay) {
    return pendingWait(
      'pending-special-member-play',
      pendingSpecialMemberPlay.id,
      pendingSpecialMemberPlay.playerId
    );
  }

  if (state.pendingCostPayment) {
    return pendingWait(
      'pending-cost-payment',
      state.pendingCostPayment.id,
      state.pendingCostPayment.playerId
    );
  }

  if (state.activeEffect) {
    if (isParticipantSafePublicAutoAdvance(state.activeEffect)) {
      return null;
    }
    return state.activeEffect.awaitingPlayerId
      ? pendingWait('active-effect', state.activeEffect.id, state.activeEffect.awaitingPlayerId)
      : null;
  }

  if (state.pendingChoice) {
    return pendingWait('pending-choice', state.pendingChoice.id, state.pendingChoice.playerId);
  }

  if (state.inspectionContext) {
    return {
      key: [
        'inspection',
        state.inspectionContext.ownerPlayerId,
        state.inspectionContext.sourceZone,
      ].join(':'),
      playerId: state.inspectionContext.ownerPlayerId,
    };
  }

  if (state.waitingForInput && state.waitingPlayerId) {
    return phaseWait(state, state.waitingPlayerId, 'legacy-waiting-input');
  }

  if (state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM) {
    const unconfirmedPlayers = state.players.filter(
      (player) => !state.liveResolution.scoreConfirmedBy.includes(player.id)
    );
    return unconfirmedPlayers.length === 1
      ? phaseWait(state, unconfirmedPlayers[0]!.id, 'score-confirm')
      : null;
  }

  if (state.currentSubPhase === SubPhase.RESULT_SETTLEMENT) {
    const playerId = getCurrentSuccessLiveSettlementPlayerId(state);
    return playerId ? phaseWait(state, playerId, 'result-settlement') : null;
  }

  if (!isExplicitSinglePlayerPhase(state.currentPhase, state.currentSubPhase)) {
    return null;
  }

  const activePlayerIds = getActivePlayerIds(state);
  return activePlayerIds.length === 1 ? phaseWait(state, activePlayerIds[0]!, 'phase') : null;
}

function pendingWait(kind: string, id: string, playerId: string): RankedSinglePlayerWait {
  return {
    key: `${kind}:${id}`,
    playerId,
  };
}

function phaseWait(state: GameState, playerId: string, kind: string): RankedSinglePlayerWait {
  return {
    key: [
      kind,
      `turn:${state.turnCount}`,
      `phase:${state.currentPhase}`,
      `subPhase:${state.currentSubPhase}`,
      `player:${playerId}`,
    ].join('|'),
    playerId,
  };
}

function isParticipantSafePublicAutoAdvance(
  effect: NonNullable<GameState['activeEffect']>
): boolean {
  return (
    isPublicCardSelectionAutoAdvanceEffect(effect) ||
    isPublicEffectChoiceAutoAdvanceEffect(effect) ||
    isPublicRevealDwellEffect(effect)
  );
}

function isExplicitSinglePlayerPhase(phase: GamePhase, subPhase: SubPhase): boolean {
  if (phase === GamePhase.MULLIGAN_PHASE) {
    return (
      subPhase === SubPhase.MULLIGAN_FIRST_PLAYER || subPhase === SubPhase.MULLIGAN_SECOND_PLAYER
    );
  }

  if (phase === GamePhase.MAIN_PHASE) {
    return subPhase === SubPhase.NONE;
  }

  if (phase === GamePhase.LIVE_SET_PHASE) {
    return (
      subPhase === SubPhase.LIVE_SET_FIRST_PLAYER || subPhase === SubPhase.LIVE_SET_SECOND_PLAYER
    );
  }

  if (phase === GamePhase.PERFORMANCE_PHASE) {
    return (
      subPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS ||
      subPhase === SubPhase.PERFORMANCE_JUDGMENT
    );
  }

  return (
    phase === GamePhase.LIVE_RESULT_PHASE &&
    (subPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS ||
      subPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS)
  );
}
