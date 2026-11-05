import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createAutoAdvancePublicEffectChoiceCommand,
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createSubmitScoreCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
  BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
  BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
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

// Identity and stats copied from references/cards_export_2026-11-02.json.
const KOTORI: MemberCardData = {
  cardCode: 'PL!-bp6-003-P',
  name: '南琴梨（南小鸟）',
  groupNames: ['μ’s'],
  cardType: CardType.MEMBER,
  cost: 15,
  blade: 7,
  hearts: [
    createHeartIcon(HeartColor.PINK, 1),
    createHeartIcon(HeartColor.YELLOW, 3),
    createHeartIcon(HeartColor.PURPLE, 1),
  ],
};
const HANAYO: MemberCardData = {
  cardCode: 'PL!-bp6-017-N',
  name: '小泉花阳',
  groupNames: ['μ’s'],
  cardType: CardType.MEMBER,
  cost: 2,
  blade: 0,
  hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.YELLOW, 1)],
};
const ELI: MemberCardData = {
  cardCode: 'PL!-bp6-002-P',
  name: '绚濑绘里',
  groupNames: ['μ’s'],
  cardType: CardType.MEMBER,
  cost: 2,
  blade: 1,
  hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
};
const NICO: MemberCardData = {
  cardCode: 'PL!-bp3-009-R+',
  name: '矢泽日香（矢泽妮可）',
  groupNames: ['μ’s'],
  cardType: CardType.MEMBER,
  cost: 2,
  blade: 2,
  hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
};
const NOZOMI: MemberCardData = {
  cardCode: 'PL!-bp6-007-P',
  name: '东条希',
  groupNames: ['μ’s'],
  cardType: CardType.MEMBER,
  cost: 11,
  blade: 4,
  hearts: [
    createHeartIcon(HeartColor.PINK, 2),
    createHeartIcon(HeartColor.YELLOW, 1),
    createHeartIcon(HeartColor.PURPLE, 1),
  ],
};
const ARASHI: LiveCardData = {
  cardCode: 'PL!-pb2-038-L',
  name: '正因为是暴风雨中的爱恋',
  groupNames: ['μ’s'],
  cardType: CardType.LIVE,
  score: 5,
  requirements: createHeartRequirement({
    [HeartColor.PINK]: 3,
    [HeartColor.YELLOW]: 3,
    [HeartColor.PURPLE]: 2,
    [HeartColor.RAINBOW]: 5,
  }),
};
const MYSTERY: LiveCardData = {
  cardCode: 'PL!-bp4-025-L',
  name: '来自微热的神秘',
  groupNames: ['μ’s'],
  cardType: CardType.LIVE,
  score: 5,
  requirements: createHeartRequirement({
    [HeartColor.PINK]: 3,
    [HeartColor.PURPLE]: 3,
    [HeartColor.RAINBOW]: 6,
  }),
};

function createMember(
  cardCode: string,
  name: string,
  options: {
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames ?? ["μ's"],
    unitName: options.groupNames?.[0] ?? "μ's",
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupKotoriGame(options: {
  readonly sourceSlot?: SlotPosition;
  readonly handCandidates?: readonly ReturnType<typeof createCardInstance>[];
  readonly memberBelowCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly pendingAbilityId: string;
}): GameState {
  const source = createCardInstance(KOTORI, PLAYER1, 'kotori-source');
  const handCandidates = options.handCandidates ?? [];
  const memberBelowCards = options.memberBelowCards ?? [];
  let game = createGameState('bp6-003-kotori', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCandidates, ...memberBelowCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      options.sourceSlot ?? SlotPosition.CENTER,
      source.instanceId,
      activeFaceUp()
    );
    for (const card of memberBelowCards) {
      memberSlots = addMemberBelowMember(
        memberSlots,
        options.sourceSlot ?? SlotPosition.CENTER,
        card.instanceId
      );
    }
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: handCandidates.map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  return {
    ...game,
    pendingAbilities: [
      createPendingAbility(
        options.pendingAbilityId,
        source.instanceId,
        options.sourceSlot ?? SlotPosition.CENTER
      ),
    ],
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  sourceSlot: SlotPosition
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: false,
    timingId: abilityId.includes('live-start')
      ? TriggerCondition.ON_LIVE_START
      : TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`event:${abilityId}`],
    sourceSlot,
  };
}

function createSessionWithState(game: GameState) {
  const session = createGameSession();
  session.createGame('bp6-003-kotori-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmEffect(
  session: ReturnType<typeof createSessionWithState>,
  selectedCardId?: string | null,
  selectedSlot?: SlotPosition | null,
  selectedOptionId?: string | null
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      selectedCardId,
      selectedSlot,
      undefined,
      selectedOptionId
    )
  );
}

