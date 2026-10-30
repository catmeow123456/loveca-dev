import { useGameStore } from '@/store/gameStore';
import { createGameSession } from '@game/application/game-session';
import { createCardInstance, type AnyCardData } from '@game/domain/entities/card';
import { registerCards, updatePlayer } from '@game/domain/entities/game';
import {
  CardType,
  FaceState,
  GamePhase,
  GameMode,
  OrientationState,
  SubPhase,
  TurnType,
} from '@game/shared/types/enums';
import rows from './cards.json';

const AI = 'PL!N-bp8-005-SEC',
  KANATA = 'PL!N-sd1-006-SD',
  RINA = 'PL!N-sd1-021-SD',
  OTHER = 'PL!HS-cl1-001-CL';
export function setupAi({ ready = false, rare = 'SEC', opponent = false, empty = false } = {}) {
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  const data = (code: string): AnyCardData => {
    const row = rows.find((r) => r.cardCode === code)!;
    return { ...row, name: row.nameCn, cardText: row.cardTextCn } as unknown as AnyCardData;
  };
  const ai = { ...data(AI), cardCode: `PL!N-bp8-005-${rare}` },
    kanata = data(KANATA),
    rina = data(RINA),
    other = data(OTHER);
  const energy = { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY } as const;
  const cards = [
    createCardInstance(ai, 'p1', 'ai'),
    createCardInstance(kanata, 'p1', 'own-kanata'),
    createCardInstance(other, 'p1', 'own-other'),
    createCardInstance(rina, 'p1', 'hand-rina'),
    createCardInstance(kanata, 'p1', 'waiting-kanata'),
    createCardInstance(rina, 'p1', 'waiting-rina'),
    createCardInstance(other, 'p1', 'waiting-other'),
    createCardInstance(other, 'p2', 'enemy-other'),
    createCardInstance(rina, 'p2', 'enemy-rina'),
    ...Array.from({ length: 18 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
    ...Array.from({ length: 2 }, (_, i) => createCardInstance(energy, 'p1', `energy-deck-${i}`)),
    ...Array.from({ length: 20 }, (_, i) => createCardInstance(kanata, 'p1', `deck-${i}`)),
  ];
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  let game = registerCards(
    session.createGame(`ai-preview-${Date.now()}`, 'p1', '宫下爱 · 把爱分给你', 'p2', '对手'),
    cards
  );
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ready ? ['hand-rina'] : ['ai', 'hand-rina'] },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: empty ? ['waiting-other'] : ['waiting-kanata', 'waiting-rina', 'waiting-other'],
    },
    mainDeck: { ...p.mainDeck, cardIds: Array.from({ length: 20 }, (_, i) => `deck-${i}`) },
    energyDeck: { ...p.energyDeck, cardIds: ['energy-deck-0', 'energy-deck-1'] },
    energyZone: {
      ...p.energyZone,
      cardIds: Array.from({ length: 18 }, (_, i) => `energy-${i}`),
      cardStates: new Map(Array.from({ length: 18 }, (_, i) => [`energy-${i}`, up])),
    },
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: 'own-kanata', CENTER: ready ? 'ai' : null, RIGHT: 'own-other' },
      cardStates: new Map([
        ['own-kanata', up],
        ['own-other', up],
        ...(ready ? [['ai', up] as const] : []),
      ]),
    },
  }));
  game = updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: 'enemy-other', CENTER: null, RIGHT: 'enemy-rina' },
      cardStates: new Map([
        ['enemy-other', up],
        ['enemy-rina', up],
      ]),
    },
  }));
  game = {
    ...game,
    isStarted: true,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    waitingForInput: false,
    manualOperationMode: 'RULES',
  };
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  useGameStore.getState().loadCardData([ai, kanata, rina, other, energy]);
  useGameStore.setState({
    gameSession: session,
    gameMode: opponent ? GameMode.SOLITAIRE : GameMode.DEBUG,
    viewingPlayerId: opponent ? 'p2' : 'p1',
    playerViewState: null,
    remoteSession: null,
    replaySession: null,
    getCardImagePath: (code) =>
      code === 'ENERGY'
        ? '/back.jpg'
        : `/images/large/${code.startsWith('PL!N-bp8-005-') ? AI : code}.webp`,
    ui: {
      ...useGameStore.getState().ui,
      battleAnimationOcclusions: [],
      battleFeedbackEvents: [],
      hoveredCardId: null,
      selectedCardId: null,
      cardDetail: null,
    },
  });
  useGameStore.getState().syncState();
  return session;
}
