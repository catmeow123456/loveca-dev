import { createHash } from 'node:crypto';
import type { AiDecisionSelection } from '../../application/ai-decisions/index.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import type { AiStrategyTier } from './explainable-decision-policy.js';
import type { AiModelInvocationAudit } from './model-governance.js';
import type { AiStrategyContext } from './strategy-context.js';

export const AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.audit.strategyDecisionAudit;
export const AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.audit.strategyDecisionRecord;

export interface AiStrategyDecisionAudit {
  readonly schemaVersion: typeof AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION;
  readonly contextSchemaVersion: AiStrategyContext['schemaVersion'];
  readonly observationSchemaVersion: AiStrategyContext['observation']['schemaVersion'];
  readonly decisionContractVersion: AiStrategyContext['observation']['decisionContractSchemaVersion'];
  readonly commandAdapterVersion: AiStrategyContext['observation']['commandAdapterVersion'];
  readonly contextSha256: string;
  readonly authorityRevision: number;
  readonly seat: AiStrategyContext['observation']['viewerSeat'];
  readonly decisionKind: AiStrategyContext['observation']['decision']['kind'];
  readonly compactRulesVersion: AiStrategyContext['knowledge']['compactRules']['version'];
  readonly playbookVersion: AiStrategyContext['knowledge']['deckPlaybook']['version'];
  readonly policyVersion: string;
  readonly tier: AiStrategyTier;
  readonly reasonCode: string;
  readonly summary: string;
  readonly factRefs: readonly string[];
  readonly tradeoff: string | null;
  readonly nextPlan: string | null;
  readonly consideredIds: readonly string[];
  readonly selection: AiDecisionSelection;
}

export interface AiStrategyDecisionRecord {
  readonly schemaVersion: typeof AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION;
  readonly decisionAudit: AiStrategyDecisionAudit;
  readonly modelInvocation: AiModelInvocationAudit | null;
  readonly contractIdentity: {
    readonly decisionIdSha256: string;
    readonly windowSignatureSha256: string;
  };
  readonly execution: {
    readonly status: 'ACCEPTED' | 'REJECTED';
    readonly commandType: string;
    readonly authorityRevisionAfter: number;
    readonly errorCode: string | null;
  };
  readonly ruleRandomFactRefs: readonly string[];
}

export interface AiStrategyDecisionRecordStore {
  append(record: AiStrategyDecisionRecord): void;
  list(): readonly AiStrategyDecisionRecord[];
}

export interface AuditableAiDecisionResult {
  readonly policyVersion: string;
  readonly tier: AiStrategyTier;
  readonly reasonCode: string;
  readonly summary: string;
  readonly factRefs?: readonly string[];
  readonly tradeoff?: string;
  readonly nextPlan?: string;
  readonly consideredIds: readonly string[];
  readonly selection: AiDecisionSelection;
}

/**
 * Produces the Phase 2 strategy audit fact from the already-redacted context.
 *
 * The match runtime persists this fact without receiving the full strategy
 * context in ordinary audit records.
 */
export function createAiStrategyDecisionAudit(
  context: AiStrategyContext,
  result: AuditableAiDecisionResult
): AiStrategyDecisionAudit {
  return {
    schemaVersion: AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
    contextSchemaVersion: context.schemaVersion,
    observationSchemaVersion: context.observation.schemaVersion,
    decisionContractVersion: context.observation.decisionContractSchemaVersion,
    commandAdapterVersion: context.observation.commandAdapterVersion,
    contextSha256: hashCanonicalJson(context),
    authorityRevision: context.observation.authorityRevision,
    seat: context.observation.viewerSeat,
    decisionKind: context.observation.decision.kind,
    compactRulesVersion: context.knowledge.compactRules.version,
    playbookVersion: context.knowledge.deckPlaybook.version,
    policyVersion: result.policyVersion,
    tier: result.tier,
    reasonCode: result.reasonCode,
    summary: result.summary,
    factRefs: [...(result.factRefs ?? [])],
    tradeoff: result.tradeoff ?? null,
    nextPlan: result.nextPlan ?? null,
    consideredIds: [...result.consideredIds],
    selection: cloneSelection(result.selection),
  };
}

