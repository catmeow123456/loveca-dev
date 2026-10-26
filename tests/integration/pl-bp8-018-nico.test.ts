import { describe, expect, it } from 'vitest';
import { PL_BP8_018_LIVE_START_PAY_ONE_ENERGY_GAIN_TWO_BLADE_ABILITY_ID as NICO } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { updatePlayer } from '../../src/domain/entities/game';
import { emitGameEvent } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { FaceState, OrientationState, SlotPosition, ZoneType } from '../../src/shared/types/enums';
import { P1, setup, live, choose, pay, roundtrip } from '../helpers/october-26-member-workflow';

describe('PL!-bp8-018 费用4「矢泽日香（矢泽妮可）」shared energy Blade', () => {
  it('pays exactly one energy, gives the source two Blade, and continues', () => {
    const game = live(setup('PL!-bp8-018-N'));
    expect(game.activeEffect?.abilityId).toBe(NICO);
    expect(game.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    const done = pay(game);
    expect(done.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(getMemberEffectiveBladeCount(done, P1, 'source')).toBe(2);
    expect(done.actionHistory.find((a) => a.type === 'PAY_COST')?.payload.energyCardIds).toEqual([
      'energy-0',
    ]);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });
  it.each([false, true])(
    'declining or insufficient energy (%s) adds no payment or modifier',
    (insufficient) => {
      let game = setup('PL!-bp8-018-N');
      if (insufficient)
        game = updatePlayer(game, P1, (p) => ({
          ...p,
          energyZone: {
            ...p.energyZone,
            cardStates: new Map(
              p.energyZone.cardIds.map((id) => [
                id,
                { face: FaceState.FACE_UP, orientation: OrientationState.WAITING },
              ])
            ),
          },
        }));
      const done = choose(live(game));
      expect(done.actionHistory.filter((a) => a.type === 'PAY_COST')).toEqual([]);
      expect(done.liveResolution.liveModifiers.filter((m) => m.abilityId === NICO)).toEqual([]);
      expect(done.activeEffect).toBeNull();
    }
  );
  it('restores exact marked-energy selection and rejects duplicate, illegal, and stale selections', () => {
    const initial = setup('PL!-bp8-018-N');
    const game = roundtrip(
      pay(
        live({
          ...initial,
          energyActivePhaseSkips: [
            { playerId: P1, energyCardId: 'energy-1', sourceCardId: 'marker', abilityId: 'marker' },
          ],
        })
      )
    );
    expect(game.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    for (const ids of [['energy-1', 'energy-1'], ['not-energy']])
      expect(choose(game, undefined, ids)).toBe(game);
    const stale = updatePlayer(game, P1, (p) => ({
      ...p,
      energyZone: {
        ...p.energyZone,
        cardIds: p.energyZone.cardIds.filter((id) => id !== 'energy-1'),
      },
    }));
    expect(choose(stale, undefined, ['energy-1'])).toBe(stale);
    const done = choose(game, undefined, ['energy-1']);
    expect(done.players[0].energyZone.cardStates.get('energy-1')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.actionHistory.find((a) => a.type === 'PAY_COST')?.payload.energyCardIds).toEqual([
      'energy-1',
    ]);
  });
  it.each([false, true])(
    'old native invocation cannot reward a re-entered source (before starter: %s)',
    (beforeStarter) => {
      let game = live(setup('PL!-bp8-018-N'), false, !beforeStarter);
      game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        game,
        P1,
        'source',
        enqueueTriggeredCardEffects
      )!.gameState;
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        waitingRoom: {
          ...p.waitingRoom,
          cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'source'),
        },
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source', {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      }));
      game = emitGameEvent(
        game,
        createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
      );
      if (beforeStarter) game = resolvePendingCardEffects(game).gameState;
      game = pay(roundtrip(game));
      expect(game.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(game.liveResolution.liveModifiers.filter((m) => m.abilityId === NICO)).toEqual([]);
      expect(
        game.actionHistory.filter((a) => a.payload.abilityId === NICO).at(-1)?.payload
      ).toMatchObject({
        bladeBonus: 0,
        requestedBladeBonus: 2,
        reason: 'SOURCE_RULES_OBJECT_LEFT_STAGE',
      });
      expect(game.activeEffect).toBeNull();
    }
  );
});
