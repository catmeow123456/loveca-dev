import { describe, expect, it } from 'vitest';
import { AiDecisionContext } from '../../src/server/ai-battle/decision-context';
import type { PublicEvent } from '../../src/online/types';
import { createPlanningFixture } from '../helpers/ai-battle-planning-fixture';
import { buildAiBattleDecision } from '../../src/server/ai-battle/decision';
import { decision, setup, submit, P1 } from '../helpers/ai-battle-fixture';

function knownTop() {
  const f = createPlanningFixture('111');
  const view = f.session.getPlayerViewState('ai')!;
  const memory = new AiDecisionContext('FIRST');
  memory.observe(view, { events: [], throughPublicSeq: 0, droppedEventCount: 0 });
  const event: PublicEvent = {
    type: 'CardMovedPublic',
    source: 'PLAYER',
    actorSeat: 'FIRST',
    eventId: 'visible-return',
    matchId: view.match.matchId,
    seq: 1,
    timestamp: 1,
    from: { zone: 'HAND', ownerSeat: 'FIRST', index: 0 },
    to: { zone: 'MAIN_DECK', ownerSeat: 'FIRST', index: 0 },
    count: 1,
  };
  Object.assign(view.table.zones.FIRST_MAIN_DECK, {
    count: view.table.zones.FIRST_MAIN_DECK.count + 1,
  });
  memory.observe(view, { events: [event], throughPublicSeq: 1, droppedEventCount: 0 });
  expect(memory.input(5).knownDeckTop?.frontInfo.cardCode).toBe('PL!HS-bp5-019-L');
  return { f, view, memory };
}

