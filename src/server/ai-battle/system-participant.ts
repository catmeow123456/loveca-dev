import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../application/ai-decisions/index.js';
import { AI_EXPLAINABLE_DECISION_POLICY_VERSION } from './explainable-decision-policy.js';
import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
  AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS,
  AI_BATTLE_SYSTEM_PARTICIPANT,
  type AiBattlePhaseZeroDeckKey,
} from './phase-zero-baseline.js';
import { AI_STRATEGY_CONTEXT_SCHEMA_VERSION } from './strategy-context.js';
import { AI_COMPACT_RULES_VERSION, getAiDeckPlaybook } from './strategy-knowledge.js';

export const AI_SYSTEM_IDENTITY_SCHEMA_VERSION =
  'ai-battle.system-participant-identity/v1' as const;
export const AI_PHASE_THREE_PREGAME_POLICY_VERSION = 'ai-battle.phase-three-pregame/v1' as const;
export const AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION =
  'ai-battle.phase-three-lifecycle/v1' as const;

export const AI_BATTLE_FORMAL_SYSTEM_IDENTITY = {
  schemaVersion: AI_SYSTEM_IDENTITY_SCHEMA_VERSION,
  participantKey: AI_BATTLE_SYSTEM_PARTICIPANT.participantKey,
  userId: `system:${AI_BATTLE_SYSTEM_PARTICIPANT.participantKey}`,
  displayName: 'Loveca AI',
  participantKind: 'SYSTEM',
  loginAllowed: false,
} as const;

export interface AiSystemParticipantBinding {
  readonly schemaVersion: typeof AI_SYSTEM_IDENTITY_SCHEMA_VERSION;
  readonly participantKey: string;
  readonly userId: string;
  readonly displayName: string;
  readonly participantKind: 'SYSTEM';
  readonly loginAllowed: false;
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly deckContentHash: string;
  readonly canonicalDeckSchemaVersion: string;
  readonly phaseZeroBaselineVersion: typeof AI_BATTLE_PHASE_ZERO_BASELINE_VERSION;
  readonly phaseZeroCertificationVersions: typeof AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS;
  readonly decisionContractVersion: typeof AI_DECISION_CONTRACT_SCHEMA_VERSION;
  readonly commandAdapterVersion: typeof AI_DECISION_COMMAND_ADAPTER_VERSION;
  readonly compactRulesVersion: string;
  readonly playbookVersion: string;
  readonly strategyContextVersion: string;
  readonly policyVersion: string;
  readonly pregamePolicyVersion: string;
  readonly lifecyclePolicyVersion: string;
}

export function createAiSystemParticipantBinding(
  deckKey: AiBattlePhaseZeroDeckKey
): AiSystemParticipantBinding {
  const deck = AI_BATTLE_PHASE_ZERO_DECKS[deckKey];
  const playbook = getAiDeckPlaybook(deckKey);
  return {
    ...AI_BATTLE_FORMAL_SYSTEM_IDENTITY,
    deckKey,
    deckContentHash: deck.contentHash,
    canonicalDeckSchemaVersion: deck.canonicalSchemaVersion,
    phaseZeroBaselineVersion: AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
    phaseZeroCertificationVersions: { ...AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS },
    decisionContractVersion: AI_DECISION_CONTRACT_SCHEMA_VERSION,
    commandAdapterVersion: AI_DECISION_COMMAND_ADAPTER_VERSION,
    compactRulesVersion: AI_COMPACT_RULES_VERSION,
    playbookVersion: playbook.version,
    strategyContextVersion: AI_STRATEGY_CONTEXT_SCHEMA_VERSION,
    policyVersion: AI_EXPLAINABLE_DECISION_POLICY_VERSION,
    pregamePolicyVersion: AI_PHASE_THREE_PREGAME_POLICY_VERSION,
    lifecyclePolicyVersion: AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION,
  };
}

export function isCertifiedAiSystemParticipantBinding(
  binding: AiSystemParticipantBinding
): boolean {
  if (!(binding.deckKey in AI_BATTLE_PHASE_ZERO_DECKS)) return false;
  const expected = createAiSystemParticipantBinding(binding.deckKey);
  return canonicalJson(binding) === canonicalJson(expected);
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
