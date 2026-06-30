import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type LiveModifierState,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID,
  HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
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

function createRetrofuture(): LiveCardData {
  return {
    cardCode: 'PL!HS-bp5-022-L',
    name: 'Retrofuture',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'EdelNote',
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({
      [HeartColor.PURPLE]: 5,
      [HeartColor.RAINBOW]: 2,
    }),
  };
}

function createMember(
  cardCode: string,
  name: string,
  cost: number,
  unitName = 'EdelNote'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function buildLiveStartState(options: {
  readonly stageMembers: readonly {
    readonly card: MemberCardData;
    readonly id: string;
    readonly slot: SlotPosition;
  }[];
  readonly waitingRoomMembers?: readonly { readonly card: MemberCardData; readonly id: string }[];
  readonly activeEnergyCount?: number;
  readonly memberCostModifiers?: readonly {
    readonly memberId: string;
    readonly countDelta: number;
  }[];
}) {
  const live = createCardInstance(createRetrofuture(), PLAYER1, 'retrofuture-live');
  const stageMembers = options.stageMembers.map((member) =>
    createCardInstance(member.card, PLAYER1, member.id)
  );
  const waitingRoomMembers = (options.waitingRoomMembers ?? []).map((member) =>
    createCardInstance(member.card, PLAYER1, member.id)
  );
  const energyCards = Array.from({ length: options.activeEnergyCount ?? 2 }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const deckFiller = createCardInstance(
    createMember('PL!HS-test-retrofuture-deck-filler', 'Deck Filler', 1, 'スリーズブーケ'),
    PLAYER1,
    'deck-filler'
  );

  let game = createGameState('hs-bp5-022-retrofuture', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    live,
    ...stageMembers,
    ...waitingRoomMembers,
    ...energyCards,
    deckFiller,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    options.stageMembers.forEach((member, index) => {
      memberSlots = placeCardInSlot(memberSlots, member.slot, stageMembers[index]!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    });

    let waitingRoom = player.waitingRoom;
    for (const member of waitingRoomMembers) {
      waitingRoom = addCardToZone(waitingRoom, member.instanceId);
    }

    let energyZone = player.energyZone;
    for (const energy of energyCards) {
      energyZone = addCardToStatefulZone(energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots,
      waitingRoom,
      energyZone,
      mainDeck: addCardToZone(player.mainDeck, deckFiller.instanceId),
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      liveModifiers: createMemberCostModifiers(options.memberCostModifiers ?? [], live.instanceId),
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return { state: result.gameState, live, stageMembers, waitingRoomMembers, energyCards };
}

function createMemberCostModifiers(
  modifiers: readonly { readonly memberId: string; readonly countDelta: number }[],
  sourceCardId: string
): readonly LiveModifierState[] {
  return modifiers.map((modifier) => ({
    kind: 'MEMBER_COST',
    playerId: PLAYER1,
    memberCardId: modifier.memberId,
    countDelta: modifier.countDelta,
    sourceCardId,
    abilityId: 'test-member-cost-modifier',
  }));
}

function createSessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-bp5-022-retrofuture-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function confirmOption(session: ReturnType<typeof createGameSession>, selectedOptionId: string) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      selectedOptionId
    )
  );
  expect(result.success, result.error).toBe(true);
}

function confirmCard(session: ReturnType<typeof createGameSession>, selectedCardId: string) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
}

function confirmSlot(session: ReturnType<typeof createGameSession>, selectedSlot: SlotPosition) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      selectedSlot
    )
  );
  expect(result.success, result.error).toBe(true);
}

function payEnergy(session: ReturnType<typeof createGameSession>) {
  expect(session.state?.activeEffect).toMatchObject({
    abilityId:
      HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    stepId: 'HS_BP5_022_PAY_TWO_ENERGY',
  });
  confirmOption(session, 'pay');
}

