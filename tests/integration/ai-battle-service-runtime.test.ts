import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameCommandType, createSurrenderCommand } from '../../src/application/game-commands';
import type { Seat } from '../../src/online/types';
import type { RandomIntegerSource } from '../../src/shared/random-source';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import type { MatchRecorderService } from '../../src/server/services/match-recorder-service';
import { AiBattleDriver, type AiBattleModelClient } from '../../src/server/ai-battle/driver';
import type { AiModelTask, AiModelOutcome } from '../../src/server/ai-battle/runtime';
import {
  AI_ACTIVATION_PRESENTATION_DWELL_MS,
  AI_LIVE_PRESENTATION_DWELL_MS,
} from '../../src/server/ai-battle/runtime';
import { buildAiBattleDecision } from '../../src/server/ai-battle/decision';
import { getAiFallbackSelection } from '../../src/server/ai-battle/policy';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import {
  DashScopeAiBattleClient,
  createAiModelConfig,
} from '../../src/server/ai-battle/model-client';
import type { AiFrozenKnowledge } from '../../src/server/ai-battle/presets';
import { CardType, GamePhase, SlotPosition, SubPhase } from '../../src/shared/types/enums';
import { deck, member, replaceHand, stage } from '../helpers/ai-battle-fixture';
import { createPublicObjectId } from '../../src/online/projector';
import type { ActiveEffectState } from '../../src/domain/entities/game';
import { registerActiveEffectStepHandler } from '../../src/application/card-effects/runtime/step-registry';
import { withPublicRevealDwell } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  createPublicCardSelectionConfirmationWindow,
  attachPublicCardSelectionAutoAdvanceDeadline,
} from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createPublicEffectChoiceConfirmationWindow,
  attachPublicEffectChoiceAutoAdvanceDeadline,
} from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';

