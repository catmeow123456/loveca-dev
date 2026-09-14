import { describe, expect, it, vi } from 'vitest';
import {
  buildAiBattleDecision,
  type AiDecision,
  type AiSelection,
} from '../../src/server/ai-battle/decision';
import { AiBattleRuntime } from '../../src/server/ai-battle/runtime';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { createPublicObjectId } from '../../src/online/projector';
import { summarizeAiSelfResources } from '../../src/server/ai-battle/visible-resources';
import { createPlanningFixture } from '../helpers/ai-battle-planning-fixture';

type Fixture = ReturnType<typeof createPlanningFixture>;
function observation(f: Fixture, runtime: AiBattleRuntime) {
  const slice = f.session.getPublicEventsSliceSince(runtime.observedPublicSeq, 256);
  return {
    events: slice.publicEvents,
    throughPublicSeq: f.session.getCurrentPublicEventSeq(),
    droppedEventCount: slice.droppedEventCount,
  };
}
function query(f: Fixture): AiDecision {
  for (let i = 0; i < 3; i++) {
    const q = buildAiBattleDecision(f.session.state!, 'ai', f.session.getPlayerViewState('ai')!);
    if (q.kind === 'WAITING_FOR_TIME') {
      f.advanceTime(q.deadlineAt + 1);
      continue;
    }
    expect(q.kind).toBe('DECISION');
    if (q.kind === 'DECISION') return q.decision;
  }
  throw new Error('No decision');
}
function execute(f: Fixture, runtime: AiBattleRuntime, selection: AiSelection, tradeoff?: string) {
  const d = query(f);
  runtime.observe(
    f.session.getCurrentPublicEventSeq(),
    `${f.session.state!.currentPhase}:${f.session.state!.activeEffect?.id}`,
    { kind: 'DECISION', decision: d },
    f.session.getPlayerViewState('ai')!,
    observation(f, runtime)
  );
  if (!runtime.current?.prepared)
    runtime.resolve({
      kind: 'RESPONSE',
      text: JSON.stringify({ selection, ...(tradeoff ? { tradeoff } : {}) }),
    });
  const result = f.session.executeCommand(runtime.command(f.now()));
  expect(result.success, result.error).toBe(true);
  runtime.accepted(f.session.getPlayerViewState('ai')!, observation(f, runtime));
}
function chooseCard(d: AiDecision, code: string): AiSelection {
  const candidate = d.input.space.candidates.find(
    (c) => c.objectId && d.input.state.objects[c.objectId]?.frontInfo?.cardCode === code
  )!;
  expect(candidate, code).toBeDefined();
  return { kind: 'CARDS', cardRefs: [candidate.ref] };
}

