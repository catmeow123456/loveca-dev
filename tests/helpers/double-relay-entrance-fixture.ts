import { createGameSession, type GameSession } from '../../src/application/game-session';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createCardInstance, type AnyCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createHeartRequirement } from '../../src/domain/entities/card';
import {
  CardType,
  FaceState,
  OrientationState,
  GamePhase,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import rows from './double-relay-cards.json';

export const doubleRelayCases = [
  {
    code: 'PL!SP-bp4-004-P',
    label: '22费 平安名堇',
    partners: ['PL!SP-pb1-012-N', 'PL!SP-bp1-003-P'],
  },
  {
    code: 'PL!SP-pb2-000-DUO',
    label: '15费 岚千砂都＆鬼冢夏美',
    partners: ['PL!SP-pb1-012-N', 'PL!SP-bp1-003-P'],
  },
  {
    code: 'PL!-pb2-000-DUO',
    label: '15费 星空凛＆小泉花阳',
    partners: ['PL!-bp5-010-N', 'PL!-bp5-005-P'],
  },
  {
    code: 'PL!S-pb2-000-DUO',
    label: '15费 松浦果南＆小原鞠莉',
    partners: ['PL!S-bp3-014-N', 'PL!S-bp5-001-P'],
  },
] as const;
let generation = 0;
/** Initial position only; payments, relay events, barriers and abilities all run through the real session. */
export function prepareDoubleRelayScenario(
  index = 0,
  session: GameSession = createGameSession({ cardEntrance: 'REMOTE' })
) {
  const entry = doubleRelayCases[index]!;
  const data = rows as unknown as AnyCardData[];
  const find = (code: string) => data.find((c) => c.cardCode === code)!;
  session.createGame(`double-relay-review-${++generation}`, 'p1', '己方', 'p2', '对方');
  const filler = find(entry.partners[0]);
  const deck = {
    mainDeck: Array.from({ length: 60 }, () => filler),
    energyDeck: Array.from({ length: 24 }, () => ({
      cardCode: 'ENERGY',
      name: '能量',
      cardType: CardType.ENERGY as const,
    })),
  };
  session.initializeGame(deck, deck);
  const live: AnyCardData = {
    cardCode: 'PL!-sd1-019-SRL',
    name: '僕らのLIVE 君とのLIFE',
    cardType: CardType.LIVE,
    score: 1,
    groupNames: ['μ’s'],
    requirements: createHeartRequirement({}, 0),
  };
  const cards = [
    createCardInstance(find(entry.code), 'p1', 'arrival'),
    createCardInstance(find(entry.partners[0]), 'p1', 'relay-left'),
    createCardInstance(find(entry.partners[1]), 'p1', 'relay-center'),
    createCardInstance(filler, 'p1', 'neighbor'),
    createCardInstance(filler, 'p2', 'opponent'),
    createCardInstance(live, 'p1', 'waiting-live'),
    createCardInstance(data.at(-1)!, 'p1', 'waiting-member'),
  ];
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  let state = registerCards(session.state!, cards);
  for (const playerId of ['p1', 'p2'])
    state = updatePlayer(state, playerId, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: playerId === 'p1' ? ['arrival'] : [] },
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: playerId === 'p1' ? ['waiting-live', 'waiting-member'] : [],
      },
      memberSlots: {
        ...p.memberSlots,
        slots:
          playerId === 'p1'
            ? { LEFT: 'relay-left', CENTER: 'relay-center', RIGHT: 'neighbor' }
            : { LEFT: null, CENTER: 'opponent', RIGHT: null },
        cardStates: new Map(
          (playerId === 'p1' ? ['relay-left', 'relay-center', 'neighbor'] : ['opponent']).map(
            (id) => [
              id,
              {
                ...active,
                orientation:
                  id === 'relay-left' || id === 'neighbor'
                    ? OrientationState.WAITING
                    : OrientationState.ACTIVE,
              },
            ]
          )
        ),
      },
      energyZone: {
        ...p.energyZone,
        cardIds: [...state.cardRegistry.values()]
          .filter((c) => c.ownerId === playerId && c.data.cardType === CardType.ENERGY)
          .map((c) => c.instanceId),
        cardStates: new Map(
          [...state.cardRegistry.values()]
            .filter((c) => c.ownerId === playerId && c.data.cardType === CardType.ENERGY)
            .map((c) => [c.instanceId, active])
        ),
      },
      energyDeck: { ...p.energyDeck, cardIds: [] },
    }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const command = (mode: 'DOUBLE' | 'SINGLE' | 'INVALID' = 'DOUBLE') =>
    createPlayMemberToSlotCommand(
      'p1',
      'arrival',
      SlotPosition.CENTER,
      mode === 'SINGLE'
        ? undefined
        : {
            relayMode: 'DOUBLE',
            relayReplacementSlots:
              mode === 'INVALID'
                ? [SlotPosition.CENTER, SlotPosition.CENTER]
                : [SlotPosition.CENTER, SlotPosition.LEFT],
          }
    );
  return { session, command, cardData: [...data, live], entry };
}
