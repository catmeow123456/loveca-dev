import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type ActiveEffectState,
} from '../../src/domain/entities/game';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createPublicRevealDwellBeforeNextEffect,
  getPublicRevealDisplayDurationMs,
  normalizePublicRevealDwellStepText,
  PUBLIC_REVEAL_DWELL_STEP_ID,
  resolvePublicRevealDwellStep,
  withPublicRevealDwell,
} from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  registerActiveEffectStepHandler,
  type ActiveEffectStepHandlerContext,
} from '../../src/application/card-effects/runtime/step-registry';
import { CardType, HeartColor, ZoneType } from '../../src/shared/types/enums';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';

const P1 = 'player-1';
const P2 = 'player-2';
const RESOLVE_ABILITY_ID = 'test:public-reveal-dwell:resolve';
const RESTORE_ABILITY_ID = 'test:public-reveal-dwell:restore';
const START_STEP_ID = 'START_PUBLIC_REVEAL';
const RESOLVE_STEP_ID = 'RESOLVE_AFTER_PUBLIC_REVEAL';
const NEXT_INTERACTION_STEP_ID = 'NEXT_REAL_INTERACTION';

function member(id: string, ownerId = P1) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, ownerId, id);
}

interface Scenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly revealedCardIds: readonly [string, string];
  readonly oldPublicCardId: string;
  readonly privateInspectionCardId: string;
  readonly setNow: (value: number) => void;
}

function setupResolveScenario(options: { readonly inspectionContext?: boolean } = {}): Scenario {
  let now = 10_000;
  const source = member('source');
  const oldPublic = member('old-public');
  const revealedA = member('revealed-a');
  const revealedB = member('revealed-b');
  const privateInspection = member('private-inspection');
  let game = registerCards(createGameState('public-reveal-dwell', P1, 'P1', P2, 'P2'), [
    source,
    oldPublic,
    revealedA,
    revealedB,
    privateInspection,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [oldPublic.instanceId, revealedA.instanceId, revealedB.instanceId],
    },
  }));
  game = {
    ...game,
    inspectionContext: options.inspectionContext
      ? { ownerPlayerId: P1, sourceZone: ZoneType.MAIN_DECK }
      : null,
    inspectionZone: options.inspectionContext
      ? {
          ...game.inspectionZone,
          cardIds: [privateInspection.instanceId],
          revealedCardIds: [],
        }
      : game.inspectionZone,
    activeEffect: {
      id: 'public-reveal-effect',
      abilityId: RESOLVE_ABILITY_ID,
      sourceCardId: source.instanceId,
      controllerId: P1,
      effectText: '测试公开结果。',
      stepId: START_STEP_ID,
      stepText: '开始公开结果。',
      awaitingPlayerId: P1,
      metadata: {
        revealedA: revealedA.instanceId,
        revealedB: revealedB.instanceId,
        oldPublic: oldPublic.instanceId,
        privateInspection: privateInspection.instanceId,
      },
    },
  };

  const session = createGameSession({ now: () => now });
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  return {
    session,
    revealedCardIds: [revealedA.instanceId, revealedB.instanceId],
    oldPublicCardId: oldPublic.instanceId,
    privateInspectionCardId: privateInspection.instanceId,
    setNow(value) {
      now = value;
    },
  };
}

registerActiveEffectStepHandler(RESOLVE_ABILITY_ID, START_STEP_ID, (game) => {
  const effect = game.activeEffect!;
  const revealedA = effect.metadata!.revealedA as string;
  const revealedB = effect.metadata!.revealedB as string;
  const oldPublic = effect.metadata!.oldPublic as string;
  const privateInspection = effect.metadata!.privateInspection as string;
  const resolutionEffect: ActiveEffectState = {
    ...effect,
    stepId: RESOLVE_STEP_ID,
    stepText: '确认公开结果后，继续处理后结算此效果。',
    revealedCardIds: [oldPublic, revealedA, revealedB],
    inspectionCardIds: [privateInspection],
  };
  return {
    ...game,
    // 本次只展示新公开批次，不能重复展示 activeEffect 中的旧公开事实。
    activeEffect: withPublicRevealDwell(resolutionEffect, [revealedA, revealedB, revealedA]),
  };
});

