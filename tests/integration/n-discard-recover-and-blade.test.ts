import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID,
  N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
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

function createNijigasakiMember(cardCode: string, name = cardCode, cost = 9): MemberCardData {
  return {
    cardCode,
    name,
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createOtherMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    cardType: CardType.MEMBER,
    cost: 3,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createNijigasakiLive(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createOtherLive(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function createSessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('n-discard-recover-and-blade-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmCard(session: GameSession, cardId: string | null): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, cardId)
  );
  expect(result.success).toBe(true);
}

function setupKarinLiveStart(options: {
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly sourceCardCode?: string;
  readonly sourceName?: string;
  readonly sourceCost?: number;
  readonly sourceId?: string;
}): {
  readonly session: GameSession;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(
    createNijigasakiMember(
      options.sourceCardCode ?? 'PL!N-sd1-004-SD',
      options.sourceName ?? '朝香果林',
      options.sourceCost ?? 11
    ),
    PLAYER1,
    options.sourceId ?? 'karin-source'
  );
  let game = createGameState('n-sd1-004-karin', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...options.handCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: options.handCards.map((card) => card.instanceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
  const resolveResult = resolvePendingCardEffects(stateWithPending);
  return { session: createSessionWithState(resolveResult.gameState), source };
}

function setupShiorikoOnEnter(options: {
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards: readonly ReturnType<typeof createCardInstance>[];
  readonly sourceCardCode?: string;
  readonly sourceName?: string;
  readonly sourceId?: string;
}): {
  readonly session: GameSession;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(
    createNijigasakiMember(
      options.sourceCardCode ?? 'PL!N-bp5-022-N',
      options.sourceName ?? '三船栞子',
      9
    ),
    PLAYER1,
    options.sourceId ?? 'shioriko-source'
  );
  let game = createGameState('n-bp5-022-shioriko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...options.handCards, ...options.waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: options.handCards.map((card) => card.instanceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waitingCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const resolveResult = resolvePendingCardEffects(stateWithPending);
  return { session: createSessionWithState(resolveResult.gameState), source };
}

function setupContinuationScenario(): {
  readonly session: GameSession;
  readonly discard: ReturnType<typeof createCardInstance>;
  readonly remainingHand: ReturnType<typeof createCardInstance>;
} {
  const shioriko = createCardInstance(
    createNijigasakiMember('PL!N-bp5-022-N', '三船栞子', 9),
    PLAYER1,
    'continuation-shioriko'
  );
  const karin = createCardInstance(
    createNijigasakiMember('PL!N-sd1-004-SD', '朝香果林', 11),
    PLAYER1,
    'continuation-karin'
  );
  const discard = createCardInstance(
    createOtherMember('PL!SP-test-discard-member', 'Discard Cost'),
    PLAYER1,
    'continuation-discard'
  );
  const remainingHand = createCardInstance(
    createOtherMember('PL!SP-test-remaining-member', 'Remaining Hand'),
    PLAYER1,
    'continuation-remaining'
  );
  let game = createGameState('n-pending-continuation', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [shioriko, karin, discard, remainingHand]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const withKarin = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, karin.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    const withShioriko = placeCardInSlot(withKarin, SlotPosition.CENTER, shioriko.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: [discard.instanceId, remainingHand.instanceId],
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [],
      },
      memberSlots: withShioriko,
    };
  });
  game = emitGameEvent(
    game,
    createEnterStageEvent(
      shioriko.instanceId,
      ZoneType.HAND,
      SlotPosition.CENTER,
      PLAYER1,
      PLAYER1
    )
  );

  const withOnEnter = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const withLiveStart = enqueueTriggeredCardEffects(withOnEnter, [TriggerCondition.ON_LIVE_START]);
  const resolveResult = resolvePendingCardEffects(withLiveStart);
  return {
    session: createSessionWithState(resolveResult.gameState),
    discard,
    remainingHand,
  };
}

describe('PL!N discard/recover and BLADE workflows', () => {
  it('PL!N-sd1-004 discards one hand card at LIVE start and gives the source BLADE +2', () => {
    const discard = createCardInstance(
      createOtherMember('PL!SP-test-hand-member'),
      PLAYER1,
      'karin-discard'
    );
    const { session, source } = setupKarinLiveStart({ handCards: [discard] });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
      selectableCardIds: [discard.instanceId],
      canSkipSelection: true,
    });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
    });
  });

  it('PL!N-sd1-004 skip does not discard or add BLADE', () => {
    const hand = createCardInstance(createOtherMember('PL!SP-test-hand-member'), PLAYER1, 'hand');
    const { session } = setupKarinLiveStart({ handCards: [hand] });

    confirmCard(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([hand.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('PL!N-sd1-004 with no hand resolves without opening an illegal selection', () => {
    const { session } = setupKarinLiveStart({ handCards: [] });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.reason === 'NO_HAND'
      )
    ).toBe(true);
  });

  it('PL!N-bp1-005 discards one hand card at LIVE start and gives the source BLADE +1', () => {
    const discard = createCardInstance(
      createOtherMember('PL!SP-test-ai-hand-member'),
      PLAYER1,
      'ai-discard'
    );
    const { session, source } = setupKarinLiveStart({
      handCards: [discard],
      sourceCardCode: 'PL!N-bp1-005-R',
      sourceName: '宮下 愛',
      sourceCost: 4,
      sourceId: 'ai-source',
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID,
      selectableCardIds: [discard.instanceId],
      canSkipSelection: true,
    });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID,
    });
  });

  it('PL!N-bp1-005 skip does not discard or add BLADE', () => {
    const hand = createCardInstance(createOtherMember('PL!SP-test-ai-hand-member'), PLAYER1, 'ai-hand');
    const { session } = setupKarinLiveStart({
      handCards: [hand],
      sourceCardCode: 'PL!N-bp1-005-P',
      sourceName: '宮下 愛',
      sourceCost: 4,
      sourceId: 'ai-source-skip',
    });

    confirmCard(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([hand.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('PL!N-bp1-005 with no hand resolves without opening an illegal selection', () => {
    const { session } = setupKarinLiveStart({
      handCards: [],
      sourceCardCode: 'PL!N-bp1-005-R',
      sourceName: '宮下 愛',
      sourceCost: 4,
      sourceId: 'ai-source-no-hand',
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID &&
          action.payload.reason === 'NO_HAND'
      )
    ).toBe(true);
  });

  it('PL!N-bp5-022 discards one hand card then recovers an own waiting-room Nijigasaki LIVE only', () => {
    const discard = createCardInstance(
      createOtherMember('PL!SP-test-discard-member'),
      PLAYER1,
      'shioriko-discard'
    );
    const target = createCardInstance(
      createNijigasakiLive('PL!N-test-live', 'Nijigasaki LIVE'),
      PLAYER1,
      'recover-live'
    );
    const nijiMember = createCardInstance(
      createNijigasakiMember('PL!N-test-member', 'Nijigasaki Member'),
      PLAYER1,
      'non-live-member'
    );
    const otherLive = createCardInstance(
      createOtherLive('PL!SP-test-live', 'Other LIVE'),
      PLAYER1,
      'other-live'
    );
    const { session } = setupShiorikoOnEnter({
      handCards: [discard],
      waitingCards: [target, nijiMember, otherLive],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [discard.instanceId],
      canSkipSelection: true,
    });
    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      canSkipSelection: false,
    });
    confirmCard(session, target.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      nijiMember.instanceId,
      otherLive.instanceId,
      discard.instanceId,
    ]);
  });

  it('PL!N-bp5-022 can recover the Nijigasaki LIVE just discarded as the cost', () => {
    const discardedLive = createCardInstance(
      createNijigasakiLive('PL!N-cost-live', 'Cost LIVE'),
      PLAYER1,
      'cost-live'
    );
    const { session } = setupShiorikoOnEnter({ handCards: [discardedLive], waitingCards: [] });

    confirmCard(session, discardedLive.instanceId);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardedLive.instanceId]);
    confirmCard(session, discardedLive.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([discardedLive.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('PL!N-bp5-019 uses the same ON_ENTER workflow to discard and recover an own Nijigasaki LIVE', () => {
    const discard = createCardInstance(
      createOtherMember('PL!SP-test-setsuna-discard-member'),
      PLAYER1,
      'setsuna-discard'
    );
    const target = createCardInstance(
      createNijigasakiLive('PL!N-test-setsuna-live', 'Setsuna Target LIVE'),
      PLAYER1,
      'setsuna-recover-live'
    );
    const { session } = setupShiorikoOnEnter({
      handCards: [discard],
      waitingCards: [target],
      sourceCardCode: 'PL!N-bp5-019-N',
      sourceName: '優木せつ菜',
      sourceId: 'setsuna-source',
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [discard.instanceId],
      canSkipSelection: true,
    });
    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      canSkipSelection: false,
    });
    confirmCard(session, target.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
  });

  it('PL!N-bp5-019 can recover the Nijigasaki LIVE just discarded as the cost', () => {
    const discardedLive = createCardInstance(
      createNijigasakiLive('PL!N-setsuna-cost-live', 'Setsuna Cost LIVE'),
      PLAYER1,
      'setsuna-cost-live'
    );
    const { session } = setupShiorikoOnEnter({
      handCards: [discardedLive],
      waitingCards: [],
      sourceCardCode: 'PL!N-bp5-019-N',
      sourceName: '優木せつ菜',
      sourceId: 'setsuna-source-cost-live',
    });

    confirmCard(session, discardedLive.instanceId);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardedLive.instanceId]);
    confirmCard(session, discardedLive.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([discardedLive.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('PL!N-bp5-022 keeps the paid discard cost and ends when no recovery target exists', () => {
    const discard = createCardInstance(
      createOtherMember('PL!SP-test-discard-member'),
      PLAYER1,
      'no-target-discard'
    );
    const { session } = setupShiorikoOnEnter({ handCards: [discard], waitingCards: [] });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID &&
          action.payload.step === 'DISCARD_COST_NO_NIJIGASAKI_LIVE_TARGET'
      )
    ).toBe(true);
  });

  it('continues to the next pending ability after PL!N-bp5-022 finishes with no target', () => {
    const { session, discard, remainingHand } = setupContinuationScenario();

    expect(session.state?.activeEffect?.abilityId).toBe(
      N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
    );
    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
      selectableCardIds: [remainingHand.instanceId],
    });
  });
});
