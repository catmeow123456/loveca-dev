import { describe, expect, it } from 'vitest';
import { HeartColor as C } from '../../src/shared/types/enums';
import { createProbabilityFixture as fixture } from '../helpers/ai-live-probability-fixture';
import { compactAiDecisionInput } from '../../src/server/ai-battle/model-input';
import {
  estimateAiLiveSet,
  summarizeAiLiveProbabilities,
} from '../../src/server/ai-battle/live-probability-summary';

describe('projected LIVE probability assistance', () => {
  it('subtracts every known own-zone card and leaves command candidates unchanged', () => {
    const { input, ownDeck } = fixture();
    const before = globalThis.structuredClone(input);
    const summary = summarizeAiLiveProbabilities(input, ownDeck);
    expect(summary).toMatchObject({
      status: 'REFERENCE',
      remainingDeckCount: 6,
      totalCombinations: 3,
      omittedCombinations: 0,
    });
    if (summary.status !== 'REFERENCE') throw new Error(summary.reason);
    expect(summary.rows.find((r) => r.liveRefs.join() === 'c1')).toMatchObject({
      successProbabilityRange: [0.8, 0.8],
    });
    expect(input).toEqual(before);
    expect(compactAiDecisionInput(input, ownDeck)).toHaveProperty(
      'decisionBrief.liveSet.probabilityReference',
      summary
    );
  });
  it('does not inspect opponent fronts or hidden deck IDs, even if supplied by a caller', () => {
    const { input, ownDeck } = fixture();
    const expected = summarizeAiLiveProbabilities(input, ownDeck);
    Object.defineProperty(input.state.table.zones.FIRST_MAIN_DECK, 'objectIds', {
      get() {
        throw new Error('hidden deck access');
      },
    });
    Object.assign(input.state.table.zones, {
      SECOND_HAND: {
        zone: 'HAND',
        ownerSeat: 'SECOND',
        count: 999,
        get objectIds() {
          throw new Error('opponent access');
        },
      },
    });
    Object.defineProperty(input.state.objects, 'secret-opponent', {
      get() {
        throw new Error('opponent front access');
      },
    });
    expect(summarizeAiLiveProbabilities(input, ownDeck)).toEqual(expected);
  });
  it('uses the existing seat-scoped known-top fact and accounts for replacement draws', () => {
    const { input, ownDeck, pink } = fixture();
    Object.assign(input, {
      context: { recentDecisions: [], knownDeckTop: { frontInfo: pink, learnedAtPublicSeq: 12 } },
    });
    expect(estimateAiLiveSet(input, ownDeck, ['c1'])).toMatchObject({
      status: 'READY',
      successProbability: 0.7,
    });
    expect(summarizeAiLiveProbabilities(input, ownDeck)).toMatchObject({ knownTopCount: 1 });
  });
  it('produces ranges over member fillers when cheer crosses refresh', () => {
    const { input, ownDeck } = fixture();
    Object.assign(input.state.selfResources, { activeMemberBladeTotal: 6 });
    const summary = summarizeAiLiveProbabilities(input, ownDeck);
    expect(summary.status).toBe('REFERENCE');
    if (summary.status !== 'REFERENCE') throw new Error(summary.reason);
    const row = summary.rows.find((r) => r.liveRefs.join() === 'c1,c2');
    expect(row).toMatchObject({ status: 'READY', refreshPossible: true });
    if (!row || row.status !== 'READY') throw new Error('missing row');
    expect(row.successProbabilityRange[0]).toBeLessThan(row.successProbabilityRange[1]!);
  });
  it('keeps numeric what-if assumptions explicit and refuses invalid selections', () => {
    const { input, ownDeck } = fixture();
    expect(
      estimateAiLiveSet(input, ownDeck, ['c1'], { additionalHearts: { PINK: 1 } })
    ).toMatchObject({
      status: 'READY',
      successProbability: 1,
      assumptions: { additionalHearts: { PINK: 1 } },
    });
    for (const refs of [['c1', 'c1'], ['bogus'], ['c1', 'c2', 'c3', 'c4']])
      expect(estimateAiLiveSet(input, ownDeck, refs)).toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('honors the current selection bounds and groups when enumerating filler ranges', () => {
    const { input, ownDeck } = fixture();
    Object.assign(input.space, { min: 2, groups: [{ cardRefs: ['c3'], min: 1, max: 1 }] });
    expect(estimateAiLiveSet(input, ownDeck, ['c1'])).toMatchObject({ status: 'UNAVAILABLE' });
    expect(estimateAiLiveSet(input, ownDeck, ['c1', 'c4'])).toMatchObject({
      status: 'UNAVAILABLE',
    });
    expect(estimateAiLiveSet(input, ownDeck, ['c1', 'c3'])).toMatchObject({ status: 'READY' });
    expect(summarizeAiLiveProbabilities(input, ownDeck)).toMatchObject({ status: 'REFERENCE' });
  });
  it.each(['missingFront', 'countMismatch', 'belowCard', 'inspection'] as const)(
    'does not invent a probability for incomplete accounting: %s',
    (kind) => {
      const { input, ownDeck } = fixture();
      if (kind === 'missingFront')
        delete (input.state.objects.mp as { frontInfo?: unknown }).frontInfo;
      if (kind === 'countMismatch')
        Object.assign(input.state.table.zones.FIRST_MAIN_DECK!, { count: 7 });
      if (kind === 'belowCard')
        Object.assign(input.state.table.zones.FIRST_MEMBER_LEFT!, {
          memberBelow: { LEFT: ['unseen'] },
        });
      if (kind === 'inspection')
        Object.assign(input.state.table.zones, {
          FIRST_INSPECTION_ZONE: {
            zone: 'INSPECTION_ZONE',
            ownerSeat: 'FIRST',
            count: 1,
            ordered: true,
          },
        });
      const before = input.space;
      expect(summarizeAiLiveProbabilities(input, ownDeck)).toMatchObject({ status: 'UNAVAILABLE' });
      expect(input.space).toBe(before);
    }
  );
  it('applies currently projected numeric modifiers once, without reading card text', () => {
    const { input, ownDeck } = fixture();
    Object.assign(input.state, {
      liveResult: {
        heartBonuses: { FIRST: [{ color: C.PINK, count: 1 }], SECOND: [] },
        cheerHeartColorReplacements: { FIRST: null, SECOND: null },
        requirementModifiers: { l1: [{ color: C.PINK, countDelta: -1 }] },
        requirementReductions: { l1: 1 },
      },
    });
    expect(estimateAiLiveSet(input, ownDeck, ['c2'])).toMatchObject({
      status: 'READY',
      successProbability: 1,
      totalRequired: 2,
    });
  });
});
