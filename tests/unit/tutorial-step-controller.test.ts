import { describe, expect, it } from 'vitest';
import { GameCommandType, type GameCommand } from '../../src/application/game-commands';
import type { PlayerViewState, ViewZoneKey } from '../../src/online';
import {
  GamePhase,
  GameMode,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  continueTutorialInformationStep,
  createTutorialProgress,
  evaluateTutorialCommandPermission,
  reduceTutorialProgress,
  resolveTutorialReviewPresentation,
  resolveTutorialStepPresentation,
  validateTutorialScenarioDefinition,
  type TutorialObjectBindings,
  type TutorialScenarioDefinition,
  type TutorialStepDefinition,
} from '../../client/src/lib/tutorialScenario';
import { BATTLE_UI_ANCHORS } from '../../client/src/lib/battleUiAnchors';
import {
  BASIC_LIVE_TUTORIAL,
  BASIC_LIVE_TUTORIAL_OBJECT_ROLES,
} from '../../client/src/tutorial/basicLiveTutorial';

const PLAYER_ID = 'tutorial-player';
const MEMBER_ID = 'member-card-id';
const LIVE_ID = 'live-card-id';
const MULLIGAN_ID = 'mulligan-card-id';

const BINDINGS: TutorialObjectBindings = {
  [BASIC_LIVE_TUTORIAL_OBJECT_ROLES.MEMBER_CARD]: `obj_${MEMBER_ID}`,
  [BASIC_LIVE_TUTORIAL_OBJECT_ROLES.LIVE_CARD]: `obj_${LIVE_ID}`,
  [BASIC_LIVE_TUTORIAL_OBJECT_ROLES.MULLIGAN_CARD]: `obj_${MULLIGAN_ID}`,
};

function command<T extends GameCommand>(value: T): T {
  return value;
}

function createView(options: {
  readonly seq: number;
  readonly phase?: GamePhase;
  readonly subPhase?: SubPhase;
  readonly availableCommands?: readonly GameCommandType[];
  readonly zones?: Readonly<Record<ViewZoneKey, readonly string[]>>;
  readonly confirmedSeats?: readonly ('FIRST' | 'SECOND')[];
}): PlayerViewState {
  const zones = Object.fromEntries(
    Object.entries(options.zones ?? {}).map(([zoneKey, objectIds]) => {
      const memberSlot = zoneKey.match(/_MEMBER_(LEFT|CENTER|RIGHT)$/)?.[1];
      return [
        zoneKey,
        memberSlot
          ? {
              zone: ZoneType.MEMBER_SLOT,
              count: objectIds.length,
              ordered: false,
              slotMap: { [memberSlot]: objectIds[0] ?? null },
            }
          : {
              zone: zoneKey,
              count: objectIds.length,
              ordered: true,
              objectIds,
            },
      ];
    })
  );
  return {
    match: {
      matchId: 'tutorial-match',
      viewerSeat: 'FIRST',
      participants: {
        FIRST: { id: PLAYER_ID, name: 'Player' },
        SECOND: { id: 'tutorial-opponent', name: 'Opponent' },
      },
      turnCount: 1,
      phase: options.phase ?? GamePhase.MAIN_PHASE,
      subPhase: options.subPhase ?? SubPhase.NONE,
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
      window: null,
      liveResult:
        options.confirmedSeats !== undefined
          ? {
              scores: { FIRST: 1, SECOND: 0 },
              scoreModifiers: { FIRST: 0, SECOND: 0 },
              heartBonuses: { FIRST: [], SECOND: [] },
              cheerHeartColorReplacements: { FIRST: null, SECOND: null },
              requirementReductions: {},
              requirementModifiers: {},
              liveCardScoreModifiers: {},
              winnerSeats: ['FIRST'],
              confirmedSeats: options.confirmedSeats,
              successLiveSelection: null,
            }
          : undefined,
      endInfo: null,
      manualOperation: {
        mode: 'RULES',
        canSwitchNow: false,
        disabledReason: null,
        pendingRequest: null,
      },
      seq: options.seq,
    },
    table: { zones },
    objects: {},
    permissions: {
      availableCommands: (options.availableCommands ?? []).map((commandType) => ({
        command: commandType,
        enabled: true,
      })),
    },
    uiHints: { gameMode: GameMode.DEBUG },
  };
}

