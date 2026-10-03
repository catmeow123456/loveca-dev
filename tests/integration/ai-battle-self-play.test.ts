import { describe, expect, it, vi, afterEach } from 'vitest';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { AiBattleDriver } from '../../src/server/ai-battle/driver';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import { deck } from '../helpers/ai-battle-fixture';
import { chooseAiTestSelection, aiTestResponse } from '../helpers/ai-battle-test-policy';
import type { Seat } from '../../src/online/types';
import type { AiModelOutcome } from '../../src/server/ai-battle/runtime';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';
import { CardType } from '../../src/shared/types/enums';
import { AiDatabaseEvidenceArchive } from '../../src/server/ai-battle/evidence-repository';
import { createMemoryAiEvidence } from '../helpers/ai-battle-evidence';

afterEach(() => vi.useRealTimers());
async function fixture() {
  let now = 10_000;
  let seed = 12345678;
  const service = new OnlineMatchService({
    recorder: null,
    now: () => now,
    randomInt: (max) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    },
  });
  const participant = (seat: Seat) => {
    const cards = deck();
    cards.mainDeck = cards.mainDeck.map((card) => ({
      ...card,
      cardCode: `${seat}-${card.cardCode}`,
      name: `${seat}-${card.name}`,
      ...(card.cardType === CardType.LIVE ? { score: seat === 'FIRST' ? 1 : 2 } : {}),
    }));
    return {
      userId: `system:${seat}`,
      ownerUserId: 'local-owner',
      participantKind: 'SYSTEM' as const,
      displayName: seat,
      deck: cards,
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
    };
  };
  const match = await service.createMatch({
    roomCode: 'self-play',
    originKind: 'AI_DEBUG',
    matchMode: 'ONLINE',
    automationGameMode: 'DEBUG',
    first: participant('FIRST'),
    second: participant('SECOND'),
  });
  const traces = { FIRST: new AiBattleTraceStore(), SECOND: new AiBattleTraceStore() };
  for (const seat of ['FIRST', 'SECOND'] as const) traces[seat].open(match.matchId, []);
  return {
    service,
    match,
    traces,
    now: () => now,
    setNow: (value: number) => {
      now = value;
    },
  };
}
const response = (input: Parameters<typeof chooseAiTestSelection>[0]): AiModelOutcome => ({
  kind: 'RESPONSE',
  text: aiTestResponse(input),
});

