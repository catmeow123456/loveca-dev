import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { GameService } from '../../src/application/game-service';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID,
  HS_BP6_005_LIVE_SUCCESS_DOLLCHESTRA_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  cost: number,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: options.unitName ?? 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(cardCode: string, score = 3): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1, [HeartColor.RAINBOW]: 1 }),
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

function startLiveStartScenario(options: {
  readonly opponentCost: number;
  readonly handCount?: number;
  readonly includeHandToWaitingWatcher?: boolean;
}) {
  const session = createGameSession();
  session.createGame('hs-bp6-005-live-start', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(
    createMemberCard('PL!HS-bp6-005-P', 10, { name: '徒町 小鈴' }),
    PLAYER1,
    'kosuzu-source'
  );
  const watcher = createCardInstance(
    createMemberCard('PL!HS-pb1-003-R', 10, { name: '大沢瑠璃乃' }),
    PLAYER1,
    'hand-to-waiting-watcher'
  );
  const opponentMember = createCardInstance(
    createMemberCard('PL!HS-test-opponent', options.opponentCost),
    PLAYER2,
    'opponent-member'
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!HS-test-hand-${index}`, 1),
      PLAYER1,
      `discard-${index}`
    )
  );

  let game = registerCards(session.state!, [
    source,
    opponentMember,
    ...(options.includeHandToWaitingWatcher ? [watcher] : []),
    ...handCards,
  ]);
  game = putStageMember(game, PLAYER1, SlotPosition.CENTER, source.instanceId);
  if (options.includeHandToWaitingWatcher) {
    game = putStageMember(game, PLAYER1, SlotPosition.LEFT, watcher.instanceId);
  }
  game = putStageMember(game, PLAYER2, SlotPosition.CENTER, opponentMember.instanceId);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: [] },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
  };

  const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(checkResult.success, checkResult.error).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

  return { session, source, handCards };
}

describe('PL!HS-bp6-005 Kosuzu workflows', () => {
  it('skips live-start discard without paying cost or adding modifiers', () => {
    const { session } = startLiveStartScenario({ opponentCost: 1, handCount: 1 });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID
    );

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success, skipResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('adds cost before comparing stage totals and then grants source-member blue Heart plus BLADE', () => {
    const { session, source, handCards } = startLiveStartScenario({
      opponentCost: 12,
      includeHandToWaitingWatcher: true,
    });

    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        handCards[0]!.instanceId
      )
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(handCards[0]!.instanceId);
    expect(session.state?.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        {
          kind: 'MEMBER_COST',
          playerId: PLAYER1,
          memberCardId: source.instanceId,
          sourceCardId: source.instanceId,
          abilityId:
            HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID,
          countDelta: 6,
        },
        {
          kind: 'HEART',
          playerId: PLAYER1,
          target: 'SOURCE_MEMBER',
          hearts: [{ color: HeartColor.BLUE, count: 1 }],
          sourceCardId: source.instanceId,
          abilityId:
            HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID,
        },
        {
          kind: 'BLADE',
          playerId: PLAYER1,
          sourceCardId: source.instanceId,
          abilityId:
            HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID,
          countDelta: 1,
        },
      ])
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID &&
          action.payload.step === 'DISCARD_GAIN_COST_BLUE_HEART_BLADE'
      )?.payload
    ).toMatchObject({
      ownHasunosoraCostTotal: 26,
      opponentStageCostTotal: 12,
      conditionMet: true,
    });
  });

  it('keeps only the cost modifier when the post-cost total is not higher', () => {
    const { session, source, handCards } = startLiveStartScenario({ opponentCost: 20 });

    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        handCards[0]!.instanceId
      )
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: source.instanceId,
      sourceCardId: source.instanceId,
      abilityId: HS_BP6_005_LIVE_START_DISCARD_GAIN_COST_CONDITIONAL_BLUE_HEART_BLADE_ABILITY_ID,
      countDelta: 6,
    });
    expect(
      session.state?.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'HEART')
    ).toBe(false);
    expect(
      session.state?.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'BLADE')
    ).toBe(false);
  });

  it('recovers only own current revealed DOLLCHESTRA member cheer cards on live success', () => {
    const session = createGameSession();
    session.createGame('hs-bp6-005-live-success', PLAYER1, 'P1', PLAYER2, 'P2');

    const source = createCardInstance(createMemberCard('PL!HS-bp6-005-P', 10), PLAYER1, 'source');
    const valid = createCardInstance(
      createMemberCard('PL!HS-valid-dollchestra', 5, { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'valid-dollchestra'
    );
    const liveCard = createCardInstance(createLiveCard('PL!HS-live-cheer'), PLAYER1, 'live-cheer');
    const opponentCard = createCardInstance(
      createMemberCard('PL!HS-opponent-dollchestra', 5, { unitName: 'DOLLCHESTRA' }),
      PLAYER2,
      'opponent-dollchestra'
    );
    const oldCheer = createCardInstance(
      createMemberCard('PL!HS-old-dollchestra', 5, { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'old-dollchestra'
    );
    const leftZone = createCardInstance(
      createMemberCard('PL!HS-left-zone', 5, { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'left-zone'
    );
    const otherUnit = createCardInstance(
      createMemberCard('PL!HS-other-unit', 5, { unitName: 'みらくらぱーく！' }),
      PLAYER1,
      'other-unit'
    );

    let game = registerCards(session.state!, [
      source,
      valid,
      liveCard,
      opponentCard,
      oldCheer,
      leftZone,
      otherUnit,
    ]);
    game = putStageMember(game, PLAYER1, SlotPosition.CENTER, source.instanceId);
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      firstPlayerIndex: 0,
      activePlayerIndex: 0,
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: [valid.instanceId, liveCard.instanceId, opponentCard.instanceId, otherUnit.instanceId],
        revealedCardIds: [
          valid.instanceId,
          liveCard.instanceId,
          opponentCard.instanceId,
          otherUnit.instanceId,
          leftZone.instanceId,
        ],
      },
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map([[source.instanceId, true]]),
        firstPlayerCheerCardIds: [
          valid.instanceId,
          liveCard.instanceId,
          opponentCard.instanceId,
          otherUnit.instanceId,
          oldCheer.instanceId,
          leftZone.instanceId,
        ],
        performingPlayerId: PLAYER1,
      },
    };

    const checkResult = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(checkResult.success, checkResult.error).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_005_LIVE_SUCCESS_DOLLCHESTRA_MEMBER_REVEALED_CHEER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([valid.instanceId]);

    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, valid.instanceId)
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([valid.instanceId]);
    expect(session.state?.resolutionZone.cardIds).toEqual([
      liveCard.instanceId,
      opponentCard.instanceId,
      otherUnit.instanceId,
    ]);
  });
});
