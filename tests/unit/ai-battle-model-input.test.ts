import { describe, expect, it } from 'vitest';
import { compactAiDecisionInput } from '../../src/server/ai-battle/model-input';
import { buildAiBattleDecision } from '../../src/server/ai-battle/decision';
import { createPlanningFixture } from '../helpers/ai-battle-planning-fixture';
import { expandAiDecisionInput } from '../helpers/ai-model-input';
import {
  decision,
  setup,
  replaceHand,
  stage,
  member,
  submit,
  P1,
} from '../helpers/ai-battle-fixture';
import { readFrozenBluePurpleDeck } from '../helpers/ai-curated-decks';
import { placeEnergyFromDeckToZone } from '../../src/application/effects/energy';
import { OrientationState, SlotPosition } from '../../src/shared/types/enums';
import { AiDecisionContext } from '../../src/server/ai-battle/decision-context';
import { createPublicObjectId } from '../../src/online/projector';

function bluePurpleT1() {
  const f = setup();
  const cards = readFrozenBluePurpleDeck().deck.mainDeck;
  const hand = [
    'PL!N-bp4-017-N',
    'PL!N-bp4-013-N',
    'PL!SP-bp2-016-N',
    'PL!N-bp4-004-P+',
    'PL!N-pb1-004-P+',
    'PL!N-bp4-025-L',
    'PL!N-bp4-025-L',
  ].map((code) => cards.find((card) => card.cardCode === code)!);
  const ids = replaceHand(f.session, hand);
  Object.assign(
    f.session.state!,
    placeEnergyFromDeckToZone(f.session.state!, P1, 1, OrientationState.ACTIVE)!.gameState
  );
  return { ...f, ids };
}