function actionStep(stepId: string): TutorialStepDefinition {
  const step = BASIC_LIVE_TUTORIAL.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`missing tutorial step ${stepId}`);
  return step;
}

function oneStepScenario(step: TutorialStepDefinition): TutorialScenarioDefinition {
  return {
    id: 'test-scenario',
    version: '1',
    contentVersion: 1,
    objectRoles: Object.values(BASIC_LIVE_TUTORIAL_OBJECT_ROLES),
    steps: [step],
  };
}

describe('basic LIVE tutorial public definition', () => {
  it('is valid and includes every Loveca-specific confirmation action', () => {
    expect(validateTutorialScenarioDefinition(BASIC_LIVE_TUTORIAL)).toEqual([]);

    const actionStepIds = BASIC_LIVE_TUTORIAL.steps
      .filter((step) => step.kind === 'ACTION')
      .map((step) => step.id);
    expect(actionStepIds).toEqual(
      expect.arrayContaining([
        'mulligan-card',
        'play-member',
        'end-main-phase',
        'set-live-card',
        'confirm-live-set',
        'accept-automatic-judgment',
        'confirm-score',
        'confirm-result-animation',
        'select-success-live',
        'confirm-settlement',
        'relay-to-center',
        'resolve-relay-discard',
        'set-effect-live',
        'resolve-live-start-discard',
        'play-recovery-member',
        'activate-recovery-member',
        'recover-original-member',
        'set-final-live-one',
        'set-final-live-two',
        'accept-final-automatic-judgment',
        'confirm-final-score',
        'confirm-final-result-animation',
        'select-final-success-live',
      ])
    );
  });

  it('does not publish card codes, deck order, random decisions, or opponent private data', () => {
    const serialized = JSON.stringify(BASIC_LIVE_TUTORIAL).toLowerCase();
    expect(serialized).not.toContain('cardcode');
    expect(serialized).not.toContain('deckorder');
    expect(serialized).not.toContain('randomdecision');
    expect(serialized).not.toContain('opponenthand');
  });

  it('uses mascot stickers only at sparse information beats', () => {
    const mascotSteps = BASIC_LIVE_TUTORIAL.steps.filter((step) => step.mascot);

    expect(mascotSteps.every((step) => step.kind === 'INFO')).toBe(true);
    expect(mascotSteps.map((step) => step.id)).toEqual([
      'welcome',
      'judgment-card-source',
      'advanced-welcome',
      'read-on-enter-effect',
      'read-recovery-member',
      'recovery-energy-window',
      'final-chapter-welcome',
      'compare-final-live-options',
      'read-final-judgment',
      'complete',
    ]);
  });

  it('rejects unknown object roles before a scenario can start', () => {
    const invalidScenario: TutorialScenarioDefinition = {
      ...BASIC_LIVE_TUTORIAL,
      steps: [
        {
          id: 'invalid-role',
          contentVersion: 1,
          kind: 'INFO',
          chapter: 'Test',
          title: 'Test',
          body: 'Test',
          target: { kind: 'OBJECT_ROLE', role: 'server-private-card' },
          completion: { kind: 'INFO_CONTINUE' },
        },
      ],
    };

    expect(validateTutorialScenarioDefinition(invalidScenario)).toContain(
      'steps[0](invalid-role) 引用了未声明对象角色 server-private-card'
    );
  });
});

