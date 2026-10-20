import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PR_034_AUTO_RELAY_LOW_COST_TARGET_GAIN_BLADE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import {
  addLiveModifier,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { choose, gameWithCards, member, pending, P1 } from '../helpers/card-effect-zone-fixture';

function setup(
  cost = 11,
  replacingCardId: string | null = 'replacement',
  toZone = ZoneType.WAITING_ROOM
) {
  let game = updatePlayer(
    gameWithCards([
      member('ren', { cardCode: 'PL!SP-PR-034-PR' }),
      member('replacement', { cost }),
    ]),
    P1,
    (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: ['ren'] },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'replacement', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    })
  );
  game = emitGameEvent(game, {
    eventId: 'relay-leave',
    eventType: TriggerCondition.ON_LEAVE_STAGE,
    timestamp: 1,
    triggerPlayerId: P1,
    cardInstanceId: 'ren',
    fromZone: ZoneType.MEMBER_SLOT,
    toZone,
    fromSlot: SlotPosition.CENTER,
    ownerId: P1,
    controllerId: P1,
    ...(replacingCardId ? { replacingCardId } : {}),
  });
  return {
    ...game,
    pendingAbilities: [
      { ...pending(ABILITY, 'ren', TriggerCondition.ON_LEAVE_STAGE), eventIds: ['relay-leave'] },
    ],
  };
}
function reward(game: GameState) {
  return game.liveResolution.liveModifiers.filter((m) => m.abilityId === ABILITY);
}
function reentered(game: GameState) {
  return emitGameEvent(game, {
    eventId: 'replacement-leave',
    eventType: TriggerCondition.ON_LEAVE_STAGE,
    timestamp: 2,
    triggerPlayerId: P1,
    cardInstanceId: 'replacement',
    fromZone: ZoneType.MEMBER_SLOT,
    toZone: ZoneType.WAITING_ROOM,
    fromSlot: SlotPosition.CENTER,
    ownerId: P1,
    controllerId: P1,
  });
}
describe('PL!SP-PR-034 费用9「叶月恋」', () => {
  it.each([10, 11, 12])('uses the precise relay target and effective cost <=11 (%i)', (cost) => {
    const done = resolvePendingCardEffects(setup(cost)).gameState;
    expect(reward(done)).toHaveLength(cost <= 11 ? 1 : 0);
    if (cost <= 11)
      expect(reward(done)[0]).toMatchObject({
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        sourceCardId: 'ren',
        targetMemberCardId: 'replacement',
        countDelta: 2,
      });
    expect(getMemberEffectiveBladeCount(done, P1, 'replacement')).toBe(cost <= 11 ? 3 : 1);
    expect(done.pendingAbilities).toEqual([]);
  });
  it.each([
    [12, -1, true],
    [11, 1, false],
  ])('uses a changed effective cost rather than printed cost (%i,%i)', (cost, delta, earns) => {
    const game = addLiveModifier(setup(cost), {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: 'replacement',
      countDelta: delta,
      sourceCardId: 'ren',
    });
    expect(reward(resolvePendingCardEffects(game).gameState)).toHaveLength(earns ? 1 : 0);
  });
  it('does not reward ordinary leaving, wrong event targets, different destinations or a reentered replacement', () => {
    for (const game of [
      setup(9, null),
      setup(9, 'unrelated'),
      setup(9, 'replacement', ZoneType.HAND),
      reentered(setup()),
    ])
      expect(reward(resolvePendingCardEffects(game).gameState)).toEqual([]);
    const wrongEvent = setup();
    expect(
      reward(
        resolvePendingCardEffects({
          ...wrongEvent,
          pendingAbilities: [{ ...wrongEvent.pendingAbilities[0], eventIds: ['missing'] }],
        }).gameState
      )
    ).toEqual([]);
  });
  it('rechecks effective cost and replacement lifecycle after the manual confirmation window opens', () => {
    const game = setup();
    const original = game.pendingAbilities[0];
    const ordering = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [original, { ...original, id: 'second', eventIds: ['missing'] }],
    }).gameState;
    const opened = confirmActiveEffectStep(
      ordering,
      P1,
      ordering.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      original.id
    );
    expect(opened.activeEffect?.effectText).toContain('条件满足');
    const costChanged = addLiveModifier(opened, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: 'replacement',
      countDelta: 1,
    });
    expect(reward(choose(costChanged))).toEqual([]);
    expect(reward(choose(reentered(opened)))).toEqual([]);
  });
});