describe('PL!HS-bp5-022-L Retrofuture workflow', () => {
  it('pays two energy and chooses the purple requirement reduction mode', () => {
    const { state, live, energyCards } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-high-edelnote', 'セラス 柳田 リリエンフェルト', 9),
          id: 'high-edelnote',
          slot: SlotPosition.LEFT,
        },
      ],
      waitingRoomMembers: [
        {
          card: createMember('PL!HS-test-low-edelnote', '桂城 泉', 4),
          id: 'low-edelnote',
        },
      ],
    });
    const session = createSessionFromState(state);

    payEnergy(session);
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'play-low-cost-edelnote-member', label: '休息室EdelNote成员登场' },
      { id: 'reduce-purple-requirement', label: '减少紫色必要Heart' },
    ]);

    confirmOption(session, 'reduce-purple-requirement');

    expect(session.state?.activeEffect).toBeNull();
    for (const energy of energyCards) {
      expect(
        session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
      ).toBe(OrientationState.WAITING);
    }
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.PURPLE, countDelta: -1 }],
      sourceCardId: live.instanceId,
      abilityId:
        HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    });
  });

  it('plays a low-cost EdelNote member from waiting room and enqueues its ON_ENTER_STAGE ability', () => {
    const { state, waitingRoomMembers } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-high-edelnote', 'セラス 柳田 リリエンフェルト', 9),
          id: 'high-edelnote',
          slot: SlotPosition.LEFT,
        },
      ],
      waitingRoomMembers: [
        {
          card: createMember('PL!HS-bp1-008-R', '徒町 小鈴', 4),
          id: 'kosuzu-low-edelnote',
        },
      ],
    });
    const session = createSessionFromState(state);
    const target = waitingRoomMembers[0]!;

    payEnergy(session);
    confirmOption(session, 'play-low-cost-edelnote-member');
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'HS_BP5_022_SELECT_LOW_COST_EDELNOTE_FROM_WAITING_ROOM',
      selectableCardIds: [target.instanceId],
      selectableCardVisibility: 'PUBLIC',
    });

    confirmCard(session, target.instanceId);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);
    confirmSlot(session, SlotPosition.CENTER);

    const player = session.state!.players[0]!;
    expect(player.waitingRoom.cardIds).not.toContain(target.instanceId);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(target.instanceId);
    expect(player.memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === target.instanceId &&
          entry.event.fromZone === ZoneType.WAITING_ROOM &&
          entry.event.toSlot === SlotPosition.CENTER
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID &&
          action.payload.sourceCardId === target.instanceId
      )
    ).toBe(true);
  });

  it('keeps paid energy and resolves no-effect when no high-cost EdelNote member is on stage', () => {
    const { state, energyCards } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-low-stage-edelnote', '桂城 泉', 8),
          id: 'low-stage-edelnote',
          slot: SlotPosition.LEFT,
        },
      ],
    });
    const session = createSessionFromState(state);

    payEnergy(session);

    expect(session.state?.activeEffect).toBeNull();
    for (const energy of energyCards) {
      expect(
        session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
      ).toBe(OrientationState.WAITING);
    }
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID &&
          action.payload.step === 'PAY_COST_NO_HIGH_COST_EDELNOTE_MEMBER'
      )
    ).toBe(true);
  });

  it('uses effective cost for the high-cost EdelNote stage condition', () => {
    const { state, live, energyCards } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-effective-cost-edelnote', '桂城 泉', 8),
          id: 'effective-cost-edelnote',
          slot: SlotPosition.LEFT,
        },
      ],
      memberCostModifiers: [{ memberId: 'effective-cost-edelnote', countDelta: 1 }],
    });
    const session = createSessionFromState(state);

    payEnergy(session);

    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'HS_BP5_022_SELECT_RETROFUTURE_MODE',
      selectableOptions: [{ id: 'reduce-purple-requirement', label: '减少紫色必要Heart' }],
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID &&
          action.payload.step === 'PAY_COST_NO_HIGH_COST_EDELNOTE_MEMBER'
      )
    ).toBe(false);

    confirmOption(session, 'reduce-purple-requirement');

    for (const energy of energyCards) {
      expect(
        session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
      ).toBe(OrientationState.WAITING);
    }
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.PURPLE, countDelta: -1 }],
      sourceCardId: live.instanceId,
      abilityId:
        HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    });
  });

  it.each([
    {
      name: 'no low-cost waiting-room EdelNote target',
      waitingRoomMembers: [
        {
          card: createMember('PL!HS-test-high-waiting-edelnote', '桂城 泉', 5),
          id: 'high-waiting-edelnote',
        },
      ],
      occupiedSlots: [],
    },
    {
      name: 'no empty member slot',
      waitingRoomMembers: [
        {
          card: createMember('PL!HS-test-low-waiting-edelnote', '桂城 泉', 4),
          id: 'low-waiting-edelnote',
        },
      ],
      occupiedSlots: [
        {
          card: createMember('PL!HS-test-occupied-center', '百生吟子', 4),
          id: 'occupied-center',
          slot: SlotPosition.CENTER,
        },
        {
          card: createMember('PL!HS-test-occupied-right', '安養寺姫芽', 4),
          id: 'occupied-right',
          slot: SlotPosition.RIGHT,
        },
      ],
    },
  ])('only offers the requirement mode when $name', (config) => {
    const { state } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-high-edelnote', 'セラス 柳田 リリエンフェルト', 9),
          id: 'high-edelnote',
          slot: SlotPosition.LEFT,
        },
        ...(config.occupiedSlots ?? []),
      ],
      waitingRoomMembers: config.waitingRoomMembers,
    });
    const session = createSessionFromState(state);

    payEnergy(session);

    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'HS_BP5_022_SELECT_RETROFUTURE_MODE',
      selectableOptions: [{ id: 'reduce-purple-requirement', label: '减少紫色必要Heart' }],
    });
  });

  it('does not pay when the controller declines or cannot pay', () => {
    const enoughEnergy = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-high-edelnote', 'セラス 柳田 リリエンフェルト', 9),
          id: 'high-edelnote',
          slot: SlotPosition.LEFT,
        },
      ],
    });
    const declineSession = createSessionFromState(enoughEnergy.state);

    confirmOption(declineSession, 'decline');

    expect(declineSession.state?.activeEffect).toBeNull();
    expect(declineSession.state?.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(
      false
    );
    for (const energy of enoughEnergy.energyCards) {
      expect(
        declineSession.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
      ).toBe(OrientationState.ACTIVE);
    }

    const notEnoughEnergy = buildLiveStartState({
      activeEnergyCount: 1,
      stageMembers: [
        {
          card: createMember('PL!HS-test-high-edelnote', 'セラス 柳田 リリエンフェルト', 9),
          id: 'high-edelnote',
          slot: SlotPosition.LEFT,
        },
      ],
    });

    expect(notEnoughEnergy.state.activeEffect?.selectableOptions).toEqual([
      { id: 'decline', label: '不发动' },
    ]);
  });
});
