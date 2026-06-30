import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name = cardCode,
  cost = 1,
  unitName = 'みらくらぱーく！'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['莲之空'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
}

function advanceToLiveStartEffects(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    firstPlayerIndex: number;
    liveSetCompletedPlayers: string[];
  };
  mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
  mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
  mutableState.currentTurnType = TurnType.LIVE_PHASE;
  mutableState.activePlayerIndex = 0;
  mutableState.firstPlayerIndex = 0;
  mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

  const advanceResult = new GameService().advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

function startScenario(options: {
  readonly left?: MemberCardData;
  readonly center?: MemberCardData;
  readonly right?: MemberCardData;
  readonly sourceSlot: SlotPosition;
}) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('hs-pb1-006-hime', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!HS-pb1-006-R', '安養寺姫芽', 11),
    PLAYER1,
    'p1-hs-pb1-006-source'
  );
  const live = createCardInstance(createLiveCard('PL!HS-test-live'), PLAYER1, 'p1-live');
  const slotCards = {
    [SlotPosition.LEFT]:
      options.sourceSlot === SlotPosition.LEFT
        ? source
        : options.left
          ? createCardInstance(options.left, PLAYER1, 'p1-left')
          : null,
    [SlotPosition.CENTER]:
      options.sourceSlot === SlotPosition.CENTER
        ? source
        : options.center
          ? createCardInstance(options.center, PLAYER1, 'p1-center')
          : null,
    [SlotPosition.RIGHT]:
      options.sourceSlot === SlotPosition.RIGHT
        ? source
        : options.right
          ? createCardInstance(options.right, PLAYER1, 'p1-right')
          : null,
  };

  const cards = [source, live, ...Object.values(slotCards).filter((card) => card && card !== source)];
  const state = registerCards(session.state!, cards as NonNullable<(typeof cards)[number]>[]);
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  removeFromPlayerZones(p1);
  p1.liveZone.cardIds = [live.instanceId];
  p1.liveZone.cardStates = new Map([
    [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: slotCards[SlotPosition.LEFT]?.instanceId ?? null,
    [SlotPosition.CENTER]: slotCards[SlotPosition.CENTER]?.instanceId ?? null,
    [SlotPosition.RIGHT]: slotCards[SlotPosition.RIGHT]?.instanceId ?? null,
  };
  p1.memberSlots.cardStates = new Map(
    Object.values(slotCards)
      .filter((card): card is typeof source => card !== null)
      .map((card) => [card.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }])
  );
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return { session, source, slotCards };
}

describe('PL!HS-pb1-006 Hime live-start position change', () => {
  it('consumes pending no-op when there is no other Mira-Cra target', () => {
    const { session, source } = startScenario({
      sourceSlot: SlotPosition.CENTER,
      left: createMemberCard('PL!HS-test-non-miracra', 'Non Mira', 3, 'DOLLCHESTRA'),
    });

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      source.instanceId
    );
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('only offers occupied other Mira-Cra slots and leaves state unchanged on decline', () => {
    const { session, source } = startScenario({
      sourceSlot: SlotPosition.CENTER,
      left: createMemberCard('PL!HS-test-non-miracra', 'Non Mira', 3, 'DOLLCHESTRA'),
      right: createMemberCard('PL!HS-test-miracra', 'Mira', 3),
    });

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableSlots).toEqual([SlotPosition.RIGHT]);

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      source.instanceId
    );
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('rejects an illegal slot without moving or adding modifiers', () => {
    const { session, source } = startScenario({
      sourceSlot: SlotPosition.CENTER,
      right: createMemberCard('PL!HS-test-miracra', 'Mira', 3),
    });

    advanceToLiveStartEffects(session);

    const invalidResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(invalidResult.success).toBe(false);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      source.instanceId
    );
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('moves by exchange, gives Heart and Blade only on success, and records ON_MEMBER_SLOT_MOVED', () => {
    const { session, source, slotCards } = startScenario({
      sourceSlot: SlotPosition.CENTER,
      right: createMemberCard('PL!HS-test-miracra', 'Mira', 3),
    });
    const rightMember = slotCards[SlotPosition.RIGHT]!;

    advanceToLiveStartEffects(session);

    const moveResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      source.instanceId
    );
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      rightMember.instanceId
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID,
      countDelta: 1,
    });
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cardInstanceId === source.instanceId &&
          entry.event.fromSlot === SlotPosition.CENTER &&
          entry.event.toSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });
});