export function createAiStrategyDecisionRecord(input: {
  readonly decisionAudit: AiStrategyDecisionAudit;
  readonly decisionId: string;
  readonly windowSignature: string;
  readonly commandType: string;
  readonly authorityRevisionAfter: number;
  readonly execution:
    { readonly status: 'ACCEPTED' } | { readonly status: 'REJECTED'; readonly errorCode: string };
  readonly ruleRandomFactRefs?: readonly string[];
  readonly modelInvocation?: AiModelInvocationAudit | null;
}): AiStrategyDecisionRecord {
  if (
    input.execution.status === 'ACCEPTED' &&
    input.authorityRevisionAfter <= input.decisionAudit.authorityRevision
  ) {
    throw new Error('Accepted AI strategy decisions must advance the authority revision');
  }
  return {
    schemaVersion: AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
    decisionAudit: {
      ...input.decisionAudit,
      factRefs: [...input.decisionAudit.factRefs],
      consideredIds: [...input.decisionAudit.consideredIds],
      selection: cloneSelection(input.decisionAudit.selection),
    },
    modelInvocation: input.modelInvocation
      ? cloneModelInvocationAudit(input.modelInvocation)
      : null,
    contractIdentity: {
      decisionIdSha256: hashText(input.decisionId),
      windowSignatureSha256: hashText(input.windowSignature),
    },
    execution: {
      status: input.execution.status,
      commandType: input.commandType,
      authorityRevisionAfter: input.authorityRevisionAfter,
      errorCode: input.execution.status === 'REJECTED' ? input.execution.errorCode : null,
    },
    ruleRandomFactRefs: [...(input.ruleRandomFactRefs ?? [])],
  };
}

export function createInMemoryAiStrategyDecisionRecordStore(): AiStrategyDecisionRecordStore {
  const records: AiStrategyDecisionRecord[] = [];
  return {
    append(record) {
      records.push(cloneDecisionRecord(record));
    },
    list() {
      return records.map(cloneDecisionRecord);
    },
  };
}

function hashCanonicalJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function cloneSelection(selection: AiDecisionSelection): AiDecisionSelection {
  switch (selection.kind) {
    case 'MULLIGAN':
    case 'PAY_COST':
    case 'CONFIRM_SPECIAL_MEMBER_PLAY':
    case 'SELECT_EFFECT_CARDS':
      return { ...selection, candidateIds: [...selection.candidateIds] };
    case 'SELECT_EFFECT_OPTIONS':
      return { ...selection, optionIds: [...selection.optionIds] };
    case 'SET_STAGE_FORMATION':
      return {
        ...selection,
        placements: selection.placements.map((placement) => ({ ...placement })),
      };
    default:
      return { ...selection };
  }
}

function cloneDecisionRecord(record: AiStrategyDecisionRecord): AiStrategyDecisionRecord {
  return {
    ...record,
    decisionAudit: {
      ...record.decisionAudit,
      factRefs: [...record.decisionAudit.factRefs],
      consideredIds: [...record.decisionAudit.consideredIds],
      selection: cloneSelection(record.decisionAudit.selection),
    },
    modelInvocation: record.modelInvocation
      ? cloneModelInvocationAudit(record.modelInvocation)
      : null,
    contractIdentity: { ...record.contractIdentity },
    execution: { ...record.execution },
    ruleRandomFactRefs: [...record.ruleRandomFactRefs],
  };
}

function cloneModelInvocationAudit(audit: AiModelInvocationAudit): AiModelInvocationAudit {
  return {
    ...audit,
    attempts: audit.attempts.map((attempt) => ({
      ...attempt,
      usage: { ...attempt.usage },
    })),
  };
}
