import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  type BladeHearts,
  type CardInstance,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createCheerEvent,
  createEnterLiveZoneEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  PL_BP8_022_LIVE_SUCCESS_FIVE_YELLOW_CHEER_THIS_LIVE_SCORE_ABILITY_ID as HELLO,
  PYHN_AD2_001_LIVE_SUCCESS_TWO_NO_BLADE_CHEER_THIS_LIVE_SCORE_ABILITY_ID as DEEP,
} from '../../src/application/card-effects/ability-ids';
import { createNovember02DraftCard } from '../helpers/november-02-draft-effects';
import {
  P1,
  P2,
  gameWith,
  liveZone,
  start,
  sessionFor,
  setState,
  confirm,
} from '../helpers/modifier-workflow-fixtures';

function cheer(id: string, hearts: BladeHearts | undefined = [], owner = P1): CardInstance {
  const data: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: `TEST-${id}`,
    name: id,
    cost: 1,
    blade: 1,
    hearts: [],
    bladeHearts: hearts,
  };
  return createCardInstance(data, owner, id);
}
const yellow = [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW }] as const;

function setup(base: string, cards: readonly CardInstance[]) {
  const source = createNovember02DraftCard(base, P1, 'source');
  let game = liveZone(gameWith([source, ...cards]), source);
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: cards
        .filter((card) => card.ownerId === P1)
        .map((card) => card.instanceId),
      playerScores: new Map([[P1, 10]]),
    },
  };
  game = emitGameEvent(
    game,
    createCheerEvent(
      P1,
      cards.map((card) => card.instanceId),
      cards.length
    )
  );
  return { game, source };
}
function pending(game: GameState, source: CardInstance, abilityId: string) {
  return sessionFor(start(game, source, abilityId, TriggerCondition.ON_LIVE_SUCCESS));
}
function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter((modifier) => modifier.kind === 'SCORE');
}

