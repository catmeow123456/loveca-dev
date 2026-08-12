import { describe, expect, it } from 'vitest';
import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../src/application/ai-decisions';
import {
  AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
  AI_MODEL_STRATEGY_CONTEXT_SCHEMA_VERSION,
} from '../../src/server/ai-battle/model-protocol';
import { AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION } from '../../src/server/ai-battle/semantic-context';
import {
  createLegalAiModelProvider,
  selectLegalAiModelDecision,
} from '../helpers/ai-battle/fake-model-provider';
import {
  createAiModelRequestEnvelopeFixture,
  createAiModelStrategyContextFixture,
} from '../helpers/ai-battle/model-envelope-builder';
import {
  createAiObservationFixture,
  createAiObservedSeat,
  createAiObservedZone,
  replaceAiObservedZone,
} from '../helpers/ai-battle/observation-builder';
import { createAiSemanticDecisionContextFixture } from '../helpers/ai-battle/semantic-context-builder';

describe('AI battle layered test builders', () => {
  it('uses current protocol versions while allowing one observation layer to change', () => {
    const hand = createAiObservedZone({
      zoneKey: 'HAND',
      visibleCards: [{ cardCode: 'TEST-1', name: '测试卡', cardType: 'MEMBER', cost: 2 }],
    });
    const firstSeat = replaceAiObservedZone(createAiObservedSeat(), hand);
    const observation = createAiObservationFixture({
      authorityRevision: 7,
      firstSeat,
      decision: {
        decisionRef: 'current-decision',
        kind: 'MULLIGAN',
        mandatory: true,
        candidates: [{ candidateId: 'candidate-1', hidden: false, card: hand.visibleCards[0] }],
        options: [],
        actions: [],
        input: {
          kind: 'CARD_SELECTION',
          minSelections: 0,
          maxSelections: 1,
          canSkip: true,
        },
      },
    });
    const semantic = createAiSemanticDecisionContextFixture({ observation });

    expect(observation).toMatchObject({
      decisionContractSchemaVersion: AI_DECISION_CONTRACT_SCHEMA_VERSION,
      commandAdapterVersion: AI_DECISION_COMMAND_ADAPTER_VERSION,
      authorityRevision: 7,
    });
    expect(observation.seats.FIRST.zones).toEqual([hand]);
    expect(semantic.schemaVersion).toBe(AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION);
    expect(semantic.currentDecision.kind).toBe('MULLIGAN');
  });

  it('builds current model envelopes and returns a provider-valid legal response', async () => {
    const envelope = createAiModelRequestEnvelopeFixture();
    const provider = createLegalAiModelProvider({ tradeoff: null, nextPlan: null });
    const result = await provider.invoke(
      {
        systemMessage: JSON.stringify({ systemInstruction: envelope.systemInstruction }),
        userMessage: JSON.stringify({
          attempt: envelope.attempt,
          strategyContext: envelope.strategyContext,
        }),
      },
      new AbortController().signal
    );

    expect(envelope.schemaVersion).toBe(AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION);
    expect(envelope.strategyContext.schemaVersion).toBe(AI_MODEL_STRATEGY_CONTEXT_SCHEMA_VERSION);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(JSON.parse(result.rawOutput)).toEqual({ selection: { kind: 'CONFIRM_PHASE' } });
  });

  it('solves grouped selections, numeric ranges, and mandatory formations generically', () => {
    const grouped = createAiModelStrategyContextFixture({
      currentDecision: {
        kind: 'ACTIVE_EFFECT',
        instruction: '选择卡牌。',
        facts: [
          '这一步最少选择 2 项，最多选择 2 项，不能跳过。',
          'live 只能从 live-1、live-2 中选择：最少 1 项、最多 1 项。',
          'member 只能从 member-1 中选择：最少 1 项、最多 1 项。',
        ],
        choices: [
          choice('CANDIDATE', 'live-1'),
          choice('CANDIDATE', 'live-2'),
          choice('CANDIDATE', 'member-1'),
        ],
      },
    });
    const numeric = createAiModelStrategyContextFixture({
      currentDecision: {
        kind: 'ACTIVE_EFFECT',
        instruction: '输入数字。',
        facts: ['本步骤输入数值，范围 -3 至 -1，必须为整数。'],
        choices: [choice('SELECTION', 'SELECT_EFFECT_NUMBER')],
      },
    });
    const formation = createAiModelStrategyContextFixture({
      currentDecision: {
        kind: 'ACTIVE_EFFECT',
        instruction: '安排站位。',
        facts: [],
        choices: [
          choice('PLACEMENT', 'member-left@LEFT'),
          choice('PLACEMENT', 'member-left@CENTER'),
          choice('PLACEMENT', 'member-center@LEFT'),
          choice('PLACEMENT', 'member-center@CENTER'),
        ],
      },
    });

    expect(selectLegalAiModelDecision(grouped)).toEqual({
      kind: 'SELECT_EFFECT_CARDS',
      candidateIds: ['live-1', 'member-1'],
    });
    expect(selectLegalAiModelDecision(numeric)).toEqual({
      kind: 'SELECT_EFFECT_NUMBER',
      value: -3,
    });
    expect(selectLegalAiModelDecision(formation)).toEqual({
      kind: 'SET_STAGE_FORMATION',
      placements: [
        { candidateId: 'member-left', toSlot: 'LEFT' },
        { candidateId: 'member-center', toSlot: 'CENTER' },
      ],
    });
  });
});

function choice(
  choiceKind: 'ACTION' | 'CANDIDATE' | 'OPTION' | 'SLOT' | 'PLACEMENT' | 'SELECTION',
  choiceId: string
) {
  return { choiceKind, choiceId, description: choiceId, details: [] };
}
