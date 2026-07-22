import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createMovePublicCardToWaitingRoomCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID,
  PL_N_PB1_016_ON_ENTER_LOOK_TOP_TWO_KARIN_MEMBER_ABILITY_ID,
  PL_N_PB1_018_ON_ENTER_LOOK_TOP_TWO_KANATA_MEMBER_ABILITY_ID,
  PL_N_PB1_021_ON_ENTER_LOOK_TOP_TWO_RINA_MEMBER_ABILITY_ID,
  PL_N_PB1_024_ON_ENTER_LOOK_TOP_TWO_LANZHU_MEMBER_ABILITY_ID,
  N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID,
  PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID,
  S_SD1_003_ON_ENTER_LOOK_TOP_AQOURS_LIVE_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name = cardCode,
  cost = 1,
  groupName = '莲之空女学院学园偶像俱乐部'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  name = cardCode,
  groupName = '莲之空女学院学园偶像俱乐部'
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 61 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

describe('look top select to hand shared workflow', () => {
  it('executes PL!S-sd1-003-SD on-enter to reveal one Aqours LIVE and move the rest to waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('s-sd1-003-kanaan-look-top', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-sd1-003-SD', '松浦果南', 11, 'Aqours'),
      PLAYER1,
      'p1-s-sd1-003-source'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-test-member-0', 'Member 0', 1, 'Aqours'),
        PLAYER1,
        's-sd1-003-top-0'
      ),
      createCardInstance(
        createLiveCard('PL!S-test-live-aqours', 'Aqours Live', 'Aqours'),
        PLAYER1,
        's-sd1-003-live-aqours'
      ),
      createCardInstance(
        createLiveCard('PL!S-test-live-other', 'Other Live', 'Other'),
        PLAYER1,
        's-sd1-003-live-other'
      ),
      createCardInstance(
        createMemberCard('PL!S-test-member-3', 'Member 3', 1, 'Aqours'),
        PLAYER1,
        's-sd1-003-top-3'
      ),
      createCardInstance(
        createLiveCard('PL!S-test-live-aqours-2', 'Aqours Live 2', 'Aqours'),
        PLAYER1,
        's-sd1-003-live-aqours-2'
      ),
    ];
    const state = registerCards(session.state!, [source, ...topCards]);
    const inspectedCardIds = topCards.map((card) => card.instanceId);
    const selectedLiveCardId = topCards[1]!.instanceId;
    const otherAqoursLiveCardId = topCards[4]!.instanceId;

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [source.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: inspectedCardIds },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_SD1_003_ON_ENTER_LOOK_TOP_AQOURS_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(inspectedCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      selectedLiveCardId,
      otherAqoursLiveCardId,
    ]);

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedLiveCardId)
    );
    expect(revealResult.success, revealResult.error).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([selectedLiveCardId]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(finishResult.success, finishResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedLiveCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      expect.arrayContaining(inspectedCardIds.filter((cardId) => cardId !== selectedLiveCardId))
    );
    expect(
      session.state?.eventLog.some((entry) => {
        const event = entry.event;
        return (
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK &&
          event.toZone === ZoneType.WAITING_ROOM &&
          event.cardInstanceIds?.join(',') ===
            inspectedCardIds.filter((cardId) => cardId !== selectedLiveCardId).join(',')
        );
      })
    ).toBe(true);
  });

  it('executes PL!HS-bp2-013-N leave-stage AUTO to reveal one top-five LIVE card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('look-top-select-to-hand-tsuzuri', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp2-013-N', '夕霧綴理', 5),
      PLAYER1,
      'p1-hs-bp2-013-source'
    );
    const topCards = [
      createCardInstance(createMemberCard('PL!HS-test-member-0', 'Member 0'), PLAYER1, 'top-0'),
      createCardInstance(createLiveCard('PL!HS-test-live-1', 'Live 1'), PLAYER1, 'top-1-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-2', 'Member 2'), PLAYER1, 'top-2'),
      createCardInstance(createLiveCard('PL!HS-test-live-3', 'Live 3'), PLAYER1, 'top-3-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-4', 'Member 4'), PLAYER1, 'top-4'),
    ];

    const state = registerCards(session.state!, [source, ...topCards]);
    const topFiveCardIds = topCards.map((card) => card.instanceId);
    const selectableLiveCardIds = [topCards[1]!.instanceId, topCards[3]!.instanceId];
    const selectedLiveCardId = topCards[3]!.instanceId;

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: topFiveCardIds },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: source.instanceId,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const beforeSeq = session.getCurrentPublicEventSeq();
    session.setManualOperationMode('FREE');
    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        source.instanceId,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(
      session.state?.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
            event.cardInstanceId === source.instanceId
        )
    ).toMatchObject({
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      cardInstanceId: source.instanceId,
      fromZone: ZoneType.MEMBER_SLOT,
      fromSlot: SlotPosition.CENTER,
      toZone: ZoneType.WAITING_ROOM,
      controllerId: PLAYER1,
    });
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topFiveCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(selectableLiveCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([source.instanceId]);
    const startedSummary = session
      .getPublicEventsSince(beforeSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'STARTED');
    expect(startedSummary?.type).toBe('CardEffectSummary');
    if (startedSummary?.type === 'CardEffectSummary') {
      expect(startedSummary.abilityId).toBe(HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID);
      expect(startedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(startedSummary.sourceActionLabel).toBe('离场');
      expect(startedSummary.sourceOrientationCost).toBeUndefined();
      expect(startedSummary.sourceCard?.publicObjectId).toBe(`obj_${source.instanceId}`);
      expect(startedSummary.discardedCostCards).toEqual([]);
      expect(startedSummary.hiddenDiscardedCostCardCount).toBe(0);
      expect(startedSummary.requestedInspectCount).toBe(5);
      expect(startedSummary.actualInspectedCount).toBe(5);
    }

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedLiveCardId)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID
    );
    expect(session.state?.inspectionZone.revealedCardIds).toContain(selectedLiveCardId);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([source.instanceId]);
    const completedSummary = session
      .getPublicEventsSince(beforeSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'COMPLETED');
    expect(completedSummary?.type).toBe('CardEffectSummary');
    if (completedSummary?.type === 'CardEffectSummary') {
      expect(completedSummary.abilityId).toBe(HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID);
      expect(completedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(completedSummary.sourceActionLabel).toBe('离场');
      expect(completedSummary.sourceOrientationCost).toBeUndefined();
      expect(completedSummary.discardedCostCards).toEqual([]);
      expect(completedSummary.hiddenDiscardedCostCardCount).toBe(0);
      expect(completedSummary.selectedCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${selectedLiveCardId}`,
      ]);
      expect(completedSummary.noSelectedCards).toBe(false);
      expect(completedSummary.waitingRoomCardCount).toBe(4);
    }
  });
});

interface Bp4006Scenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly source: ReturnType<typeof createCardInstance<MemberCardData>>;
  readonly topCards: readonly ReturnType<typeof createCardInstance>[];
}

function createBp4006TopCards(): readonly ReturnType<typeof createCardInstance>[] {
  return [
    createCardInstance(
      createMemberCard('PL!-test-muse-member-curly', '高坂穂乃果', 4, 'μ’s'),
      PLAYER1,
      'bp4-006-muse-member-curly'
    ),
    createCardInstance(
      createLiveCard('PL!-test-muse-live', 'μ’s LIVE', "μ's"),
      PLAYER1,
      'bp4-006-muse-live'
    ),
    createCardInstance(
      createMemberCard('PL!S-test-other-member', '高海千歌', 4, 'Aqours'),
      PLAYER1,
      'bp4-006-other-member'
    ),
    createCardInstance(
      createMemberCard('PL!-test-muse-member-straight', '西木野真姫', 4, "μ's"),
      PLAYER1,
      'bp4-006-muse-member-straight'
    ),
    createCardInstance(
      createLiveCard('PL!S-test-other-live', 'Aqours LIVE', 'Aqours'),
      PLAYER1,
      'bp4-006-other-live'
    ),
  ];
}

function setupBp4006(
  options: {
    readonly cardCode?: 'PL!-bp4-006-P' | 'PL!-bp4-006-R';
    readonly successScore?: number;
    readonly topCards?: readonly ReturnType<typeof createCardInstance>[];
  } = {}
): Bp4006Scenario {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('pl-bp4-006-maki', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard(options.cardCode ?? 'PL!-bp4-006-P', '西木野真姫', 4, "μ's"),
    PLAYER1,
    'bp4-006-source'
  );
  const successLive = createCardInstance(
    {
      ...createLiveCard('PL!-test-success-live', 'Success LIVE', "μ's"),
      score: options.successScore ?? 3,
    },
    PLAYER1,
    'bp4-006-success-live'
  );
  const topCards = options.topCards ?? createBp4006TopCards();
  const deckFiller =
    topCards.length === 5
      ? createCardInstance(
          createMemberCard('PL!-test-deck-filler', 'Deck Filler', 1, "μ's"),
          PLAYER1,
          'bp4-006-deck-filler'
        )
      : null;
  let state = registerCards(session.state!, [
    source,
    successLive,
    ...topCards,
    ...(deckFiller ? [deckFiller] : []),
  ]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [
        ...topCards.map((card) => card.instanceId),
        ...(deckFiller ? [deckFiller.instanceId] : []),
      ],
    },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    successZone: { ...player.successZone, cardIds: [successLive.instanceId] },
    liveZone: { ...player.liveZone, cardIds: [] },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: null,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map(),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return { session, source, topCards };
}

function playBp4006(scenario: Bp4006Scenario): void {
  scenario.session.setManualOperationMode('FREE');
  const result = scenario.session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, scenario.source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success, result.error).toBe(true);
}

describe('PL!-bp4-006 shared success-score look-top configuration', () => {
  it('uses the real ON_ENTER_STAGE path and records the source instance, timing, and ability id', () => {
    const scenario = setupBp4006();
    playBp4006(scenario);

    const triggerAction = scenario.session.state?.actionHistory.find(
      (action) =>
        action.type === 'TRIGGER_ABILITY' &&
        action.payload.abilityId ===
          PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID
    );
    expect(triggerAction?.payload).toMatchObject({
      sourceCardId: scenario.source.instanceId,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      sourceSlot: SlotPosition.CENTER,
    });
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID,
      sourceCardId: scenario.source.instanceId,
      controllerId: PLAYER1,
      effectText:
        "【登场】存在于自己的成功LIVE卡区中的卡片的分数合计大于等于3的场合，检视自己卡组顶的5张卡。可以将1张其中的『μ's』的成员卡公开并加入手牌。其余的卡片放置入休息室。",
      selectionLabel: "选择要公开并加入手牌的『μ's』成员",
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '全部放置入休息室',
    });
  });

  it('consumes the current pending below score three without inspecting or leaking the deck top', () => {
    const scenario = setupBp4006({ successScore: 2 });
    const originalDeck = [...scenario.session.state!.players[0].mainDeck.cardIds];
    playBp4006(scenario);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.inspectionZone.cardIds).toEqual([]);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(originalDeck);
    expect(
      scenario.session.state?.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID
      )
    ).toBe(false);
    expect(scenario.session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
      successfulLiveScore: 2,
      requiredSuccessfulLiveScore: 3,
      conditionMet: false,
      resultText: '成功LIVE卡区中的卡片分数合计为2，未达到3，不检视卡组顶。',
    });
    const opponentView = scenario.session.getPlayerViewState(PLAYER2);
    for (const card of scenario.topCards) {
      expect(JSON.stringify(opponentView)).not.toContain(card.instanceId);
    }
  });

  it("selects only structured μ's MEMBER aliases and keeps all unselected cards private", () => {
    const scenario = setupBp4006();
    playBp4006(scenario);
    const [curlyMuseMember, museLive, otherMember, straightMuseMember] = scenario.topCards;

    expect(scenario.session.state?.activeEffect?.inspectionCardIds).toEqual(
      scenario.topCards.map((card) => card.instanceId)
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      curlyMuseMember!.instanceId,
      straightMuseMember!.instanceId,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      museLive!.instanceId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      otherMember!.instanceId
    );

    const controllerView = projectPlayerViewState(scenario.session.state!, PLAYER1);
    const opponentView = projectPlayerViewState(scenario.session.state!, PLAYER2);
    expect(controllerView.activeEffect?.selectableObjectIds).toEqual([
      createPublicObjectId(curlyMuseMember!.instanceId),
      createPublicObjectId(straightMuseMember!.instanceId),
    ]);
    expect(opponentView.activeEffect?.selectableObjectIds).toBeUndefined();
    for (const card of scenario.topCards) {
      expect(opponentView.objects[createPublicObjectId(card.instanceId)]?.surface).toBe('BACK');
    }
  });

  it('rejects opponent, unlisted, non-selector, oversized, and stale selections without closing the window', () => {
    const scenario = setupBp4006();
    const opponentCard = createCardInstance(
      createMemberCard('PL!-opponent-muse', '絢瀬絵里', 4, "μ's"),
      PLAYER2,
      'bp4-006-opponent-card'
    );
    let state = registerCards(scenario.session.state!, [opponentCard]);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = state;
    playBp4006(scenario);
    const effectId = scenario.session.state!.activeEffect!.id;

    for (const invalidCardId of [
      opponentCard.instanceId,
      'not-listed-card',
      scenario.topCards[1]!.instanceId,
      scenario.topCards[2]!.instanceId,
    ]) {
      const result = scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, effectId, invalidCardId)
      );
      expect(result.success).toBe(false);
      expect(scenario.session.state?.activeEffect?.id).toBe(effectId);
      expect(scenario.session.state?.inspectionZone.cardIds).toHaveLength(5);
    }

    const oversizedResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        undefined,
        undefined,
        undefined,
        [scenario.topCards[0]!.instanceId, scenario.topCards[3]!.instanceId]
      )
    );
    expect(oversizedResult.success).toBe(false);
    expect(scenario.session.state?.activeEffect?.id).toBe(effectId);

    const staleCardId = scenario.topCards[0]!.instanceId;
    state = {
      ...scenario.session.state!,
      inspectionZone: {
        ...scenario.session.state!.inspectionZone,
        cardIds: scenario.session.state!.inspectionZone.cardIds.filter(
          (cardId) => cardId !== staleCardId
        ),
      },
    };
    (scenario.session as unknown as { authorityState: GameState }).authorityState = state;
    const staleResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, staleCardId)
    );
    expect(staleResult.success).toBe(false);
    expect(scenario.session.state?.activeEffect?.id).toBe(effectId);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('allows zero selections and moves every inspected card to waiting room as one real event batch', () => {
    const scenario = setupBp4006();
    playBp4006(scenario);
    const effectId = scenario.session.state!.activeEffect!.id;
    const inspectedCardIds = scenario.topCards.map((card) => card.instanceId);

    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, null)
    );
    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(inspectedCardIds);
    expect(
      scenario.session.state?.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK &&
            event.toZone === ZoneType.WAITING_ROOM
        )
    ).toMatchObject({ cardInstanceIds: inspectedCardIds });
  });

  it('reveals the selected card to both players before adding it to hand and keeps the rest hidden', () => {
    const scenario = setupBp4006();
    playBp4006(scenario);
    const selectedCardId = scenario.topCards[0]!.instanceId;
    const hiddenCardId = scenario.topCards[1]!.instanceId;

    const reveal = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        selectedCardId
      )
    );
    expect(reveal.success, reveal.error).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toEqual([selectedCardId]);
    for (const playerId of [PLAYER1, PLAYER2]) {
      const view = scenario.session.getPlayerViewState(playerId);
      expect(view.objects[createPublicObjectId(selectedCardId)]?.surface).toBe('FRONT');
      expect(view.objects[createPublicObjectId(hiddenCardId)]?.surface).toBe(
        playerId === PLAYER1 ? 'FRONT' : 'BACK'
      );
    }

    const stateAfterSourceLeft = updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState =
      stateAfterSourceLeft;
    const finish = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      scenario.topCards.map((card) => card.instanceId).filter((cardId) => cardId !== selectedCardId)
    );
  });

  it('revalidates the structured selector again at confirmation time', () => {
    const scenario = setupBp4006();
    playBp4006(scenario);
    const selected = scenario.topCards[0]!;
    const changedToLive = createCardInstance(
      createLiveCard(selected.data.cardCode, selected.data.name, "μ's"),
      PLAYER1,
      selected.instanceId
    );
    const state = registerCards(scenario.session.state!, [changedToLive]);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = state;

    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        selected.instanceId
      )
    );
    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).not.toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('keeps the inspection waiting-room event and the pending it creates in the unified continuation', () => {
    const scenario = setupBp4006();
    const watcher = createCardInstance(
      createMemberCard('PL!SP-bp5-005-P', '葉月 恋', 11, 'Liella!'),
      PLAYER1,
      'bp4-006-waiting-room-watcher'
    );
    let state = registerCards(scenario.session.state!, [watcher]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: watcher.instanceId },
        cardStates: new Map([
          ...player.memberSlots.cardStates,
          [watcher.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = state;
    playBp4006(scenario);

    const finish = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id, null)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID &&
          action.payload.sourceCardId === watcher.instanceId
      )
    ).toBe(true);
    expect(
      scenario.session.state?.activeEffect?.abilityId ===
        SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID ||
        scenario.session.state?.pendingAbilities.some(
          (ability) =>
            ability.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
        )
    ).toBe(true);
  });

  it('clamps a short deck and safely confirms an empty deck without losing continuation', () => {
    const shortTop = createBp4006TopCards().slice(0, 1);
    const short = setupBp4006({ topCards: shortTop });
    playBp4006(short);
    expect(short.session.state?.activeEffect?.inspectionCardIds).toEqual(
      shortTop.map((card) => card.instanceId)
    );

    const empty = setupBp4006({ topCards: [] });
    playBp4006(empty);
    expect(empty.session.state?.activeEffect?.inspectionCardIds).toEqual([]);
    expect(empty.session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(empty.session.state?.activeEffect?.skipSelectionLabel).toBe('确认');
    const finish = empty.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, empty.session.state!.activeEffect!.id, null)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(empty.session.state?.activeEffect).toBeNull();
    expect(empty.session.state?.inspectionZone.cardIds).toEqual([]);
  });
});

const N_PB1_NAMED_MEMBER_CASES = [
  {
    sourceCardCode: 'PL!N-pb1-016-P＋',
    sourceName: '朝香果林',
    targetName: '朝香果林',
    abilityId: PL_N_PB1_016_ON_ENTER_LOOK_TOP_TWO_KARIN_MEMBER_ABILITY_ID,
  },
  {
    sourceCardCode: 'PL!N-pb1-018-P＋',
    sourceName: '近江彼方',
    targetName: '近江彼方',
    abilityId: PL_N_PB1_018_ON_ENTER_LOOK_TOP_TWO_KANATA_MEMBER_ABILITY_ID,
  },
  {
    sourceCardCode: 'PL!N-pb1-021-P＋',
    sourceName: '天王寺璃奈',
    targetName: '天王寺璃奈',
    abilityId: PL_N_PB1_021_ON_ENTER_LOOK_TOP_TWO_RINA_MEMBER_ABILITY_ID,
  },
  {
    sourceCardCode: 'PL!N-pb1-024-P＋',
    sourceName: '鐘 嵐珠',
    targetName: '鐘 嵐珠',
    abilityId: PL_N_PB1_024_ON_ENTER_LOOK_TOP_TWO_LANZHU_MEMBER_ABILITY_ID,
  },
] as const;

function setupNamedMemberLookTop(caseIndex: number, options: { noValidTarget?: boolean } = {}) {
  const cardCase = N_PB1_NAMED_MEMBER_CASES[caseIndex]!;
  const session = createGameSession();
  session.createGame(`n-pb1-named-member-${caseIndex}`, PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  const deck = createDeck();
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard(
      cardCase.sourceCardCode,
      cardCase.sourceName,
      caseIndex % 2 === 0 ? 2 : 4,
      '虹ヶ咲'
    ),
    PLAYER1,
    `n-pb1-source-${caseIndex}`
  );
  const validTarget = createCardInstance(
    createMemberCard(
      `PL!N-test-named-member-${caseIndex}`,
      options.noValidTarget ? '上原歩夢' : cardCase.targetName,
      1,
      '虹ヶ咲'
    ),
    PLAYER1,
    `n-pb1-valid-${caseIndex}`
  );
  const rejectedTarget =
    caseIndex === 3
      ? createCardInstance(
          createLiveCard('PL!N-test-lanzhu-live', '鐘嵐珠', '虹ヶ咲'),
          PLAYER1,
          'n-pb1-lanzhu-non-member'
        )
      : createCardInstance(
          createMemberCard(`PL!N-test-other-member-${caseIndex}`, '上原歩夢', 1, '虹ヶ咲'),
          PLAYER1,
          `n-pb1-other-${caseIndex}`
        );
  const topCards = [validTarget, rejectedTarget] as const;
  const deckFiller = createCardInstance(
    createMemberCard(`PL!N-test-deck-filler-${caseIndex}`, 'Deck Filler', 1, '虹ヶ咲'),
    PLAYER1,
    `n-pb1-deck-filler-${caseIndex}`
  );
  let state = registerCards(session.state!, [source, ...topCards, deckFiller]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [...topCards.map((card) => card.instanceId), deckFiller.instanceId],
    },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: null,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map(),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;
  session.setManualOperationMode('FREE');
  const play = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(play.success, play.error).toBe(true);
  return { session, cardCase, validTarget, rejectedTarget, topCards };
}

describe('N-pb1 named-member look-top-two shared configurations', () => {
  it.each(N_PB1_NAMED_MEMBER_CASES.map((_, index) => index))(
    'starts configuration %# through the real ON_ENTER path and publicly reveals only the selected member',
    (caseIndex) => {
      const scenario = setupNamedMemberLookTop(caseIndex);
      const effect = scenario.session.state!.activeEffect!;
      expect(effect).toMatchObject({
        abilityId: scenario.cardCase.abilityId,
        inspectionCardIds: scenario.topCards.map((card) => card.instanceId),
        selectableCardIds: [scenario.validTarget.instanceId],
        selectionLabel: '选择要公开并加入手牌的指定成员',
        confirmSelectionLabel: '公开并加入手牌',
        skipSelectionLabel: '全部放置入休息室',
      });
      expect(effect.selectableCardIds).not.toContain(scenario.rejectedTarget.instanceId);
      expect(
        projectPlayerViewState(scenario.session.state!, PLAYER2).activeEffect?.selectableObjectIds
      ).toBeUndefined();

      const reveal = scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, effect.id, scenario.validTarget.instanceId)
      );
      expect(reveal.success, reveal.error).toBe(true);
      expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
      expect(scenario.session.state?.inspectionZone.revealedCardIds).toEqual([
        scenario.validTarget.instanceId,
      ]);
      for (const playerId of [PLAYER1, PLAYER2]) {
        expect(
          scenario.session.getPlayerViewState(playerId).objects[
            createPublicObjectId(scenario.validTarget.instanceId)
          ]?.surface
        ).toBe('FRONT');
      }

      const finish = scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      );
      expect(finish.success, finish.error).toBe(true);
      expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
        scenario.validTarget.instanceId,
      ]);
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
        scenario.rejectedTarget.instanceId,
      ]);
      expect(scenario.session.state?.inspectionZone.cardIds).toEqual([]);
      expect(scenario.session.state?.inspectionZone.revealedCardIds).toEqual([]);
      expect(
        scenario.session.state?.eventLog
          .map((entry) => entry.event)
          .find(
            (event) =>
              event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
              event.fromZone === ZoneType.MAIN_DECK &&
              event.toZone === ZoneType.WAITING_ROOM
          )
      ).toMatchObject({ cardInstanceIds: [scenario.rejectedTarget.instanceId] });
    }
  );

  it('allows zero selections and safely sends both inspected cards to waiting room', () => {
    const scenario = setupNamedMemberLookTop(0);
    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id, null)
    );
    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      scenario.topCards.map((card) => card.instanceId)
    );
    expect(scenario.session.state?.inspectionZone.cardIds).toEqual([]);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toEqual([]);
  });

  it('does not offer a candidate when neither inspected card is the specified member', () => {
    const scenario = setupNamedMemberLookTop(1, { noValidTarget: true });
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(scenario.session.state?.activeEffect?.skipSelectionLabel).toBe('全部放置入休息室');
    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id, null)
    );
    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      scenario.topCards.map((card) => card.instanceId)
    );
  });
});

function setupNSd1001LookTop(
  options: {
    readonly topCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly withWaitingRoomWatcher?: boolean;
  } = {}
) {
  const session = createGameSession();
  session.createGame('n-sd1-001-ayumu-look-top', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(createDeck(), createDeck());
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!N-sd1-001-SD', '上原歩夢', 13, '虹ヶ咲'),
    PLAYER1,
    'n-sd1-001-source'
  );
  const defaultTopCards = [
    createCardInstance(
      createLiveCard('PL!N-test-live-valid', '虹咲 LIVE', '虹ヶ咲'),
      PLAYER1,
      'n-sd1-001-valid-live'
    ),
    createCardInstance(
      createMemberCard('PL!N-test-member', '虹咲成员', 4, '虹ヶ咲'),
      PLAYER1,
      'n-sd1-001-member'
    ),
    createCardInstance(
      createLiveCard('PL!S-test-live', 'Aqours LIVE', 'Aqours'),
      PLAYER1,
      'n-sd1-001-other-live'
    ),
    createCardInstance(
      createLiveCard('PL!N-test-live-valid-2', '虹咲 LIVE 2', '虹ヶ咲'),
      PLAYER1,
      'n-sd1-001-valid-live-2'
    ),
    createCardInstance(
      createMemberCard('PL!N-test-member-2', '虹咲成员2', 4, '虹ヶ咲'),
      PLAYER1,
      'n-sd1-001-member-2'
    ),
  ];
  const topCards = options.topCards ?? defaultTopCards;
  const deckFiller =
    topCards.length >= 5
      ? createCardInstance(
          createMemberCard('PL!N-test-deck-filler', 'Deck Filler', 1, '虹ヶ咲'),
          PLAYER1,
          'n-sd1-001-deck-filler'
        )
      : null;
  const watcher = options.withWaitingRoomWatcher
    ? createCardInstance(
        createMemberCard('PL!SP-bp5-005-P', '葉月 恋', 11, 'Liella!'),
        PLAYER1,
        'n-sd1-001-watcher'
      )
    : null;
  let state = registerCards(session.state!, [
    source,
    ...topCards,
    ...(deckFiller ? [deckFiller] : []),
    ...(watcher ? [watcher] : []),
  ]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [
        ...topCards.map((card) => card.instanceId),
        ...(deckFiller ? [deckFiller.instanceId] : []),
      ],
    },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: { ...player.liveZone, cardIds: [] },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: watcher?.instanceId ?? null,
        [SlotPosition.CENTER]: null,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: watcher
        ? new Map([
            [watcher.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ])
        : new Map(),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;

  session.setManualOperationMode('FREE');
  const play = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(play.success, play.error).toBe(true);
  return { session, source, topCards, watcher };
}

describe('PL!N-sd1-001-SD 费用13「上原歩夢」 shared look-top ability', () => {
  it('uses the real ON_ENTER path, selects only structured Nijigasaki LIVE cards, and reveals before moving', () => {
    const scenario = setupNSd1001LookTop({ withWaitingRoomWatcher: true });
    const [validLive, member, otherGroupLive, validLive2] = scenario.topCards;
    const effect = scenario.session.state!.activeEffect!;

    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID
      )?.payload
    ).toMatchObject({
      sourceCardId: scenario.source.instanceId,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      sourceSlot: SlotPosition.CENTER,
    });
    expect(effect).toMatchObject({
      abilityId: N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID,
      effectText:
        '【登场】检视自己卡组顶的5张卡。可以将至多1张其中的『虹咲』的LIVE卡公开并加入手牌。其余的卡片放置入休息室。',
      inspectionCardIds: scenario.topCards.map((card) => card.instanceId),
      selectableCardIds: [validLive!.instanceId, validLive2!.instanceId],
      selectionLabel: '选择要公开并加入手牌的虹咲 LIVE',
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '不加入',
    });
    expect(effect.selectableCardIds).not.toContain(member!.instanceId);
    expect(effect.selectableCardIds).not.toContain(otherGroupLive!.instanceId);
    expect(effect.selectableOptions).toBeUndefined();

    const reveal = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effect.id, validLive!.instanceId)
    );
    expect(reveal.success, reveal.error).toBe(true);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toEqual([validLive!.instanceId]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID,
      stepText:
        '【登场】检视自己卡组顶的5张卡。可以将至多1张其中的『虹咲』的LIVE卡公开并加入手牌。其余的卡片放置入休息室。',
      selectableCardIds: [],
      canSkipSelection: false,
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(false);

    const finish = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([validLive!.instanceId]);
    const waitingRoomCardIds = scenario.topCards
      .map((card) => card.instanceId)
      .filter((cardId) => cardId !== validLive!.instanceId);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(waitingRoomCardIds);
    expect(
      scenario.session.state?.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK &&
            event.toZone === ZoneType.WAITING_ROOM
        )
    ).toMatchObject({ cardInstanceIds: waitingRoomCardIds });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
  });

  it('allows selecting zero and sends the whole inspected group to waiting room', () => {
    const scenario = setupNSd1001LookTop();
    const inspectedCardIds = scenario.topCards.map((card) => card.instanceId);
    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id, null)
    );
    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(inspectedCardIds);
  });

  it('clamps a short deck and safely resolves no-target and empty-deck cases', () => {
    const shortCards = [
      createCardInstance(
        createMemberCard('PL!N-short-member', 'Short Member', 4, '虹ヶ咲'),
        PLAYER1,
        'n-sd1-001-short-member'
      ),
      createCardInstance(
        createLiveCard('PL!S-short-live', 'Short Aqours LIVE', 'Aqours'),
        PLAYER1,
        'n-sd1-001-short-live'
      ),
    ];
    const short = setupNSd1001LookTop({ topCards: shortCards });
    expect(short.session.state?.activeEffect).toMatchObject({
      inspectionCardIds: shortCards.map((card) => card.instanceId),
      selectableCardIds: [],
      skipSelectionLabel: '全部放置入休息室',
    });
    const shortFinish = short.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, short.session.state!.activeEffect!.id, null)
    );
    expect(shortFinish.success, shortFinish.error).toBe(true);
    expect(
      short.session.state?.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK &&
            event.toZone === ZoneType.WAITING_ROOM
        )
    ).toMatchObject({ cardInstanceIds: shortCards.map((card) => card.instanceId) });

    const empty = setupNSd1001LookTop({ topCards: [] });
    expect(empty.session.state?.activeEffect).toMatchObject({
      inspectionCardIds: [],
      selectableCardIds: [],
      skipSelectionLabel: '确认',
    });
    const emptyFinish = empty.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, empty.session.state!.activeEffect!.id, null)
    );
    expect(emptyFinish.success, emptyFinish.error).toBe(true);
    expect(empty.session.state?.activeEffect).toBeNull();
    expect(empty.session.state?.pendingAbilities).toEqual([]);
  });
});