describe('AI self-play through the shared authority queue', () => {
  it('isolates both hands, rejects duplicate and stale replies, and reaches a natural result without a human', async () => {
    const f = await fixture();
    await f.service.attachAiBattle(f.match.matchId, vi.fn(), undefined, {
      FIRST: f.traces.FIRST.bind(f.match.matchId),
      SECOND: f.traces.SECOND.bind(f.match.matchId),
    });
    const requested = new Set<string>();
    let models = 0;
    for (let step = 0; step < 1200; step++) {
      const result = await f.service.advanceAiBattle(f.match.matchId);
      if (result.kind === 'MODEL') {
        const task = result.task;
        const seat = task.input.state.selfSeat;
        requested.add(seat);
        expect(task.taskId).toMatch(new RegExp(`^${seat}:`));
        const privateFronts = Object.values(task.input.state.objects).filter(
          (object) => object.frontInfo?.cardType !== CardType.ENERGY && object.frontInfo
        );
        // Opponent deck/hand remains hidden. Public cards may belong to either seat later.
        if (models < 2)
          expect(privateFronts.every((object) => object.frontInfo!.cardCode.startsWith(seat))).toBe(
            true
          );
        expect((await f.service.advanceAiBattle(f.match.matchId)).kind).toBe('BUSY');
        const outcome = response(task.input);
        const results = await Promise.all([
          f.service.completeAiBattleTask(f.match.matchId, task, outcome),
          f.service.completeAiBattleTask(f.match.matchId, task, outcome),
        ]);
        expect(results[1].kind).toBe('STALE');
        models++;
      } else if (result.kind === 'WAIT') f.setNow(result.deadlineAt);
      else if (result.kind === 'ENDED') break;
      else expect(result.kind).toBe('ACCEPTED');
    }
    expect(requested).toEqual(new Set(['FIRST', 'SECOND']));
    expect(f.match.session.state!.isEnded).toBe(true);
    expect(f.match.session.state!.endInfo?.winnerId).toBe(f.match.participants.SECOND.playerId);
    for (const seat of ['FIRST', 'SECOND'] as const) {
      // This test drives the authority service directly; collection sealing belongs to its caller.
      expect(f.traces[seat].export(f.match.matchId)!.endedAt).toBeNull();
      f.traces[seat].end(f.match.matchId);
      const observation = f.traces[seat].export(f.match.matchId)!;
      expect(observation.decisions.every((decision) => decision.seat === seat)).toBe(true);
      expect(observation.endedAt).not.toBeNull();
    }
  }, 30_000);

  it('seals a shared journal after both terminal seat events and late model cleanup evidence', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const repository = createMemoryAiEvidence();
    const archive = new AiDatabaseEvidenceArchive(repository, f.match.matchId);
    const shared = new AiBattleTraceStore();
    shared.open(f.match.matchId, [], undefined, archive);
    let release!: () => void;
    const disposing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = {
      decide: async (input: AiDecisionInput) => response(input),
      dispose: async () => {},
    };
    const second = {
      decide: async (input: AiDecisionInput) => response(input),
      dispose: async () => {
        await disposing;
        archive.record('BILLING', { lateCleanup: true });
      },
    };
    const driver = new AiBattleDriver(f.service, f.now);
    await driver.startSelfPlay(
      f.match.matchId,
      { FIRST: first, SECOND: second },
      {
        FIRST: shared.bind(f.match.matchId),
        SECOND: shared.bind(f.match.matchId),
      }
    );
    for (let step = 0; step < 300 && !f.match.session.state!.isEnded; step++) {
      f.setNow(f.now() + 10_000);
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(f.match.session.state!.isEnded).toBe(true);
    await archive.flush();
    const before = await repository.listAfter(f.match.matchId, '0', 10_000);
    const terminal = before.filter(
      (row) =>
        row.entry.kind === 'APPEND' && (row.entry.payload as { stage: string }).stage === 'END'
    );
    expect(terminal).toHaveLength(2);
    expect(before.some((row) => row.entry.kind === 'END')).toBe(false);
    release();
    await driver.stop(f.match.matchId);
    await Promise.resolve();
    await archive.flush();
    const after = await repository.listAfter(f.match.matchId, '0', 10_000);
    expect(after.at(-1)!.entry.kind).toBe('END');
    expect(after.at(-2)!.entry).toMatchObject({ kind: 'BILLING', payload: { lateCleanup: true } });
    expect(after.filter((row) => row.entry.kind === 'END')).toHaveLength(1);
    expect(archive.status()).toMatchObject({ state: 'ENDED', queuedBytes: 0 });
  }, 30_000);

  it('routes independent clients serially and stops both on an adapter failure', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const calls: string[] = [];
    const first = {
      decide: vi.fn(async (input: AiDecisionInput) => {
        calls.push(input.state.selfSeat);
        return response(input);
      }),
      dispose: vi.fn(async () => {}),
    };
    const second = {
      decide: vi.fn(async (input: AiDecisionInput) => {
        calls.push(input.state.selfSeat);
        return { kind: 'ADAPTER_ERROR' as const, message: 'experiment failure' };
      }),
      dispose: vi.fn(async () => {}),
    };
    const driver = new AiBattleDriver(f.service, f.now);
    await driver.startSelfPlay(
      f.match.matchId,
      { FIRST: first, SECOND: second },
      { FIRST: f.traces.FIRST.bind(f.match.matchId), SECOND: f.traces.SECOND.bind(f.match.matchId) }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['FIRST', 'SECOND']);
    const before = f.match.remoteRevision;
    expect(f.service.getAiBattleStatus(f.match.matchId)?.stoppedReason).toContain(
      'experiment failure'
    );
    expect((await f.service.advanceAiBattle(f.match.matchId)).kind).toBe('STOPPED');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.match.remoteRevision).toBe(before);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    await f.service.deleteMatch(f.match.matchId);
  });

  it('rejects a self-play binding with different owners or a single observer', async () => {
    const f = await fixture();
    await expect(
      f.service.attachAiBattle(f.match.matchId, vi.fn(), f.traces.FIRST.bind(f.match.matchId))
    ).rejects.toThrow('已绑定驱动');
    const participant = {
      userId: 'system:one',
      displayName: 'AI',
      deck: deck(),
      participantKind: 'SYSTEM' as const,
      ownerUserId: 'one',
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
    };
    await expect(
      f.service.createMatch({
        roomCode: 'invalid',
        originKind: 'AI_DEBUG',
        first: participant,
        second: { ...participant, userId: 'system:two', ownerUserId: 'two' },
      })
    ).rejects.toThrow('同一所有者');
  });
});
