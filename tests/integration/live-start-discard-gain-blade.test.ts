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
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
  SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
  SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/member-slot-moved-triggers';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
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

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string, sourceSlot: SlotPosition): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-${sourceCardId}`],
    sourceSlot,
  };
}

function setupScenario(options: {
  readonly sourceCardCode?: string;
  readonly sourceName?: string;
  readonly handKind?: 'member' | 'live' | 'none';
  readonly sourceOnStage?: boolean;
} = {}): {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly discardCardId: string | null;
  readonly drawCardId: string;
} {
  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!SP-PR-009-PR', options.sourceName ?? '米女メイ'),
    PLAYER1,
    'source'
  );
  const discardCard =
    options.handKind === 'none'
      ? null
      : createCardInstance(
          options.handKind === 'live'
            ? createLive('PL!SP-test-discard-L')
            : createMember('PL!SP-test-discard-M'),
          PLAYER1,
          'discard'
        );
  const drawCard = createCardInstance(createMember('PL!SP-test-draw'), PLAYER1, 'draw');
  const fillerCard = createCardInstance(createMember('PL!SP-test-filler'), PLAYER1, 'filler');

  let game = createGameState('sp-pr-live-start-discard-blade-draw', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(
    game,
    discardCard ? [source, discardCard, drawCard, fillerCard] : [source, drawCard, fillerCard]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId, fillerCard.instanceId] },
    hand: discardCard ? addCardToZone(player.hand, discardCard.instanceId) : player.hand,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));

  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPendingAbility(source.instanceId, SlotPosition.CENTER)],
  }).gameState;

  const session = createGameSession();
  session.createGame('sp-pr-live-start-discard-blade-draw-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;

  return {
    session,
    sourceCardId: source.instanceId,
    discardCardId: discardCard?.instanceId ?? null,
    drawCardId: drawCard.instanceId,
  };
}

function setupSbp3003(handCount = 3): {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly handCardIds: readonly string[];
  readonly outsideCardId: string;
} {
  const source = createCardInstance(createMember('PL!S-bp3-003-P', '松浦果南'), PLAYER1, 's-bp3-003-source');
  const hand = Array.from({ length: handCount }, (_, index) =>
    createCardInstance(createMember(`S-BP3-003-HAND-${index}`), PLAYER1, `s-bp3-003-hand-${index}`)
  );
  const outside = createCardInstance(createMember('S-BP3-003-OUTSIDE'), PLAYER1, 's-bp3-003-outside');
  let game = registerCards(
    createGameState('s-bp3-003-focused', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...hand, outside]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [{
      ...createPendingAbility(source.instanceId, SlotPosition.CENTER),
      abilityId: S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
    }],
  }).gameState;
  const session = createGameSession();
  session.createGame('s-bp3-003-focused-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return {
    session,
    sourceCardId: source.instanceId,
    handCardIds: hand.map((card) => card.instanceId),
    outsideCardId: outside.instanceId,
  };
}

function setupSpSd1003(options: {
  readonly handKinds?: readonly ('member' | 'live')[];
  readonly sourceOrientation?: OrientationState;
  readonly sourceSlot?: SlotPosition;
  readonly resolve?: boolean;
} = {}): {
  readonly game: GameState;
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly handCardIds: readonly string[];
  readonly outsideCardId: string;
} {
  const handKinds = options.handKinds ?? ['member', 'member'];
  const sourceSlot = options.sourceSlot ?? SlotPosition.CENTER;
  const source = createCardInstance(
    createMember('PL!SP-sd1-003-SD', '嵐 千砂都'),
    PLAYER1,
    'sp-sd1-003-source'
  );
  const hand = handKinds.map((kind, index) =>
    createCardInstance(
      kind === 'live'
        ? createLive(`SP-SD1-003-LIVE-${index}`)
        : createMember(`SP-SD1-003-MEMBER-${index}`),
      PLAYER1,
      `sp-sd1-003-hand-${index}`
    )
  );
  const outside = createCardInstance(
    createMember('SP-SD1-003-OUTSIDE'),
    PLAYER1,
    'sp-sd1-003-outside'
  );
  let game = registerCards(
    createGameState('sp-sd1-003-focused', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...hand, outside]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId, {
      orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
  const started = options.resolve === false ? queued : resolvePendingCardEffects(queued).gameState;
  const session = createGameSession();
  session.createGame('sp-sd1-003-focused-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return {
    game: started,
    session,
    sourceCardId: source.instanceId,
    handCardIds: hand.map((card) => card.instanceId),
    outsideCardId: outside.instanceId,
  };
}

function selectDiscard(session: GameSession, discardCardId: string | null): ReturnType<GameSession['executeCommand']> {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
  );
}

function selectDiscards(session: GameSession, discardCardIds: readonly string[]) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      null,
      undefined,
      null,
      discardCardIds
    )
  );
}

describe('SP PR LIVE start discard gain BLADE and draw if LIVE shared workflow', () => {
  it.each([
    ['PL!SP-PR-009-PR', '米女メイ'],
    ['PL!SP-PR-011-PR', '鬼塚夏美'],
    ['PL!SP-PR-012-PR', 'ウィーン・マルガレーテ'],
  ] as const)('discards a member card and gives source member BLADE for %s', (cardCode, name) => {
    const { session, sourceCardId, discardCardId, drawCardId } = setupScenario({
      sourceCardCode: cardCode,
      sourceName: name,
      handKind: 'member',
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
      selectableCardIds: [discardCardId],
      canSkipSelection: true,
    });

    expect(selectDiscard(session, discardCardId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId,
      abilityId: SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
    });
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DISCARD_GAIN_BLADE',
      discardedCardId: discardCardId,
      discardedCardIds: [discardCardId],
    });
  });

  it('discards a LIVE card, gives BLADE, and draws one', () => {
    const { session, discardCardId, drawCardId } = setupScenario({ handKind: 'live' });

    expect(selectDiscard(session, discardCardId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'DISCARD_LIVE_GAIN_BLADE_DRAW_ONE' &&
          action.payload.discardedCardId === discardCardId &&
          action.payload.discardedCardIds?.[0] === discardCardId &&
          action.payload.discardedLive === true &&
          action.payload.drawnCardIds?.[0] === drawCardId
      )
    ).toBe(true);
  });

  it('declines without discarding or adding BLADE', () => {
    const { session, discardCardId } = setupScenario({ handKind: 'member' });

    expect(selectDiscard(session, null).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(discardCardId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('consumes pending without opening a discard choice when hand is empty', () => {
    const { session } = setupScenario({ handKind: 'none' });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'NO_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });

  it('consumes pending safely when the source member is no longer on stage', () => {
    const { session, discardCardId } = setupScenario({
      handKind: 'member',
      sourceOnStage: false,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toContain(discardCardId);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('S-bp3-003 supports 0, 1, or 2 discards and grants two BLADE per discarded card', () => {
    for (const discardCount of [0, 1, 2]) {
      const source = createCardInstance(createMember('PL!S-bp3-003-P', '松浦果南'), PLAYER1, `source-${discardCount}`);
      const hand = [0, 1].map((index) =>
        createCardInstance(createMember(`S-BP3-003-HAND-${discardCount}-${index}`), PLAYER1, `hand-${discardCount}-${index}`)
      );
      let game = registerCards(
        createGameState(`s-bp3-003-live-start-${discardCount}`, PLAYER1, 'P1', PLAYER2, 'P2'),
        [source, ...hand]
      );
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
      }));
      const started = resolvePendingCardEffects({
        ...game,
        pendingAbilities: [{
          ...createPendingAbility(source.instanceId, SlotPosition.CENTER),
          abilityId: S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
        }],
      }).gameState;
      const session = createGameSession();
      session.createGame(`s-bp3-003-live-start-session-${discardCount}`, PLAYER1, 'P1', PLAYER2, 'P2');
      (session as unknown as { authorityState: GameState }).authorityState = started;

      expect(session.state?.activeEffect).toMatchObject({
        stepText: '可以将至多2张手牌放置入休息室；每放置1张，此成员获得[BLADE][BLADE]。',
        minSelectableCards: 1,
        maxSelectableCards: 2,
        selectionLabel: '选择要放置入休息室的卡',
        confirmSelectionLabel: '放置入休息室',
        skipSelectionLabel: '不发动',
      });
      expect(session.state?.activeEffect?.stepText).not.toContain('来源成员');
      expect(
        discardCount === 0
          ? selectDiscard(session, null).success
          : selectDiscards(session, hand.slice(0, discardCount).map((card) => card.instanceId)).success
      ).toBe(true);
      if (discardCount === 0) {
        expect(session.state?.liveResolution.liveModifiers).toEqual([]);
      } else {
        expect(session.state?.liveResolution.liveModifiers).toContainEqual({
          kind: 'BLADE',
          playerId: PLAYER1,
          countDelta: discardCount * 2,
          sourceCardId: source.instanceId,
          abilityId: S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
        });
      }
    }
  });

  it('S-bp3-003 rejects duplicate, over-limit, and outside-candidate selections atomically', () => {
    const duplicate = setupSbp3003();
    expect(selectDiscards(duplicate.session, [duplicate.handCardIds[0]!, duplicate.handCardIds[0]!]).success).toBe(false);
    expect(duplicate.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(duplicate.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(duplicate.session.state?.activeEffect).not.toBeNull();

    const overLimit = setupSbp3003();
    expect(selectDiscards(overLimit.session, overLimit.handCardIds).success).toBe(false);
    expect(overLimit.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(overLimit.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(overLimit.session.state?.activeEffect).not.toBeNull();

    const outside = setupSbp3003();
    expect(selectDiscards(outside.session, [outside.outsideCardId]).success).toBe(false);
    expect(outside.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(outside.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(outside.session.state?.activeEffect).not.toBeNull();
  });

  it('S-bp3-003 does not advance when the selected hand card became stale', () => {
    const scenario = setupSbp3003(2);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: player.hand.cardIds.filter((cardId) => cardId !== scenario.handCardIds[0]) },
      })
    );

    expect(selectDiscards(scenario.session, [scenario.handCardIds[0]!]).success).toBe(false);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(scenario.session.state?.activeEffect).not.toBeNull();
  });

  it('S-bp3-003 safely ends without discarding or adding BLADE when the source leaves after opening', () => {
    const scenario = setupSbp3003(2);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      })
    );

    expect(selectDiscards(scenario.session, [scenario.handCardIds[0]!]).success).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });

  it('enqueues SP-sd1-003 through the real LIVE_START path with source instance, slot, and timing', () => {
    const scenario = setupSpSd1003({ resolve: false });

    expect(scenario.game.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceCardId,
        controllerId: PLAYER1,
        sourceSlot: SlotPosition.CENTER,
        timingId: TriggerCondition.ON_LIVE_START,
      }),
    ]);
  });

  it.each([OrientationState.ACTIVE, OrientationState.WAITING])(
    'opens the exact two-card SP-sd1-003 window from an %s source',
    (sourceOrientation) => {
      const scenario = setupSpSd1003({
        handKinds: ['member', 'member', 'member'],
        sourceOrientation,
      });

      expect(scenario.session.state?.activeEffect).toMatchObject({
        abilityId: SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceCardId,
        selectableCardIds: scenario.handCardIds,
        minSelectableCards: 2,
        maxSelectableCards: 2,
        canSkipSelection: true,
        stepText:
          '可以将2张手牌放置入休息室：LIVE结束时为止，获得[BLADE][BLADE][BLADE][BLADE][BLADE]。',
        selectionLabel: '选择要放置入休息室的卡',
        confirmSelectionLabel: '放置入休息室',
        skipSelectionLabel: '不发动',
      });
      expect(scenario.session.state?.activeEffect?.stepText).not.toMatch(
        /来源仍在舞台|来源不在舞台|source|pending|stale|payload|eventId|trigger/
      );
    }
  );

  it.each([0, 1])('consumes SP-sd1-003 safely with %i hand cards and opens no illegal window', (handCount) => {
    const scenario = setupSpSd1003({
      handKinds: Array.from({ length: handCount }, () => 'member' as const),
    });

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it.each([2, 3])('keeps SP-sd1-003 min/max exactly two with %i hand cards', (handCount) => {
    const scenario = setupSpSd1003({
      handKinds: Array.from({ length: handCount }, () => 'member' as const),
    });

    expect(scenario.session.state?.activeEffect).toMatchObject({
      selectableCardIds: scenario.handCardIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
  });

  it('allows SP-sd1-003 to be skipped without discarding or adding BLADE', () => {
    const scenario = setupSpSd1003({ handKinds: ['member', 'live'] });

    expect(selectDiscard(scenario.session, null).success).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(scenario.session.state?.activeEffect).toBeNull();
  });

  it('discards exactly two mixed cards at once, draws nothing, and grants fixed BLADE +5', () => {
    const scenario = setupSpSd1003({ handKinds: ['member', 'live', 'member'] });
    const selected = scenario.handCardIds.slice(0, 2);

    expect(selectDiscards(scenario.session, selected).success).toBe(true);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(selected);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([scenario.handCardIds[2]]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([
      {
        kind: 'BLADE',
        playerId: PLAYER1,
        countDelta: 5,
        sourceCardId: scenario.sourceCardId,
        abilityId: SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID,
      },
    ]);
    expect(
      scenario.session.state?.actionHistory.filter((action) => action.payload.step === 'DRAW_CARD')
    ).toEqual([]);
    expect(scenario.session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DISCARD_TWO_GAIN_FIVE_BLADE',
      discardedCardIds: selected,
      discardedLive: false,
      bladeBonus: 5,
      drawnCardIds: [],
    });
    expect(
      scenario.session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
  });

  it.each([
    ['one card', (scenario: ReturnType<typeof setupSpSd1003>) => [scenario.handCardIds[0]!]],
    ['three cards', (scenario: ReturnType<typeof setupSpSd1003>) => scenario.handCardIds],
    ['duplicate ids', (scenario: ReturnType<typeof setupSpSd1003>) => [scenario.handCardIds[0]!, scenario.handCardIds[0]!]],
    ['outside candidate', (scenario: ReturnType<typeof setupSpSd1003>) => [scenario.handCardIds[0]!, scenario.outsideCardId]],
  ] as const)('atomically rejects SP-sd1-003 %s selection and preserves its window', (_label, selected) => {
    const scenario = setupSpSd1003({ handKinds: ['member', 'member', 'member'] });
    const before = scenario.session.state;

    expect(selectDiscards(scenario.session, selected(scenario)).success).toBe(false);
    expect(scenario.session.state).toEqual(before);
  });

  it('atomically rejects a stale SP-sd1-003 hand id and preserves its window', () => {
    const scenario = setupSpSd1003({ handKinds: ['member', 'member', 'member'] });
    const staleId = scenario.handCardIds[0]!;
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: player.hand.cardIds.filter((cardId) => cardId !== staleId) },
      })
    );
    const before = scenario.session.state;

    expect(selectDiscards(scenario.session, [staleId, scenario.handCardIds[1]!]).success).toBe(false);
    expect(scenario.session.state).toEqual(before);
  });

  it('consumes SP-sd1-003 pending safely when the source leaves before pending resolution', () => {
    const scenario = setupSpSd1003({ resolve: false });
    const sourceRemoved = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = resolvePendingCardEffects(sourceRemoved).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('ends SP-sd1-003 safely when the source leaves after its window opens', () => {
    const scenario = setupSpSd1003({ handKinds: ['member', 'member'] });
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      })
    );

    expect(selectDiscards(scenario.session, scenario.handCardIds).success).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });

  it('keeps SP-sd1-003 BLADE through movement and clears it on standard source departure', () => {
    const scenario = setupSpSd1003({ handKinds: ['member', 'member'] });
    expect(selectDiscards(scenario.session, scenario.handCardIds).success).toBe(true);

    const moved = moveMemberBetweenSlotsAndEnqueueTriggers(
      scenario.session.state!,
      PLAYER1,
      scenario.sourceCardId,
      SlotPosition.RIGHT,
      enqueueTriggeredCardEffects
    );
    expect(moved?.gameState.liveResolution.liveModifiers).toHaveLength(1);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      moved!.gameState,
      PLAYER1,
      scenario.sourceCardId,
      enqueueTriggeredCardEffects
    );
    expect(left?.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it('clears SP-sd1-003 BLADE through the unified LIVE-end lifecycle', () => {
    const scenario = setupSpSd1003({ handKinds: ['member', 'member'] });
    expect(selectDiscards(scenario.session, scenario.handCardIds).success).toBe(true);
    expect(scenario.session.state?.liveResolution.liveModifiers).toHaveLength(1);

    const finalized = new GameService().finalizeLiveResult({
      ...scenario.session.state!,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      liveResolution: {
        ...scenario.session.state!.liveResolution,
        liveWinnerIds: [PLAYER1],
      },
    });

    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it('reopens ordered resolution when the grouped discard event adds a new pending ability', () => {
    const first = createCardInstance(
      createMember('PL!SP-sd1-003-SD', '嵐 千砂都'),
      PLAYER1,
      'sp-sd1-003-first'
    );
    const second = createCardInstance(
      createMember('PL!SP-sd1-003-P', '嵐 千砂都'),
      PLAYER1,
      'sp-sd1-003-second'
    );
    const watcher = createCardInstance(
      createMember('PL!HS-pb1-003-R', '大沢 瑠璃乃'),
      PLAYER1,
      'hs-pb1-003-watcher'
    );
    const hand = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(
        createMember(`SP-SD1-003-ORDERED-HAND-${index}`),
        PLAYER1,
        `sp-sd1-003-ordered-hand-${index}`
      )
    );
    let game = registerCards(
      createGameState('sp-sd1-003-ordered-new-pending', PLAYER1, 'P1', PLAYER2, 'P2'),
      [first, second, watcher, ...hand]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
          SlotPosition.CENTER,
          watcher.instanceId
        ),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    const orderSelection = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START])
    ).gameState;
    const session = createGameSession();
    session.createGame('sp-sd1-003-ordered-new-pending-session', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = orderSelection;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.sourceCardId).toBe(first.instanceId);
    expect(selectDiscards(session, hand.slice(0, 2).map((card) => card.instanceId)).success).toBe(true);

    expect(session.state?.activeEffect?.canResolveInOrder).toBe(true);
    expect(session.state?.pendingAbilities).toHaveLength(2);
    expect(session.state?.pendingAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID,
          sourceCardId: second.instanceId,
        }),
        expect.objectContaining({
          abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
          sourceCardId: watcher.instanceId,
        }),
      ])
    );
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === first.instanceId
      ).map((action) => action.payload.step)
    ).toEqual(['START_SELECT_DISCARD', 'DISCARD_TWO_GAIN_FIVE_BLADE']);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_SD1_003_LIVE_START_DISCARD_TWO_GAIN_FIVE_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === second.instanceId
      )
    ).toEqual([]);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('continues ordered pending after a decline into the next discard window', () => {
    const first = createCardInstance(createMember('PL!SP-PR-009-PR', '米女メイ'), PLAYER1, 'first');
    const second = createCardInstance(createMember('PL!SP-PR-011-PR', '鬼塚夏美'), PLAYER1, 'second');
    const discard = createCardInstance(createMember('PL!SP-test-discard-M'), PLAYER1, 'discard');
    let game = createGameState('sp-pr-live-start-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second, discard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, discard.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(first.instanceId, SlotPosition.LEFT),
        createPendingAbility(second.instanceId, SlotPosition.RIGHT),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    const session = createGameSession();
    session.createGame('sp-pr-live-start-ordered-session', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = orderSelection;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.sourceCardId).toBe(first.instanceId);

    expect(selectDiscard(session, null).success).toBe(true);
    expect(session.state?.activeEffect?.sourceCardId).toBe(second.instanceId);

    expect(selectDiscard(session, discard.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toContain(discard.instanceId);
  });
});