function advancePublicRevealDwell(session: ReturnType<typeof createSessionWithState>) {
  const effect = session.state!.activeEffect!;
  expect(effect.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
  expect(effect.awaitingPlayerId).toBe(PLAYER1);
  expect(effect.publicRevealGeneration).toEqual(expect.any(String));

  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: {
      ...effect,
      publicRevealAutoAdvanceAt: 0,
    },
  };
  return session.executeCommand(
    createAutoAdvancePublicRevealCommand(PLAYER1, effect.id, 0, effect.publicRevealGeneration!)
  );
}

function confirmEffectChoice(
  session: ReturnType<typeof createSessionWithState>,
  selectedOptionId: string
) {
  const effectId = session.state!.activeEffect!.id;
  const selected = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effectId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [selectedOptionId]
    )
  );
  expect(selected.success, selected.error).toBe(true);
  expect(session.state?.activeEffect).toMatchObject({
    stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
    effectChoice: { selectedOptionIds: [selectedOptionId] },
  });
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: {
      ...session.state!.activeEffect!,
      publicEffectChoiceAutoAdvanceAt: 0,
    },
  };
  return session.executeCommand(createAutoAdvancePublicEffectChoiceCommand(PLAYER1, effectId, 0));
}

function activeFaceUp() {
  return {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  };
}

function startJudgedKotoriLive(options: {
  readonly solo?: boolean;
  readonly priorArashi?: boolean;
  readonly nozomiOnStage?: boolean;
  readonly judgedScore: number;
}) {
  const belowMember = createCardInstance(options.solo ? ELI : HANAYO, PLAYER1, 'below-member');
  const leftMember = createCardInstance(
    options.nozomiOnStage ? NOZOMI : HANAYO,
    PLAYER1,
    'left-member'
  );
  const priorArashi = createCardInstance(ARASHI, PLAYER1, 'prior-arashi');
  const ownLive = createCardInstance(options.solo ? MYSTERY : ARASHI, PLAYER1, 'own-live');
  const opponentLive = createCardInstance(MYSTERY, PLAYER2, 'opponent-live');
  const topCard = createCardInstance(options.solo ? HANAYO : NICO, PLAYER1, 'deck-top');
  let game = setupKotoriGame({
    memberBelowCards: [belowMember],
    pendingAbilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
  });
  game = registerCards(game, [leftMember, priorArashi, ownLive, opponentLive, topCard]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: options.solo
      ? player.memberSlots
      : placeCardInSlot(
          player.memberSlots,
          SlotPosition.LEFT,
          leftMember.instanceId,
          activeFaceUp()
        ),
    liveZone: {
      ...player.liveZone,
      cardIds: [ownLive.instanceId],
      cardStates: new Map([[ownLive.instanceId, activeFaceUp()]]),
    },
    successZone: {
      ...player.successZone,
      cardIds: options.priorArashi ? [priorArashi.instanceId] : [],
    },
    mainDeck: { ...player.mainDeck, cardIds: [topCard.instanceId] },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [opponentLive.instanceId],
      cardStates: new Map([[opponentLive.instanceId, activeFaceUp()]]),
    },
  }));
  // Both players have accepted their performance judgments. Let the normal phase transition
  // dispatch the first player's success effects while carrying the existing score drafts.
  const advanced = new GameService().advancePhase({
    ...game,
    isStarted: true,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentTurnType: TurnType.SECOND_PLAYER_TURN,
    activePlayerIndex: 1,
    pendingAbilities: [],
    liveResolution: {
      ...game.liveResolution,
      isInLive: false,
      liveResults: new Map([
        [ownLive.instanceId, true],
        [opponentLive.instanceId, true],
      ]),
      playerScores: new Map([
        [PLAYER1, options.judgedScore],
        [PLAYER2, 5],
      ]),
    },
  });
  expect(advanced.success, advanced.error).toBe(true);
  const session = createSessionWithState(advanced.gameState);
  expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);
  expect(session.manualOperationMode).toBe('RULES');
  return { session, belowMemberId: belowMember.instanceId };
}

