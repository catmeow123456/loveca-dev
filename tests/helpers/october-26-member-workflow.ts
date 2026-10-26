import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createLiveStartEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { getOctober26CardData } from './october-26-card-effects';

const P1 = 'p1',
  P2 = 'p2';
const member = (id: string, group = '蓮ノ空', owner = P1) =>
  createCardInstance(
    {
      cardCode: `SYNTHETIC-${id}`,
      name: `合成${id}`,
      cardType: CardType.MEMBER,
      cost: 2,
      blade: 1,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      groupNames: [group],
    } as MemberCardData,
    owner,
    id
  );

function setup(code: string, handCount = 2): GameState {
  const source = createCardInstance(getOctober26CardData(code), P1, 'source');
  const deck = Array.from({ length: 10 }, (_, i) => member(`deck-${i}`, '虹ヶ咲'));
  const hand = Array.from({ length: handCount }, (_, i) => member(`hand-${i}`));
  const energy = Array.from({ length: 3 }, (_, i) =>
    createCardInstance(
      {
        cardCode: `SYNTHETIC-ENERGY-${i}`,
        name: '合成能量',
        cardType: CardType.ENERGY,
      },
      P1,
      `energy-${i}`
    )
  );
  const successfulLive = createCardInstance(
    {
      cardCode: 'SYNTHETIC-LIVE',
      name: '合成LIVE',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    },
    P1,
    'successful-live'
  );
  let game = registerCards(createGameState('october-26-shared', P1, 'P1', P2, 'P2'), [
    source,
    successfulLive,
    ...deck,
    ...hand,
    ...energy,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: hand.map((c) => c.instanceId) },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
    liveZone: addCardToStatefulZone(p.liveZone, successfulLive.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_DOWN,
    }),
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source', {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: energy.reduce(
      (zone, c) =>
        addCardToStatefulZone(zone, c.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      p.energyZone
    ),
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
  return emitGameEvent(
    game,
    createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
  );
}
function enter(game: GameState): GameState {
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE])
  ).gameState;
}
function live(game: GameState, success = false, resolve = true): GameState {
  const event = success
    ? createLiveSuccessEvent(P1, ['successful-live'], 1)
    : createLiveStartEvent(P1, ['successful-live']);
  const queued = enqueueTriggeredCardEffects(
    emitGameEvent(game, event),
    [event.eventType],
    success
      ? { liveSuccessEvents: [event as ReturnType<typeof createLiveSuccessEvent>] }
      : { liveStartEvents: [event as ReturnType<typeof createLiveStartEvent>] }
  );
  return resolve ? resolvePendingCardEffects(queued).gameState : queued;
}
function choose(
  game: GameState,
  id?: string | null,
  ids?: readonly string[],
  option?: string
): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    id,
    undefined,
    undefined,
    option,
    ids
  );
}
const pay = (game: GameState) => choose(game, undefined, undefined, 'pay');
function roundtrip(game: GameState): GameState {
  return rehydrateAuthorityGameState(
    serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
  );
}
const latest = (game: GameState, abilityId: string) =>
  game.actionHistory.filter((a) => a.payload.abilityId === abilityId).at(-1)?.payload;

export { P1, P2, member, setup, enter, live, choose, pay, roundtrip, latest };
