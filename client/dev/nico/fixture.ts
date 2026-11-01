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
import type { NicoEvidencePresentation } from '@/lib/nicoEvidence';
import rows from './cards.json';

export const NICO = 'PL!-bp8-009-SEC';
const handCodes = ['PL!-sd1-002-SD', 'PL!-sd1-005-SD', 'PL!-sd1-006-SD', 'PL!-sd1-007-SD'];
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
  code === 'ENERGY'
    ? '/back.jpg'
    : `/images/large/${code.startsWith('PL!-bp8-009-') ? NICO : code}.webp`;
export function previewCue(newCostKind = true): NicoEvidencePresentation {
  return {
    key: 'preview',
    hostId: 'obj_nico',
    incarnation: 'initial:nico',
    cardId: 'obj_hand-0',
    cardCode: handCodes[0],
    cardName: '绚濑绘里',
    ownerSeat: 'FIRST',
    newCostKind,
  };
}
export function setupNico({ duplicate = false, rarity = 'SEC', handEntry = false } = {}) {
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  const energy = { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY } as const;
  const nico = { ...data(NICO), cardCode: `PL!-bp8-009-${rarity}` } as AnyCardData;
  const cards = [
    createCardInstance(nico, 'p1', 'nico'),
    ...handCodes.map((c, i) => createCardInstance(data(c), 'p1', `hand-${i}`)),
    createCardInstance(data('PL!-sd1-019-SD'), 'p1', 'live'),
    createCardInstance(data(handCodes[0]), 'p1', 'below'),
    createCardInstance(data('PL!-sd1-008-SD'), 'p2', 'opponent'),
    ...Array.from({ length: 24 }, (_, i) =>
      createCardInstance(data('PL!-sd1-008-SD'), 'p1', `deck-${i}`)
    ),
    ...Array.from({ length: 24 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
  ];
  let game = registerCards(
    session.createGame(`nico-${Date.now()}`, 'p1', '妮可 · 线索收藏', 'p2', '对手'),
    cards
  );
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: {
      ...p.hand,
      cardIds: [...(handEntry ? ['nico'] : []), ...handCodes.map((_, i) => `hand-${i}`), 'live'],
    },
    mainDeck: { ...p.mainDeck, cardIds: Array.from({ length: 24 }, (_, i) => `deck-${i}`) },
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: null, CENTER: handEntry ? null : 'nico', RIGHT: null },
      cardStates: new Map(handEntry ? [] : [['nico', up]]),
      memberBelow: { LEFT: [], CENTER: duplicate && !handEntry ? ['below'] : [], RIGHT: [] },
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
  useGameStore.getState().loadCardData([...rows.map((r) => data(r.cardCode)), nico, energy]);
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