function expectKotoriLiveDraft(
  session: ReturnType<typeof createSessionWithState>,
  score: number,
  modifier: number
) {
  expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(score);
  expect(session.getPlayerViewState(PLAYER1)?.match.liveResult).toMatchObject({
    scores: { FIRST: score, SECOND: 5 },
    scoreModifiers: { FIRST: modifier, SECOND: 0 },
  });
}

function playKotoriMemberBelow(
  session: ReturnType<typeof createSessionWithState>,
  belowMemberId: string
) {
  expect(session.state?.activeEffect).toMatchObject({
    abilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    selectableCardIds: [belowMemberId],
  });
  const selection = confirmEffect(session, belowMemberId);
  expect(selection.success, selection.error).toBe(true);
  const entry = confirmEffect(session, undefined, SlotPosition.RIGHT);
  expect(entry.success, entry.error).toBe(true);
  expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(belowMemberId);
}

describe('PL!-bp6-003 Kotori memberBelow workflow', () => {
  it('reveals a low-cost Muse hand member, stacks it below, and gains exactly one selected Heart', () => {
    const handMember = createCardInstance(
      createMember('PL!-bp1-test-low-cost', '低费μ成员', { cost: 2 }),
      PLAYER1,
      'hand-low-cost-muse'
    );
    const existingBelow = createCardInstance(
      createMember('PL!-existing-below', '既有下方成员', { cost: 2 }),
      PLAYER1,
      'existing-below'
    );
    const game = setupKotoriGame({
      handCandidates: [handMember],
      memberBelowCards: [existingBelow],
      pendingAbilityId:
        BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    });
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
      selectableCardIds: [handMember.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });

    expect(confirmEffect(session, handMember.instanceId).success).toBe(true);
    const publicReveal = session.state!.activeEffect!;
    expect(publicReveal).toMatchObject({
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      revealedCardIds: [handMember.instanceId],
    });
    expect(session.state?.players[0].hand.cardIds).toContain(handMember.instanceId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);

    const earlyAdvance = session.executeCommand({
      ...createConfirmEffectStepCommand(PLAYER1, publicReveal.id),
      publicRevealAutoAdvanceAt: publicReveal.publicRevealAutoAdvanceAt,
      publicRevealGeneration: publicReveal.publicRevealGeneration,
    });
    expect(earlyAdvance.success).toBe(false);
    expect(earlyAdvance.error).toBe('公开卡牌展示尚未结束');
    expect(session.state?.players[0].hand.cardIds).toContain(handMember.instanceId);

    const advance = advancePublicRevealDwell(session);
    expect(advance.success, advance.error).toBe(true);
    expect(session.state?.activeEffect?.effectChoice?.options.map((option) => option.id)).toEqual([
      HeartColor.PINK,
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ]);

    expect(confirmEffectChoice(session, HeartColor.BLUE).success).toBe(true);
    const player = session.state!.players[0]!;
    expect(player.hand.cardIds).not.toContain(handMember.instanceId);
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      existingBelow.instanceId,
      handMember.instanceId,
    ]);
    expect(
      session.state?.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId ===
            BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID
      )
    ).toEqual([
      {
        kind: 'HEART',
        playerId: PLAYER1,
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
        sourceCardId: 'kotori-source',
        abilityId:
          BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
        target: 'SOURCE_MEMBER',
      },
    ]);
  });

  it('skips live start outside center or when no legal hand candidate exists', () => {
    const leftGame = setupKotoriGame({
      sourceSlot: SlotPosition.LEFT,
      handCandidates: [
        createCardInstance(createMember('PL!-low-cost', 'low', { cost: 2 }), PLAYER1, 'low'),
      ],
      pendingAbilityId:
        BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    });
    const leftResult = resolvePendingCardEffects(leftGame).gameState;
    expect(leftResult.activeEffect).toBeNull();
    expect(
      leftResult.actionHistory.some((action) => action.payload.step === 'SOURCE_NOT_CENTER')
    ).toBe(true);

    const noCandidate = setupKotoriGame({
      handCandidates: [
        createCardInstance(
          createMember('PL!-high-cost', 'high', { cost: 3 }),
          PLAYER1,
          'high-cost'
        ),
      ],
      pendingAbilityId:
        BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
    });
    const noCandidateResult = resolvePendingCardEffects(noCandidate).gameState;
    expect(noCandidateResult.activeEffect).toBeNull();
    expect(
      noCandidateResult.actionHistory.some(
        (action) => action.payload.step === 'NO_HAND_LOW_COST_MUSE_MEMBER'
      )
    ).toBe(true);
  });

  it('plays a low-cost Muse member from below to an empty slot and records enter-stage event', () => {
    const belowMember = createCardInstance(
      createMember('PL!-below-low-cost', 'below', { cost: 2 }),
      PLAYER1,
      'below-low-cost'
    );
    const game = setupKotoriGame({
      memberBelowCards: [belowMember],
      pendingAbilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    });
    const session = createSessionWithState(resolvePendingCardEffects(game).gameState);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([belowMember.instanceId]);
    expect(confirmEffect(session, belowMember.instanceId).success).toBe(true);
    expect(confirmEffect(session, undefined, SlotPosition.RIGHT).success).toBe(true);

    const player = session.state!.players[0]!;
    expect(player.memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(player.memberSlots.slots[SlotPosition.RIGHT]).toBe(belowMember.instanceId);
    expect(player.memberSlots.cardStates.get(belowMember.instanceId)).toEqual(activeFaceUp());
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === belowMember.instanceId &&
          entry.event.fromZone === 'MEMBER_SLOT'
      )
    ).toBe(true);
  });

  it('skips live success when there is no legal below member or no empty member slot', () => {
    const highCostBelow = createCardInstance(
      createMember('PL!-below-high-cost', 'below high', { cost: 3 }),
      PLAYER1,
      'below-high-cost'
    );
    const noLegal = setupKotoriGame({
      memberBelowCards: [highCostBelow],
      pendingAbilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    });
    const noLegalResult = resolvePendingCardEffects(noLegal).gameState;
    expect(
      noLegalResult.actionHistory.some(
        (action) => action.payload.step === 'NO_LOW_COST_MUSE_MEMBER_BELOW'
      )
    ).toBe(true);

    const legalBelow = createCardInstance(
      createMember('PL!-below-legal', 'below legal', { cost: 2 }),
      PLAYER1,
      'below-legal'
    );
    const leftBlocker = createCardInstance(
      createMember('PL!-left-blocker', 'left blocker', { cost: 2 }),
      PLAYER1,
      'left-blocker'
    );
    const rightBlocker = createCardInstance(
      createMember('PL!-right-blocker', 'right blocker', { cost: 2 }),
      PLAYER1,
      'right-blocker'
    );
    let noEmptySlot = setupKotoriGame({
      memberBelowCards: [legalBelow],
      pendingAbilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
    });
    noEmptySlot = registerCards(noEmptySlot, [leftBlocker, rightBlocker]);
    noEmptySlot = updatePlayer(noEmptySlot, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          player.memberSlots,
          SlotPosition.LEFT,
          leftBlocker.instanceId,
          activeFaceUp()
        ),
        SlotPosition.RIGHT,
        rightBlocker.instanceId,
        activeFaceUp()
      ),
    }));
    const noEmptySlotResult = resolvePendingCardEffects(noEmptySlot).gameState;
    expect(
      noEmptySlotResult.actionHistory.some(
        (action) => action.payload.step === 'NO_EMPTY_MEMBER_SLOT'
      )
    ).toBe(true);
  });

  it('drops the continuous LIVE score from 6 to 5 on entry and compares the corrected draft', () => {
    const { session, belowMemberId } = startJudgedKotoriLive({ judgedScore: 6 });
    expect(session.state?.liveResolution.isInLive).toBe(false);
    expectKotoriLiveDraft(session, 6, 1);

    playKotoriMemberBelow(session, belowMemberId);
    expectKotoriLiveDraft(session, 5, 0);
    expect(session.getPlayerViewState(PLAYER2)?.match.liveResult).toMatchObject({
      scores: { FIRST: 5, SECOND: 5 },
      scoreModifiers: { FIRST: 0, SECOND: 0 },
    });

    for (const [playerId, subPhase] of [
      [PLAYER1, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS],
      [PLAYER2, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS],
    ] as const) {
      const result = session.executeCommand(createConfirmStepCommand(playerId, subPhase));
      expect(result.success, result.error).toBe(true);
    }
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);
    for (const playerId of [PLAYER1, PLAYER2]) {
      const result = session.executeCommand(createSubmitScoreCommand(playerId));
      expect(result.success, result.error).toBe(true);
    }
    expect(session.state?.liveResolution.liveWinnerIds).toEqual([PLAYER1, PLAYER2]);
    expect(session.getPlayerViewState(PLAYER2)?.match.liveResult?.winnerSeats).toEqual([
      'FIRST',
      'SECOND',
    ]);
  });

  it('adds the success-zone continuous score on the second member and exposes it during ON_ENTER', () => {
    const { session, belowMemberId } = startJudgedKotoriLive({
      solo: true,
      priorArashi: true,
      judgedScore: 5,
    });
    expectKotoriLiveDraft(session, 5, 0);

    playKotoriMemberBelow(session, belowMemberId);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
      sourceCardId: belowMemberId,
      selectableCardIds: ['deck-top'],
    });
    expectKotoriLiveDraft(session, 6, 1);
    expect(confirmEffect(session, 'deck-top').success).toBe(true);
    const reveal = advancePublicRevealDwell(session);
    expect(reveal.success, reveal.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain('deck-top');
    expectKotoriLiveDraft(session, 6, 1);
  });

  it('preserves an earlier score reward and removes only one bonus from duplicate sources', () => {
    const { session, belowMemberId } = startJudgedKotoriLive({
      priorArashi: true,
      nozomiOnStage: true,
      judgedScore: 7, // 5 printed, 1 continuous, and 1 already included from cheer.
    });
    expectKotoriLiveDraft(session, 7, 1);

    expect(confirmEffect(session, 'left-member').success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID
    );
    if (session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility === true) {
      expect(confirmEffect(session).success).toBe(true);
    }
    const reveal = advancePublicRevealDwell(session);
    expect(reveal.success, reveal.error).toBe(true);
    expectKotoriLiveDraft(session, 8, 2);

    playKotoriMemberBelow(session, belowMemberId);
    expectKotoriLiveDraft(session, 7, 1);
    expect(session.state?.liveResolution.liveModifiers).toEqual([
      expect.objectContaining({
        kind: 'SCORE',
        countDelta: 1,
        abilityId: BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID,
      }),
    ]);
  });

  it('keeps the draft and continuous bonus when Kotori declines to play the below member', () => {
    const { session, belowMemberId } = startJudgedKotoriLive({ judgedScore: 6 });
    expect(confirmEffect(session, null).success).toBe(true);
    expect(session.state?.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      belowMemberId,
    ]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBeNull();
    expectKotoriLiveDraft(session, 6, 1);
  });
});
