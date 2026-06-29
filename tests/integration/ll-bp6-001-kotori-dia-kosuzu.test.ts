import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  LL_BP6_001_LIVE_START_DISCARD_NAMED_MEMBERS_GAIN_HEARTS_ABILITY_ID,
  LL_BP6_001_ON_ENTER_LOOK_TOP_SIX_TAKE_TWO_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupName?: string;
    readonly hearts?: readonly { readonly color: HeartColor; readonly count: number }[];
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupName: options.groupName ?? "μ's",
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${abilityId}:event`],
    sourceSlot,
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

describe('LL-bp6-001 Kotori & Dia & Kosuzu workflow', () => {
  it('LL-bp6-001 on-enter looks top six, takes two, and sends the rest to waiting room with events', () => {
    const source = createCardInstance(
      createMemberCard('LL-bp6-001-R＋', { name: '南 ことり&黒澤ダイヤ&徒町小鈴', cost: 20 }),
      PLAYER1,
      'll-source'
    );
    const deckCards = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(createMemberCard(`deck-${index}`), PLAYER1, `deck-${index}`)
    );
    let game = registerCards(createGameState('ll-bp6-001-on-enter', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      ...deckCards,
    ]);
    game = placeStageMember(game, source.instanceId);
    game = setPlayerZones(game, { mainDeck: deckCards.map((card) => card.instanceId) });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          LL_BP6_001_ON_ENTER_LOOK_TOP_SIX_TAKE_TWO_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };

    let resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect?.inspectionCardIds).toEqual(deckCards.map((card) => card.instanceId));
    resolved = confirmActiveEffectStep(
      resolved,
      PLAYER1,
      resolved.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [deckCards[1]!.instanceId, deckCards[4]!.instanceId]
    );

    const player = getPlayerById(resolved, PLAYER1)!;
    expect(player.hand.cardIds).toEqual([deckCards[1]!.instanceId, deckCards[4]!.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([
      deckCards[0]!.instanceId,
      deckCards[2]!.instanceId,
      deckCards[3]!.instanceId,
      deckCards[5]!.instanceId,
    ]);
    expect(enterWaitingRoomEvents(resolved)).toHaveLength(1);
    expect(enterWaitingRoomEvents(resolved)[0]).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      cardInstanceIds: player.waitingRoom.cardIds,
    });
  });

  it('LL-bp6-001 on-enter clamps exact two selection for a short deck', () => {
    const source = createCardInstance(createMemberCard('LL-bp6-001-R＋'), PLAYER1, 'll-short');
    const onlyCard = createCardInstance(createMemberCard('short-deck-card'), PLAYER1, 'short-card');
    let game = registerCards(createGameState('ll-bp6-001-short', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      onlyCard,
    ]);
    game = placeStageMember(game, source.instanceId);
    game = setPlayerZones(game, { mainDeck: [onlyCard.instanceId] });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          LL_BP6_001_ON_ENTER_LOOK_TOP_SIX_TAKE_TWO_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };

    let resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect?.maxSelectableCards).toBeUndefined();
    resolved = confirmActiveEffectStep(
      resolved,
      PLAYER1,
      resolved.activeEffect!.id,
      onlyCard.instanceId
    );

    const player = getPlayerById(resolved, PLAYER1)!;
    expect(player.hand.cardIds).toEqual([onlyCard.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([]);
  });

  it('LL-bp6-001 live-start can choose zero named cards as a no-op', () => {
    const source = createCardInstance(createMemberCard('LL-bp6-001-R＋'), PLAYER1, 'll-live-zero');
    const kotori = createCardInstance(
      createMemberCard('PL!-kotori', { name: '南ことり' }),
      PLAYER1,
      'kotori'
    );
    let game = registerCards(createGameState('ll-bp6-001-zero', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      kotori,
    ]);
    game = placeStageMember(game, source.instanceId);
    game = setPlayerZones(game, { hand: [kotori.instanceId] });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          LL_BP6_001_LIVE_START_DISCARD_NAMED_MEMBERS_GAIN_HEARTS_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    let resolved = resolvePendingCardEffects(game).gameState;
    resolved = confirmActiveEffectStep(resolved, PLAYER1, resolved.activeEffect!.id);

    expect(getPlayerById(resolved, PLAYER1)!.hand.cardIds).toEqual([kotori.instanceId]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('LL-bp6-001 live-start only allows the three named members and deduplicates printed heart colors', () => {
    const source = createCardInstance(createMemberCard('LL-bp6-001-R＋'), PLAYER1, 'll-live');
    const kotori = createCardInstance(
      createMemberCard('PL!-kotori', {
        name: '南ことり',
        hearts: [createHeartIcon(HeartColor.RED, 1), createHeartIcon(HeartColor.GREEN, 1)],
      }),
      PLAYER1,
      'kotori'
    );
    const dia = createCardInstance(
      createMemberCard('PL!S-dia', {
        name: '黒澤ダイヤ',
        groupName: 'Aqours',
        hearts: [
          createHeartIcon(HeartColor.GREEN, 1),
          createHeartIcon(HeartColor.BLUE, 1),
          createHeartIcon(HeartColor.PURPLE, 1),
        ],
      }),
      PLAYER1,
      'dia'
    );
    const other = createCardInstance(
      createMemberCard('PL!-other', { name: '高坂穂乃果' }),
      PLAYER1,
      'other'
    );
    let game = registerCards(createGameState('ll-bp6-001-hearts', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      kotori,
      dia,
      other,
    ]);
    game = placeStageMember(game, source.instanceId);
    game = setPlayerZones(game, { hand: [kotori.instanceId, dia.instanceId, other.instanceId] });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          LL_BP6_001_LIVE_START_DISCARD_NAMED_MEMBERS_GAIN_HEARTS_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    let resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect?.selectableCardIds).toEqual([kotori.instanceId, dia.instanceId]);
    resolved = confirmActiveEffectStep(
      resolved,
      PLAYER1,
      resolved.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [kotori.instanceId, dia.instanceId]
    );

    expect(getPlayerById(resolved, PLAYER1)!.waitingRoom.cardIds).toEqual([
      kotori.instanceId,
      dia.instanceId,
    ]);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: LL_BP6_001_LIVE_START_DISCARD_NAMED_MEMBERS_GAIN_HEARTS_ABILITY_ID,
      hearts: [
        { color: HeartColor.RED, count: 1 },
        { color: HeartColor.GREEN, count: 1 },
        { color: HeartColor.BLUE, count: 1 },
        { color: HeartColor.PURPLE, count: 1 },
      ],
    });
    expect(enterWaitingRoomEvents(resolved).some((event) => event.fromZone === ZoneType.HAND)).toBe(true);
  });
});
