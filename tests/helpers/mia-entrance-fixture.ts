import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createBeginSpecialMemberPlayCommand,
  createConfirmSpecialMemberPlayCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  OrientationState,
  GamePhase,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import miaRow from './mia-entrance-card.json';
import rows from './double-relay-cards.json';

let generation = 0;
/** Initial fixture only; special payment and entry always go through the real command path. */
export function prepareMiaEntranceScenario(
  options: {
    session?: GameSession;
    count?: number;
    energyCount?: number;
    code?: string;
    relay?: boolean;
  } = {}
) {
  const session = options.session ?? createGameSession({ cardEntrance: 'REMOTE' });
  const filler = rows.find((r) => r.cardCode === 'PL!SP-pb1-012-N')! as unknown as AnyCardData;
  const mia = { ...miaRow, cardCode: options.code ?? miaRow.cardCode } as unknown as AnyCardData;
  const live: AnyCardData = {
    cardCode: 'PL!-sd1-019-SRL',
    name: '僕らのLIVE 君とのLIFE',
    cardType: CardType.LIVE,
    score: 1,
    groupNames: ['μ’s'],
    requirements: createHeartRequirement({}, 0),
  };
  const energy: AnyCardData = { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY };
  session.createGame(`mia-review-${++generation}`, 'p1', '己方', 'p2', '对方');
  const deck = {
    mainDeck: Array.from({ length: 60 }, () => filler),
    energyDeck: Array.from({ length: 16 }, () => energy),
  };
  session.initializeGame(deck, deck);
  const memberIds = Array.from(
    { length: options.count ?? 6 },
    (_, i) => `waiting-member-${String(i).padStart(2, '0')}`
  );
  const cards = [
    createCardInstance(mia, 'p1', 'mia'),
    createCardInstance(live, 'p1', 'waiting-live'),
    ...memberIds.map((id) => createCardInstance(filler, 'p1', id)),
    ...['neighbor-center', 'neighbor-right', ...(options.relay ? ['relay'] : [])].map((id) =>
      createCardInstance(filler, 'p1', id)
    ),
    createCardInstance(filler, 'p2', 'opponent'),
  ];
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  let state = registerCards(session.state!, cards);
  for (const playerId of ['p1', 'p2']) {
    const energyIds = [...state.cardRegistry.values()]
      .filter((c) => c.ownerId === playerId && c.data.cardType === CardType.ENERGY)
      .map((c) => c.instanceId)
      .slice(0, options.energyCount ?? 13);
    state = updatePlayer(state, playerId, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: playerId === 'p1' ? ['mia'] : [] },
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: playerId === 'p1' ? [...memberIds, 'waiting-live'] : [],
      },
      memberSlots: {
        ...p.memberSlots,
        slots:
          playerId === 'p1'
            ? {
                LEFT: options.relay ? 'relay' : null,
                CENTER: 'neighbor-center',
                RIGHT: 'neighbor-right',
              }
            : { LEFT: null, CENTER: 'opponent', RIGHT: null },
        cardStates: new Map(
          (playerId === 'p1'
            ? ['neighbor-center', 'neighbor-right', ...(options.relay ? ['relay'] : [])]
            : ['opponent']
          ).map((id) => [id, active])
        ),
      },
      energyZone: {
        ...p.energyZone,
        cardIds: energyIds,
        cardStates: new Map(energyIds.map((id) => [id, active])),
      },
      energyDeck: { ...p.energyDeck, cardIds: [] },
    }));
  }
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const begin = () =>
    session.executeCommand(
      createBeginSpecialMemberPlayCommand(
        'p1',
        'mia',
        SlotPosition.LEFT,
        'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO'
      )
    );
  const confirm = () =>
    session.executeCommand(
      createConfirmSpecialMemberPlayCommand('p1', session.state!.pendingSpecialMemberPlay!.id, [])
    );
  const ordinary = () =>
    session.executeCommand(createPlayMemberToSlotCommand('p1', 'mia', SlotPosition.LEFT));
  return { session, begin, confirm, ordinary, memberIds, cardData: [mia, filler, live, energy] };
}
