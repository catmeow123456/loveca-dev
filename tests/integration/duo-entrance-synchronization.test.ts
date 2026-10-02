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
import { ENTRANCE_WAIT_LIMIT_MS } from '../../src/shared/card-entrance';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

function fixture(cardCode: string) {
  let now = 1000;
  const session = createGameSession({ cardEntrance: 'REMOTE', now: () => now });
  session.createGame('duo-entrance', 'p1', 'P1', 'p2', 'P2');
  const member = (code: string, cost: number): MemberCardData => ({
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
    groupNames: ["μ's"],
  });
  const deck = {
    mainDeck: Array.from({ length: 60 }, (_, i) => member(`filler-${i}`, 4)),
    energyDeck: Array.from({ length: 15 }, (_, i) => ({
      cardCode: `E-${i}`,
      name: 'Energy',
      cardType: CardType.ENERGY as const,
    })),
  };
  session.initializeGame(deck, deck);
  const source: MemberCardData = {
    ...member(cardCode, 15),
    name: '星空凛&小泉花阳',
    blade: 7,
  };
  let state = registerCards(session.state!, [
    createCardInstance(source, 'p1', 'source'),
    createCardInstance(member('PL!-bp5-010-N', 5), 'p1', 'relay-five'),
    createCardInstance(member('PL!-bp5-005-P', 10), 'p1', 'relay-ten'),
    createCardInstance(
      {
        cardCode: 'PL!-sd1-019-SRL',
        name: 'μ’s LIVE',
        cardType: CardType.LIVE,
        score: 1,
        requirements: { colorRequirements: new Map(), totalRequired: 0 },
        groupNames: ["μ's"],
      },
      'p1',
      'live'
    ),
  ]);
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  const energy = [...state.cardRegistry.values()]
    .filter((c) => c.ownerId === 'p1' && c.data.cardType === CardType.ENERGY)
    .map((c) => c.instanceId);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['source'] },
    waitingRoom: { ...p.waitingRoom, cardIds: ['live'] },
    energyZone: {
      ...p.energyZone,
      cardIds: energy,
      cardStates: new Map(energy.map((id) => [id, active])),
    },
    memberSlots: {
      ...p.memberSlots,
      slots: { ...p.memberSlots.slots, LEFT: 'relay-five', CENTER: 'relay-ten' },
      cardStates: new Map([
        ['relay-five', active],
        ['relay-ten', active],
      ]),
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
  const play = () =>
    session.executeCommand(
      createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER, {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.LEFT],
      })
    );
  const ack = (playerId: string, entranceId: string) =>
    session.executeCommand({
      type: GameCommandType.ACK_CARD_ENTRANCE,
      playerId,
      entranceId,
      timestamp: now,
    });
  return {
    session,
    play,
    ack,
    advance: () => {
      now += ENTRANCE_WAIT_LIMIT_MS;
    },
  };
}

describe('DUO real double relay waits for entrance completion', () => {
  for (const cardCode of ['PL!-pb2-000-DUO', 'PL!-pb2-000-R']) {
    it.each(['ACK', 'timeout', 'disabled'] as const)(
      `${cardCode} resumes once after %s`,
      (mode) => {
        const { session, play, ack, advance } = fixture(cardCode);
        const result = play();
        expect(result.success, result.error).toBe(true);
        const pending = session.state!.entranceRuntime!.pending!;
        expect(pending.cardIds).toEqual(['source']);
        expect(session.getPlayerViewState('p1')!.match.entrance).toEqual(
          session.getPlayerViewState('p2')!.match.entrance
        );
        expect(session.state!.activeEffect).toBeNull();
        expect(session.state!.players[0].waitingRoom.cardIds).toContain('live');
        expect(session.state!.liveResolution.liveModifiers).toEqual([]);
        const paidEnergy = session.state!.players[0].energyZone;
        expect(
          paidEnergy.cardIds.filter(
            (id) => paidEnergy.cardStates.get(id)?.orientation === OrientationState.WAITING
          )
        ).toHaveLength(0);
        if (mode === 'ACK') {
          expect(ack('p1', pending.id).success).toBe(true);
          expect(session.state!.activeEffect).toBeNull();
          expect(ack('p1', pending.id).success).toBe(true);
          expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
          expect(ack('p2', pending.id).success).toBe(true);
        } else if (mode === 'timeout') {
          advance();
          expect(session.expireCardEntrance()).toBe(true);
        } else session.setCardEntranceEnabled(false);
        expect(session.state!.entranceRuntime!.pending).toBeNull();
        const effect = session.state!.activeEffect!;
        expect(effect.awaitingPlayerId).toBe('p1');
        expect(effect.selectableCardIds).toEqual(['live']);
        expect(
          session.executeCommand(createConfirmEffectStepCommand('p1', effect.id, 'live')).success
        ).toBe(true);
        confirmPublicSelectionIfNeeded(session);
        expect(session.state!.players[0].hand.cardIds.filter((id) => id === 'live')).toHaveLength(
          1
        );
        expect(
          session.state!.liveResolution.liveModifiers.filter(
            (m) => m.sourceCardId === 'source' && m.kind === 'SCORE'
          )
        ).toHaveLength(1);
        expect(session.state!.liveResolution.playerScores.get('p1')).toBe(1);
        expect(session.state!.players[0].energyZone).toEqual(paidEnergy);
        expect(ack('p2', pending.id).success).toBe(false);
        session.setCardEntranceEnabled(true);
        session.restoreRuntimeState({
          authorityState: session.state!,
          currentPublicSeq: session.getCurrentPublicEventSeq(),
        });
        expect(session.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
      }
    );
  }
});
