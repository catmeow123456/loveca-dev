import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
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
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
  PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
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

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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

function setupBp5001(
  options: { readonly withHand?: boolean; readonly withPending?: boolean } = {}
): {
  readonly game: GameState;
  readonly sourceMember: CardInstance<MemberCardData>;
  readonly live: CardInstance<LiveCardData>;
  readonly handCost: CardInstance<MemberCardData>;
  readonly deckCards: readonly CardInstance[];
} {
  const sourceMember = createCardInstance(
    createMemberCard('PL!-bp5-001-AR', { name: '高坂穂乃果', cost: 4 }),
    PLAYER1,
    'bp5-001-source'
  );
  const live = createCardInstance(
    createLiveCard('PL!-bp5-020-L', 3),
    PLAYER1,
    'bp5-001-success-live'
  );
  const handCost = createCardInstance(
    createMemberCard('PL!-bp5-001-hand-cost'),
    PLAYER1,
    'bp5-001-hand-cost'
  );
  const deckCards = Array.from({ length: 6 }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!-bp5-001-deck-${index}`),
      PLAYER1,
      `bp5-001-deck-${index}`
    )
  );

  let game = createGameState('pl-bp5-001', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceMember, live, handCost, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sourceMember.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    liveZone: addCardToZone(player.liveZone, live.instanceId),
    hand: options.withHand === false ? player.hand : addCardToZone(player.hand, handCost.instanceId),
    mainDeck: deckCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([[PLAYER1, 3]]),
    },
  };
  if (options.withPending === false) {
    return {
      game,
      sourceMember,
      live,
      handCost,
      deckCards,
    };
  }
  return {
    game: addPendingAbility(
      game,
      PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
      sourceMember.instanceId,
      TriggerCondition.ON_LIVE_SUCCESS
    ),
    sourceMember,
    live,
    handCost,
    deckCards,
  };
}

function createSunnyStageMember(
  instanceId: string,
  name: string,
  groupNames: readonly string[] = ["μ's"]
): CardInstance<MemberCardData> {
  return createCardInstance(
    createMemberCard(`PL!-bp5-021-${instanceId}`, { name, groupNames }),
    PLAYER1,
    instanceId
  );
}

function setupSunnyDaySong(options: { readonly stageMembers?: readonly CardInstance<MemberCardData>[] } = {}): {
  readonly game: GameState;
  readonly live: CardInstance<LiveCardData>;
  readonly p1Discard: CardInstance<MemberCardData>;
  readonly p2Discard: CardInstance<MemberCardData>;
  readonly p1Draw: CardInstance<MemberCardData>;
  readonly p2Draw: CardInstance<MemberCardData>;
  readonly stageMembers: readonly CardInstance<MemberCardData>[];
} {
  const live = createCardInstance(
    createLiveCard('PL!-bp5-021-L', 3),
    PLAYER1,
    'sunny-day-song'
  );
  const stageMembers =
    options.stageMembers ??
    [
      createCardInstance(
        createMemberCard('PL!-bp5-021-honoka', { name: '高坂穂乃果' }),
        PLAYER1,
        'sunny-honoka'
      ),
      createCardInstance(
        createMemberCard('PL!-bp5-021-umi', { name: '園田海未' }),
        PLAYER1,
        'sunny-umi'
      ),
      createCardInstance(
        createMemberCard('PL!-bp5-021-kotori', { name: '南ことり' }),
        PLAYER1,
        'sunny-kotori'
      ),
    ];
  const p1Discard = createCardInstance(
    createMemberCard('PL!-bp5-021-p1-discard'),
    PLAYER1,
    'sunny-p1-discard'
  );
  const p2Discard = createCardInstance(
    createMemberCard('PL!-bp5-021-p2-discard'),
    PLAYER2,
    'sunny-p2-discard'
  );
  const p1Draw = createCardInstance(
    createMemberCard('PL!-bp5-021-p1-draw'),
    PLAYER1,
    'sunny-p1-draw'
  );
  const p2Draw = createCardInstance(
    createMemberCard('PL!-bp5-021-p2-draw'),
    PLAYER2,
    'sunny-p2-draw'
  );

  let game = createGameState('pl-bp5-021', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    live,
    ...stageMembers,
    p1Discard,
    p2Discard,
    p1Draw,
    p2Draw,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, live.instanceId),
    memberSlots: stageMembers.reduce(
      (slots, card, index) =>
        placeCardInSlot(
          slots,
          [SlotPosition.CENTER, SlotPosition.LEFT, SlotPosition.RIGHT][index]!,
          card.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        ),
      player.memberSlots
    ),
    hand: addCardToZone(player.hand, p1Discard.instanceId),
    mainDeck: addCardToZone(player.mainDeck, p1Draw.instanceId),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, p2Discard.instanceId),
    mainDeck: addCardToZone(player.mainDeck, p2Draw.instanceId),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 3]]),
    },
  };
  return {
    game: addPendingAbility(
      game,
      PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
      live.instanceId,
      TriggerCondition.ON_LIVE_START
    ),
    live,
    p1Discard,
    p2Discard,
    p1Draw,
    p2Draw,
    stageMembers,
  };
}

function resolveSunnyDaySongThroughDiscards(
  setup: ReturnType<typeof setupSunnyDaySong>
): GameState {
  const afterDraw = resolvePendingCardEffects(setup.game).gameState;
  const afterP1Discard = confirmActiveEffectStep(
    afterDraw,
    PLAYER1,
    afterDraw.activeEffect!.id,
    setup.p1Discard.instanceId
  );
  return confirmActiveEffectStep(
    afterP1Discard,
    PLAYER2,
    afterP1Discard.activeEffect!.id,
    setup.p2Discard.instanceId
  );
}

describe('PL!-bp5-001 高坂穂乃果 LIVE success', () => {
  it('queues from the stage member when a LIVE succeeds', () => {
    const setup = setupBp5001({ withPending: false });

    const queued = enqueueTriggeredCardEffects(setup.game, [TriggerCondition.ON_LIVE_SUCCESS]);

    expect(queued.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
        sourceCardId: setup.sourceMember.instanceId,
        controllerId: PLAYER1,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      }),
    ]);

    const started = resolvePendingCardEffects(queued).gameState;
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
      sourceCardId: setup.sourceMember.instanceId,
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
    });
  });

  it('uses a real optional discard cost, then looks at current LIVE score + 2 cards', () => {
    const setup = setupBp5001();
    const started = resolvePendingCardEffects(setup.game).gameState;
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_BP5_001_LIVE_SUCCESS_DISCARD_LOOK_TOP_BY_LIVE_SCORE_ABILITY_ID,
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(started.activeEffect?.metadata?.topCount).toBe(5);

    const inspected = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      setup.handCost.instanceId
    );
    expect(inspected.activeEffect?.inspectionCardIds).toHaveLength(5);
    expect(inspected.activeEffect?.selectableCardIds).toEqual(
      setup.deckCards.slice(0, 5).map((card) => card.instanceId)
    );

    const selected = setup.deckCards[2]!;
    const resolved = confirmActiveEffectStep(
      inspected,
      PLAYER1,
      inspected.activeEffect!.id,
      selected.instanceId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual([selected.instanceId]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([
      setup.handCost.instanceId,
      setup.deckCards[0]!.instanceId,
      setup.deckCards[1]!.instanceId,
      setup.deckCards[3]!.instanceId,
      setup.deckCards[4]!.instanceId,
    ]);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(setup.handCost.instanceId)
      )
    ).toBe(true);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.MAIN_DECK &&
          entry.event.cardInstanceIds?.join(',') ===
            [
              setup.deckCards[0]!.instanceId,
              setup.deckCards[1]!.instanceId,
              setup.deckCards[3]!.instanceId,
              setup.deckCards[4]!.instanceId,
            ].join(',')
      )
    ).toBe(true);
  });

  it('can decline without discarding or inspecting cards', () => {
    const setup = setupBp5001();
    const started = resolvePendingCardEffects(setup.game).gameState;

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([setup.handCost.instanceId]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([]);
    expect(resolved.inspectionZone.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(
      setup.deckCards.map((card) => card.instanceId)
    );
  });

  it('consumes the pending ability without a window when there is no hand card to discard', () => {
    const setup = setupBp5001({ withHand: false });
    const resolved = resolvePendingCardEffects(setup.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'NO_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });
});

describe('PL!-bp5-021-L SUNNY DAY SONG', () => {
  it('draws and discards for each player, grants a selected Muse member yellow Heart, and scores for different names', () => {
    const setup = setupSunnyDaySong();
    const afterDraw = resolvePendingCardEffects(setup.game).gameState;
    expect(afterDraw.players[0].hand.cardIds).toEqual([
      setup.p1Discard.instanceId,
      setup.p1Draw.instanceId,
    ]);
    expect(afterDraw.players[1].hand.cardIds).toEqual([
      setup.p2Discard.instanceId,
      setup.p2Draw.instanceId,
    ]);
    expect(afterDraw.activeEffect).toMatchObject({
      abilityId: PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      canSkipSelection: false,
    });

    const afterP1Discard = confirmActiveEffectStep(
      afterDraw,
      PLAYER1,
      afterDraw.activeEffect!.id,
      setup.p1Discard.instanceId
    );
    expect(afterP1Discard.activeEffect?.awaitingPlayerId).toBe(PLAYER2);

    const afterP2Discard = confirmActiveEffectStep(
      afterP1Discard,
      PLAYER2,
      afterP1Discard.activeEffect!.id,
      setup.p2Discard.instanceId
    );
    expect(afterP2Discard.activeEffect).toMatchObject({
      stepId: 'PL_BP5_021_SELECT_MUSE_MEMBER_GAIN_YELLOW_HEART',
    });
    expect([...(afterP2Discard.activeEffect?.selectableCardIds ?? [])].sort()).toEqual(
      setup.stageMembers.map((card) => card.instanceId).sort()
    );

    const resolved = confirmActiveEffectStep(
      afterP2Discard,
      PLAYER1,
      afterP2Discard.activeEffect!.id,
      setup.stageMembers[1]!.instanceId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([setup.p1Discard.instanceId]);
    expect(resolved.players[1].waitingRoom.cardIds).toEqual([setup.p2Discard.instanceId]);
    expect(resolved.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'HEART',
          playerId: PLAYER1,
          targetMemberCardId: setup.stageMembers[1]!.instanceId,
          hearts: [{ color: HeartColor.YELLOW, count: 1 }],
        }),
        expect.objectContaining({
          kind: 'SCORE',
          playerId: PLAYER1,
          liveCardId: setup.live.instanceId,
          countDelta: 1,
        }),
      ])
    );
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
  });

  it('does nothing when own stage has no members', () => {
    const setup = setupSunnyDaySong({ stageMembers: [] });
    const resolved = resolvePendingCardEffects(setup.game).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([setup.p1Discard.instanceId]);
    expect(resolved.players[1].hand.cardIds).toEqual([setup.p2Discard.instanceId]);
  });

  it('with one stage member only draws and discards for each player', () => {
    const setup = setupSunnyDaySong({
      stageMembers: [createSunnyStageMember('sunny-single-honoka', '高坂穂乃果')],
    });

    const resolved = resolveSunnyDaySongThroughDiscards(setup);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([setup.p1Discard.instanceId]);
    expect(resolved.players[1].waitingRoom.cardIds).toEqual([setup.p2Discard.instanceId]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);
  });

  it('with two stage members grants yellow Heart but does not add score', () => {
    const setup = setupSunnyDaySong({
      stageMembers: [
        createSunnyStageMember('sunny-two-honoka', '高坂穂乃果'),
        createSunnyStageMember('sunny-two-umi', '園田海未'),
      ],
    });
    const afterDiscards = resolveSunnyDaySongThroughDiscards(setup);
    expect(afterDiscards.activeEffect).toMatchObject({
      stepId: 'PL_BP5_021_SELECT_MUSE_MEMBER_GAIN_YELLOW_HEART',
    });

    const resolved = confirmActiveEffectStep(
      afterDiscards,
      PLAYER1,
      afterDiscards.activeEffect!.id,
      setup.stageMembers[0]!.instanceId
    );

    expect(resolved.liveResolution.liveModifiers).toEqual([
      expect.objectContaining({
        kind: 'HEART',
        playerId: PLAYER1,
        targetMemberCardId: setup.stageMembers[0]!.instanceId,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      }),
    ]);
    expect(resolved.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'SCORE')).toBe(
      false
    );
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);
  });

  it('with three stage members sharing a name grants Heart but does not add score', () => {
    const setup = setupSunnyDaySong({
      stageMembers: [
        createSunnyStageMember('sunny-duplicate-honoka-1', '高坂穂乃果'),
        createSunnyStageMember('sunny-duplicate-honoka-2', '高坂穂乃果'),
        createSunnyStageMember('sunny-duplicate-umi', '園田海未'),
      ],
    });
    const afterDiscards = resolveSunnyDaySongThroughDiscards(setup);

    const resolved = confirmActiveEffectStep(
      afterDiscards,
      PLAYER1,
      afterDiscards.activeEffect!.id,
      setup.stageMembers[2]!.instanceId
    );

    expect(resolved.liveResolution.liveModifiers).toEqual([
      expect.objectContaining({
        kind: 'HEART',
        targetMemberCardId: setup.stageMembers[2]!.instanceId,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      }),
    ]);
    expect(resolved.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'SCORE')).toBe(
      false
    );
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);
  });
});
