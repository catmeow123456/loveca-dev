import {
  resolvePendingCardEffects,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type BladeHeartItem,
  type CardInstance,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  HeartColor,
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmActiveEffectStepThroughPublicReveal } from './public-card-selection-confirmation';

export const P1 = 'player1';
export const P2 = 'player2';

export function live(
  id: string,
  bladeHearts: readonly BladeHeartItem[] = [],
  options: { name?: string; groups?: readonly string[]; owner?: string; code?: string } = {}
): CardInstance {
  const data: LiveCardData = {
    cardCode: options.code ?? id,
    name: options.name ?? id,
    groupNames: options.groups ?? ['Aqours'],
    cardType: CardType.LIVE,
    score: 9,
    requirements: createHeartRequirement({}),
    bladeHearts,
  };
  return createCardInstance(data, options.owner ?? P1, id);
}

export function member(id: string, groups: readonly string[] = ['Aqours']): CardInstance {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    groupNames: groups,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
  return createCardInstance(data, P1, id);
}

export function setup(
  code: string,
  abilityId: string,
  waiting: readonly CardInstance[],
  options: {
    success?: readonly CardInstance[];
    centerGroups?: readonly string[];
    laterPending?: boolean;
  } = {}
) {
  const source = live('source', [], { code });
  const center = member('center', options.centerGroups);
  const side = member('side');
  const deck = live('deck');
  const success = options.success ?? [];
  let game = registerCards(createGameState('cl1-ordered-return', P1, 'P1', P2, 'P2'), [
    source,
    center,
    side,
    deck,
    ...waiting,
    ...success,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    waitingRoom: { ...p.waitingRoom, cardIds: waiting.map((card) => card.instanceId) },
    successZone: success.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      p.successZone
    ),
    liveZone: addCardToStatefulZone(p.liveZone, 'source'),
    memberSlots: placeCardInSlot(
      placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'center', {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      'side',
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  const pending = {
    id: 'return-pending',
    abilityId,
    sourceCardId: 'source',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
  };
  game = resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
  if (options.laterPending)
    game = { ...game, pendingAbilities: [{ ...pending, id: 'later-pending' }] };
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('cl1-ordered-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    game,
    session,
    setNow: (value: number) => {
      now = value;
    },
  };
}

export function choose(game: GameState, selected: readonly string[]): GameState {
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selected
  );
}

export function selectOnce(game: GameState, selected: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selected
  );
}

export function selectSession(scenario: ReturnType<typeof setup>, selected: readonly string[]) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      scenario.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selected
    )
  );
}

export function expire(scenario: ReturnType<typeof setup>, participant = P2) {
  const effect = scenario.session.state!.activeEffect!;
  scenario.setNow(effect.publicCardSelectionAutoAdvanceAt!);
  return scenario.session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(
      participant,
      effect.id,
      effect.publicCardSelectionAutoAdvanceAt!
    )
  );
}

export function movementEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}