registerActiveEffectStepHandler(RESOLVE_ABILITY_ID, RESOLVE_STEP_ID, (game, input) => {
  if (
    input.selectedCardId !== undefined ||
    input.selectedCardIds !== undefined ||
    input.selectedOptionId !== undefined
  ) {
    return game;
  }
  return {
    ...game,
    activeEffect: null,
    loopCounter: game.loopCounter + 1,
  };
});

registerActiveEffectStepHandler(RESTORE_ABILITY_ID, START_STEP_ID, (game) => {
  const effect = game.activeEffect!;
  const revealedCardId = effect.metadata!.revealedCardId as string;
  const nextEffect: ActiveEffectState = {
    ...effect,
    effectText: '旧卡文',
    stepId: NEXT_INTERACTION_STEP_ID,
    stepText: '请选择真实的后续选项。',
    selectableOptions: [{ id: 'next', label: '下一步' }],
  };
  return createPublicRevealDwellBeforeNextEffect(game, nextEffect, {
    revealedCardIds: [revealedCardId],
    stepText: '确认后进入后续选择。',
    effectText: '覆盖后的卡文',
  });
});

function setupRestoreScenario(): Scenario {
  const scenario = setupResolveScenario();
  const state = scenario.session.state!;
  scenario.session.restoreRuntimeState({
    authorityState: {
      ...state,
      activeEffect: {
        ...state.activeEffect!,
        abilityId: RESTORE_ABILITY_ID,
        metadata: {
          revealedCardId: scenario.revealedCardIds[0],
        },
      },
    },
    currentPublicSeq: 0,
  });
  return scenario;
}

function openDwell(scenario: Scenario) {
  const effectId = scenario.session.state!.activeEffect!.id;
  const opened = scenario.session.executeCommand(createConfirmEffectStepCommand(P1, effectId));
  expect(opened.success, opened.error).toBe(true);
  const effect = scenario.session.state!.activeEffect!;
  const expectedDeadline =
    10_000 + getPublicRevealDisplayDurationMs(effect.revealedCardIds?.length ?? 0);
  expect(effect).toMatchObject({
    id: effectId,
    stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
    publicRevealAutoAdvanceAt: expectedDeadline,
  });
  expect(effect.publicRevealGeneration).toEqual(expect.any(String));
  return effect;
}

