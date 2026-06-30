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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createCheerEvent,
  createEnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createConfirmEffectStepCommand,
  createConfirmPerformanceOutcomeCommand,
  createConfirmStepCommand,
  createSubmitScoreCommand,
  createMovePublicCardToWaitingRoomCommand,
  createSelectSuccessLiveCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createConfirmScoreAction } from '../../src/application/actions';
import { createGameSession } from '../../src/application/game-session';
import {
  S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID,
  S_BP6_002_LIVE_START_AQOURS_LIVE_ZONE_REQUIREMENT_GAIN_ALL_HEART_ABILITY_ID,
  S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  GameMode,
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
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
    readonly bladeHearts?: MemberCardData['bladeHearts'];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    bladeHearts: options.bladeHearts ?? [],
  };
}

function createLiveCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly requirements?: LiveCardData['requirements'];
    readonly bladeHearts?: LiveCardData['bladeHearts'];
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: options.requirements ?? createHeartRequirement({ [HeartColor.RED]: 1 }),
    bladeHearts: options.bladeHearts ?? [],
  };
}

function createSessionFromGame(
  game: GameState,
  gameId = 's-future-water-final',
  options: Parameters<typeof createGameSession>[0] = undefined
) {
  const session = createGameSession(options);
  session.createGame(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function placeCenterMember(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function placeLiveZone(game: GameState, liveCardIds: readonly string[]): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [...liveCardIds],
      cardStates: new Map(
        liveCardIds.map((cardId) => [
          cardId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
        ])
      ),
    },
  }));
}

function setRevealedCheerCards(game: GameState, cardIds: readonly string[]): GameState {
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: [...cardIds],
    },
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: [...cardIds],
      revealedCardIds: [...cardIds],
    },
  };
}