const humanId = 'admin-user';
const systemId = 'system:ai-battle';
const pointValidation = { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function recorderFixture() {
  const cursor = (matchId: string) => ({
    matchId,
    status: 'IN_PROGRESS' as const,
    completeness: 'FULL' as const,
    turnCount: 0,
    lastTimelineSeq: 1,
    lastCheckpointSeq: 1,
    lastPublicSeq: 0,
    lastPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
    lastAuditSeq: 0,
    lastCommandSeq: 0,
    lastGameEventSeq: 0,
  });
  return {
    beginMatch: vi.fn<MatchRecorderService['beginMatch']>((input) =>
      Promise.resolve({
        ...cursor(input.matchId),
        recordSchemaVersion: 1,
      })
    ),
    recordInitialCheckpoint: vi.fn<MatchRecorderService['recordInitialCheckpoint']>((input) =>
      Promise.resolve({
        matchId: input.matchId,
        timelineSeq: 1,
        checkpointSeq: 1,
        payloadHash: 'sha256:test',
      })
    ),
    getRecordCursor: vi.fn<MatchRecorderService['getRecordCursor']>((id) =>
      Promise.resolve(cursor(id))
    ),
    appendMatchRecordFrame: vi.fn<MatchRecorderService['appendMatchRecordFrame']>((input) =>
      Promise.resolve({
        matchId: input.matchId,
        timelineSeq: 2,
        checkpointSeq: null,
        payloadHash: null,
      })
    ),
    markPartial: vi.fn<MatchRecorderService['markPartial']>(() => Promise.resolve()),
    sealMatch: vi.fn<MatchRecorderService['sealMatch']>((input) =>
      Promise.resolve({
        matchId: input.matchId,
        timelineSeq: 3,
        status: input.status,
        completeness: input.completeness ?? 'FULL',
      })
    ),
  };
}

async function fixture(
  options: {
    main?: boolean;
    aiSeat?: Seat;
    recorder?: ReturnType<typeof recorderFixture>;
    attach?: boolean;
    randomInt?: RandomIntegerSource;
  } = {}
) {
  let now = 10_000;
  const service = new OnlineMatchService({
    now: () => now,
    recorder: options.recorder ?? null,
    randomInt: options.randomInt,
  });
  const human = {
    userId: humanId,
    displayName: '管理员',
    deck: deck(),
    participantKind: 'USER' as const,
    pointValidation,
  };
  const system = {
    userId: systemId,
    displayName: 'AI',
    deck: deck(),
    participantKind: 'SYSTEM' as const,
    ownerUserId: humanId,
    pointValidation,
  };
  const aiSeat = options.aiSeat ?? 'FIRST';
  const match = await service.createMatch({
    roomCode: 'AI-test',
    matchMode: 'ONLINE',
    automationGameMode: 'DEBUG',
    originKind: 'AI_DEBUG',
    originLabel: 'AI 调试',
    first: aiSeat === 'FIRST' ? system : human,
    second: aiSeat === 'FIRST' ? human : system,
  });
  if (options.main) {
    // Focused service-boundary fixture. Complete natural games are in ai-battle-flow.test.ts.
    Object.assign(match.session.state!, {
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    });
    replaceHand(match.session, [member('TEST-MEMBER', 0)]);
  }
  const wake = vi.fn();
  if (options.attach !== false) await service.attachAiBattle(match.matchId, wake);
  return {
    service,
    match,
    wake,
    now: () => now,
    setNow: (value: number) => {
      now = value;
    },
  };
}

async function modelTask(f: Awaited<ReturnType<typeof fixture>>): Promise<AiModelTask> {
  const result = await f.service.advanceAiBattle(f.match.matchId);
  expect(result.kind).toBe('MODEL');
  if (result.kind !== 'MODEL') throw new Error(JSON.stringify(result));
  return result.task;
}

const response = (selection: unknown): AiModelOutcome => ({
  kind: 'RESPONSE',
  text: JSON.stringify({ selection }),
});

afterEach(() => vi.useRealTimers());

describe('AI match authority queue and lifecycle', () => {
  it('holds a combined activation for one second, then selects once from the same model answer and preserves public display', async () => {
    const f = await fixture({ main: true, attach: false });
    const live = deck().mainDeck.find((card) => card.cardType === CardType.LIVE)!;
    const targets = replaceHand(f.match.session, [live, live]);
    const player = f.match.session.state!.players[0];
    Object.assign(player.waitingRoom, { cardIds: targets });
    Object.assign(player.hand, { cardIds: [] });
    const source = stage(f.match.session, member('PL!N-sd1-011-SD', 2), SlotPosition.LEFT);
    const traces = new AiBattleTraceStore(undefined, f.now);
    traces.open(f.match.matchId, []);
    await f.service.attachAiBattle(f.match.matchId, f.wake, traces.bind(f.match.matchId));
    const task = await modelTask(f);
    const candidate = task.input.space.candidates.find(
      (c) => c.followUpTargetObjectId === createPublicObjectId(targets[1]!)
    )!;
    const seq = f.match.session.getRuntimeStats().currentCommandSeq;
    const outcome = response({ kind: 'ACTION', actionRef: candidate.ref });
    const hold = await f.service.completeAiBattleTask(f.match.matchId, task, outcome);
    expect(hold).toEqual({
      kind: 'WAIT',
      reason: 'ACTIVATION_PRESENTATION',
      deadlineAt: f.now() + 1000,
    });
    expect(f.match.session.getCommandLogSince(seq).map((entry) => entry.commandType)).toEqual([
      GameCommandType.ACTIVATE_ABILITY,
    ]);
    expect(await f.service.getMatchSnapshot(f.match.matchId, humanId)).toBeTruthy();
    expect(f.match.session.state!.players[0].memberSlots.slots.LEFT).toBeNull();
    expect(f.match.session.state!.activeEffect?.selectableCardIds).toEqual(targets);
    expect(await f.service.completeAiBattleTask(f.match.matchId, task, outcome)).toEqual({
      kind: 'STALE',
    });
    f.setNow(f.now() + 999);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual(hold);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual(hold);
    expect(f.match.session.getCommandLogSince(seq)).toHaveLength(1);
    f.setNow(f.now() + 1);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'ACCEPTED' });
    expect(f.match.session.getCommandLogSince(seq).map((entry) => entry.commandType)).toEqual([
      GameCommandType.ACTIVATE_ABILITY,
      GameCommandType.CONFIRM_EFFECT_STEP,
    ]);
    const after = f.match.session.state!.players[0];
    expect(after.memberSlots.slots.LEFT).toBeNull();
    expect(after.waitingRoom.cardIds).toContain(source);
    expect(after.hand.cardIds).not.toContain(targets[1]);
    const bundle = traces.export(f.match.matchId, task.taskId)!;
    expect(
      JSON.parse(bundle.materials.find((m) => m.title === 'ACTIVATION_FOLLOW_UP')!.content!)
    ).toMatchObject({ kind: 'READY' });
    expect(
      JSON.parse(bundle.materials.find((m) => m.title === 'AUTHORITY_RESULT')!.content!)
    ).toMatchObject({
      success: true,
      commandRecords: [{ commandType: 'ACTIVATE_ABILITY' }, { commandType: 'CONFIRM_EFFECT_STEP' }],
    });
    const wait = await f.service.advanceAiBattle(f.match.matchId);
    expect(wait).toMatchObject({ kind: 'WAIT', reason: 'PUBLIC_DISPLAY' });
    if (wait.kind !== 'WAIT') throw Error('Expected public display');
    expect(wait.deadlineAt).toBe(f.now() + 2000);
    expect(await f.service.completeAiBattleTask(f.match.matchId, task, outcome)).toEqual({
      kind: 'STALE',
    });
    f.setNow(wait.deadlineAt);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'ACCEPTED' });
    expect(f.match.session.state!.players[0].hand.cardIds).toEqual([targets[1]]);
    expect(f.match.session.state!.players[0].waitingRoom.cardIds).toContain(targets[0]);
  });

  it.each(['surrender', 'changed target'] as const)(
    'cancels the delayed preselection on %s without replaying activation',
    async (change) => {
      const f = await fixture({ main: true });
      const live = deck().mainDeck.find((card) => card.cardType === CardType.LIVE)!;
      const targets = replaceHand(f.match.session, [live, live, live]);
      Object.assign(f.match.session.state!.players[0].waitingRoom, { cardIds: targets });
      Object.assign(f.match.session.state!.players[0].hand, { cardIds: [] });
      stage(f.match.session, member('PL!N-sd1-011-SD', 2), SlotPosition.LEFT);
      const task = await modelTask(f);
      const candidate = task.input.space.candidates.find(
        (c) => c.followUpTargetObjectId === createPublicObjectId(targets[2]!)
      )!;
      const seq = f.match.session.getRuntimeStats().currentCommandSeq;
      const hold = await f.service.completeAiBattleTask(
        f.match.matchId,
        task,
        response({ kind: 'ACTION', actionRef: candidate.ref })
      );
      expect(hold.kind).toBe('WAIT');
      if (change === 'surrender') {
        expect(
          (
            await f.service.executeCommand(
              f.match.matchId,
              humanId,
              createSurrenderCommand(humanId)
            )
          )?.success
        ).toBe(true);
      } else {
        // Even without a revision notification, the delayed target must be queried again.
        Object.assign(f.match.session.state!.activeEffect!, {
          selectableCardIds: targets.slice(0, 2),
        });
      }
      f.setNow(f.now() + AI_ACTIVATION_PRESENTATION_DWELL_MS);
      expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({
        kind: change === 'surrender' ? 'ENDED' : 'ACCEPTED',
      });
      const commands = f.match.session.getCommandLogSince(seq).map((entry) => entry.commandType);
      expect(
        commands.filter((command) => command === GameCommandType.ACTIVATE_ABILITY)
      ).toHaveLength(1);
      expect(commands).not.toContain(GameCommandType.CONFIRM_EFFECT_STEP);
      if (change === 'changed target') {
        const next = await modelTask(f);
        expect(next.input.purpose).toBe('EFFECT');
        expect(next.input.context?.recentDecisions).toHaveLength(1);
        expect(next.input.context?.recentDecisions[0]?.source).toBe('MODEL');
      }
    }
  );

  it('wakes the delayed target through the driver timer without another model request', async () => {
    vi.useFakeTimers();
    const f = await fixture({ main: true, attach: false });
    const live = deck().mainDeck.find((card) => card.cardType === CardType.LIVE)!;
    const targets = replaceHand(f.match.session, [live, live]);
    Object.assign(f.match.session.state!.players[0].waitingRoom, { cardIds: targets });
    Object.assign(f.match.session.state!.players[0].hand, { cardIds: [] });
    stage(f.match.session, member('PL!N-sd1-011-SD', 2), SlotPosition.LEFT);
    const decide = vi.fn<AiBattleModelClient['decide']>(async (input) =>
      response({
        kind: 'ACTION',
        actionRef: input.space.candidates.find((c) => c.followUpTargetObjectId)!.ref,
      })
    );
    const seq = f.match.session.getRuntimeStats().currentCommandSeq;
    const driver = new AiBattleDriver(f.service, f.now);
    await driver.start(f.match.matchId, { decide });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.match.session.getCommandLogSince(seq)).toHaveLength(1);
    f.setNow(f.now() + 999);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.match.session.getCommandLogSince(seq)).toHaveLength(1);
    f.setNow(f.now() + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.match.session.getCommandLogSince(seq).map((entry) => entry.commandType)).toEqual([
      GameCommandType.ACTIVATE_ABILITY,
      GameCommandType.CONFIRM_EFFECT_STEP,
    ]);
    expect(decide).toHaveBeenCalledTimes(1);
    await driver.stop(f.match.matchId);
  });

  it('cancels a sole-action phase completion if the match ends while waiting', async () => {
    const f = await fixture({ main: true });
    replaceHand(f.match.session, []);
    const wait = await f.service.advanceAiBattle(f.match.matchId);
    expect(wait).toMatchObject({ kind: 'WAIT', reason: 'PHASE_COMPLETION' });
    await f.service.executeCommand(f.match.matchId, humanId, createSurrenderCommand(humanId));
    const seq = f.match.session.getRuntimeStats().currentCommandSeq;
    f.setNow(f.now() + 10_000);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'ENDED' });
    expect(f.match.session.getCommandLogSince(seq)).toEqual([]);
  });

  it('keeps the activation committed and asks again if the immediate target window changes', async () => {
    const recorder = recorderFixture();
    const f = await fixture({ main: true, recorder });
    const live = deck().mainDeck.find((card) => card.cardType === CardType.LIVE)!;
    const targets = replaceHand(f.match.session, [live, live, live]);
    Object.assign(f.match.session.state!.players[0].waitingRoom, { cardIds: targets });
    Object.assign(f.match.session.state!.players[0].hand, { cardIds: [] });
    const source = stage(f.match.session, member('PL!N-sd1-011-SD', 2), SlotPosition.LEFT);
    const task = await modelTask(f);
    const candidate = task.input.space.candidates.find(
      (c) => c.followUpTargetObjectId === createPublicObjectId(targets[2]!)
    )!;
    // Inject a changed next window after the real first command, at the recorder boundary.
    recorder.appendMatchRecordFrame.mockImplementationOnce(async (input) => {
      Object.assign(f.match.session.state!.activeEffect!, {
        selectableCardIds: targets.slice(0, 2),
      });
      return { matchId: input.matchId, timelineSeq: 2, checkpointSeq: null, payloadHash: null };
    });
    const seq = f.match.session.getRuntimeStats().currentCommandSeq;
    expect(
      await f.service.completeAiBattleTask(
        f.match.matchId,
        task,
        response({ kind: 'ACTION', actionRef: candidate.ref })
      )
    ).toEqual({ kind: 'ACCEPTED' });
    expect(f.match.session.getCommandLogSince(seq).map((entry) => entry.commandType)).toEqual([
      GameCommandType.ACTIVATE_ABILITY,
    ]);
    expect(f.match.session.state!.players[0].memberSlots.slots.LEFT).toBeNull();
    expect(f.match.session.state!.players[0].waitingRoom.cardIds).toContain(source);
    const next = await modelTask(f);
    expect(next.input.purpose).toBe('EFFECT');
    expect(next.input.space.candidates.map((c) => c.objectId)).toEqual(
      targets.slice(0, 2).map(createPublicObjectId)
    );
  });

  it.each([SubPhase.PERFORMANCE_LIVE_START_EFFECTS, SubPhase.PERFORMANCE_JUDGMENT])(
    'holds %s for 1.8 seconds without blocking snapshots or calling the model',
    async (subPhase) => {
      vi.useFakeTimers();
      const f = await fixture({ attach: false });
      Object.assign(f.match.session.state!, {
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: subPhase,
        activePlayerIndex: 0,
        waitingPlayerId: null,
      });
      const before = f.match.remoteRevision;
      const decide = vi.fn<AiBattleModelClient['decide']>();
      const driver = new AiBattleDriver(f.service, f.now);
      await driver.start(f.match.matchId, { decide });
      await vi.advanceTimersByTimeAsync(0);
      const wait = await f.service.advanceAiBattle(f.match.matchId);
      expect(wait).toEqual({
        kind: 'WAIT',
        reason: 'LIVE_PRESENTATION',
        deadlineAt: f.now() + AI_LIVE_PRESENTATION_DWELL_MS,
      });
      expect(await f.service.getMatchSnapshot(f.match.matchId, humanId)).toBeTruthy();
      f.setNow(f.now() + AI_LIVE_PRESENTATION_DWELL_MS - 1);
      await vi.advanceTimersByTimeAsync(AI_LIVE_PRESENTATION_DWELL_MS - 1);
      expect(f.match.remoteRevision).toBe(before);
      expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual(wait);
      f.setNow(f.now() + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.match.remoteRevision).toBe(before + 1);
      expect(decide).not.toHaveBeenCalled();
      await f.service.deleteMatch(f.match.matchId);
      await vi.advanceTimersByTimeAsync(AI_LIVE_PRESENTATION_DWELL_MS);
      expect(f.match.remoteRevision).toBe(before + 1);
    }
  );

  it('cancels a held LIVE confirmation when the human ends the game before its deadline', async () => {
    vi.useFakeTimers();
    const f = await fixture({ attach: false });
    Object.assign(f.match.session.state!, {
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    });
    const decide = vi.fn<AiBattleModelClient['decide']>();
    await new AiBattleDriver(f.service, f.now).start(f.match.matchId, { decide });
    await vi.advanceTimersByTimeAsync(0);
    expect((await f.service.advanceAiBattle(f.match.matchId)).kind).toBe('WAIT');
    const human = f.match.participants.SECOND;
    const surrendered = await f.service.executeCommand(
      f.match.matchId,
      humanId,
      createSurrenderCommand(human.playerId, f.now())
    );
    expect(surrendered?.success).toBe(true);
    const revision = f.match.remoteRevision;
    f.setNow(f.now() + AI_LIVE_PRESENTATION_DWELL_MS);
    await vi.advanceTimersByTimeAsync(AI_LIVE_PRESENTATION_DWELL_MS);
    expect(f.match.remoteRevision).toBe(revision);
    expect(decide).not.toHaveBeenCalled();
    expect(f.match.session.getCommandLogSince(0).map((entry) => entry.commandType)).toEqual([
      GameCommandType.SURRENDER,
    ]);
    await f.service.deleteMatch(f.match.matchId);
  });

  it('submits one LIVE_SET model selection as the final card set and immediately confirms it', async () => {
    const f = await fixture();
    Object.assign(f.match.session.state!, {
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      activePlayerIndex: 0,
      waitingPlayerId: null,
      liveSetCompletedPlayers: [],
    });
    const task = await modelTask(f);
    expect(task.input.purpose).toBe('LIVE_SET');
    expect(task.input.liveSet?.selectionMode).toBe('FINAL_SET_AND_CONFIRM');
    expect(task.input.space.kind).toBe('CARDS');
    const selectedRefs = task.input.space.candidates.slice(0, 2).map((candidate) => candidate.ref);
    const handCount = f.match.session.state!.players[0].hand.cardIds.length;
    const deckCount = f.match.session.state!.players[0].mainDeck.cardIds.length;

    const held = await f.service.completeAiBattleTask(
      f.match.matchId,
      task,
      response({ kind: 'CARDS', cardRefs: selectedRefs })
    );
    expect(held).toMatchObject({ kind: 'WAIT', reason: 'PHASE_COMPLETION' });
    if (held.kind !== 'WAIT') throw new Error(JSON.stringify(held));
    f.setNow(held.deadlineAt);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'ACCEPTED' });

    expect(f.match.session.state!.players[0].liveZone.cardIds).toHaveLength(2);
    expect(f.match.session.state!.players[0].hand.cardIds).toHaveLength(handCount);
    expect(f.match.session.state!.players[0].mainDeck.cardIds).toHaveLength(deckCount - 2);
    expect(f.match.session.getCommandLogSince(0).map((record) => record.commandType)).toEqual([
      GameCommandType.SET_LIVE_CARD,
      GameCommandType.SET_LIVE_CARD,
      GameCommandType.CONFIRM_STEP,
    ]);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'IDLE' });
  });

  it('feeds accepted actions and post-command facts, but not model rationales, into the next queued sample', async () => {
    const f = await fixture({ main: true });
    replaceHand(f.match.session, [member('TEST-MEMBER', 0), member('ANOTHER-MEMBER', 0)]);
    const task = await modelTask(f);
    const play = task.input.space.candidates.find((candidate) => candidate.targetSlot)!;
    const outcome = {
      kind: 'RESPONSE' as const,
      text: JSON.stringify({
        selection: { kind: 'ACTION', actionRef: play.ref },
        tradeoff: '先填补空位，再按实际资源重新比较。',
      }),
    };
    expect(await f.service.completeAiBattleTask(f.match.matchId, task, outcome)).toEqual({
      kind: 'ACCEPTED',
    });
    const next = await modelTask(f);
    expect(next.input.context?.recentDecisions).toMatchObject([
      {
        source: 'MODEL',
        selectedCards: [{ cardCode: 'TEST-MEMBER' }],
        resourcesAfter: {
          stageHeartTotal: next.input.state.selfResources.stageHeartTotal,
          activeEnergyCount: next.input.state.selfResources.activeEnergyCount,
        },
      },
    ]);
    expect(next.input.context?.recentDecisions[0]?.resultSummary).toBeDefined();
    expect(JSON.stringify(next.input.context)).not.toContain('先填补空位，再按实际资源重新比较。');
    expect(JSON.stringify(next.input.context)).not.toContain('modelIntent');
    expect(await f.service.completeAiBattleTask(f.match.matchId, task, outcome)).toEqual({
      kind: 'STALE',
    });
    expect(next.input.context?.recentDecisions).toHaveLength(1);
  });

  it('uses a trusted random source for reproducible initial cards without exposing it as match input', async () => {
    const randomInt = vi.fn<RandomIntegerSource>((max) => max - 1);
    const a = await fixture({ randomInt, attach: false });
    const callsPerMatch = randomInt.mock.calls.length;
    const b = await fixture({ randomInt, attach: false });
    const c = await fixture({ randomInt: () => 0, attach: false });
    const initialCards = (f: Awaited<ReturnType<typeof fixture>>) => {
      const game = f.match.session.state!;
      return game.players.map((player) =>
        [player.hand, player.mainDeck, player.energyDeck].map((zone) =>
          zone.cardIds.map((id) => game.cardRegistry.get(id)!.data.cardCode)
        )
      );
    };
    expect(callsPerMatch).toBeGreaterThan(0);
    expect(randomInt).toHaveBeenCalledTimes(callsPerMatch * 2);
    expect(initialCards(a)).toEqual(initialCards(b));
    expect(initialCards(a)).not.toEqual(initialCards(c));
  });

  it('links sampled history, failed model choice, validated fallback and the actual accepted command record', async () => {
    const f = await fixture({ attach: false });
    const traces = new AiBattleTraceStore(undefined, f.now);
    traces.open(f.match.matchId, []);
    await f.service.attachAiBattle(f.match.matchId, f.wake, traces.bind(f.match.matchId));
    const task = await modelTask(f);
    expect(task.input.history?.selection).toBe('LAST_12_PUBLIC_EVENTS');
    expect(task.input.history?.events).toEqual(
      f.match.session.getPublicEventsSliceSince(0, 12).publicEvents
    );
    expect(task.input.history?.events.length).toBeLessThanOrEqual(12);
    expect(
      await f.service.completeAiBattleTask(f.match.matchId, task, { kind: 'RESPONSE', text: '{}' })
    ).toEqual({ kind: 'ACCEPTED' });
    const bundle = traces.export(f.match.matchId, task.taskId)!;
    const stages = bundle.decisions[0]!.events.map((event) => event.stage);
    expect(stages).toEqual([
      'SAMPLE',
      'MODEL_FAILURE',
      'PREPARED',
      'SUBMIT',
      'AUTHORITY_RESULT',
      'ACCEPTED',
    ]);
    expect(bundle.decisions[0]!.status).toBe('ACCEPTED');
    const result = JSON.parse(
      bundle.materials.find((item) => item.title === 'AUTHORITY_RESULT')!.content!
    ) as { success: boolean; commandRecords: { recordId: string }[] };
    expect(result.success).toBe(true);
    expect(result.commandRecords[0]!.recordId).toBe(
      f.match.session.getCommandLogSince(0).at(-1)!.recordId
    );
    const revision = f.match.remoteRevision;
    const wakeCalls = f.wake.mock.calls.length;
    const observationRevision = traces.list(f.match.matchId)!.revision;
    for (let i = 0; i < 3; i++) {
      traces.list(f.match.matchId);
      traces.export(f.match.matchId);
    }
    expect(f.match.remoteRevision).toBe(revision);
    expect(f.wake).toHaveBeenCalledTimes(wakeCalls);
    expect(traces.list(f.match.matchId)!.revision).toBe(observationRevision);
  });

  it('captures a late HTTP response after queued end without changing the sealed game or retrying', async () => {
    const f = await fixture({ attach: false });
    const traces = new AiBattleTraceStore(undefined, f.now);
    const material = (id: string) => ({
      id,
      title: id,
      source: 'test',
      sha256: 'test',
      content: id,
    });
    const knowledge: AiFrozenKnowledge = {
      rules: material('rules'),
      tutorial: material('tutorial'),
      handbook: material('handbook'),
      ownDeck: material('ownDeck'),
    };
    const network = deferred<Response>();
    const fetcher = vi.fn<typeof globalThis.fetch>(() => network.promise);
    const client = new DashScopeAiBattleClient(
      createAiModelConfig(
        {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'secret-test-only',
        },
        'qwen3.8-max'
      ),
      knowledge,
      traces,
      fetcher,
      f.now
    );
    traces.open(f.match.matchId, [
      knowledge.rules,
      knowledge.tutorial,
      knowledge.handbook,
      knowledge.ownDeck,
      client.configurationMaterial,
    ]);
    const driver = new AiBattleDriver(f.service, f.now);
    await driver.start(f.match.matchId, client, traces.bind(f.match.matchId));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const taskId = traces.list(f.match.matchId)!.decisions[0]!.id;
    expect(await f.service.endAiBattle(f.match.matchId)).toMatchObject({
      removed: true,
      consecutiveFailures: 0,
    });
    const revision = f.match.remoteRevision;
    network.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'late invalid JSON' }, finish_reason: 'stop' }],
        })
      )
    );
    await vi.waitFor(() =>
      expect(
        traces
          .export(f.match.matchId, taskId)!
          .materials.some((item) => item.title === 'RESPONSE_BODY')
      ).toBe(true)
    );
    const bundle = traces.export(f.match.matchId, taskId)!;
    expect(bundle.endedAt).toBe(f.now());
    expect(bundle.decisions[0]!.pendingAttempts).toEqual([]);
    expect(bundle.decisions[0]!.events.some((event) => event.stage === 'MODEL_FAILURE')).toBe(
      false
    );
    expect(f.match.remoteRevision).toBe(revision);
    expect(f.service.getMatch(f.match.matchId)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(bundle)).toContain('late invalid JSON');
    expect(JSON.stringify(bundle)).not.toContain('secret-test-only');
  });

  it('rejects creation with an unowned system seat before creating a history record', async () => {
    const recorder = recorderFixture();
    const service = new OnlineMatchService({ recorder });
    await expect(
      service.createMatch({
        roomCode: 'invalid-ai',
        originKind: 'AI_DEBUG',
        first: {
          userId: humanId,
          displayName: 'admin',
          deck: deck(),
          pointValidation,
          participantKind: 'USER',
        },
        second: {
          userId: systemId,
          displayName: 'AI',
          deck: deck(),
          pointValidation,
          participantKind: 'SYSTEM',
        },
      })
    ).rejects.toMatchObject({ code: 'AI_MATCH_INVALID' });
    expect(recorder.beginMatch).not.toHaveBeenCalled();
  });

  it('carries AI_DEBUG and the system owner into the existing recorder', async () => {
    const recorder = recorderFixture();
    const f = await fixture({ recorder, aiSeat: 'SECOND' });
    const recorded = recorder.beginMatch.mock.calls[0]![0];
    expect(recorded).toMatchObject({
      originKind: 'AI_DEBUG',
      matchMode: 'ONLINE',
      automationGameMode: 'DEBUG',
    });
    expect(recorded.participants.SECOND).toMatchObject({
      participantKind: 'SYSTEM',
      ownerUserId: humanId,
      seat: 'SECOND',
    });
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'IDLE' });
  });
  it('binds SYSTEM internally, samples once, and accepts at most one complete response', async () => {
    const f = await fixture();
    const task = await modelTask(f);
    expect(task.input.purpose).toBe('MULLIGAN');
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'BUSY' });
    const revision = f.match.remoteRevision;
    const command = {
      type: GameCommandType.MULLIGAN,
      playerId: f.match.participants.FIRST.playerId,
      timestamp: f.now(),
      cardIdsToMulligan: [],
    } as const;
    expect((await f.service.executeCommand(f.match.matchId, systemId, command))?.success).toBe(
      false
    );
    const outcome = response({ kind: 'CARDS', cardRefs: [] });
    const results = await Promise.all([
      f.service.completeAiBattleTask(f.match.matchId, task, outcome),
      f.service.completeAiBattleTask(f.match.matchId, task, outcome),
    ]);
    expect(results.map((result) => result.kind)).toEqual(['ACCEPTED', 'STALE']);
    expect(f.match.remoteRevision).toBe(revision + 1);
    expect(task.signal.aborted).toBe(true);
    const wakes = f.wake.mock.calls.length;
    await f.service.getMatchSnapshot(f.match.matchId, humanId);
    await f.service.getMatchSnapshot(f.match.matchId, humanId);
    expect(f.wake).toHaveBeenCalledTimes(wakes);
  });

  it('automatically holds the sole END_PHASE until its deadline after the model plays its last member', async () => {
    const f = await fixture({ main: true });
    const task = await modelTask(f);
    const play = task.input.space.candidates.find((candidate) => candidate.targetSlot);
    const end = task.input.space.candidates.find(
      (candidate) => candidate.availableAt !== undefined
    );
    expect(play).toBeDefined();
    expect(play?.availableAt).toBeUndefined();
    expect(end?.availableAt).toBe(f.now() + 3000);
    const played = await f.service.completeAiBattleTask(
      f.match.matchId,
      task,
      response({ kind: 'ACTION', actionRef: play!.ref })
    );
    expect(played.kind).toBe('ACCEPTED');
    const revision = f.match.remoteRevision;
    const wait = await f.service.advanceAiBattle(f.match.matchId);
    expect(wait).toEqual({
      kind: 'WAIT',
      deadlineAt: end!.availableAt,
      reason: 'PHASE_COMPLETION',
    });
    expect(f.match.remoteRevision).toBe(revision);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual(wait);
    f.setNow(end!.availableAt!);
    expect(await f.service.advanceAiBattle(f.match.matchId)).toEqual({ kind: 'ACCEPTED' });
    expect(f.match.remoteRevision).toBe(revision + 1);
  });

  it.each(['bad JSON', 'timeout', 'valid'])(
    'checks freshness inside the same queue after an intervening surrender (%s)',
    async (kind) => {
      const recorder = recorderFixture();
      const entered = deferred<void>();
      const release = deferred<void>();
      recorder.appendMatchRecordFrame.mockImplementationOnce(async (input) => {
        entered.resolve();
        await release.promise;
        return { matchId: input.matchId, timelineSeq: 2, checkpointSeq: null, payloadHash: null };
      });
      const f = await fixture({ recorder });
      const task = await modelTask(f);
      const surrendered = f.service.executeCommand(
        f.match.matchId,
        humanId,
        createSurrenderCommand('forged-system-player')
      );
      await entered.promise;
      let completed = false;
      const outcome: AiModelOutcome =
        kind === 'timeout'
          ? { kind: 'SERVICE_ERROR', message: 'old timeout', retryable: true }
          : kind === 'valid'
            ? response({ kind: 'CARDS', cardRefs: [] })
            : { kind: 'RESPONSE', text: 'not json' };
      const completion = f.service
        .completeAiBattleTask(f.match.matchId, task, outcome)
        .then((result) => {
          completed = true;
          return result;
        });
      await Promise.resolve();
      expect(completed).toBe(false);
      release.resolve();
      expect((await surrendered)?.success).toBe(true);
      expect(await completion).toEqual({ kind: 'STALE' });
      expect(f.service.getAiBattleStatus(f.match.matchId)).toMatchObject({
        consecutiveFailures: 0,
        ended: true,
      });
      expect(f.match.session.state?.endInfo?.winnerId).toBe(f.match.participants.FIRST.playerId);
      expect(recorder.appendMatchRecordFrame).toHaveBeenCalledTimes(1);
      expect(recorder.sealMatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'SURRENDERED', winnerSeat: 'FIRST' })
      );
    }
  );

  it('keeps a failed end retryable and the match fully drivable, and preserves a natural result', async () => {
    const recorder = recorderFixture();
    const f = await fixture({ recorder });
    const task = await modelTask(f);
    recorder.sealMatch.mockRejectedValueOnce(new Error('seal unavailable'));
    expect(await f.service.deleteMatch(f.match.matchId, { reason: 'AI_DEBUG_ENDED' })).toBe(false);
    // A failed seal must leave no half-dead match: the runtime is not permanently stopped and
    // the in-flight request is not aborted, because the match itself stays live and retryable.
    expect(task.signal.aborted).toBe(false);
    expect(f.service.getMatch(f.match.matchId)).toBe(f.match);
    expect((await f.service.advanceAiBattle(f.match.matchId)).kind).toBe('BUSY');
    // The original request stays completable; an invalid answer goes through the normal
    // output-failure fallback policy instead of being discarded as stale.
    expect(
      await f.service.completeAiBattleTask(f.match.matchId, task, { kind: 'RESPONSE', text: '{}' })
    ).toEqual({ kind: 'ACCEPTED' });
    expect(await f.service.deleteMatch(f.match.matchId, { reason: 'AI_DEBUG_ENDED' })).toBe(true);
    expect(await f.service.deleteMatch(f.match.matchId, { reason: 'AI_DEBUG_ENDED' })).toBe(true);
    expect(recorder.sealMatch).toHaveBeenCalledTimes(2);
    expect(recorder.sealMatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'INTERRUPTED', endReason: 'AI_DEBUG_ENDED' })
    );
    expect(f.service.getMatch(f.match.matchId)).toBeNull();

    const completed = await fixture({ recorder: recorderFixture() });
    await completed.service.executeCommand(
      completed.match.matchId,
      humanId,
      createSurrenderCommand('ignored')
    );
    const endInfo = completed.match.session.state!.endInfo;
    await completed.service.deleteMatch(completed.match.matchId, { reason: 'AI_DEBUG_ENDED' });
    expect(completed.match.session.state!.endInfo).toEqual(endInfo);
  });

  it('forbids undo and FREE through the existing service and snapshot contracts', async () => {
    const f = await fixture();
    const snapshot = await f.service.getMatchSnapshot(f.match.matchId, humanId);
    expect(
      snapshot && 'playerViewState' in snapshot && snapshot.playerViewState.match.undo?.policy
    ).toBe('NONE');
    expect(
      snapshot &&
        'playerViewState' in snapshot &&
        snapshot.playerViewState.match.manualOperation?.canSwitchNow
    ).toBe(false);
    expect(
      (
        await f.service.changeManualOperationMode(f.match.matchId, humanId, {
          targetMode: 'FREE',
          expectedRevision: f.match.remoteRevision,
        })
      )?.success
    ).toBe(false);
    expect(
      (
        await f.service.createUndoRequest(f.match.matchId, humanId, {
          undoEntryId: 'fake',
          expectedRevision: f.match.remoteRevision,
        })
      )?.success
    ).toBe(false);
    expect(f.match.session.manualOperationMode).toBe('RULES');
  });

  it('stops before submitting the third fallback across actual phase changes and confirmations', async () => {
    const f = await fixture({ main: true });
    let failures = 0;
    for (let step = 0; step < 80; step++) {
      const result = await f.service.advanceAiBattle(f.match.matchId);
      if (result.kind === 'MODEL') {
        const revision = f.match.remoteRevision;
        failures++;
        const completion = await f.service.completeAiBattleTask(f.match.matchId, result.task, {
          kind: 'RESPONSE',
          text: '{}',
        });
        if (failures === 3) {
          expect(completion.kind).toBe('STOPPED');
          expect(f.match.remoteRevision).toBe(revision);
          expect(f.service.getAiBattleStatus(f.match.matchId)?.consecutiveFailures).toBe(3);
          expect((await f.service.advanceAiBattle(f.match.matchId)).kind).toBe('STOPPED');
          return;
        }
        expect(f.service.getAiBattleStatus(f.match.matchId)?.consecutiveFailures).toBe(failures);
      } else if (result.kind === 'WAIT') {
        f.setNow(result.deadlineAt);
      } else if (result.kind === 'IDLE') {
        // Complete the human's ordinary rule inputs, with the same stage gate observed first.
        await f.service.getMatchSnapshot(f.match.matchId, humanId);
        f.setNow(f.now() + 3000);
        const playerId = f.match.participants.SECOND.playerId;
        const query = buildAiBattleDecision(
          f.match.session.state!,
          playerId,
          f.match.session.getPlayerViewState(playerId)!
        );
        if (query.kind !== 'DECISION') throw new Error(JSON.stringify(query));
        const command = query.decision.toCommand(getAiFallbackSelection(query.decision), f.now());
        const accepted = await f.service.executeCommand(f.match.matchId, humanId, command);
        expect(accepted?.success, accepted && !accepted.success ? accepted.error : '').toBe(true);
      } else {
        expect(result.kind).toBe('ACCEPTED');
      }
    }
    throw new Error('Did not reach three strategy decisions');
  });

  it('rejects an older attempt before parsing while the same decision has a retry in flight', async () => {
    const f = await fixture();
    const first = await modelTask(f);
    const retry = await f.service.completeAiBattleTask(f.match.matchId, first, {
      kind: 'SERVICE_ERROR',
      message: 'temporary upstream failure',
      retryable: true,
    });
    expect(retry.kind).toBe('MODEL');
    expect(
      await f.service.completeAiBattleTask(f.match.matchId, first, { kind: 'RESPONSE', text: '{}' })
    ).toEqual({ kind: 'STALE' });
    expect(f.service.getAiBattleStatus(f.match.matchId)?.consecutiveFailures).toBe(0);
    if (retry.kind !== 'MODEL') throw new Error('Missing retry');
    expect(
      await f.service.completeAiBattleTask(
        f.match.matchId,
        retry.task,
        response({ kind: 'CARDS', cardRefs: [] })
      )
    ).toEqual({ kind: 'ACCEPTED' });
  });

  it('never reexecutes an accepted choice after recorder append fails', async () => {
    const recorder = recorderFixture();
    const f = await fixture({ recorder });
    const task = await modelTask(f);
    recorder.appendMatchRecordFrame.mockRejectedValueOnce(new Error('append failed'));
    const revision = f.match.remoteRevision;
    expect(
      await f.service.completeAiBattleTask(
        f.match.matchId,
        task,
        response({ kind: 'CARDS', cardRefs: [] })
      )
    ).toEqual({ kind: 'ACCEPTED' });
    expect(recorder.markPartial).toHaveBeenCalled();
    expect(
      await f.service.completeAiBattleTask(
        f.match.matchId,
        task,
        response({ kind: 'CARDS', cardRefs: [] })
      )
    ).toEqual({ kind: 'STALE' });
    expect(f.match.remoteRevision).toBe(revision + 1);
    expect(recorder.appendMatchRecordFrame).toHaveBeenCalledTimes(1);
  });

  it('runs the driver outside the queue and wakes its held selection without browser reads', async () => {
    vi.useFakeTimers();
    const f = await fixture({ main: true, attach: false });
    vi.setSystemTime(f.now());
    const pending = deferred<AiModelOutcome>();
    const decide = vi.fn<AiBattleModelClient['decide']>(() => pending.promise);
    const driver = new AiBattleDriver(f.service, f.now);
    await driver.start(f.match.matchId, { decide });
    await vi.advanceTimersByTimeAsync(0);
    expect(decide).toHaveBeenCalledTimes(1);
    const input = decide.mock.calls[0]![0];
    expect(input).toBeDefined();
    const before = f.match.remoteRevision;
    // The unresolved model request holds no authority lock.
    const snapshot = await f.service.getMatchSnapshot(f.match.matchId, humanId);
    expect(snapshot).toBeTruthy();
    const end = input.space.candidates.find((candidate) => candidate.availableAt)!;
    pending.resolve(response({ kind: 'ACTION', actionRef: end.ref }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.match.remoteRevision).toBe(before);
    f.setNow(end.availableAt!);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.match.remoteRevision).toBe(before + 1);
    expect(decide).toHaveBeenCalledTimes(1);
    await f.service.deleteMatch(f.match.matchId);
  });

  it('honors the bounded local provider deadline and stops without retry, fallback or late commands', async () => {
    vi.useFakeTimers();
    const f = await fixture({ attach: false });
    const late = deferred<AiModelOutcome>();
    const decide = vi.fn<AiBattleModelClient['decide']>(() => late.promise);
    await new AiBattleDriver(f.service, f.now).start(f.match.matchId, {
      decide,
      requestTimeoutMs: 90_000,
      stopOnTimeout: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    const before = f.match.remoteRevision;
    await vi.advanceTimersByTimeAsync(89_999);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![1].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(decide.mock.calls[0]![1].aborted).toBe(true);
    expect(f.service.getAiBattleStatus(f.match.matchId)?.stoppedReason).toContain(
      'provider requires stop'
    );
    late.resolve({ kind: 'RESPONSE', text: '{}' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.match.remoteRevision).toBe(before);
    expect(decide).toHaveBeenCalledTimes(1);
    await f.service.deleteMatch(f.match.matchId);
  });

  it.each([undefined, 120_000])(
    'retries a timed-out request once, ignores its late output, then falls back once (deadline %s)',
    async (requestTimeoutMs) => {
      vi.useFakeTimers();
      const f = await fixture({ attach: false });
      const late = deferred<AiModelOutcome>();
      const signals: AbortSignal[] = [];
      const decide = vi.fn<AiBattleModelClient['decide']>((_, signal) => {
        signals.push(signal);
        return late.promise;
      });
      await new AiBattleDriver(f.service, f.now).start(f.match.matchId, {
        decide,
        requestTimeoutMs,
      });
      await vi.advanceTimersByTimeAsync(0);
      const before = f.match.remoteRevision;
      const timeout = requestTimeoutMs ?? 30_000;
      await vi.advanceTimersByTimeAsync(timeout - 1);
      expect(decide).toHaveBeenCalledTimes(1);
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(decide).toHaveBeenCalledTimes(2);
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
      expect(decide.mock.calls[0]![0]).toEqual(decide.mock.calls[1]![0]);
      expect(f.service.getAiBattleStatus(f.match.matchId)?.consecutiveFailures).toBe(0);
      await vi.advanceTimersByTimeAsync(timeout);
      expect(signals[1]?.aborted).toBe(true);
      expect(f.match.remoteRevision).toBe(before + 1);
      expect(f.service.getAiBattleStatus(f.match.matchId)?.consecutiveFailures).toBe(1);
      late.resolve({ kind: 'RESPONSE', text: '{' });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.match.remoteRevision).toBe(before + 1);
      expect(decide).toHaveBeenCalledTimes(2);
      expect(f.service.getAiBattleStatus(f.match.matchId)?.consecutiveFailures).toBe(1);
      await f.service.deleteMatch(f.match.matchId);
    }
  );

  it.each(['REVEAL', 'CARDS', 'CHOICE'] as const)(
    'advances the human-controlled %s display once without polling or model calls',
    async (kind) => {
      vi.useFakeTimers();
      const f = await fixture({ main: true, aiSeat: 'SECOND', attach: false });
      const state = f.match.session.state!;
      const human = state.players[0];
      const cardId = human.hand.cardIds[0]!;
      Object.assign(human.hand, { cardIds: human.hand.cardIds.slice(1) });
      Object.assign(human.waitingRoom, { cardIds: [cardId] });
      const resolved = vi.fn();
      const effect: ActiveEffectState = {
        id: `display-${kind}`,
        abilityId: `test:ai-service-display:${kind}`,
        sourceCardId: cardId,
        controllerId: human.id,
        awaitingPlayerId: human.id,
        effectText: '测试公共展示后结算',
        stepId: 'RESOLVE',
        stepText: '公开结果',
        selectableCardIds: [cardId],
        selectableCardMode: 'SINGLE',
        effectChoice: {
          mode: 'SINGLE',
          options: [{ id: 'finish', text: '结算' }],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
      };
      registerActiveEffectStepHandler(effect.abilityId, effect.stepId, (game) => {
        resolved();
        return { ...game, activeEffect: null };
      });
      const displayed =
        kind === 'REVEAL'
          ? {
              ...state,
              activeEffect: withPublicRevealDwell({ ...effect, effectChoice: undefined }, [cardId]),
            }
          : kind === 'CARDS'
            ? createPublicCardSelectionConfirmationWindow(
                state,
                { ...effect, effectChoice: undefined },
                { selectedCardId: cardId },
                { destination: 'HAND' }
              )!
            : createPublicEffectChoiceConfirmationWindow(state, effect, {}, ['finish']);
      f.match.session.restoreRuntimeState({
        authorityState: attachPublicEffectChoiceAutoAdvanceDeadline(
          attachPublicCardSelectionAutoAdvanceDeadline(displayed, f.now()),
          f.now()
        ),
        currentPublicSeq: f.match.session.getCurrentPublicEventSeq(),
      });
      const active = f.match.session.state!.activeEffect!;
      const deadline =
        active.publicRevealAutoAdvanceAt ??
        active.publicCardSelectionAutoAdvanceAt ??
        active.publicEffectChoiceAutoAdvanceAt!;
      expect(deadline).toBeGreaterThan(f.now());
      const decide = vi.fn<AiBattleModelClient['decide']>(() =>
        Promise.reject(new Error('Display has no strategic choice'))
      );
      await new AiBattleDriver(f.service, f.now).start(f.match.matchId, { decide });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).not.toHaveBeenCalled();
      const before = f.match.remoteRevision;
      const elapsed = deadline - f.now();
      f.setNow(deadline - 1);
      await vi.advanceTimersByTimeAsync(elapsed - 1);
      expect(resolved).not.toHaveBeenCalled();
      f.setNow(deadline);
      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(f.match.session.state!.activeEffect).toBeNull();
      expect(f.match.remoteRevision).toBe(before + 1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(decide).not.toHaveBeenCalled();
      await f.service.deleteMatch(f.match.matchId);
    }
  );
});
