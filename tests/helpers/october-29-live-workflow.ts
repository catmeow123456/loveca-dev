import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { type CardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, type GameState } from '../../src/domain/entities/game';
import { createLiveStartEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { GamePhase, SubPhase } from '../../src/shared/types/enums';
import { createOctober29DraftCard } from './october-29-draft-effects';
import { gameWith, liveZone, P1, P2, stage } from './modifier-workflow-fixtures';

export function october29LiveGame(
  code: string,
  own: readonly CardInstance[] = [],
  opponent: readonly CardInstance[] = []
) {
  const source = createOctober29DraftCard(code, P1, 'source-live');
  let game = liveZone(
    stage(stage(gameWith([source, ...own, ...opponent]), own), opponent, P2),
    source
  );
  game = {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: P1,
      playerScores: new Map([[P1, source.data.score ?? 0]]),
    },
  };
  return { game, source };
}

export function queueOctober29Live(
  game: GameState,
  success = false,
  ids: readonly string[] = ['source-live']
): GameState {
  const event = success
    ? createLiveSuccessEvent(P1, ids, game.liveResolution.playerScores.get(P1) ?? 0)
    : createLiveStartEvent(P1, ids);
  const state = success
    ? {
        ...game,
        currentPhase: GamePhase.LIVE_RESULT_PHASE,
        currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
        liveResolution: {
          ...game.liveResolution,
          liveResults: new Map(ids.map((id) => [id, true])),
        },
      }
    : game;
  return enqueueTriggeredCardEffects(
    emitGameEvent(state, event),
    [event.eventType],
    success ? { liveSuccessEvents: [event] } : { liveStartEvents: [event] }
  );
}

export const resolveOctober29Live = (game: GameState) => resolvePendingCardEffects(game).gameState;
export function confirmOctober29Live(game: GameState, selectedCardId?: string) {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, selectedCardId);
}
