import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly hearts?: readonly { readonly color: HeartColor; readonly count: number }[];
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  options: {
    readonly groupNames?: readonly string[];
    readonly requirements?: Partial<Record<HeartColor, number>>;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement(options.requirements ?? { [HeartColor.PINK]: 1 }),
  };
}

function placeStageMember(game: GameState, cardId: string, slot = SlotPosition.CENTER): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setPlayerZones(
  game: GameState,
  zones: {
    readonly hand?: readonly string[];
    readonly mainDeck?: readonly string[];
    readonly waitingRoom?: readonly string[];
  }
): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: zones.hand
      ? zones.hand.reduce((zone, cardId) => addCardToZone(zone, cardId), {
          ...player.hand,
          cardIds: [],
        })
      : player.hand,
    mainDeck: zones.mainDeck
      ? {
          ...player.mainDeck,
          cardIds: [...zones.mainDeck],
        }
      : player.mainDeck,
    waitingRoom: zones.waitingRoom
      ? {
          ...player.waitingRoom,
          cardIds: [...zones.waitingRoom],
        }
      : player.waitingRoom,
  }));
}

function enterWaitingRoomEvents(game: GameState): readonly {
  readonly fromZone: ZoneType;
  readonly cardInstanceIds?: readonly string[];
}[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM) as readonly {
    readonly fromZone: ZoneType;
    readonly cardInstanceIds?: readonly string[];
  }[];
}

function createMainPhaseSession(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame(state.gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...state,
    turnCount: 1,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    isStarted: true,
  };
  return session;
}

