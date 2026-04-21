import type { GameState } from '../domain/entities/game.js';
import { GameMode, GamePhase, SubPhase } from '../shared/types/enums.js';
import { isPlayerActive } from '../shared/phase-config/index.js';
import type { GameAction } from './actions.js';
import {
  createConfirmScoreAction,
  createConfirmSubPhaseAction,
  createEndPhaseAction,
  createMulliganAction,
  createSelectSuccessCardAction,
} from './actions.js';

export type ModeAutomationStep =
  | {
      readonly kind: 'ACTION';
      readonly actorPlayerId: string;
      readonly action: GameAction;
    }
  | {
      readonly kind: 'SKIP_OPPONENT_PERFORMANCE';
      readonly actorPlayerId: string;
    };

export interface ModeAutomationPolicy {
  getNextAutomation(state: GameState, triggerPlayerId: string): ModeAutomationStep | null;
}

const onlineAutomationPolicy: ModeAutomationPolicy = {
  getNextAutomation() {
    return null;
  },
};

const solitaireAutomationPolicy: ModeAutomationPolicy = {
  getNextAutomation(state, triggerPlayerId) {
    const opponentId = getOpponentId(state, triggerPlayerId);
    if (!opponentId) {
      return null;
    }

    if (
      state.currentPhase === GamePhase.MULLIGAN_PHASE &&
      !state.mulliganCompletedPlayers.includes(opponentId)
    ) {
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createMulliganAction(opponentId, []),
      };
    }

    if (
      state.currentPhase === GamePhase.LIVE_SET_PHASE &&
      state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER
    ) {
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createConfirmSubPhaseAction(opponentId, SubPhase.LIVE_SET_SECOND_PLAYER),
      };
    }

    if (state.currentPhase === GamePhase.PERFORMANCE_PHASE && isPlayerActive(state, opponentId)) {
      return {
        kind: 'SKIP_OPPONENT_PERFORMANCE',
        actorPlayerId: opponentId,
      };
    }

    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      (state.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS ||
        state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS) &&
      isPlayerActive(state, opponentId)
    ) {
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createConfirmSubPhaseAction(opponentId, state.currentSubPhase),
      };
    }

    if (state.currentPhase === GamePhase.MAIN_PHASE && isPlayerActive(state, opponentId)) {
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createEndPhaseAction(opponentId),
      };
    }

    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM &&
      !state.liveResolution.scoreConfirmedBy.includes(opponentId)
    ) {
      const opponentScore = state.liveResolution.playerScores.get(opponentId) ?? 0;
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createConfirmScoreAction(opponentId, opponentScore),
      };
    }

    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_ANIMATION &&
      state.liveResolution.liveWinnerIds.includes(opponentId) &&
      !state.liveResolution.animationConfirmedBy.includes(opponentId)
    ) {
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createConfirmSubPhaseAction(opponentId, SubPhase.RESULT_ANIMATION),
      };
    }

    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
      state.liveResolution.liveWinnerIds.includes(opponentId) &&
      !state.liveResolution.successCardMovedBy.includes(opponentId)
    ) {
      const opponent = state.players.find((player) => player.id === opponentId);
      const firstLiveCardId = opponent?.liveZone.cardIds[0];
      if (!firstLiveCardId) {
        return null;
      }
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createSelectSuccessCardAction(opponentId, firstLiveCardId),
      };
    }

    if (
      state.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      state.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
      state.liveResolution.liveWinnerIds.includes(opponentId) &&
      state.liveResolution.successCardMovedBy.includes(opponentId) &&
      !state.liveResolution.settlementConfirmedBy.includes(opponentId)
    ) {
      return {
        kind: 'ACTION',
        actorPlayerId: opponentId,
        action: createConfirmSubPhaseAction(opponentId, SubPhase.RESULT_SETTLEMENT),
      };
    }

    return null;
  },
};

export function getModeAutomationPolicy(gameMode: GameMode): ModeAutomationPolicy {
  switch (gameMode) {
    case GameMode.SOLITAIRE:
      return solitaireAutomationPolicy;
    case GameMode.DEBUG:
    default:
      return onlineAutomationPolicy;
  }
}

function getOpponentId(state: GameState, playerId: string): string | null {
  const opponent = state.players.find((player) => player.id !== playerId);
  return opponent?.id ?? null;
}
