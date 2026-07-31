import { describe, expect, it } from 'vitest';
import type { AiObservation, AiObservedDecision } from '../../src/server/ai-battle/ai-observation';
import { createAiModelInvocationRuntime } from '../../src/server/ai-battle/model-governance';
import { createAlibabaDashScopeModelProvider } from '../../src/server/ai-battle/model-provider';
import {
  buildAiModelRequestEnvelope,
  parseAiModelDecisionOutput,
  validateAiModelDecisionGrounding,
  type AiModelRepairFailureCode,
} from '../../src/server/ai-battle/model-protocol';
import { AI_BATTLE_PHASE_ZERO_DECKS } from '../../src/server/ai-battle/phase-zero-baseline';
import {
  buildAiStrategyContext,
  type AiStrategyContext,
} from '../../src/server/ai-battle/strategy-context';

const realModelEnabled =
  process.env.AI_BATTLE_REAL_MODEL === '1' && Boolean(process.env.DASHSCOPE_API_KEY?.trim());

const BASE_DECISION = {
  decisionRef: 'current-decision',
  mandatory: true,
  candidates: [],
  options: [],
  actions: [],
} as const;

const SCENARIOS: readonly {
  readonly scenarioId: string;
  readonly decision: AiObservedDecision;
  readonly validate: (selection: unknown) => boolean;
}[] = [
  {
    scenarioId: 'mulligan-curve-and-live',
    decision: {
      ...BASE_DECISION,
      kind: 'MULLIGAN',
      candidates: [
        {
          candidateId: 'early-member',
          hidden: false,
          card: { cardCode: 'EARLY', name: 'Early', cardType: 'MEMBER', cost: 2 },
        },
        {
          candidateId: 'late-member',
          hidden: false,
          card: { cardCode: 'LATE', name: 'Late', cardType: 'MEMBER', cost: 15 },
        },
        {
          candidateId: 'easy-live',
          hidden: false,
          card: {
            cardCode: 'EASY-LIVE',
            name: 'Easy LIVE',
            cardType: 'LIVE',
            score: 2,
            requiredHearts: { colorRequirements: {}, totalRequired: 3 },
          },
        },
      ],
      input: { kind: 'CARD_SELECTION', minSelections: 0, maxSelections: 3 },
    },
    validate: (selection) =>
      isRecord(selection) &&
      selection.kind === 'MULLIGAN' &&
      Array.isArray(selection.candidateIds) &&
      selection.candidateIds.every((id) =>
        ['early-member', 'late-member', 'easy-live'].includes(String(id))
      ),
  },
  {
    scenarioId: 'main-phase-play-or-end',
    decision: {
      ...BASE_DECISION,
      kind: 'MAIN_PHASE',
      candidates: [
        {
          candidateId: 'playable-member',
          hidden: false,
          card: {
            cardCode: 'PL!HS-bp6-003-R',
            name: '日野下 花帆',
            cardType: 'MEMBER',
            cost: 4,
          },
        },
      ],
      actions: [
        {
          actionId: 'play-center',
          kind: 'PLAY_MEMBER',
          sourceCandidateId: 'playable-member',
          targetSlot: 'CENTER',
          paymentPreview: { modifiedCost: 4, energyCost: 4, relayDiscount: 0 },
        },
        { actionId: 'end-main', kind: 'END_MAIN_PHASE' },
      ],
    },
    validate: (selection) =>
      isRecord(selection) &&
      selection.kind === 'SELECT_MAIN_PHASE_ACTION' &&
      ['play-center', 'end-main'].includes(String(selection.actionId)),
  },
  {
    scenarioId: 'live-set-choice',
    decision: {
      ...BASE_DECISION,
      kind: 'LIVE_SET',
      candidates: [
        {
          candidateId: 'achievable-live',
          hidden: false,
          card: {
            cardCode: 'PL!HS-bp6-031-L',
            name: '水彩世界',
            cardType: 'LIVE',
            score: 3,
            requiredHearts: { colorRequirements: { GREEN: 4 }, totalRequired: 4 },
          },
        },
      ],
      actions: [
        {
          actionId: 'set-live',
          kind: 'SET_LIVE',
          candidateId: 'achievable-live',
          isLiveCard: true,
        },
        { actionId: 'confirm-live-set', kind: 'CONFIRM_LIVE_SET' },
      ],
      setCount: 0,
      setLimit: 1,
    },
    validate: (selection) =>
      isRecord(selection) &&
      selection.kind === 'SELECT_LIVE_SET_ACTION' &&
      ['set-live', 'confirm-live-set'].includes(String(selection.actionId)),
  },
  {
    scenarioId: 'mandatory-effect-option',
    decision: {
      ...BASE_DECISION,
      kind: 'ACTIVE_EFFECT',
      abilityId: 'choose-heart',
      stepId: 'SELECT_COLOR',
      options: [
        { optionId: 'green', label: 'GREEN' },
        { optionId: 'pink', label: 'PINK' },
      ],
      input: {
        kind: 'OPTION_SELECTION',
        minSelections: 1,
        maxSelections: 1,
        canSkip: false,
      },
    },
    validate: (selection) =>
      isRecord(selection) &&
      selection.kind === 'SELECT_EFFECT_OPTIONS' &&
      Array.isArray(selection.optionIds) &&
      selection.optionIds.length === 1 &&
      ['green', 'pink'].includes(String(selection.optionIds[0])),
  },
];

