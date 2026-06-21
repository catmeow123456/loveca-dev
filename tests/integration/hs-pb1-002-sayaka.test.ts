import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
  HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
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

function createMember(cardCode: string, name: string, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
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

function setupActivatedScenario(options: {
  readonly sourceCardCode?: string;
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
}) {
  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!HS-pb1-002-R', '村野さやか', 2),
    PLAYER1,
    'pb1-002-source'
  );
  const session = createGameSession();
  session.createGame('hs-pb1-002-activated', PLAYER1, 'P1', PLAYER2, 'P2');
  let game = createGameState('hs-pb1-002-activated', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...options.handCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: options.handCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, source };
}

function activateSayaka(session: ReturnType<typeof createGameSession>, sourceCardId: string) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      sourceCardId,
      HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID
    )
  );
}

function confirmEffect(
  session: ReturnType<typeof createGameSession>,
  selectedCardId?: string | null
) {
  const effectId = session.state!.activeEffect!.id;
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId)
  );
}

function setupLiveStartGame(options: {
  readonly sourceCardCode?: string;
  readonly sourceSlot?: SlotPosition;
  readonly memberBelowCount: number;
  readonly pendingSourceSlot?: SlotPosition;
}) {
  const sourceSlot = options.sourceSlot ?? SlotPosition.CENTER;
  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!HS-pb1-002-P+', '村野さやか', 2),
    PLAYER1,
    'pb1-002-live-source'
  );
  const belowMembers = Array.from({ length: options.memberBelowCount }, (_, index) =>
    createCardInstance(
      createMember(`PL!HS-test-below-${index}`, `Below ${index}`, index + 1),
      PLAYER1,
      `below-${index}`
    )
  );
  let game = createGameState('hs-pb1-002-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...belowMembers]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const below of belowMembers) {
      memberSlots = addMemberBelowMember(memberSlots, sourceSlot, below.instanceId);
    }
    return { ...player, memberSlots };
  });
  game = {
    ...game,
    pendingAbilities: [
      createLiveStartPendingAbility(source.instanceId, options.pendingSourceSlot ?? sourceSlot),
    ],
  };
  return { game, source, belowMembers, sourceSlot };
}

