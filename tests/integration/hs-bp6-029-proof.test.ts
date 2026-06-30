import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addMemberCostLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { GameService } from '../../src/application/game-service';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  cost: number,
  groupName = '蓮ノ空女学院スクールアイドルクラブ'
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(cardCode: string, score = 5): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 6, [HeartColor.BLUE]: 4 }),
  };
}

function putStageMember(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [slot]: cardId,
      },
      cardStates: new Map([
        ...player.memberSlots.cardStates,
        [cardId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
}

function setupProofLiveStart(options: {
  readonly memberCosts: readonly number[];
  readonly topCardCount: number;
  readonly costModifier?: { readonly index: number; readonly delta: number };
}) {
  const session = createGameSession();
  session.createGame('hs-bp6-029-proof', PLAYER1, 'P1', PLAYER2, 'P2');

  const proof = createCardInstance(createLiveCard('PL!HS-bp6-029-L', 5), PLAYER1, 'proof-live');
  const members = options.memberCosts.map((cost, index) =>
    createCardInstance(createMemberCard(`PL!HS-member-${index}`, cost), PLAYER1, `member-${index}`)
  );
  const topCards = Array.from({ length: options.topCardCount }, (_, index) =>
    createCardInstance(createMemberCard(`PL!HS-top-${index}`, 1), PLAYER1, `top-${index}`)
  );

  let game = registerCards(session.state!, [proof, ...members, ...topCards]);
  for (const [index, member] of members.entries()) {
    game = putStageMember(
      game,
      PLAYER1,
      [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index] ?? SlotPosition.RIGHT,
      member.instanceId
    );
  }
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: topCards.map((card) => card.instanceId) },
    liveZone: {
      ...player.liveZone,
      cardIds: [proof.instanceId],
      cardStates: new Map([
        [proof.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
  };
  if (options.costModifier) {
    const target = members[options.costModifier.index]!;
    const result = addMemberCostLiveModifierForMember(game, {
      playerId: PLAYER1,
      memberCardId: target.instanceId,
      sourceCardId: target.instanceId,
      abilityId: 'test-member-cost-threshold',
      countDelta: options.costModifier.delta,
    });
    expect(result).not.toBeNull();
    game = result!.gameState;
  }

  const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(checkResult.success, checkResult.error).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

  return { session, proof, members, topCards };
}

describe('PL!HS-bp6-029-L Proof live-start workflow', () => {
  it('does not inspect top cards or reduce requirements below total effective cost 20', () => {
    const { session, topCards } = setupProofLiveStart({
      memberCosts: [10, 9],
      topCardCount: 2,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID
      )?.payload
    ).toMatchObject({
      step: 'HASUNOSORA_COST_BELOW_TWENTY',
      hasunosoraCostTotal: 19,
    });
  });

  it('looks at top two cards, moves the selected card to hand, and returns the rest to deck top', () => {
    const { session, topCards } = setupProofLiveStart({
      memberCosts: [10, 10],
      topCardCount: 3,
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID,
      selectableCardIds: [topCards[0]!.instanceId, topCards[1]!.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: false,
    });
    expect(session.state?.activeEffect?.effectText).toContain('当前费用合计 20');
    expect(session.state?.activeEffect?.effectText).toContain('满足20档');
    expect(session.state?.activeEffect?.effectText).toContain('未满足30档');
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      [topCards[0]!.instanceId, topCards[1]!.instanceId]
    );
    expect(session.state?.activeEffect?.revealedCardIds ?? []).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toEqual({
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    });
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[2]!.instanceId]);
    expect(session.getPlayerViewState(PLAYER1)?.activeEffect?.selectableObjectIds).toEqual([
      createPublicObjectId(topCards[0]!.instanceId),
      createPublicObjectId(topCards[1]!.instanceId),
    ]);

    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[1]!.instanceId
      )
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
  });

  it('reduces RAINBOW requirement by two at total effective cost 30 or more', () => {
    const { session, proof, topCards } = setupProofLiveStart({
      memberCosts: [15, 15],
      topCardCount: 2,
    });

    expect(session.state?.activeEffect?.effectText).toContain('当前费用合计 30');
    expect(session.state?.activeEffect?.effectText).toContain('满足30档');
    expect(session.state?.activeEffect?.effectText).toContain('必要無Heart-2');
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: proof.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: proof.instanceId,
      abilityId: HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID,
    });

    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, topCards[0]!.instanceId)
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[0]!.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(topCards[1]!.instanceId);
  });

  it('uses effective member cost modifiers when checking the 20 and 30 thresholds', () => {
    const { session, proof, topCards } = setupProofLiveStart({
      memberCosts: [10, 14],
      topCardCount: 1,
      costModifier: { index: 1, delta: 6 },
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[0]!.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: proof.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: proof.instanceId,
      abilityId: HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID &&
          action.payload.step === 'AUTO_MOVE_ONLY_TOP_CARD_TO_HAND'
      )?.payload
    ).toMatchObject({
      hasunosoraCostTotal: 30,
      requirementReduction: 2,
    });
  });

  it('still reduces requirements when the deck is empty at total effective cost 30 or more', () => {
    const { session, proof } = setupProofLiveStart({
      memberCosts: [15, 15],
      topCardCount: 0,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: proof.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: proof.instanceId,
      abilityId: HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID,
    });
  });
});
