import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP8_004_ACTIVATED_BOTTOM_TWO_NO_BLADE_HEART_MUSE_GAIN_COST_ABILITY_ID as UMI,
  PL_BP8_006_ACTIVATED_WAITING_ROOM_PAY_TWO_BOTTOM_SELF_RECOVER_MUSE_LIVE_ABILITY_ID as MAKI,
  PL_BP8_010_ACTIVATED_WAIT_SELF_BOTTOM_UP_TO_TWO_WAITING_CARDS_ABILITY_ID as HONOKA,
} from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  type CardInstance,
  type LiveCardData,
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
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getOctober26CardData } from './october-26-card-effects';

export const P1 = 'p1',
  P2 = 'p2';
const sourceCodes = {
  [UMI]: 'PL!-bp8-004-P',
  [MAKI]: 'PL!-bp8-006-P',
  [HONOKA]: 'PL!-bp8-010-N',
} as const;

export function setup(
  abilityId: keyof typeof sourceCodes,
  options: {
    waiting?: readonly string[];
    energies?: number;
    marked?: boolean;
    watcher?: boolean;
  } = {}
): GameState {
  const memberData = getOctober26CardData('PL!-bp8-004-P') as MemberCardData;
  const liveData = getOctober26CardData('PL!N-bp8-031-SECL') as LiveCardData;
  const cards: CardInstance[] = [
    createCardInstance(getOctober26CardData(sourceCodes[abilityId]), P1, 'source'),
    createCardInstance(memberData, P1, 'member-1'),
    createCardInstance(getOctober26CardData('PL!-bp8-006-P'), P1, 'member-2'),
    createCardInstance(getOctober26CardData('PL!-bp8-010-N'), P1, 'blade-heart-member'),
    createCardInstance(getOctober26CardData('PL!N-bp8-006-R'), P1, 'other-group-member'),
    createCardInstance(memberData, P2, 'opponent-member'),
    // Controlled target variations isolate identity/type filtering without borrowing another export.
    createCardInstance(
      { ...liveData, cardCode: 'TEST-MUSE-LIVE', groupNames: ['μ’s'] },
      P1,
      'muse-live'
    ),
    createCardInstance(liveData, P1, 'other-live'),
    createCardInstance(memberData, P1, 'deck-tail'),
    createCardInstance(
      { ...memberData, cardCode: 'PL!HS-bp8-001-P', name: '日野下花帆', groupNames: ['莲之空'] },
      P1,
      'watcher'
    ),
    ...Array.from({ length: options.energies ?? 2 }, (_, index) =>
      createCardInstance(
        { cardType: CardType.ENERGY, cardCode: `TEST-ENERGY-${index}`, name: '测试能量' },
        P1,
        `energy-${index}`
      )
    ),
  ];
  let game = registerCards(createGameState('bp8-activated-costs', P1, '己方', P2, '对方'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots:
      abilityId === MAKI
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source', {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...(abilityId === MAKI ? ['source'] : []),
        ...(options.waiting ?? ['member-1', 'member-2', 'muse-live']),
      ],
    },
    mainDeck: { ...player.mainDeck, cardIds: ['deck-tail'] },
    energyZone: Array.from(
      { length: options.energies ?? 2 },
      (_, index) => `energy-${index}`
    ).reduce(
      (zone, id) =>
        addCardToStatefulZone(zone, id, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  if (options.watcher)
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'watcher'),
    }));
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
    ...(options.marked
      ? {
          energyActivePhaseSkips: [
            { playerId: P1, energyCardId: 'energy-2', sourceCardId: 'marker', abilityId: 'marker' },
          ],
        }
      : {}),
  };
}

export const activate = (game: GameState, ability: string) =>
  activateCardAbility(game, P1, 'source', ability);
export const select = (game: GameState, ids: readonly string[]) =>
  confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    ids
  );
export const advance = (game: GameState) =>
  confirmActiveEffectStep(game, P1, game.activeEffect!.id);
export const payActions = (game: GameState, ability: string) =>
  game.actionHistory.filter(
    (action) => action.type === 'PAY_COST' && action.payload.abilityId === ability
  );
export const uses = (game: GameState, ability: string) =>
  game.actionHistory.filter(
    (action) => action.payload.abilityId === ability && action.payload.step === 'ABILITY_USE'
  );
export const events = (game: GameState, kind: TriggerCondition) =>
  game.eventLog.filter(({ event }) => event.eventType === kind).map(({ event }) => event);
export const bottomEvents = (game: GameState) =>
  events(game, TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK);

export function sessionFor(game: GameState) {
  const session = createGameSession();
  session.createGame(game.gameId, P1, '己方', P2, '对方');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

export function reenter(game: GameState): GameState {
  const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    P1,
    'source',
    enqueueTriggeredCardEffects
  )!.gameState;
  const entered = updatePlayer(left, P1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'source'),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source'),
  }));
  return emitGameEvent(
    entered,
    createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
  );
}
