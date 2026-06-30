import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
  PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
  cost = 4,
  unitName = 'BiBi',
  groupName = "μ's"
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
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
    createMemberCard(`MEM-${index}`, `Member ${index}`)
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

function setupOnEnterMakiState(options: {
  readonly slot: SlotPosition;
  readonly opponentTargetCost?: number;
  readonly opponentTargetOrientation?: OrientationState;
}) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('pb1-015-maki-on-enter', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const maki = createCardInstance(
    createMemberCard('PL!-pb1-015-P＋', '西木野真姫', 11),
    PLAYER1,
    'maki-source'
  );
  const target = createCardInstance(
    createMemberCard(
      'PL!-opponent-target',
      'Opponent Target',
      options.opponentTargetCost ?? 4,
      'Printemps'
    ),
    PLAYER2,
    'opponent-target'
  );
  const drawCard = createCardInstance(
    createMemberCard('PL!-draw-card', 'Draw Card', 2),
    PLAYER1,
    'draw-card'
  );
  const state = registerCards(session.state!, [maki, target, drawCard]);
  setAuthorityState(session, state);
  clearPlayerZones(state.players[0]);
  clearPlayerZones(state.players[1]);
  state.players[0].hand.cardIds = [maki.instanceId];
  state.players[0].mainDeck.cardIds = [drawCard.instanceId];
  state.players[1].memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
  state.players[1].memberSlots.cardStates = new Map([
    [
      target.instanceId,
      {
        orientation: options.opponentTargetOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      },
    ],
  ]);

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, maki.instanceId, options.slot, {
      freePlay: true,
    })
  );

  return { session, playResult, maki, target, drawCard };
}

describe('PL!-pb1-015 西木野真姫 workflow', () => {
  it('triggers on enter only from center and draws from the existing second ability for a low-cost target', () => {
    const { session, playResult, maki, target, drawCard } = setupOnEnterMakiState({
      slot: SlotPosition.CENTER,
      opponentTargetCost: 4,
    });

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [maki.instanceId],
    });

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, maki.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
      awaitingPlayerId: PLAYER2,
      controllerId: PLAYER1,
      selectableCardIds: [target.instanceId],
    });

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER2, session.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);

    expect(session.state?.players[0].memberSlots.cardStates.get(maki.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.players[0].hand.cardIds).toContain(drawCard.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID &&
          action.payload.step === 'DRAW_CARD'
      )
    ).toBe(true);
  });

  it('does not trigger the first effect when played outside center', () => {
    const { session, playResult } = setupOnEnterMakiState({
      slot: SlotPosition.LEFT,
      opponentTargetCost: 4,
    });

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('does not continue to the opponent target step when the BiBi cost is skipped', () => {
    const { session, playResult, target } = setupOnEnterMakiState({
      slot: SlotPosition.CENTER,
      opponentTargetCost: 4,
    });

    expect(playResult.success).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('keeps the paid BiBi cost when the opponent has no active target', () => {
    const { session, playResult, maki, target } = setupOnEnterMakiState({
      slot: SlotPosition.CENTER,
      opponentTargetCost: 4,
      opponentTargetOrientation: OrientationState.WAITING,
    });

    expect(playResult.success).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, maki.instanceId)
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.cardStates.get(maki.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PB1_015_ON_ENTER_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID &&
          action.payload.step === 'OPPONENT_NO_ACTIVE_TARGET_AFTER_BIBI_COST'
      )
    ).toBe(true);
  });

  it('triggers from center at LIVE start', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('pb1-015-maki-live-start', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const maki = createCardInstance(
      createMemberCard('PL!-pb1-015-R', '西木野真姫', 11),
      PLAYER1,
      'maki-live-start'
    );
    const target = createCardInstance(
      createMemberCard('PL!-opponent-live-start-target', 'Opponent Target', 5, 'Printemps'),
      PLAYER2,
      'opponent-live-start-target'
    );
    let state = registerCards(session.state!, [maki, target]);
    clearPlayerZones(state.players[0]);
    clearPlayerZones(state.players[1]);
    state.players[0].memberSlots.slots[SlotPosition.CENTER] = maki.instanceId;
    state.players[0].memberSlots.cardStates = new Map([
      [maki.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state.players[1].memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    state.players[1].memberSlots.cardStates = new Map([
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        performingPlayerId: PLAYER1,
      },
    };

    const checkResult = new GameService().executeCheckTiming(state, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(checkResult.success).toBe(true);
    setAuthorityState(session, checkResult.gameState);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [maki.instanceId],
    });
  });

  it('does not continue when there is no non-waiting BiBi member at LIVE start', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame(
      'pb1-015-maki-live-start-no-bibi-cost',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const maki = createCardInstance(
      createMemberCard('PL!-pb1-015-R', '西木野真姫', 11),
      PLAYER1,
      'maki-live-start-waiting'
    );
    let state = registerCards(session.state!, [maki]);
    clearPlayerZones(state.players[0]);
    clearPlayerZones(state.players[1]);
    state.players[0].memberSlots.slots[SlotPosition.CENTER] = maki.instanceId;
    state.players[0].memberSlots.cardStates = new Map([
      [maki.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
    ]);
    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        performingPlayerId: PLAYER1,
      },
    };

    const checkResult = new GameService().executeCheckTiming(state, [
      TriggerCondition.ON_LIVE_START,
    ]);

    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect).toBeNull();
    expect(
      checkResult.gameState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PB1_015_LIVE_START_CENTER_WAIT_BIBI_MEMBER_OPPONENT_WAIT_ACTIVE_MEMBER_ABILITY_ID &&
          action.payload.step === 'SKIP_NO_BIBI_COST_TARGET'
      )
    ).toBe(true);
  });
});
