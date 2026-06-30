import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
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

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.MAIN_FREE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

type MutableStagePlayer = {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
  memberSlots: {
    slots: Record<SlotPosition, string | null>;
    cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
  };
};

function startPb1014Session(sourceSlot: SlotPosition, opponentSlot: SlotPosition) {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    `hs-pb1-014-perspective-${sourceSlot}-${opponentSlot}`,
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!HS-pb1-014-R', '安養寺姫芽', 9),
    PLAYER1,
    `source-${sourceSlot}`
  );
  const opponentTarget = createCardInstance(
    createMemberCard('PL!HS-test-opponent-target', 'Opponent target', 11),
    PLAYER2,
    `target-${opponentSlot}`
  );
  const state = registerCards(session.state!, [source, opponentTarget]);
  const p1 = state.players[0] as unknown as MutableStagePlayer;
  const p2 = state.players[1] as unknown as MutableStagePlayer;
  removeFromPlayerZones(p1);
  removeFromPlayerZones(p2);
  p1.hand.cardIds = [source.instanceId];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map();
  p2.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
    [opponentSlot]: opponentTarget.instanceId,
  };
  p2.memberSlots.cardStates = new Map([
    [opponentTarget.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return { session, source, opponentTarget };
}

describe('HS-pb1-014 Hime workflow', () => {
  it('moves an opponent member to the source front slot when own stage is only Mira-Cra', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-pb1-014-move-front', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-pb1-014-R', '安養寺姫芽', 9),
      PLAYER1,
      'p1-hs-pb1-014-source'
    );
    const ownMiraCra = createCardInstance(
      createMemberCard('PL!HS-test-own-miracra', 'Mira-Cra own', 4),
      PLAYER1,
      'p1-hs-pb1-014-own'
    );
    const opponentTarget = createCardInstance(
      createMemberCard('PL!HS-test-opponent-target', 'Opponent target', 11),
      PLAYER2,
      'p2-hs-pb1-014-target'
    );
    const state = registerCards(session.state!, [source, ownMiraCra, opponentTarget]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const p2 = state.players[1] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: ownMiraCra.instanceId,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map([
      [ownMiraCra.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots = {
      [SlotPosition.LEFT]: opponentTarget.instanceId,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p2.memberSlots.cardStates = new Map([
      [
        opponentTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([opponentTarget.instanceId]);

    const moveResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        opponentTarget.instanceId
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.CENTER]).toBe(
      opponentTarget.instanceId
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID &&
          action.payload.step === 'MOVE_OPPONENT_MEMBER_FRONT_SLOT' &&
          action.payload.toSlot === SlotPosition.CENTER
      )
    ).toBe(true);
  });

  it.each([
    [SlotPosition.LEFT, SlotPosition.RIGHT],
    [SlotPosition.RIGHT, SlotPosition.LEFT],
    [SlotPosition.CENTER, SlotPosition.CENTER],
  ])(
    'moves opponent member to mirrored front slot for source %s',
    (sourceSlot, expectedOpponentSlot) => {
      const opponentStartSlot =
        expectedOpponentSlot === SlotPosition.CENTER ? SlotPosition.LEFT : SlotPosition.CENTER;
      const { session, source, opponentTarget } = startPb1014Session(sourceSlot, opponentStartSlot);

      const playResult = session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, source.instanceId, sourceSlot, { freePlay: true })
      );
      expect(playResult.success).toBe(true);

      const moveResult = session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          opponentTarget.instanceId
        )
      );

      expect(moveResult.success).toBe(true);
      expect(session.state?.players[1].memberSlots.slots[expectedOpponentSlot]).toBe(
        opponentTarget.instanceId
      );
      expect(
        session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID &&
            action.payload.targetLocalSlot === expectedOpponentSlot &&
            action.payload.toSlot === expectedOpponentSlot
        )
      ).toBe(true);
    }
  );

  it('allows the temporary optional skip path for the on-enter move', () => {
    const { session, source, opponentTarget } = startPb1014Session(
      SlotPosition.LEFT,
      SlotPosition.CENTER
    );
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );
    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.CENTER]).toBe(
      opponentTarget.instanceId
    );
  });

  it('allows selecting an already-front opponent member as a no-op resolve', () => {
    const { session, source, opponentTarget } = startPb1014Session(
      SlotPosition.LEFT,
      SlotPosition.RIGHT
    );
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );
    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([opponentTarget.instanceId]);

    const noOpResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        opponentTarget.instanceId
      )
    );

    expect(noOpResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      opponentTarget.instanceId
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID &&
          action.payload.noOp === true &&
          action.payload.targetLocalSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('safely ends the on-enter effect when own stage includes a non-Mira-Cra member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-pb1-014-condition-false', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-pb1-014-R', '安養寺姫芽', 9),
      PLAYER1,
      'p1-hs-pb1-014-false-source'
    );
    const nonMiraCra = createCardInstance(
      createMemberCard('PL!HS-test-non-miracra', 'Cerise member', 4, 'スリーズブーケ'),
      PLAYER1,
      'p1-hs-pb1-014-non-miracra'
    );
    const opponentTarget = createCardInstance(
      createMemberCard('PL!HS-test-opponent-target', 'Opponent target', 11),
      PLAYER2,
      'p2-hs-pb1-014-false-target'
    );
    const state = registerCards(session.state!, [source, nonMiraCra, opponentTarget]);
    (session as unknown as { authorityState: GameState }).authorityState = state;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const p2 = state.players[1] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: nonMiraCra.instanceId,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map([
      [nonMiraCra.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = opponentTarget.instanceId;
    p2.memberSlots.cardStates = new Map([
      [
        opponentTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.LEFT]).toBe(
      opponentTarget.instanceId
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID &&
          action.payload.step === 'OWN_STAGE_NOT_ONLY_MIRACRA'
      )
    ).toBe(true);
  });
});
