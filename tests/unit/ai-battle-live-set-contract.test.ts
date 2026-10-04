import { describe, expect, it, vi } from 'vitest';
import { decision, setup } from '../helpers/ai-battle-fixture';
import { codexResponseSchema } from '../../src/server/ai-battle/codex-response-schema';
import {
  parseAiBattleResponse,
  responseSchema,
  type AiCandidate,
  type AiDecision,
} from '../../src/server/ai-battle/protocol';
import { createAiLiveSetPlan } from '../../src/server/ai-battle/live-set-budget';
import { getAiFallbackSelection } from '../../src/server/ai-battle/policy';
import { AiBattleRuntime } from '../../src/server/ai-battle/runtime';
import { compactAiDecisionInput } from '../../src/server/ai-battle/model-input';
import { HeartColor } from '../../src/shared/types/enums';

function window(stageHearts = 4): AiDecision {
  const original = decision(setup(false).session);
  const live = (ref: string, totalRequired: number, score: number): AiCandidate => ({
    ref,
    description: ref,
    liveBaseBudget: {
      basis: 'CURRENT_STAGE_MEMBERS_VS_BASE_REQUIREMENT',
      score,
      requiredHearts: {
        colorRequirements: { [HeartColor.BLUE]: 1, [HeartColor.RAINBOW]: totalRequired - 1 },
        totalRequired,
      },
      stageHeartCounts: { [HeartColor.BLUE]: stageHearts },
      missingHearts: { [HeartColor.RAINBOW]: Math.max(0, totalRequired - stageHearts) },
      stageAloneMeetsBaseRequirement: totalRequired <= stageHearts,
    },
  });
  const space = {
    kind: 'CARDS' as const,
    min: 0,
    max: 3,
    ordered: false,
    candidates: [
      live('daydream', 8, 3),
      live('vivid', 14, 6),
      live('rise', 3, 1),
      { ref: 'member1', description: '周转成员1' },
      { ref: 'member2', description: '周转成员2' },
    ],
  };
  return {
    ...original,
    input: {
      ...original.input,
      purpose: 'LIVE_SET',
      space,
      responseSchema: responseSchema(space, 'LIVE_SET'),
      state: {
        ...original.input.state,
        selfResources: {
          ...original.input.state.selfResources,
          stageHeartCounts: { [HeartColor.BLUE]: stageHearts },
          stageHeartTotal: stageHearts,
        },
      },
    },
  };
}
const cards = (...cardRefs: string[]) => ({ kind: 'CARDS' as const, cardRefs });

