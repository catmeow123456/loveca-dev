import { useGameStore } from '@/store/gameStore';
import { createGameSession } from '@game/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '@game/domain/entities/card';
import { registerCards, updatePlayer } from '@game/domain/entities/game';
import { addLiveModifier } from '@game/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
  GameMode,
  HeartColor,
  OrientationState,
  SubPhase,
  TurnType,
} from '@game/shared/types/enums';
import rows from './cards.json';
export const SONG = 'PL!N-bp8-026-SECL';
const pictures = import.meta.glob<string>('./images/*.{png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});
export const imageFor = (code: string) =>
  code === 'ENERGY'
    ? '/back.jpg'
    : (pictures[`./images/${code}.webp`] ?? pictures[`./images/${code}.png`]);
export function data(code: string): AnyCardData {
  const row = rows.find((r) => r.cardCode === code)!;
  return {
    ...row,
    name: row.nameCn ?? row.nameJp,
    cardText: row.cardTextCn,
    hearts: row.hearts ?? [],
    bladeHearts: row.bladeHearts ?? [],
    unitName: row.unitName ?? undefined,
    ...(row.cardType === 'LIVE'
      ? {
          requirements: createHeartRequirement(
            Object.fromEntries((row.requirements ?? []).map((h) => [h.color, h.count]))
          ),
        }
      : {}),
  } as unknown as AnyCardData;
}
/** Only this isolated starting fixture is synthetic. All subsequent actions use the normal commands. */
export function setupRain(count = 5, multiple = false) {
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  const energy = { cardCode: 'ENERGY', cardType: CardType.ENERGY, name: '能量' } as const;
  const stageCodes = ['PL!N-sd1-003-SD', 'PL!N-sd1-006-SD', 'PL!N-sd1-004-SD'];
  const deck = Array.from({ length: 36 }, (_, i) =>
    createCardInstance(data('PL!N-sd1-007-SD'), 'p1', `deck-${i}`)
  );
  let game = registerCards(
    session.createGame(`solitude-rain-${Date.now()}`, 'p1', '雨幕追光', 'p2', '对手'),
    [
      createCardInstance(data(SONG), 'p1', 'song'),
      createCardInstance(data(SONG), 'p1', 'song2'),
      ...stageCodes.map((code, i) => createCardInstance(data(code), 'p1', `stage-${i}`)),
      createCardInstance(data('PL!N-sd1-007-SD'), 'p1', 'hand-member'),
      createCardInstance(data('PL!N-sd1-004-SD'), 'p2', 'opponent'),
      ...deck,
      ...Array.from({ length: 18 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
      createCardInstance(data('PL!N-sd1-007-SD'), 'p2', 'opponent-deck'),
    ]
  );
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['song', ...(multiple ? ['song2'] : []), 'hand-member'] },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: 'stage-0', CENTER: 'stage-1', RIGHT: 'stage-2' },
      cardStates: new Map(stageCodes.map((_, i) => [`stage-${i}`, up])),
    },
    energyZone: {
      ...p.energyZone,
      cardIds: Array.from({ length: 12 }, (_, i) => `energy-${i}`),
      cardStates: new Map(Array.from({ length: 12 }, (_, i) => [`energy-${i}`, up])),
    },
    energyDeck: {
      ...p.energyDeck,
      cardIds: Array.from({ length: 6 }, (_, i) => `energy-${12 + i}`),
    },
  }));
  game = updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: null, CENTER: 'opponent', RIGHT: null },
      cardStates: new Map([['opponent', up]]),
    },
    mainDeck: { ...p.mainDeck, cardIds: ['opponent-deck'] },
  }));
  // A documented pre-existing effective-Heart setup; the exported printed faces/data stay intact.
  // Both Shizuku and Kanata can be chosen. Purple never counts towards conversion.
  for (const id of ['stage-0', 'stage-1'])
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p1',
      memberCardId: id,
      sourceCardId: id,
      abilityId: 'preview-existing-hearts',
      hearts: [
        { color: HeartColor.RED, count: Math.ceil(count / 2) },
        { color: HeartColor.BLUE, count: Math.floor(count / 2) },
        { color: HeartColor.PURPLE, count: 7 },
      ].filter((h) => h.count > 0),
    });
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
