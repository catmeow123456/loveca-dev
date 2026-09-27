import { describe, expect, it, vi } from 'vitest';
import { AiBattleRuntime, AI_LIVE_PRESENTATION_DWELL_MS } from '../../src/server/ai-battle/runtime';
import { GameCommandType } from '../../src/application/game-commands';
import { GamePhase, SubPhase } from '../../src/shared/types/enums';
import { decision, setup } from '../helpers/ai-battle-fixture';
import type { AiDecision } from '../../src/server/ai-battle/protocol';

const invalid = { kind: 'RESPONSE', text: '{' } as const;

function strategy(runtime: AiBattleRuntime, revision = 1) {
  const current = decision(setup(false).session);
  const result = runtime.observe(revision, `window:${revision}`, {
    kind: 'DECISION',
    decision: current,
  });
  if (result?.kind !== 'MODEL') throw new Error(JSON.stringify(result));
  return result.task;
}

function mechanical(): AiDecision {
  const current = decision(setup(false).session);
  return {
    input: {
      ...current.input,
      purpose: 'RULE_CONFIRM',
      space: { kind: 'ACTION', candidates: [{ ref: 'a1', description: '确认规则步骤' }] },
    },
    toCommand: (_, timestamp) => ({
      type: GameCommandType.CONFIRM_STEP,
      playerId: 'ai',
      timestamp,
      subPhase: SubPhase.NONE,
    }),
  };
}

describe('AI task failure accounting', () => {
  it('treats context construction failure as an adapter stop without counting model failure', () => {
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    strategy(runtime);
    expect(runtime.resolve({ kind: 'ADAPTER_ERROR', message: 'context too large' })).toEqual({
      kind: 'STOPPED',
      reason: 'ADAPTER_CONTEXT: context too large',
    });
    expect(runtime.consecutiveFailures).toBe(0);
    expect(runtime.current).toBeNull();
  });

  it('rejects an upstream-truncated answer even when its retained JSON selection is valid', () => {
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    strategy(runtime);
    expect(
      runtime.resolve({
        kind: 'RESPONSE',
        text: '{"selection":{"kind":"CARDS","cardRefs":[]}}',
        truncated: true,
      })
    ).toBeNull();
    expect(runtime.current?.prepared?.source).toBe('FALLBACK');
    expect(runtime.consecutiveFailures).toBe(1);
    expect(runtime.current?.attempt).toBe(0);
  });

  it('stops before the third fallback and retains failures through mechanical work and waiting', () => {
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    for (let failure = 1; failure <= 2; failure++) {
      strategy(runtime, failure);
      expect(runtime.resolve(invalid)).toBeNull();
      expect(runtime.current?.prepared).toEqual({
        source: 'FALLBACK',
        selection: { kind: 'CARDS', cardRefs: [] },
      });
      expect(runtime.consecutiveFailures).toBe(failure);
      // A duplicate completion cannot count the same decision again.
      expect(runtime.resolve(invalid)).toEqual({ kind: 'STALE' });
      runtime.accepted();
      expect(
        runtime.observe(10, 'public', {
          kind: 'WAITING_FOR_TIME',
          deadlineAt: 123,
          reason: 'PUBLIC_DISPLAY',
        })
      ).toMatchObject({ kind: 'WAIT' });
      expect(runtime.observe(11, 'human', { kind: 'WAITING_FOR_PLAYER' })).toEqual({
        kind: 'IDLE',
      });
      expect(runtime.observe(12, 'phase', { kind: 'DECISION', decision: mechanical() })).toBeNull();
      expect(runtime.current?.prepared?.source).toBe('MECHANICAL');
      runtime.accepted();
      expect(runtime.consecutiveFailures).toBe(failure);
    }
    const third = strategy(runtime, 3);
    const stopped = runtime.resolve(invalid);
    expect(stopped?.kind).toBe('STOPPED');
    if (stopped?.kind !== 'STOPPED') throw new Error('Expected failure limit stop');
    expect(stopped.reason).toContain('CONSECUTIVE_FAILURE_LIMIT');
    expect(runtime.current).toBeNull();
    expect(third.signal.aborted).toBe(true);
    expect(runtime.consecutiveFailures).toBe(3);
    expect(runtime.observe(99, 'next turn', { kind: 'WAITING_FOR_PLAYER' })).toMatchObject({
      kind: 'STOPPED',
    });
  });

  it('resets only after a model choice is actually accepted', () => {
    const runtime = new AiBattleRuntime('SECOND', vi.fn());
    strategy(runtime);
    runtime.resolve(invalid);
    runtime.accepted();
    strategy(runtime, 2);
    expect(
      runtime.resolve({
        kind: 'RESPONSE',
        text: JSON.stringify({ selection: { kind: 'CARDS', cardRefs: [] } }),
      })
    ).toBeNull();
    expect(runtime.consecutiveFailures).toBe(1);
    runtime.accepted();
    expect(runtime.consecutiveFailures).toBe(0);
  });

  it('retries one transient service failure using the same input and counts exhaustion once', () => {
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    const first = strategy(runtime);
    const transient = { kind: 'SERVICE_ERROR', message: 'rate limited', retryable: true } as const;
    const retry = runtime.resolve(transient);
    expect(retry?.kind).toBe('MODEL');
    if (retry?.kind !== 'MODEL') throw new Error('Expected retry');
    expect(retry.task).toMatchObject({
      taskId: first.taskId,
      revision: first.revision,
      windowKey: first.windowKey,
      input: first.input,
      attempt: 1,
    });
    expect(runtime.consecutiveFailures).toBe(0);
    expect(runtime.resolve(transient)).toBeNull();
    expect(runtime.current?.prepared?.source).toBe('FALLBACK');
    expect(runtime.consecutiveFailures).toBe(1);
    runtime.accepted();
    strategy(runtime, 2);
    expect(
      runtime.resolve({ kind: 'SERVICE_ERROR', message: 'unauthorized', retryable: false })
    ).toBeNull();
    expect(runtime.current?.attempt).toBe(0);
    expect(runtime.consecutiveFailures).toBe(2);
  });

  it.each([
    '{}',
    '{"selection":{"kind":"CARDS","cardRefs":["unknown"]}}',
    '{"selection":{"kind":"ACTION","actionRef":"a1"}}',
    '{"selection":{"kind":"CARDS","cardRefs":[]},"extra":"command"}',
  ])('does not ask a model to repair an invalid selection: %s', (text) => {
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    strategy(runtime);
    expect(runtime.resolve({ kind: 'RESPONSE', text })).toBeNull();
    expect(runtime.current?.attempt).toBe(0);
    expect(runtime.current?.prepared?.source).toBe('FALLBACK');
    expect(runtime.consecutiveFailures).toBe(1);
  });
});

