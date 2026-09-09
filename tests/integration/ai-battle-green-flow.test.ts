import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { GameCommandType } from '../../src/application/game-commands';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { buildAiBattleDecision, parseAiBattleResponse } from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { GameEndReason } from '../../src/shared/types/enums';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import { DecisionTapeRandomSource } from '../../src/shared/random-source';
import { readFrozenGreenHasunosoraDeck, readFrozenMuseDeck } from '../helpers/ai-curated-decks';
import { chooseAiTestSelection } from '../helpers/ai-battle-test-policy';

const abilityCounts = [1, 1, 0, 1, 1, 1, 2, 2, 1, 2, 1, 2, 1, 1, 2, 1, 1, 1, 1];

describe('frozen green Hasunosora AI support', () => {
  it('covers every ability by base identity and preserves exact printed card facts', () => {
    const { deck } = readFrozenGreenHasunosoraDeck();
    const cards = [
      ...new Map(deck.mainDeck.map((card) => [getBaseCardCode(card.cardCode), card])).values(),
    ];
    expect(cards).toHaveLength(19);
    cards.forEach((card, index) => {
      const base = getBaseCardCode(card.cardCode);
      const definitions = getCardAbilityDefinitionsForCardCode(card.cardCode);
      expect(definitions, base).toHaveLength(abilityCounts[index]!);
      for (const definition of definitions) {
        expect(definition.implemented).toBe(true);
        expect(definition.baseCardCodes).toContain(base);
      }
      expect(getCardAbilityDefinitionsForCardCode(`${base}-FUTURE`)).toEqual(definitions);
    });
  });

  it.each([
    { greenSeat: 0, mirror: false, variant: false },
    { greenSeat: 1, mirror: false, variant: false },
    { greenSeat: 0, mirror: true, variant: false },
    { greenSeat: 1, mirror: true, variant: true },
  ])(
    'naturally finishes RULES games: %j',
    ({ greenSeat, mirror, variant }) => {
      let seed = 0x12345678;
      const tape = new DecisionTapeRandomSource(
        'ai-green-bp6-v1',
        Array.from({ length: 40_000 }, () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed;
        })
      );
      let now = 1000;
      const session = createGameSession({ now: () => now, randomInt: tape.nextInt });
      const green = readFrozenGreenHasunosoraDeck().deck;
      const greenDeck = variant
        ? {
            ...green,
            mainDeck: green.mainDeck.map((card) => ({
              ...card,
              cardCode: `${getBaseCardCode(card.cardCode)}-FUTURE`,
            })),
          }
        : green;
      const other = mirror ? greenDeck : readFrozenMuseDeck().deck;
      const players = ['first', 'second'];
      session.createGame('green-ai-flow', players[0]!, 'First', players[1]!, 'Second');
      expect(
        session.initializeGame(
          greenSeat === 0 ? greenDeck : other,
          greenSeat === 0 ? other : greenDeck
        ).success
      ).toBe(true);
      const commands = new Set<string>();
      const effectSteps = new Set<string>();
      for (let step = 0; step < 1800 && !session.state!.isEnded; step++) {
        const queries = players.map((id) =>
          buildAiBattleDecision(session.state!, id, session.getPlayerViewState(id)!)
        );
        expect(
          queries.filter((q) => q.kind === 'UNSUPPORTED'),
          `Unsupported at ${session.state!.activeEffect?.stepId}`
        ).toEqual([]);
        const current = queries.find((q) => q.kind === 'DECISION');
        if (current?.kind !== 'DECISION') {
          const time = queries.find((q) => q.kind === 'WAITING_FOR_TIME');
          if (time?.kind !== 'WAITING_FOR_TIME')
            throw Error(JSON.stringify({ step, queries, phase: session.state!.currentSubPhase }));
          now = time.deadlineAt;
          continue;
        }
        const decision = current.decision;
        if (session.state!.activeEffect) effectSteps.add(session.state!.activeEffect.stepId);
        const selection =
          getAiMechanicalSelection(decision) ?? chooseAiTestSelection(decision.input);
        const parsed = parseAiBattleResponse(decision, JSON.stringify({ selection }));
        const command = decision.toCommand(parsed.selection, now);
        const result = session.executeCommand(command);
        expect(
          result.success,
          JSON.stringify({
            step,
            command,
            error: result.error,
            effect: session.state!.activeEffect?.stepId,
          })
        ).toBe(true);
        commands.add(command.type);
        now += 10;
      }
      expect(
        session.state!.isEnded,
        JSON.stringify({ turn: session.state!.turnCount, effectSteps: [...effectSteps] })
      ).toBe(true);
      expect(session.state!.manualOperationMode).toBe('RULES');
      expect([GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW]).toContain(
        session.state!.endInfo?.reason
      );
      for (const command of [
        GameCommandType.PLAY_MEMBER_TO_SLOT,
        GameCommandType.SUBMIT_JUDGMENT,
        GameCommandType.SELECT_SUCCESS_LIVE,
      ])
        expect(commands).toContain(command);
      expect(effectSteps.size).toBeGreaterThan(3);
    },
    30_000
  );
});
