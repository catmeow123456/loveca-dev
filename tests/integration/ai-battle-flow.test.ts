import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { GameCommandType } from '../../src/application/game-commands';
import { DecisionTapeRandomSource } from '../../src/shared/random-source';
import { GameEndReason, GameMode } from '../../src/shared/types/enums';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  buildAiBattleDecision,
  materializeAiDecisionCommands,
  parseAiBattleResponse,
  type AiDecision,
  type AiSelection,
} from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { readFrozenMuseDeck } from '../helpers/ai-curated-decks';

/** Deterministic test strategy; reads the current visible input and never calls error fallback. */
function choose(decision: AiDecision): AiSelection {
  const mechanical = getAiMechanicalSelection(decision);
  if (mechanical) return mechanical;
  const { space, state, purpose } = decision.input;
  if (space.kind === 'CARDS') {
    const candidates =
      purpose === 'MULLIGAN'
        ? space.candidates.filter(
            (card) => (state.objects[card.objectId!]!.frontInfo?.cost ?? 0) > 4
          )
        : space.candidates;
    const count =
      purpose === 'MULLIGAN'
        ? candidates.length
        : Math.min(space.max, Math.max(space.min, candidates.length ? 1 : 0));
    return { kind: 'CARDS', cardRefs: candidates.slice(0, count).map((card) => card.ref) };
  }
  const choices = space.candidates.map((candidate) => ({
    candidate,
    selection: { kind: 'ACTION', actionRef: candidate.ref } as const,
    command: decision.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 0),
  }));
  if (purpose === 'MAIN') {
    const plays = choices.filter(({ candidate, command }) => {
      if (command.type !== GameCommandType.PLAY_MEMBER_TO_SLOT) return false;
      const cost = state.objects[candidate.objectId!]!.frontInfo!.cost!;
      return candidate.replacedObjectIds!.every((id) => cost > state.objects[id]!.frontInfo!.cost!);
    });
    plays.sort(
      (a, b) =>
        state.objects[b.candidate.objectId!]!.frontInfo!.cost! -
        state.objects[a.candidate.objectId!]!.frontInfo!.cost!
    );
    return (plays[0] ?? choices.find(({ command }) => command.type === GameCommandType.END_PHASE))!
      .selection;
  }
  return choices[0]!.selection;
}

describe('frozen Muse mirror through AI decision references', () => {
  it('covers every starter ability by base identity, including an unlisted rarity suffix', () => {
    const expectedCounts = [2, 1, 2, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1];
    for (let index = 0; index < expectedCounts.length; index++) {
      const base = `PL!-sd1-${String(index + 1).padStart(3, '0')}`;
      const original = getCardAbilityDefinitionsForCardCode(`${base}-SD`);
      expect(original, base).toHaveLength(expectedCounts[index]!);
      for (const definition of original) expect(definition.baseCardCodes).toContain(base);
      for (const rarity of ['P+', 'FUTURE'])
        expect(getCardAbilityDefinitionsForCardCode(`${base}-${rarity}`), base).toEqual(original);
    }
  });

  it.each([
    { aiSeat: 0, variant: false },
    { aiSeat: 1, variant: false },
    { aiSeat: 0, variant: true },
    { aiSeat: 1, variant: true },
  ])(
    'reaches a natural RULES end (AI seat $aiSeat, synthetic rarity $variant)',
    ({ aiSeat, variant }) => {
      let seed = 0x12345678;
      const tape = new DecisionTapeRandomSource(
        'ai-muse-rules-v1',
        Array.from({ length: 20_000 }, () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed;
        })
      );
      let now = 1000;
      const session = createGameSession({
        gameMode: GameMode.DEBUG,
        now: () => now,
        randomInt: tape.nextInt,
      });
      const players = aiSeat === 0 ? ['ai', 'human'] : ['human', 'ai'];
      const frozen = readFrozenMuseDeck();
      // The extra runs test the rarity invariant; the two original runs always use the unmodified asset.
      const deck = variant
        ? {
            ...frozen.deck,
            mainDeck: frozen.deck.mainDeck.map((card) => ({
              ...card,
              cardCode: `${getBaseCardCode(card.cardCode)}-FUTURE`,
            })),
          }
        : frozen.deck;
      session.createGame(`muse-ai-${aiSeat}`, players[0]!, players[0]!, players[1]!, players[1]!);
      expect(session.initializeGame(deck, deck).success).toBe(true);
      const purposes = new Set<string>();
      const commands: string[] = [];
      const effectSteps = new Set<string>();
      const lastRuleInput = new Map<string, string>();
      for (let step = 0; step < 1200 && !session.state!.isEnded; step++) {
        const queries = players.map((playerId) =>
          buildAiBattleDecision(session.state!, playerId, session.getPlayerViewState(playerId)!)
        );
        const index = queries.findIndex((query) => query.kind === 'DECISION');
        if (index < 0) {
          const time = queries.find((query) => query.kind === 'WAITING_FOR_TIME');
          if (time?.kind === 'WAITING_FOR_TIME') {
            now = time.deadlineAt;
            continue;
          }
          throw new Error(
            JSON.stringify({
              step,
              queries,
              phase: session.state!.currentPhase,
              subPhase: session.state!.currentSubPhase,
              effect: session.state!.activeEffect?.stepId,
            })
          );
        }
        const query = queries[index]!;
        if (query.kind !== 'DECISION') throw new Error('Expected decision');
        const decision = query.decision;
        if (decision.input.purpose === 'RULE_CONFIRM') {
          const input = JSON.stringify(decision.input);
          expect(input, `Rule confirmation made no progress: ${players[index]}`).not.toBe(
            lastRuleInput.get(players[index]!)
          );
          lastRuleInput.set(players[index]!, input);
        }
        purposes.add(decision.input.purpose);
        if (session.state!.activeEffect) effectSteps.add(session.state!.activeEffect.stepId);
        const selection = parseAiBattleResponse(
          decision,
          JSON.stringify({ selection: choose(decision) })
        ).selection;
        for (const command of materializeAiDecisionCommands(decision, selection, now)) {
          const result = session.executeCommand(command);
          expect(
            result.success,
            JSON.stringify({
              error: result.error,
              step,
              purpose: decision.input.purpose,
              phase: session.state!.currentPhase,
              subPhase: session.state!.currentSubPhase,
              command,
            })
          ).toBe(true);
          commands.push(command.type);
        }
        now += 10;
      }
      expect(
        session.state!.isEnded,
        JSON.stringify({
          turn: session.state!.turnCount,
          purposes: [...purposes],
          steps: [...effectSteps],
          successCounts: session.state!.players.map((player) => player.successZone.cardIds.length),
          lastCommands: commands.slice(-8),
          phase: session.state!.currentPhase,
          subPhase: session.state!.currentSubPhase,
        })
      ).toBe(true);
      expect(session.state!.manualOperationMode).toBe('RULES');
      expect([GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW]).toContain(
        session.state!.endInfo?.reason
      );
      expect(commands).toContain(GameCommandType.MULLIGAN);
      expect(commands).toContain(GameCommandType.PLAY_MEMBER_TO_SLOT);
      expect(commands).toContain(GameCommandType.SET_LIVE_CARD);
      expect(commands).toContain(GameCommandType.SUBMIT_JUDGMENT);
      expect(commands).toContain(GameCommandType.SELECT_SUCCESS_LIVE);
      expect(purposes).toContain('EFFECT');
      expect(purposes).toContain('PUBLIC_DISPLAY');
      expect(session.state!.players.some((player) => player.successZone.cardIds.length >= 3)).toBe(
        true
      );
    },
    30_000
  );
});
