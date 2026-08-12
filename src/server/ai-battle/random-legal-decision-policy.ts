import {
  getAiDecisionWitness,
  sampleAiDecisionSelection,
  validateAiDecisionSelection,
  type AiDecisionContractHandle,
  type AiDecisionSelection,
} from '../../application/ai-decisions/index.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';

export const AI_RANDOM_LEGAL_POLICY_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.policy.randomLegalDecision;
export const AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.evaluation.randomLegalDecisionFact;

export interface RandomLegalDecisionFact {
  readonly schemaVersion: typeof AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION;
  readonly sequence: number;
  readonly policyVersion: typeof AI_RANDOM_LEGAL_POLICY_VERSION;
  readonly decisionId: string;
  readonly windowSignature: string;
  readonly contractKind: AiDecisionContractHandle['contract']['kind'];
  readonly repairAttempts: number;
  readonly selection: AiDecisionSelection;
}

export type RandomLegalDecisionResult =
  | {
      readonly ok: true;
      readonly policyVersion: typeof AI_RANDOM_LEGAL_POLICY_VERSION;
      readonly fact: RandomLegalDecisionFact;
      readonly selection: AiDecisionSelection;
    }
  | {
      readonly ok: false;
      readonly reason: 'NO_LEGAL_SELECTION' | 'REPLAY_EXHAUSTED' | 'REPLAY_MISMATCH';
      readonly detail: string;
    };

export interface RandomLegalDecisionPolicy {
  select(handle: AiDecisionContractHandle): RandomLegalDecisionResult;
  getFacts(): readonly RandomLegalDecisionFact[];
  assertReplayComplete(): void;
}

export function createSeededRandomLegalDecisionPolicy(
  seed: string | number,
  maxRepairRetries = 2
): RandomLegalDecisionPolicy {
  assertRepairRetries(maxRepairRetries);
  const random = createSeededRandom(String(seed));
  const facts: RandomLegalDecisionFact[] = [];
  return {
    select(handle) {
      for (let repairAttempts = 0; repairAttempts <= maxRepairRetries; repairAttempts += 1) {
        const selection = sampleAiDecisionSelection(handle, random);
        if (!selection) {
          continue;
        }
        const validation = validateAiDecisionSelection(handle, selection);
        if (!validation.ok) {
          continue;
        }
        const fact = buildFact(facts.length + 1, handle, selection, repairAttempts);
        facts.push(fact);
        return {
          ok: true,
          policyVersion: AI_RANDOM_LEGAL_POLICY_VERSION,
          fact,
          selection,
        };
      }

      const witness = getAiDecisionWitness(handle);
      const witnessValidation = witness ? validateAiDecisionSelection(handle, witness) : null;
      if (witness && witnessValidation?.ok) {
        const fact = buildFact(facts.length + 1, handle, witness, maxRepairRetries);
        facts.push(fact);
        return {
          ok: true,
          policyVersion: AI_RANDOM_LEGAL_POLICY_VERSION,
          fact,
          selection: witness,
        };
      }
      return {
        ok: false,
        reason: 'NO_LEGAL_SELECTION',
        detail: `随机合法策略无法处理 ${handle.contract.kind} 契约`,
      };
    },
    getFacts() {
      return facts.map(cloneFact);
    },
    assertReplayComplete() {},
  };
}

export function createReplayRandomLegalDecisionPolicy(
  expectedFacts: readonly RandomLegalDecisionFact[]
): RandomLegalDecisionPolicy {
  const replayedFacts: RandomLegalDecisionFact[] = [];
  let cursor = 0;
  return {
    select(handle) {
      const expected = expectedFacts[cursor];
      if (!expected) {
        return {
          ok: false,
          reason: 'REPLAY_EXHAUSTED',
          detail: `策略选择事实已耗尽：decision=${handle.contract.decisionId}`,
        };
      }
      if (
        expected.schemaVersion !== AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION ||
        expected.sequence !== cursor + 1 ||
        expected.policyVersion !== AI_RANDOM_LEGAL_POLICY_VERSION ||
        expected.decisionId !== handle.contract.decisionId ||
        expected.windowSignature !== handle.contract.windowSignature ||
        expected.contractKind !== handle.contract.kind
      ) {
        return {
          ok: false,
          reason: 'REPLAY_MISMATCH',
          detail: `策略选择事实与当前窗口不匹配：sequence=${String(cursor + 1)}`,
        };
      }
      const validation = validateAiDecisionSelection(handle, expected.selection);
      if (!validation.ok) {
        return {
          ok: false,
          reason: 'REPLAY_MISMATCH',
          detail: `记录的策略选择已不合法：${validation.error}`,
        };
      }
      cursor += 1;
      const fact = cloneFact(expected);
      replayedFacts.push(fact);
      return {
        ok: true,
        policyVersion: AI_RANDOM_LEGAL_POLICY_VERSION,
        fact,
        selection: fact.selection,
      };
    },
    getFacts() {
      return replayedFacts.map(cloneFact);
    },
    assertReplayComplete() {
      if (cursor !== expectedFacts.length) {
        throw new Error(
          `策略选择事实尚未消费完毕：已消费 ${String(cursor)}，总计 ${String(expectedFacts.length)}`
        );
      }
    },
  };
}

function buildFact(
  sequence: number,
  handle: AiDecisionContractHandle,
  selection: AiDecisionSelection,
  repairAttempts: number
): RandomLegalDecisionFact {
  return {
    schemaVersion: AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION,
    sequence,
    policyVersion: AI_RANDOM_LEGAL_POLICY_VERSION,
    decisionId: handle.contract.decisionId,
    windowSignature: handle.contract.windowSignature,
    contractKind: handle.contract.kind,
    repairAttempts,
    selection: cloneSelection(selection),
  };
}

function cloneFact(fact: RandomLegalDecisionFact): RandomLegalDecisionFact {
  return {
    ...fact,
    selection: cloneSelection(fact.selection),
  };
}

function cloneSelection(selection: AiDecisionSelection): AiDecisionSelection {
  return JSON.parse(JSON.stringify(selection)) as AiDecisionSelection;
}

function assertRepairRetries(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('maxRepairRetries 必须是非负安全整数');
  }
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