describe('LIVE set response accounting and failure repair', () => {
  it('rejects declared single-song plans that actually select two songs, and rejects incorrect joint arithmetic', () => {
    const current = window();
    const selection = cards('daydream', 'vivid', 'member1');
    const liveSetPlan = createAiLiveSetPlan(current.input, selection);
    expect(liveSetPlan.baseRequiredHeartTotal).toBe(22);
    expect(() =>
      parseAiBattleResponse(
        current,
        JSON.stringify({
          selection,
          liveSetPlan: {
            ...liveSetPlan,
            liveCardRefs: ['daydream'],
            memberCardRefs: ['vivid', 'member1'],
          },
        })
      )
    ).toThrow('LIVE set plan does not match');
    expect(() =>
      parseAiBattleResponse(
        current,
        JSON.stringify({ selection, liveSetPlan: { ...liveSetPlan, baseRequiredHeartTotal: 8 } })
      )
    ).toThrow('LIVE set plan does not match');
    const runtime = new AiBattleRuntime('FIRST', vi.fn());
    runtime.observe(1, 'current', { kind: 'DECISION', decision: current });
    runtime.resolve({
      kind: 'RESPONSE',
      text: JSON.stringify({
        selection,
        liveSetPlan: { ...liveSetPlan, baseRequiredHeartTotal: 8 },
      }),
    });
    expect(runtime.current?.prepared).toMatchObject({
      source: 'FALLBACK',
      selection: cards('daydream', 'member1'),
    });
    expect(runtime.consecutiveFailures).toBe(1);
  });

  it('keeps legal deliberate cycling and multi-song risk, requiring accounting rather than rejecting base shortfalls', () => {
    const current = window();
    for (const selection of [cards('vivid', 'member1'), cards('daydream', 'vivid'), cards()]) {
      expect(
        parseAiBattleResponse(
          current,
          JSON.stringify({
            selection,
            liveSetPlan: createAiLiveSetPlan(current.input, selection),
            tradeoff: '明确承担风险或放弃表演周转',
          })
        ).selection
      ).toEqual(selection);
    }
    expect(() =>
      parseAiBattleResponse(current, JSON.stringify({ selection: cards('member1') }))
    ).toThrow('LIVE set plan');
    expect(() =>
      parseAiBattleResponse(
        current,
        JSON.stringify({ selection: cards('member1'), liveSetPlan: null })
      )
    ).toThrow('LIVE set plan');
  });

  it('repairs the recorded excessive selection by keeping the low-demand song and two members', () => {
    const current = window();
    const attempted = cards('daydream', 'rise', 'member1', 'member2');
    expect(getAiFallbackSelection(current, attempted)).toEqual(cards('rise', 'member1', 'member2'));
    expect(
      getAiFallbackSelection(current, cards('vivid', 'daydream', 'member1', 'member2'))
    ).toEqual(cards('daydream', 'member1', 'member2'));
    expect(getAiFallbackSelection(current, cards('unknown', 'rise', 'rise', 'member1'))).toEqual(
      cards('rise', 'member1')
    );
  });

  it('does not combine individually stage-satisfied songs when their shared heart pool is insufficient', () => {
    expect(
      getAiFallbackSelection(window(8), cards('daydream', 'rise', 'member1', 'member2'))
    ).toEqual(cards('daydream', 'member1', 'member2'));
    expect(
      getAiFallbackSelection(window(11), cards('daydream', 'rise', 'member1', 'member2'))
    ).toEqual(cards('daydream', 'rise', 'member1'));
  });

  it('changes the provider schema with the actual allowance and forbids another query after continuation', () => {
    const current = window();
    const schema = codexResponseSchema(current.input) as any;
    const cardRefsSchema = schema.properties.selection.anyOf[0].properties.cardRefs;
    expect(cardRefsSchema).toMatchObject({ maxItems: 3 });
    expect(cardRefsSchema).not.toHaveProperty('uniqueItems');
    const reduced = {
      ...current.input,
      space: { ...current.input.space, kind: 'CARDS' as const, min: 0, max: 1, ordered: false },
    };
    expect(
      (codexResponseSchema(reduced) as any).properties.selection.anyOf[0].properties.cardRefs
        .maxItems
    ).toBe(1);
    const final = codexResponseSchema(current.input, false) as any;
    expect(final.properties.selection.anyOf).toBeUndefined();
    expect(final.properties.liveSetPlan.required).toContain('baseRequiredHeartTotal');
    const noCards = { ...reduced, space: { ...reduced.space, candidates: [], max: 0 } };
    expect(
      (codexResponseSchema(noCards, false) as any).properties.selection.properties.cardRefs.maxItems
    ).toBe(0);
  });

  it('exposes public end pressure without inventing opponent progress or cards', () => {
    const current = window();
    const before = structuredClone(current.input);
    const wire = compactAiDecisionInput(current.input) as any;
    expect(wire.decisionBrief.competition.ownSuccessfulLiveCount).toBe(0);
    expect(wire.decisionBrief.competition.opponentSuccessfulLiveCount).toBe(0);
    const zones = Object.values(current.input.state.table.zones);
    const success = zones.find(
      (zone) => zone.zone === 'SUCCESS_ZONE' && zone.ownerSeat !== current.input.state.selfSeat
    )!;
    const pressured = structuredClone(current.input);
    Object.assign(
      Object.values(pressured.state.table.zones).find(
        (zone) => zone.zone === success.zone && zone.ownerSeat === success.ownerSeat
      )!,
      { count: 2 }
    );
    expect(
      (compactAiDecisionInput(pressured) as any).decisionBrief.competition
        .opponentCanFinishWithNextSuccess
    ).toBe(true);
    expect(current.input).toEqual(before);
  });
});
