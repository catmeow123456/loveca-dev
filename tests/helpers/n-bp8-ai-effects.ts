import { expect } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import { getOctober29MemberData } from './october-29-draft-effects';
import { confirmPublicSelectionIfNeeded } from './public-card-selection-confirmation';

export const P1 = 'p1',
  P2 = 'p2',
  SOURCE = 'ai',
  TARGET = 'waiting-member',
  LIVE = 'waiting-live';
export function setAiState(session: GameSession, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}
export function testMember(id: string, owner = P1, group = '虹ヶ咲', code = `TEST-${id}`) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    cardType: CardType.MEMBER,
    groupNames: [group],
    cost: 2,
    blade: 1,
    hearts: [{ color: HeartColor.YELLOW, count: 1 }],
  };
  return createCardInstance(data, owner, id);
}
export function setupAi(
  options: {
    base?: 'PL!N-bp8-005' | 'PL!N-bp8-017';
    rarity?: string;
    host?: 'LL' | 'REN' | 'OTHER';
    copies?: number;
    energies?: number;
    active?: number;
    marked?: readonly string[];
    target?: boolean;
    live?: boolean;
    inHand?: boolean;
    energyDeckCount?: number;
  } = {}
) {
  const base = options.base ?? 'PL!N-bp8-005';
  const original = getOctober29MemberData(base);
  const data = { ...original, cardCode: `${base}-${options.rarity ?? original.rare}` };
  const host = options.host
    ? testMember(
        SOURCE,
        P1,
        options.host === 'REN' ? 'Liella!' : '虹ヶ咲',
        options.host === 'LL'
          ? 'LL-bp8-001-SEC'
          : options.host === 'REN'
            ? 'PL!SP-pb2-005-R'
            : 'TEST-HOST'
      )
    : null;
  const source = host
    ? createCardInstance(
        { ...host.data, cost: options.host === 'LL' ? 15 : options.host === 'REN' ? 20 : 2 },
        P1,
        SOURCE
      )
    : createCardInstance(data, P1, SOURCE);
  const below = options.host
    ? Array.from({ length: options.copies ?? 1 }, (_, index) =>
        createCardInstance(data, P1, `below-${index}`)
      )
    : [];
  const target = testMember(TARGET);
  const live = createCardInstance(
    {
      cardCode: 'TEST-LIVE',
      name: LIVE,
      cardType: CardType.LIVE,
      score: 1,
      groupNames: ['虹ヶ咲'],
      requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    },
    P1,
    LIVE
  );
  const energies = Array.from({ length: options.energies ?? 3 }, (_, i) =>
    createCardInstance(
      { cardCode: `E-${i}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `e${i}`
    )
  );
  const deckEnergy = Array.from({ length: options.energyDeckCount ?? 0 }, (_, i) =>
    createCardInstance(
      { cardCode: `ED-${i}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `ed${i}`
    )
  );
  const session = createGameSession();
  session.createGame(`ai:${base}`, P1, 'P1', P2, 'P2');
  let state = registerCards(session.state!, [
    source,
    target,
    live,
    ...below,
    ...energies,
    ...deckEnergy,
    testMember('deck'),
    testMember('other-group', P1, 'Liella!'),
  ]);
  state = updatePlayer(state, P1, (player) => {
    let memberSlots = options.inHand
      ? player.memberSlots
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        });
    for (const card of below)
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, card.instanceId);
    return {
      ...player,
      memberSlots,
      hand: { ...player.hand, cardIds: options.inHand ? [SOURCE] : [] },
      mainDeck: { ...player.mainDeck, cardIds: ['deck'] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [
          ...(options.target !== false ? [TARGET, 'other-group'] : []),
          ...(options.live !== false ? [LIVE] : []),
        ],
      },
      energyDeck: { ...player.energyDeck, cardIds: deckEnergy.map((card) => card.instanceId) },
      energyZone: energies.reduce(
        (zone, card, i) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation:
              i < (options.active ?? 1) ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    };
  });
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    energyActivePhaseSkips: (options.marked ?? []).map((energyCardId) => ({
      playerId: P1,
      energyCardId,
      sourceCardId: 'marker',
      abilityId: 'marker',
    })),
  };
  if (!options.inHand)
    state = emitGameEvent(
      state,
      createEnterStageEvent(SOURCE, ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
  setAiState(session, state);
  return session;
}
export function activateAi(session: GameSession, abilityId: string, instance?: string) {
  return session.executeCommand(createActivateAbilityCommand(P1, SOURCE, abilityId, instance));
}
export function chooseAi(session: GameSession, cardId?: string | null, cards?: readonly string[]) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      cardId,
      undefined,
      undefined,
      undefined,
      cards
    )
  );
  expect(result.success, result.error).toBe(true);
  return result;
}
export function finishAiRecovery(session: GameSession, cardId = TARGET): void {
  chooseAi(session, cardId);
  confirmPublicSelectionIfNeeded(session);
}
