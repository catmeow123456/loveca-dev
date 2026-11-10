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
  GameMode,
  GamePhase,
  HeartColor,
  OrientationState,
  SubPhase,
  TurnType,
} from '@game/shared/types/enums';
import rows from './cards.json';
import songImage from './images/PL!-bp8-023-SECL.png';
export const SONG = 'PL!-bp8-023-SECL';
export type SnowScenario = 'six' | 'five' | 'native' | 'double' | 'failure' | 'recolor';
const pictures = import.meta.glob<string>('./images/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
let songTexture = songImage;
/** Only the preview texture is normalized; the public original and normal image service are untouched. */
export async function prepareSnowPreviewImages() {
  const image = new Image();
  image.src = songImage;
  await image.decode();
  if (image.naturalWidth <= image.naturalHeight) return;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(image, 0, 0);
  songTexture = canvas.toDataURL('image/png');
}
export const imageFor = (code: string) =>
  code === SONG ? songTexture : code === 'ENERGY' ? '/back.jpg' : pictures[`./images/${code}.webp`];
export function data(code: string): AnyCardData {
  const row = rows.find((r) => r.cardCode === code)!;
  return {
    ...row,
    name: row.nameCn,
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
/** A deterministic starting table only. All play after reset uses GameSession commands and projections. */
export function setupSnow(scenario: SnowScenario = 'six') {
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  const multiple = scenario === 'double',
    count = scenario === 'five' || scenario === 'native' ? 5 : 6;
  const energy = { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY } as const;
  const songs = multiple ? ['song', 'song2'] : ['song'];
  // LIVE setting draws one card per placed card. Those draws precede the fixed cheer batch.
  const deckCodes = [
    ...songs.map(() => 'PL!-sd1-010-SD'),
    ...Array.from({ length: count }, () => 'PL!-sd1-016-SD'),
    ...(scenario === 'native' ? [SONG] : []),
    ...Array.from({ length: 40 }, () => 'PL!-sd1-001-SD'),
  ];
  const deck = deckCodes.map((code, i) => createCardInstance(data(code), 'p1', `deck-${i}`));
  let game = registerCards(
    session.createGame(`snow-preview-${Date.now()}`, 'p1', 'Snow halation', 'p2', '对手'),
    [
      ...songs.map((id) => createCardInstance(data(SONG), 'p1', id)),
      ...[0, 1, 2].map((i) => createCardInstance(data('PL!-sd1-009-SD'), 'p1', `stage-${i}`)),
      createCardInstance(data('PL!-sd1-010-SD'), 'p1', 'hand-member'),
      createCardInstance(data('PL!-sd1-002-SD'), 'p2', 'opponent'),
      ...deck,
      ...Array.from({ length: 24 }, (_, i) => createCardInstance(energy, 'p1', `energy-${i}`)),
      ...[0, 1, 2].map((i) =>
        createCardInstance(data('PL!-sd1-010-SD'), 'p2', `opponent-deck-${i}`)
      ),
    ]
  );
  const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: [...songs, 'hand-member'] },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
    memberSlots: {
      ...p.memberSlots,
      slots: { LEFT: 'stage-0', CENTER: 'stage-1', RIGHT: 'stage-2' },
      cardStates: new Map([0, 1, 2].map((i) => [`stage-${i}`, up])),
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
    mainDeck: { ...p.mainDeck, cardIds: [0, 1, 2].map((i) => `opponent-deck-${i}`) },
  }));
  // Named fixture scenarios use existing modifier machinery, never altered printed card data.
  if (scenario === 'failure')
    for (const i of [0, 1, 2])
      game = addLiveModifier(game, {
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        playerId: 'p1',
        memberCardId: `stage-${i}`,
        sourceCardId: `stage-${i}`,
        abilityId: 'preview-gray-hearts',
        hearts: [{ color: HeartColor.GRAY, count: 6 }],
      });
  if (scenario === 'recolor')
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: 'p1',
      fromColors: [HeartColor.ORANGE],
      toColor: HeartColor.PURPLE,
      abilityId: 'preview-existing-recolor',
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
  const store = useGameStore.getState();
  store.loadCardData([...rows.map((r) => data(r.cardCode)), energy]);
  useGameStore.setState({
    gameSession: session,
    gameMode: GameMode.DEBUG,
    viewingPlayerId: 'p1',
    playerViewState: null,
    remoteSession: null,
    replaySession: null,
    getCardImagePath: imageFor,
    ui: {
      ...store.ui,
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
