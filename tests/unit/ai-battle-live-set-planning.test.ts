import { describe, expect, it } from 'vitest';
import { compactAiDecisionInput } from '../../src/server/ai-battle/model-input';
import { summarizeAiLiveSetPlanning } from '../../src/server/ai-battle/live-set-planning';
import { createLiveSetFixture } from '../helpers/ai-battle-live-set-fixture';
import { decision, submit, P1 } from '../helpers/ai-battle-fixture';
import { expandAiDecisionInput } from '../helpers/ai-model-input';
import { addLiveSetLimitReduction } from '../../src/domain/entities/game';
import { GameCommandType } from '../../src/application/game-commands';

describe('LIVE setting facts and printed-cheer baseline', () => {
  it('exposes the D11 shortfall and distinct duplicate cards without filtering legal choices', () => {
    const f = createLiveSetFixture();
    const current = decision(f.session);
    const before = globalThis.structuredClone(f.session.state);
    const calls = f.randomCalls();
    const wire = compactAiDecisionInput(current.input, f.ownDeck);
    const summary = summarizeAiLiveSetPlanning(current.input, f.ownDeck)!;
    expect(summary).toMatchObject({
      setCount: 0,
      setLimit: 3,
      remainingSetCount: 3,
      drawCountOnConfirm: 0,
      stageHeartTotal: 2,
      activeMemberBladeTotal: 1,
      printedCheerBaseline: {
        maxHeartsPerCheerCard: 1,
        totalHeartCeiling: 3,
        finalFeasibility: 'UNDETERMINED',
      },
    });
    expect(summary.liveCards[0]).toMatchObject({
      location: 'HAND',
      shortfallEvenAtPrintedCeiling: 5,
      requiredHearts: { totalRequired: 8 },
    });
    expect(
      summary.handMembers.find((group) => group.printedCost === 11 && group.count === 2)?.objectIds
    ).toHaveLength(2);
    expect(expandAiDecisionInput(wire)).toEqual(JSON.parse(JSON.stringify(current.input)));
    expect(f.session.state).toEqual(before);
    expect(f.randomCalls()).toBe(calls);
  });

  it('tracks cover, withdrawal, reduced allowance and actual equal replacement draws at zero energy', () => {
    const f = createLiveSetFixture();
    Object.assign(
      f.session.state!,
      addLiveSetLimitReduction(f.session.state!, {
        playerId: P1,
        sourceCardId: 'public-source',
        abilityId: 'test-live-set-limit',
        amount: 1,
        expiresAt: 'NEXT_LIVE_SET_PHASE',
      })
    );
    const initialCount = f.session.state!.players[0].hand.cardIds.length;
    const coverHigh = () => {
      const current = decision(f.session);
      const choice = current.input.space.candidates.find((candidate) => {
        const card = current.input.state.selfResources.handCards.find(
          (item) => item.objectId === candidate.objectId
        );
        return card?.printedCost === 11;
      })!;
      submit(f.session, current, { kind: 'ACTION', actionRef: choice.ref });
    };
    coverHigh();
    const one = decision(f.session);
    expect(one.input.liveSet).toMatchObject({
      setCount: 1,
      setLimit: 2,
      remainingSetCount: 1,
      drawCountOnConfirm: 1,
    });
    const unset = one.input.space.candidates.find(
      (candidate) =>
        one.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000).type ===
        GameCommandType.UNSET_LIVE_CARD
    )!;
    submit(f.session, one, { kind: 'ACTION', actionRef: unset.ref });
    expect(decision(f.session).input.liveSet?.setCount).toBe(0);
    coverHigh();
    coverHigh();
    const full = decision(f.session);
    expect(full.input.liveSet).toMatchObject({
      setCount: 2,
      remainingSetCount: 0,
      drawCountOnConfirm: 2,
    });
    expect(full.input.state.selfResources.activeEnergyCount).toBe(0);
    const deckBefore = f.session.state!.players[0].mainDeck.cardIds.length;
    submit(f.session, full, { kind: 'ACTION', actionRef: full.input.space.candidates.at(-1)!.ref });
    expect(f.session.state!.players[0].hand.cardIds).toHaveLength(initialCount);
    expect(f.session.state!.players[0].mainDeck.cardIds).toHaveLength(deckBefore - 2);
  });

  it('separates total-heart opportunity from guaranteed colors or effects', () => {
    const f = createLiveSetFixture('CHEER_POSSIBLE');
    const current = decision(f.session);
    const summary = summarizeAiLiveSetPlanning(current.input, f.ownDeck)!;
    expect(summary.printedCheerBaseline.totalHeartCeiling).toBe(6);
    expect(summary.liveCards[0]?.shortfallEvenAtPrintedCeiling).toBe(0);
    expect(summary.liveCards[0]?.stageAloneMeetsBaseRequirement).toBe(false);
    expect(summary.printedCheerBaseline.finalFeasibility).toBe('UNDETERMINED');
    expect(current.input.space.candidates).toHaveLength(2);
  });

  it('distinguishes next-turn energy from remaining energy and shows why 11 cannot substitute for 10', () => {
    const f = createLiveSetFixture('T2');
    const current = decision(f.session);
    const summary = summarizeAiLiveSetPlanning(current.input, f.ownDeck)!;
    expect(current.input.state.selfResources.activeEnergyCount).toBe(3);
    expect(summary.nextOwnMainBaseline).toMatchObject({
      energyCount: 5,
      nextRegularEnergyCount: 6,
      followingRegularEnergyCount: 7,
      emptyStageSlots: ['RIGHT'],
    });
    const emma = summary.handMembers.find(
      (group) => group.printedCost === 11 && group.count === 2
    )!;
    expect(emma.coverActionRefs).toHaveLength(2);
    expect(emma.printedPayments.replaceStageMember).toEqual([
      { slot: 'LEFT', fromPrintedCost: 4, payment: 7 },
      { slot: 'CENTER', fromPrintedCost: 2, payment: 9 },
    ]);
    expect(
      summary.handMembers.find((group) => group.printedCost === 15)?.printedPayments
        .replaceStageMember[0]?.payment
    ).toBe(11);
  });

  it('keeps the second upcoming turn visible for a unique 4-to-10 bridge and never invents energy from an empty deck', () => {
    const f = createLiveSetFixture('KEEP_BRIDGES');
    const input = decision(f.session).input;
    const summary = summarizeAiLiveSetPlanning(input, f.ownDeck)!;
    expect(summary.nextOwnMainBaseline).toMatchObject({
      nextRegularEnergyCount: 5,
      followingRegularEnergyCount: 6,
    });
    expect(
      summary.handMembers.find((group) => group.printedCost === 10)?.printedPayments
        .replaceStageMember[0]?.payment
    ).toBe(6);
    const empty = globalThis.structuredClone(input);
    Object.assign(
      Object.values(empty.state.table.zones).find(
        (zone) => zone.zone === 'ENERGY_DECK' && zone.ownerSeat === empty.state.selfSeat
      )!,
      { count: 0 }
    );
    expect(summarizeAiLiveSetPlanning(empty, f.ownDeck)?.nextOwnMainBaseline).toMatchObject({
      nextRegularEnergyCount: 4,
      followingRegularEnergyCount: 4,
    });
  });

  it('counts multiple printed HEART effects, excluding DRAW, SCORE and energy cards', () => {
    const f = createLiveSetFixture();
    const ownDeck = {
      ...f.ownDeck,
      content: JSON.stringify({
        cards: [
          {
            count: 60,
            card: {
              cardType: 'MEMBER',
              bladeHearts: [
                { effect: 'HEART' },
                { effect: 'HEART' },
                { effect: 'DRAW' },
                { effect: 'SCORE' },
              ],
            },
          },
          {
            count: 12,
            card: {
              cardType: 'ENERGY',
              bladeHearts: Array.from({ length: 8 }, () => ({ effect: 'HEART' })),
            },
          },
        ],
      }),
    };
    const summary = summarizeAiLiveSetPlanning(decision(f.session).input, ownDeck)!;
    expect(summary.printedCheerBaseline).toMatchObject({
      maxHeartsPerCheerCard: 2,
      totalHeartCeiling: 4,
    });
    expect(
      summarizeAiLiveSetPlanning(decision(f.session).input)!.printedCheerBaseline.totalHeartCeiling
    ).toBeNull();
    expect(() =>
      summarizeAiLiveSetPlanning(decision(f.session).input, { ...ownDeck, content: '{}' })
    ).toThrow();
  });
});
