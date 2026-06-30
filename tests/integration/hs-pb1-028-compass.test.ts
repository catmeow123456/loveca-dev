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
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
  HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
  HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID,
  HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID,
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

function createMember(
  cardCode: string,
  name: string,
  options: {
    readonly cost?: number;
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: options.unitName ?? 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createCompassLive(): LiveCardData {
  return {
    cardCode: 'PL!HS-pb1-028-L',
    name: 'COMPASS',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score: 7,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 7, [HeartColor.RAINBOW]: 7 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createBaseGame(cards: readonly ReturnType<typeof createCardInstance>[]): GameState {
  let game = createGameState('hs-pb1-028-compass', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, cards);
  return {
    ...game,
    currentPhase: GamePhase.LIVE_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}

function addCompassLive(game: GameState, compass: ReturnType<typeof createCardInstance>): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, compass.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function addStageMember(
  game: GameState,
  cardId: string,
  slot: SlotPosition,
  memberBelowIds: readonly string[] = []
): GameState {
  return updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const memberBelowId of memberBelowIds) {
      memberSlots = addMemberBelowMember(memberSlots, slot, memberBelowId);
    }
    return { ...player, memberSlots };
  });
}

function addMainDeckTop(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: addCardToZone(player.mainDeck, cardId, 0),
  }));
}

function createCompassPending(compassId: string, suffix = '1'): PendingAbilityState {
  return {
    id: `compass-pending-${suffix}`,
    abilityId: HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID,
    sourceCardId: compassId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`compass-event-${suffix}`],
  };
}

