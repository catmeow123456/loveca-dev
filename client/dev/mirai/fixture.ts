import { useGameStore } from '@/store/gameStore';
import { createGameSession } from '@game/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '@game/domain/entities/card';
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
import type { MiraiReturnPresentation } from '@/lib/miraiReturn';
import rows from './cards.json';
export const SONG = 'PL!SP-bp7-028-L';
const data = (code: string): AnyCardData => {
  const r = rows.find((r) => r.cardCode === code)!;
  return {
    ...r,
    name: r.nameCn ?? r.nameJp,
    cardText: r.cardTextCn,
    hearts: r.hearts ?? [],
    bladeHearts: r.bladeHearts ?? [],
    unitName: r.unitName ?? undefined,
    ...(r.cardType === 'LIVE'
      ? {
          requirements: createHeartRequirement(
            Object.fromEntries((r.requirements ?? []).map((h) => [h.color, h.count]))
          ),
        }
      : {}),
  } as unknown as AnyCardData;
};
export const imageFor = (code: string) =>
  code === 'ENERGY' ? '/back.jpg' : `/images/large/${code}.webp`;
const candidateCodes = Array.from(
  { length: 9 },
  (_, i) => `PL!SP-sd1-${String(i + 1).padStart(3, '0')}-SD`
);
export function previewSource(): MiraiReturnPresentation {
  return {
    sourceObjectId: 'obj_song',
    side: 'self',
    members: candidateCodes.map((c, i) => ({ objectId: `obj_waiting-${i}`, image: imageFor(c) })),
    targets: ['obj_stage-0', 'obj_stage-1', 'obj_stage-2'],
  };
}
export function setupMirai({ empty = false, duplicate = false, mixed = false } = {}) {
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  const energy = { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY } as const;
  const candidates = candidateCodes.map((c, i) => data(duplicate && i > 5 ? candidateCodes[0] : c));
  const stage = ['PL!SP-bp5-009-R', 'PL!SP-sd1-009-SD', 'PL!SP-sd1-010-SD'].map(data);
  const deck = Array.from({ length: 36 }, (_, i) =>
    data(mixed && i === 2 ? 'PL!-sd1-001-SD' : i % 2 ? 'PL!SP-sd1-001-SD' : 'PL!SP-sd1-003-SD')
  );
  const cards = [
    createCardInstance(data(SONG), 'p1', 'song'),
    ...stage.map((c, i) => createCardInstance(c, 'p1', `stage-${i}`)),
    ...candidates
      .slice(0, empty ? 8 : 9)
      .map((c, i) => createCardInstance(c, 'p1', `waiting-${i}`)),
    createCardInstance(data('PL!-sd1-001-SD'), 'p1', 'waiting-other'),
    ...deck.map((c, i) => createCardInstance(c, 'p1', `deck-${i}`)),
    createCardInstance(data('PL!SP-sd1-006-SD'), 'p1', 'hand-member'),
    createCardInstance(data('PL!SP-sd1-011-SD'), 'p2', 'opponent'),
    ...Array.from({ length: 24 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
  ];
  let game = registerCards(
    session.createGame(`mirai-${Date.now()}`, 'p1', 'Liella! · 未来音', 'p2', '对手'),
    cards
  );
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['song', 'hand-member'] },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((_, i) => `deck-${i}`) },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: [
        ...candidates.slice(0, empty ? 8 : 9).map((_, i) => `waiting-${i}`),
        'waiting-other',
      ],
    },
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: 'stage-0', CENTER: 'stage-1', RIGHT: 'stage-2' },
      cardStates: new Map(stage.map((_, i) => [`stage-${i}`, up])),
    },
    energyZone: {
      ...p.energyZone,
      cardIds: Array.from({ length: 18 }, (_, i) => `energy-${i}`),
      cardStates: new Map(Array.from({ length: 18 }, (_, i) => [`energy-${i}`, up])),
    },
    energyDeck: {
      ...p.energyDeck,
      cardIds: Array.from({ length: 6 }, (_, i) => `energy-${i + 18}`),
    },
  }));
  game = updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: null, CENTER: 'opponent', RIGHT: null },
      cardStates: new Map([['opponent', up]]),
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
  useGameStore.getState().loadCardData([...rows.map((r) => data(r.cardCode)), energy]);
  useGameStore.setState({
    gameSession: session,
    gameMode: GameMode.DEBUG,
    viewingPlayerId: 'p1',
    playerViewState: null,
    remoteSession: null,
    replaySession: null,
    getCardImagePath: imageFor,
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
