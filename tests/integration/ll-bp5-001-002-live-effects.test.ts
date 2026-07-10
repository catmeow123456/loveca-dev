import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  LL_BP5_001_LIVE_SUCCESS_CHEER_LIVE_OR_STAGE_HEARTS_OR_MOVED_SCORE_ABILITY_ID,
  LL_BP5_002_LIVE_START_THREE_DIFFERENT_GROUPS_CENTER_ALL_HEART_ABILITY_ID,
  LL_BP5_002_LIVE_SUCCESS_RECOVER_DIFFERENT_GROUP_CARD_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  groupName: string,
  hearts: readonly HeartColor[] = [HeartColor.PINK]
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function createLiveCard(
  cardCode: string,
  groupName: string,
  score = 4
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupLiveWithASmile(options: {
  readonly cheerLives?: number;
  readonly stageHearts?: readonly [readonly HeartColor[], readonly HeartColor[], readonly HeartColor[]];
  readonly moved?: boolean;
}): GameState {
  const sourceLive = createCardInstance(
    createLiveCard('LL-bp5-001-L', "μ's", 1),
    PLAYER1,
    'live-with-a-smile'
  );
  const center = createCardInstance(
    createMemberCard('PL!-test-center', "μ's", options.stageHearts?.[0] ?? [HeartColor.PINK]),
    PLAYER1,
    'stage-center'
  );
  const left = createCardInstance(
    createMemberCard('PL!-test-left', 'Aqours', options.stageHearts?.[1] ?? [HeartColor.RED]),
    PLAYER1,
    'stage-left'
  );
  const right = createCardInstance(
    createMemberCard('PL!-test-right', 'Liella!', options.stageHearts?.[2] ?? [HeartColor.YELLOW]),
    PLAYER1,
    'stage-right'
  );
  const cheerCards = Array.from({ length: options.cheerLives ?? 0 }, (_, index) =>
    createCardInstance(
      createLiveCard(`LL-bp5-001-cheer-live-${index}`, "μ's", 1),
      PLAYER1,
      `cheer-live-${index}`
    )
  );

  let game = createGameState('ll-bp5-001', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, center, left, right, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, sourceLive.instanceId),
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, center.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        left.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      SlotPosition.RIGHT,
      right.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    positionMovedThisTurn: options.moved ? [right.instanceId] : player.positionMovedThisTurn,
  }));
  return addPendingAbility(
    {
      ...game,
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: cheerCards.map((card) => card.instanceId),
        revealedCardIds: cheerCards.map((card) => card.instanceId),
      },
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
        firstPlayerCheerCardIds: cheerCards.map((card) => card.instanceId),
        playerScores: new Map([[PLAYER1, 1]]),
      },
    },
    LL_BP5_001_LIVE_SUCCESS_CHEER_LIVE_OR_STAGE_HEARTS_OR_MOVED_SCORE_ABILITY_ID,
    sourceLive.instanceId,
    TriggerCondition.ON_LIVE_SUCCESS
  );
}

function setupBringTheLove(options: {
  readonly stageGroups: readonly [string, string, string];
  readonly waitingGroups?: readonly string[];
  readonly liveSuccess?: boolean;
}): {
  readonly game: GameState;
  readonly liveId: string;
  readonly waitingIds: readonly string[];
} {
  const live = createCardInstance(
    createLiveCard('LL-bp5-002-L', "μ's", 4),
    PLAYER1,
    'bring-the-love'
  );
  const center = createCardInstance(
    createMemberCard('PL!-stage-center', options.stageGroups[0]),
    PLAYER1,
    'bring-center'
  );
  const left = createCardInstance(
    createMemberCard('PL!-stage-left', options.stageGroups[1]),
    PLAYER1,
    'bring-left'
  );
  const right = createCardInstance(
    createMemberCard('PL!-stage-right', options.stageGroups[2]),
    PLAYER1,
    'bring-right'
  );
  const waitingCards = (options.waitingGroups ?? []).map((group, index) =>
    createCardInstance(
      index === 0
        ? createLiveCard(`LL-bp5-002-waiting-live-${index}`, group, 1)
        : createMemberCard(`LL-bp5-002-waiting-member-${index}`, group),
      PLAYER1,
      `waiting-${index}`
    )
  );
  let game = createGameState('ll-bp5-002', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, center, left, right, ...waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, live.instanceId),
    waitingRoom: waitingCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, center.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        left.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      SlotPosition.RIGHT,
      right.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  const abilityId = options.liveSuccess
    ? LL_BP5_002_LIVE_SUCCESS_RECOVER_DIFFERENT_GROUP_CARD_ABILITY_ID
    : LL_BP5_002_LIVE_START_THREE_DIFFERENT_GROUPS_CENTER_ALL_HEART_ABILITY_ID;
  return {
    game: addPendingAbility(
      {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          isInLive: true,
          performingPlayerId: PLAYER1,
        },
      },
      abilityId,
      live.instanceId,
      options.liveSuccess ? TriggerCondition.ON_LIVE_SUCCESS : TriggerCondition.ON_LIVE_START
    ),
    liveId: live.instanceId,
    waitingIds: waitingCards.map((card) => card.instanceId),
  };
}

