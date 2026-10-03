import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import {
  createPlayMemberToSlotCommand,
  createConfirmEffectStepCommand,
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

// Identity/cost/rarities checked against cards_export_2026-09-29.json.
const prints = [
  ['PL!HS-pb1-003-P+', '大泽瑠璃乃', 'rurino'],
  ['PL!HS-pb1-003-R', '大泽瑠璃乃', 'rurino'],
  ['PL!S-bp7-005-P', '渡边曜', 'you'],
  ['PL!S-bp7-005-P+', '渡边曜', 'you'],
  ['PL!S-bp7-005-R+', '渡边曜', 'you'],
  ['PL!S-bp7-005-SEC', '渡边曜', 'you'],
] as const;

function fixture(cardCode: string, name: string, kind: string) {
  let now = 1000;
  const session = createGameSession({ cardEntrance: 'REMOTE', now: () => now });
  session.createGame('rurino-you-entrance', 'p1', 'P1', 'p2', 'P2');
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
    energyDeck: Array.from({ length: 15 }, (_, i) => ({
      cardCode: `E-${i}`,
      name: 'Energy',
      cardType: CardType.ENERGY as const,
    })),
  };
  session.initializeGame(deck, deck);
  const source: MemberCardData = {
    ...filler,
    cardCode,
    name,
    cost: 15,
    blade: kind === 'rurino' ? 5 : 6,
    groupNames: [kind === 'rurino' ? '蓮ノ空' : 'Aqours'],
    unitName: kind === 'rurino' ? '「みらくらぱーく！」' : '「CYaRon！」',
  };
  let state = registerCards(session.state!, [
    createCardInstance(source, 'p1', 'source'),
    createCardInstance(filler, 'p1', 'below'),
  ]);
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  const energy = [...state.cardRegistry.values()]
    .filter((c) => c.ownerId === 'p1' && c.data.cardType === CardType.ENERGY)
    .map((c) => c.instanceId);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['source'] },
    waitingRoom: { ...p.waitingRoom, cardIds: ['below'] },
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

describe('Rurino and You use the shared paid entrance and effect barrier', () => {
  for (const [code, name, kind] of prints)
    it.each(['ACK', 'timeout', 'disabled'] as const)(
      `${code} resumes its actual effect once after %s`,
      (mode) => {
        const { session, ack, advance } = fixture(code, name, kind);
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
        expect(session.state!.players[0].hand.cardIds).toEqual([]);
        const paid = session.state!.players[0].energyZone;
        expect(
          paid.cardIds.filter(
            (id) => paid.cardStates.get(id)?.orientation === OrientationState.WAITING
          )
        ).toHaveLength(15);
        if (mode === 'ACK') {
          expect(ack('p1', pending.id).success).toBe(true);
          expect(ack('p1', pending.id).success).toBe(true);
          expect(session.state!.activeEffect).toBeNull();
          expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
          expect(ack('p2', pending.id).success).toBe(true);
        } else if (mode === 'timeout') {
          advance();
          expect(session.expireCardEntrance()).toBe(true);
        } else session.setCardEntranceEnabled(false);
        expect(session.state!.entranceRuntime!.pending).toBeNull();
        const confirm = (selection: string | string[]) =>
          session.executeCommand(
            createConfirmEffectStepCommand(
              'p1',
              session.state!.activeEffect!.id,
              typeof selection === 'string' ? selection : undefined,
              null,
              undefined,
              null,
              Array.isArray(selection) ? selection : undefined
            )
          );
        expect(session.state!.activeEffect).not.toBeNull();
        if (kind === 'rurino') {
          expect(confirm([]).success).toBe(true);
          expect(session.state!.players[0].hand.cardIds).toHaveLength(1);
        } else {
          expect(session.state!.activeEffect!.selectableCardIds).toContain('below');
          expect(confirm('below').success).toBe(true);
          expect(confirm('source').success).toBe(true);
          expect(session.state!.players[0].memberSlots.memberBelow.CENTER).toEqual(['below']);
          expect(session.state!.players[0].waitingRoom.cardIds).not.toContain('below');
        }
        expect(session.state!.activeEffect).toBeNull();
        expect(session.state!.players[0].energyZone).toEqual(paid);
        expect(ack('p2', pending.id).success).toBe(false);
        session.setCardEntranceEnabled(true);
        session.restoreRuntimeState({
          authorityState: session.state!,
          currentPublicSeq: session.getCurrentPublicEventSeq(),
        });
        expect(session.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
      }
    );
  it('does not register the illustration-only energy card', () =>
    expect(isEntranceCard('PL!S-bp7-E02-SECE')).toBe(false));
});
