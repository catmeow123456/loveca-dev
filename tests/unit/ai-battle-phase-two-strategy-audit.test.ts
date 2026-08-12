import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../src/application/ai-decisions';
import { selectExplainableDecision } from '../../src/server/ai-battle/explainable-decision-policy';
import {
  AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
  AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
  createAiStrategyDecisionAudit,
  createAiStrategyDecisionRecord,
  createInMemoryAiStrategyDecisionRecordStore,
} from '../../src/server/ai-battle/strategy-decision-audit';
import { createAiObservationFixture } from '../helpers/ai-battle/observation-builder';
import { createAiStrategyContextFixture } from '../helpers/ai-battle/strategy-scenario-builder';

function observation(authorityRevision: number) {
  return createAiObservationFixture({
    authorityRevision,
    turn: {
      count: 1,
      phase: 'LIVE_RESULT_PHASE',
      subPhase: 'RESULT_SCORE_CONFIRM',
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
    },
    window: null,
    liveResult: {
      scores: { FIRST: 4, SECOND: 2 },
      scoreModifiers: { FIRST: 0, SECOND: 0 },
      winnerSeats: ['FIRST'],
      confirmedSeats: [],
    },
    decision: {
      decisionRef: 'current-decision',
      kind: 'SCORE_CONFIRMATION',
      mandatory: true,
      candidates: [],
      options: [],
      actions: [],
      authorityScore: 4,
    },
  });
}

function build(authorityRevision: number) {
  const context = createAiStrategyContextFixture({
    observation: observation(authorityRevision),
    deckKey: 'MUSE_STARTER',
  });
  const selected = selectExplainableDecision(context);
  expect(selected.ok).toBe(true);
  if (!selected.ok) throw new Error(selected.detail);
  return { context, selected };
}

describe('AI battle Phase 2 strategy decision audit', () => {
  it('records versions, redacted context hash, tier, reason, and structured selection', () => {
    const { context, selected } = build(12);
    const audit = createAiStrategyDecisionAudit(context, selected);

    expect(audit).toMatchObject({
      schemaVersion: AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
      contextSchemaVersion: 'ai-battle.strategy-context/v4',
      observationSchemaVersion: 'ai-battle.observation/v3',
      decisionContractVersion: AI_DECISION_CONTRACT_SCHEMA_VERSION,
      commandAdapterVersion: AI_DECISION_COMMAND_ADAPTER_VERSION,
      authorityRevision: 12,
      seat: 'FIRST',
      decisionKind: 'SCORE_CONFIRMATION',
      compactRulesVersion: 'ai-battle.compact-rules/v4',
      playbookVersion: 'ai-battle.playbook.muse-starter/v2',
      policyVersion: 'ai-battle.explainable-policy/v1',
      tier: 'RULE_FORCED',
      reasonCode: 'CONFIRM_AUTHORITY_SCORE',
      factRefs: [],
      tradeoff: null,
      nextPlan: null,
      selection: { kind: 'CONFIRM_SCORE' },
    });
    expect(audit.contextSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(createAiStrategyDecisionAudit(context, selected).contextSha256).toBe(
      audit.contextSha256
    );
    expect(JSON.stringify(audit)).not.toContain('matchId');
    expect(JSON.stringify(audit)).not.toContain('playerName');
    expect(JSON.stringify(audit)).not.toContain('obj_');
  });

  it('changes the context hash when the authority revision changes', () => {
    const first = build(12);
    const second = build(13);
    expect(createAiStrategyDecisionAudit(first.context, first.selected).contextSha256).not.toBe(
      createAiStrategyDecisionAudit(second.context, second.selected).contextSha256
    );
  });

  it('persists a redacted execution record with hashed contract identity', () => {
    const { context, selected } = build(12);
    const audit = createAiStrategyDecisionAudit(context, selected);
    const record = createAiStrategyDecisionRecord({
      decisionAudit: audit,
      decisionId: 'decision-with-runtime-identity',
      windowSignature: 'window-with-runtime-identity',
      commandType: 'CONFIRM_LIVE_SCORE',
      authorityRevisionAfter: 13,
      execution: { status: 'ACCEPTED' },
      ruleRandomFactRefs: ['rule-random-fact-9'],
    });
    const store = createInMemoryAiStrategyDecisionRecordStore();
    store.append(record);

    expect(store.list()[0]).toMatchObject({
      schemaVersion: AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
      execution: {
        status: 'ACCEPTED',
        commandType: 'CONFIRM_LIVE_SCORE',
        authorityRevisionAfter: 13,
        errorCode: null,
      },
      ruleRandomFactRefs: ['rule-random-fact-9'],
    });
    expect(record.contractIdentity.decisionIdSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record.contractIdentity.windowSignatureSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain('decision-with-runtime-identity');
    expect(JSON.stringify(record)).not.toContain('window-with-runtime-identity');
    expect(() =>
      createAiStrategyDecisionRecord({
        decisionAudit: audit,
        decisionId: 'decision',
        windowSignature: 'window',
        commandType: 'CONFIRM_LIVE_SCORE',
        authorityRevisionAfter: 12,
        execution: { status: 'ACCEPTED' },
      })
    ).toThrow('advance the authority revision');
  });

  it('keeps audit generation isolated from authority state and match services', () => {
    const source = readFileSync('src/server/ai-battle/strategy-decision-audit.ts', 'utf8');
    expect(source).not.toContain("from '../../domain/");
    expect(source).not.toContain("from '../services/");
    expect(source).not.toContain('GameState');
    expect(source).not.toContain('PlayerViewState');
  });
});
