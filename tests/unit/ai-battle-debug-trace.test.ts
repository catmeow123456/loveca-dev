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
