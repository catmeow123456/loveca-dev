import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  type AnyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  CardType,
  FaceState,
  OrientationState,
  GamePhase,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import rows from './six-entrance-cards.json';

// Narrow snapshot of the user-designated cards_export_2026-10-26.json.
// No dependency on a checkout's submodule or on a production card API.
export const sixEntranceCards = rows as unknown as readonly MemberCardData[];
let generation = 0;
export function prepareSixEntranceScenario(
  options: {
    session?: GameSession;
    code?: string;
    owner?: 'p1' | 'p2';
    energyCount?: number;
    relay?: boolean;
    mariReplacement?: boolean;
    now?: () => number;
  } = {}
) {
  const session =
    options.session ?? createGameSession({ cardEntrance: 'REMOTE', now: options.now });
  const owner = options.owner ?? 'p1';
  const opponent = owner === 'p1' ? 'p2' : 'p1';
  const sourceData = sixEntranceCards.find(
    (c) => c.cardCode === (options.code ?? 'PL!S-bp6-006-P')
  )!;
  if (!sourceData) throw new Error('Unknown six-card fixture print');
  const filler: MemberCardData = {
    cardCode: 'QA-SIX-NEIGHBOR',
    name: '对照成员',
    nameCn: '对照成员',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 2,
    hearts: [],
    groupNames: ['μ’s'],
  };
  const energy: AnyCardData = {
    cardCode: 'QA-ENERGY',
    name: '能量',
    nameCn: '能量',
    cardType: CardType.ENERGY,
  };
  session.createGame(`six-entrances-${++generation}`, 'p1', '玩家一', 'p2', '玩家二');
  const deck = {
    mainDeck: Array.from({ length: 60 }, () => filler),
    energyDeck: Array.from({ length: 24 }, () => energy),
  };
  session.initializeGame(deck, deck);
  const mari = sixEntranceCards.find((c) => c.cardCode === 'PL!S-bp6-008-P')!;
  const instances = [
    createCardInstance(sourceData, owner, 'source'),
    createCardInstance(filler, owner, 'neighbor-left'),
    createCardInstance(filler, owner, 'neighbor-right'),
    createCardInstance(filler, owner, 'relay'),
    createCardInstance(mari, owner, 'mari-source'),
    createCardInstance(filler, opponent, 'opponent-target'),
  ];
  const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
  const waiting = { ...active, orientation: OrientationState.WAITING };
  let state = registerCards(session.state!, instances);
  for (const id of [owner, opponent]) {
    const energies = [...state.cardRegistry.values()]
      .filter((c) => c.ownerId === id && c.data.cardType === CardType.ENERGY)
      .map((c) => c.instanceId);
    const available = energies.slice(0, options.energyCount ?? 24);
    state = updatePlayer(state, id, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: id === owner && !options.mariReplacement ? ['source'] : [] },
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: id === owner && options.mariReplacement ? ['source'] : [],
      },
      energyDeck: { ...p.energyDeck, cardIds: energies.slice(available.length) },
      energyZone: {
        ...p.energyZone,
        cardIds: available,
        cardStates: new Map(available.map((key) => [key, active])),
      },
      memberSlots: {
        ...p.memberSlots,
        slots:
          id === owner
            ? {
                LEFT: 'neighbor-left',
                CENTER: options.mariReplacement ? 'mari-source' : options.relay ? 'relay' : null,
                RIGHT: 'neighbor-right',
              }
            : { LEFT: null, CENTER: 'opponent-target', RIGHT: null },
        cardStates: new Map(
          id === owner
            ? [
                ['neighbor-left', active],
                ['neighbor-right', waiting],
                ...(options.relay ? [['relay', active] as const] : []),
                ...(options.mariReplacement ? [['mari-source', active] as const] : []),
              ]
            : [['opponent-target', active]]
        ),
      },
    }));
  }
  state = {
    ...state,
    isStarted: true,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: owner === 'p1' ? 0 : 1,
    waitingForInput: false,
    waitingPlayerId: null,
    activeEffect: null,
    pendingChoice: null,
    manualOperationMode: 'RULES',
  };
  session.restoreRuntimeState({ authorityState: state, currentPublicSeq: 0 });
  return { session, owner, opponent, sourceData, cardData: [...sixEntranceCards, filler, energy] };
}
