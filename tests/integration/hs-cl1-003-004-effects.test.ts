import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';
import {
  HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID,
  HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
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

function createMemberData(
  cardCode: string,
  name: string,
  cost: number,
  options: {
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createMember(
  cardCode: string,
  name: string,
  cost: number,
  instanceId: string,
  ownerId = PLAYER1,
  options: Parameters<typeof createMemberData>[3] = {}
) {
  return createCardInstance(createMemberData(cardCode, name, cost, options), ownerId, instanceId);
}

function stageMember(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setMainDeckAndWaitingRoom(
  game: GameState,
  playerId: string,
  mainDeckCardIds: readonly string[],
  waitingRoomCardIds: readonly string[] = []
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [...mainDeckCardIds] },
    waitingRoom: { ...player.waitingRoom, cardIds: [...waitingRoomCardIds] },
  }));
}

function latestPayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

function setupRurinoScenario(options: {
  readonly includeOtherMiracra?: boolean;
  readonly sourceUnitName?: string;
}) {
  const session = createGameSession();
  session.createGame('hs-cl1-003-rurino', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createMember(
    'PL!HS-cl1-003-CL',
    '大沢瑠璃乃',
    4,
    'hs-cl1-003-source',
    PLAYER1,
    { unitName: options.sourceUnitName ?? 'みらくらぱーく！' }
  );
  const otherMiracra = createMember(
    'PL!HS-cl1-003-other',
    'Other Mira',
    5,
    'hs-cl1-003-other',
    PLAYER1,
    { unitName: 'みらくらぱーく！' }
  );
  let state = registerCards(session.state!, [source, otherMiracra]);
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  state = stageMember(state, PLAYER1, source.instanceId, SlotPosition.CENTER);
  if (options.includeOtherMiracra !== false) {
    state = stageMember(state, PLAYER1, otherMiracra.instanceId, SlotPosition.LEFT);
  }
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return { session, sourceId: source.instanceId, otherMiracraId: otherMiracra.instanceId };
}

function setupGinkoOnEnter(options: {
  readonly mainDeckCount?: number;
  readonly waitingRoomCount?: number;
  readonly opponentCost?: number;
  readonly opponentOrientation?: OrientationState;
}) {
  const ginko = createMember('PL!HS-cl1-004-CL', '百生 吟子', 9, 'hs-cl1-004-source');
  const deckCards = Array.from({ length: options.mainDeckCount ?? 3 }, (_, index) =>
    createMember(
      `PL!HS-cl1-004-top-${index}`,
      `Top ${index}`,
      3,
      `hs-cl1-004-top-${index}`
    )
  );
  const waitingCards = Array.from({ length: options.waitingRoomCount ?? 0 }, (_, index) =>
    createMember(
      `PL!HS-cl1-004-waiting-${index}`,
      `Waiting ${index}`,
      3,
      `hs-cl1-004-waiting-${index}`
    )
  );
  const opponent = createMember(
    'PL!HS-cl1-004-opponent',
    'Opponent',
    options.opponentCost ?? 2,
    'hs-cl1-004-opponent',
    PLAYER2
  );

  let game = createGameState('hs-cl1-004-ginko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [ginko, ...deckCards, ...waitingCards, opponent]);
  game = stageMember(game, PLAYER1, ginko.instanceId, SlotPosition.CENTER);
  game = stageMember(
    game,
    PLAYER2,
    opponent.instanceId,
    SlotPosition.CENTER,
    options.opponentOrientation ?? OrientationState.ACTIVE
  );
  game = setMainDeckAndWaitingRoom(
    game,
    PLAYER1,
    deckCards.map((card) => card.instanceId),
    waitingCards.map((card) => card.instanceId)
  );
  game = emitGameEvent(
    game,
    createEnterStageEvent(ginko.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const state = resolvePendingCardEffects(stateWithPending).gameState;
  return {
    state,
    sourceId: ginko.instanceId,
    deckCardIds: deckCards.map((card) => card.instanceId),
    waitingCardIds: waitingCards.map((card) => card.instanceId),
    opponentId: opponent.instanceId,
  };
}

function confirmOption(game: GameState, selectedOptionId: string): GameState {
  return continuePublicEffectChoiceForTest(
    confirmActiveEffectStep(
      game,
      PLAYER1,
      game.activeEffect!.id,
      null,
      null,
      undefined,
      selectedOptionId
    ),
    PLAYER1
  );
}

function confirmCard(game: GameState, selectedCardId: string): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

describe('PL!HS-cl1-003-CL Rurino activated workflow', () => {
  it('waits itself as cost, records turn use, then gives a Mira-Cra member BLADE +1', () => {
    const { session, sourceId, otherMiracraId } = setupRurinoScenario({});

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([otherMiracraId, sourceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, otherMiracraId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, otherMiracraId)).toBe(2);
    expect(
      latestPayload(
        session.state!,
        HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID
      )
    ).toMatchObject({
      step: 'MIRACRA_MEMBER_GAIN_BLADE',
      sourceCardId: sourceId,
      targetMemberCardId: otherMiracraId,
      bladeBonus: 1,
    });
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);
  });

  it('allows the waited source member itself to be selected if it is Mira-Cra Park', () => {
    const { session, sourceId } = setupRurinoScenario({ includeOtherMiracra: false });

    session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID
      )
    );

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([sourceId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, sourceId)
    );

    expect(confirmResult.success).toBe(true);
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(2);
  });

  it('keeps the paid cost and no-ops if the selected target disappears before confirmation', () => {
    const { session, sourceId, otherMiracraId } = setupRurinoScenario({});

    session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID
      )
    );

    const stateWithoutTarget = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    (session as unknown as { authorityState: GameState }).authorityState = stateWithoutTarget;

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, otherMiracraId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      latestPayload(
        session.state!,
        HS_CL1_003_ACTIVATED_WAIT_SELF_MIRACRA_MEMBER_GAIN_BLADE_ABILITY_ID
      )
    ).toMatchObject({
      step: 'NO_OP_TARGET_NOT_FOUND_AFTER_COST',
      targetMemberCardId: otherMiracraId,
      bladeBonus: 0,
    });
  });
});

