import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { SP_BP7_012_ON_ENTER_BOTTOM_CATCHU_KALEIDOSCORE_FIVEYNCRISE_DRAW_ONE_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const EFFECT_TEXT =
  '【登场】可以从自己的休息室，选择『CatChu!』和『KALEIDOSCORE』和『5yncri5e!』的卡片各1张，将那些卡片按任意顺序放置于卡组底。如此做时，抽1张卡。';

interface WaitingCardSpec {
  readonly id: string;
  readonly unitName: string;
  readonly cardType?: CardType.MEMBER | CardType.LIVE;
}

function memberData(cardCode: string, unitName?: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function liveData(cardCode: string, unitName?: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp7-012-pending',
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['sp-bp7-012-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  waitingSpecs: readonly WaitingCardSpec[] = [
    { id: 'catchu', unitName: 'CatChu!' },
    { id: 'kaleidoscore', unitName: 'KALEIDOSCORE', cardType: CardType.LIVE },
    { id: 'fiveyncrise', unitName: '5yncri5e!' },
    { id: 'unrelated', unitName: 'Sunny Passion' },
  ],
  options: { readonly includeDrawCard?: boolean } = {}
) {
  const source = createCardInstance(memberData('PL!SP-bp7-012-N', 'CatChu!'), PLAYER1, 'source');
  const waitingCards = waitingSpecs.map((spec) =>
    createCardInstance(
      spec.cardType === CardType.LIVE
        ? liveData(spec.id, spec.unitName)
        : memberData(spec.id, spec.unitName),
      PLAYER1,
      spec.id
    )
  );
  const drawCard = createCardInstance(liveData('draw-card'), PLAYER1, 'draw-card');
  const registeredCards =
    options.includeDrawCard === false
      ? [source, ...waitingCards]
      : [source, ...waitingCards, drawCard];
  let game = registerCards(
    createGameState('sp-bp7-012', PLAYER1, 'P1', PLAYER2, 'P2'),
    registeredCards
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: options.includeDrawCard === false ? [] : [drawCard.instanceId],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    source,
    waitingCards,
    drawCard,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function choose(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

describe('PL!SP-bp7-012 费用4「涩谷香音」', () => {
  it('keeps the complete authoritative effect text and base-card rarity coverage', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!SP-bp7-012-SEC');
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      abilityId: ABILITY_ID,
      implemented: true,
      effectText: EFFECT_TEXT,
    });
  });

  it('opens one exact-three ordered optional window containing any card type from the three units', () => {
    const scenario = setup();
    const opened = start(scenario.game);
    expect(opened.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      effectText: EFFECT_TEXT,
      stepId: 'SP_BP7_012_SELECT_WAITING_UNIT_CARDS',
      stepText:
        '可以从自己的休息室选择『CatChu!』、『KALEIDOSCORE』和『5yncri5e!』的卡片各1张。选择顺序会成为放置于卡组底的顺序。',
      selectableCardIds: ['catchu', 'kaleidoscore', 'fiveyncrise'],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 3,
      maxSelectableCards: 3,
      selectionLabel: '按放置顺序选择各小队的卡片',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
          sourcePlayerId: PLAYER1,
          distinctGroupAssignment: true,
        },
      },
    });
  });

  it('publicly confirms the exact order, moves all three atomically, emits one event, then draws one', () => {
    const scenario = setup();
    let now = 10_000;
    const session = createGameSession({ now: () => now });
    session.createGame('sp-bp7-012-session', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = start(scenario.game);
    const order = ['fiveyncrise', 'catchu', 'kaleidoscore'];

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          order
        )
      ).success
    ).toBe(true);
    const reveal = session.state!.activeEffect!;
    expect(reveal).toMatchObject({
      stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
      revealedCardIds: order,
      publicCardSelectionOrdered: true,
    });
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([
      'catchu',
      'kaleidoscore',
      'fiveyncrise',
      'unrelated',
    ]);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    for (const playerId of [PLAYER1, PLAYER2]) {
      expect(session.getPlayerViewState(playerId)?.activeEffect).toMatchObject({
        revealedObjectIds: order.map((cardId) => `obj_${cardId}`),
        publicCardSelectionAutoAdvanceAt: reveal.publicCardSelectionAutoAdvanceAt,
      });
    }

    now = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          PLAYER2,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(order);
    expect(session.state!.players[0].hand.cardIds).toEqual(['draw-card']);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['unrelated']);
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
    const movementEvents = session.state!.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
    expect(movementEvents).toHaveLength(1);
    expect(movementEvents[0]!.event).toMatchObject({ movedCardIds: order });
    expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'BOTTOM_WAITING_UNIT_CARDS_DRAW_ONE',
      selectedCardIds: order,
      movedCardIds: order,
      drawnCardIds: ['draw-card'],
    });
  });

  it('allows declining without a public window, movement, event, or draw', () => {
    const scenario = setup();
    const opened = start(scenario.game);
    const declined = choose(opened, []);
    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.players[0].waitingRoom.cardIds).toEqual(opened.players[0].waitingRoom.cardIds);
    expect(declined.players[0].mainDeck.cardIds).toEqual(['draw-card']);
    expect(declined.players[0].hand.cardIds).toEqual([]);
    expect(
      declined.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toEqual([]);
  });

  it('consumes the pending ability without opening a window unless three distinct cards can cover all units', () => {
    const oneMultiIdentityCard = setup([
      {
        id: 'all-units',
        unitName: 'CatChu!／KALEIDOSCORE／5yncri5e!',
      },
      { id: 'unrelated-a', unitName: 'Sunny Passion' },
      { id: 'unrelated-b', unitName: 'Sunny Passion' },
    ]);
    const resolved = start(oneMultiIdentityCard.game);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([
      'all-units',
      'unrelated-a',
      'unrelated-b',
    ]);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NO_COMPLETE_UNIT_ASSIGNMENT',
      movedCardIds: [],
      drawnCardIds: [],
    });
  });

  it('uses a real distinct-card matching assignment for overlapping multi-unit identities', () => {
    const scenario = setup([
      { id: 'cat-kaleido', unitName: 'CatChu!／KALEIDOSCORE' },
      { id: 'cat-five', unitName: 'CatChu!／5yncri5e!' },
      { id: 'kaleido-five', unitName: 'KALEIDOSCORE／5yncri5e!' },
      { id: 'cat-only', unitName: 'CatChu!' },
    ]);
    const opened = start(scenario.game);
    const overlappingOrder = ['cat-kaleido', 'cat-five', 'kaleido-five'];
    const resolved = choose(opened, overlappingOrder);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(overlappingOrder);
    expect(resolved.players[0].hand.cardIds).toEqual(['draw-card']);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual(['cat-only']);

    const invalid = start(
      setup([
        { id: 'cat-a', unitName: 'CatChu!' },
        { id: 'cat-b', unitName: 'CatChu!' },
        { id: 'cat-c', unitName: 'CatChu!' },
        { id: 'kaleido', unitName: 'KALEIDOSCORE' },
        { id: 'five', unitName: '5yncri5e!' },
      ]).game
    );
    const unchanged = choose(invalid, ['cat-a', 'cat-b', 'cat-c']);
    expect(unchanged).toBe(invalid);
    expect(unchanged.activeEffect?.stepId).toBe('SP_BP7_012_SELECT_WAITING_UNIT_CARDS');
  });

  it('revalidates at public-confirmation expiry and consumes stale selection without partial movement or draw', () => {
    const scenario = setup();
    let now = 10_000;
    const session = createGameSession({ now: () => now });
    session.createGame('sp-bp7-012-stale', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = start(scenario.game);
    const order = ['catchu', 'kaleidoscore', 'fiveyncrise'];
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        order
      )
    );
    const reveal = session.state!.activeEffect!;
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== 'kaleidoscore'),
        },
      })
    );

    now = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          PLAYER1,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['draw-card']);
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([
      'catchu',
      'fiveyncrise',
      'unrelated',
    ]);
    expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SELECTED_UNIT_CARDS_LEFT_WAITING_ROOM',
      movedCardIds: [],
      drawnCardIds: [],
    });
  });

  it('keeps source-independent resolution and moves first when the original deck is empty', () => {
    const scenario = setup(undefined, { includeDrawCard: false });
    let opened = start(scenario.game);
    opened = updatePlayer(opened, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const order = ['fiveyncrise', 'catchu', 'kaleidoscore'];
    const resolved = choose(opened, order);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual(['fiveyncrise']);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(['catchu', 'kaleidoscore']);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      movedCardIds: order,
      drawnCardIds: ['fiveyncrise'],
    });
  });
});
