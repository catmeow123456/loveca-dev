import { describe, expect, it } from 'vitest';
import { prepareMiaEntranceScenario } from '../helpers/mia-entrance-fixture';
import {
  GameCommandType,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createGameSession } from '../../src/application/game-session';
import { captureCardEntrance } from '../../src/application/card-entrance';
import {
  ENTRANCE_WAIT_LIMIT_MS,
  WAITING_RETURN_ENTRANCE_EXTRA_MS,
} from '../../src/shared/card-entrance';
import { TriggerCondition, OrientationState } from '../../src/shared/types/enums';
import { getWaitingReturnSource } from '../../client/src/lib/waitingReturnEntrance';

describe('Mia waiting-room return entrance', () => {
  it('defers a real waiting-room-return observer until both players finish, then resolves it once', () => {
    const f = prepareMiaEntranceScenario();
    const registry = f.session.state!.cardRegistry;
    const neighbor = registry.get('neighbor-center')!;
    registry.set(neighbor.instanceId, {
      ...neighbor,
      data: { ...neighbor.data, cardCode: 'PL!HS-bp8-001-P', name: '日野下花帆' },
    });
    const abilityId = HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID;
    const modifiers = () =>
      f.session.state!.liveResolution.liveModifiers.filter((m) => m.abilityId === abilityId);
    expect(f.begin().success).toBe(true);
    expect(f.confirm().success).toBe(true);
    const id = f.session.state!.entranceRuntime!.pending!.id;
    const ack = (playerId: string) =>
      f.session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId,
        entranceId: id,
        timestamp: Date.now(),
      });
    expect(modifiers()).toHaveLength(0);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities.some((a) => a.abilityId === abilityId)).toBe(true);
    expect(ack('p1').success).toBe(true);
    expect(modifiers()).toHaveLength(0);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(ack('p2').success).toBe(true);
    const effect = f.session.state!.activeEffect;
    if (effect)
      expect(
        f.session.executeCommand(createConfirmEffectStepCommand('p1', effect.id)).success
      ).toBe(true);
    expect(modifiers()).toEqual([
      expect.objectContaining({ kind: 'BLADE', sourceCardId: 'neighbor-center', countDelta: 3 }),
    ]);
    expect(ack('p2').success).toBe(false);
    expect(modifiers()).toHaveLength(1);
  });
  for (const suffix of ['P', 'P+', 'R+', 'SEC', 'FUTURE'])
    it(`${suffix}: real payment and both public views share one return, with no shuffled positions`, () => {
      const f = prepareMiaEntranceScenario({ code: `PL!N-bp7-011-${suffix}`, energyCount: 11 });
      const deckBefore = [...f.session.state!.players[0].mainDeck.cardIds];
      expect(f.begin().success).toBe(true);
      expect(f.session.state!.entranceRuntime?.pending).toBeNull();
      expect(f.confirm().success).toBe(true);
      const state = f.session.state!,
        p = state.players[0];
      expect(p.waitingRoom.cardIds).toEqual(['waiting-live']);
      expect(p.mainDeck.cardIds.slice(0, deckBefore.length)).toEqual(deckBefore);
      expect(p.mainDeck.cardIds.slice(deckBefore.length).sort()).toEqual(f.memberIds);
      expect(
        [...p.energyZone.cardStates.values()].filter(
          (s) => s.orientation === OrientationState.WAITING
        )
      ).toHaveLength(11);
      expect(p.memberSlots.slots.LEFT).toBe('mia');
      const views = ['p1', 'p2'].map((id) => f.session.getPlayerViewState(id)!);
      expect(views[0]!.match.entrance).toEqual(views[1]!.match.entrance);
      for (const view of views) {
        const source = getWaitingReturnSource(view, 'obj_mia', (c) => c)!;
        expect(source.count).toBe(6);
        expect(source.side).toBe(view.match.viewerSeat === 'FIRST' ? 'self' : 'opponent');
        expect(source.objectIds).toEqual(f.memberIds.map((id) => `obj_${id}`));
        expect(source.objectIds).not.toContain('obj_waiting-live');
        // Snapshots remember public waiting faces, not fronts on the now-hidden deck objects.
        for (const id of source.objectIds) expect(view.objects[id]?.frontInfo).toBeUndefined();
      }
      const pending = state.entranceRuntime!.pending!;
      expect(pending.waitingRoomReturns).toHaveLength(1);
      expect(
        captureCardEntrance({
          ...state,
          entranceRuntime: { ...state.entranceRuntime!, pending: null },
        }).entranceRuntime!.pending
      ).toBeNull();
      // Inverting actual hidden insertion order cannot change the public presentation snapshot.
      const reversed = {
        ...state,
        entranceRuntime: { ...state.entranceRuntime!, pending: null, seenSequence: 0 },
        eventLog: state.eventLog.map((e) =>
          e.event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK &&
          'movedCardIds' in e.event
            ? { ...e, event: { ...e.event, movedCardIds: [...e.event.movedCardIds].reverse() } }
            : e
        ),
      };
      expect(captureCardEntrance(reversed).entranceRuntime!.pending!.waitingRoomReturns).toEqual(
        pending.waitingRoomReturns
      );
      const ack = (playerId: string, id = pending.id) =>
        f.session.executeCommand({
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId,
          entranceId: id,
          timestamp: Date.now(),
        });
      expect(ack('p1', 'stale').success).toBe(false);
      expect(ack('p1').success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending?.waitingPlayerIds).toEqual(['p2']);
      expect(ack('p2').success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.session.state!.players[0].mainDeck.cardIds).toEqual(p.mainDeck.cardIds);
      expect(ack('p2').success).toBe(false);
    });
  it('ordinary entry has no prelude or extra budget; empty waiting room and insufficient energy never animate', () => {
    const ordinary = prepareMiaEntranceScenario();
    expect(ordinary.ordinary().success).toBe(true);
    expect(
      ordinary.session.getPlayerViewState('p1')!.match.entrance?.waitingRoomReturns
    ).toBeUndefined();
    const empty = prepareMiaEntranceScenario({ count: 0 });
    expect(empty.begin().success).toBe(false);
    expect(empty.session.state!.entranceRuntime?.pending).toBeNull();
    const poor = prepareMiaEntranceScenario({ energyCount: 10 });
    const original = poor.session.state!.players[0].waitingRoom.cardIds;
    expect(poor.begin().success).toBe(true);
    expect(poor.confirm().success).toBe(false);
    expect(poor.session.state!.players[0].waitingRoom.cardIds).toEqual(original);
    expect(poor.session.state!.entranceRuntime?.pending).toBeNull();
  });
  it('only the pre-relay waiting members return; the replaced member stays in waiting', () => {
    const f = prepareMiaEntranceScenario({ relay: true });
    expect(f.begin().success).toBe(true);
    expect(f.confirm().success).toBe(true);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual(['waiting-live', 'relay']);
    expect(
      f.session.state!.entranceRuntime!.pending!.waitingRoomReturns![0]!.members.map(
        (m) => m.cardId
      )
    ).toEqual(f.memberIds);
  });
  it('many cards are one bounded prelude; timeout and undo/replay keep fresh ACK ownership', () => {
    let now = 1000;
    const session = createGameSession({ cardEntrance: 'LOCAL', now: () => now });
    const f = prepareMiaEntranceScenario({ session, count: 30 });
    expect(f.begin().success).toBe(true);
    expect(f.confirm().success).toBe(true);
    const first = session.state!.entranceRuntime!.pending!.id;
    const source = getWaitingReturnSource(session.getPlayerViewState('p1')!, 'obj_mia', (c) => c)!;
    expect(source.count).toBe(30);
    expect(source.facePaths).toHaveLength(7);
    now += ENTRANCE_WAIT_LIMIT_MS;
    expect(session.expireCardEntrance()).toBe(false);
    now += WAITING_RETURN_ENTRANCE_EXTRA_MS;
    expect(session.expireCardEntrance()).toBe(true);
    expect(session.undoLastStep().success).toBe(true);
    expect(f.confirm().success).toBe(true);
    expect(session.state!.entranceRuntime!.pending!.id).not.toBe(first);
    expect(
      session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: 'p1',
        entranceId: first,
        timestamp: now,
      }).success
    ).toBe(false);
  });
});
