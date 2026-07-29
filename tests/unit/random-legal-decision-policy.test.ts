import { describe, expect, it } from 'vitest';
import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
  buildAiDecisionContract,
  validateAiDecisionSelection,
  type AiDecisionContractHandle,
} from '../../src/application/ai-decisions';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createSeededRuleRandomSource } from '../../src/domain/rules/rule-random';
import {
  createReplayRandomLegalDecisionPolicy,
  createSeededRandomLegalDecisionPolicy,
} from '../../src/server/ai-battle/random-legal-decision-policy';
import { CardType } from '../../src/shared/types/enums';

describe('random legal decision policy', () => {
  it('produces reproducible, contract-valid choices from a separate strategy seed', () => {
    const first = createSeededRandomLegalDecisionPolicy('strategy-31');
    const second = createSeededRandomLegalDecisionPolicy('strategy-31');
    const handle = createMulliganHandle();

    const firstResult = first.select(handle);
    const secondResult = second.select(handle);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) {
      expect(validateAiDecisionSelection(handle, firstResult.selection)).toEqual({ ok: true });
    }
  });

  it('replays recorded strategy facts only against the exact decision window', () => {
    const recording = createSeededRandomLegalDecisionPolicy('strategy-replay');
    const handle = createMulliganHandle();
    expect(recording.select(handle).ok).toBe(true);

    const replay = createReplayRandomLegalDecisionPolicy(recording.getFacts());
    expect(replay.select(handle)).toMatchObject({ ok: true });
    expect(() => replay.assertReplayComplete()).not.toThrow();

    const mismatchedReplay = createReplayRandomLegalDecisionPolicy(recording.getFacts());
    const mismatch = mismatchedReplay.select({
      contract: {
        ...handle.contract,
        decisionId: 'another-decision',
      },
    });
    expect(mismatch).toMatchObject({ ok: false, reason: 'REPLAY_MISMATCH' });
  });
});

function createMulliganHandle(): AiDecisionContractHandle {
  const session = createGameSession({
    ruleRandomSource: createSeededRuleRandomSource('policy-test-rules'),
  });
  session.createGame('random-policy', 'p1', 'P1', 'p2', 'P2');
  session.initializeGame(createDeck('a'), createDeck('b'));
  const result = buildAiDecisionContract(session.state!, 'p1', 1, 1_000);
  if (!result.ok) {
    throw new Error(result.detail);
  }
  expect(result.handle.contract.schemaVersion).toBe(AI_DECISION_CONTRACT_SCHEMA_VERSION);
  expect(result.handle.contract.commandAdapterVersion).toBe(AI_DECISION_COMMAND_ADAPTER_VERSION);
  return result.handle;
}

function createDeck(prefix: string): DeckConfig {
  const mainDeck: MemberCardData[] = Array.from({ length: 12 }, (_, index) => ({
    cardCode: `${prefix}-member-${String(index)}`,
    name: `${prefix} member ${String(index)}`,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [],
  }));
  const energyDeck: EnergyCardData[] = Array.from({ length: 3 }, (_, index) => ({
    cardCode: `${prefix}-energy-${String(index)}`,
    name: `${prefix} energy ${String(index)}`,
    cardType: CardType.ENERGY,
  }));
  return { mainDeck, energyDeck };
}
