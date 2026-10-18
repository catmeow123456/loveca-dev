import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { GameCommandType } from '../../src/application/game-commands';
import {
  DOUBLE_RELAY_ENTRANCE_EXTRA_MS,
  ENTRANCE_WAIT_LIMIT_MS,
  isEntranceCard,
} from '../../src/shared/card-entrance';
import { DOUBLE_RELAY_MEMBER_BASE_CODES } from '../../src/shared/rules/double-relay';
import {
  prepareDoubleRelayScenario,
  doubleRelayCases,
} from '../helpers/double-relay-entrance-fixture';
import { getDoubleRelaySources } from '../../client/src/lib/doubleRelayEntrance';
import { getCardEntranceProfile } from '../../client/src/lib/cardEntranceProfiles';
import { OrientationState } from '../../src/shared/types/enums';

describe('double relay entrance consumes only committed public replacement events', () => {
  it('covers every rule-registered double-relay member and all print suffixes', () => {
    for (const code of DOUBLE_RELAY_MEMBER_BASE_CODES)
      for (const suffix of ['', '-R', '-DUO', '-SEC']) {
        expect(isEntranceCard(code + suffix)).toBe(true);
        expect(getCardEntranceProfile(code + suffix)).toBeDefined();
      }
  });
  for (const [index, entry] of doubleRelayCases.entries()) {
    it(`${entry.label}: rejects invalid choices, pays once, pauses the real ability, projects the same sources to both seats`, () => {
      const { session, command } = prepareDoubleRelayScenario(index);
      expect(session.executeCommand(command('INVALID')).success).toBe(false);
      expect(session.state!.entranceRuntime?.pending).toBeNull();
      const before = Date.now();
      const play = session.executeCommand(command());
      expect(play.success, play.error).toBe(true);
      const pending = session.state!.entranceRuntime!.pending!;
      expect(pending.cardIds).toEqual(['arrival']);
      expect(pending.doubleRelays).toEqual([
        {
          cardId: 'arrival',
          sources: [
            { cardId: 'relay-center', slot: 'CENTER', orientation: 'ACTIVE' },
            { cardId: 'relay-left', slot: 'LEFT', orientation: 'WAITING' },
          ],
        },
      ]);
      expect(pending.deadlineAt).toBeGreaterThanOrEqual(
        before + ENTRANCE_WAIT_LIMIT_MS + DOUBLE_RELAY_ENTRANCE_EXTRA_MS
      );
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(['relay-left', 'relay-center'])
      );
      const views = ['p1', 'p2'].map((id) => session.getPlayerViewState(id)!);
      expect(views[0]!.match.entrance).toEqual(views[1]!.match.entrance);
      for (const view of views) {
        const sources = getDoubleRelaySources(view, 'obj_arrival', (code) => code);
        expect(sources).toHaveLength(2);
        expect(sources.find((s) => s.objectId === 'obj_relay-left')!.orientation).toBe(
          OrientationState.WAITING
        );
        expect(
          sources.every((s) => s.side === (view.match.viewerSeat === 'FIRST' ? 'self' : 'opponent'))
        ).toBe(true);
        const hidden = {
          ...view,
          objects: {
            ...view.objects,
            'obj_relay-left': {
              ...view.objects['obj_relay-left']!,
              surface: 'BACK' as const,
              frontInfo: undefined,
            },
          },
        };
        expect(getDoubleRelaySources(hidden, 'obj_arrival', (c) => c)).toEqual([]);
      }
      const energyBeforeAck = session.state!.players[0].energyZone;
      const ack = (playerId: string, entranceId = pending.id) =>
        session.executeCommand({
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId,
          entranceId,
          timestamp: Date.now(),
        });
      expect(ack('p1').success).toBe(true);
      expect(session.state!.entranceRuntime!.pending?.waitingPlayerIds).toEqual(['p2']);
      expect(session.state!.activeEffect).toBeNull();
      expect(ack('p2', 'old-entry').success).toBe(false);
      expect(ack('p2').success).toBe(true);
      expect(session.state!.entranceRuntime!.pending).toBeNull();
      expect(session.state!.players[0].energyZone).toEqual(energyBeforeAck);
      // Every target retains its real on-entry workflow (draw, selection or recovery).
      if (index === 1) expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
      else expect(session.state!.activeEffect).not.toBeNull();
      expect(ack('p2').success).toBe(false);
    });
    it(`${entry.label}: single relay gets the newly covered portrait/landing, without fusion or extra budget`, () => {
      const { session, command } = prepareDoubleRelayScenario(index);
      expect(session.executeCommand(command('SINGLE')).success).toBe(true);
      const view = session.getPlayerViewState('p1')!;
      expect(view.match.entrance?.objectIds).toEqual(['obj_arrival']);
      expect(view.match.entrance?.doubleRelays).toBeUndefined();
      expect(getDoubleRelaySources(view, 'obj_arrival', (c) => c)).toEqual([]);
    });
  }
});

it('double relay owns the extra authority budget, then undo/replay makes a fresh barrier', () => {
  let now = 1000;
  const session = createGameSession({ cardEntrance: 'LOCAL', now: () => now });
  const { command } = prepareDoubleRelayScenario(1, session);
  expect(session.executeCommand(command()).success).toBe(true);
  const first = session.state!.entranceRuntime!.pending!.id;
  now += ENTRANCE_WAIT_LIMIT_MS;
  expect(session.expireCardEntrance()).toBe(false);
  now += DOUBLE_RELAY_ENTRANCE_EXTRA_MS;
  expect(session.expireCardEntrance()).toBe(true);
  expect(session.expireCardEntrance()).toBe(false);
  expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
  expect(session.undoLastStep().success).toBe(true);
  expect(session.executeCommand(command()).success).toBe(true);
  expect(session.state!.entranceRuntime!.pending!.id).not.toBe(first);
  expect(session.state!.entranceRuntime!.pending!.doubleRelays?.[0]?.sources).toHaveLength(2);
  expect(
    session.executeCommand({
      type: GameCommandType.ACK_CARD_ENTRANCE,
      playerId: 'p1',
      entranceId: first,
      timestamp: now,
    }).success
  ).toBe(false);
});
