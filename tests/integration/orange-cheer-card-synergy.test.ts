import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PL_AD1_004_LIVE_SUCCESS_ORANGE_CHEER_TO_HAND_ABILITY_ID as RECOVER,
  PL_BP8_023_LIVE_START_LOW_COST_NO_BLADE_HEART_GAIN_ORANGE_ABILITY_ID as SNOW_START,
  PL_BP8_023_LIVE_SUCCESS_SIX_ORANGE_CHEER_SCORE_ABILITY_ID as SNOW_SCORE,
  SP_AD1_001_AUTO_ON_CHEER_ORANGE_ADDITIONAL_CHEER_ABILITY_ID as ADDITIONAL,
} from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import { createConfirmSubPhaseAction, GameActionType } from '../../src/application/actions';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import {
  createCardInstance,
  type BladeHearts,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer } from '../../src/domain/entities/game';
import { createLiveStartEvent } from '../../src/domain/events/game-events';
import {
  getCheerCardEffectiveBladeHearts,
  getLiveCardScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import { selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts } from '../../src/application/effects/cheer-selection';
import {
  BladeHeartEffect,
  CardType,
  EffectWindowType,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';
import { createNovember10OrangeCard } from '../helpers/november-10-orange-effects';
import {
  P1,
  P2,
  gameWith,
  liveZone,
  sessionFor,
  setState,
  stage,
} from '../helpers/modifier-workflow-fixtures';

const orange = [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.ORANGE }] as const;

function cheer(id: string, bladeHearts: BladeHearts = []) {
  const data: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: `TEST-${id}`,
    name: id,
    cost: 4,
    blade: 0,
    hearts: [],
    bladeHearts,
  };
  return createCardInstance(data, P1, id);
}

function setup(existingGrayAndAll: boolean) {
  const snow = createNovember10OrangeCard('PL!-bp8-023', P1, 'snow');
  const heartToHeart = createNovember10OrangeCard('PL!-ad1-004', P1, 'heart-to-heart');
  const kanon = createNovember10OrangeCard('PL!SP-ad1-001', P1, 'kanon');
  // Kanon's printed four BLADE determine the ordinary cheer size. This other
  // member supplies the two songs' colored requirements and no extra BLADE.
  const supporterData = {
    cardType: CardType.MEMBER,
    cardCode: 'TEST-supporter',
    name: 'supporter',
    cost: 4,
    blade: 0,
    bladeHearts: [],
    hearts: [
      { color: HeartColor.PINK, count: 2 },
      { color: HeartColor.YELLOW, count: 4 },
      { color: HeartColor.PURPLE, count: 3 },
      { color: HeartColor.GRAY, count: 7 },
    ],
  } satisfies MemberCardData;
  const supporter = createCardInstance(supporterData, P1, 'supporter');
  const normal = Array.from({ length: 4 }, (_, index) =>
    cheer(
      `normal-${index}`,
      existingGrayAndAll && index >= 2
        ? [
            {
              effect: BladeHeartEffect.HEART,
              heartColor: index === 2 ? HeartColor.GRAY : HeartColor.RAINBOW,
            },
          ]
        : []
    )
  );
  const additional = [cheer('additional-0'), cheer('additional-1')];
  const spare = [cheer('spare-0'), cheer('spare-1')];
  let game = liveZone(
    liveZone(
      gameWith([snow, heartToHeart, kanon, supporter, ...normal, ...additional, ...spare]),
      snow
    ),
    heartToHeart
  );
  game = updatePlayer(stage(game, [kanon, supporter]), P1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: [...normal, ...additional, ...spare].map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    manualOperationMode: 'RULES',
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    effectWindowType: EffectWindowType.LIVE_START,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P1 },
  };
  return {
    game: emitGameEvent(game, createLiveStartEvent(P1, [snow.instanceId, heartToHeart.instanceId])),
    normal,
    additional,
    spare,
  };
}