describe('same-match advanced tutorial actions', () => {
  it('limits the relay action to the tutorial member and center slot', () => {
    const relayStep = actionStep('relay-to-center');
    const bindings = {
      [BASIC_LIVE_TUTORIAL_OBJECT_ROLES.RELAY_MEMBER]: 'obj_relay',
    };
    const relayToCenter = command({
      type: GameCommandType.PLAY_MEMBER_TO_SLOT,
      playerId: PLAYER_ID,
      cardId: 'relay',
      targetSlot: SlotPosition.CENTER,
      timestamp: 1,
    });
    const relayToLeft = command({
      ...relayToCenter,
      targetSlot: SlotPosition.LEFT,
    });

    expect(evaluateTutorialCommandPermission(relayStep, relayToCenter, bindings).allowed).toBe(
      true
    );
    expect(evaluateTutorialCommandPermission(relayStep, relayToLeft, bindings).allowed).toBe(false);
  });
});

describe('tutorial command permission model', () => {
  it('allows only the specified non-empty mulligan set', () => {
    const step = actionStep('mulligan-card');
    const expected = command({
      type: GameCommandType.MULLIGAN,
      playerId: PLAYER_ID,
      timestamp: 1,
      cardIdsToMulligan: [MULLIGAN_ID],
    });
    const empty = command({
      type: GameCommandType.MULLIGAN,
      playerId: PLAYER_ID,
      timestamp: 1,
      cardIdsToMulligan: [],
    });

    expect(evaluateTutorialCommandPermission(step, expected, BINDINGS).allowed).toBe(true);
    expect(evaluateTutorialCommandPermission(step, empty, BINDINGS)).toMatchObject({
      allowed: false,
    });
  });

  it('checks the member identity and target slot for drag, click, and keyboard-equivalent commands', () => {
    const step = actionStep('play-member');
    const expected = command({
      type: GameCommandType.PLAY_MEMBER_TO_SLOT,
      playerId: PLAYER_ID,
      timestamp: 1,
      cardId: MEMBER_ID,
      targetSlot: SlotPosition.CENTER,
    });
    const wrongSlot = command({ ...expected, targetSlot: SlotPosition.LEFT });
    const wrongCard = command({ ...expected, cardId: 'another-card' });

    expect(evaluateTutorialCommandPermission(step, expected, BINDINGS).allowed).toBe(true);
    expect(evaluateTutorialCommandPermission(step, wrongSlot, BINDINGS).allowed).toBe(false);
    expect(evaluateTutorialCommandPermission(step, wrongCard, BINDINGS).allowed).toBe(false);
  });

  it('permits automatic judgment acceptance but rejects a manual result map', () => {
    const step = actionStep('accept-automatic-judgment');
    const automatic = command({
      type: GameCommandType.SUBMIT_JUDGMENT,
      playerId: PLAYER_ID,
      timestamp: 1,
      judgmentResults: new Map<string, boolean>(),
    });
    const manual = command({
      ...automatic,
      judgmentResults: new Map([['some-live', false]]),
    });

    expect(evaluateTutorialCommandPermission(step, automatic, BINDINGS).allowed).toBe(true);
    expect(evaluateTutorialCommandPermission(step, manual, BINDINGS).allowed).toBe(false);
  });

  it('permits the shared judgment follow-up command but distinguishes other confirm subphases', () => {
    const step = actionStep('accept-automatic-judgment');
    const followUp = command({
      type: GameCommandType.CONFIRM_STEP,
      playerId: PLAYER_ID,
      timestamp: 1,
      subPhase: SubPhase.PERFORMANCE_JUDGMENT,
    });
    const resultAnimation = command({
      ...followUp,
      subPhase: SubPhase.RESULT_ANIMATION,
    });

    expect(evaluateTutorialCommandPermission(step, followUp, BINDINGS).allowed).toBe(true);
    expect(evaluateTutorialCommandPermission(step, resultAnimation, BINDINGS).allowed).toBe(false);
  });

  it('accepts the computed score and rejects tutorial score adjustment', () => {
    const step = actionStep('confirm-score');
    const computed = command({
      type: GameCommandType.SUBMIT_SCORE,
      playerId: PLAYER_ID,
      timestamp: 1,
    });
    const adjusted = command({ ...computed, adjustedScore: 99 });

    expect(evaluateTutorialCommandPermission(step, computed, BINDINGS).allowed).toBe(true);
    expect(evaluateTutorialCommandPermission(step, adjusted, BINDINGS).allowed).toBe(false);
  });
});