describe('PL!HS-cl1-004-CL Ginko on-enter workflow', () => {
  it('opens a real two-option active effect when both branches are executable', () => {
    const { state } = setupGinkoOnEnter({ mainDeckCount: 3, opponentCost: 2 });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toMatchObject({
      abilityId: HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
      selectableOptions: [
        { id: 'mill-top-three', label: '将卡组顶3张放置入休息室' },
        { id: 'wait-opponent-low-cost-member', label: '将对方费用2以下成员变为待机' },
      ],
      canSkipSelection: false,
    });
  });

  it('places actual top deck cards into waiting room and emits enter-waiting-room trigger events', () => {
    const { state, deckCardIds } = setupGinkoOnEnter({ mainDeckCount: 4, opponentCost: 5 });
    const milledCardIds = deckCardIds.slice(0, 3);

    const resolved = confirmOption(state, 'mill-top-three');

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].waitingRoom.cardIds).toEqual(milledCardIds);
    expect(
      resolved.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === milledCardIds[0]
      )?.event
    ).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      cardInstanceIds: milledCardIds,
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: PLAYER1,
      controllerId: PLAYER1,
    });
    expect(
      latestPayload(resolved, HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID)
    ).toMatchObject({
      step: 'MILL_TOP_THREE_TO_WAITING_ROOM',
      movedCardIds: milledCardIds,
      movedCount: 3,
    });
  });

  it('waits a selected opponent cost 2 or lower member and enqueues member-state triggers', () => {
    const { state, opponentId } = setupGinkoOnEnter({ mainDeckCount: 0, opponentCost: 2 });

    const targetSelection = confirmOption(state, 'wait-opponent-low-cost-member');
    expect(targetSelection.activeEffect?.selectableCardIds).toEqual([opponentId]);

    const resolved = confirmCard(targetSelection, opponentId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[1].memberSlots.cardStates.get(opponentId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === opponentId
      )
    ).toBe(true);
    expect(
      latestPayload(resolved, HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID)
    ).toMatchObject({
      step: 'WAIT_OPPONENT_COST_TWO_MEMBER',
      targetCardId: opponentId,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
  });

  it('consumes the pending ability with no active effect when no branch is executable', () => {
    const { state } = setupGinkoOnEnter({
      mainDeckCount: 0,
      waitingRoomCount: 0,
      opponentCost: 3,
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(
      latestPayload(state, HS_CL1_004_ON_ENTER_MILL_THREE_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID)
    ).toMatchObject({
      step: 'SKIP_NO_AVAILABLE_OPTION',
      canMill: false,
      opponentTargetCount: 0,
    });
  });
});