function createLiveStartPendingAbility(
  sourceCardId: string,
  sourceSlot: SlotPosition,
  suffix = '1'
): PendingAbilityState {
  return {
    id: `pb1-002-live-start-${suffix}`,
    abilityId: HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-event-${suffix}`],
    sourceSlot,
  };
}

describe('PL!HS-pb1-002 Sayaka workflow', () => {
  it('reveals a same-name hand member and stacks it below the source special member', () => {
    const handSayaka = createCardInstance(
      createMember('PL!HS-bp5-002-P', '村野沙耶香', 15),
      PLAYER1,
      'hand-sayaka'
    );
    const scenario = setupActivatedScenario({ handCards: [handSayaka] });

    const activateResult = activateSayaka(scenario.session, scenario.source.instanceId);
    expect(activateResult.success, activateResult.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
      selectableCardIds: [handSayaka.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });

    const revealResult = confirmEffect(scenario.session, handSayaka.instanceId);
    expect(revealResult.success, revealResult.error).toBe(true);
    expect(scenario.session.state?.activeEffect?.revealedCardIds).toEqual([handSayaka.instanceId]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(scenario.session.state?.activeEffect?.canSkipSelection).toBeUndefined();
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(handSayaka.instanceId);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'REVEAL_SAYAKA_HAND_MEMBER' &&
          action.payload.revealedCardId === handSayaka.instanceId
      )
    ).toBe(true);

    const stackResult = confirmEffect(scenario.session);
    expect(stackResult.success, stackResult.error).toBe(true);
    const player = scenario.session.state!.players[0]!;
    expect(player.hand.cardIds).not.toContain(handSayaka.instanceId);
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([handSayaka.instanceId]);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.source.instanceId);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.eventLog).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'STACK_REVEALED_SAYAKA_MEMBER_BELOW_SOURCE' &&
          action.payload.stackedCardId === handSayaka.instanceId &&
          action.payload.targetSlot === SlotPosition.CENTER
      )
    ).toBe(true);
  });

  it('does not start activated workflow for non-same-name, non-member, or no hand candidates', () => {
    const nonSameName = createCardInstance(
      createMember('PL!HS-test-kosuzu', '徒町 小鈴', 4),
      PLAYER1,
      'non-same-name'
    );
    const energy = createCardInstance(createEnergy('energy-hand-card'), PLAYER1, 'hand-energy');

    for (const handCards of [[nonSameName], [energy], []]) {
      const scenario = setupActivatedScenario({ handCards });
      const result = activateSayaka(scenario.session, scenario.source.instanceId);
      expect(result.success).toBe(false);
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(
        scenario.session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId ===
              HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID &&
            action.payload.step === 'ABILITY_USE'
        )
      ).toBe(false);
    }
  });

  it.each([
    { below: 1, expectedCost: 6, expectedHeartCount: 1 },
    { below: 2, expectedCost: 10, expectedHeartCount: 2 },
    { below: 3, expectedCost: 14, expectedHeartCount: 3 },
    { below: 4, expectedCost: 14, expectedHeartCount: 3 },
  ])('resolves live start from memberBelow count $below with cap at three', (config) => {
    const { game, source } = setupLiveStartGame({ memberBelowCount: config.below });

    const result = resolvePendingCardEffects(game).gameState;

    expect(result.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveCost(result, PLAYER1, source.instanceId)).toBe(config.expectedCost);
    expect(getMemberEffectiveHeartIcons(result, PLAYER1, source.instanceId)).toEqual([
      createHeartIcon(HeartColor.BLUE, 1),
      createHeartIcon(HeartColor.BLUE, config.expectedHeartCount),
    ]);
    expect(
      result.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'MEMBER_BELOW_COUNT_COST_BLUE_HEART' &&
          action.payload.countedMemberBelowCount === config.expectedHeartCount
      )
    ).toBe(true);
  });

  it('uses the source member current slot at live start, not the queued sourceSlot snapshot', () => {
    const { game, source } = setupLiveStartGame({
      memberBelowCount: 1,
      sourceSlot: SlotPosition.RIGHT,
      pendingSourceSlot: SlotPosition.LEFT,
    });

    const result = resolvePendingCardEffects(game).gameState;

    expect(getMemberEffectiveCost(result, PLAYER1, source.instanceId)).toBe(6);
    expect(
      result.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'MEMBER_BELOW_COUNT_COST_BLUE_HEART' &&
          action.payload.sourceSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('skips live start when source is no longer on stage or there are no members below', () => {
    const noBelow = setupLiveStartGame({ memberBelowCount: 0 });
    const noBelowResult = resolvePendingCardEffects(noBelow.game).gameState;
    expect(noBelowResult.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveCost(noBelowResult, PLAYER1, noBelow.source.instanceId)).toBe(2);
    expect(
      noBelowResult.actionHistory.some(
        (action) => action.payload.step === 'NO_MEMBER_BELOW'
      )
    ).toBe(true);

    const offStage = setupLiveStartGame({ memberBelowCount: 1 });
    const offStageGame = updatePlayer(offStage.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, offStage.sourceSlot),
      waitingRoom: addCardToZone(player.waitingRoom, offStage.source.instanceId),
    }));
    const offStageResult = resolvePendingCardEffects(offStageGame).gameState;
    expect(offStageResult.pendingAbilities).toEqual([]);
    expect(
      offStageResult.actionHistory.some(
        (action) => action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('stacks cost and Heart modifiers when the same live-start ability resolves twice in one Live', () => {
    const { game, source } = setupLiveStartGame({ memberBelowCount: 1 });
    const first = resolvePendingCardEffects(game).gameState;
    const secondPending = createLiveStartPendingAbility(
      source.instanceId,
      SlotPosition.CENTER,
      '2'
    );
    const second = resolvePendingCardEffects({
      ...first,
      pendingAbilities: [secondPending],
    }).gameState;

    expect(getMemberEffectiveCost(second, PLAYER1, source.instanceId)).toBe(10);
    expect(getMemberEffectiveHeartIcons(second, PLAYER1, source.instanceId)).toEqual([
      createHeartIcon(HeartColor.BLUE, 1),
      createHeartIcon(HeartColor.BLUE, 1),
      createHeartIcon(HeartColor.BLUE, 1),
    ]);
    expect(
      second.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId ===
          HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID
      )
    ).toHaveLength(4);
  });
});