describe('logged green planning regressions through shared rules', () => {
  it.each([
    ['111', 7, 12, 9, true],
    ['149', 8, 12, 9, true],
    ['151', 5, 13, 8, false],
  ] as const)(
    'decision %s exposes and executes source-cost entry resources',
    (id, energy, hearts, blade, hasCompanion) => {
      const f = createPlanningFixture(id);
      const runtime = new AiBattleRuntime('FIRST', vi.fn());
      const before = globalThis.structuredClone(f.session.state);
      const randomBefore = f.randomCalls();
      const d = query(f);
      const activation = d.input.space.candidates.find(
        (c) => c.activation?.destination === 'SOURCE_MEMBER_SLOT'
      )!;
      expect(activation.energyCost).toBe(2);
      const hime = activation.activation!.targets.find(
        (c) => d.input.state.objects[c.objectId]?.frontInfo?.cardCode === 'PL!HS-sd1-006-SD'
      )!;
      expect(hime.entryResources).toMatchObject([
        {
          conditionMet: hasCompanion,
          activateEnergyUpTo: hasCompanion ? 1 : 0,
        },
      ]);
      expect(hime.entryResources![0]!.recoverLiveObjectIds.length > 0).toBe(hasCompanion);
      expect(hime.stageAfterEntry).toMatchObject({
        stageHeartTotal: hearts,
        stageHeartCounts: { GREEN: 4 },
        activeMemberBladeTotal: blade,
      });
      const source = activation.objectId!;
      expect(activation.activation!.targets.map((c) => c.objectId)).toContain(source);
      expect(f.session.state).toEqual(before);
      expect(f.randomCalls()).toBe(randomBefore);
      execute(
        f,
        runtime,
        { kind: 'ACTION', actionRef: activation.ref },
        '支付2直接登场姬芽，继续比较回能、回收与本轮LIVE。'
      );
      execute(f, runtime, chooseCard(query(f), 'PL!HS-sd1-006-SD'));
      if (hasCompanion) {
        const recovery = query(f);
        const budgetFor = (code: string) =>
          recovery.input.space.candidates.find(
            (c) =>
              c.objectId && recovery.input.state.objects[c.objectId]?.frontInfo?.cardCode === code
          )?.liveBaseBudget;
        expect(budgetFor('PL!HS-bp6-027-L')).toMatchObject({
          stageAloneMeetsBaseRequirement: true,
          missingHearts: {},
        });
        expect(budgetFor('PL!HS-bp5-019-L')).toMatchObject({
          stageAloneMeetsBaseRequirement: false,
          missingHearts: { GREEN: 5 },
        });
        execute(f, runtime, chooseCard(recovery, 'PL!HS-bp6-027-L'));
      }
      for (let i = 0; i < 8 && query(f).input.purpose !== 'MAIN'; i++) {
        const mechanical = getAiMechanicalSelection(query(f));
        expect(mechanical).not.toBeNull();
        execute(f, runtime, mechanical!);
      }
      expect(query(f).input.purpose).toBe('MAIN');
      const resources = summarizeAiSelfResources(f.session.getPlayerViewState('ai')!, 'FIRST');
      expect(resources).toMatchObject({
        activeEnergyCount: energy,
        stageHeartTotal: hearts,
        activeMemberBladeTotal: blade,
      });
      expect(resources.handLiveCount).toBe(
        d.input.state.selfResources.handLiveCount + Number(hasCompanion)
      );
      expect(resources.handCards.find((card) => card.cardCode === 'PL!HS-bp5-019-L')).toMatchObject(
        {
          liveBaseBudget: { stageAloneMeetsBaseRequirement: false, missingHearts: { GREEN: 5 } },
        }
      );
      expect(f.randomCalls()).toBe(randomBefore);
      expect(
        f.session.state!.players[0].waitingRoom.cardIds.map(
          (id) => f.session.state!.cardRegistry.get(id)!.data.cardCode
        )
      ).toContain('PL!HS-bp1-002-RM');
    }
  );

  it('retains a legitimately chosen private deck top across fresh model requests, then invalidates it on movement', () => {
    const f = createPlanningFixture('149');
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    f.setTop(
      [
        'PL!HS-bp6-001-R+',
        'PL!HS-pb1-009-R',
        'PL!HS-pb1-020-N',
        'PL!HS-bp6-027-L',
        'PL!HS-bp5-001-SEC',
      ].map((code) => f.facts.get(code)!)
    );
    const d = query(f);
    const play = d.input.space.candidates.find(
      (c) =>
        c.targetSlot === 'CENTER' &&
        c.objectId &&
        d.input.state.objects[c.objectId]?.frontInfo?.cardCode === 'PL!HS-bp6-001-R+'
    )!;
    execute(
      f,
      runtime,
      { kind: 'ACTION', actionRef: play.ref },
      '检视整理顶牌，之后重新比较沙耶香路线。'
    );
    const inspect = query(f);
    const selection = chooseCard(inspect, 'PL!HS-bp6-027-L');
    execute(
      f,
      runtime,
      selection,
      '月夜见海月放回顶；下一次盖牌补牌会抽到，但本次设置结束后不能再盖。'
    );
    const current = query(f);
    const task = runtime.observe(
      900,
      'after-inspection',
      { kind: 'DECISION', decision: current },
      f.session.getPlayerViewState('ai')!,
      observation(f, runtime)
    );
    expect(task?.kind).toBe('MODEL');
    if (task?.kind !== 'MODEL') throw new Error('Expected model');
    expect(task.task.input.context?.knownDeckTop?.frontInfo.cardCode).toBe('PL!HS-bp6-027-L');
    expect(task.task.input.context?.recentDecisions).toHaveLength(2);
    expect(task.task.input.context?.recentDecisions[1]?.resultSummary).toBeDefined();
    expect(JSON.stringify(task.task.input.context)).not.toContain('本次设置结束后不能再盖');
    const topId = createPublicObjectId(f.session.state!.players[0].mainDeck.cardIds[0]!);
    expect(task.task.input.state.objects[topId]).toBeUndefined();
    expect(task.task.input.context?.lastAction?.selectedCards[0]?.cardCode).toBe('PL!HS-bp6-027-L');
    runtime.invalidate();
    // The public movement notification invalidates position knowledge before the next model call.
    const fromDeck = {
      type: 'CardMovedPublic' as const,
      source: 'SYSTEM' as const,
      actorSeat: 'FIRST' as const,
      eventId: 'top-moved',
      matchId: f.session.getPlayerViewState('ai')!.match.matchId,
      seq: runtime.observedPublicSeq + 1,
      timestamp: f.now(),
      from: { zone: 'MAIN_DECK', ownerSeat: 'FIRST' as const, index: 0 },
      to: { zone: 'HAND', ownerSeat: 'FIRST' as const },
      count: 1,
    };
    const next = runtime.observe(
      901,
      'after-draw',
      { kind: 'DECISION', decision: current },
      f.session.getPlayerViewState('ai')!,
      { events: [fromDeck], throughPublicSeq: fromDeck.seq, droppedEventCount: 0 }
    );
    expect(next?.kind).toBe('MODEL');
    if (next?.kind === 'MODEL') expect(next.task.input.context?.knownDeckTop).toBeUndefined();
  });

  it('does not remember an unaccepted/stale model plan', () => {
    const f = createPlanningFixture('111');
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    const d = query(f);
    runtime.observe(1, 'old', { kind: 'DECISION', decision: d });
    runtime.resolve({
      kind: 'RESPONSE',
      text: JSON.stringify({
        selection: { kind: 'ACTION', actionRef: d.input.space.candidates[0]!.ref },
        tradeoff: 'UNACCEPTED_PLAN',
      }),
    });
    runtime.invalidate();
    const next = runtime.observe(2, 'new', { kind: 'DECISION', decision: d });
    expect(next?.kind).toBe('MODEL');
    if (next?.kind === 'MODEL') {
      expect(next.task.input.context?.recentDecisions).toEqual([]);
      expect(JSON.stringify(next.task.input)).not.toContain('UNACCEPTED_PLAN');
    }
  });
});