describe.runIf(realModelEnabled)('AI battle Phase 4 real model prompt/playbook evaluation', () => {
  it('returns a legal structured selection for every fixed evaluation scenario', async () => {
    const provider = createAlibabaDashScopeModelProvider({
      apiKey: process.env.DASHSCOPE_API_KEY!,
    });
    const runtime = createAiModelInvocationRuntime({ provider });
    const latencies: number[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const scenario of SCENARIOS) {
      const context = buildContext(scenario.decision);
      let repairFailureCode: AiModelRepairFailureCode | undefined;
      let accepted = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const envelope = buildAiModelRequestEnvelope({
          strategyContext: context,
          repairFailureCode,
        });
        const invoked = await runtime.invoke({
          matchId: `real-eval:${scenario.scenarioId}`,
          accountKey: 'real-eval',
          envelope,
        });
        expect(invoked.ok, scenario.scenarioId).toBe(true);
        if (!invoked.ok) break;
        latencies.push(invoked.audit.latencyMs);
        totalInputTokens += invoked.audit.usage.inputTokens;
        totalOutputTokens += invoked.audit.usage.outputTokens;
        const parsed = parseAiModelDecisionOutput(invoked.rawOutput);
        if (!parsed.ok) {
          repairFailureCode = parsed.reason;
          continue;
        }
        if (!scenario.validate(parsed.output.selection)) {
          repairFailureCode = 'INVALID_SELECTION';
          continue;
        }
        const grounding = validateAiModelDecisionGrounding(
          parsed.output,
          envelope.strategyContext.semanticContext
        );
        if (!grounding.ok) {
          repairFailureCode = grounding.reason;
          continue;
        }
        accepted = true;
        break;
      }
      expect(accepted, scenario.scenarioId).toBe(true);
    }

    expect(latencies).toHaveLength(SCENARIOS.length);
    expect(Math.max(...latencies)).toBeLessThanOrEqual(12_000);
    expect(totalInputTokens).toBeGreaterThan(0);
    expect(totalOutputTokens).toBeGreaterThan(0);
  }, 90_000);
});

function buildContext(decision: AiObservedDecision): AiStrategyContext {
  const emptySeat = {
    successLiveCount: 0,
    successLiveScore: 0,
    zones: [],
  } as const;
  const observation: AiObservation = {
    schemaVersion: 'ai-battle.observation/v1',
    decisionContractSchemaVersion: 'ai-battle.decision-contract/v1',
    commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
    authorityRevision: 3,
    viewerSeat: 'FIRST',
    turn: {
      count: 1,
      phase: 'MAIN_PHASE',
      subPhase: 'FREE_ACTION',
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
    },
    window: null,
    liveResult: null,
    endInfo: null,
    seats: { FIRST: emptySeat, SECOND: emptySeat },
    sharedZones: [],
    decision,
  };
  return buildAiStrategyContext({
    observation,
    deckKey: 'GREEN_HASUNOSORA_B6',
    deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS.GREEN_HASUNOSORA_B6.contentHash,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object';
}
