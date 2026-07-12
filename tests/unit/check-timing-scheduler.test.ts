import { describe, expect, it } from 'vitest';
import {
  createGameState,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  advanceCheckTimingIteration,
  closeCheckTimingContextIfIdle,
  getCheckTimingAbilityCandidates,
  openCheckTimingContext,
  processCheckTimingRuleActions,
} from '../../src/application/card-effects/runtime/check-timing-scheduler';
import { TriggerCondition } from '../../src/shared/types/enums';

function pending(id: string, controllerId: string): PendingAbilityState {
  return {
    id,
    abilityId: `test:${id}`,
    sourceCardId: `source:${id}`,
    controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event:${id}`],
  };
}

describe('check timing scheduler', () => {
  it('offers every active-player ability before any non-active-player ability', () => {
    const game = createGameState('check-timing-order', 'p1', 'P1', 'p2', 'P2');
    const abilities = [pending('non-active', 'p2'), pending('active-a', 'p1'), pending('active-x', 'p1')];

    expect(getCheckTimingAbilityCandidates(game, abilities).map((ability) => ability.id)).toEqual([
      'active-a',
      'active-x',
    ]);
    expect(
      getCheckTimingAbilityCandidates(
        game,
        abilities.filter((ability) => ability.controllerId === 'p2')
      ).map((ability) => ability.id)
    ).toEqual(['non-active']);
  });

  it('fails loudly at the configured rule-processing limit', () => {
    const game = createGameState('check-timing-limit', 'p1', 'P1', 'p2', 'P2');
    expect(() => processCheckTimingRuleActions(game, 0)).toThrow(
      'Check timing rule processing exceeded 0 iterations'
    );
  });

  it('keeps a serializable active-player identity across iterations and closes only when idle', () => {
    const base = createGameState('check-timing-context', 'p1', 'P1', 'p2', 'P2');
    const opened = openCheckTimingContext(base);
    expect(opened.checkTimingContext).toMatchObject({ activePlayerId: 'p1', iterationCount: 0 });

    const afterSubPhasePlayerChange = { ...opened, activePlayerIndex: 1 };
    expect(
      getCheckTimingAbilityCandidates(afterSubPhasePlayerChange, [
        pending('p2-auto', 'p2'),
        pending('p1-auto', 'p1'),
      ]).map((ability) => ability.id)
    ).toEqual(['p1-auto']);
    expect(advanceCheckTimingIteration(opened).checkTimingContext?.iterationCount).toBe(1);
    expect(closeCheckTimingContextIfIdle(opened).checkTimingContext).toBeNull();
    expect(
      closeCheckTimingContextIfIdle({ ...opened, pendingAbilities: [pending('held', 'p1')] })
        .checkTimingContext
    ).not.toBeNull();
  });

  it('keeps one context while A, X, and Y are added and removed across iterations', () => {
    let game = openCheckTimingContext(createGameState('check-timing-chain', 'p1', 'P1', 'p2', 'P2'));
    const contextId = game.checkTimingContext!.id;
    for (const id of ['A', 'X', 'Y']) {
      game = {
        ...game,
        pendingAbilities: [pending(id, 'p1')],
      };
      game = advanceCheckTimingIteration(game);
      expect(game.checkTimingContext?.id).toBe(contextId);
      expect(closeCheckTimingContextIfIdle(game).checkTimingContext).not.toBeNull();
      game = { ...game, pendingAbilities: [] };
    }
    expect(game.checkTimingContext?.iterationCount).toBe(3);
    expect(closeCheckTimingContextIfIdle(game).checkTimingContext).toBeNull();
  });

  it('clears the context when rule processing ends the game', () => {
    let game = openCheckTimingContext(
      createGameState('check-timing-game-end', 'p1', 'P1', 'p2', 'P2')
    );
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: ['s1', 's2', 's3'] },
    }));
    const result = processCheckTimingRuleActions(game);
    expect(result.gameEnded).toBe(true);
    expect(result.gameState.checkTimingContext).toBeNull();
  });
});