function addPendingAbility(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): GameState {
  const pending: PendingAbilityState = {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${abilityId}:event`],
  };
  return {
    ...game,
    pendingAbilities: [...game.pendingAbilities, pending],
  };
}

function resolveConfirmOnly(game: GameState): GameState {
  const started = resolvePendingCardEffects(game).gameState;
  expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
}

describe('LL-bp5-001 Live with a smile!', () => {
  it('adds SCORE +1 when two own revealed cheer cards are LIVE cards', () => {
    const resolved = resolveConfirmOnly(setupLiveWithASmile({ cheerLives: 2 }));

    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      liveCardId: 'live-with-a-smile',
      countDelta: 1,
      sourceCardId: 'live-with-a-smile',
      abilityId: LL_BP5_001_LIVE_SUCCESS_CHEER_LIVE_OR_STAGE_HEARTS_OR_MOVED_SCORE_ABILITY_ID,
    });
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('adds SCORE +1 when stage members currently provide five of the six counted Heart colors', () => {
    const resolved = resolveConfirmOnly(
      setupLiveWithASmile({
        stageHearts: [
          [HeartColor.PINK, HeartColor.RED],
          [HeartColor.YELLOW, HeartColor.GREEN],
          [HeartColor.BLUE],
        ],
      })
    );

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('adds SCORE +1 when a stage member has moved areas this turn', () => {
    const resolved = resolveConfirmOnly(setupLiveWithASmile({ moved: true }));

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('does not add SCORE when none of the three conditions are met', () => {
    const started = resolvePendingCardEffects(setupLiveWithASmile({})).gameState;
    expect(started.activeEffect?.effectText).toContain('未满足条件');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'SCORE')).toBe(false);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
  });
});

describe('LL-bp5-002 Bring the LOVE!', () => {
  it('LIVE_START gives the center member ALL Heart when three stage members have different groups', () => {
    const { game } = setupBringTheLove({
      stageGroups: ["μ's", 'Aqours', 'Liella!'],
    });
    const resolved = resolveConfirmOnly(game);

    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      sourceCardId: 'bring-the-love',
      abilityId: LL_BP5_002_LIVE_START_THREE_DIFFERENT_GROUPS_CENTER_ALL_HEART_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: 'bring-center',
    });
  });

  it('LIVE_START does not give ALL Heart when stage groups repeat', () => {
    const { game } = setupBringTheLove({
      stageGroups: ["μ's", 'Aqours', 'Aqours'],
    });
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.effectText).toContain('未满足条件');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('LIVE_SUCCESS lets the player choose a non-member waiting-room card with a different group', () => {
    const { game, waitingIds } = setupBringTheLove({
      stageGroups: ["μ's", 'Aqours', 'Liella!'],
      waitingGroups: ['虹ヶ咲', "μ's"],
      liveSuccess: true,
    });
    const started = resolvePendingCardEffects(game).gameState;

    expect(started.activeEffect?.selectableCardIds).toEqual([waitingIds[0]]);
    expect(started.activeEffect?.selectionLabel).toBe('请选择要加入手牌的卡牌');
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, waitingIds[0]);

    expect(resolved.players[0]!.hand.cardIds).toContain(waitingIds[0]);
    expect(resolved.players[0]!.waitingRoom.cardIds).not.toContain(waitingIds[0]);
  });

  it('LIVE_SUCCESS consumes pending without a window when there is no legal target', () => {
    const { game } = setupBringTheLove({
      stageGroups: ["μ's", 'Aqours', 'Liella!'],
      waitingGroups: ["μ's", 'Aqours'],
      liveSuccess: true,
    });
    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'NO_DIFFERENT_GROUP_WAITING_ROOM_TARGET'
      )
    ).toBe(true);
  });

  it('LIVE_SUCCESS rejects a stale target that no longer differs from every stage member group', () => {
    const { game, waitingIds } = setupBringTheLove({
      stageGroups: ["μ's", 'Aqours', 'Liella!'],
      waitingGroups: ['虹ヶ咲'],
      liveSuccess: true,
    });
    const started = resolvePendingCardEffects(game).gameState;
    const staleCard = started.cardRegistry.get('bring-right')!;
    const stateWithChangedGroup = {
      ...started,
      cardRegistry: new Map(started.cardRegistry).set('bring-right', {
        ...staleCard,
        data: createMemberCard(staleCard.data.cardCode, '虹ヶ咲'),
      }),
    };

    const afterConfirm = confirmActiveEffectStep(
      stateWithChangedGroup,
      PLAYER1,
      stateWithChangedGroup.activeEffect!.id,
      waitingIds[0]
    );

    expect(afterConfirm.activeEffect).not.toBeNull();
    expect(afterConfirm.players[0]!.hand.cardIds).not.toContain(waitingIds[0]);
    expect(afterConfirm.players[0]!.waitingRoom.cardIds).toContain(waitingIds[0]);
  });
});