describe('tutorial progress waterline and authority evidence', () => {
  it('observes a face-down opponent LIVE by projected zone count without binding its identity', () => {
    const scenario = oneStepScenario(actionStep('opponent-second-live-set'));
    const progress = createTutorialProgress(scenario, 20);
    const hiddenLiveView = createView({
      seq: 21,
      phase: GamePhase.LIVE_SET_PHASE,
      subPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      zones: { SECOND_LIVE_ZONE: ['obj_hidden-opponent-live'] },
    });

    const next = reduceTutorialProgress(scenario, progress, {
      playerViewState: hiddenLiveView,
      objectBindings: {},
      nowMs: 1_000,
    });

    expect(next.viewConditionSatisfiedAtMs).toBe(1_000);
    expect(next.currentStepIndex).toBe(0);
  });

  it('does not complete an action using a command accepted at or before the step waterline', () => {
    const scenario = oneStepScenario(actionStep('play-member'));
    const progress = createTutorialProgress(scenario, 20);
    const acceptedCommand = command({
      type: GameCommandType.PLAY_MEMBER_TO_SLOT,
      playerId: PLAYER_ID,
      timestamp: 1,
      cardId: MEMBER_ID,
      targetSlot: SlotPosition.CENTER,
    });
    const view = createView({
      seq: 20,
      zones: { FIRST_MEMBER_CENTER: [`obj_${MEMBER_ID}`] },
    });

    expect(
      reduceTutorialProgress(scenario, progress, {
        playerViewState: view,
        objectBindings: BINDINGS,
        acceptedCommands: [{ actorSeat: 'FIRST', resultingSeq: 20, command: acceptedCommand }],
      })
    ).toEqual(progress);
  });

  it('requires the viewer command, a newer revision, and the projected post-condition', () => {
    const scenario = oneStepScenario(actionStep('play-member'));
    const progress = createTutorialProgress(scenario, 20);
    const acceptedCommand = command({
      type: GameCommandType.PLAY_MEMBER_TO_SLOT,
      playerId: PLAYER_ID,
      timestamp: 1,
      cardId: MEMBER_ID,
      targetSlot: SlotPosition.CENTER,
    });
    const viewWithoutMember = createView({ seq: 21 });
    const viewWithMember = createView({
      seq: 21,
      zones: { FIRST_MEMBER_CENTER: [`obj_${MEMBER_ID}`] },
    });

    expect(
      reduceTutorialProgress(scenario, progress, {
        playerViewState: viewWithoutMember,
        objectBindings: BINDINGS,
        acceptedCommands: [{ actorSeat: 'FIRST', resultingSeq: 21, command: acceptedCommand }],
      }).status
    ).toBe('ACTIVE');
    expect(
      reduceTutorialProgress(scenario, progress, {
        playerViewState: viewWithMember,
        objectBindings: BINDINGS,
        acceptedCommands: [{ actorSeat: 'SECOND', resultingSeq: 21, command: acceptedCommand }],
      }).status
    ).toBe('ACTIVE');
    expect(
      reduceTutorialProgress(scenario, progress, {
        playerViewState: viewWithMember,
        objectBindings: BINDINGS,
        acceptedCommands: [{ actorSeat: 'FIRST', resultingSeq: 21, command: acceptedCommand }],
      }).status
    ).toBe('COMPLETED');
  });

  it('completes score confirmation only after the viewer appears in confirmedSeats', () => {
    const scenario = oneStepScenario(actionStep('confirm-score'));
    const progress = createTutorialProgress(scenario, 30);
    const acceptedCommand = command({
      type: GameCommandType.SUBMIT_SCORE,
      playerId: PLAYER_ID,
      timestamp: 1,
    });

    const pending = reduceTutorialProgress(scenario, progress, {
      playerViewState: createView({ seq: 31, confirmedSeats: [] }),
      objectBindings: BINDINGS,
      acceptedCommands: [{ actorSeat: 'FIRST', resultingSeq: 31, command: acceptedCommand }],
    });
    const completed = reduceTutorialProgress(scenario, progress, {
      playerViewState: createView({ seq: 31, confirmedSeats: ['FIRST'] }),
      objectBindings: BINDINGS,
      acceptedCommands: [{ actorSeat: 'FIRST', resultingSeq: 31, command: acceptedCommand }],
    });

    expect(pending.status).toBe('ACTIVE');
    expect(completed.status).toBe('COMPLETED');
  });

  it('finds automatic judgment evidence inside a multi-command shared interaction', () => {
    const scenario = oneStepScenario(actionStep('accept-automatic-judgment'));
    const progress = createTutorialProgress(scenario, 50);
    const submitJudgment = command({
      type: GameCommandType.SUBMIT_JUDGMENT,
      playerId: PLAYER_ID,
      timestamp: 1,
      judgmentResults: new Map<string, boolean>(),
    });
    const confirmSubPhase = command({
      type: GameCommandType.CONFIRM_STEP,
      playerId: PLAYER_ID,
      timestamp: 2,
      subPhase: SubPhase.PERFORMANCE_JUDGMENT,
    });

    const missingFollowUp = reduceTutorialProgress(scenario, progress, {
      playerViewState: createView({ seq: 51 }),
      objectBindings: BINDINGS,
      acceptedCommands: [{ actorSeat: 'FIRST', resultingSeq: 51, command: submitJudgment }],
    });
    const completed = reduceTutorialProgress(scenario, progress, {
      playerViewState: createView({ seq: 52 }),
      objectBindings: BINDINGS,
      acceptedCommands: [
        { actorSeat: 'FIRST', resultingSeq: 51, command: submitJudgment },
        { actorSeat: 'FIRST', resultingSeq: 52, command: confirmSubPhase },
      ],
    });

    expect(missingFollowUp.status).toBe('ACTIVE');
    expect(completed.status).toBe('COMPLETED');
  });

  it('uses information continuation only for INFO steps', () => {
    const infoScenario = oneStepScenario(BASIC_LIVE_TUTORIAL.steps[0]!);
    const actionScenario = oneStepScenario(actionStep('play-member'));

    expect(
      continueTutorialInformationStep(infoScenario, createTutorialProgress(infoScenario, 1), 1)
        .status
    ).toBe('COMPLETED');
    expect(
      continueTutorialInformationStep(actionScenario, createTutorialProgress(actionScenario, 1), 1)
        .status
    ).toBe('ACTIVE');
  });

  it('lets observation steps follow projected command availability without fake confirmation', () => {
    const scenario = oneStepScenario(
      BASIC_LIVE_TUTORIAL.steps.find((step) => step.id === 'watch-cheer')!
    );
    const progress = createTutorialProgress(scenario, 40);
    const completed = reduceTutorialProgress(scenario, progress, {
      playerViewState: createView({
        seq: 41,
        phase: GamePhase.PERFORMANCE_PHASE,
        subPhase: SubPhase.PERFORMANCE_JUDGMENT,
        availableCommands: [GameCommandType.SUBMIT_JUDGMENT],
      }),
      objectBindings: BINDINGS,
    });

    expect(completed.status).toBe('COMPLETED');
  });

  it('holds a completed observation for reading without using time as authority evidence', () => {
    const step = BASIC_LIVE_TUTORIAL.steps.find((candidate) => candidate.id === 'opponent-turn')!;
    const scenario = oneStepScenario(step);
    const progress = createTutorialProgress(scenario, 40);
    const beforeCondition = reduceTutorialProgress(scenario, progress, {
      playerViewState: createView({ seq: 41, phase: GamePhase.MAIN_PHASE }),
      objectBindings: BINDINGS,
      nowMs: 10_000,
    });

    expect(beforeCondition).toEqual(progress);

    const conditionReached = reduceTutorialProgress(scenario, progress, {
      playerViewState: createView({ seq: 42, phase: GamePhase.LIVE_SET_PHASE }),
      objectBindings: BINDINGS,
      nowMs: 20_000,
    });
    expect(conditionReached).toMatchObject({
      status: 'ACTIVE',
      viewConditionSatisfiedAtMs: 20_000,
    });
    expect(
      resolveTutorialStepPresentation(scenario, conditionReached, BINDINGS).presentation?.statusText
    ).toBe('对手已完成行动，请看清本步后进入 LIVE 设置');

    const stillReading = reduceTutorialProgress(scenario, conditionReached, {
      playerViewState: createView({ seq: 42, phase: GamePhase.LIVE_SET_PHASE }),
      objectBindings: BINDINGS,
      nowMs: 22_599,
    });
    const completed = reduceTutorialProgress(scenario, conditionReached, {
      playerViewState: createView({ seq: 42, phase: GamePhase.LIVE_SET_PHASE }),
      objectBindings: BINDINGS,
      nowMs: 22_600,
    });

    expect(stillReading.status).toBe('ACTIVE');
    expect(completed.status).toBe('COMPLETED');
    expect(completed.viewConditionSatisfiedAtMs).toBeUndefined();
  });
});