function createLiveStartPendingAbility(
  abilityId: string,
  sourceCardId: string
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`${abilityId}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function openMiraiTicketCheerSelection(cost: number, deckCount: number): {
  readonly session: ReturnType<typeof createSessionFromGame>;
  readonly targetId: string;
  readonly additionalDeckIds: readonly string[];
} {
  const sourceLive = createCardInstance(
    createLiveCard('PL!S-bp6-021-L', { name: 'MIRAI TICKET' }),
    PLAYER1,
    `mirai-ticket-${cost}`
  );
  const target = createCardInstance(
    createMemberCard(`PL!S-cost-${cost}`, { cost }),
    PLAYER1,
    `aqours-cost-${cost}`
  );
  const additionalDeckCards = Array.from({ length: deckCount }, (_, index) =>
    createCardInstance(createMemberCard(`PL!S-additional-${cost}-${index}`), PLAYER1, `additional-${cost}-${index}`)
  );
  let game = registerCards(createGameState(`mirai-ticket-${cost}`, PLAYER1, 'P1', PLAYER2, 'P2'), [
    sourceLive,
    target,
    ...additionalDeckCards,
  ]);
  game = placeLiveZone(game, [sourceLive.instanceId]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: additionalDeckCards.map((card) => card.instanceId) },
  }));
  game = setRevealedCheerCards(game, [target.instanceId]);
  const cheerEvent = createCheerEvent(PLAYER1, [target.instanceId], 1, { automated: true });
  game = emitGameEvent(game, cheerEvent);
  game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
    cheerEvents: [cheerEvent],
  });
  const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, `mirai-${cost}`);
  return {
    session,
    targetId: target.instanceId,
    additionalDeckIds: additionalDeckCards.map((card) => card.instanceId),
  };
}

describe('未来水卡组 执行最终批次 focused workflows', () => {
  it.each([
    { cost: 4, deckCount: 1, expectedAdditional: 0 },
    { cost: 17, deckCount: 4, expectedAdditional: 3 },
    { cost: 22, deckCount: 5, expectedAdditional: 4 },
  ])(
    'PL!S-bp6-021 sends a cost $cost no-BLADE HEART Aqours member and performs capped additional cheer',
    ({ cost, deckCount, expectedAdditional }) => {
      const { session, targetId, additionalDeckIds } = openMiraiTicketCheerSelection(cost, deckCount);

      expect(session.state?.activeEffect?.abilityId).toBe(
        S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID
      );
      expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetId]);

      const finish = session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [targetId]
        )
      );

      expect(finish.success, finish.error).toBe(true);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([targetId]);
      expect(session.state?.resolutionZone.cardIds).toEqual(
        additionalDeckIds.slice(0, expectedAdditional)
      );
      expect(session.state?.players[0].mainDeck.cardIds).toEqual(
        additionalDeckIds.slice(expectedAdditional)
      );
      const cheerEvents = session
        .state!.eventLog.map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_CHEER);
      if (expectedAdditional > 0) {
        expect(cheerEvents.at(-1)).toMatchObject({
          playerId: PLAYER1,
          revealedCardIds: additionalDeckIds.slice(0, expectedAdditional),
          additional: true,
        });
      } else {
        expect(cheerEvents).toHaveLength(1);
      }
    }
  );

  it('PL!S-bp6-021 treats LL-bp2-001 mixed-series member as an Aqours cheer candidate', () => {
    const sourceLive = createCardInstance(
      createLiveCard('PL!S-bp6-021-L', { name: 'MIRAI TICKET' }),
      PLAYER1,
      'mirai-ll-source'
    );
    const mixedSeriesMember = createCardInstance(
      createMemberCard('LL-bp2-001-R+', {
        name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃',
        cost: 20,
        groupNames:
          ['ラブライブ！サンシャイン!!\nラブライブ！スーパースター!!\n蓮ノ空女学院スクールアイドルクラブ'],
      }),
      PLAYER1,
      'll-bp2-001'
    );
    const additionalDeckCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(createMemberCard(`PL!S-ll-additional-${index}`), PLAYER1, `ll-additional-${index}`)
    );
    let game = registerCards(createGameState('mirai-ll-bp2-001', PLAYER1, 'P1', PLAYER2, 'P2'), [
      sourceLive,
      mixedSeriesMember,
      ...additionalDeckCards,
    ]);
    game = placeLiveZone(game, [sourceLive.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: additionalDeckCards.map((card) => card.instanceId) },
    }));
    game = setRevealedCheerCards(game, [mixedSeriesMember.instanceId]);
    const cheerEvent = createCheerEvent(PLAYER1, [mixedSeriesMember.instanceId], 1, {
      automated: true,
    });
    game = emitGameEvent(game, cheerEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [cheerEvent],
    });
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'mirai-ll');

    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_021_ON_CHEER_SEND_NO_BLADE_AQOURS_MEMBER_ADDITIONAL_CHEER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([mixedSeriesMember.instanceId]);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [mixedSeriesMember.instanceId]
      )
    );

    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([mixedSeriesMember.instanceId]);
    expect(session.state?.resolutionZone.cardIds).toEqual(
      additionalDeckCards.slice(0, 4).map((card) => card.instanceId)
    );
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([additionalDeckCards[4].instanceId]);
    expect(
      session
        .state!.eventLog.map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_CHEER)
        .at(-1)
    ).toMatchObject({
      playerId: PLAYER1,
      revealedCardIds: additionalDeckCards.slice(0, 4).map((card) => card.instanceId),
      additional: true,
    });
  });

  it('PL!S-bp6-021 filters non-Aqours, non-member, and BLADE HEART cheer cards, and skip does not move or cheer', () => {
    const sourceLive = createCardInstance(createLiveCard('PL!S-bp6-021-L'), PLAYER1, 'mirai-filter');
    const valid = createCardInstance(createMemberCard('PL!S-valid', { cost: 10 }), PLAYER1, 'valid');
    const nonAqours = createCardInstance(
      createMemberCard('PL!SP-liella-member', { groupNames: ['Liella!'], cost: 10 }),
      PLAYER1,
      'non-aqours'
    );
    const liveCard = createCardInstance(createLiveCard('PL!S-live-cheer'), PLAYER1, 'live-cheer');
    const bladeHeart = createCardInstance(
      createMemberCard('PL!S-blade-heart', {
        cost: 10,
        bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
      }),
      PLAYER1,
      'blade-heart'
    );
    let game = registerCards(createGameState('mirai-filter', PLAYER1, 'P1', PLAYER2, 'P2'), [
      sourceLive,
      valid,
      nonAqours,
      liveCard,
      bladeHeart,
    ]);
    game = placeLiveZone(game, [sourceLive.instanceId]);
    const revealedIds = [valid.instanceId, nonAqours.instanceId, liveCard.instanceId, bladeHeart.instanceId];
    game = setRevealedCheerCards(game, revealedIds);
    const cheerEvent = createCheerEvent(PLAYER1, revealedIds, revealedIds.length, {
      automated: true,
    });
    game = emitGameEvent(game, cheerEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [cheerEvent],
    });
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'mirai-filter');

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([valid.instanceId]);

    const skip = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        []
      )
    );

    expect(skip.success, skip.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.resolutionZone.cardIds).toEqual(revealedIds);
    expect(
      session
        .state!.eventLog.map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_CHEER)
    ).toHaveLength(1);
  });

  it('PL!S-bp6-021 additional cheer does not recurse and turn once blocks later normal cheer after use', () => {
    const { session, targetId, additionalDeckIds } = openMiraiTicketCheerSelection(17, 4);
    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [targetId]
      )
    );
    expect(finish.success, finish.error).toBe(true);

    const afterAdditionalCheck = enqueueTriggeredCardEffects(session.state!, [TriggerCondition.ON_CHEER]);
    expect(afterAdditionalCheck.pendingAbilities).toEqual([]);

    const nextCheerEvent = createCheerEvent(PLAYER1, [additionalDeckIds[3]!], 1, {
      automated: true,
    });
    const afterNormalCheer = enqueueTriggeredCardEffects(
      emitGameEvent(session.state!, nextCheerEvent),
      [TriggerCondition.ON_CHEER],
      { cheerEvents: [nextCheerEvent] }
    );
    expect(afterNormalCheer.pendingAbilities).toEqual([]);
  });

  it('PL!S-bp6-002 AUTO ignores unrelated waiting-room events, then returns an Aqours LIVE from waiting room to deck top', () => {
    const source = createCardInstance(createMemberCard('PL!S-bp6-002-P', { cost: 17 }), PLAYER1, 'riko');
    const handCard = createCardInstance(createMemberCard('PL!S-hand'), PLAYER1, 'hand-card');
    const live = createCardInstance(createLiveCard('PL!S-aqours-live'), PLAYER1, 'aqours-live');
    const deckCard = createCardInstance(createMemberCard('PL!S-deck'), PLAYER1, 'deck-card');
    let game = registerCards(createGameState('bp6-002-auto', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      handCard,
      live,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [handCard.instanceId, live.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));

    const handEvent = createEnterWaitingRoomEvent([handCard.instanceId], ZoneType.HAND, PLAYER1, PLAYER1);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents: [handEvent],
    });
    expect(game.pendingAbilities).toEqual([]);

    const liveEvent = createEnterWaitingRoomEvent([live.instanceId], ZoneType.LIVE_ZONE, PLAYER1, PLAYER1);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents: [liveEvent],
    });
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-002-auto');

    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'top',
      'bottom',
    ]);

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'top'
      )
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([handCard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      live.instanceId,
      deckCard.instanceId,
    ]);
  });

  it('PL!S-bp6-002 AUTO opens from the real failed LIVE confirmation path', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-failed-live'
    );
    const live = createCardInstance(createLiveCard('PL!S-failed-live'), PLAYER1, 'failed-live');
    const deckCard = createCardInstance(createMemberCard('PL!S-failed-deck'), PLAYER1, 'failed-deck');
    let game = registerCards(createGameState('bp6-002-failed-live', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [live.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
      },
    };
    const session = createSessionFromGame(game, 'bp6-002-failed-live');

    const fail = session.executeCommand(createConfirmPerformanceOutcomeCommand(PLAYER1, false));

    expect(fail.success, fail.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(live.instanceId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'top',
      'bottom',
    ]);
  });

  it('PL!S-bp6-002 AUTO blocks score confirmation until the effect is resolved', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-score-lock'
    );
    const live = createCardInstance(createLiveCard('PL!S-score-lock-live'), PLAYER1, 'score-lock-live');
    const deckCard = createCardInstance(createMemberCard('PL!S-score-lock-deck'), PLAYER1, 'score-lock-deck');
    let game = registerCards(createGameState('bp6-002-score-lock', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [live.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
      },
    };
    const session = createSessionFromGame(game, 'bp6-002-score-lock');

    const fail = session.executeCommand(createConfirmPerformanceOutcomeCommand(PLAYER1, false));
    expect(fail.success, fail.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID
    );

    const earlyScore = session.executeCommand(createSubmitScoreCommand(PLAYER1, 0));
    expect(earlyScore.success).toBe(false);
    expect(session.state?.liveResolution.scoreConfirmedBy).toEqual([]);

    const p1Commands = session.getPlayerViewState(PLAYER1)?.permissions.availableCommands ?? [];
    const p2Commands = session.getPlayerViewState(PLAYER2)?.permissions.availableCommands ?? [];
    expect(p1Commands.some((hint) => hint.command === GameCommandType.SUBMIT_SCORE)).toBe(false);
    expect(p2Commands.some((hint) => hint.command === GameCommandType.SUBMIT_SCORE)).toBe(false);
    expect(p1Commands.some((hint) => hint.command === GameCommandType.CONFIRM_EFFECT_STEP)).toBe(true);

    const finishEffect = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'top'
      )
    );
    expect(finishEffect.success, finishEffect.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);

    const p1Score = session.executeCommand(createSubmitScoreCommand(PLAYER1, 0));
    expect(p1Score.success, p1Score.error).toBe(true);
    const p2Score = session.executeCommand(createSubmitScoreCommand(PLAYER2, 0));
    expect(p2Score.success, p2Score.error).toBe(true);
    expect(session.state?.currentSubPhase).not.toBe(SubPhase.RESULT_SCORE_CONFIRM);
  });

  it('PL!S-bp6-002 AUTO blocks solitaire score automation and direct score actions while active', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-solitaire-lock'
    );
    const live = createCardInstance(createLiveCard('PL!S-solitaire-live'), PLAYER1, 'solitaire-live');
    const deckCard = createCardInstance(createMemberCard('PL!S-solitaire-deck'), PLAYER1, 'solitaire-deck');
    let game = registerCards(createGameState('bp6-002-solitaire-lock', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [live.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
      },
    };
    const session = createSessionFromGame(game, 'bp6-002-solitaire-lock', {
      gameMode: GameMode.SOLITAIRE,
    });

    const fail = session.executeCommand(createConfirmPerformanceOutcomeCommand(PLAYER1, false));
    expect(fail.success, fail.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID
    );
    expect(session.state?.liveResolution.scoreConfirmedBy).not.toContain(PLAYER2);

    const directScore = session.dispatch(createConfirmScoreAction(PLAYER2, 0));
    expect(directScore.success).toBe(false);
    expect(session.state?.liveResolution.scoreConfirmedBy).toEqual([]);

    const finishEffect = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'bottom'
      )
    );
    expect(finishEffect.success, finishEffect.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);
    expect(session.state?.liveResolution.scoreConfirmedBy).toEqual([PLAYER2]);

    const p1Score = session.executeCommand(createSubmitScoreCommand(PLAYER1, 0));
    expect(p1Score.success, p1Score.error).toBe(true);
    expect(session.state?.currentSubPhase).not.toBe(SubPhase.RESULT_SCORE_CONFIRM);
  });

  it('PL!S-bp6-002 AUTO resumes winner resolution after an old score-confirm race is cleared', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-race-recovery'
    );
    const live = createCardInstance(createLiveCard('PL!S-race-live'), PLAYER1, 'race-live');
    const deckCard = createCardInstance(createMemberCard('PL!S-race-deck'), PLAYER1, 'race-deck');
    let game = registerCards(createGameState('bp6-002-race-recovery', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [live.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
      },
    };
    const session = createSessionFromGame(game, 'bp6-002-race-recovery');

    const fail = session.executeCommand(createConfirmPerformanceOutcomeCommand(PLAYER1, false));
    expect(fail.success, fail.error).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      liveResolution: {
        ...session.state!.liveResolution,
        playerScores: new Map([
          [PLAYER1, 0],
          [PLAYER2, 0],
        ]),
        scoreConfirmedBy: [PLAYER1, PLAYER2],
        liveWinnerIds: [],
      },
    };

    const finishEffect = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'top'
      )
    );

    expect(finishEffect.success, finishEffect.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.currentSubPhase).not.toBe(SubPhase.RESULT_SCORE_CONFIRM);
    expect(session.state?.liveResolution.scoreConfirmedBy).toEqual([]);
  });

  it('PL!S-bp6-002 AUTO opens once for multiple remaining LIVE cards during settlement cleanup', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-settlement'
    );
    const successLive = createCardInstance(createLiveCard('PL!S-success-live'), PLAYER1, 'success-live');
    const remainingLiveA = createCardInstance(createLiveCard('PL!S-remaining-live-a'), PLAYER1, 'remaining-live-a');
    const remainingLiveB = createCardInstance(createLiveCard('PL!S-remaining-live-b'), PLAYER1, 'remaining-live-b');
    const deckCard = createCardInstance(createMemberCard('PL!S-settlement-deck'), PLAYER1, 'settlement-deck');
    let game = registerCards(createGameState('bp6-002-settlement', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      successLive,
      remainingLiveA,
      remainingLiveB,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [
      successLive.instanceId,
      remainingLiveA.instanceId,
      remainingLiveB.instanceId,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      liveResolution: {
        ...game.liveResolution,
        liveWinnerIds: [PLAYER1],
        liveResults: new Map([
          [successLive.instanceId, true],
          [remainingLiveA.instanceId, true],
          [remainingLiveB.instanceId, true],
        ]),
      },
    };
    const session = createSessionFromGame(game, 'bp6-002-settlement');

    const selectSuccess = session.executeCommand(
      createSelectSuccessLiveCommand(PLAYER1, successLive.instanceId)
    );
    expect(selectSuccess.success, selectSuccess.error).toBe(true);
    const confirmSettlement = session.executeCommand(
      createConfirmStepCommand(PLAYER1, SubPhase.RESULT_SETTLEMENT)
    );

    expect(confirmSettlement.success, confirmSettlement.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SETTLEMENT);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      remainingLiveA.instanceId,
      remainingLiveB.instanceId,
    ]);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      remainingLiveA.instanceId,
      remainingLiveB.instanceId,
    ]);
    expect(session.state?.players[0].successZone.cardIds).toEqual([successLive.instanceId]);
  });

  it('PL!S-bp6-002 AUTO resumes settlement cleanup after resolving the cleanup trigger', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-settlement-resume'
    );
    const successLive = createCardInstance(
      createLiveCard('PL!S-settlement-resume-success'),
      PLAYER1,
      'settlement-resume-success'
    );
    const remainingLive = createCardInstance(
      createLiveCard('PL!S-settlement-resume-remaining'),
      PLAYER1,
      'settlement-resume-remaining'
    );
    const deckCard = createCardInstance(
      createMemberCard('PL!S-settlement-resume-deck'),
      PLAYER1,
      'settlement-resume-deck'
    );
    let game = registerCards(createGameState('bp6-002-settlement-resume', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      successLive,
      remainingLive,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [successLive.instanceId, remainingLive.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      liveResolution: {
        ...game.liveResolution,
        liveWinnerIds: [PLAYER1],
        liveResults: new Map([
          [successLive.instanceId, true],
          [remainingLive.instanceId, true],
        ]),
        scoreConfirmedBy: [PLAYER1, PLAYER2],
      },
    };
    const session = createSessionFromGame(game, 'bp6-002-settlement-resume');

    const selectSuccess = session.executeCommand(
      createSelectSuccessLiveCommand(PLAYER1, successLive.instanceId)
    );
    expect(selectSuccess.success, selectSuccess.error).toBe(true);
    const confirmSettlement = session.executeCommand(
      createConfirmStepCommand(PLAYER1, SubPhase.RESULT_SETTLEMENT)
    );
    expect(confirmSettlement.success, confirmSettlement.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SETTLEMENT);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID
    );

    const finishEffect = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'top'
      )
    );
    expect(finishEffect.success, finishEffect.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SETTLEMENT);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(remainingLive.instanceId);

    const confirmAfterEffect = session.executeCommand(
      createConfirmStepCommand(PLAYER1, SubPhase.RESULT_SETTLEMENT)
    );
    expect(confirmAfterEffect.success, confirmAfterEffect.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].liveZone.cardIds).toEqual([]);
    expect(session.state?.players[0].successZone.cardIds).toEqual([successLive.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(remainingLive.instanceId);
  });

  it('PL!S-bp6-002 AUTO opens from the manual LIVE_ZONE to waiting room path', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-manual'
    );
    const live = createCardInstance(createLiveCard('PL!S-manual-live'), PLAYER1, 'manual-live');
    const deckCard = createCardInstance(createMemberCard('PL!S-manual-deck'), PLAYER1, 'manual-deck');
    let game = registerCards(createGameState('bp6-002-manual', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [live.instanceId]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      liveResolution: {
        ...game.liveResolution,
        liveWinnerIds: [PLAYER1],
      },
    };
    const session = createSessionFromGame(game, 'bp6-002-manual');

    const move = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(PLAYER1, live.instanceId, ZoneType.LIVE_ZONE)
    );

    expect(move.success, move.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([live.instanceId]);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID
    );
  });

  it('PL!S-bp6-002 AUTO can place the moved Aqours LIVE on deck bottom', () => {
    const source = createCardInstance(
      createMemberCard('PL!S-bp6-002-P', { cost: 17 }),
      PLAYER1,
      'riko-bottom'
    );
    const live = createCardInstance(createLiveCard('PL!S-bottom-aqours-live'), PLAYER1, 'bottom-live');
    const deckCard = createCardInstance(createMemberCard('PL!S-bottom-deck'), PLAYER1, 'bottom-deck');
    let game = registerCards(createGameState('bp6-002-bottom', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      live,
      deckCard,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [live.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
    }));

    const liveEvent = createEnterWaitingRoomEvent([live.instanceId], ZoneType.LIVE_ZONE, PLAYER1, PLAYER1);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents: [liveEvent],
    });
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-002-bottom');

    const finish = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'bottom'
      )
    );
    expect(finish.success, finish.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      deckCard.instanceId,
      live.instanceId,
    ]);
  });

  it('PL!S-bp6-002 AUTO decline consumes the true trigger for the turn, while stale moved cards no-op without use', () => {
    const source = createCardInstance(createMemberCard('PL!S-bp6-002-P', { cost: 17 }), PLAYER1, 'riko-decline');
    const staleLive = createCardInstance(createLiveCard('PL!S-stale-live'), PLAYER1, 'stale-live');
    const firstLive = createCardInstance(createLiveCard('PL!S-first-live'), PLAYER1, 'first-live');
    const secondLive = createCardInstance(createLiveCard('PL!S-second-live'), PLAYER1, 'second-live');
    let game = registerCards(createGameState('bp6-002-decline', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      staleLive,
      firstLive,
      secondLive,
    ]);
    game = placeCenterMember(game, source.instanceId);

    const staleEvent = createEnterWaitingRoomEvent([staleLive.instanceId], ZoneType.LIVE_ZONE, PLAYER1, PLAYER1);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents: [staleEvent],
    });
    game = resolvePendingCardEffects(game).gameState;
    expect(game.activeEffect).toBeNull();

    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [firstLive.instanceId, secondLive.instanceId] },
    }));
    const firstEvent = createEnterWaitingRoomEvent([firstLive.instanceId], ZoneType.LIVE_ZONE, PLAYER1, PLAYER1);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents: [firstEvent],
    });
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp6-002-decline');
    const decline = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );
    expect(decline.success, decline.error).toBe(true);

    const secondEvent = createEnterWaitingRoomEvent([secondLive.instanceId], ZoneType.LIVE_ZONE, PLAYER1, PLAYER1);
    const afterSecond = enqueueTriggeredCardEffects(session.state!, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
      enterWaitingRoomEvents: [secondEvent],
    });
    expect(afterSecond.pendingAbilities).toEqual([]);
    expect(afterSecond.players[0].waitingRoom.cardIds).toEqual([
      firstLive.instanceId,
      secondLive.instanceId,
    ]);
  });

  it('PL!S-bp6-002 LIVE_START gives source member ALL Heart x2 only for all-Aqours red/green/blue requirement total >= 12', () => {
    const source = createCardInstance(createMemberCard('PL!S-bp6-002-P', { cost: 17 }), PLAYER1, 'riko-live-start');
    const liveA = createCardInstance(
      createLiveCard('PL!S-red-green-live', {
        requirements: createHeartRequirement({ [HeartColor.RED]: 4, [HeartColor.GREEN]: 4 }),
      }),
      PLAYER1,
      'red-green-live'
    );
    const liveB = createCardInstance(
      createLiveCard('PL!S-blue-live', {
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 4, [HeartColor.RAINBOW]: 99 }),
      }),
      PLAYER1,
      'blue-live'
    );
    let game = registerCards(createGameState('bp6-002-live-start', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      liveA,
      liveB,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, [liveA.instanceId, liveB.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createLiveStartPendingAbility(
          S_BP6_002_LIVE_START_AQOURS_LIVE_ZONE_REQUIREMENT_GAIN_ALL_HEART_ABILITY_ID,
          source.instanceId
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.RAINBOW, 2)],
      sourceCardId: source.instanceId,
      abilityId: S_BP6_002_LIVE_START_AQOURS_LIVE_ZONE_REQUIREMENT_GAIN_ALL_HEART_ABILITY_ID,
    });
  });

  it.each([
    {
      name: 'non-Aqours LIVE mixed in',
      liveCards: [
        createCardInstance(createLiveCard('PL!S-aqours-live-a'), PLAYER1, 'miss-aqours-live'),
        createCardInstance(
          createLiveCard('PL!SP-liella-live', { groupNames: ['Liella!'] }),
          PLAYER1,
          'miss-liella-live'
        ),
      ],
    },
    {
      name: 'red green blue total below 12',
      liveCards: [
        createCardInstance(
          createLiveCard('PL!S-low-requirement', {
            requirements: createHeartRequirement({ [HeartColor.RED]: 4, [HeartColor.GREEN]: 4 }),
          }),
          PLAYER1,
          'miss-low-requirement'
        ),
      ],
    },
    {
      name: 'only rainbow requirement',
      liveCards: [
        createCardInstance(
          createLiveCard('PL!S-rainbow-only', {
            requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 12 }),
          }),
          PLAYER1,
          'miss-rainbow-only'
        ),
      ],
    },
  ])('PL!S-bp6-002 LIVE_START does nothing when $name', ({ liveCards }) => {
    const source = createCardInstance(createMemberCard('PL!S-bp6-002-P', { cost: 17 }), PLAYER1, 'riko-miss');
    let game = registerCards(createGameState('bp6-002-live-start-miss', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      ...liveCards,
    ]);
    game = placeCenterMember(game, source.instanceId);
    game = placeLiveZone(game, liveCards.map((card) => card.instanceId));
    game = {
      ...game,
      pendingAbilities: [
        createLiveStartPendingAbility(
          S_BP6_002_LIVE_START_AQOURS_LIVE_ZONE_REQUIREMENT_GAIN_ALL_HEART_ABILITY_ID,
          source.instanceId
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });
});
