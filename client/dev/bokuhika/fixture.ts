import { useGameStore } from '@/store/gameStore';
import { createGameSession } from '@game/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '@game/domain/entities/card';
import { registerCards, updatePlayer } from '@game/domain/entities/game';
import { placeCardInSlot } from '@game/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '@game/shared/types/enums';
import rows from './cards.json';
export const SONG = 'PL!-pb2-039-L';
const images = import.meta.glob<string>('./images/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
export const imageFor = (code: string) =>
  code === 'ENERGY' ? '/back.jpg' : images[`./images/${code}.webp`];
const store = () => useGameStore.getState();
function data(code: string): AnyCardData {
  const row = rows.find((r) => r.cardCode === code)!;
  const base = {
    ...row,
    name: row.nameCn,
    cardText: row.cardTextCn,
    hearts: row.hearts ?? [],
    bladeHearts: row.bladeHearts ?? [],
    unitName: row.unitName ?? undefined,
  };
  return (row.cardType === 'LIVE'
    ? {
        ...base,
        requirements: createHeartRequirement(
          Object.fromEntries((row.requirements ?? []).map((h) => [h.color, h.count]))
        ),
      }
    : base) as unknown as AnyCardData;
}
export function setup(ready = false, opponent = false, multiple = false) {
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  const song = data(SONG),
    // The two-song fixture needs more Hearts/BLADE to succeed through ordinary rules.
    honoka = data(multiple ? 'PL!-sd1-009-SD' : 'PL!-sd1-001-SD'),
    nico = data('PL!-sd1-009-SD'),
    kotori = data(multiple ? 'PL!-sd1-009-SD' : 'PL!-sd1-003-SD'),
    success = data('PL!-sd1-020-SD'),
    dash = data('PL!-sd1-019-SD');
  const energy = {
    cardCode: 'ENERGY',
    name: '能量',
    cardType: CardType.ENERGY,
  } as const;
  const deckCodes = ['PL!-sd1-005-SD', 'PL!-sd1-008-SD', 'PL!-sd1-002-SD'];
  const deck = Array.from({ length: 48 }, (_, i) => data(deckCodes[i % 3]));
  const handCodes = ['PL!-sd1-010-SD', 'PL!-sd1-013-SD', 'PL!-sd1-016-SD'];
  const hand = handCodes.map(data);
  let game = session.createGame(
    `bokuhika-preview-${Date.now()}`,
    'p1',
    'μ’s · 歌曲测试',
    'p2',
    '对手'
  );
  const cards = [
    createCardInstance(song, 'p1', 'song'),
    ...(multiple ? [createCardInstance(dash, 'p1', 'dash')] : []),
    createCardInstance(honoka, 'p1', 'honoka'),
    createCardInstance(nico, 'p1', 'nico'),
    createCardInstance(kotori, 'p1', 'kotori'),
    createCardInstance(honoka, 'p2', 'opponent'),
    ...hand.map((c, i) => createCardInstance(c, 'p1', `hand-${i}`)),
    ...deck.map((c, i) => createCardInstance(c, 'p1', `deck-${i}`)),
    ...Array.from({ length: 2 }, (_, i) => createCardInstance(success, 'p1', `success-${i}`)),
    ...Array.from({ length: 36 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
  ];
  game = registerCards(game, cards);
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: {
      ...p.hand,
      cardIds: ready
        ? ['song', ...(multiple ? ['dash'] : []), 'hand-0', 'hand-1', 'hand-2']
        : ['song', 'nico', 'kotori', 'hand-0', 'hand-1', 'hand-2'],
    },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((_, i) => `deck-${i}`) },
    successZone: {
      ...p.successZone,
      cardIds: ['success-0', 'success-1'],
      cardStates: new Map([
        ['success-0', up],
        ['success-1', up],
      ]),
    },
    energyZone: {
      ...p.energyZone,
      cardIds: Array.from({ length: 30 }, (_, i) => `energy-${i}`),
      cardStates: new Map(Array.from({ length: 30 }, (_, i) => [`energy-${i}`, up])),
    },
    energyDeck: {
      ...p.energyDeck,
      cardIds: Array.from({ length: 6 }, (_, i) => `energy-${i + 30}`),
    },
    memberSlots: ready
      ? placeCardInSlot(
          placeCardInSlot(
            placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'honoka', up),
            SlotPosition.CENTER,
            'nico',
            up
          ),
          SlotPosition.RIGHT,
          'kotori',
          up
        )
      : placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'honoka', up),
  }));
  game = updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'opponent', up),
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
  store().loadCardData([song, dash, honoka, nico, kotori, success, energy, ...deck, ...hand]);
  useGameStore.setState({
    gameSession: session,
    viewingPlayerId: opponent ? 'p2' : 'p1',
    playerViewState: null,
    remoteSession: null,
    replaySession: null,
    getCardImagePath: imageFor,
    ui: {
      ...store().ui,
      battleAnimationOcclusions: [],
      battleFeedbackEvents: [],
      hoveredCardId: null,
      selectedCardId: null,
      cardDetail: null,
    },
  });
  store().syncState();
  return session;
}
