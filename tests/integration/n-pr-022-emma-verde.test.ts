import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createConfirmJudgmentAction,
  createConfirmSubPhaseAction,
  createPlayMemberAction,
} from '../../src/application/actions';
import {
  createConfirmStepCommand,
  createEndPhaseCommand,
  createFinishInspectionCommand,
  createMoveInspectedCardToZoneCommand,
  createOpenInspectionCommand,
  createPlayMemberToSlotCommand,
  createSetLiveCardCommand,
  createSubmitJudgmentCommand,
  createSubmitScoreCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { N_PR_022_ON_ENTER_PREVIOUS_OPPONENT_LIVE_FAILED_ASK_EMMA_PUNCH_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { GameService } from '../../src/application/game-service';
import { buildSolitaireOpponentEffectCommand } from '../../src/application/solitaire-effect-automation';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createLiveStartEvent,
  createLiveSuccessEvent,
  createTurnEndEvent,
  createTurnStartEvent,
} from '../../src/domain/events/game-events';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
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
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID = N_PR_022_ON_ENTER_PREVIOUS_OPPONENT_LIVE_FAILED_ASK_EMMA_PUNCH_BLADE_ABILITY_ID;
const EFFECT_TEXT =
  '【登场】上一个对方的回合中对方进行了LIVE，且LIVE没有成功的场合，可以询问对手是否要被艾玛拳打。\n\n回答是拜托了的场合，自己对对方使用艾玛拳。LIVE结束时为止，存在于对方舞台的所有成员，获得[ブレード]。\n\n回答是其他的场合，什么都不做。\n\n（以温柔为心、以爱意为名，施出不伤他人的魔法重拳。）';

function member(
  cardCode: string,
  ownerId: string,
  instanceId: string
): ReturnType<typeof createCardInstance> {
  const data: MemberCardData = {
    cardCode,
    name: cardCode === 'PL!N-PR-022-PR' ? '艾玛·维尔德' : instanceId,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: cardCode === 'PL!N-PR-022-PR' ? 2 : 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
  return createCardInstance(data, ownerId, instanceId);
}

function live(
  cardCode: string,
  ownerId: string,
  instanceId: string
): ReturnType<typeof createCardInstance> {
  const data: LiveCardData = {
    cardCode,
    name: instanceId,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 99 }),
  };
  return createCardInstance(data, ownerId, instanceId);
}

function energy(cardCode: string, ownerId: string, instanceId: string): CardInstance {
  const data: EnergyCardData = {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, ownerId, instanceId);
}