describe('current-LIVE cheer condition → source LIVE score shared family', () => {
  it.each([4, 5, 6])('PL!-bp8-022 分数3「Hello，细数繁星」checks %i yellow cards', (count) => {
    const { game, source } = setup(
      'PL!-bp8-022',
      Array.from({ length: count }, (_, index) => cheer(`yellow-${index}`, yellow))
    );
    const session = pending(game, source, HELLO);
    expect(session.state!.activeEffect?.effectText).toContain(`有${count}张`);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(10);
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(count >= 5 ? 11 : 10);
    expect(scoreModifiers(session.state!)).toHaveLength(Number(count >= 5));
    if (count >= 5)
      expect(scoreModifiers(session.state!)[0]).toMatchObject({
        liveCardId: source.instanceId,
        sourceCardId: source.instanceId,
        abilityId: HELLO,
        countDelta: 1,
      });
  });
  it('counts cards once, excludes ALL/DRAW/SCORE, opponent cards and noncurrent history', () => {
    const cards = [
      cheer('triple', [...yellow, ...yellow, ...yellow]),
      cheer('all', [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }]),
      cheer('draw', [{ effect: BladeHeartEffect.DRAW }]),
      cheer('score', [{ effect: BladeHeartEffect.SCORE }]),
      cheer('opponent', yellow, P2),
      cheer('old', yellow),
    ];
    const { game, source } = setup('PL!-bp8-022', cards);
    const current = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: ['triple', 'all', 'draw', 'score', 'opponent'],
      },
    };
    const session = pending(current, source, HELLO);
    expect(session.state!.activeEffect?.effectText).toContain('有1张');
    expect(confirm(session, P1).success).toBe(true);
    expect(scoreModifiers(session.state!)).toEqual([]);
  });
  it('uses effective colors in both directions and rereads them after confirmation opens', () => {
    const { game, source } = setup(
      'PL!-bp8-022',
      Array.from({ length: 5 }, (_, index) => cheer(`y-${index}`, yellow))
    );
    const session = pending(game, source, HELLO);
    setState(
      session,
      addLiveModifier(session.state!, {
        kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
        playerId: P1,
        fromColors: [HeartColor.YELLOW],
        toColor: HeartColor.PURPLE,
        sourceCardId: 'replace',
        abilityId: 'replace',
      })
    );
    expect(confirm(session, P1).success).toBe(true);
    expect(scoreModifiers(session.state!)).toEqual([]);
    const purple = Array.from({ length: 5 }, (_, index) =>
      cheer(`p-${index}`, [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE }])
    );
    const next = setup('PL!-bp8-022', purple);
    const reverse = pending(
      addLiveModifier(next.game, {
        kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
        playerId: P1,
        fromColors: [HeartColor.PURPLE],
        toColor: HeartColor.YELLOW,
        sourceCardId: 'replace',
        abilityId: 'replace',
      }),
      next.source,
      HELLO
    );
    expect(confirm(reverse, P1).success).toBe(true);
    expect(reverse.state!.liveResolution.playerScores.get(P1)).toBe(11);
  });
  it('keeps moved historical cards and includes an already resolved additional cheer batch', () => {
    const cards = Array.from({ length: 5 }, (_, index) => cheer(`y-${index}`, yellow));
    const { game, source } = setup('PL!-bp8-022', cards);
    const normalOnly = emitGameEvent(
      { ...game, eventLog: [] },
      createCheerEvent(P1, ['y-0', 'y-1', 'y-2', 'y-3'], 4)
    );
    const withAdditional = emitGameEvent(
      normalOnly,
      createCheerEvent(P1, ['y-4'], 1, { additional: true })
    );
    expect(withAdditional.resolutionZone.cardIds).toEqual([]);
    const session = pending(withAdditional, source, HELLO);
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(11);
  });
  it.each([0, 1, 2, 3])(
    'PYHN-ad2-001 分数6「Deep Blue」counts %i no-Blade-Heart cards',
    (count) => {
      const { game, source } = setup(
        'PYHN-ad2-001',
        Array.from({ length: count }, (_, index) =>
          cheer(`none-${index}`, index % 2 ? undefined : [])
        )
      );
      const session = pending(game, source, DEEP);
      expect(confirm(session, P1).success).toBe(true);
      expect(session.state!.liveResolution.playerScores.get(P1)).toBe(count >= 2 ? 11 : 10);
      expect(scoreModifiers(session.state!)).toHaveLength(Number(count >= 2));
    }
  );
  it.each([BladeHeartEffect.HEART, BladeHeartEffect.DRAW, BladeHeartEffect.SCORE])(
    'Deep Blue excludes any real %s Blade Heart',
    (effect) => {
      const hearts: BladeHearts =
        effect === BladeHeartEffect.HEART
          ? [{ effect, heartColor: HeartColor.GRAY }]
          : [{ effect }];
      const { game, source } = setup('PYHN-ad2-001', [cheer('one', []), cheer('icon', hearts)]);
      const session = pending(game, source, DEEP);
      expect(confirm(session, P1).success).toBe(true);
      expect(scoreModifiers(session.state!)).toEqual([]);
    }
  );
  it('Deep Blue counts ENERGY cards without Blade Hearts and ignores invalid null', () => {
    const energy = createCardInstance(
      { cardType: CardType.ENERGY, cardCode: 'TEST-ENERGY', name: 'energy' },
      P1,
      'energy'
    );
    const invalid = cheer('invalid', null as unknown as MemberCardData['bladeHearts']);
    const { game, source } = setup('PYHN-ad2-001', [cheer('none'), energy, invalid]);
    const session = pending(game, source, DEEP);
    expect(session.state!.activeEffect?.effectText).toContain('有2张');
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(11);
  });
  it('normalizes a repeated resolution without increasing either modifier or judged score twice', () => {
    const { game, source } = setup('PYHN-ad2-001', [cheer('one'), cheer('two')]);
    const session = pending(game, source, DEEP);
    expect(confirm(session, P1).success).toBe(true);
    const again = pending(session.state!, source, DEEP);
    expect(confirm(again, P1).success).toBe(true);
    expect(scoreModifiers(again.state!)).toHaveLength(1);
    expect(again.state!.liveResolution.playerScores.get(P1)).toBe(11);
  });
  it('enqueues from the actual LIVE_SUCCESS event and refuses to reward a new lifecycle through an old pending', () => {
    const { game, source } = setup('PYHN-ad2-001', [cheer('one'), cheer('two')]);
    const entered = emitGameEvent(
      game,
      createEnterLiveZoneEvent(source.instanceId, ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    const success = createLiveSuccessEvent(P1, [source.instanceId], 6);
    const queued = enqueueTriggeredCardEffects(
      emitGameEvent(entered, success),
      [TriggerCondition.ON_LIVE_SUCCESS],
      { liveSuccessEvents: [success] }
    );
    expect(queued.pendingAbilities).toHaveLength(1);
    const session = sessionFor(resolvePendingCardEffects(queued).gameState);
    const reentered = emitGameEvent(
      session.state!,
      createEnterLiveZoneEvent(source.instanceId, ZoneType.WAITING_ROOM, P1, P1, FaceState.FACE_UP)
    );
    setState(
      session,
      addLiveModifier(reentered, {
        kind: 'SCORE',
        playerId: P1,
        liveCardId: source.instanceId,
        sourceCardId: source.instanceId,
        abilityId: DEEP,
        countDelta: 1,
      })
    );
    expect(confirm(session, P1).success).toBe(true);
    expect(scoreModifiers(session.state!)).toHaveLength(1);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(10);
  });
  it('does not apply a self-score reward after the captured LIVE leaves or turns face down', () => {
    for (const leave of [true, false]) {
      const { game, source } = setup('PYHN-ad2-001', [cheer('one'), cheer('two')]);
      const session = pending(game, source, DEEP);
      setState(
        session,
        updatePlayer(session.state!, P1, (player) => ({
          ...player,
          liveZone: {
            ...player.liveZone,
            cardIds: leave ? [] : player.liveZone.cardIds,
            cardStates: leave
              ? new Map()
              : new Map([
                  [
                    source.instanceId,
                    {
                      ...player.liveZone.cardStates.get(source.instanceId)!,
                      face: FaceState.FACE_DOWN,
                    },
                  ],
                ]),
          },
        }))
      );
      expect(confirm(session, P1).success).toBe(true);
      expect(scoreModifiers(session.state!)).toEqual([]);
    }
  });
  it.each([false, true])(
    'binds both song sources independently with ordered resolution = %s',
    (ordered) => {
      const cards = [
        ...Array.from({ length: 5 }, (_, index) => cheer(`y-${index}`, yellow)),
        cheer('none-1'),
        cheer('none-2'),
      ];
      const { game, source } = setup('PL!-bp8-022', cards);
      const deep = createNovember02DraftCard('PYHN-ad2-001', P1, 'deep');
      const second = liveZone(
        { ...game, cardRegistry: new Map([...game.cardRegistry, [deep.instanceId, deep]]) },
        deep
      );
      const event = createLiveSuccessEvent(P1, [source.instanceId, deep.instanceId], 9);
      const queued = enqueueTriggeredCardEffects(
        emitGameEvent(second, event),
        [TriggerCondition.ON_LIVE_SUCCESS],
        { liveSuccessEvents: [event] }
      );
      const session = sessionFor(resolvePendingCardEffects(queued).gameState);
      expect(session.state!.activeEffect?.canResolveInOrder).toBe(true);
      const effect = session.state!.activeEffect!;
      const selected = ordered ? undefined : effect.selectableCardIds?.[0];
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, effect.id, selected, undefined, ordered)
        ).success
      ).toBe(true);
      if (!ordered) {
        expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
        expect(confirm(session, P1).success).toBe(true);
        expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
        expect(confirm(session, P1).success).toBe(true);
      }
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.pendingAbilities).toEqual([]);
      expect(
        scoreModifiers(session.state!)
          .map((modifier) => (modifier.kind === 'SCORE' ? modifier.liveCardId : undefined))
          .sort()
      ).toEqual(['deep', 'source']);
      expect(session.state!.liveResolution.playerScores.get(P1)).toBe(12);
    }
  );
});
