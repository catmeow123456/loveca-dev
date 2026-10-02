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
  session.createGame('seras-entrance', 'p1', 'P1', 'p2', 'P2');
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
    name: '赛拉丝·柳田·利林费尔德',
    blade: 5,
    groupNames: ['蓮ノ空'],
    unitName: '「EdelNote」',
  };
  let state = registerCards(session.state!, [
    createCardInstance(source, 'p1', 'source'),
    createCardInstance(member('opponent-target', 4), 'p2', 'target'),
  ]);
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  const energy = [...state.cardRegistry.values()]
    .filter((c) => c.ownerId === 'p1' && c.data.cardType === CardType.ENERGY)
    .map((c) => c.instanceId);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['source'] },
    energyZone: {
      ...p.energyZone,
      cardIds: energy,
      cardStates: new Map(energy.map((id) => [id, active])),
    },
    memberSlots: {
      ...p.memberSlots,
      slots: { ...p.memberSlots.slots, LEFT: null, CENTER: null },
      cardStates: new Map(),
    },
  }));
  state = updatePlayer(state, 'p2', (p) => ({
    ...p,
    memberSlots: {
      ...p.memberSlots,
      slots: { ...p.memberSlots.slots, CENTER: 'target' },
      cardStates: new Map([['target', active]]),
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
    session.executeCommand(createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER));
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

describe('Seras real paid entrance effect wait for entrance completion', () => {
  for (const cardCode of ['PL!HS-bp6-007-P', 'PL!HS-bp6-007-R']) {
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
        expect(session.state!.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
          OrientationState.ACTIVE
        );
        const paidEnergy = session.state!.players[0].energyZone;
        expect(
          paidEnergy.cardIds.filter(
            (id) => paidEnergy.cardStates.get(id)?.orientation === OrientationState.WAITING
          )
        ).toHaveLength(15);
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
        expect(effect.awaitingPlayerId).toBe('p2');
        expect(effect.selectableCardIds).toEqual(['target']);
        expect(
          session.executeCommand(createConfirmEffectStepCommand('p2', effect.id, 'target')).success
        ).toBe(true);
        confirmPublicSelectionIfNeeded(session);
        expect(session.state!.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
          OrientationState.WAITING
        );
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
