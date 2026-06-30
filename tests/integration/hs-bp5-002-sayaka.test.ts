import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID,
  HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
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
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupSayakaScenario(options: {
  readonly activeEnergyCount: number;
  readonly waitingRoomTargets: readonly ReturnType<typeof createCardInstance>[];
  readonly occupiedSlots?: readonly SlotPosition[];
}) {
  const source = createCardInstance(
    createMember('PL!HS-bp5-002-P', '村野さやか', 15),
    PLAYER1,
    'sayaka-source'
  );
  const energyCards = Array.from({ length: options.activeEnergyCount }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const occupiedMembers = (options.occupiedSlots ?? []).map((slot) =>
    createCardInstance(createMember(`occupied-${slot}`, `Occupied ${slot}`, 5), PLAYER1, `occupied-${slot}`)
  );

  const session = createGameSession();
  session.createGame('hs-bp5-002-sayaka', PLAYER1, 'P1', PLAYER2, 'P2');
  let game = createGameState('hs-bp5-002-sayaka', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...energyCards,
    ...options.waitingRoomTargets,
    ...occupiedMembers,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const [index, slot] of (options.occupiedSlots ?? []).entries()) {
      memberSlots = placeCardInSlot(memberSlots, slot, occupiedMembers[index]!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    let energyZone = player.energyZone;
    for (const energy of energyCards) {
      energyZone = addCardToStatefulZone(energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    let waitingRoom = player.waitingRoom;
    for (const target of options.waitingRoomTargets) {
      waitingRoom = addCardToZone(waitingRoom, target.instanceId);
    }

    return {
      ...player,
      energyZone,
      waitingRoom,
      memberSlots,
    };
  });
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;

  return {
    session,
    source,
    energyCards,
    waitingRoomTargets: options.waitingRoomTargets,
  };
}

function activateSayaka(session: ReturnType<typeof createGameSession>, sourceId: string) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      sourceId,
      HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID
    )
  );
}

function selectWaitingRoomTarget(
  session: ReturnType<typeof createGameSession>,
  selectedCardId: string
) {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId)
  );
  expect(result.success).toBe(true);
}

function selectStageSlot(session: ReturnType<typeof createGameSession>, selectedSlot: SlotPosition) {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, undefined, selectedSlot)
  );
  expect(result.success).toBe(true);
}

function countAbilityUseActions(game: GameState | null, sourceCardId: string): number {
  return (
    game?.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID &&
        action.payload.sourceCardId === sourceCardId &&
        action.payload.step === 'ABILITY_USE'
    ).length ?? 0
  );
}

describe('PL!HS-bp5-002 Sayaka activated workflow', () => {
  it('pays two energy, plays a low-cost waiting-room member active to an empty slot, and enforces once per turn', () => {
    const target = createCardInstance(
      createMember('PL!HS-test-low-cost-member', 'Low Cost Member', 2),
      PLAYER1,
      'low-cost-member'
    );
    const scenario = setupSayakaScenario({
      activeEnergyCount: 2,
      waitingRoomTargets: [target],
    });

    const activateResult = activateSayaka(scenario.session, scenario.source.instanceId);
    expect(activateResult.success, activateResult.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID,
      selectableCardIds: [target.instanceId],
    });
    for (const energy of scenario.energyCards) {
      expect(
        scenario.session.state?.players[0].energyZone.cardStates.get(energy.instanceId)
          ?.orientation
      ).toBe(OrientationState.WAITING);
    }

    selectWaitingRoomTarget(scenario.session, target.instanceId);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);

    selectStageSlot(scenario.session, SlotPosition.CENTER);

    const player = scenario.session.state!.players[0]!;
    expect(player.waitingRoom.cardIds).not.toContain(target.instanceId);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(target.instanceId);
    expect(player.memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === target.instanceId &&
          entry.event.fromZone === ZoneType.WAITING_ROOM &&
          entry.event.toSlot === SlotPosition.CENTER
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID &&
          Array.isArray(action.payload.energyCardIds) &&
          action.payload.energyCardIds.length === 2
      )
    ).toBe(true);

    const secondActivate = activateSayaka(scenario.session, scenario.source.instanceId);
    expect(secondActivate.success).toBe(false);
    expect(countAbilityUseActions(scenario.session.state, scenario.source.instanceId)).toBe(1);
  });

  it('enqueues ON_ENTER_STAGE abilities for the member played from waiting room', () => {
    const target = createCardInstance(
      createMember('PL!HS-bp1-008-R', '徒町 小鈴', 2),
      PLAYER1,
      'kosuzu-target'
    );
    const scenario = setupSayakaScenario({
      activeEnergyCount: 2,
      waitingRoomTargets: [target],
    });

    const activateResult = activateSayaka(scenario.session, scenario.source.instanceId);
    expect(activateResult.success, activateResult.error).toBe(true);
    selectWaitingRoomTarget(scenario.session, target.instanceId);
    selectStageSlot(scenario.session, SlotPosition.CENTER);

    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID &&
          action.payload.sourceCardId === target.instanceId
      )
    ).toBe(true);
  });

  it.each([
    {
      name: 'insufficient active energy',
      activeEnergyCount: 1,
      waitingRoomTargets: [
        createCardInstance(
          createMember('PL!HS-test-low-cost-energy-fail', 'Low Cost Member', 2),
          PLAYER1,
          'low-cost-energy-fail'
        ),
      ],
      occupiedSlots: [],
    },
    {
      name: 'no legal waiting-room target',
      activeEnergyCount: 2,
      waitingRoomTargets: [
        createCardInstance(
          createMember('PL!HS-test-high-cost-member', 'High Cost Member', 3),
          PLAYER1,
          'high-cost-member'
        ),
      ],
      occupiedSlots: [],
    },
    {
      name: 'no empty member slot',
      activeEnergyCount: 2,
      waitingRoomTargets: [
        createCardInstance(
          createMember('PL!HS-test-low-cost-no-slot', 'Low Cost Member', 2),
          PLAYER1,
          'low-cost-no-slot'
        ),
      ],
      occupiedSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
    },
  ])('does not pay or consume once-per-turn when $name', (config) => {
    const scenario = setupSayakaScenario(config);
    const result = activateSayaka(scenario.session, scenario.source.instanceId);

    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(countAbilityUseActions(scenario.session.state, scenario.source.instanceId)).toBe(0);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_BP5_002_ACTIVATED_PAY_TWO_ENERGY_PLAY_LOW_COST_MEMBER_ABILITY_ID
      )
    ).toBe(false);
    for (const energy of scenario.energyCards) {
      expect(
        scenario.session.state?.players[0].energyZone.cardStates.get(energy.instanceId)
          ?.orientation
      ).toBe(OrientationState.ACTIVE);
    }
  });
});
