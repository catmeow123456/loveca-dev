import { describe, expect, it } from 'vitest';
import { AiDecisionContext } from '../../src/server/ai-battle/decision-context';
import type { PublicEvent } from '../../src/online/types';
import { createPlanningFixture } from '../helpers/ai-battle-planning-fixture';
import { buildAiBattleDecision } from '../../src/server/ai-battle/decision';

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
  memory.observe(view, { events: [event], throughPublicSeq: 1, droppedEventCount: 0 });
  expect(memory.input(5).knownDeckTop?.frontInfo.cardCode).toBe('PL!HS-bp5-019-L');
  return { f, view, memory };
}

describe('AI player knowledge boundaries', () => {
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
      undefined,
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

  it('bounds accepted decisions, preserves intent through mechanical work, and clears the plan at turn changes', () => {
    const { f, view, memory } = knownTop();
    const q = buildAiBattleDecision(f.session.state!, 'ai', view);
    if (q.kind !== 'DECISION') throw new Error('Expected decision');
    for (let i = 0; i < 7; i++)
      memory.accepted(
        q.decision.input,
        { kind: 'ACTION', actionRef: q.decision.input.space.candidates[0]!.ref },
        'MODEL',
        `plan-${i}`,
        view
      );
    memory.accepted(
      q.decision.input,
      { kind: 'ACTION', actionRef: q.decision.input.space.candidates.at(-1)!.ref },
      'MECHANICAL',
      undefined,
      view
    );
    expect(memory.input(5).recentDecisions.map((x) => x.modelIntent)).toEqual([
      'plan-3',
      'plan-4',
      'plan-5',
      'plan-6',
    ]);
    expect(memory.input(5).lastAction?.source).toBe('MECHANICAL');
    expect(memory.input(6).recentDecisions).toEqual([]);
    expect(memory.input(6).lastAction).toBeUndefined();
    // A turn counter alone does not imply a draw; the real public movement invalidates the top.
    expect(memory.input(6).knownDeckTop).toBeDefined();
  });
});
