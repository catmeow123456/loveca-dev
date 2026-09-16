import { describe, expect, it } from 'vitest';
import { compactAiDecisionInput } from '../../src/server/ai-battle/model-input';
import { summarizeAiLiveSetPlanning } from '../../src/server/ai-battle/live-set-planning';
import { createLiveSetFixture } from '../helpers/ai-battle-live-set-fixture';
import { decision, submit, P1 } from '../helpers/ai-battle-fixture';
import { expandAiDecisionInput } from '../helpers/ai-model-input';
import { addLiveSetLimitReduction } from '../../src/domain/entities/game';
import { CardType } from '../../src/shared/types/enums';
import { GameCommandType } from '../../src/application/game-commands';
import { createSetLiveCardCommand } from '../../src/application/game-commands';
import { materializeAiDecisionCommands } from '../../src/server/ai-battle/decision';

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
      drawCountRule: 'FINAL_SET_COUNT',
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
    expect(summary.jointJudgment).toMatchObject({
      semantics: 'MERGED_ALL_OR_NOTHING',
      guaranteedFailureLiveRefs: [summary.liveCards[0]!.cardRef],
    });
    expect(summary.jointJudgment.rule).toContain('整轮全部失败得 0 分');
    expect(
      summary.handMembers.find((group) => group.printedCost === 11 && group.count === 2)?.objectIds
    ).toHaveLength(2);
    expect(
      current.input.space.candidates.find((candidate) => candidate.liveBaseBudget)?.description
    ).toContain('盖下的 LIVE 并入本轮合并判定');
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
    const player = f.session.state!.players[0];
    const firstHighId = player.hand.cardIds.find(
      (cardId) => f.session.state!.cardRegistry.get(cardId)?.data.cost === 11
    )!;
    expect(f.session.executeCommand(createSetLiveCardCommand(P1, firstHighId, true)).success).toBe(
      true
    );
    const one = decision(f.session);
    expect(one.input.liveSet).toMatchObject({
      selectionMode: 'FINAL_SET_AND_CONFIRM',
      setCount: 1,
      setLimit: 2,
      drawCountRule: 'FINAL_SET_COUNT',
    });
    const initialSetObjectIds = new Set(one.input.liveSet!.setCardObjectIds);
    // The initially set card is the cost-11 member; member keeps must not carry the LIVE
    // merged-judgment tag because they never participate in the LIVE judgment.
    expect(
      one.input.space.candidates.find(
        (candidate) => candidate.objectId === one.input.liveSet!.setCardObjectIds[0]
      )?.description
    ).not.toContain('保留的 LIVE 仍并入本轮合并判定');
    const replacements = one.input.space.candidates
      .filter((candidate) => candidate.objectId && !initialSetObjectIds.has(candidate.objectId))
      .slice(0, 2)
      .map((candidate) => candidate.ref);
    const selection = { kind: 'CARDS' as const, cardRefs: replacements };
    expect(
      materializeAiDecisionCommands(one, selection, 1000).map((command) => command.type)
    ).toEqual([
      GameCommandType.UNSET_LIVE_CARD,
      GameCommandType.SET_LIVE_CARD,
      GameCommandType.SET_LIVE_CARD,
      GameCommandType.CONFIRM_STEP,
    ]);
    const deckBefore = f.session.state!.players[0].mainDeck.cardIds.length;
    submit(f.session, one, selection);
    expect(f.session.state!.players[0].hand.cardIds).toHaveLength(initialCount);
    expect(f.session.state!.players[0].mainDeck.cardIds).toHaveLength(deckBefore - 2);
  });

  it('tags a kept set LIVE with the merged all-or-nothing judgment', () => {
    const f = createLiveSetFixture();
    const player = f.session.state!.players[0];
    const liveId = player.hand.cardIds.find(
      (cardId) => f.session.state!.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    )!;
    expect(f.session.executeCommand(createSetLiveCardCommand(P1, liveId, true)).success).toBe(true);
    const current = decision(f.session);
    const kept = current.input.space.candidates.find(
      (candidate) => candidate.objectId === current.input.liveSet!.setCardObjectIds[0]
    )!;
    expect(kept.description).toContain('保留本次已盖牌');
    expect(kept.description).toContain('保留的 LIVE 仍并入本轮合并判定');
  });

  it('separates total-heart opportunity from guaranteed colors or effects', () => {
    const f = createLiveSetFixture('CHEER_POSSIBLE');
    const current = decision(f.session);
    const summary = summarizeAiLiveSetPlanning(current.input, f.ownDeck)!;
    expect(summary.printedCheerBaseline.totalHeartCeiling).toBe(6);
    expect(summary.liveCards[0]?.shortfallEvenAtPrintedCeiling).toBe(0);
    expect(summary.jointJudgment.guaranteedFailureLiveRefs).toEqual([]);
    expect(summary.liveCards[0]?.stageAloneMeetsBaseRequirement).toBe(false);
    expect(summary.printedCheerBaseline.finalFeasibility).toBe('UNDETERMINED');
    expect(current.input.space.candidates).toHaveLength(1);
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
    expect(emma.coverCardRefs).toHaveLength(2);
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
    expect(
      summarizeAiLiveSetPlanning(decision(f.session).input)!.jointJudgment
        .guaranteedFailureLiveRefs
    ).toBeNull();
    expect(() =>
      summarizeAiLiveSetPlanning(decision(f.session).input, { ...ownDeck, content: '{}' })
    ).toThrow();
  });
});