describe('tutorial presentation resolution', () => {
  it('reviews completed guidance without recreating its old interaction target', () => {
    expect(resolveTutorialReviewPresentation(BASIC_LIVE_TUTORIAL, 0, 3)).toMatchObject({
      stepId: 'review:welcome',
      kind: 'INFO',
      currentStep: 1,
      target: null,
      continueLabel: '下一步',
    });
    expect(resolveTutorialReviewPresentation(BASIC_LIVE_TUTORIAL, 2, 3)).toMatchObject({
      stepId: 'review:live-card',
      continueLabel: '下一步',
    });
    expect(resolveTutorialReviewPresentation(BASIC_LIVE_TUTORIAL, 3, 3)).toBeNull();
  });

  it('resolves an object role only through the player-view binding', () => {
    const scenario = oneStepScenario(BASIC_LIVE_TUTORIAL.steps[1]!);
    const progress = createTutorialProgress(scenario, 1);

    expect(
      resolveTutorialStepPresentation(scenario, progress, BINDINGS).presentation?.target
    ).toEqual({
      kind: 'OBJECT',
      objectId: `obj_${MEMBER_ID}`,
      padding: undefined,
      placement: 'TOP',
    });
  });

  it('resolves the member-play source and center-stage target together', () => {
    const scenario = oneStepScenario(actionStep('play-member'));
    const progress = createTutorialProgress(scenario, 1);
    const presentation = resolveTutorialStepPresentation(scenario, progress, BINDINGS).presentation;

    expect(presentation?.target).toEqual({
      kind: 'ANCHOR',
      anchor: BATTLE_UI_ANCHORS.SELF_STAGE_CENTER,
      padding: undefined,
      placement: 'TOP',
    });
    expect(presentation?.secondaryTargets).toEqual([
      {
        kind: 'OBJECT',
        objectId: `obj_${MEMBER_ID}`,
        padding: 8,
        placement: undefined,
      },
    ]);
  });

  it('shows a blocking diagnostic instead of guessing or skipping a missing object binding', () => {
    const scenario = oneStepScenario(BASIC_LIVE_TUTORIAL.steps[1]!);
    const progress = createTutorialProgress(scenario, 1);
    const resolution = resolveTutorialStepPresentation(scenario, progress, {});

    expect(resolution.missingObjectRole).toBe(BASIC_LIVE_TUTORIAL_OBJECT_ROLES.MEMBER_CARD);
    expect(resolution.presentation).toMatchObject({
      kind: 'OBSERVE',
      title: '教学目标暂不可用',
      target: null,
    });
  });
});
