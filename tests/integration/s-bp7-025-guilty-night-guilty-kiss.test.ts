import { beforeAll, describe, expect, it } from 'vitest';
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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { registerSBp7025GuiltyNightGuiltyKissWorkflowHandlers } from '../../src/application/card-effects/workflows/cards/s-bp7-025-guilty-night-guilty-kiss';
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
const WAIT_OPTION_ID = 'wait-up-to-two-low-cost-members';
const DRAW_OPTION_ID = 'draw-one-card';

beforeAll(() => {
  registerSBp7025GuiltyNightGuiltyKissWorkflowHandlers({
    enqueueTriggeredCardEffects,
  });
});

function live(cardCode = 'PL!S-bp7-025-L'): LiveCardData {
  return {
    cardCode,
    name: cardCode === 'PL!S-bp7-025-L' ? 'Guilty Night, Guilty Kiss!' : cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
}

function member(cardCode: string, cost: number): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: `${S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID}:test`,
    abilityId: S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success:test'],
  };
}

function setup(
  options: {
    readonly sourceInLiveZone?: boolean;
    readonly deckCount?: number;
    readonly targetOrientations?: readonly OrientationState[];
  } = {}
) {
  const source = createCardInstance(live(), PLAYER1, 'guilty-night-source');
  const targets = [
    createCardInstance(member('TARGET-COST-2', 2), PLAYER2, 'target-cost-2'),
    createCardInstance(member('TARGET-COST-4', 4), PLAYER2, 'target-cost-4'),
    createCardInstance(member('TARGET-COST-5', 5), PLAYER2, 'target-cost-5'),
  ];
  const deck = Array.from({ length: options.deckCount ?? 1 }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`, 1), PLAYER1, `draw-${index}`)
  );
  let game = createGameState('s-bp7-025-guilty-night', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...targets, ...deck]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: options.sourceInLiveZone === false ? [] : [source.instanceId],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.sourceInLiveZone === false ? [source.instanceId] : [],
    },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
  }));
  game = updatePlayer(game, PLAYER2, (player) => {
    const orientations = options.targetOrientations ?? [
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
    ];
    return {
      ...player,
      memberSlots: targets.reduce(
        (slots, card, index) =>
          placeCardInSlot(
            slots,
            [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
            card.instanceId,
            {
              orientation: orientations[index] ?? OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }
          ),
        player.memberSlots
      ),
    };
  });
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    pendingAbilities: [pending(source.instanceId)],
  };
  return {
    game,
    sourceId: source.instanceId,
    targetIds: targets.map((card) => card.instanceId),
    deckIds: deck.map((card) => card.instanceId),
  };
}

function startSession(game: GameState) {
  const started = resolvePendingCardEffects(game).gameState;
  const session = createGameSession();
  session.createGame('s-bp7-025-guilty-night-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return session;
}

function submitChoice(session: ReturnType<typeof createGameSession>, optionIds: readonly string[]) {
  return session.executeCommand(
    createConfirmEffectChoiceCommand(PLAYER1, session.state!.activeEffect!.id, {
      selectedEffectOptionIds: optionIds,
    })
  );
}

function advanceChoice(session: ReturnType<typeof createGameSession>) {
  const effect = session.state!.activeEffect!;
  expect(effect.stepId).toBe(PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID);
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: { ...effect, publicEffectChoiceAutoAdvanceAt: 0 },
  };
  const result = session.executeCommand(
    createAutoAdvancePublicEffectChoiceCommand(PLAYER2, effect.id, 0)
  );
  expect(result.success, result.error).toBe(true);
}

function chooseAndAdvance(session: ReturnType<typeof createGameSession>, optionId: string) {
  const submitted = submitChoice(session, [optionId]);
  expect(submitted.success, submitted.error).toBe(true);
  advanceChoice(session);
}

function submitTargets(
  session: ReturnType<typeof createGameSession>,
  targetIds: readonly string[]
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      targetIds
    )
  );
}

describe('PL!S-bp7-025-L 分数3「Guilty Night, Guilty Kiss!」', () => {
  it('publishes the exact effect choice before executing either branch', () => {
    const scenario = setup();
    const session = startSession(scenario.game);
    expect(session.state?.activeEffect?.effectChoice).toEqual({
      mode: 'SINGLE',
      options: [
        {
          id: WAIT_OPTION_ID,
          text: '将存在于对方的舞台的至多2名费用小于等于4的成员变为待机状态。那些成员在下个回合的活跃阶段不会变为活跃状态。',
          selectable: true,
        },
        { id: DRAW_OPTION_ID, text: '抽1张卡。', selectable: true },
      ],
      minSelections: 1,
      maxSelections: 1,
      publicConfirmation: true,
    });

    const submitted = submitChoice(session, [DRAW_OPTION_ID]);
    expect(submitted.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(scenario.targetIds[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    advanceChoice(session);
    expect(session.state?.players[0].hand.cardIds).toEqual([scenario.deckIds[0]]);
  });

  it('rejects forged, duplicate, and repeated option submissions', () => {
    for (const optionIds of [['forged'], [WAIT_OPTION_ID, WAIT_OPTION_ID]]) {
      const session = startSession(setup().game);
      expect(submitChoice(session, optionIds).success).toBe(false);
      expect(session.state?.activeEffect?.stepId).toBe('S_BP7_025_CHOOSE_LIVE_SUCCESS_EFFECT');
    }

    const session = startSession(setup().game);
    expect(submitChoice(session, [DRAW_OPTION_ID]).success).toBe(true);
    expect(submitChoice(session, [DRAW_OPTION_ID]).success).toBe(false);
  });

  it('draws one and still finishes normally with an empty main deck', () => {
    const draw = setup({ deckCount: 1 });
    const drawSession = startSession(draw.game);
    chooseAndAdvance(drawSession, DRAW_OPTION_ID);
    expect(drawSession.state?.players[0].hand.cardIds).toEqual([draw.deckIds[0]]);
    expect(drawSession.state?.activeEffect).toBeNull();

    const emptySession = startSession(setup({ deckCount: 0 }).game);
    chooseAndAdvance(emptySession, DRAW_OPTION_ID);
    expect(emptySession.state?.players[0].hand.cardIds).toEqual([]);
    expect(emptySession.state?.activeEffect).toBeNull();
    expect(emptySession.state?.pendingAbilities).toEqual([]);
  });

  it('offers only non-WAITING printed-cost-4-or-less opponent members', () => {
    const scenario = setup({
      targetOrientations: [
        OrientationState.ACTIVE,
        OrientationState.WAITING,
        OrientationState.ACTIVE,
      ],
    });
    const session = startSession(scenario.game);
    chooseAndAdvance(session, WAIT_OPTION_ID);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'S_BP7_025_SELECT_WAIT_TARGETS',
      selectableCardIds: [scenario.targetIds[0]],
      minSelectableCards: 0,
      maxSelectableCards: 1,
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
    });
  });

  it('accepts zero, one, or two targets and marks only members actually changed', () => {
    for (const targetCount of [0, 1, 2]) {
      const scenario = setup();
      const session = startSession(scenario.game);
      chooseAndAdvance(session, WAIT_OPTION_ID);
      const selected = scenario.targetIds.slice(0, targetCount);
      const result = submitTargets(session, selected);
      expect(result.success, result.error).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.memberActivePhaseSkips.map((skip) => skip.memberCardId)).toEqual(
        selected
      );
      const stateEvents = session
        .state!.eventLog.map((entry) => entry.event)
        .filter(
          (event) =>
            event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            event.nextOrientation === OrientationState.WAITING
        );
      expect(stateEvents.map((event) => event.cardInstanceId)).toEqual(selected);
      for (const targetId of selected) {
        expect(session.state?.players[1].memberSlots.cardStates.get(targetId)?.orientation).toBe(
          OrientationState.WAITING
        );
      }
    }
  });

  it('keeps the target window on duplicates, forged ids, or a stale opponent target', () => {
    const scenario = setup();
    const session = startSession(scenario.game);
    chooseAndAdvance(session, WAIT_OPTION_ID);
    expect(submitTargets(session, [scenario.targetIds[0]!, scenario.targetIds[0]!]).success).toBe(
      false
    );
    expect(submitTargets(session, ['forged']).success).toBe(false);

    const staleState = updatePlayer(session.state!, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: null },
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = staleState;
    expect(submitTargets(session, [scenario.targetIds[0]!]).success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('S_BP7_025_SELECT_WAIT_TARGETS');
  });

  it('does not consume opponent markers in the controller active phase and consumes them once in the target player active phase', () => {
    const scenario = setup();
    const session = startSession(scenario.game);
    chooseAndAdvance(session, WAIT_OPTION_ID);
    expect(submitTargets(session, scenario.targetIds.slice(0, 2)).success).toBe(true);
    const service = new GameService();

    const controllerActive = service.advancePhase({
      ...session.state!,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(controllerActive.success).toBe(true);
    expect(controllerActive.gameState.memberActivePhaseSkips).toHaveLength(2);

    const targetPlayerActive = service.advancePhase({
      ...controllerActive.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 1,
      firstPlayerIndex: 1,
    });
    expect(targetPlayerActive.success).toBe(true);
    expect(targetPlayerActive.gameState.memberActivePhaseSkips).toEqual([]);
    for (const targetId of scenario.targetIds.slice(0, 2)) {
      expect(
        targetPlayerActive.gameState.players[1].memberSlots.cardStates.get(targetId)?.orientation
      ).toBe(OrientationState.WAITING);
    }

    const followingTargetActive = service.advancePhase({
      ...targetPlayerActive.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 1,
      firstPlayerIndex: 1,
    });
    for (const targetId of scenario.targetIds.slice(0, 2)) {
      expect(
        followingTargetActive.gameState.players[1].memberSlots.cardStates.get(targetId)?.orientation
      ).toBe(OrientationState.ACTIVE);
    }
  });

  it('safely consumes a stale exact source before and after branch publication', () => {
    const staleStart = startSession(setup({ sourceInLiveZone: false }).game);
    expect(staleStart.state?.activeEffect).toBeNull();
    expect(staleStart.state?.pendingAbilities).toEqual([]);

    const scenario = setup();
    const session = startSession(scenario.game);
    expect(submitChoice(session, [WAIT_OPTION_ID]).success).toBe(true);
    const published = session.state!.activeEffect!;
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      {
        ...session.state!,
        activeEffect: { ...published, publicEffectChoiceAutoAdvanceAt: 0 },
      },
      PLAYER1,
      (player) => ({
        ...player,
        liveZone: { ...player.liveZone, cardIds: [] },
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [...player.waitingRoom.cardIds, scenario.sourceId],
        },
      })
    );
    const advanced = session.executeCommand(
      createAutoAdvancePublicEffectChoiceCommand(PLAYER1, published.id, 0)
    );
    expect(advanced.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.memberActivePhaseSkips).toEqual([]);
  });
});
