import { describe, expect, it } from 'vitest';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { N_BP8_029_LIVE_SUCCESS_RED_REMAINING_HEART_SCORE_CLEAR_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { returnLiveZoneCardToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import { collectRemainingHeartAllocationPreferences } from '../../src/application/effects/remaining-heart-allocation';
import {
  getRemainingHeartCount,
  rebalanceRemainingHeartColorForPlayer,
} from '../../src/application/effects/remaining-hearts';
import { GameService } from '../../src/application/game-service';
import {
  createCardInstance,
  createHeartRequirement,
  type HeartIcon,
} from '../../src/domain/entities/card';
import {
  emitGameEvent,
  getCardById,
  registerCards,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnterLiveZoneEvent } from '../../src/domain/events/game-events';
import { collectLiveModifiers, getLiveCardScoreModifier, getPlayerLiveScoreModifier } from '../../src/domain/rules/live-modifiers';
import { HeartPool } from '../../src/domain/value-objects/heart';
import {
  CardType,
  FaceState,
  HeartColor,
  SubPhase,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import { createOctober29DraftCard } from '../helpers/october-29-draft-effects';
import { liveZone, member, P1, P2, stage } from '../helpers/modifier-workflow-fixtures';
import {
  confirmOctober29Live as confirm,
  october29LiveGame,
  queueOctober29Live as queue,
  resolveOctober29Live as resolve,
} from '../helpers/october-29-live-workflow';

function setup(red: number, extra: readonly HeartIcon[] = []) {
  const { game, source } = october29LiveGame('PL!N-bp8-029');
  const hearts = [{ color: HeartColor.RED, count: red }, ...extra].filter((h) => h.count > 0);
  return {
    source,
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerRemainingHearts: new Map([
          [P1, hearts],
          [P2, [{ color: HeartColor.RED, count: 7 }]],
        ]),
        playerLiveJudgmentHearts: new Map([
          [
            P1,
            [
              { color: HeartColor.RED, count: red + 2 },
              { color: HeartColor.RAINBOW, count: 2 },
            ],
          ],
        ]),
      },
    },
  };
}

describe('PL!N-bp8-029 分数1「Circle of Love」', () => {
  it.each(['PL!N-bp8-029', 'PL!S-bp5-020-L'])('clearing via %s removes the opponent Mari continuous bonus by delta before final comparison', (code) => {
    const source = code === 'PL!N-bp8-029' ? createOctober29DraftCard(code, P1, 'source-live') :
      createCardInstance({ cardType: CardType.LIVE, cardCode: code, name: 'synthetic-Landing', score: 1, requirements: createHeartRequirement({}) }, P1, 'source-live');
    const opponent = createOctober29DraftCard('PL!N-bp8-029', P2, 'opponent-live');
    const mari = member('PL!S-bp5-008-R', 'mari', P2);
    let { game } = setup(6);
    game = liveZone(stage(registerCards(game, [source, opponent, mari]), [mari], P2), opponent);
    const preview = resolve(queue(game, true));
    const opponentDraft = code === 'PL!N-bp8-029' ? 4 : 2;
    const judged = { ...preview, liveResolution: { ...preview.liveResolution,
      liveResults: new Map([...preview.liveResolution.liveResults, ['opponent-live', true]]),
      playerScores: new Map([[P1, 1], [P2, opponentDraft]]) } };
    expect(getPlayerLiveScoreModifier(judged.liveResolution, P2, collectLiveModifiers(judged))).toBe(1);
    const done = confirm(judged);
    expect(getPlayerLiveScoreModifier(done.liveResolution, P2, collectLiveModifiers(done))).toBe(0);
    expect(done.liveResolution.playerScores.get(P2)).toBe(opponentDraft - 1);
    const winner = new GameService().resolveLiveWinner({ ...done, liveResolution: { ...done.liveResolution, scoreConfirmedBy: [P1, P2] } });
    expect(winner.gameState.liveResolution.liveWinnerIds).toEqual([P1]);
  });
  it('synchronizes the final winning score after clearing its resource', () => {
    let { game } = setup(6);
    const opponent = createOctober29DraftCard('PL!N-bp8-029', P2, 'opponent-live');
    game = liveZone(registerCards(game, [opponent]), opponent);
    const preview = resolve(queue(game, true));
    const done = confirm({
      ...preview,
      liveResolution: {
        ...preview.liveResolution,
        liveResults: new Map([...preview.liveResolution.liveResults, ['opponent-live', true]]),
        playerScores: new Map([
          [P1, 1],
          [P2, 3],
        ]),
      },
    });
    const result = new GameService().resolveLiveWinner({
      ...done,
      liveResolution: {
        ...done.liveResolution,
        scoreConfirmedBy: [P1, P2],
      },
    });
    expect(result.gameState.liveResolution.playerScores.get(P1)).toBe(4);
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual([P1]);
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 12])(
    'scores red pairs up to +3 then clears every surplus color (red %s)',
    (red) => {
      const extra = [
        { color: HeartColor.RAINBOW, count: 3 },
        { color: HeartColor.GRAY, count: 2 },
        { color: HeartColor.BLUE, count: 1 },
      ];
      const { game } = setup(red, extra);
      const preview = resolve(queue(game, true));
      expect(preview.activeEffect).toMatchObject({
        abilityId: ABILITY,
        metadata: { confirmOnlyPendingAbility: true },
      });
      expect(preview.liveResolution.playerRemainingHearts.get(P1)).toHaveLength(red > 0 ? 4 : 3);
      expect(getLiveCardScoreModifier(preview.liveResolution, 'source-live')).toBe(0);
      const state = confirm(preview);
      expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(
        Math.min(3, Math.floor(red / 2))
      );
      expect(state.liveResolution.playerScores.get(P1)).toBe(1 + Math.min(3, Math.floor(red / 2)));
      expect(state.liveResolution.playerRemainingHearts.get(P1)).toEqual([]);
      expect(getRemainingHeartCount(state, P2, HeartColor.RED)).toBe(7);
      expect(
        rebalanceRemainingHeartColorForPlayer(state, P1, HeartColor.RED, 6).rebalancedCount
      ).toBe(0);
      expect(state.pendingAbilities).toEqual([]);
      expect(state.activeEffect).toBeNull();
      const action = state.actionHistory.find(
        (a) => a.payload.step === 'RED_REMAINING_HEART_SCORE_THEN_LOSE_ALL'
      );
      expect(action?.payload.lostTotalCount).toBe(red + 6);
      expect(state.eventLog).toEqual(preview.eventLog);
    }
  );

  it('uses the current surplus after preview and rejects replay of the old confirmation', () => {
    const { game } = setup(6);
    const preview = resolve(queue(game, true));
    const changed = {
      ...preview,
      liveResolution: {
        ...preview.liveResolution,
        playerRemainingHearts: new Map([[P1, [{ color: HeartColor.RED, count: 2 }]]]),
      },
    };
    const state = confirm(changed);
    expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(1);
    expect(confirmActiveEffectStep(state, P1, preview.activeEffect!.id)).toBe(state);
  });

  it('keeps the independent loss instruction when source LIVE left or re-entered; no new object receives score', () => {
    const { game } = setup(6);
    const preview = resolve(queue(game, true));
    const left = returnLiveZoneCardToHandForPlayer(preview, P1, 'source-live')!.gameState;
    const reentered = emitGameEvent(
      liveZone(left, getCardById(left, 'source-live')!),
      createEnterLiveZoneEvent('source-live', ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    for (const candidate of [left, reentered]) {
      const state = confirm(candidate);
      expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(0);
      expect(state.liveResolution.playerScores.get(P1)).toBe(1);
      expect(state.liveResolution.playerRemainingHearts.get(P1)).toEqual([]);
    }
  });

  it('expands only this card to red thresholds 2/4/6 while preserving old scalar preferences and their order', () => {
    let { game } = setup(0);
    const pink = createCardInstance(
      {
        cardType: CardType.LIVE,
        cardCode: 'PL!-bp4-023-L',
        name: 'synthetic-pink-pref',
        score: 1,
        requirements: createHeartRequirement({}),
      },
      P1,
      'pink'
    );
    const green = createCardInstance({ ...pink.data, cardCode: 'PL!N-bp3-027-L' }, P1, 'green');
    const stageMember = member('SYN-NIJI', 'niji');
    game = registerCards(game, [pink, green, stageMember]);
    const prefs = collectRemainingHeartAllocationPreferences(game, P1, ['source-live', 'pink']);
    expect(prefs).toEqual([
      { color: HeartColor.RED, minCount: 2 },
      { color: HeartColor.RED, minCount: 4 },
      { color: HeartColor.RED, minCount: 6 },
      { color: HeartColor.PINK, minCount: 1 },
    ]);
    expect(collectRemainingHeartAllocationPreferences(game, P1, ['green'])).toEqual([]);
    const pool = HeartPool.fromHeartIcons([
      { color: HeartColor.RED, count: 8 },
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.GRAY, count: 2 },
    ]);
    const remaining = pool.consume(
      createHeartRequirement({ [HeartColor.RED]: 2, [HeartColor.RAINBOW]: 2 }),
      { remainingHeartPreferences: prefs }
    )!;
    expect(remaining.getColorCount(HeartColor.RED)).toBe(6);
    expect(remaining.getColorCount(HeartColor.PINK)).toBe(1);
  });

  it.each([2, 4, 6])(
    'the actual automatic judgment preserves %s red without recoloring ALL or changing requirements',
    (red) => {
      const own = member('SYN-AUTO', 'auto', P1, {
        blade: 0,
        hearts: [
          { color: HeartColor.RED, count: red + 2 },
          { color: HeartColor.GRAY, count: 1 },
        ],
      });
      const { game } = october29LiveGame('PL!N-bp8-029', [own]);
      const result = new GameService().processAction(
        {
          ...game,
          currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
          currentTurnType: TurnType.FIRST_PLAYER_TURN,
        },
        {
          type: 'CONFIRM_JUDGMENT',
          playerId: P1,
          judgmentResults: new Map(),
          timestamp: Date.now(),
        }
      );
      expect(result.success).toBe(true);
      expect(result.gameState.liveResolution.liveResults.get('source-live')).toBe(true);
      expect(result.gameState.liveResolution.playerRemainingHearts.get(P1)).toEqual([
        { color: HeartColor.RED, count: red },
      ]);
    }
  );

  it('ordered two-source resolution reads zero after the first clear and preserves the first score', () => {
    let { game } = setup(6, [{ color: HeartColor.RAINBOW, count: 1 }]);
    const second = createOctober29DraftCard('PL!N-bp8-029', P1, 'second-live');
    game = liveZone(registerCards(game, [second]), second);
    const order = resolve(queue(game, true, ['source-live', 'second-live']));
    const manual = confirm(order, 'second-live');
    expect(manual.activeEffect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: 'second-live',
      metadata: { confirmOnlyPendingAbility: true },
    });
    const all = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(all.pendingAbilities).toEqual([]);
    expect(all.activeEffect).toBeNull();
    expect(getLiveCardScoreModifier(all.liveResolution, 'source-live')).toBe(3);
    expect(getLiveCardScoreModifier(all.liveResolution, 'second-live')).toBe(0);
    expect(all.liveResolution.playerScores.get(P1)).toBe(4);
  });

  it('shares the live surplus pool with a later zero-surplus ability and leaves both effects in the same check timing', () => {
    let { game } = setup(2);
    const bonus = createCardInstance(
      {
        cardType: CardType.LIVE,
        cardCode: 'PL!-bp3-025-L',
        name: 'synthetic-zero-surplus',
        score: 1,
        requirements: createHeartRequirement({}),
      },
      P1,
      'zero'
    );
    game = liveZone(registerCards(game, [bonus]), bonus);
    const order = resolve(queue(game, true, ['source-live', 'zero']));
    const state = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(1);
    expect(getLiveCardScoreModifier(state.liveResolution, 'zero')).toBe(1);
    expect(state.pendingAbilities).toEqual([]);
  });
});