function runThroughRecovery(existingGrayAndAll: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  const { game, normal, additional, spare } = setup(existingGrayAndAll);
  const service = new GameService();
  const checked = service.executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(checked.success).toBe(true);
  const session = sessionFor(checked.gameState);
  expect(session.state!.pendingAbilities.some((pending) => pending.abilityId === SNOW_START)).toBe(
    true
  );
  // Resolve Snow and Kanon's no-hand LIVE_START through the real ordered pool.
  expect(
    session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        true
      )
    ).success
  ).toBe(true);
  expect(session.state!.activeEffect).toBeNull();
  expect(
    session.state!.liveResolution.liveModifiers.filter(
      (modifier) => modifier.kind === 'CHEER_CARD_BLADE_HEART_GRANT'
    )
  ).toHaveLength(1);
  expect(normal[0].data).toMatchObject({ bladeHearts: [] });
  expect(getCheerCardEffectiveBladeHearts(session.state!, P1, normal[0].instanceId)).toEqual(
    orange
  );

  const revealed = service.processAction(
    session.state!,
    createConfirmSubPhaseAction(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
  );
  expect(revealed.success).toBe(true);
  setState(session, revealed.gameState);
  expect(session.state!.liveResolution.firstPlayerCheerCardIds).toEqual(
    normal.map((card) => card.instanceId)
  );
  expect(session.state!.activeEffect?.abilityId).toBe(ADDITIONAL);
  expect(session.state!.activeEffect?.effectText).toContain('实际追加进行2张卡片的声援');
  expect(
    session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id))
      .success
  ).toBe(true);
  const allIds = [...normal, ...additional].map((card) => card.instanceId);
  expect(session.state!.liveResolution.firstPlayerCheerCardIds).toEqual(allIds);
  expect(session.state!.players[0].mainDeck.cardIds).toEqual(spare.map((card) => card.instanceId));
  const cheerEvents = session
    .state!.eventLog.map(({ event }) => event)
    .filter((event) => event.eventType === TriggerCondition.ON_CHEER);
  expect(cheerEvents).toMatchObject([
    { revealedCardIds: normal.map((card) => card.instanceId), additional: false },
    { revealedCardIds: additional.map((card) => card.instanceId), additional: true },
  ]);
  expect(
    session.state!.actionHistory.filter(
      (action) => action.payload.abilityId === ADDITIONAL && action.payload.step === 'ABILITY_USE'
    )
  ).toHaveLength(1);
  expect(session.state!.activeEffect).toBeNull();

  const judged = service.processAction(session.state!, {
    type: GameActionType.CONFIRM_JUDGMENT,
    playerId: P1,
    judgmentResults: new Map(),
    timestamp: Date.now(),
  });
  expect(judged.success).toBe(true);
  expect(judged.gameState.liveResolution.liveResults).toEqual(
    new Map([
      ['snow', true],
      ['heart-to-heart', true],
    ])
  );
  expect(judged.gameState.liveResolution.playerScores.get(P1)).toBe(12);
  expect(
    judged.gameState.liveResolution.playerLiveJudgmentHearts
      .get(P1)
      ?.some((heart) => heart.color === HeartColor.ORANGE)
  ).toBe(false);
  expect(judged.gameState.liveResolution.playerLiveJudgmentHearts.get(P1)).toContainEqual({
    color: HeartColor.GRAY,
    count: existingGrayAndAll ? 12 : 13,
  });
  const successWindow = service.processAction(
    judged.gameState,
    createConfirmSubPhaseAction(P1, SubPhase.PERFORMANCE_JUDGMENT)
  );
  expect(successWindow.success).toBe(true);
  setState(session, successWindow.gameState);
  expect(session.state!.pendingAbilities.map((pending) => pending.abilityId).sort()).toEqual(
    [RECOVER, SNOW_SCORE].sort()
  );
  expect(
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'heart-to-heart')
    ).success
  ).toBe(true);
  expect(session.state!.activeEffect?.abilityId).toBe(RECOVER);
  const orangeIds = existingGrayAndAll
    ? ['normal-0', 'normal-1', 'additional-0', 'additional-1']
    : allIds;
  expect(session.state!.activeEffect?.selectableCardIds).toEqual(orangeIds);
  const chosen = normal[0].instanceId;
  expect(
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, chosen)
    ).success
  ).toBe(true);
  const display = session.state!.activeEffect!;
  expect(display.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
  expect(display.revealedCardIds).toEqual([chosen]);
  expect(session.state!.resolutionZone.cardIds).toContain(chosen);
  expect(session.state!.players[0].hand.cardIds).toEqual([]);
  const deadline = display.publicCardSelectionAutoAdvanceAt!;
  expect(deadline).toBeGreaterThan(Date.now());
  vi.setSystemTime(deadline);
  expect(
    session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, display.id, deadline))
      .success
  ).toBe(true);
  expect(session.state!.players[0].hand.cardIds).toEqual([chosen]);
  expect(session.state!.resolutionZone.cardIds).not.toContain(chosen);
  expect(session.state!.liveResolution.firstPlayerCheerCardIds).toContain(chosen);
  expect(
    selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(session.state!, P1)
      .filter(({ effectiveBladeHearts }) =>
        effectiveBladeHearts.some(
          (heart) =>
            heart.effect === BladeHeartEffect.HEART && heart.heartColor === HeartColor.ORANGE
        )
      )
      .map(({ cardId }) => cardId)
  ).toEqual(orangeIds);
  expect(session.state!.activeEffect?.abilityId).toBe(SNOW_SCORE);
  return session;
}

afterEach(() => vi.useRealTimers());

describe('Snow halation → 涩谷香音 → HEART to HEART! orange-cheer synergy', () => {
  it('grants six orange markers through ordinary plus additional RULES cheer and retains the recovered historical card for Snow score +2', () => {
    const session = runThroughRecovery(false);
    expect(session.state!.activeEffect?.effectText).toContain('有6张');
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(14);
    expect(getLiveCardScoreModifier(session.state!.liveResolution, 'snow')).toBe(2);
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('keeps preexisting GRAY and ALL markers distinct from granted ORANGE for recovery and the six-card condition', () => {
    const session = runThroughRecovery(true);
    expect(session.state!.activeEffect?.effectText).toContain('有4张');
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(12);
    expect(getLiveCardScoreModifier(session.state!.liveResolution, 'snow')).toBe(0);
    expect(getCheerCardEffectiveBladeHearts(session.state!, P1, 'normal-2')).toEqual([
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
    ]);
    expect(getCheerCardEffectiveBladeHearts(session.state!, P1, 'normal-3')).toEqual([
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW },
    ]);
    expect(session.state!.pendingAbilities).toEqual([]);
  });
});
