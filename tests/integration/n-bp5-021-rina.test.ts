import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, cost = 2): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, score = 1): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupRinaScenario(options: {
  readonly mainDeckCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  const rina = createCardInstance(createMember('PL!N-bp5-021-N', 2), PLAYER1, 'rina-source');
  const mainDeckCards = [...options.mainDeckCards];
  const waitingRoomCards = [...(options.waitingRoomCards ?? [])];
  let game = createGameState('n-bp5-021-rina', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [rina, ...mainDeckCards, ...waitingRoomCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: mainDeckCards.map((card) => card.instanceId) },
    waitingRoom: waitingRoomCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, rina.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return emitGameEvent(game, {
    eventId: 'enter-rina',
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: Date.now(),
    cardInstanceId: rina.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: PLAYER1,
    controllerId: PLAYER1,
  });
}

function startOnEnter(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function attachSession(state: GameState) {
  const session = createGameSession();
  session.createGame('n-bp5-021-rina-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function confirmSelection(
  session: ReturnType<typeof createGameSession>,
  selectedCardId?: string | null
): void {
  const effect = session.state?.activeEffect;
  expect(effect).toBeTruthy();
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect!.id, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
}

describe('PL!N-bp5-021-N Rina on-enter workflow', () => {
  it('mills two cards and can insert a freshly milled LIVE as the fourth card from the top', () => {
    const milledLive = createCardInstance(createLive('PL!N-milled-live'), PLAYER1, 'milled-live');
    const milledMember = createCardInstance(
      createMember('PL!N-milled-member'),
      PLAYER1,
      'milled-member'
    );
    const deckRest = [0, 1, 2, 3].map((index) =>
      createCardInstance(createMember(`PL!N-rest-${index}`), PLAYER1, `rest-${index}`)
    );
    const state = startOnEnter(
      setupRinaScenario({ mainDeckCards: [milledLive, milledMember, ...deckRest] })
    );
    const session = attachSession(state);

    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      milledLive.instanceId,
      milledMember.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toContain(milledLive.instanceId);

    confirmSelection(session, milledLive.instanceId);

    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      deckRest[0].instanceId,
      deckRest[1].instanceId,
      deckRest[2].instanceId,
      milledLive.instanceId,
      deckRest[3].instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([milledMember.instanceId]);
  });

  it('can skip the optional insertion after milling two cards', () => {
    const milledLive = createCardInstance(createLive('PL!N-milled-live'), PLAYER1, 'milled-live');
    const milledMember = createCardInstance(
      createMember('PL!N-milled-member'),
      PLAYER1,
      'milled-member'
    );
    const deckRest = createCardInstance(createMember('PL!N-rest'), PLAYER1, 'rest');
    const state = startOnEnter(
      setupRinaScenario({ mainDeckCards: [milledLive, milledMember, deckRest] })
    );
    const session = attachSession(state);

    confirmSelection(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      milledLive.instanceId,
      milledMember.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckRest.instanceId]);
  });

  it('places the selected LIVE on the bottom when fewer than three deck cards remain', () => {
    const milledLive = createCardInstance(createLive('PL!N-milled-live'), PLAYER1, 'milled-live');
    const milledMember = createCardInstance(
      createMember('PL!N-milled-member'),
      PLAYER1,
      'milled-member'
    );
    const deckRest = [0, 1].map((index) =>
      createCardInstance(createMember(`PL!N-short-${index}`), PLAYER1, `short-${index}`)
    );
    const state = startOnEnter(
      setupRinaScenario({ mainDeckCards: [milledLive, milledMember, ...deckRest] })
    );
    const session = attachSession(state);

    confirmSelection(session, milledLive.instanceId);

    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      deckRest[0].instanceId,
      deckRest[1].instanceId,
      milledLive.instanceId,
    ]);
  });
});