describe('AI public LIVE presentation pacing', () => {
  function observe(
    runtime: AiBattleRuntime,
    purpose = 'RULE_CONFIRM',
    phase = GamePhase.PERFORMANCE_PHASE,
    subPhase = SubPhase.NONE
  ) {
    const current = mechanical();
    return runtime.observe(1, 'live', {
      kind: 'DECISION',
      decision: {
        ...current,
        input: {
          ...current.input,
          purpose: purpose as AiDecision['input']['purpose'],
          state: { ...current.input.state, phase, subPhase },
        },
      },
    });
  }

  it.each(['RULE_CONFIRM', 'SUCCESS_LIVE'])(
    'holds %s once per window and does not reset on repeated polling',
    (purpose) => {
      const runtime = new AiBattleRuntime('FIRST', vi.fn());
      expect(observe(runtime, purpose)).toBeNull();
      const deadlineAt = 1000 + AI_LIVE_PRESENTATION_DWELL_MS;
      expect(runtime.waitForLivePresentation(1000)).toEqual({
        kind: 'WAIT',
        reason: 'LIVE_PRESENTATION',
        deadlineAt,
      });
      expect(runtime.waitForLivePresentation(deadlineAt - 1)).toMatchObject({
        kind: 'WAIT',
        deadlineAt,
      });
      expect(runtime.waitForLivePresentation(deadlineAt)).toBeNull();
      expect(runtime.waitForLivePresentation(deadlineAt + 1000)).toBeNull();
      runtime.accepted();
      observe(runtime, purpose);
      expect(runtime.waitForLivePresentation(deadlineAt)).toMatchObject({
        deadlineAt: deadlineAt + AI_LIVE_PRESENTATION_DWELL_MS,
      });
    }
  );

  it('releases score confirmation after 500ms without extending it on repeated polling', () => {
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    observe(runtime, 'RULE_CONFIRM', GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SCORE_CONFIRM);
    expect(runtime.waitForLivePresentation(1000)).toMatchObject({
      kind: 'WAIT',
      deadlineAt: 1500,
    });
    expect(runtime.waitForLivePresentation(1499)).toMatchObject({ deadlineAt: 1500 });
    expect(runtime.waitForLivePresentation(1500)).toBeNull();
    runtime.accepted();
    observe(runtime, 'RULE_CONFIRM', GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_ANIMATION);
    expect(runtime.waitForLivePresentation(1500)).toMatchObject({ deadlineAt: 3300 });
  });

  it.each(['PUBLIC_DISPLAY', 'EFFECT_CONFIRM', 'MAIN'])(
    'does not add another wait to %s',
    (purpose) => {
      const runtime = new AiBattleRuntime('FIRST', vi.fn());
      observe(runtime, purpose);
      expect(runtime.waitForLivePresentation(1000)).toBeNull();
    }
  );

  it('does not delay confirmations outside LIVE or retain a stale/ended window', () => {
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    observe(runtime, 'RULE_CONFIRM', GamePhase.LIVE_SET_PHASE);
    expect(runtime.waitForLivePresentation(1000)).toBeNull();
    runtime.invalidate();
    observe(runtime, 'RULE_CONFIRM', GamePhase.LIVE_RESULT_PHASE);
    expect(runtime.waitForLivePresentation(1000)?.kind).toBe('WAIT');
    runtime.invalidate();
    expect(runtime.waitForLivePresentation(1100)).toBeNull();
    observe(runtime);
    expect(runtime.waitForLivePresentation(1100)).toMatchObject({
      deadlineAt: 1100 + AI_LIVE_PRESENTATION_DWELL_MS,
    });
    runtime.end();
    expect(runtime.waitForLivePresentation(3000)).toBeNull();
  });
});
