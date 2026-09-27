import {
  BladeHeartEffect,
  CardType,
  HeartColor as C,
  GamePhase,
  SubPhase,
} from '../../src/shared/types/enums';
import type { ViewCardObject, ViewFrontCardInfo } from '../../src/online/types';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';
import type { AiKnowledgeMaterial } from '../../src/server/ai-battle/presets';
export function createProbabilityFixture() {
  const member = (cardCode: string, color?: C): ViewFrontCardInfo => ({
    cardCode,
    cardType: CardType.MEMBER,
    cost: 2,
    bladeHearts: color ? [{ effect: BladeHeartEffect.HEART, heartColor: color }] : [],
  });
  const pink = member('P', C.PINK),
    blue = member('B', C.BLUE),
    blank = member('N');
  const lives: ViewFrontCardInfo[] = [2, 3].map((count, i) => ({
    cardCode: `L${i}`,
    cardType: CardType.LIVE,
    score: i + 1,
    requiredHearts: { colorRequirements: { PINK: count }, totalRequired: count },
    bladeHearts: [],
  }));
  const objects: Record<string, ViewCardObject> = {};
  for (const [id, frontInfo] of [
    ['l0', lives[0]],
    ['l1', lives[1]],
    ['mp', pink],
    ['mb', blue],
    ['stage', blank],
    ['wp', pink],
    ['wn', blank],
  ] as const) {
    objects[id] = {
      publicObjectId: id,
      ownerSeat: 'FIRST',
      controllerSeat: 'FIRST',
      surface: 'FRONT',
      frontInfo,
    };
  }
  const input: AiDecisionInput = {
    purpose: 'LIVE_SET',
    responseSchema: {},
    liveSet: {
      selectionMode: 'FINAL_SET_AND_CONFIRM',
      setCardObjectIds: [],
      setCount: 0,
      setLimit: 3,
      drawCountRule: 'FINAL_SET_COUNT',
    },
    space: {
      kind: 'CARDS',
      min: 0,
      max: 3,
      ordered: false,
      candidates: ['l0', 'l1', 'mp', 'mb'].map((objectId, i) => ({
        ref: `c${i + 1}`,
        objectId,
        description: objectId,
      })),
    },
    state: {
      turn: 4,
      phase: GamePhase.LIVE_SET_PHASE,
      subPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      selfSeat: 'FIRST',
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      objects,
      table: {
        zones: {
          FIRST_MAIN_DECK: { ownerSeat: 'FIRST', zone: 'MAIN_DECK', count: 6, ordered: true },
          FIRST_HAND: {
            ownerSeat: 'FIRST',
            zone: 'HAND',
            count: 4,
            ordered: false,
            objectIds: ['l0', 'l1', 'mp', 'mb'],
          },
          FIRST_MEMBER_LEFT: {
            ownerSeat: 'FIRST',
            zone: 'MEMBER_SLOT',
            count: 1,
            ordered: false,
            slotMap: { LEFT: 'stage' },
            overlays: { LEFT: [] },
            memberBelow: { LEFT: [] },
          },
          FIRST_WAITING_ROOM: {
            ownerSeat: 'FIRST',
            zone: 'WAITING_ROOM',
            count: 2,
            ordered: false,
            objectIds: ['wp', 'wn'],
          },
        },
      },
      selfResources: {
        handCards: [],
        handLiveCount: 2,
        stageMembers: [],
        stageHeartCounts: { PINK: 1 },
        stageHeartTotal: 1,
        activeMemberBladeTotal: 2,
        activeEnergyCount: 0,
        successfulLiveCount: 1,
        waitingRoomSummary: '',
      },
    },
  };
  const ownDeck: AiKnowledgeMaterial = {
    id: 'deck:test',
    title: 'synthetic',
    source: 'synthetic',
    sha256: 'synthetic',
    content: JSON.stringify({
      cards: [
        { card: pink, count: 5 },
        { card: blue, count: 2 },
        { card: blank, count: 4 },
        ...lives.map((card) => ({ card, count: 1 })),
        { card: { cardCode: 'energy', cardType: 'ENERGY' }, count: 12 },
      ],
    }),
  };
  return { input, ownDeck, pink };
}
