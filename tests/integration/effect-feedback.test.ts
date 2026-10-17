import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  EFFECT_FEEDBACK_SCENARIOS,
  prepareEffectFeedbackScenario,
} from '../helpers/effect-feedback-fixture';

import { hasEffectFeedbackGlow } from '../../client/src/lib/effectFeedback';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';

afterEach(() => vi.useRealTimers());

describe('real ability commands publish presentation facts', () => {
  it('does not light the source during activation or waiting costs, but lights a resolved gain', () => {
    vi.useFakeTimers();
    const { session, nextCommand } = prepareEffectFeedbackScenario('self');
    expect(session.executeCommand(nextCommand()!).success).toBe(true);
    const paymentEvents = session
      .getPublicEventsSince(0)
      .filter((e) => e.type === 'EffectFeedback');
    expect(paymentEvents).toEqual([]);
    for (let i = 0; i < 6 && session.state!.activeEffect; i++) {
      const deadline = session.state!.activeEffect?.publicEffectChoiceAutoAdvanceAt;
      if (deadline) vi.setSystemTime(deadline + 1);
      expect(session.executeCommand(nextCommand()!).success).toBe(true);
    }
    expect(
      session
        .getPublicEventsSince(0)
        .filter((e) => e.type === 'EffectFeedback')
        .some((e) => e.targets.some((t) => hasEffectFeedbackGlow(e.mode, t.changes)))
    ).toBe(true);
  });

  it('rejects an illegal target without feedback or mutation', () => {
    const { session } = prepareEffectFeedbackScenario('heart');
    const before = session.state;
    const result = session.executeCommand(
      createConfirmEffectStepCommand('p1', before!.activeEffect!.id, 'source')
    );
    expect(result.success).toBe(false);
    expect(session.state).toBe(before);
    expect(session.getPublicEventsSince(0).filter((e) => e.type === 'EffectFeedback')).toEqual([]);
  });
  for (const scenario of EFFECT_FEEDBACK_SCENARIOS) {
    it(scenario.id, () => {
      vi.useFakeTimers();
      const { session, nextCommand } = prepareEffectFeedbackScenario(scenario.id);
      let command = nextCommand();
      for (let step = 0; command && step < 8; step++) {
        const active = session.state!.activeEffect;
        const deadline =
          active?.publicCardSelectionAutoAdvanceAt ?? active?.publicEffectChoiceAutoAdvanceAt;
        if (deadline) vi.setSystemTime(deadline + 1);
        const result = session.executeCommand(command);
        expect(
          result.success,
          JSON.stringify({ command, error: result.error, active: session.state!.activeEffect })
        ).toBe(true);
        if (!session.state!.activeEffect) break;
        command = nextCommand();
      }
      expect(session.state!.activeEffect).toBeNull();
      const events = session
        .getPublicEventsSince(0)
        .filter((event) => event.type === 'EffectFeedback');
      const changes = events.flatMap((event) => event.targets.flatMap((target) => target.changes));
      if (scenario.id === 'mixed') {
        expect(events).toHaveLength(1);
        expect(events[0]?.targets).toHaveLength(1);
        expect(changes).toEqual(
          expect.arrayContaining([
            { kind: 'HEART', color: 'GREEN', delta: 1 },
            { kind: 'BLADE', delta: 1 },
          ])
        );
      }
      if (scenario.id === 'heart')
        expect(changes).toContainEqual({ kind: 'HEART', color: 'YELLOW', delta: 2 });
      if (scenario.id === 'multi')
        expect(changes.filter((c) => c.kind === 'BLADE')).toHaveLength(3);
      if (['wait', 'score', 'requirement'].includes(scenario.id)) expect(events).toEqual([]);
      if (scenario.id === 'self')
        expect(changes).toContainEqual({ kind: 'HEART', color: 'YELLOW', delta: 1 });
      if (scenario.id === 'recover' || scenario.id === 'no-target') {
        expect(events).toEqual([]);
        expect(session.state!.players[0].waitingRoom.cardIds).toContain('discard');
        expect(session.state!.players[0].hand.cardIds.includes('live')).toBe(
          scenario.id === 'recover'
        );
        expect(events.some((event) => event.mode === 'APPLIED')).toBe(false);
      }
    });
  }
});