describe('generic public reveal dwell', () => {
  it('deduplicates one explicit reveal batch, normalizes mechanism copy, and avoids double dwell', () => {
    expect(getPublicRevealDisplayDurationMs(1)).toBe(2_000);
    expect(getPublicRevealDisplayDurationMs(2)).toBe(2_300);
    expect(getPublicRevealDisplayDurationMs(6)).toBe(3_500);
    expect(
      normalizePublicRevealDwellStepText('确认公开结果后确认条件，确认后继续处理，继续处理后结算。')
    ).toBe('展示结束后确认条件，展示结束后继续处理，展示结束后结算。');

    const scenario = setupResolveScenario();
    const effect = openDwell(scenario);
    expect(effect.revealedCardIds).toEqual(scenario.revealedCardIds);
    expect(effect.revealedCardIds).not.toContain(scenario.oldPublicCardId);
    expect(effect.inspectionCardIds).toBeUndefined();
    expect(effect.stepText).toBe('展示结束后，展示结束后结算此效果。');
    expect(withPublicRevealDwell(effect)).toBe(effect);

    const specializedCardSelection: ActiveEffectState = {
      id: 'specialized-card-selection',
      abilityId: 'test:specialized-card-selection',
      sourceCardId: 'source',
      controllerId: P1,
      effectText: '专用公开选卡',
      stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
      stepText: '专用公开选卡展示',
      awaitingPlayerId: P1,
      revealedCardIds: scenario.revealedCardIds,
    };
    const specializedEffectChoice: ActiveEffectState = {
      ...specializedCardSelection,
      id: 'specialized-effect-choice',
      stepId: 'COMMON_PUBLIC_EFFECT_CHOICE_CONFIRMATION',
    };
    expect(withPublicRevealDwell(specializedCardSelection)).toBe(specializedCardSelection);
    expect(withPublicRevealDwell(specializedEffectChoice)).toBe(specializedEffectChoice);
    const guardedSpecialized = createPublicRevealDwellBeforeNextEffect(
      scenario.session.state!,
      {
        ...specializedCardSelection,
        publicRevealAutoAdvanceAt: 999,
        publicRevealGeneration: 'unrelated-generic-authority',
      },
      {
        revealedCardIds: scenario.revealedCardIds,
        effectText: '覆盖但不再包装',
      }
    ).activeEffect;
    expect(guardedSpecialized).toMatchObject({
      stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
      effectText: '覆盖但不再包装',
    });
    expect(guardedSpecialized?.publicRevealAutoAdvanceAt).toBeUndefined();
    expect(guardedSpecialized?.publicRevealGeneration).toBeUndefined();

    const guardedGeneric = createPublicRevealDwellBeforeNextEffect(
      scenario.session.state!,
      effect,
      {
        revealedCardIds: scenario.revealedCardIds,
        effectText: '现有 dwell 覆盖卡文',
      }
    ).activeEffect!;
    expect(guardedGeneric).toMatchObject({
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      effectText: '现有 dwell 覆盖卡文',
      publicRevealAutoAdvanceAt: effect.publicRevealAutoAdvanceAt,
      publicRevealGeneration: effect.publicRevealGeneration,
    });
    const genericRestored = resolvePublicRevealDwellStep(
      { ...scenario.session.state!, activeEffect: guardedGeneric },
      {} as ActiveEffectStepHandlerContext,
      (restoredGame) => restoredGame
    );
    expect(genericRestored.activeEffect?.effectText).toBe('现有 dwell 覆盖卡文');
    expect(
      createPublicRevealDwellBeforeNextEffect(
        scenario.session.state!,
        {
          ...specializedCardSelection,
          id: 'ordinary-next-effect',
          stepId: 'ORDINARY_NEXT_EFFECT',
        },
        { revealedCardIds: [...scenario.revealedCardIds, scenario.revealedCardIds[0]] }
      ).activeEffect?.stepText
    ).toBe('已公开2张卡牌，正在向双方展示。展示结束后继续处理。');

    const noCards = {
      ...specializedCardSelection,
      stepId: 'NO_PUBLIC_CARDS',
      revealedCardIds: [],
    };
    expect(withPublicRevealDwell(noCards)).toBe(noCards);
  });

  it('projects the same public batch and command authority to both players without inspection leakage', () => {
    const scenario = setupResolveScenario({ inspectionContext: true });
    const effect = openDwell(scenario);
    const expectedObjectIds = scenario.revealedCardIds.map(createPublicObjectId);

    for (const playerId of [P1, P2]) {
      const view = scenario.session.getPlayerViewState(playerId)!;
      expect(view.activeEffect).toMatchObject({
        stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
        revealedObjectIds: expectedObjectIds,
        publicRevealAutoAdvanceAt: 12_300,
        publicRevealAutoAdvanceAfterMs: 2_300,
        publicRevealGeneration: effect.publicRevealGeneration,
      });
      expect(view.activeEffect?.inspectionObjectIds).toBeUndefined();
      expect(view.objects[createPublicObjectId(scenario.revealedCardIds[0])]).toMatchObject({
        surface: 'FRONT',
        publiclyRevealed: true,
      });
      expect(view.activeEffect?.revealedObjectIds).not.toContain(
        createPublicObjectId(scenario.privateInspectionCardId)
      );
      expect(view.objects[createPublicObjectId(scenario.privateInspectionCardId)]).toMatchObject({
        surface: playerId === P1 ? 'FRONT' : 'BACK',
      });
      expect(
        view.objects[createPublicObjectId(scenario.privateInspectionCardId)]?.publiclyRevealed
      ).not.toBe(true);
      expect(
        view.permissions.availableCommands.find(
          (hint) => hint.command === GameCommandType.CONFIRM_EFFECT_STEP
        )?.params
      ).toMatchObject({
        effectId: effect.id,
        publicRevealAutoAdvanceAt: 12_300,
        publicRevealGeneration: effect.publicRevealGeneration,
      });
    }
  });

  it('rejects early, stale, and selection-bearing advances, then lets either participant win the race once', () => {
    const scenario = setupResolveScenario({ inspectionContext: true });
    const effect = openDwell(scenario);
    const generation = effect.publicRevealGeneration!;
    const deadline = effect.publicRevealAutoAdvanceAt!;

    const early = scenario.session.executeCommand(
      createAutoAdvancePublicRevealCommand(P2, effect.id, deadline, generation)
    );
    expect(early.success).toBe(false);
    expect(early.error).toContain('尚未结束');

    scenario.setNow(deadline);
    const stale = scenario.session.executeCommand(
      createAutoAdvancePublicRevealCommand(P1, effect.id, deadline, `${generation}:stale`)
    );
    expect(stale.success).toBe(false);
    expect(stale.error).toContain('已过期');

    const withSelection = scenario.session.executeCommand({
      ...createAutoAdvancePublicRevealCommand(P2, effect.id, deadline, generation),
      selectedCardId: scenario.revealedCardIds[0],
    });
    expect(withSelection.success).toBe(false);
    expect(withSelection.error).toContain('不接受玩家选择');

    const advanced = scenario.session.executeCommand(
      createAutoAdvancePublicRevealCommand(P2, effect.id, deadline, generation)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.loopCounter).toBe(1);

    const racingPlayer = scenario.session.executeCommand(
      createAutoAdvancePublicRevealCommand(P1, effect.id, deadline, generation)
    );
    expect(racingPlayer.success).toBe(false);
    expect(scenario.session.state?.loopCounter).toBe(1);
  });

  it('restores a real next interaction without resolving it and preserves the effectText override', () => {
    const scenario = setupRestoreScenario();
    const dwell = openDwell(scenario);
    expect(dwell.stepText).toBe('展示结束后进入后续选择。');

    scenario.setNow(dwell.publicRevealAutoAdvanceAt!);
    const advanced = scenario.session.executeCommand(
      createAutoAdvancePublicRevealCommand(
        P2,
        dwell.id,
        dwell.publicRevealAutoAdvanceAt!,
        dwell.publicRevealGeneration!
      )
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      stepId: NEXT_INTERACTION_STEP_ID,
      stepText: '请选择真实的后续选项。',
      effectText: '覆盖后的卡文',
      selectableOptions: [{ id: 'next', label: '下一步' }],
    });
    expect(scenario.session.state?.loopCounter).toBe(0);
  });

  it('does not reset authority on reprojection or reconnect and initializes a legacy missing-authority dwell', () => {
    const scenario = setupResolveScenario();
    const dwell = openDwell(scenario);
    const deadline = dwell.publicRevealAutoAdvanceAt!;
    const generation = dwell.publicRevealGeneration!;

    scenario.setNow(11_000);
    expect(scenario.session.getPlayerViewState(P1)?.activeEffect).toMatchObject({
      publicRevealAutoAdvanceAt: deadline,
      publicRevealAutoAdvanceAfterMs: 1_300,
      publicRevealGeneration: generation,
    });
    expect(scenario.session.getPlayerViewState(P2)?.activeEffect).toMatchObject({
      publicRevealAutoAdvanceAt: deadline,
      publicRevealAutoAdvanceAfterMs: 1_300,
      publicRevealGeneration: generation,
    });

    const reconnecting = createGameSession({ now: () => 11_000 });
    reconnecting.restoreRuntimeState({
      authorityState: scenario.session.state!,
      currentPublicSeq: scenario.session.getCurrentPublicEventSeq(),
    });
    expect(reconnecting.state?.activeEffect).toMatchObject({
      publicRevealAutoAdvanceAt: deadline,
      publicRevealGeneration: generation,
    });
    expect(reconnecting.state?.publicRevealGenerationEpoch).toBe(
      scenario.session.state?.publicRevealGenerationEpoch
    );
    expect(reconnecting.state?.publicRevealGenerationSequence).toBe(
      scenario.session.state?.publicRevealGenerationSequence
    );
    expect(reconnecting.getPlayerViewState(P2)?.activeEffect).toMatchObject({
      publicRevealAutoAdvanceAfterMs: 1_300,
    });

    const { publicRevealAutoAdvanceAt, publicRevealGeneration, ...legacyEffect } =
      scenario.session.state!.activeEffect!;
    void publicRevealAutoAdvanceAt;
    void publicRevealGeneration;
    const legacy = createGameSession({ now: () => 20_000 });
    legacy.restoreRuntimeState({
      authorityState: {
        ...scenario.session.state!,
        activeEffect: legacyEffect,
      },
      currentPublicSeq: 0,
    });
    expect(legacy.state?.activeEffect?.publicRevealAutoAdvanceAt).toBe(22_300);
    expect(legacy.state?.activeEffect?.publicRevealGeneration).not.toBe(generation);
    expect(legacy.state?.publicRevealGenerationEpoch).toBeGreaterThan(
      scenario.session.state?.publicRevealGenerationEpoch ?? -1
    );
    expect(legacy.state?.publicRevealGenerationSequence).toBeGreaterThan(
      scenario.session.state?.publicRevealGenerationSequence ?? -1
    );

    const zeroDeadlineView = projectPlayerViewState(
      {
        ...scenario.session.state!,
        activeEffect: {
          ...scenario.session.state!.activeEffect!,
          publicRevealAutoAdvanceAt: 0,
        },
      },
      P1,
      { now: 100 }
    );
    expect(zeroDeadlineView.activeEffect?.publicRevealAutoAdvanceAfterMs).toBe(0);
  });

  it('keeps auto advance in the origin undo unit and never reuses a generation after undo', () => {
    const scenario = setupResolveScenario();
    const dwell = openDwell(scenario);
    const firstSequence = scenario.session.state?.publicRevealGenerationSequence ?? 0;
    const firstEpoch = scenario.session.state?.publicRevealGenerationEpoch ?? 0;
    const originUndo = scenario.session.getUndoAvailability(P1);
    expect(originUndo.canUndoNow).toBe(true);

    scenario.setNow(dwell.publicRevealAutoAdvanceAt!);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P2,
          dwell.id,
          dwell.publicRevealAutoAdvanceAt!,
          dwell.publicRevealGeneration!
        )
      ).success
    ).toBe(true);
    const resolvedUndo = scenario.session.getUndoAvailability(P1);
    expect(resolvedUndo.entry?.undoEntryId).toBe(originUndo.entry?.undoEntryId);

    const undone = scenario.session.undoLastStepForPlayer(P1, resolvedUndo.entry!.undoEntryId);
    expect(undone.success, undone.error).toBe(true);
    expect(scenario.session.state?.activeEffect?.stepId).toBe(START_STEP_ID);

    const recreated = scenario.session.executeCommand(createConfirmEffectStepCommand(P1, dwell.id));
    expect(recreated.success, recreated.error).toBe(true);
    expect(scenario.session.state?.activeEffect?.publicRevealGeneration).not.toBe(
      dwell.publicRevealGeneration
    );
    expect(scenario.session.state?.publicRevealGenerationEpoch).toBe(firstEpoch);
    expect(scenario.session.state?.publicRevealGenerationSequence).toBeGreaterThan(firstSequence);
  });
});