function pending(sourceCardId: string, id = 'pending:n-pr-022'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-source'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: { readonly liveStarted?: boolean; readonly liveSucceeded?: boolean } = {}) {
  const source = member('PL!N-PR-022-PR', P1, 'emma-source');
  const targets = [
    member('TARGET-L', P2, 'target-left'),
    member('TARGET-C', P2, 'target-center'),
    member('TARGET-R', P2, 'target-right'),
  ];
  const memberBelow = member('TARGET-BELOW', P2, 'target-below');
  const departed = member('TARGET-DEPARTED', P2, 'target-departed');
  let game = registerCards(createGameState('n-pr-022', P1, 'P1', P2, 'P2'), [
    source,
    ...targets,
    memberBelow,
    departed,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: [source.instanceId] },
  }));
  game = updatePlayer(game, P2, (player) => {
    let memberSlots = placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, targets[0]!.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.CENTER,
        targets[1]!.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      SlotPosition.RIGHT,
      targets[2]!.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, memberBelow.instanceId);
    return { ...player, memberSlots };
  });

  game = emitGameEvent(game, createTurnStartEvent(1, P1));
  if (options.liveStarted !== false) {
    game = emitGameEvent(game, createLiveStartEvent(P2, ['opponent-live']));
  }
  if (options.liveSucceeded === true) {
    game = emitGameEvent(game, createLiveSuccessEvent(P2, ['opponent-live'], 3));
  }
  game = emitGameEvent(game, createTurnEndEvent(1, P1));
  game = emitGameEvent(game, createTurnStartEvent(2, P1));
  game = { ...game, pendingAbilities: [pending(source.instanceId)] };

  return {
    game,
    sourceId: source.instanceId,
    targetIds: targets.map((card) => card.instanceId),
    memberBelowId: memberBelow.instanceId,
    departedId: departed.instanceId,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function selectPublicChoice(game: GameState, playerId: string, optionId: string): GameState {
  return confirmActiveEffectStep(
    game,
    playerId,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [optionId]
  );
}

function choosePublic(game: GameState, playerId: string, optionId: string): GameState {
  return continuePublicEffectChoiceForTest(selectPublicChoice(game, playerId, optionId), playerId);
}

describe('PL!N-PR-022-PR 费用2「艾玛·维尔德」', () => {
  it('opens through the real ON_ENTER path after the second player failed LIVE in the previous shared turn', () => {
    const source = member('PL!N-PR-022-PR', P1, 'emma-real-enter');
    const opponentLive = live('OPPONENT-LIVE-L', P2, 'opponent-failed-live');
    const service = new GameService();
    let game = registerCards(createGameState('n-pr-022-real-enter', P1, 'P1', P2, 'P2'), [
      source,
      opponentLive,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [source.instanceId] },
    }));
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_DOWN,
      }),
    }));
    game = emitGameEvent(game, createTurnStartEvent(1, P1));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: game.firstPlayerIndex,
      liveSetCompletedPlayers: [P1, P2],
      turnCount: 1,
    };

    const performance = service.advancePhase(game);
    expect(performance.success).toBe(true);
    expect(performance.gameState).toMatchObject({
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
      currentTurnType: TurnType.SECOND_PLAYER_TURN,
    });
    expect(
      performance.gameState.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_LIVE_START &&
          'performerId' in event &&
          event.performerId === P2
      )
    ).toBe(true);

    const judgment = service.processAction(
      performance.gameState,
      createConfirmSubPhaseAction(P2, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(judgment.success).toBe(true);

    const failed = service.processAction(
      judgment.gameState,
      createConfirmJudgmentAction(P2, new Map([[opponentLive.instanceId, false]]))
    );
    expect(failed.success).toBe(true);

    const liveResult = service.processAction(
      failed.gameState,
      createConfirmSubPhaseAction(P2, SubPhase.PERFORMANCE_JUDGMENT)
    );
    expect(liveResult.success).toBe(true);
    expect(liveResult.gameState.currentPhase).toBe(GamePhase.LIVE_RESULT_PHASE);

    const nextTurn = service.advancePhase(liveResult.gameState);
    expect(nextTurn.success).toBe(true);

    const mainPhase = {
      ...nextTurn.gameState,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: nextTurn.gameState.firstPlayerIndex,
    };
    const played = service.processAction(
      mainPhase,
      createPlayMemberAction(P1, source.instanceId, SlotPosition.CENTER)
    );

    expect(played.success).toBe(true);
    expect(played.gameState.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      sourceCardId: source.instanceId,
      stepId: 'N_PR_022_CHOOSE_WHETHER_TO_ASK',
      awaitingPlayerId: P1,
    });
  });

  it('opens after the exact rules-mode session flow: first player skips LIVE, second player fails, both confirm score, then entry cost is paid', () => {
    const source = member('PL!N-PR-022-PR', P1, 'emma-session-enter');
    const opponentLive = live('OPPONENT-LIVE-L', P2, 'opponent-session-failed-live');
    const energyCards = [
      energy('ENERGY-1', P1, 'emma-session-energy-1'),
      energy('ENERGY-2', P1, 'emma-session-energy-2'),
    ];
    let game = registerCards(createGameState('n-pr-022-session-enter', P1, 'P1', P2, 'P2'), [
      source,
      opponentLive,
      ...energyCards,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [source.instanceId] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCards.map((card) => card.instanceId),
        cardStates: new Map(
          energyCards.map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    }));
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_DOWN,
      }),
    }));
    game = emitGameEvent(game, createTurnStartEvent(1, P1));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      currentTurnType: TurnType.SECOND_PLAYER_TURN,
      activePlayerIndex: game.firstPlayerIndex === 0 ? 1 : 0,
      liveSetCompletedPlayers: [P1],
      turnCount: 1,
    };

    const session = createGameSession({ allowRulesModeSuccessLiveSkip: true });
    session.createGame(game.gameId, P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;

    const liveSetDone = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(liveSetDone.success, liveSetDone.error).toBe(true);
    expect(session.state).toMatchObject({
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    });

    const liveStartDone = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(liveStartDone.success, liveStartDone.error).toBe(true);

    const failed = session.executeCommand(
      createSubmitJudgmentCommand(P2, new Map(session.state!.liveResolution.liveResults))
    );
    expect(failed.success, failed.error).toBe(true);

    const judgmentDone = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.PERFORMANCE_JUDGMENT)
    );
    expect(judgmentDone.success, judgmentDone.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);

    const secondScore = session.executeCommand(createSubmitScoreCommand(P2, 0));
    expect(secondScore.success, secondScore.error).toBe(true);
    const firstScore = session.executeCommand(createSubmitScoreCommand(P1, 0));
    expect(firstScore.success, firstScore.error).toBe(true);
    expect(session.state).toMatchObject({
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      turnCount: 2,
    });

    const played = session.executeCommand(
      createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER)
    );
    expect(played.success, played.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      sourceCardId: source.instanceId,
      stepId: 'N_PR_022_CHOOSE_WHETHER_TO_ASK',
      awaitingPlayerId: P1,
    });
  });

  it('still opens when Emma was moved from the main deck to hand through free-mode inspection before the real rules flow', () => {
    const source = member('PL!N-PR-022-PR', P1, 'emma-inspected-enter');
    const opponentLive = live('OPPONENT-LIVE-L', P2, 'opponent-inspected-failed-live');
    const energyCards = [
      energy('ENERGY-1', P1, 'emma-inspected-energy-1'),
      energy('ENERGY-2', P1, 'emma-inspected-energy-2'),
    ];
    let game = registerCards(createGameState('n-pr-022-inspected-enter', P1, 'P1', P2, 'P2'), [
      source,
      opponentLive,
      ...energyCards,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [source.instanceId] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCards.map((card) => card.instanceId),
        cardStates: new Map(
          energyCards.map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    }));
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [opponentLive.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: game.firstPlayerIndex,
      manualOperationMode: 'FREE',
      turnCount: 1,
    };

    const session = createGameSession({ allowRulesModeSuccessLiveSkip: true });
    session.createGame(game.gameId, P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;

    const opened = session.executeCommand(createOpenInspectionCommand(P1, ZoneType.MAIN_DECK, 1));
    expect(opened.success, opened.error).toBe(true);
    const moved = session.executeCommand(
      createMoveInspectedCardToZoneCommand(P1, source.instanceId, ZoneType.HAND)
    );
    expect(moved.success, moved.error).toBe(true);
    const finished = session.executeCommand(createFinishInspectionCommand(P1));
    expect(finished.success, finished.error).toBe(true);
    expect(session.setManualOperationMode('RULES').success).toBe(true);

    const firstMainDone = session.executeCommand(createEndPhaseCommand(P1));
    expect(firstMainDone.success, firstMainDone.error).toBe(true);
    expect(session.state).toMatchObject({
      currentPhase: GamePhase.MAIN_PHASE,
      currentTurnType: TurnType.SECOND_PLAYER_TURN,
    });
    const secondMainDone = session.executeCommand(createEndPhaseCommand(P2));
    expect(secondMainDone.success, secondMainDone.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.LIVE_SET_FIRST_PLAYER);

    const firstLiveSetDone = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(firstLiveSetDone.success, firstLiveSetDone.error).toBe(true);
    const liveSet = session.executeCommand(
      createSetLiveCardCommand(P2, opponentLive.instanceId, true)
    );
    expect(liveSet.success, liveSet.error).toBe(true);
    const secondLiveSetDone = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(secondLiveSetDone.success, secondLiveSetDone.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);

    const liveStartDone = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(liveStartDone.success, liveStartDone.error).toBe(true);
    const failed = session.executeCommand(
      createSubmitJudgmentCommand(P2, new Map(session.state!.liveResolution.liveResults))
    );
    expect(failed.success, failed.error).toBe(true);
    const judgmentDone = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.PERFORMANCE_JUDGMENT)
    );
    expect(judgmentDone.success, judgmentDone.error).toBe(true);

    expect(session.executeCommand(createSubmitScoreCommand(P2, 0)).success).toBe(true);
    expect(session.executeCommand(createSubmitScoreCommand(P1, 0)).success).toBe(true);
    const played = session.executeCommand(
      createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER)
    );
    expect(played.success, played.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      sourceCardId: source.instanceId,
      stepId: 'N_PR_022_CHOOSE_WHETHER_TO_ASK',
      awaitingPlayerId: P1,
    });
  });

  it('uses public fixed choices and applies BLADE +1 to every current opponent top-level member', () => {
    const scenario = setup();
    const question = start(scenario.game);
    expect(question.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      stepId: 'N_PR_022_CHOOSE_WHETHER_TO_ASK',
      effectText: EFFECT_TEXT,
      stepText: '可以询问对手是否要被艾玛拳打。',
      awaitingPlayerId: P1,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'ask-opponent', text: '询问对手' },
          { id: 'do-not-ask', text: '不询问' },
        ],
        publicConfirmation: true,
      },
      selectionLabel: '选择是否询问对手',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
    });
    expect(question.activeEffect?.selectableOptions).toBeUndefined();
    expect(question.activeEffect?.selectableCardIds).toBeUndefined();
    expect(question.activeEffect?.numericInput).toBeUndefined();

    const askingPublicly = selectPublicChoice(question, P1, 'ask-opponent');
    expect(askingPublicly.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      effectChoice: { selectedOptionIds: ['ask-opponent'] },
    });
    const answering = continuePublicEffectChoiceForTest(askingPublicly, P1);
    expect(answering.activeEffect).toMatchObject({
      stepId: 'N_PR_022_OPPONENT_ANSWER',
      awaitingPlayerId: P2,
      effectChoice: {
        options: [
          { id: 'please', text: '拜托了' },
          { id: 'other-answer', text: '其他回答' },
        ],
        publicConfirmation: true,
      },
      selectionLabel: '选择回答',
      canSkipSelection: false,
      metadata: {
        solitaireOpponentEffectChoiceOptionId: 'please',
      },
    });
    expect(answering.activeEffect?.selectableOptions).toBeUndefined();
    expect(buildSolitaireOpponentEffectCommand(answering, P2, 1_000)).toMatchObject({
      playerId: P2,
      effectId: answering.activeEffect?.id,
      selectedOptionId: 'please',
    });

    const punch = choosePublic(answering, P2, 'please');
    expect(punch.activeEffect).toMatchObject({
      stepId: 'N_PR_022_CONFIRM_EMMA_PUNCH',
      awaitingPlayerId: P1,
      effectChoice: {
        options: [{ id: 'emma-punch', text: '使用艾玛拳' }],
        publicConfirmation: true,
      },
      selectionLabel: '使用艾玛拳',
    });
    expect(punch.activeEffect?.selectableOptions).toBeUndefined();

    const done = choosePublic(punch, P1, 'emma-punch');
    expect(done.activeEffect).toBeNull();
    for (const targetId of scenario.targetIds) {
      expect(getMemberEffectiveBladeCount(done, P2, targetId)).toBe(2);
    }
    expect(getMemberEffectiveBladeCount(done, P2, scenario.memberBelowId)).toBe(1);
    expect(getMemberEffectiveBladeCount(done, P2, scenario.departedId)).toBe(1);
    expect(
      done.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === ABILITY_ID
      )
    ).toMatchObject(
      scenario.targetIds.map((targetMemberCardId) => ({
        target: 'TARGET_MEMBER',
        playerId: P2,
        sourceCardId: scenario.sourceId,
        targetMemberCardId,
        countDelta: 1,
      }))
    );
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'USE_EMMA_PUNCH_GAIN_BLADE',
      opponentAnswer: '拜托了',
      targetMemberCardIds: scenario.targetIds,
      appliedTargetMemberCardIds: scenario.targetIds,
      bladeBonusPerMember: 1,
    });
  });

  it('lets the controller decline the question and lets the opponent use the fixed other-answer branch', () => {
    const decliningPublicly = selectPublicChoice(start(setup().game), P1, 'do-not-ask');
    expect(decliningPublicly.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      effectChoice: { selectedOptionIds: ['do-not-ask'] },
    });
    const declined = continuePublicEffectChoiceForTest(decliningPublicly, P1);
    expect(declined.activeEffect).toBeNull();
    expect(declined.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DECLINED_TO_ASK',
      appliedTargetMemberCardIds: [],
    });

    const answering = choosePublic(start(setup().game), P1, 'ask-opponent');
    const otherPublicly = selectPublicChoice(answering, P2, 'other-answer');
    expect(otherPublicly.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      effectChoice: { selectedOptionIds: ['other-answer'] },
    });
    const other = continuePublicEffectChoiceForTest(otherPublicly, P2);
    expect(other.activeEffect).toBeNull();
    expect(other.liveResolution.liveModifiers).toEqual([]);
    expect(other.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'OPPONENT_OTHER_ANSWER',
      opponentAnswer: '其他回答',
      appliedTargetMemberCardIds: [],
    });
  });

  it('snapshots opponent stage members only when the Emma punch is resolved', () => {
    const scenario = setup();
    const answering = choosePublic(start(scenario.game), P1, 'ask-opponent');
    const punch = choosePublic(answering, P2, 'please');
    const changedStage = updatePlayer(punch, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        SlotPosition.LEFT,
        scenario.departedId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));

    const done = choosePublic(changedStage, P1, 'emma-punch');
    expect(getMemberEffectiveBladeCount(done, P2, scenario.targetIds[0]!)).toBe(1);
    expect(getMemberEffectiveBladeCount(done, P2, scenario.departedId)).toBe(2);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      targetMemberCardIds: [scenario.departedId, scenario.targetIds[1], scenario.targetIds[2]],
      appliedTargetMemberCardIds: [
        scenario.departedId,
        scenario.targetIds[1],
        scenario.targetIds[2],
      ],
    });
  });

  it('does not open when the previous opponent turn had no LIVE or had a successful LIVE', () => {
    for (const game of [setup({ liveStarted: false }).game, setup({ liveSucceeded: true }).game]) {
      const done = start(game);
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.actionHistory.at(-1)?.payload).toMatchObject({
        step: 'PREVIOUS_OPPONENT_LIVE_FAILED_CONDITION_NOT_MET',
      });
    }
  });

  it('keeps the triggered interaction source-independent and rejects wrong players or invalid options', () => {
    const question = start(setup().game);
    expect(confirmActiveEffectStep(question, P2, question.activeEffect!.id)).toBe(question);
    expect(confirmActiveEffectStep(question, P1, question.activeEffect!.id, null)).toBe(question);
    expect(selectPublicChoice(question, P1, 'not-an-option')).toBe(question);

    const answering = choosePublic(question, P1, 'ask-opponent');
    expect(selectPublicChoice(answering, P1, 'please')).toBe(answering);
    expect(selectPublicChoice(answering, P2, 'not-an-answer')).toBe(answering);
  });

  it('preserves ordered continuation across all three public choices', () => {
    const scenario = setup();
    const first = scenario.game.pendingAbilities[0]!;
    const withTwoPending = {
      ...scenario.game,
      pendingAbilities: [first, { ...first, id: 'pending:n-pr-022:second' }],
    };
    const ordering = start(withTwoPending);
    expect(ordering.activeEffect?.canResolveInOrder).toBe(true);
    const question = confirmActiveEffectStep(
      ordering,
      P1,
      ordering.activeEffect!.id,
      null,
      null,
      true
    );
    const answering = choosePublic(question, P1, 'ask-opponent');
    const punch = choosePublic(answering, P2, 'please');
    const continued = choosePublic(punch, P1, 'emma-punch');
    expect(continued.activeEffect?.id).toBe('pending:n-pr-022:second');
    expect(continued.activeEffect?.metadata?.orderedResolution).toBe(true);
  });
});
