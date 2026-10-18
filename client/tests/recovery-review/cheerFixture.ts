import { useGameStore } from '@/store/gameStore';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '@game/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '@game/domain/entities/game';
import { placeCardInSlot, addCardToStatefulZone } from '@game/domain/entities/zone';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  EffectWindowType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '@game/shared/types/enums';

// Local, deterministic position. Values match the existing local card art.
const ginko: AnyCardData = {
  cardCode: 'PL!HS-sd1-012-SD',
  name: '百生吟子',
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 1,
  hearts: [{ color: HeartColor.GREEN, count: 2 }],
  bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.GREEN }],
};
const kasumi: AnyCardData = {
  cardCode: 'PL!N-bp5-014-N',
  name: '中须霞',
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 2,
  hearts: [{ color: HeartColor.YELLOW, count: 1 }],
  bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW }],
};
const live: AnyCardData = {
  cardCode: 'PL!HS-bp2-022-L',
  name: 'AOKUHARUKA',
  cardType: CardType.LIVE,
  score: 2,
  requirements: createHeartRequirement({ [HeartColor.GREEN]: 4, [HeartColor.RAINBOW]: 1 }),
  bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
};
let generation = 0;
export function prepareCheer(
  automatic = false,
  count = 3,
  convertToBlue = false,
  liveCount = 1,
  alreadySatisfied = false
) {
  const store = useGameStore.getState();
  const session = store.gameSession;
  session.createGame(`cheer-preview-${++generation}`, 'p1', '己方', 'p2', '对方');
  const scenarioLive = alreadySatisfied
    ? {
        ...live,
        requirements: createHeartRequirement({ [HeartColor.GREEN]: 2, [HeartColor.YELLOW]: 1 }),
      }
    : live;
  const cards = [
    createCardInstance(ginko, 'p1', 'member-green'),
    createCardInstance(kasumi, 'p1', 'member-yellow'),
    ...Array.from({ length: liveCount }, (_, i) =>
      createCardInstance(scenarioLive, 'p1', `live-${i}`)
    ),
    ...Array.from({ length: count }, (_, i) =>
      createCardInstance(i % 3 === 1 ? kasumi : ginko, 'p1', `cheer-${i}`)
    ),
    createCardInstance(ginko, 'p1', 'remaining'),
    createCardInstance(kasumi, 'p2', 'opponent-hand'),
  ];
  const active = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
  let state = registerCards(session.state!, cards);
  state = {
    ...state,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: automatic
      ? SubPhase.PERFORMANCE_LIVE_START_EFFECTS
      : SubPhase.PERFORMANCE_JUDGMENT,
    effectWindowType: automatic ? EffectWindowType.LIVE_START : EffectWindowType.NONE,
    liveResolution: {
      ...state.liveResolution,
      isInLive: true,
      performingPlayerId: 'p1',
      liveModifiers: [
        ...(automatic && count !== 3
          ? [
              {
                kind: 'BLADE' as const,
                target: 'PLAYER' as const,
                playerId: 'p1',
                countDelta: count - 3,
              },
            ]
          : []),
        ...(convertToBlue
          ? [
              {
                kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT' as const,
                playerId: 'p1',
                fromColors: [HeartColor.GREEN, HeartColor.YELLOW],
                toColor: HeartColor.BLUE,
              },
            ]
          : []),
      ],
    },
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    manualOperationMode: 'FREE',
    waitingPlayerId: null,
  };
  state = updatePlayer(state, 'p1', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'member-green', active),
      SlotPosition.CENTER,
      'member-yellow',
      active
    ),
    mainDeck: {
      ...player.mainDeck,
      cardIds: [...Array.from({ length: count }, (_, i) => `cheer-${i}`), 'remaining'],
    },
    liveZone: Array.from({ length: liveCount }, (_, i) => `live-${i}`).reduce(
      (zone, id) => addCardToStatefulZone(zone, id, active),
      player.liveZone
    ),
  }));
  state = updatePlayer(state, 'p2', (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: ['opponent-hand'] },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;
  store.loadCardData([ginko, kasumi, scenarioLive]);
  useGameStore.setState({ viewingPlayerId: 'p1', remoteSession: null, replaySession: null });
  store.syncState();
}
