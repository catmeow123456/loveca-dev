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
} from '../../src/shared/types/enums';
import { ENTRANCE_WAIT_LIMIT_MS } from '../../src/shared/card-entrance';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

function fixture() {
  let now = 1000;
  const session = createGameSession({ cardEntrance: 'REMOTE', now: () => now });
  session.createGame('hime-entrance', 'p1', 'P1', 'p2', 'P2');
  const hime: MemberCardData = {
    cardCode: 'PL!HS-sd1-006-SD',
    name: '安养寺姬芽',
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 5,
    hearts: [],
    groupNames: ['蓮ノ空'],
  };
  const deck = {
    mainDeck: Array.from({ length: 60 }, (_, i) => ({ ...hime, cardCode: `filler-${i}` })),
    energyDeck: Array.from({ length: 15 }, (_, i) => ({
      cardCode: `E-${i}`,
      name: 'Energy',
      cardType: CardType.ENERGY as const,
    })),
  };
  session.initializeGame(deck, deck);
  const cards = [
    createCardInstance(hime, 'p1', 'hime'),
    createCardInstance(
      { ...hime, cardCode: 'PL!HS-sd1-003-SD', name: '大泽瑠璃乃', cost: 7 },
      'p1',
      'ally'
    ),
    createCardInstance(
      {
        cardCode: 'hime-qa-live',
        name: '蓮ノ空 LIVE',
        cardType: CardType.LIVE,
        score: 1,
        requirements: { colorRequirements: new Map(), totalRequired: 0 },
        groupNames: ['蓮ノ空'],
      },
      'p1',
      'live'
    ),
  ];
  let state = registerCards(session.state!, cards);
  const energies = [...state.cardRegistry.values()]
    .filter((c) => c.ownerId === 'p1' && c.data.cardType === CardType.ENERGY)
    .slice(0, 15)
    .map((c) => c.instanceId);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['hime'] },
    waitingRoom: { ...p.waitingRoom, cardIds: ['live'] },
    energyZone: {
      ...p.energyZone,
      cardIds: energies,
      cardStates: new Map(
        energies.map((id) => [
          id,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
        ])
      ),
    },
    memberSlots: {
      ...p.memberSlots,
      slots: { ...p.memberSlots.slots, LEFT: 'ally' },
      cardStates: new Map([
        ['ally', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    waitingForInput: false,
    waitingPlayerId: null,
    activePlayerIndex: 0,
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const play = () =>
    session.executeCommand(createPlayMemberToSlotCommand('p1', 'hime', SlotPosition.CENTER));
  const ack = (playerId: string, entranceId: string) =>
    session.executeCommand({
      type: GameCommandType.ACK_CARD_ENTRANCE,
      playerId,
      entranceId,
      timestamp: now,
    });
  const activeEnergy = () =>
    session.state!.players[0].energyZone.cardIds.filter(
      (id) =>
        session.state!.players[0].energyZone.cardStates.get(id)?.orientation ===
        OrientationState.ACTIVE
    ).length;
  return {
    session,
    play,
    ack,
    activeEnergy,
    advance: () => {
      now += ENTRANCE_WAIT_LIMIT_MS;
    },
  };
}

describe('Hime real on-enter continuation', () => {
  it.each(['both ACK', 'timeout', 'platform off'] as const)(
    '%s resumes energy activation and LIVE selection exactly once',
    (mode) => {
      const { session, play, ack, activeEnergy, advance } = fixture();
      expect(play().success).toBe(true);
      const pending = session.state!.entranceRuntime!.pending!;
      expect(pending.cardIds).toEqual(['hime']);
      expect(activeEnergy()).toBe(0); // all 15 paid before presentation
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].waitingRoom.cardIds).toContain('live');
      expect(session.getPlayerViewState('p1')!.match.entrance).toEqual(
        session.getPlayerViewState('p2')!.match.entrance
      );
      if (mode === 'both ACK') {
        expect(ack('p1', pending.id).success).toBe(true);
        expect(activeEnergy()).toBe(0);
        expect(session.state!.activeEffect).toBeNull();
        expect(ack('p1', pending.id).success).toBe(true);
        expect(ack('p2', pending.id).success).toBe(true);
      } else if (mode === 'timeout') {
        advance();
        expect(session.expireCardEntrance()).toBe(true);
      } else session.setCardEntranceEnabled(false);
      expect(session.state!.entranceRuntime!.pending).toBeNull();
      expect(activeEnergy()).toBe(1);
      const effect = session.state!.activeEffect!;
      expect(effect.selectableCardIds).toEqual(['live']);
      expect(
        session.executeCommand(createConfirmEffectStepCommand('p1', effect.id, 'live')).success
      ).toBe(true);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds.filter((id) => id === 'live')).toHaveLength(1);
      expect(session.state!.players[0].waitingRoom.cardIds).not.toContain('live');
      expect(ack('p2', pending.id).success).toBe(false);
      session.setCardEntranceEnabled(true);
      session.restoreRuntimeState({
        authorityState: session.state!,
        currentPublicSeq: session.getCurrentPublicEventSeq(),
      });
      expect(session.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
      expect(activeEnergy()).toBe(1);
    }
  );
});
