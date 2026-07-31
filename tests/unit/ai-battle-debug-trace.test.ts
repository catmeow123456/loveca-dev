import { describe, expect, it } from 'vitest';
import {
  AI_BATTLE_DEBUG_TRACE_MAX_ENTRIES,
  appendAiBattleDebugTraceEntry,
  createAiBattleDebugTraceRuntime,
  readAiBattleDebugTraceConfigurationStatus,
  readAiBattleDebugTraceView,
  summarizeAiDecisionSelection,
} from '../../src/server/ai-battle/debug-trace';

describe('AI battle debug trace', () => {
  it('requires the explicit development-only environment switch', () => {
    expect(
      readAiBattleDebugTraceConfigurationStatus({
        NODE_ENV: 'development',
        AI_BATTLE_DEBUG_TRACE_ENABLED: '1',
      }).enabled
    ).toBe(true);
    expect(
      readAiBattleDebugTraceConfigurationStatus({
        NODE_ENV: 'production',
        AI_BATTLE_DEBUG_TRACE_ENABLED: '1',
      }).enabled
    ).toBe(false);
    expect(
      readAiBattleDebugTraceConfigurationStatus({
        NODE_ENV: 'development',
        AI_BATTLE_DEBUG_TRACE_ENABLED: '0',
      }).enabled
    ).toBe(false);
  });

  it('keeps only a bounded in-memory trace and marks an evicted cursor as truncated', () => {
    const runtime = createAiBattleDebugTraceRuntime();
    for (let index = 0; index < AI_BATTLE_DEBUG_TRACE_MAX_ENTRIES + 2; index += 1) {
      appendAiBattleDebugTraceEntry(runtime, {
        createdAt: index,
        stage: 'STARTED',
        decisionKind: 'MULLIGAN',
        authorityRevision: index,
        source: 'MODEL',
        tier: null,
        reasonCode: null,
        summary: '正在选择',
        selection: null,
        model: null,
        modelContext: null,
        executionStatus: null,
      });
    }

    const view = readAiBattleDebugTraceView(runtime, 'match-1', 1);
    expect(view.enabled).toBe(true);
    expect(view.truncated).toBe(true);
    expect(view.entries).toHaveLength(AI_BATTLE_DEBUG_TRACE_MAX_ENTRIES);
    expect(view.entries[0]?.seq).toBe(3);
    expect(view.currentSeq).toBe(AI_BATTLE_DEBUG_TRACE_MAX_ENTRIES + 2);
  });

  it('retains exact provider-neutral messages and clones parsed model output in memory', () => {
    const runtime = createAiBattleDebugTraceRuntime();
    appendAiBattleDebugTraceEntry(runtime, {
      createdAt: 1,
      stage: 'COMPLETED',
      decisionKind: 'MAIN_PHASE',
      authorityRevision: 4,
      source: 'MODEL',
      tier: 'HEURISTIC',
      reasonCode: 'MODEL_STRUCTURED_SELECTION',
      summary: '选择结束主要阶段',
      selection: null,
      model: null,
      modelContext: {
        attempts: [
          {
            attemptNumber: 1,
            attemptKind: 'INITIAL',
            failureCode: null,
            requestSha256: 'sha256:request',
            requestEnvelopeVersion: 'ai-battle.model-request-envelope/v2',
            promptVersion: 'ai-battle.model-system-prompt/v2',
            outputSchemaVersion: 'ai-battle.model-decision-output/v2',
            systemMessage: '{"systemInstruction":{"task":"SELECT_ONE_CURRENT_LEGAL_DECISION"}}',
            userMessage: '{"strategyContext":{"semanticContext":{"currentState":{}}}}',
            parsedOutput: {
              schemaVersion: 'ai-battle.model-decision-output/v2',
              selection: { kind: 'CONFIRM_PHASE' },
              factRefs: ['decision.base'],
              tradeoff: '当前没有更优的合法动作。',
              nextPlan: '进入下一阶段后重新观察。',
            },
            outcome: 'SUCCESS',
          },
        ],
      },
      executionStatus: 'ACCEPTED',
    });

    const firstView = readAiBattleDebugTraceView(runtime, 'match-1');
    const secondView = readAiBattleDebugTraceView(runtime, 'match-1');
    const firstAttempt = firstView.entries[0]?.modelContext?.attempts[0];
    const secondAttempt = secondView.entries[0]?.modelContext?.attempts[0];

    expect(firstView.schemaVersion).toBe('ai-battle.debug-trace/v2');
    expect(firstAttempt).toMatchObject({
      requestSha256: 'sha256:request',
      outcome: 'SUCCESS',
      parsedOutput: { selection: { kind: 'CONFIRM_PHASE' } },
    });
    expect(firstAttempt).not.toBe(secondAttempt);
    expect(firstAttempt?.parsedOutput).not.toBe(secondAttempt?.parsedOutput);
  });

  it('summarizes a choice without exposing contract-local candidate ids', () => {
    const summary = summarizeAiDecisionSelection({
      kind: 'MULLIGAN',
      candidateIds: ['candidate-private-1', 'candidate-private-2'],
    });

    expect(summary).toEqual({
      kind: 'MULLIGAN',
      selectedCount: 2,
      label: '换牌 2 张',
    });
    expect(JSON.stringify(summary)).not.toContain('candidate-private');
  });
});
