import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import {
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  OrientationState,
  GamePhase,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { ENTRANCE_WAIT_LIMIT_MS, isEntranceCard } from '../../src/shared/card-entrance';
import { getCardEntranceProfile } from '../../client/src/lib/cardEntranceProfiles';

// Identity, Chinese name, cost and ASCII rarities verified against the user-designated
// references/cards_export_2026-10-01.json; the production tests keep no external file dependency.
const cards = [
  ['PL!-bp6-003', '南琴梨（南小鸟）', 15, ['P', 'P+', 'R+', 'SEC'], 'kotori'],
  ['PL!S-bp6-002', '樱内梨子', 17, ['P', 'P+', 'R+', 'SEC'], 'riko'],
  ['PL!-pb2-016', '东条希', 17, ['P+', 'R'], 'nozomi'],
  ['PL!-pb2-017', '小泉花阳', 17, ['P+', 'R'], 'hanayo'],
  ['PL!-pb2-018', '矢泽日香（矢泽妮可）', 17, ['P+', 'R'], 'nico'],
] as const;
function fixture(code: string, name: string, cost: number, available = 24) {
  let now = 1000;
  const session = createGameSession({ cardEntrance: 'REMOTE', now: () => now });
  session.createGame('five-entrance', 'p1', 'P1', 'p2', 'P2');
  const filler: MemberCardData = {
    cardCode: 'FILLER',
    name: 'Filler',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [],
  };
  const deck = {
    mainDeck: Array.from({ length: 60 }, () => filler),
    energyDeck: Array.from({ length: 24 }, (_, i) => ({
      cardCode: `E-${i}`,
      name: 'Energy',
      cardType: CardType.ENERGY as const,
    })),
  };
  session.initializeGame(deck, deck);
  const source: MemberCardData = { ...filler, cardCode: code, name, cost };
  const waiting = Array.from({ length: 4 }, (_, i) =>
    createCardInstance(filler, 'p1', `waiting-${i}`)
  );
  let state = registerCards(session.state!, [
    createCardInstance(source, 'p1', 'source'),
    ...waiting,
  ]);
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  const energy = [...state.cardRegistry.values()]
    .filter((c) => c.ownerId === 'p1' && c.data.cardType === CardType.ENERGY)
    .map((c) => c.instanceId)
    .slice(0, available);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['source'] },
    waitingRoom: { ...p.waitingRoom, cardIds: waiting.map((c) => c.instanceId) },
    energyZone: {
      ...p.energyZone,
      cardIds: energy,
      cardStates: new Map(energy.map((id) => [id, active])),
    },
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: null, CENTER: null, RIGHT: null },
      cardStates: new Map(),
    },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return {
    session,
    setNow: (value: number) => {
      now = value;
    },
    advance: () => {
      now += ENTRANCE_WAIT_LIMIT_MS;
    },
    ack: (playerId: string, entranceId: string) =>
      session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId,
        entranceId,
        timestamp: now,
      }),
  };
}

describe('five new portraits share the real paid entrance barrier', () => {
  for (const [base, name, cost, rarities, id] of cards) {
    for (const rare of rarities)
      it(`${base}-${rare} pays its cost and presents the same public instance to both seats`, () => {
        const code = `${base}-${rare}`;
        expect(getCardEntranceProfile(code)?.id).toBe(id);
        const { session, ack } = fixture(code, name, cost);
        const result = session.executeCommand(
          createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER)
        );
        expect(result.success, result.error).toBe(true);
        const pending = session.state!.entranceRuntime!.pending!;
        expect(pending.cardIds).toEqual(['source']);
        expect(session.getPlayerViewState('p1')!.match.entrance).toEqual(
          session.getPlayerViewState('p2')!.match.entrance
        );
        expect(session.state!.activeEffect).toBeNull();
        const paid = session.state!.players[0].energyZone;
        expect(
          paid.cardIds.filter(
            (id) => paid.cardStates.get(id)?.orientation === OrientationState.WAITING
          )
        ).toHaveLength(cost);
        expect(ack('p1', pending.id).success).toBe(true);
        expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
        expect(session.state!.activeEffect).toBeNull();
        expect(ack('p2', pending.id).success).toBe(true);
        expect(session.state!.entranceRuntime!.pending).toBeNull();
        expect(session.state!.players[0].memberSlots.slots.CENTER).toBe('source');
        expect(ack('p2', pending.id).success).toBe(false);
        session.restoreRuntimeState({
          authorityState: session.state!,
          currentPublicSeq: session.getCurrentPublicEventSeq(),
        });
        expect(session.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
      });
    it(`${base} cannot animate a failed payment`, () => {
      const { session } = fixture(`${base}-${rarities[0]}`, name, cost, cost - 1);
      expect(
        session.executeCommand(createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER))
          .success
      ).toBe(false);
      expect(session.state!.entranceRuntime!.pending).toBeNull();
      expect(session.state!.players[0].hand.cardIds).toContain('source');
    });
  }
  it('keeps both reference SECE energy cards out of the member presentation registry', () => {
    for (const code of ['PL!-bp6-E02-SECE', 'PL!S-bp6-E01-SECE']) {
      expect(isEntranceCard(code)).toBe(false);
      expect(getCardEntranceProfile(code)).toBeUndefined();
    }
  });
});