function createMemberPending(
  abilityId: string,
  sourceCardId: string,
  sourceSlot: SlotPosition,
  suffix = 'natural'
): PendingAbilityState {
  return {
    id: `${sourceCardId}-${suffix}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`member-event-${suffix}`],
    sourceSlot,
  };
}

function createSessionWithState(game: GameState) {
  const session = createGameSession();
  session.createGame('hs-pb1-028-compass', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirm(
  session: ReturnType<typeof createGameSession>,
  options: {
    readonly selectedCardId?: string | null;
    readonly selectedOptionId?: string | null;
    readonly selectedNumber?: number | null;
  } = {}
) {
  const effectId = session.state!.activeEffect!.id;
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effectId,
      options.selectedCardId,
      undefined,
      undefined,
      options.selectedOptionId,
      undefined,
      options.selectedNumber
    )
  );
}

describe('PL!HS-pb1-028 COMPASS workflow', () => {
  it('skips without opening a target window when there is no eligible DOLLCHESTRA member', () => {
    const compass = createCardInstance(createCompassLive(), PLAYER1, 'compass');
    const lowCost = createCardInstance(
      createMember('PL!HS-pb1-005-R', '徒町小鈴', { cost: 9 }),
      PLAYER1,
      'low-cost-kosuzu'
    );
    const nonDoll = createCardInstance(
      createMember('PL!HS-pb1-005-R', '徒町小鈴', { cost: 11, unitName: 'Cerise Bouquet' }),
      PLAYER1,
      'non-doll-kosuzu'
    );
    const noAbility = createCardInstance(
      createMember('PL!HS-test-no-live-start', 'No Ability', { cost: 12 }),
      PLAYER1,
      'no-ability'
    );
    let game = createBaseGame([compass, lowCost, nonDoll, noAbility]);
    game = addCompassLive(game, compass);
    game = addStageMember(game, lowCost.instanceId, SlotPosition.LEFT);
    game = addStageMember(game, nonDoll.instanceId, SlotPosition.CENTER);
    game = addStageMember(game, noAbility.instanceId, SlotPosition.RIGHT);
    game = { ...game, pendingAbilities: [createCompassPending(compass.instanceId)] };

    const result = resolvePendingCardEffects(game).gameState;

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(
      result.actionHistory.some((action) => action.payload.step === 'NO_DOLLCHESTRA_TARGET')
    ).toBe(true);
  });

  it('opens a target window and can decline without delegating', () => {
    const compass = createCardInstance(createCompassLive(), PLAYER1, 'compass');
    const kosuzu = createCardInstance(
      createMember('PL!HS-pb1-005-R', '徒町小鈴', { cost: 11 }),
      PLAYER1,
      'kosuzu'
    );
    let game = createBaseGame([compass, kosuzu]);
    game = addCompassLive(game, compass);
    game = addStageMember(game, kosuzu.instanceId, SlotPosition.CENTER);
    game = { ...game, pendingAbilities: [createCompassPending(compass.instanceId)] };
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID,
      selectableCardIds: [kosuzu.instanceId],
    });
    const declineResult = confirm(session, { selectedCardId: null });

    expect(declineResult.success, declineResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) => action.payload.step === 'DECLINE_SELECT_DOLLCHESTRA_TARGET'
      )
    ).toBe(true);
  });

  it('delegates PB1-002 live-start again after its natural live-start resolved', () => {
    const compass = createCardInstance(createCompassLive(), PLAYER1, 'compass');
    const sayaka = createCardInstance(
      createMember('PL!HS-pb1-002-R', '村野さやか', { cost: 2 }),
      PLAYER1,
      'pb1-002-sayaka'
    );
    const belowOne = createCardInstance(
      createMember('PL!HS-test-below-1', 'Below 1', { cost: 1 }),
      PLAYER1,
      'below-1'
    );
    const belowTwo = createCardInstance(
      createMember('PL!HS-test-below-2', 'Below 2', { cost: 1 }),
      PLAYER1,
      'below-2'
    );
    let game = createBaseGame([compass, sayaka, belowOne, belowTwo]);
    game = addCompassLive(game, compass);
    game = addStageMember(game, sayaka.instanceId, SlotPosition.CENTER, [
      belowOne.instanceId,
      belowTwo.instanceId,
    ]);
    game = {
      ...game,
      pendingAbilities: [
        createMemberPending(
          HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
          sayaka.instanceId,
          SlotPosition.CENTER
        ),
      ],
    };
    const afterNatural = resolvePendingCardEffects(game).gameState;
    expect(getMemberEffectiveCost(afterNatural, PLAYER1, sayaka.instanceId)).toBe(10);

    const afterCompassStart = resolvePendingCardEffects({
      ...afterNatural,
      pendingAbilities: [createCompassPending(compass.instanceId)],
    }).gameState;
    const session = createSessionWithState(afterCompassStart);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([sayaka.instanceId]);

    expect(confirm(session, { selectedCardId: sayaka.instanceId }).success).toBe(true);
    expect(session.state?.activeEffect?.selectableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
        }),
      ])
    );
    expect(
      confirm(session, {
        selectedOptionId: HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
      }).success
    ).toBe(true);

    expect(getMemberEffectiveCost(session.state!, PLAYER1, sayaka.instanceId)).toBe(18);
    expect(getMemberEffectiveHeartIcons(session.state!, PLAYER1, sayaka.instanceId)).toEqual([
      createHeartIcon(HeartColor.BLUE, 1),
      createHeartIcon(HeartColor.BLUE, 2),
      createHeartIcon(HeartColor.BLUE, 2),
    ]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.payload.step === 'DELEGATE_DOLLCHESTRA_LIVE_START_ABILITY' &&
          action.payload.delegatedAbilityId ===
            HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID
      )
    ).toBe(true);
  });

  it('delegates PB1-005 into its numeric input with the target member as source', () => {
    const compass = createCardInstance(createCompassLive(), PLAYER1, 'compass');
    const kosuzu = createCardInstance(
      createMember('PL!HS-pb1-005-R', '徒町小鈴', { cost: 11 }),
      PLAYER1,
      'pb1-005-kosuzu'
    );
    const topCard = createCardInstance(
      createMember('PL!HS-test-top', 'Top Card', { cost: 5 }),
      PLAYER1,
      'top-card'
    );
    let game = createBaseGame([compass, kosuzu, topCard]);
    game = addCompassLive(game, compass);
    game = addStageMember(game, kosuzu.instanceId, SlotPosition.RIGHT);
    game = addMainDeckTop(game, topCard.instanceId);
    game = { ...game, pendingAbilities: [createCompassPending(compass.instanceId)] };
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(confirm(session, { selectedCardId: kosuzu.instanceId }).success).toBe(true);
    expect(
      confirm(session, {
        selectedOptionId: HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
      }).success
    ).toBe(true);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
      sourceCardId: kosuzu.instanceId,
      controllerId: PLAYER1,
    });
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.RIGHT);
    expect(session.state?.activeEffect?.numericInput).toMatchObject({ integerOnly: true });
  });

  it('delegates PR-020 and lets the target workflow require its own energy payment', () => {
    const compass = createCardInstance(createCompassLive(), PLAYER1, 'compass');
    const izumi = createCardInstance(
      createMember('PL!HS-PR-020-PR', '桂城 泉', { cost: 11 }),
      PLAYER1,
      'pr-020-izumi'
    );
    const energy = createCardInstance(createEnergy('energy'), PLAYER1, 'energy');
    const wrOne = createCardInstance(createMember('PL!HS-test-wr-1', 'WR1'), PLAYER1, 'wr-1');
    const wrTwo = createCardInstance(createMember('PL!HS-test-wr-2', 'WR2'), PLAYER1, 'wr-2');
    let game = createBaseGame([compass, izumi, energy, wrOne, wrTwo]);
    game = addCompassLive(game, compass);
    game = addStageMember(game, izumi.instanceId, SlotPosition.LEFT);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [wrOne.instanceId, wrTwo.instanceId],
      },
    }));
    game = { ...game, pendingAbilities: [createCompassPending(compass.instanceId)] };
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(confirm(session, { selectedCardId: izumi.instanceId }).success).toBe(true);
    expect(
      confirm(session, {
        selectedOptionId: HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID,
      }).success
    ).toBe(true);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID,
      sourceCardId: izumi.instanceId,
    });
    expect(session.state?.activeEffect?.selectableOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pay' })])
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('does not remove the target member natural pending ability when delegating a synthetic pending', () => {
    const compass = createCardInstance(createCompassLive(), PLAYER1, 'compass');
    const kosuzu = createCardInstance(
      createMember('PL!HS-pb1-005-R', '徒町小鈴', { cost: 11 }),
      PLAYER1,
      'pb1-005-kosuzu'
    );
    const topCard = createCardInstance(
      createMember('PL!HS-test-top', 'Top Card', { cost: 5 }),
      PLAYER1,
      'top-card'
    );
    let game = createBaseGame([compass, kosuzu, topCard]);
    game = addCompassLive(game, compass);
    game = addStageMember(game, kosuzu.instanceId, SlotPosition.CENTER);
    game = addMainDeckTop(game, topCard.instanceId);
    const compassPending = createCompassPending(compass.instanceId);
    const naturalPending = createMemberPending(
      HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
      kosuzu.instanceId,
      SlotPosition.CENTER
    );
    game = { ...game, pendingAbilities: [compassPending, naturalPending] };
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(session.state?.activeEffect?.canResolveInOrder).toBe(true);
    expect(
      confirm(session, { selectedCardId: compass.instanceId }).success
    ).toBe(true);
    expect(confirm(session, { selectedCardId: kosuzu.instanceId }).success).toBe(true);
    expect(
      confirm(session, {
        selectedOptionId: HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
      }).success
    ).toBe(true);

    expect(
      session.state?.pendingAbilities.some((ability) => ability.id === naturalPending.id)
    ).toBe(true);
    expect(session.state?.activeEffect?.id).toContain('compass:');
  });
});