describe('AI player knowledge boundaries', () => {
  it.each([false, true])(
    'forgets a known top after an unreported draw (observation: %s)',
    (observed) => {
      const { view, memory } = knownTop();
      Object.assign(view.table.zones.FIRST_MAIN_DECK, {
        count: view.table.zones.FIRST_MAIN_DECK.count - 1,
      });
      memory.observe(
        view,
        observed ? { events: [], throughPublicSeq: 2, droppedEventCount: 0 } : undefined
      );
      expect(memory.input(5).knownDeckTop).toBeUndefined();
    }
  );

  it('does not retain a newly returned top when the same batch also contains an unreported draw', () => {
    const { view, memory } = knownTop();
    // Return one visible card, then draw it: final count is unchanged, but public delta is +1.
    memory.observe(view, {
      events: [
        {
          type: 'CardMovedPublic',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          eventId: 'return-and-draw',
          matchId: view.match.matchId,
          seq: 2,
          timestamp: 2,
          from: { zone: 'HAND', ownerSeat: 'FIRST', index: 0 },
          to: { zone: 'MAIN_DECK', ownerSeat: 'FIRST', index: 0 },
          count: 1,
        },
      ],
      throughPublicSeq: 2,
      droppedEventCount: 0,
    });
    expect(memory.input(5).knownDeckTop).toBeUndefined();
  });

  it('keeps known top through an opponent deck count change', () => {
    const { view, memory } = knownTop();
    Object.assign(view.table.zones.SECOND_MAIN_DECK, {
      count: view.table.zones.SECOND_MAIN_DECK.count - 1,
    });
    memory.observe(view, { events: [], throughPublicSeq: 2, droppedEventCount: 0 });
    expect(memory.input(5).knownDeckTop?.frontInfo.cardCode).toBe('PL!HS-bp5-019-L');
  });

  it.each([false, true])(
    'labels mulligan history explicitly (keep all: %s) and stores identities only',
    (keepAll) => {
      const { session } = setup(false);
      const current = decision(session);
      const memory = new AiDecisionContext('FIRST');
      const chosen = keepAll ? [] : current.input.space.candidates.slice(0, 2);
      const selection = { kind: 'CARDS' as const, cardRefs: chosen.map((c) => c.ref) };
      submit(session, current, selection);
      memory.accepted(current.input, selection, 'MODEL', session.getPlayerViewState(P1)!);
      const action = memory.input(current.input.state.turn).lastAction!;
      expect(action.actions).toEqual(
        keepAll ? ['起手换牌：全部保留'] : chosen.map((c) => `换回卡组：${c.description}`)
      );
      expect(action.selectedCards.map((card) => card.cardCode)).toEqual(
        chosen.map((c) => current.input.state.objects[c.objectId!]!.frontInfo!.cardCode)
      );
      for (const card of action.selectedCards) {
        expect(card).not.toHaveProperty('hearts');
        expect(card).not.toHaveProperty('blade');
        expect(card).not.toHaveProperty('cardTextJp');
        expect(card).not.toHaveProperty('cardTextCn');
      }
      expect(action.resourcesAfter?.handCardCount).toBe(action.resourcesBefore.handCardCount);
    }
  );

  it('remembers ordered card choices in the accepted selection order', () => {
    const { f, view, memory } = knownTop();
    const q = buildAiBattleDecision(f.session.state!, 'ai', view);
    if (q.kind !== 'DECISION') throw new Error('Expected decision');
    const cards = q.decision.input.state.selfResources.handCards.slice(0, 2);
    const candidates = cards.map((card, index) => ({
      ref: `c${index}`,
      objectId: card.objectId,
      description: card.cardCode,
    }));
    memory.accepted(
      {
        ...q.decision.input,
        space: { kind: 'CARDS', candidates, min: 2, max: 2, ordered: true },
      },
      { kind: 'CARDS', cardRefs: ['c1', 'c0'] },
      'MODEL',
      view
    );
    expect(memory.input(5).lastAction?.selectedCards.map((card) => card.cardCode)).toEqual([
      cards[1]!.cardCode,
      cards[0]!.cardCode,
    ]);
    expect(memory.input(5).lastAction?.actions).toEqual([
      candidates[1]!.description,
      candidates[0]!.description,
    ]);
  });

  it('does not learn or refresh identity from facedown objects or hidden deck order', () => {
    const { view, memory } = knownTop();
    const changed = globalThis.structuredClone(view);
    const hidden = changed.table.zones.FIRST_MAIN_DECK.objectIds!;
    for (const id of hidden)
      Object.assign(changed.objects[id]!, { frontInfo: { cardCode: 'HIDDEN_SENTINEL' } });
    Object.assign(changed.table.zones.FIRST_MAIN_DECK, { objectIds: [...hidden].reverse() });
    memory.observe(changed, { events: [], throughPublicSeq: 1, droppedEventCount: 0 });
    expect(memory.input(5).knownDeckTop?.frontInfo.cardCode).toBe('PL!HS-bp5-019-L');
    expect(JSON.stringify(memory.input(5))).not.toContain('HIDDEN_SENTINEL');
    const empty = new AiDecisionContext('FIRST');
    empty.observe(changed, { events: [], throughPublicSeq: 1, droppedEventCount: 0 });
    expect(empty.input(5).knownDeckTop).toBeUndefined();
  });

  it.each(['SHUFFLE', 'REFRESH', 'EVENT_GAP', 'REWIND'])(
    'invalidates previously known top on %s',
    (kind) => {
      const { view, memory } = knownTop();
      const base = {
        source: 'SYSTEM' as const,
        actorSeat: 'FIRST' as const,
        eventId: 'reset',
        matchId: view.match.matchId,
        seq: 2,
        timestamp: 2,
      };
      const events: PublicEvent[] =
        kind === 'SHUFFLE'
          ? [{ ...base, type: 'PlayerDeclared', declarationType: 'SHUFFLE_MAIN_DECK' }]
          : kind === 'REFRESH'
            ? [
                {
                  ...base,
                  type: 'DeckRefreshed',
                  ownerSeat: 'FIRST',
                  movedCount: 20,
                  mainDeckCountAfter: 20,
                },
              ]
            : [];
      memory.observe(view, {
        events,
        throughPublicSeq: kind === 'REWIND' ? 0 : 2,
        droppedEventCount: kind === 'EVENT_GAP' ? 1 : 0,
      });
      expect(memory.input(5).knownDeckTop).toBeUndefined();
    }
  );

  it('bounds accepted actions and observed results through mechanical work, then clears them at turn changes', () => {
    const { f, view, memory } = knownTop();
    const q = buildAiBattleDecision(f.session.state!, 'ai', view);
    if (q.kind !== 'DECISION') throw new Error('Expected decision');
    for (let i = 0; i < 7; i++)
      memory.accepted(
        {
          ...q.decision.input,
          space: {
            kind: 'ACTION',
            candidates: [{ ref: 'a1', description: `action-${i}` }],
          },
        },
        { kind: 'ACTION', actionRef: 'a1' },
        'MODEL',
        view
      );
    memory.accepted(
      q.decision.input,
      { kind: 'ACTION', actionRef: q.decision.input.space.candidates.at(-1)!.ref },
      'MECHANICAL',
      view
    );
    expect(memory.input(5).recentDecisions.map((x) => x.actions[0])).toEqual([
      'action-3',
      'action-4',
      'action-5',
      'action-6',
    ]);
    expect(memory.input(5).recentDecisions.every((x) => x.resultSummary)).toBe(true);
    expect(memory.input(5).lastAction?.source).toBe('MECHANICAL');
    expect(memory.input(6).recentDecisions).toEqual([]);
    expect(memory.input(6).lastAction).toBeUndefined();
    // A turn counter alone does not imply a draw; the real public movement invalidates the top.
    expect(memory.input(6).knownDeckTop).toBeDefined();
  });

  it('only describes fresh own completed effects and does not invent results without an after-view', () => {
    const { f, view, memory } = knownTop();
    const q = buildAiBattleDecision(f.session.state!, 'ai', view);
    if (q.kind !== 'DECISION') throw new Error('Expected decision');
    const selection = {
      kind: 'ACTION' as const,
      actionRef: q.decision.input.space.candidates[0]!.ref,
    };
    const event = {
      type: 'CardEffectSummary' as const,
      source: 'PLAYER' as const,
      actorSeat: 'FIRST' as const,
      eventId: 'recovery',
      matchId: view.match.matchId,
      seq: 2,
      timestamp: 2,
      abilityId: 'recovery',
      effectKind: 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM' as const,
      summaryStatus: 'COMPLETED' as const,
      recoveredCards: [],
      hiddenRecoveredCardCount: 0,
      noRecoveredCards: true,
    };
    const observation = {
      events: [event],
      throughPublicSeq: 2,
      droppedEventCount: 0,
    };
    memory.accepted(q.decision.input, selection, 'MECHANICAL', view, observation);
    expect(memory.input(5).lastAction?.resultSummary).toContain('回收结算完成：实际回手 0 张');
    for (const ignored of [
      { ...event, actorSeat: 'SECOND' as const },
      { ...event, summaryStatus: 'STARTED' as const },
      { ...event, seq: 1 },
      { ...event, seq: 3 },
    ]) {
      memory.accepted(q.decision.input, selection, 'MECHANICAL', view, {
        ...observation,
        events: [ignored],
      });
      expect(memory.input(5).lastAction?.resultSummary).not.toContain('结算完成');
    }
    memory.accepted(q.decision.input, selection, 'MECHANICAL', view, {
      ...observation,
      droppedEventCount: 1,
    });
    expect(memory.input(5).lastAction?.resultSummary).not.toContain('结算完成');
    memory.accepted(q.decision.input, selection, 'MODEL');
    expect(memory.input(5).lastAction?.resourcesAfter).toBeUndefined();
    expect(memory.input(5).lastAction?.resultSummary).toBeUndefined();
  });
});
