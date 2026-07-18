import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
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
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID,
  N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
  PL_N_PB1_001_ON_ENTER_OPTIONAL_DISCARD_IF_OTHER_COST_ELEVEN_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
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
    groupNames: ['Liella!'],
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
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createOtherLive(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
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

function createSessionWithStateAndClock(game: GameState, now: () => number): GameSession {
  const session = createGameSession({ now });
  session.createGame('n-discard-recover-and-blade-session-clock', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setSessionState(session: GameSession, game: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

function confirmCard(session: GameSession, cardId: string | null): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, cardId)
  );
  expect(result.success).toBe(true);
  confirmPublicSelectionIfNeeded(session);
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

function setupAyumuOnEnter(options: {
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards: readonly ReturnType<typeof createCardInstance>[];
  readonly ownStageCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly opponentStageCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly now?: () => number;
}): {
  readonly session: GameSession;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(
    createNijigasakiMember('PL!N-pb1-001-R', '上原歩夢', 11),
    PLAYER1,
    'ayumu-source'
  );
  const ownStageCards = options.ownStageCards ?? [];
  const opponentStageCards = options.opponentStageCards ?? [];
  let game = createGameState('n-pb1-001-ayumu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...options.handCards,
    ...options.waitingCards,
    ...ownStageCards,
    ...opponentStageCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const [index, card] of ownStageCards.slice(0, 2).entries()) {
      memberSlots = placeCardInSlot(
        memberSlots,
        index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
        card.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      );
    }
    return {
      ...player,
      hand: { ...player.hand, cardIds: options.handCards.map((card) => card.instanceId) },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: options.waitingCards.map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    for (const [index, card] of opponentStageCards.slice(0, 3).entries()) {
      memberSlots = placeCardInSlot(
        memberSlots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
        card.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      );
    }
    return { ...player, memberSlots };
  });
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const resolveResult = resolvePendingCardEffects(stateWithPending);
  return {
    session: options.now
      ? createSessionWithStateAndClock(resolveResult.gameState, options.now)
      : createSessionWithState(resolveResult.gameState),
    source,
  };
}

function setupContinuationScenario(): {
  readonly session: GameSession;
  readonly discard: ReturnType<typeof createCardInstance>;
  readonly remainingHand: ReturnType<typeof createCardInstance>;
  readonly shioriko: ReturnType<typeof createCardInstance>;
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
    createEnterStageEvent(shioriko.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const withOnEnter = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const withLiveStart = enqueueTriggeredCardEffects(withOnEnter, [TriggerCondition.ON_LIVE_START]);
  const resolveResult = resolvePendingCardEffects(withLiveStart);
  return {
    session: createSessionWithState(resolveResult.gameState),
    discard,
    remainingHand,
    shioriko,
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
    const hand = createCardInstance(
      createOtherMember('PL!SP-test-ai-hand-member'),
      PLAYER1,
      'ai-hand'
    );
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

  it('PL!N-bp1-003 reuses the shared ON_ENTER ability, including skip and immediate cost-card recovery', () => {
    const skippedCard = createCardInstance(
      createOtherMember('PL!SP-shizuku-skip-card'),
      PLAYER1,
      'shizuku-skip-card'
    );
    const skipped = setupShiorikoOnEnter({
      handCards: [skippedCard],
      waitingCards: [],
      sourceCardCode: 'PL!N-bp1-003-P',
      sourceName: '桜坂しずく',
      sourceId: 'shizuku-source-skip',
    }).session;
    expect(skipped.state?.activeEffect).toMatchObject({
      abilityId: N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    confirmCard(skipped, null);
    expect(skipped.state?.players[0].hand.cardIds).toEqual([skippedCard.instanceId]);
    expect(skipped.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const discardedLive = createCardInstance(
      createNijigasakiLive('PL!N-shizuku-cost-live', 'Shizuku Cost LIVE'),
      PLAYER1,
      'shizuku-cost-live'
    );
    const recovered = setupShiorikoOnEnter({
      handCards: [discardedLive],
      waitingCards: [],
      sourceCardCode: 'PL!N-bp1-003-SEC',
      sourceName: '桜坂しずく',
      sourceId: 'shizuku-source-recover',
    }).session;
    confirmCard(recovered, discardedLive.instanceId);
    expect(recovered.state?.activeEffect).toMatchObject({
      abilityId: N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [discardedLive.instanceId],
      canSkipSelection: false,
    });
    confirmCard(recovered, discardedLive.instanceId);
    expect(recovered.state?.activeEffect).toBeNull();
    expect(recovered.state?.players[0].hand.cardIds).toEqual([discardedLive.instanceId]);
    expect(recovered.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const noTargetCost = createCardInstance(
      createOtherMember('PL!SP-shizuku-no-target-cost'),
      PLAYER1,
      'shizuku-no-target-cost'
    );
    const noTarget = setupShiorikoOnEnter({
      handCards: [noTargetCost],
      waitingCards: [],
      sourceCardCode: 'PL!N-bp1-003-R＋',
      sourceName: '桜坂しずく',
      sourceId: 'shizuku-source-no-target',
    }).session;
    confirmCard(noTarget, noTargetCost.instanceId);
    expect(noTarget.state?.activeEffect).toBeNull();
    expect(noTarget.state?.players[0].hand.cardIds).toEqual([]);
    expect(noTarget.state?.players[0].waitingRoom.cardIds).toEqual([noTargetCost.instanceId]);
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
    const { session, discard, remainingHand, shioriko } = setupContinuationScenario();

    expect(session.state?.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    confirmCard(session, shioriko.instanceId);

    expect(session.state?.activeEffect?.abilityId).toBe(
      N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
    );
    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
      selectableCardIds: [remainingHand.instanceId],
    });
  });

  it('PL!N-pb1-001 opens the exact optional discard window and skip/no-hand paths consume safely', () => {
    const hand = createCardInstance(createOtherMember('PL!SP-ayumu-hand'), PLAYER1, 'ayumu-hand');
    const { session } = setupAyumuOnEnter({ handCards: [hand], waitingCards: [] });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId:
        PL_N_PB1_001_ON_ENTER_OPTIONAL_DISCARD_IF_OTHER_COST_ELEVEN_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [hand.instanceId],
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const effectId = session.state!.activeEffect!.id;
    const illegal = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, 'not-a-candidate')
    );
    expect(illegal.success).toBe(false);
    expect(session.state?.players[0].hand.cardIds).toEqual([hand.instanceId]);

    confirmCard(session, null);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([hand.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const noHand = setupAyumuOnEnter({ handCards: [], waitingCards: [] }).session;
    expect(noHand.state?.activeEffect).toBeNull();
    const noHandAction = noHand.state?.actionHistory.find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_N_PB1_001_ON_ENTER_OPTIONAL_DISCARD_IF_OTHER_COST_ELEVEN_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID &&
        action.payload.reason === 'NO_HAND'
    );
    expect(noHandAction?.payload).toMatchObject({
      abilityId:
        PL_N_PB1_001_ON_ENTER_OPTIONAL_DISCARD_IF_OTHER_COST_ELEVEN_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      reason: 'NO_HAND',
    });
  });

  it('PL!N-pb1-001 may pay with only itself or an opponent cost-11 member, then keeps the paid cost', () => {
    for (const opponentStageCards of [
      [],
      [
        createCardInstance(
          createOtherMember('PL!SP-opponent-cost-eleven', 'Opponent Cost 11'),
          PLAYER2,
          'opponent-cost-eleven'
        ),
      ],
    ]) {
      if (opponentStageCards[0]) {
        opponentStageCards[0] = {
          ...opponentStageCards[0],
          data: { ...opponentStageCards[0].data, cost: 11 },
        };
      }
      const discard = createCardInstance(
        createOtherMember(`PL!SP-pay-even-if-fail-${opponentStageCards.length}`),
        PLAYER1,
        `pay-even-if-fail-${opponentStageCards.length}`
      );
      const target = createCardInstance(
        createNijigasakiLive(`PL!N-would-be-target-${opponentStageCards.length}`),
        PLAYER1,
        `would-be-target-${opponentStageCards.length}`
      );
      const { session } = setupAyumuOnEnter({
        handCards: [discard],
        waitingCards: [target],
        opponentStageCards,
      });

      confirmCard(session, discard.instanceId);

      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.players[0].hand.cardIds).toEqual([]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
        target.instanceId,
        discard.instanceId,
      ]);
      expect(session.state?.eventLog.at(-1)?.event).toMatchObject({
        eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
        cardInstanceIds: [discard.instanceId],
        fromZone: ZoneType.HAND,
        toZone: ZoneType.WAITING_ROOM,
      });
      const payCostAction = session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            PL_N_PB1_001_ON_ENTER_OPTIONAL_DISCARD_IF_OTHER_COST_ELEVEN_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
      );
      expect(payCostAction?.payload).toMatchObject({
        abilityId:
          PL_N_PB1_001_ON_ENTER_OPTIONAL_DISCARD_IF_OTHER_COST_ELEVEN_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
        discardedHandCardIds: [discard.instanceId],
      });
    }
  });

  it('PL!N-pb1-001 accepts another same-card instance or any other printed cost-11 member', () => {
    for (const other of [
      createCardInstance(
        createNijigasakiMember('PL!N-pb1-001-P＋', '上原歩夢', 11),
        PLAYER1,
        'other-ayumu-instance'
      ),
      createCardInstance(
        createOtherMember('PL!SP-other-cost-eleven', 'Other Cost 11'),
        PLAYER1,
        'other-cost-eleven'
      ),
    ]) {
      const costElevenOther =
        other.data.cost === 11 ? other : { ...other, data: { ...other.data, cost: 11 } };
      const discard = createCardInstance(
        createOtherMember(`PL!SP-discard-${other.instanceId}`),
        PLAYER1,
        `discard-${other.instanceId}`
      );
      const target = createCardInstance(
        createNijigasakiLive(`PL!N-target-${other.instanceId}`),
        PLAYER1,
        `target-${other.instanceId}`
      );
      const { session } = setupAyumuOnEnter({
        handCards: [discard],
        waitingCards: [target],
        ownStageCards: [costElevenOther],
      });

      confirmCard(session, discard.instanceId);
      expect(session.state?.activeEffect).toMatchObject({
        selectableCardIds: [target.instanceId],
        selectionLabel: '选择要加入手牌的虹咲LIVE卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
      });
      confirmCard(session, target.instanceId);
      expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    }
  });

  it('PL!N-pb1-001 keeps the discard and writes an accurate no-target resolution when the condition is met', () => {
    const other = createCardInstance(
      createNijigasakiMember('PL!N-no-target-cost-eleven', 'Cost Eleven', 11),
      PLAYER1,
      'no-target-cost-eleven'
    );
    const discard = createCardInstance(
      createOtherMember('PL!SP-ayumu-no-target-discard'),
      PLAYER1,
      'ayumu-no-target-discard'
    );
    const otherGroupLive = createCardInstance(
      createOtherLive('PL!SP-ayumu-other-group-live'),
      PLAYER1,
      'ayumu-other-group-live'
    );
    const nijiMember = createCardInstance(
      createNijigasakiMember('PL!N-ayumu-niji-member'),
      PLAYER1,
      'ayumu-niji-member'
    );
    const { session } = setupAyumuOnEnter({
      handCards: [discard],
      waitingCards: [otherGroupLive, nijiMember],
      ownStageCards: [other],
    });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      otherGroupLive.instanceId,
      nijiMember.instanceId,
      discard.instanceId,
    ]);
    const noTargetAction = session.state?.actionHistory.find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.step === 'DISCARD_COST_NO_NIJIGASAKI_LIVE_TARGET'
    );
    expect(noTargetAction?.payload).toMatchObject({
      step: 'DISCARD_COST_NO_NIJIGASAKI_LIVE_TARGET',
      reason: 'NO_NIJIGASAKI_LIVE_TARGET',
      discardedCardIds: [discard.instanceId],
      selectedCardIds: [],
    });
  });

  it('PL!N-pb1-001 can recover the Nijigasaki LIVE just discarded as its cost', () => {
    const other = createCardInstance(
      createNijigasakiMember('PL!N-cost-live-condition-member', 'Cost Eleven', 11),
      PLAYER1,
      'cost-live-condition-member'
    );
    const discardedLive = createCardInstance(
      createNijigasakiLive('PL!N-pb1-001-discarded-live'),
      PLAYER1,
      'pb1-001-discarded-live'
    );
    const { session } = setupAyumuOnEnter({
      handCards: [discardedLive],
      waitingCards: [],
      ownStageCards: [other],
    });

    confirmCard(session, discardedLive.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardedLive.instanceId]);
    confirmCard(session, discardedLive.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([discardedLive.instanceId]);
  });

  it('keeps a discard-created waiting-room trigger behind the PL!N-pb1-001 parent effect', () => {
    const other = createCardInstance(
      createNijigasakiMember('PL!N-parent-cost-eleven', 'Cost Eleven', 11),
      PLAYER1,
      'parent-cost-eleven'
    );
    const triggerSource = createCardInstance(
      createNijigasakiMember('PL!HS-pb1-003-R', '大沢瑠璃乃', 5),
      PLAYER1,
      'waiting-room-trigger-source'
    );
    const discard = createCardInstance(
      createOtherMember('PL!SP-trigger-discard'),
      PLAYER1,
      'trigger-discard'
    );
    const target = createCardInstance(
      createNijigasakiLive('PL!N-trigger-target'),
      PLAYER1,
      'trigger-target'
    );
    const { session } = setupAyumuOnEnter({
      handCards: [discard],
      waitingCards: [target],
      ownStageCards: [other, triggerSource],
    });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId:
        PL_N_PB1_001_ON_ENTER_OPTIONAL_DISCARD_IF_OTHER_COST_ELEVEN_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
    });
    expect(session.state?.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: 'PL!HS-pb1-003-R:auto-hand-to-waiting-gain-pink-heart-blade',
      })
    );

    confirmCard(session, target.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId === 'PL!HS-pb1-003-R:auto-hand-to-waiting-gain-pink-heart-blade'
      )
    ).toBe(true);
  });

  it('PL!N-pb1-001 rechecks printed cost and the current stage only after payment', () => {
    const printedTen = createCardInstance(
      createNijigasakiMember('PL!N-printed-ten', 'Printed Ten', 10),
      PLAYER1,
      'printed-ten'
    );
    const discard = createCardInstance(
      createOtherMember('PL!SP-recheck-discard'),
      PLAYER1,
      'recheck-discard'
    );
    const target = createCardInstance(
      createNijigasakiLive('PL!N-recheck-target'),
      PLAYER1,
      'recheck-target'
    );
    const { session } = setupAyumuOnEnter({
      handCards: [discard],
      waitingCards: [target],
      ownStageCards: [printedTen],
    });
    setSessionState(session, {
      ...session.state!,
      liveResolution: {
        ...session.state!.liveResolution,
        liveModifiers: [
          ...session.state!.liveResolution.liveModifiers,
          {
            kind: 'MEMBER_COST',
            playerId: PLAYER1,
            memberCardId: printedTen.instanceId,
            countDelta: 1,
            abilityId: 'test-effective-cost-eleven',
          },
        ],
      },
    });
    confirmCard(session, discard.instanceId);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discard.instanceId);

    const printedEleven = createCardInstance(
      createNijigasakiMember('PL!N-printed-eleven', 'Printed Eleven', 11),
      PLAYER1,
      'printed-eleven'
    );
    const discard2 = createCardInstance(
      createOtherMember('PL!SP-recheck-discard-2'),
      PLAYER1,
      'recheck-discard-2'
    );
    const target2 = createCardInstance(
      createNijigasakiLive('PL!N-recheck-target-2'),
      PLAYER1,
      'recheck-target-2'
    );
    const second = setupAyumuOnEnter({
      handCards: [discard2],
      waitingCards: [target2],
      ownStageCards: [printedEleven],
    }).session;
    setSessionState(second, {
      ...second.state!,
      liveResolution: {
        ...second.state!.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: PLAYER1,
            memberCardId: printedEleven.instanceId,
            countDelta: -5,
            abilityId: 'test-effective-cost-six',
          },
        ],
      },
    });
    confirmCard(second, discard2.instanceId);
    expect(second.state?.activeEffect?.selectableCardIds).toEqual([target2.instanceId]);
  });

  it('PL!N-pb1-001 ignores memberBelow and still resolves after the source leaves if another cost-11 member is now top-level', () => {
    const below = createCardInstance(
      createNijigasakiMember('PL!N-below-cost-eleven', 'Below Cost Eleven', 11),
      PLAYER1,
      'below-cost-eleven'
    );
    const discard = createCardInstance(
      createOtherMember('PL!SP-below-discard'),
      PLAYER1,
      'below-discard'
    );
    const target = createCardInstance(
      createNijigasakiLive('PL!N-below-target'),
      PLAYER1,
      'below-target'
    );
    const belowScenario = setupAyumuOnEnter({
      handCards: [discard],
      waitingCards: [target, below],
    });
    setSessionState(
      belowScenario.session,
      updatePlayer(belowScenario.session.state!, PLAYER1, (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== below.instanceId),
        },
        memberSlots: addMemberBelowMember(
          player.memberSlots,
          SlotPosition.CENTER,
          below.instanceId
        ),
      }))
    );
    confirmCard(belowScenario.session, discard.instanceId);
    expect(belowScenario.session.state?.activeEffect).toBeNull();

    const enteringOther = createCardInstance(
      createNijigasakiMember('PL!N-new-cost-eleven', 'New Cost Eleven', 11),
      PLAYER1,
      'new-cost-eleven'
    );
    const discard2 = createCardInstance(
      createOtherMember('PL!SP-source-left-discard'),
      PLAYER1,
      'source-left-discard'
    );
    const target2 = createCardInstance(
      createNijigasakiLive('PL!N-source-left-target'),
      PLAYER1,
      'source-left-target'
    );
    const sourceLeaves = setupAyumuOnEnter({ handCards: [discard2], waitingCards: [target2] });
    let changed = registerCards(sourceLeaves.session.state!, [enteringOther]);
    changed = updatePlayer(changed, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.LEFT, enteringOther.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: enteringOther.instanceId,
          [SlotPosition.CENTER]: null,
        },
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, sourceLeaves.source.instanceId],
      },
    }));
    setSessionState(sourceLeaves.session, changed);
    confirmCard(sourceLeaves.session, discard2.instanceId);
    expect(sourceLeaves.session.state?.activeEffect?.selectableCardIds).toEqual([
      target2.instanceId,
    ]);
  });

  it('PL!N-pb1-001 public confirmation is shared, delayed, participant-resumable, and idempotent', () => {
    let now = 10_000;
    const discard = createCardInstance(
      createOtherMember('PL!SP-public-discard'),
      PLAYER1,
      'public-discard'
    );
    const other = createCardInstance(
      createNijigasakiMember('PL!N-public-cost-eleven', 'Cost Eleven', 11),
      PLAYER1,
      'public-cost-eleven'
    );
    const target = createCardInstance(
      createNijigasakiLive('PL!N-public-target'),
      PLAYER1,
      'public-target'
    );
    const { session } = setupAyumuOnEnter({
      handCards: [discard],
      waitingCards: [target],
      ownStageCards: [other],
      now: () => now,
    });
    confirmCard(session, discard.instanceId);
    const effectId = session.state!.activeEffect!.id;
    const submitted = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, target.instanceId)
    );
    expect(submitted.success, submitted.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [target.instanceId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(target.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    const publicObjectId = createPublicObjectId(target.instanceId);
    expect(projectPlayerViewState(session.state!, PLAYER1, { now }).activeEffect).toMatchObject({
      revealedObjectIds: [publicObjectId],
      publicCardSelectionAutoAdvanceAfterMs: 2_000,
    });
    expect(projectPlayerViewState(session.state!, PLAYER2, { now }).activeEffect).toMatchObject({
      revealedObjectIds: [publicObjectId],
      publicCardSelectionAutoAdvanceAfterMs: 2_000,
    });
    const early = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
    );
    expect(early.success).toBe(false);
    now = 12_000;
    const advanced = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    const repeated = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 12_000)
    );
    expect(repeated.success).toBe(false);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
  });

  it('PL!N-pb1-001 revalidates a stale public selection and does not move it', () => {
    let now = 20_000;
    const discard = createCardInstance(
      createOtherMember('PL!SP-stale-discard'),
      PLAYER1,
      'stale-discard'
    );
    const other = createCardInstance(
      createNijigasakiMember('PL!N-stale-cost-eleven', 'Cost Eleven', 11),
      PLAYER1,
      'stale-cost-eleven'
    );
    const target = createCardInstance(
      createNijigasakiLive('PL!N-stale-target'),
      PLAYER1,
      'stale-target'
    );
    const { session } = setupAyumuOnEnter({
      handCards: [discard],
      waitingCards: [target],
      ownStageCards: [other],
      now: () => now,
    });
    confirmCard(session, discard.instanceId);
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, target.instanceId))
        .success
    ).toBe(true);
    setSessionState(
      session,
      updatePlayer(session.state!, PLAYER1, (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
        },
        mainDeck: { ...player.mainDeck, cardIds: [...player.mainDeck.cardIds, target.instanceId] },
      }))
    );
    now = 22_000;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 22_000))
        .success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).not.toContain(target.instanceId);
    expect(session.state?.players[0].mainDeck.cardIds).toContain(target.instanceId);
    const staleSelectionAction = session.state?.actionHistory.find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.step === 'STALE_SELECTION_NO_LONGER_ELIGIBLE'
    );
    expect(staleSelectionAction?.payload).toMatchObject({
      step: 'STALE_SELECTION_NO_LONGER_ELIGIBLE',
    });
  });
});
