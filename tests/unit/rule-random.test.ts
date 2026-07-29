import { describe, expect, it } from 'vitest';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createReplayRuleRandomSource,
  createRuleRandomFactRecorder,
  createSeededRuleRandomSource,
  shuffleWithRuleRandom,
  withRuleRandomSource,
} from '../../src/domain/rules/rule-random';
import { CardType } from '../../src/shared/types/enums';

describe('rule random source', () => {
  it('repeats seeded rule randomness independently from strategy randomness', () => {
    const first = createRuleRandomFactRecorder(createSeededRuleRandomSource('rules-seed-7'));
    const second = createRuleRandomFactRecorder(createSeededRuleRandomSource('rules-seed-7'));

    const firstOrder = withRuleRandomSource(first, () =>
      shuffleWithRuleRandom(['a', 'b', 'c', 'd', 'e'], 'INITIAL_MAIN_DECK_SHUFFLE')
    );
    const secondOrder = withRuleRandomSource(second, () =>
      shuffleWithRuleRandom(['a', 'b', 'c', 'd', 'e'], 'INITIAL_MAIN_DECK_SHUFFLE')
    );

    expect(secondOrder).toEqual(firstOrder);
    expect(second.getFacts()).toEqual(first.getFacts());
  });

  it('replays and strictly consumes the recorded rule-random fact tape', () => {
    const recording = createRuleRandomFactRecorder(createSeededRuleRandomSource(19));
    const recordedOrder = withRuleRandomSource(recording, () =>
      shuffleWithRuleRandom([1, 2, 3, 4, 5, 6], 'DECK_REFRESH_SHUFFLE')
    );
    const replay = createRuleRandomFactRecorder(createReplayRuleRandomSource(recording.getFacts()));
    const replayedOrder = withRuleRandomSource(replay, () =>
      shuffleWithRuleRandom([1, 2, 3, 4, 5, 6], 'DECK_REFRESH_SHUFFLE')
    );

    replay.assertReplayComplete();
    expect(replayedOrder).toEqual(recordedOrder);
    expect(replay.getFacts()).toEqual(recording.getFacts());
  });

  it('rejects a replay when the rule-random call shape changes', () => {
    const recording = createRuleRandomFactRecorder(createSeededRuleRandomSource(23));
    withRuleRandomSource(recording, () =>
      shuffleWithRuleRandom([1, 2, 3], 'MULLIGAN_MAIN_DECK_SHUFFLE')
    );
    const replay = createRuleRandomFactRecorder(createReplayRuleRandomSource(recording.getFacts()));

    expect(() =>
      withRuleRandomSource(replay, () => shuffleWithRuleRandom([1, 2, 3], 'DECK_REFRESH_SHUFFLE'))
    ).toThrow(/规则随机事实不匹配/);
  });

  it('records production-shaped rule facts in the sealed GameSession audit', () => {
    const session = createGameSession({
      ruleRandomSource: createSeededRuleRandomSource('session-rules'),
    });
    session.createGame('rule-random-audit', 'p1', 'P1', 'p2', 'P2');

    expect(session.initializeGame(createDeck('a'), createDeck('b')).success).toBe(true);

    const facts = session.getRuleRandomFacts();
    const auditFacts = session
      .getSealedAuditSince(0)
      .filter((record) => record.type === 'RULE_RANDOM_FACT')
      .map((record) => record.payload);
    expect(facts.length).toBeGreaterThan(0);
    expect(auditFacts).toEqual(facts);
  });
});

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