describe('AI request normalization preserves complete facts', () => {
  it.each(['111', '149', '151'])(
    'round-trips decision %s including selection refs, all targets and distinct effective values',
    (id) => {
      const f = createPlanningFixture(id);
      const query = buildAiBattleDecision(
        f.session.state!,
        'ai',
        f.session.getPlayerViewState('ai')!
      );
      if (query.kind !== 'DECISION') throw new Error('Expected decision');
      const before = JSON.stringify(query.decision.input);
      const wire = compactAiDecisionInput(query.decision.input);
      expect(expandAiDecisionInput(wire)).toEqual(JSON.parse(before));
      expect(JSON.stringify(query.decision.input)).toBe(before);
      expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(
        Buffer.byteLength(before) * 0.85
      );
      // Repeated copies collapse only when their entire front payload matches. The boosted opponent
      // and printed waiting-room versions of the same member must remain distinguishable.
      const expected = new Set(
        Object.values(query.decision.input.state.objects)
          .filter((o) => o.frontInfo)
          .map((o) => JSON.stringify(o.frontInfo))
      );
      expect(Object.keys(wire.cardFacts as object)).toHaveLength(expected.size);
    }
  );

  it('foregrounds the 704b T1 hand and groups three slot choices as one physical cost-2 card', () => {
    const f = bluePurpleT1();
    const current = decision(f.session);
    const before = globalThis.structuredClone(f.session.state);
    const calls = f.randomCalls();
    const wire = compactAiDecisionInput(current.input);
    expect(Object.keys(wire).slice(0, 3)).toEqual(['decisionBrief', 'purpose', 'space']);
    expect(Object.keys(wire.space as object)).toEqual(['kind', 'memberPlays', 'candidates']);
    expect(wire.decisionBrief).toMatchObject({
      activeEnergyCount: 4,
      handCardCount: 7,
      handMemberPrintedCosts: { 2: 1, 4: 2, 11: 1, 15: 1 },
      handLiveCount: 2,
      stageMembers: [],
      waitingRoomSummary: '己方休息室：成员 0 张；LIVE 0 张',
    });
    expect(wire).toMatchObject({
      space: {
        memberPlays: {
          m1: {
            cardCount: 1,
            mutuallyExclusive: true,
            actionRefs: ['a1', 'a2', 'a3'],
            common: {
              objectId: createPublicObjectId(f.ids[0]!),
              energyCost: 2,
              effectText: current.input.space.candidates[0]!.effectText,
            },
          },
        },
      },
    });
    const expanded = expandAiDecisionInput(wire);
    expect(expanded).toEqual(JSON.parse(JSON.stringify(current.input)));
    expect(expanded.space.candidates).toHaveLength(10);
    expect(
      expanded.space.candidates.filter((c) => c.objectId === createPublicObjectId(f.ids[0]!))
    ).toHaveLength(3);
    expect(f.session.state).toEqual(before);
    expect(f.randomCalls()).toBe(calls);
  });

  it.each([0, 2])(
    'preserves the real T1 command and next window when hand member %i is chosen',
    (index) => {
      const f = bluePurpleT1();
      const current = decision(f.session);
      const expanded = expandAiDecisionInput(compactAiDecisionInput(current.input));
      const choice = expanded.space.candidates.find(
        (c) =>
          c.objectId === createPublicObjectId(f.ids[index]!) && c.targetSlot === SlotPosition.LEFT
      )!;
      submit(f.session, current, { kind: 'ACTION', actionRef: choice.ref });
      const next = decision(f.session);
      const resources = next.input.state.selfResources;
      expect(resources.handCards).toHaveLength(6);
      expect(resources.activeEnergyCount).toBe(index === 0 ? 2 : 0);
      expect(resources.stageMembers[0]?.printedCost).toBe(index === 0 ? 2 : 4);
      expect(next.input.space.candidates.filter((c) => c.targetSlot)).toEqual([]);
      expect(compactAiDecisionInput(next.input)).toHaveProperty(
        'decisionBrief.stageMembers.0.enteredStageThisTurn',
        true
      );
    }
  );

  it('keeps identical printings as separate hand instances and preserves slot-dependent payments', () => {
    const { session } = setup();
    const ids = replaceHand(session, [member('SAME', 2), member('SAME', 2)]);
    stage(session, member('OLD', 2), SlotPosition.LEFT);
    const current = decision(session);
    const wire = compactAiDecisionInput(current.input);
    expect(wire).toHaveProperty('decisionBrief.handMemberPrintedCosts', { 2: 2 });
    for (const [i, id] of ids.entries()) {
      expect(wire).toHaveProperty(
        `space.memberPlays.m${i + 1}.common.objectId`,
        createPublicObjectId(id)
      );
      expect(wire).not.toHaveProperty(`space.memberPlays.m${i + 1}.common.energyCost`);
    }
    expect(expandAiDecisionInput(wire)).toEqual(JSON.parse(JSON.stringify(current.input)));
    expect(
      current.input.space.candidates.filter((c) => c.targetSlot).map((c) => c.energyCost)
    ).toEqual([0, 2, 2, 0, 2, 2]);
  });

  it('deduplicates only the latest historical action, keeping mechanical results distinct', () => {
    const f = bluePurpleT1();
    const current = decision(f.session);
    const memory = new AiDecisionContext('FIRST');
    const view = f.session.getPlayerViewState(P1)!;
    const selection = {
      kind: 'ACTION' as const,
      actionRef: current.input.space.candidates.at(-1)!.ref,
    };
    memory.accepted(current.input, selection, 'MODEL', view);
    const input = { ...current.input, context: memory.input(1) };
    const wire = compactAiDecisionInput(input);
    expect(wire).toHaveProperty('context.lastAction', { recentDecisionIndex: 0 });
    expect(expandAiDecisionInput(wire)).toEqual(JSON.parse(JSON.stringify(input)));
    memory.accepted(current.input, selection, 'MECHANICAL', view);
    const mechanical = { ...current.input, context: memory.input(1) };
    const mechanicalWire = compactAiDecisionInput(mechanical);
    expect(mechanicalWire).toHaveProperty('context.lastAction.source', 'MECHANICAL');
    expect(mechanicalWire).not.toHaveProperty('context.lastAction.recentDecisionIndex');
    expect(expandAiDecisionInput(mechanicalWire)).toEqual(JSON.parse(JSON.stringify(mechanical)));
  });
});
