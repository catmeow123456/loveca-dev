import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addHeartLiveModifierForMember,
  isLiveAbilitySuppressed,
  suppressLiveAbility,
} from '../../src/domain/rules/live-modifiers';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
  PL_S_PB1_019_LIVE_START_AQOURS_RED_HEART_SUPPRESS_SUCCESS_ABILITY_ID,
  PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID,
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
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
    readonly hearts?: readonly HeartColor[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: (options.hearts ?? [HeartColor.RED]).map((color) => createHeartIcon(color, 1)),
  };
}

function createLive(cardCode: string, score = 3, groupNames: readonly string[] = ['Aqours']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('pl-pb1-001-019-effects', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmActiveEffect(
  session: GameSession,
  selectedOptionId?: string | null
): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effectId,
      undefined,
      undefined,
      undefined,
      selectedOptionId
    )
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function confirmActiveEffectCard(
  session: GameSession,
  selectedCardId: string | null
): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function forceMainPhase(game: GameState, options: { readonly activePlayerIndex?: number } = {}): GameState {
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function setup019(options: {
  readonly redHeartCount: number;
  readonly includeSourceInLiveZone?: boolean;
  readonly opponentEnergyCount?: number;
  readonly secondSource?: boolean;
}): {
  readonly game: GameState;
  readonly source: CardInstance<LiveCardData>;
  readonly secondSource: CardInstance<LiveCardData> | null;
  readonly members: readonly CardInstance<MemberCardData>[];
  readonly opponentEnergy: readonly CardInstance<EnergyCardData>[];
} {
  const source = instance(createLive('PL!S-pb1-019-L', 3), 'genki-live');
  const secondSource = options.secondSource
    ? instance(createLive('PL!S-pb1-019-L', 3), 'genki-live-2')
    : null;
  const memberCount = options.redHeartCount === 0 ? 0 : Math.min(3, options.redHeartCount);
  const members = Array.from({ length: memberCount }, (_, index) => {
    const remaining = options.redHeartCount - index;
    const count = index === memberCount - 1 ? remaining : 1;
    return instance(
      {
        ...createMember(`aqours-${index}`, {
          name: `Aqours ${index}`,
          groupNames: ['Aqours'],
        }),
        hearts: [createHeartIcon(HeartColor.RED, count)],
      },
      `aqours-${index}`
    );
  });
  const opponentEnergy = Array.from({ length: options.opponentEnergyCount ?? 1 }, (_, index) =>
    instance(createEnergy(`energy-${index}`), `energy-${index}`, PLAYER2)
  );

  let game = createGameState('pl-s-pb1-019', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...(secondSource ? [secondSource] : []),
    ...members,
    ...opponentEnergy,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: [source, ...(secondSource ? [secondSource] : [])].reduce(
      (zone, liveCard) =>
        options.includeSourceInLiveZone === false
          ? zone
          : addCardToStatefulZone(zone, liveCard.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
      player.liveZone
    ),
    memberSlots: members.reduce((slots, member, index) => {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index % 3]!;
      return placeCardInSlot(slots, slot, member.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }, player.memberSlots),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    energyDeck: opponentEnergy.reduce(
      (zone, energy) => addCardToZone(zone, energy.instanceId),
      player.energyDeck
    ),
  }));

  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
        liveResults: new Map([
          [source.instanceId, true],
          ...(secondSource ? ([[secondSource.instanceId, true]] as const) : []),
        ]),
        playerScores: new Map([[PLAYER1, source.data.score]]),
      },
    },
    source,
    secondSource,
    members,
    opponentEnergy,
  };
}

function setup001(options: {
  readonly sourceCardCode?: 'PL!-pb1-001-R' | 'PL!-pb1-001-P＋';
  readonly sourceSlot?: SlotPosition;
  readonly sourceOrientation?: OrientationState;
  readonly handCount?: number;
  readonly deckCards?: readonly CardInstance<AnyCardData>[];
  readonly waitingRoomCards?: readonly CardInstance<AnyCardData>[];
  readonly activePlayerIndex?: number;
} = {}): {
  readonly session: GameSession;
  readonly source: CardInstance<MemberCardData>;
  readonly handCards: readonly CardInstance<MemberCardData>[];
  readonly deckCards: readonly CardInstance<AnyCardData>[];
  readonly waitingRoomCards: readonly CardInstance<AnyCardData>[];
} {
  const source = instance(
    createMember(options.sourceCardCode ?? 'PL!-pb1-001-R', {
      name: '高坂穂乃果',
      cost: 13,
    }),
    'honoka-source'
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    instance(createMember(`hand-${index}`, { name: `Hand ${index}` }), `hand-${index}`)
  );
  const deckCards =
    options.deckCards ??
    [
      instance(createMember('low-member', { cost: 2 }), 'low-member'),
      instance(createLive('hit-live', 1, ["μ's"]), 'hit-live'),
    ];
  const waitingRoomCards = options.waitingRoomCards ?? [];

  let game = createGameState('pl-pb1-001', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCards, ...deckCards, ...waitingRoomCards]);
  game = forceMainPhase(game, { activePlayerIndex: options.activePlayerIndex });
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      options.sourceSlot ?? SlotPosition.CENTER,
      source.instanceId,
      {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: deckCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
    waitingRoom: waitingRoomCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));

  return {
    session: sessionWithState(game),
    source,
    handCards,
    deckCards,
    waitingRoomCards,
  };
}

