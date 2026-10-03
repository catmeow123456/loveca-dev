import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import {
  createPlayMemberToSlotCommand,
  createConfirmEffectStepCommand,
  createAutoAdvancePublicCardSelectionCommand,
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

// Printed identities and costs from the user-designated 2026-09-29 export.
const cards = [
  ['LL-bp7-001', '国木田花丸&优木雪菜&岚千砂都', 15, ['R+'], 'festival-trio'],
  ['PL!N-bp7-003', '樱坂雫', 15, ['P', 'P+', 'R+', 'SEC'], 'shizuku'],
  ['PL!N-bp7-008', '艾玛·维尔德', 15, ['P', 'R'], 'emma'],
  ['PL!SP-bp7-006', '樱小路希奈子', 15, ['P', 'P+', 'R+', 'SEC'], 'kinako'],
  ['PL!SP-bp7-007', '米女芽衣', 17, ['P', 'P+', 'R+', 'SEC'], 'mei'],
  ['PL!-bp6-006', '西木野真姬', 17, ['P', 'P+', 'R+', 'SEC'], 'maki'],
  ['PL!HS-bp6-006', '安养寺姬芽', 20, ['P', 'P+', 'R+', 'SEC'], 'hime-bp6'],
] as const;
function fixture(code: string, name: string, cost: number, available = 24) {
  let now = 1000;
  const session = createGameSession({ cardEntrance: 'REMOTE', now: () => now });
  session.createGame('seven-entrance', 'p1', 'P1', 'p2', 'P2');
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

describe('seven new portraits share the real paid entrance barrier', () => {
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
  it.each(['ACK', 'timeout', 'disabled'] as const)(
    'Emma resumes her actual ordered-bottom/energy effect after %s',
    (mode) => {
      const { session, ack, advance, setNow } = fixture('PL!N-bp7-008-P', '艾玛·维尔德', 15);
      expect(
        session.executeCommand(createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER))
          .success
      ).toBe(true);
      const pending = session.state!.entranceRuntime!.pending!;
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].waitingRoom.cardIds).toHaveLength(4);
      if (mode === 'ACK') {
        ack('p1', pending.id);
        ack('p2', pending.id);
      } else if (mode === 'timeout') {
        advance();
        expect(session.expireCardEntrance()).toBe(true);
      } else session.setCardEntranceEnabled(false);
      const effect = session.state!.activeEffect!;
      expect(effect.selectableCardIds).toEqual([
        'waiting-0',
        'waiting-1',
        'waiting-2',
        'waiting-3',
      ]);
      const ordered = ['waiting-3', 'waiting-1', 'waiting-0', 'waiting-2'];
      const result = session.executeCommand(
        createConfirmEffectStepCommand('p1', effect.id, undefined, null, undefined, null, ordered)
      );
      expect(result.success, result.error).toBe(true);
      // Public selection has its own reading window after the cinematic barrier.
      const display = session.state!.activeEffect!;
      expect(display.revealedCardIds).toEqual(ordered);
      expect(session.state!.players[0].waitingRoom.cardIds).toHaveLength(4);
      setNow(display.publicCardSelectionAutoAdvanceAt!);
      const advanced = session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          'p2',
          display.id,
          display.publicCardSelectionAutoAdvanceAt!
        )
      );
      expect(advanced.success, advanced.error).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
      const energy = session.state!.players[0].energyZone;
      expect(
        energy.cardIds.filter(
          (id) => energy.cardStates.get(id)?.orientation === OrientationState.WAITING
        )
      ).toHaveLength(11);
      expect(session.state!.activeEffect).toBeNull();
      expect(ack('p2', pending.id).success).toBe(false);
    }
  );
  it('keeps illustration energy references unregistered and distinguishes the two Hime cards', () => {
    for (const code of [
      'PL!N-bp7-E01-SECE',
      'PL!SP-bp7-E03-SECE',
      'PL!SP-bp7-E04-SECE',
      'PL!-bp6-E03-SECE',
      'PL!HS-bp6-E03-SECE',
    ]) {
      expect(isEntranceCard(code)).toBe(false);
      expect(getCardEntranceProfile(code)).toBeUndefined();
    }
    expect(getCardEntranceProfile('PL!HS-sd1-006-SD')?.id).toBe('hime');
    expect(getCardEntranceProfile('PL!HS-bp6-006-SEC')?.id).toBe('hime-bp6');
  });
});
