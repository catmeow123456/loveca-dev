import { describe, expect, it } from 'vitest';
import { HS_BP8_017_LIVE_START_RETURN_SELF_DISCARD_TARGET_LIVE_SCORE_REQUIREMENT_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { emitGameEvent, updatePlayer } from '../../src/domain/entities/game';
import { createEnterLiveZoneEvent } from '../../src/domain/events/game-events';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  addLiveModifier,
  getLiveCardRequirementModifiers,
  getLiveCardScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  FaceState,
  HeartColor,
  OrientationState,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  choose,
  gameWithCards,
  live,
  member,
  pending,
  P1,
  start,
} from '../helpers/card-effect-zone-fixture';

function setup(
  options: {
    readonly otherGroup?: string;
    readonly liveCount?: number;
    readonly hasHand?: boolean;
  } = {}
) {
  const cards = [
    live('bloom', { cardCode: 'PL!HS-bp8-017-SECL' }),
    live('target', { groupNames: [options.otherGroup ?? '蓮ノ空'] }),
    live('target2'),
    member('hand'),
  ];
  return updatePlayer(gameWithCards(cards), P1, (p) => ({
    ...p,
    liveZone: {
      ...p.liveZone,
      cardIds: ['bloom', 'target', 'target2'].slice(0, options.liveCount ?? 2),
      cardStates: new Map(
        ['bloom', 'target', 'target2'].map((id) => [
          id,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
        ])
      ),
    },
    hand: { ...p.hand, cardIds: options.hasHand ? ['hand'] : [] },
  }));
}
describe('PL!HS-bp8-017 分数0「Bloom the smile, Bloom the dream!」', () => {
  it('returns before choosing a mandatory discard, permits discarding itself, then modifies one remaining LIVE', () => {
    const before = addLiveModifier(setup(), {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: 'bloom',
      countDelta: 9,
      abilityId: 'old',
    });
    const started = start(before, ABILITY, 'bloom');
    expect(started.players[0].liveZone.cardIds).toEqual(['target']);
    expect(started.players[0].hand.cardIds).toEqual(['bloom']);
    expect(started.liveResolution.liveModifiers).toEqual([]);
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: ['bloom'],
      canSkipSelection: false,
      confirmSelectionLabel: '放置入休息室',
    });
    expect(
      started.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_HAND &&
          event.fromZone === ZoneType.LIVE_ZONE
      )
    ).toBe(true);
    expect(choose(started, null)).toBe(started);
    const targeted = choose(started, 'bloom');
    expect(targeted.players[0].waitingRoom.cardIds).toEqual(['bloom']);
    expect(targeted.activeEffect).toMatchObject({
      selectableCardIds: ['target'],
      canSkipSelection: false,
      confirmSelectionLabel: '增加分数及必要HEART',
    });
    expect(targeted.liveResolution.liveModifiers).toEqual([]);
    const done = choose(targeted, 'target');
    expect(getLiveCardScoreModifier(done.liveResolution, 'target')).toBe(1);
    expect(getLiveCardRequirementModifiers(done.liveResolution, 'target')).toEqual([
      { color: HeartColor.RAINBOW, countDelta: 2 },
    ]);
    expect(done.liveResolution.liveModifiers).toHaveLength(2);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });
  it('can discard a pre-existing hand and rejects forged or stale input without rewinding the return', () => {
    const started = start(setup({ hasHand: true, liveCount: 3 }), ABILITY, 'bloom');
    expect(choose(started, 'target')).toBe(started);
    const stale = updatePlayer(started, P1, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['bloom'] },
    }));
    expect(choose(stale, 'hand')).toBe(stale);
    const target = choose(started, 'hand');
    expect(target.players[0].hand.cardIds).toEqual(['bloom']);
    expect(choose(target, 'bloom')).toBe(target);
    const done = choose(target, 'target2');
    expect(
      done.liveResolution.liveModifiers.every(
        (m) => 'liveCardId' in m && m.liveCardId === 'target2'
      )
    ).toBe(true);
  });
  it.each([{ liveCount: 1 }, { otherGroup: 'Aqours' }])(
    'does not return or discard when its whole LIVE condition fails: %j',
    (options) => {
      let done = start(setup(options), ABILITY, 'bloom');
      if (done.activeEffect) done = choose(done);
      expect(done.players[0].hand.cardIds).toEqual([]);
      expect(done.players[0].waitingRoom.cardIds).toEqual([]);
      expect(done.players[0].liveZone.cardIds).toContain('bloom');
      expect(done.liveResolution.liveModifiers).toEqual([]);
    }
  );
  it('retains the return and discard if the remaining target leaves before selection', () => {
    const targeted = choose(start(setup(), ABILITY, 'bloom'), 'bloom');
    const stale = updatePlayer(targeted, P1, (p) => ({
      ...p,
      liveZone: { ...p.liveZone, cardIds: [] },
    }));
    const done = choose(stale, 'target');
    expect(done.players[0].waitingRoom.cardIds).toEqual(['bloom']);
    expect(done.liveResolution.liveModifiers).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });
  it('cannot return a reentered LIVE source using an old pending invocation', () => {
    const first = createEnterLiveZoneEvent('bloom', ZoneType.HAND, P1, P1, FaceState.FACE_UP);
    let game = emitGameEvent(setup(), first);
    const ability = { ...pending(ABILITY, 'bloom'), eventIds: [first.eventId] };
    game = emitGameEvent(
      game,
      createEnterLiveZoneEvent('bloom', ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    let done = resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
    if (done.activeEffect) done = choose(done);
    expect(done.players[0].liveZone.cardIds).toEqual(['bloom', 'target']);
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.liveResolution.liveModifiers).toEqual([]);
  });
  it('does not apply either modifier to the target LIVE after it reenters as a new rules object', () => {
    const targeted = choose(start(setup(), ABILITY, 'bloom'), 'bloom');
    const reentered = emitGameEvent(
      targeted,
      createEnterLiveZoneEvent('target', ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    const done = choose(reentered, 'target');
    expect(done.liveResolution.liveModifiers).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['bloom']);
    expect(done.activeEffect).toBeNull();
  });
});
