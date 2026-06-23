import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
  cost = 4,
  unitName = 'EdelNote',
  groupName = '蓮ノ空女学院スクールアイドルクラブ'
): MemberCardData {
  return {
    cardCode,
    name,
    groupName,
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
    createMemberCard(`MEM-${index}`, `Member ${index}`, 4, 'EdelNote')
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function clearPlayerZones(player: {
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

function setAuthorityState(session: ReturnType<typeof createGameSession>, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

describe('PL!HS-bp6-007 セラス 柳田 リリエンフェルト workflow', () => {
  it('triggers when itself enters and lets the opponent wait their own active member', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('hs-bp6-007-self-enter', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const seras = createCardInstance(
      createMemberCard('PL!HS-bp6-007-P', 'セラス 柳田 リリエンフェルト', 15),
      PLAYER1,
      'seras-source'
    );
    const target = createCardInstance(
      createMemberCard('PL!-target-active', 'Active Target', 4, "μ's", "μ's"),
      PLAYER2,
      'opponent-active-target'
    );
    let state = registerCards(session.state!, [seras, target]);
    setAuthorityState(session, state);

    const p1 = state.players[0] as unknown as { hand: { cardIds: string[] } };
    const p2 = state.players[1] as unknown as {
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    clearPlayerZones(state.players[0]);
    clearPlayerZones(state.players[1]);
    p1.hand.cardIds = [seras.instanceId];
    p2.memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    p2.memberSlots.cardStates = new Map([
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, seras.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
      controllerId: PLAYER1,
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [target.instanceId],
    });

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER2, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(waitResult.success).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(hasAbilityUse(session.state!, seras.instanceId)).toBe(true);
  });

  it('also triggers when another own EdelNote member enters', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('hs-bp6-007-other-edelnote', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const seras = createCardInstance(
      createMemberCard('PL!HS-bp6-007-R', 'セラス 柳田 リリエンフェルト', 15),
      PLAYER1,
      'seras-source-other'
    );
    const otherEdelNote = createCardInstance(
      createMemberCard('PL!HS-test-edelnote', 'Other EdelNote', 4),
      PLAYER1,
      'other-edelnote'
    );
    const target = createCardInstance(
      createMemberCard('PL!-target-active-other', 'Active Target', 4, "μ's", "μ's"),
      PLAYER2,
      'opponent-active-target-other'
    );
    const state = registerCards(session.state!, [seras, otherEdelNote, target]);
    setAuthorityState(session, state);
    clearPlayerZones(state.players[0]);
    clearPlayerZones(state.players[1]);

    state.players[0].hand.cardIds = [otherEdelNote.instanceId];
    state.players[0].memberSlots.slots[SlotPosition.CENTER] = seras.instanceId;
    state.players[0].memberSlots.cardStates = new Map([
      [seras.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state.players[1].memberSlots.slots[SlotPosition.LEFT] = target.instanceId;
    state.players[1].memberSlots.cardStates = new Map([
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, otherEdelNote.instanceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.sourceCardId).toBe(seras.instanceId);
    expect(session.state?.activeEffect?.awaitingPlayerId).toBe(PLAYER2);
  });

  it('does not consume the once-per-turn use for a non-EdelNote Hasunosora member entering', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('hs-bp6-007-non-edelnote', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const seras = createCardInstance(
      createMemberCard('PL!HS-bp6-007-P', 'セラス 柳田 リリエンフェルト', 15),
      PLAYER1,
      'seras-source-non-edel'
    );
    const nonEdelNote = createCardInstance(
      createMemberCard('PL!HS-test-miracra', 'Mira-Cra Member', 4, 'みらくらぱーく！'),
      PLAYER1,
      'non-edelnote-member'
    );
    const edelNote = createCardInstance(
      createMemberCard('PL!HS-test-edelnote-later', 'Later EdelNote', 4),
      PLAYER1,
      'later-edelnote-member'
    );
    const target = createCardInstance(
      createMemberCard('PL!-target-active-later', 'Active Target', 4, "μ's", "μ's"),
      PLAYER2,
      'opponent-active-target-later'
    );
    const state = registerCards(session.state!, [seras, nonEdelNote, edelNote, target]);
    setAuthorityState(session, state);
    clearPlayerZones(state.players[0]);
    clearPlayerZones(state.players[1]);

    state.players[0].hand.cardIds = [nonEdelNote.instanceId, edelNote.instanceId];
    state.players[0].memberSlots.slots[SlotPosition.CENTER] = seras.instanceId;
    state.players[0].memberSlots.cardStates = new Map([
      [seras.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state.players[1].memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    state.players[1].memberSlots.cardStates = new Map([
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const nonEdelResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nonEdelNote.instanceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );
    expect(nonEdelResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(hasAbilityUse(session.state!, seras.instanceId)).toBe(false);

    const edelResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, edelNote.instanceId, SlotPosition.RIGHT, {
        freePlay: true,
      })
    );
    expect(edelResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID
    );
  });

  it('consumes the once-per-turn use when a valid EdelNote enters with no opponent target', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('hs-bp6-007-no-target', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const seras = createCardInstance(
      createMemberCard('PL!HS-bp6-007-R', 'セラス 柳田 リリエンフェルト', 15),
      PLAYER1,
      'seras-source-no-target'
    );
    const otherEdelNote = createCardInstance(
      createMemberCard('PL!HS-test-edelnote-no-target', 'Other EdelNote', 4),
      PLAYER1,
      'other-edelnote-no-target'
    );
    const state = registerCards(session.state!, [seras, otherEdelNote]);
    setAuthorityState(session, state);
    clearPlayerZones(state.players[0]);
    clearPlayerZones(state.players[1]);
    state.players[0].hand.cardIds = [otherEdelNote.instanceId];
    state.players[0].memberSlots.slots[SlotPosition.CENTER] = seras.instanceId;
    state.players[0].memberSlots.cardStates = new Map([
      [seras.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, otherEdelNote.instanceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(hasAbilityUse(session.state!, seras.instanceId)).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID &&
          action.payload.step === 'NO_OPPONENT_ACTIVE_MEMBER_TARGET'
      )
    ).toBe(true);
  });

  it('does not trigger a second time in the same turn after a valid use', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('hs-bp6-007-turn-once', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const seras = createCardInstance(
      createMemberCard('PL!HS-bp6-007-P', 'セラス 柳田 リリエンフェルト', 15),
      PLAYER1,
      'seras-source-turn-once'
    );
    const firstEdelNote = createCardInstance(
      createMemberCard('PL!HS-test-edelnote-first', 'First EdelNote', 4),
      PLAYER1,
      'first-edelnote-member'
    );
    const secondEdelNote = createCardInstance(
      createMemberCard('PL!HS-test-edelnote-second', 'Second EdelNote', 4),
      PLAYER1,
      'second-edelnote-member'
    );
    const target = createCardInstance(
      createMemberCard('PL!-target-active-turn-once', 'Active Target', 4, "μ's", "μ's"),
      PLAYER2,
      'opponent-active-target-turn-once'
    );
    const state = registerCards(session.state!, [seras, firstEdelNote, secondEdelNote, target]);
    setAuthorityState(session, state);
    clearPlayerZones(state.players[0]);
    clearPlayerZones(state.players[1]);
    state.players[0].hand.cardIds = [firstEdelNote.instanceId, secondEdelNote.instanceId];
    state.players[0].memberSlots.slots[SlotPosition.CENTER] = seras.instanceId;
    state.players[0].memberSlots.cardStates = new Map([
      [seras.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state.players[1].memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    state.players[1].memberSlots.cardStates = new Map([
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, firstEdelNote.instanceId, SlotPosition.LEFT, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER2, session.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);

    session.state!.players[1].memberSlots.cardStates.set(target.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    const secondPlay = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, secondEdelNote.instanceId, SlotPosition.RIGHT, {
        freePlay: true,
      })
    );

    expect(secondPlay.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
  });
});

function hasAbilityUse(game: GameState, sourceCardId: string): boolean {
  return game.actionHistory.some(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        HS_BP6_007_AUTO_TURN_ONCE_EDELNOTE_ENTER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID &&
      action.payload.sourceCardId === sourceCardId &&
      action.payload.step === 'ABILITY_USE'
  );
}