function activate001(session: GameSession, sourceId: string) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      sourceId,
      PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID
    )
  );
}

describe('PL!-pb1-001 and PL!S-pb1-019 workflows', () => {
  it('PL!S-pb1-019 does not suppress LIVE_SUCCESS below six red hearts and places opponent WAITING energy', () => {
    const { game, source, opponentEnergy } = setup019({ redHeartCount: 5 });
    const liveStartQueued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
    const liveStartStarted = resolvePendingCardEffects(liveStartQueued).gameState;
    expect(liveStartStarted.activeEffect?.effectText).toContain('[赤ハート]合计5个');
    const afterLiveStart = confirmActiveEffect(sessionWithState(liveStartStarted));
    expect(
      isLiveAbilitySuppressed(
        afterLiveStart,
        source.instanceId,
        PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID
      )
    ).toBe(false);

    const liveSuccessQueued = enqueueTriggeredCardEffects(afterLiveStart, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    const liveSuccessStarted = resolvePendingCardEffects(liveSuccessQueued).gameState;
    expect(liveSuccessStarted.activeEffect?.abilityId).toBe(
      PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID
    );
    const resolved = confirmActiveEffect(sessionWithState(liveSuccessStarted));
    expect(resolved.players[1].energyDeck.cardIds).toEqual([]);
    expect(resolved.players[1].energyZone.cardIds).toEqual([opponentEnergy[0]!.instanceId]);
    expect(
      resolved.players[1].energyZone.cardStates.get(opponentEnergy[0]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('PL!S-pb1-019 suppresses LIVE_SUCCESS at six red hearts and effective red Heart modifiers count', () => {
    const { game, source, members } = setup019({ redHeartCount: 5 });
    const modifierResult = addHeartLiveModifierForMember(game, {
      playerId: PLAYER1,
      memberCardId: members[0]!.instanceId,
      sourceCardId: members[0]!.instanceId,
      abilityId: 'test:red-heart-modifier',
      hearts: [createHeartIcon(HeartColor.RED, 1)],
    });
    expect(modifierResult).not.toBeNull();

    const liveStartQueued = enqueueTriggeredCardEffects(modifierResult!.gameState, [
      TriggerCondition.ON_LIVE_START,
    ]);
    const liveStartStarted = resolvePendingCardEffects(liveStartQueued).gameState;
    expect(liveStartStarted.activeEffect?.effectText).toContain('[赤ハート]合计6个');
    expect(liveStartStarted.activeEffect?.effectText).toContain('满足条件');
    const afterLiveStart = confirmActiveEffect(sessionWithState(liveStartStarted));
    expect(
      isLiveAbilitySuppressed(
        afterLiveStart,
        source.instanceId,
        PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID
      )
    ).toBe(true);

    const liveSuccessQueued = enqueueTriggeredCardEffects(afterLiveStart, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(
      liveSuccessQueued.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID
      )
    ).toBe(false);
    expect(liveSuccessQueued.activeEffect).toBeNull();
  });

  it('PL!S-pb1-019 suppression only skips the matching LIVE source card', () => {
    const { game, source, secondSource } = setup019({
      redHeartCount: 0,
      secondSource: true,
    });
    expect(secondSource).not.toBeNull();

    const liveSuccessQueued = enqueueTriggeredCardEffects(
      suppressLiveAbility(game, {
        sourceCardId: source.instanceId,
        suppressedAbilityId: PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID,
        abilityId: PL_S_PB1_019_LIVE_START_AQOURS_RED_HEART_SUPPRESS_SUCCESS_ABILITY_ID,
      }),
      [TriggerCondition.ON_LIVE_SUCCESS]
    );

    const matchingPending = liveSuccessQueued.pendingAbilities.filter(
      (ability) =>
        ability.abilityId ===
        PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID
    );
    expect(matchingPending.map((ability) => ability.sourceCardId)).toEqual([
      secondSource!.instanceId,
    ]);
  });

  it('PL!S-pb1-019 LIVE_SUCCESS no-ops safely when opponent energy deck is empty', () => {
    const { game } = setup019({ redHeartCount: 0, opponentEnergyCount: 0 });
    const liveSuccessStarted = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS])
    ).gameState;
    const resolved = confirmActiveEffect(sessionWithState(liveSuccessStarted));
    expect(resolved.players[1].energyDeck.cardIds).toEqual([]);
    expect(resolved.players[1].energyZone.cardIds).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('PL!-pb1-001 R/P+ pays cost, chooses LIVE, and moves hit to hand with prior revealed cards to waiting room', () => {
    const { session, source, handCards, deckCards } = setup001({
      sourceCardCode: 'PL!-pb1-001-P＋',
      handCount: 2,
    });
    const activated = activate001(session, source.instanceId);
    expect(activated.success, activated.error).toBe(true);
    expect(session.state!.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state!.players[0].waitingRoom.cardIds).not.toContain(handCards[0]!.instanceId);
    expect(session.state!.players[0].waitingRoom.cardIds).not.toContain(handCards[1]!.instanceId);
    expect(abilityUseCount(session.state!)).toBe(0);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
      stepText: '请选择1张手牌放置入休息室。之后选择要公开直到命中的卡牌类型。',
      selectableCardIds: handCards.map((card) => card.instanceId),
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
    });

    const afterDiscard = confirmActiveEffectCard(session, handCards[1]!.instanceId);
    expect(afterDiscard.players[0].waitingRoom.cardIds).toContain(handCards[1]!.instanceId);
    expect(afterDiscard.players[0].waitingRoom.cardIds).not.toContain(handCards[0]!.instanceId);
    expect(abilityUseCount(afterDiscard)).toBe(1);
    expect(afterDiscard.activeEffect).toMatchObject({
      abilityId: PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
      stepText: '请选择要公开直到命中的卡牌类型。',
      selectableOptions: [
        { id: 'LIVE_CARD', label: 'LIVE卡' },
        { id: 'HIGH_COST_MEMBER', label: '费用10以上成员卡' },
      ],
    });

    const afterReveal = confirmActiveEffect(session, 'LIVE_CARD');
    expect(afterReveal.activeEffect).toMatchObject({
      abilityId: PL_PB1_001_ACTIVATED_WAIT_SELF_DISCARD_REVEAL_UNTIL_CHOSEN_ABILITY_ID,
      stepText: '已公开2张卡并公开到LIVE卡。确认后将命中的卡加入手牌，其余公开的卡放置入休息室。',
      inspectionCardIds: deckCards.map((card) => card.instanceId),
      revealedCardIds: deckCards.map((card) => card.instanceId),
    });
    expect(afterReveal.inspectionZone.cardIds).toEqual(deckCards.map((card) => card.instanceId));
    expect(afterReveal.inspectionZone.revealedCardIds).toEqual(
      deckCards.map((card) => card.instanceId)
    );
    expect(afterReveal.players[0].hand.cardIds).not.toContain(deckCards[1]!.instanceId);
    expect(afterReveal.players[0].waitingRoom.cardIds).not.toContain(deckCards[0]!.instanceId);

    const resolved = confirmActiveEffect(session);
    expect(resolved.players[0].hand.cardIds).toContain(deckCards[1]!.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(deckCards[0]!.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds.indexOf(deckCards[0]!.instanceId)).toBeGreaterThan(
      resolved.players[0].waitingRoom.cardIds.indexOf(handCards[1]!.instanceId)
    );
    expect(resolved.players[0].mainDeck.cardIds).toEqual([handCards[1]!.instanceId]);
    expect(resolved.inspectionZone.cardIds).toEqual([]);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceIds?.includes(deckCards[0]!.instanceId) === true
      )
    ).toBe(true);
  });

  it('PL!-pb1-001 can choose cost 10+ member and leaves later deck cards untouched', () => {
    const highMember = instance(createMember('high-member', { cost: 10 }), 'high-member');
    const laterLive = instance(createLive('later-live', 1, ["μ's"]), 'later-live');
    const { session, source, handCards, deckCards } = setup001({
      deckCards: [
        instance(createMember('low-member', { cost: 9 }), 'low-member'),
        highMember,
        laterLive,
      ],
    });
    expect(activate001(session, source.instanceId).success).toBe(true);
    confirmActiveEffectCard(session, handCards[0]!.instanceId);
    const afterReveal = confirmActiveEffect(session, 'HIGH_COST_MEMBER');
    expect(afterReveal.activeEffect?.stepText).toBe(
      '已公开2张卡并公开到费用10以上成员卡。确认后将命中的卡加入手牌，其余公开的卡放置入休息室。'
    );
    expect(afterReveal.inspectionZone.cardIds).toEqual([deckCards[0]!.instanceId, highMember.instanceId]);
    expect(afterReveal.players[0].hand.cardIds).not.toContain(highMember.instanceId);

    const resolved = confirmActiveEffect(session);
    expect(resolved.players[0].hand.cardIds).toContain(highMember.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(deckCards[0]!.instanceId);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([laterLive.instanceId]);
  });

  it('PL!-pb1-001 continues reveal-until-hit across refresh without shuffling revealed cards back', () => {
    const waitingHitLive = instance(createLive('waiting-hit-live', 1, ["μ's"]), 'waiting-hit-live');
    const { session, source, handCards, deckCards } = setup001({
      deckCards: [
        instance(createMember('low-a', { cost: 1 }), 'low-a'),
        instance(createMember('low-b', { cost: 9 }), 'low-b'),
      ],
      waitingRoomCards: [waitingHitLive],
    });
    expect(activate001(session, source.instanceId).success).toBe(true);
    confirmActiveEffectCard(session, handCards[0]!.instanceId);

    const afterReveal = confirmActiveEffect(session, 'LIVE_CARD');
    const inspectedCardIds = afterReveal.activeEffect!.inspectionCardIds!;
    expect(inspectedCardIds.slice(0, 2)).toEqual(deckCards.map((card) => card.instanceId));
    expect(inspectedCardIds).toContain(waitingHitLive.instanceId);
    expect(afterReveal.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(afterReveal.inspectionZone.revealedCardIds).toEqual(inspectedCardIds);
    expect(afterReveal.players[0].mainDeck.cardIds).not.toEqual(
      expect.arrayContaining(deckCards.map((card) => card.instanceId))
    );
    expect(
      afterReveal.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 2 &&
          action.payload.mainDeckCountAfter === 2
      )
    ).toBe(true);

    const resolved = confirmActiveEffect(session);
    expect(resolved.players[0].hand.cardIds).toContain(waitingHitLive.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(deckCards.map((card) => card.instanceId))
    );
    expect(resolved.players[0].waitingRoom.cardIds).not.toContain(waitingHitLive.instanceId);
  });

  it('PL!-pb1-001 reveals all cards to waiting room when no selected type is found', () => {
    const { session, source, handCards, deckCards } = setup001({
      deckCards: [
        instance(createMember('low-a', { cost: 1 }), 'low-a'),
        instance(createMember('low-b', { cost: 9 }), 'low-b'),
      ],
    });
    expect(activate001(session, source.instanceId).success).toBe(true);
    confirmActiveEffectCard(session, handCards[0]!.instanceId);
    const afterReveal = confirmActiveEffect(session, 'LIVE_CARD');
    expect(afterReveal.activeEffect?.stepText).toBe(
      '已公开3张卡，未公开到LIVE卡。确认后将公开的卡全部放置入休息室。'
    );
    expect(afterReveal.inspectionZone.cardIds).toEqual([
      ...deckCards.map((card) => card.instanceId),
      handCards[0]!.instanceId,
    ]);
    expect(afterReveal.players[0].waitingRoom.cardIds).not.toEqual(
      expect.arrayContaining(deckCards.map((card) => card.instanceId))
    );

    const resolved = confirmActiveEffect(session);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([]);
    expect(resolved.players[0].hand.cardIds).not.toContain(deckCards[0]!.instanceId);
    expect(resolved.players[0].hand.cardIds).not.toContain(deckCards[1]!.instanceId);
    expect(resolved.players[0].hand.cardIds).not.toContain(handCards[0]!.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([
        ...deckCards.map((card) => card.instanceId),
        handCards[0]!.instanceId,
      ])
    );
  });

  it('PL!-pb1-001 does not activate in illegal timing, non-center, no-hand, or already WAITING states', () => {
    const notOwnTurn = setup001({ activePlayerIndex: 1 });
    activate001(notOwnTurn.session, notOwnTurn.source.instanceId);
    expect(abilityUseCount(notOwnTurn.session.state!)).toBe(0);
    expect(notOwnTurn.session.state!.activeEffect).toBeNull();

    const nonCenter = setup001({ sourceSlot: SlotPosition.LEFT });
    activate001(nonCenter.session, nonCenter.source.instanceId);
    expect(abilityUseCount(nonCenter.session.state!)).toBe(0);
    expect(nonCenter.session.state!.activeEffect).toBeNull();

    const noHand = setup001({ handCount: 0 });
    activate001(noHand.session, noHand.source.instanceId);
    expect(abilityUseCount(noHand.session.state!)).toBe(0);
    expect(noHand.session.state!.activeEffect).toBeNull();

    const alreadyWaiting = setup001({ sourceOrientation: OrientationState.WAITING });
    activate001(alreadyWaiting.session, alreadyWaiting.source.instanceId);
    expect(abilityUseCount(alreadyWaiting.session.state!)).toBe(0);
    expect(alreadyWaiting.session.state!.activeEffect).toBeNull();
  });
});