describe('PL!-bp6-006 Maki workflow', () => {
  it('PL!-bp6-006 cannot activate without a hand card and does not consume turn once', () => {
    const maki = createCardInstance(
      createMemberCard('PL!-bp6-006-R＋', { name: '西木野真姫', cost: 17 }),
      PLAYER1,
      'maki-no-hand'
    );
    let game = registerCards(createGameState('bp6-006-no-hand', PLAYER1, 'P1', PLAYER2, 'P2'), [maki]);
    game = placeStageMember(game, maki.instanceId);
    game = setPlayerZones(game, { hand: [] });
    const session = createMainPhaseSession(game);

    session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        maki.instanceId,
        BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID
      )
    );

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('PL!-bp6-006 pays discard cost, chooses a color, takes a μ’s card, and gains BLADE +3', () => {
    const maki = createCardInstance(
      createMemberCard('PL!-bp6-006-SEC', { name: '西木野真姫', cost: 17 }),
      PLAYER1,
      'maki-success'
    );
    const cost = createCardInstance(createMemberCard('cost-card'), PLAYER1, 'cost-card');
    const revealedCards = [
      createCardInstance(
        createMemberCard('PL!-muse-red-member', {
          name: 'μs red',
          hearts: [createHeartIcon(HeartColor.RED, 1)],
        }),
        PLAYER1,
        'muse-red-member'
      ),
      createCardInstance(
        createMemberCard('PL!-muse-red-member-2', {
          name: 'μs red 2',
          hearts: [createHeartIcon(HeartColor.RED, 1)],
        }),
        PLAYER1,
        'muse-red-member-2'
      ),
      createCardInstance(
        createMemberCard('PL!S-red-member', {
          name: 'aqours red',
          groupNames: ['Aqours'],
          hearts: [createHeartIcon(HeartColor.RED, 1)],
        }),
        PLAYER1,
        'aqours-red-member'
      ),
      createCardInstance(
        createLiveCard('PL!-muse-red-live', { requirements: { [HeartColor.RED]: 1 } }),
        PLAYER1,
        'muse-red-live'
      ),
      createCardInstance(
        createLiveCard('PL!S-red-live', {
          groupNames: ['Aqours'],
          requirements: { [HeartColor.RED]: 1 },
        }),
        PLAYER1,
        'aqours-red-live'
      ),
    ];
    let game = registerCards(createGameState('bp6-006-success', PLAYER1, 'P1', PLAYER2, 'P2'), [
      maki,
      cost,
      ...revealedCards,
    ]);
    game = placeStageMember(game, maki.instanceId);
    game = setPlayerZones(game, {
      hand: [cost.instanceId],
      mainDeck: revealedCards.map((card) => card.instanceId),
    });
    const session = createMainPhaseSession(game);

    session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        maki.instanceId,
        BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID
      )
    );
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, cost.instanceId)
    );
    expect(session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toContain(
      HeartColor.RED
    );
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.RED
      )
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      revealedCards[0]!.instanceId,
      revealedCards[1]!.instanceId,
      revealedCards[3]!.instanceId,
    ]);
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        revealedCards[0]!.instanceId
      )
    );

    const player = getPlayerById(session.state!, PLAYER1)!;
    expect(player.hand.cardIds).toEqual([revealedCards[0]!.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([
      revealedCards[1]!.instanceId,
      revealedCards[2]!.instanceId,
      revealedCards[3]!.instanceId,
      revealedCards[4]!.instanceId,
    ]);
    expect(player.mainDeck.cardIds).toEqual([cost.instanceId]);
    expect(session.state!.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 3,
      sourceCardId: maki.instanceId,
      abilityId: BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
    });
    expect(
      session.state!.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    expect(enterWaitingRoomEvents(session.state!).map((event) => event.fromZone)).toEqual([
      ZoneType.HAND,
      ZoneType.MAIN_DECK,
    ]);
  });

  it('PL!-bp6-006 refreshes a short deck from waiting room, takes a μ’s card, and gains BLADE +3', () => {
    const maki = createCardInstance(
      createMemberCard('PL!-bp6-006-R＋', { name: '西木野真姫', cost: 17 }),
      PLAYER1,
      'maki-short-refresh'
    );
    const cost = createCardInstance(
      createMemberCard('cost-card', { hearts: [createHeartIcon(HeartColor.RED, 1)] }),
      PLAYER1,
      'cost-card'
    );
    const mainDeckCards = [
      createCardInstance(
        createMemberCard('PL!-main-red-member-1', {
          hearts: [createHeartIcon(HeartColor.RED, 1)],
        }),
        PLAYER1,
        'main-red-1'
      ),
      createCardInstance(
        createLiveCard('PL!-main-red-live', { requirements: { [HeartColor.RED]: 1 } }),
        PLAYER1,
        'main-red-live'
      ),
    ];
    const waitingRoomCards = [
      createCardInstance(
        createMemberCard('PL!-waiting-red-member-1', {
          hearts: [createHeartIcon(HeartColor.RED, 1)],
        }),
        PLAYER1,
        'waiting-red-1'
      ),
      createCardInstance(
        createMemberCard('PL!-waiting-red-member-2', {
          hearts: [createHeartIcon(HeartColor.RED, 1)],
        }),
        PLAYER1,
        'waiting-red-2'
      ),
      createCardInstance(
        createLiveCard('PL!-waiting-red-live', { requirements: { [HeartColor.RED]: 1 } }),
        PLAYER1,
        'waiting-red-live'
      ),
    ];
    let game = registerCards(
      createGameState('bp6-006-short-refresh', PLAYER1, 'P1', PLAYER2, 'P2'),
      [maki, cost, ...mainDeckCards, ...waitingRoomCards]
    );
    game = placeStageMember(game, maki.instanceId);
    game = setPlayerZones(game, {
      hand: [cost.instanceId],
      mainDeck: mainDeckCards.map((card) => card.instanceId),
      waitingRoom: waitingRoomCards.map((card) => card.instanceId),
    });
    const session = createMainPhaseSession(game);

    session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        maki.instanceId,
        BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID
      )
    );
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, cost.instanceId)
    );
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.RED
      )
    );

    const inspectedCardIds = session.state!.activeEffect!.inspectionCardIds!;
    const selectedCardId = session.state!.activeEffect!.selectableCardIds![0]!;
    expect(inspectedCardIds).toHaveLength(5);
    expect(inspectedCardIds.slice(0, 2)).toEqual(mainDeckCards.map((card) => card.instanceId));
    expect(session.state!.activeEffect!.selectableCardIds).toHaveLength(5);
    expect(
      session.state!.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 4 &&
          action.payload.mainDeckCountAfter === 6
      )
    ).toBe(true);

    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    const player = getPlayerById(session.state!, PLAYER1)!;
    expect(player.hand.cardIds).toEqual([selectedCardId]);
    expect(player.waitingRoom.cardIds).toEqual(
      inspectedCardIds.filter((cardId) => cardId !== selectedCardId)
    );
    expect(player.mainDeck.cardIds).toHaveLength(1);
    expect(player.mainDeck.cardIds.every((cardId) => !inspectedCardIds.includes(cardId))).toBe(
      true
    );
    expect(session.state!.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 3,
      sourceCardId: maki.instanceId,
      abilityId: BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID,
    });
  });

  it('PL!-bp6-006 sends all revealed cards to waiting room when the color condition is not met or total available cards are fewer than five', () => {
    const maki = createCardInstance(createMemberCard('PL!-bp6-006-P'), PLAYER1, 'maki-miss');
    const cost = createCardInstance(createMemberCard('cost-card'), PLAYER1, 'cost-card');
    const revealedCards = [
      createCardInstance(
        createMemberCard('PL!-red-member', { hearts: [createHeartIcon(HeartColor.RED, 1)] }),
        PLAYER1,
        'red-member'
      ),
      createCardInstance(
        createMemberCard('PL!-blue-member', { hearts: [createHeartIcon(HeartColor.BLUE, 1)] }),
        PLAYER1,
        'blue-member'
      ),
      createCardInstance(createLiveCard('PL!-red-live', { requirements: { [HeartColor.RED]: 1 } }), PLAYER1, 'red-live'),
    ];
    let game = registerCards(createGameState('bp6-006-miss', PLAYER1, 'P1', PLAYER2, 'P2'), [
      maki,
      cost,
      ...revealedCards,
    ]);
    game = placeStageMember(game, maki.instanceId);
    game = setPlayerZones(game, {
      hand: [cost.instanceId],
      mainDeck: revealedCards.map((card) => card.instanceId),
    });
    const session = createMainPhaseSession(game);

    session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        maki.instanceId,
        BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID
      )
    );
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, cost.instanceId)
    );
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.RED
      )
    );

    const player = getPlayerById(session.state!, PLAYER1)!;
    expect(session.state?.activeEffect).toBeNull();
    expect(player.hand.cardIds).toEqual([]);
    expect(player.waitingRoom.cardIds).toEqual([
      ...revealedCards.map((card) => card.instanceId),
      cost.instanceId,
    ]);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
  });

  it('PL!-bp6-006 does not add BLADE when five revealed cards match but none is μ’s', () => {
    const maki = createCardInstance(createMemberCard('PL!-bp6-006-P＋'), PLAYER1, 'maki-no-muse');
    const cost = createCardInstance(createMemberCard('cost-card'), PLAYER1, 'cost-card');
    const revealedCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(
        createMemberCard(`PL!S-red-member-${index}`, {
          groupNames: ['Aqours'],
          hearts: [createHeartIcon(HeartColor.RED, 1)],
        }),
        PLAYER1,
        `aqours-red-${index}`
      )
    );
    let game = registerCards(createGameState('bp6-006-no-muse', PLAYER1, 'P1', PLAYER2, 'P2'), [
      maki,
      cost,
      ...revealedCards,
    ]);
    game = placeStageMember(game, maki.instanceId);
    game = setPlayerZones(game, {
      hand: [cost.instanceId],
      mainDeck: revealedCards.map((card) => card.instanceId),
    });
    const session = createMainPhaseSession(game);

    session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        maki.instanceId,
        BP6_006_ACTIVATED_DISCARD_CHOOSE_COLOR_REVEAL_FIVE_MUSE_HAND_BLADE_ABILITY_ID
      )
    );
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, cost.instanceId)
    );
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.RED
      )
    );

    expect(session.state?.activeEffect).toBeNull();
    expect(getPlayerById(session.state!, PLAYER1)!.hand.cardIds).toEqual([]);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state!.actionHistory.some(
        (action) => action.payload.step === 'CONDITION_MET_NO_MUSE_TARGET'
      )
    ).toBe(true);
  });
});
