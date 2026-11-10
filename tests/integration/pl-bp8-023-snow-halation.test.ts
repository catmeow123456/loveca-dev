import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  type BladeHearts,
  type CardInstance,
} from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createCheerEvent,
  createEnterLiveZoneEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getCheerCardEffectiveBladeHearts,
} from '../../src/domain/rules/live-modifiers';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import { liveResolver } from '../../src/domain/rules/live-resolver';
import {
  BladeHeartEffect,
  EffectWindowType,
  FaceState,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createConfirmEffectStepCommand,
  createRevealCheerCardCommand,
} from '../../src/application/game-commands';
import { createConfirmSubPhaseAction, GameActionType } from '../../src/application/actions';
import { GameService } from '../../src/application/game-service';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import {
  moveRevealedCheerCards,
  selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts,
} from '../../src/application/effects/cheer-selection';
import {
  PL_BP8_023_LIVE_START_LOW_COST_NO_BLADE_HEART_GAIN_ORANGE_ABILITY_ID as START,
  PL_BP8_023_LIVE_SUCCESS_SIX_ORANGE_CHEER_SCORE_ABILITY_ID as SUCCESS,
} from '../../src/application/card-effects/ability-ids';
import { createNovember10OrangeCard } from '../helpers/november-10-orange-effects';
import {
  P1,
  P2,
  confirm,
  gameWith,
  liveZone,
  member,
  sessionFor,
  setState,
  stage,
  start,
} from '../helpers/modifier-workflow-fixtures';

const orange = [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.ORANGE }] as const;
function cheer(id: string, bladeHearts?: BladeHearts, cost = 4) {
  return member(`TEST-${id}`, id, P1, { cost, hearts: [], bladeHearts });
}
function setup(cards: readonly CardInstance[] = [], second = false) {
  const source = createNovember10OrangeCard('PL!-bp8-023', P1, 'snow');
  const other = second ? createNovember10OrangeCard('PL!-bp8-023', P1, 'snow-second') : null;
  let game = liveZone(gameWith([source, ...(other ? [other] : []), ...cards]), source);
  if (other) game = liveZone(game, other);
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: P1,
      playerScores: new Map([[P1, 5]]),
    },
  };
  return { source, other, game };
}
function facts(game: GameState, cards: readonly CardInstance[]) {
  const ids = cards.map((card) => card.instanceId);
  game = { ...game, liveResolution: { ...game.liveResolution, firstPlayerCheerCardIds: ids } };
  return emitGameEvent(game, createCheerEvent(P1, ids, ids.length));
}
function startGrant(game: GameState, source: CardInstance) {
  const session = sessionFor(start(game, source, START));
  expect(session.state!.liveResolution.liveModifiers).toEqual([]);
  expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  expect(confirm(session, P1).success).toBe(true);
  return session.state!;
}
function success(game: GameState, source: CardInstance) {
  return sessionFor(start(game, source, SUCCESS, TriggerCondition.ON_LIVE_SUCCESS));
}
function grantModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'CHEER_CARD_BLADE_HEART_GRANT'
  );
}

describe('PL!-bp8-023 分数5「Snow halation」', () => {
  it('uses full source text for both queued ability windows', () => {
    const { game, source } = setup();
    const session = sessionFor(start(game, source, START));
    expect(session.state!.activeEffect?.effectText).toBe(
      '【LIVE开始时】LIVE结束时为止，因声援被公开的自己的费用小于等于4的不持有BLADE HEART的成员卡获得[オレンジブレード]。'
    );
    const scoring = success(game, source);
    expect(scoring.state!.activeEffect?.effectText).toBe(
      '【LIVE成功时】因声援被公开的自己的卡片中存在大于等于6张持有[オレンジブレード]的卡片的场合，此卡的分数+2。（本次声援公开的持有[オレンジブレード]的卡片有0张；条件未满足；此卡实际分数＋0。）'
    );
  });

  it('keeps the player rule after its already triggered source leaves and after it reenters', () => {
    const target = cheer('target');
    const { game, source } = setup([target]);
    const session = sessionFor(start(game, source, START));
    setState(
      session,
      moveCardUniversal(
        session.state!,
        P1,
        source.instanceId,
        ZoneType.LIVE_ZONE,
        ZoneType.WAITING_ROOM
      )
    );
    expect(confirm(session, P1).success).toBe(true);
    const left = session.state!;
    expect(left.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(grantModifiers(left)).toHaveLength(1);
    expect(getCheerCardEffectiveBladeHearts(left, P1, target.instanceId)).toEqual(orange);
    const reentered = moveCardUniversal(
      left,
      P1,
      source.instanceId,
      ZoneType.WAITING_ROOM,
      ZoneType.LIVE_ZONE
    );
    expect(getCheerCardEffectiveBladeHearts(reentered, P1, target.instanceId)).toEqual(orange);
    const leftAgain = moveCardUniversal(
      reentered,
      P1,
      source.instanceId,
      ZoneType.LIVE_ZONE,
      ZoneType.WAITING_ROOM
    );
    expect(grantModifiers(leftAgain)).toHaveLength(1);
    expect(getCheerCardEffectiveBladeHearts(leftAgain, P1, target.instanceId)).toEqual(orange);
  });

  it.each([false, true])(
    'resolves two LIVE_START sources with ordered=%s and never duplicates one card marker',
    (ordered) => {
      const target = cheer('target');
      const { game, source, other } = setup([target], true);
      const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
      expect(checked.success).toBe(true);
      const session = sessionFor(checked.gameState);
      const effect = session.state!.activeEffect!;
      expect(effect.canResolveInOrder).toBe(true);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            effect.id,
            ordered ? undefined : effect.selectableCardIds?.[0],
            undefined,
            ordered
          )
        ).success
      ).toBe(true);
      if (!ordered) {
        expect(grantModifiers(session.state!)).toEqual([]);
        expect(confirm(session, P1).success).toBe(true);
        expect(confirm(session, P1).success).toBe(true);
      }
      expect(grantModifiers(session.state!)).toHaveLength(2);
      expect(getCheerCardEffectiveBladeHearts(session.state!, P1, target.instanceId)).toEqual(
        orange
      );
      expect(
        new Set(grantModifiers(session.state!).map((modifier) => modifier.sourceCardId))
      ).toEqual(new Set([source.instanceId, other!.instanceId]));
    }
  );

  it.each([5, 6, 7])(
    'checks the six-card boundary at %i cards and adds exactly two source points',
    (count) => {
      const cards = Array.from({ length: count }, (_, index) =>
        cheer(`orange-${index}`, index === 0 ? [...orange, ...orange, ...orange] : orange)
      );
      const { game, source } = setup(cards);
      const session = success(facts(game, cards), source);
      expect(session.state!.activeEffect?.effectText).toContain(`有${count}张`);
      expect(session.state!.liveResolution.playerScores.get(P1)).toBe(5);
      expect(confirm(session, P1).success).toBe(true);
      expect(session.state!.liveResolution.playerScores.get(P1)).toBe(count >= 6 ? 7 : 5);
      const mods = session.state!.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'SCORE'
      );
      expect(mods).toHaveLength(Number(count >= 6));
      if (count >= 6)
        expect(mods[0]).toMatchObject({ liveCardId: source.instanceId, countDelta: 2 });
      const again = success(session.state!, source);
      expect(confirm(again, P1).success).toBe(true);
      expect(again.state!.liveResolution.playerScores.get(P1)).toBe(count >= 6 ? 7 : 5);
    }
  );

  it('counts cards rather than icons, retains ordinary moved historical reveals and respects effective recoloring', () => {
    const cards = [
      cheer('triple', [...orange, ...orange, ...orange]),
      ...Array.from({ length: 5 }, (_, i) => cheer(`blank-${i}`)),
    ];
    const { source, game } = setup(cards);
    let state = startGrant(game, source);
    state = {
      ...state,
      resolutionZone: {
        ...state.resolutionZone,
        cardIds: cards.map((card) => card.instanceId),
        revealedCardIds: cards.map((card) => card.instanceId),
      },
    };
    state = facts(state, cards);
    const moved = moveRevealedCheerCards(state, P1, [cards[0].instanceId], 'HAND');
    expect(moved).not.toBeNull();
    state = moved!.gameState;
    expect(selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(state, P1)).toHaveLength(6);
    const session = success(state, source);
    expect(session.state!.activeEffect?.effectText).toContain('有6张');
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(7);
    const replaced = addLiveModifier(state, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P1,
      fromColors: [HeartColor.ORANGE],
      toColor: HeartColor.BLUE,
    });
    const recolored = success(replaced, source);
    expect(recolored.state!.activeEffect?.effectText).toContain('有0张');
    expect(confirm(recolored, P1).success).toBe(true);
    expect(recolored.state!.liveResolution.playerScores.get(P1)).toBe(5);
    const five = success(facts(game, cards.slice(0, 5)), source);
    expect(confirm(five, P1).success).toBe(true);
    expect(five.state!.liveResolution.playerScores.get(P1)).toBe(5);
  });

  it('rechecks a captured source lifecycle on LIVE_SUCCESS and does not reward a reentered source', () => {
    const cards = Array.from({ length: 6 }, (_, i) => cheer(`orange-${i}`, orange));
    const { game, source } = setup(cards);
    let state = emitGameEvent(
      facts(game, cards),
      createEnterLiveZoneEvent(source.instanceId, ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    const event = createLiveSuccessEvent(P1, [source.instanceId], 5);
    state = enqueueTriggeredCardEffects(
      emitGameEvent(state, event),
      [TriggerCondition.ON_LIVE_SUCCESS],
      { liveSuccessEvents: [event] }
    );
    const session = sessionFor(resolvePendingCardEffects(state).gameState);
    setState(
      session,
      emitGameEvent(
        session.state!,
        createEnterLiveZoneEvent(
          source.instanceId,
          ZoneType.WAITING_ROOM,
          P1,
          P1,
          FaceState.FACE_UP
        )
      )
    );
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(5);
    expect(
      session.state!.liveResolution.liveModifiers.filter((modifier) => modifier.kind === 'SCORE')
    ).toEqual([]);
  });

  it('uses the common reveal path for additional/reroll/FREE batches without turning DRAW into an orange marker', () => {
    const cards = [
      cheer('first'),
      cheer('draw', [{ effect: BladeHeartEffect.DRAW }]),
      cheer('drawn'),
      cheer('reroll'),
      cheer('free'),
      cheer('sentinel'),
    ];
    const { game, source } = setup(cards);
    let state = updatePlayer(startGrant(game, source), P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    }));
    state = revealCheerCardsFromMainDeck(state, P1, 1).gameState;
    state = revealCheerCardsFromMainDeck(state, P1, 1, { additional: true }).gameState;
    expect(state.players[0].hand.cardIds).toEqual(['drawn']);
    expect(getCheerCardEffectiveBladeHearts(state, P1, 'draw')).toEqual([
      { effect: BladeHeartEffect.DRAW },
    ]);
    state = revealCheerCardsFromMainDeck(state, P1, 1, {
      replaceCurrentCheerCards: true,
    }).gameState;
    expect(state.liveResolution.firstPlayerCheerCardIds).toEqual(['reroll']);
    expect(
      selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(state, P1).map(
        ({ cardId }) => cardId
      )
    ).toEqual(['reroll']);
    const rerolled = liveResolver.processCheer([
      { cardId: 'reroll', bladeHearts: getCheerCardEffectiveBladeHearts(state, P1, 'reroll') },
    ]);
    expect(rerolled.bonusHearts.getColorCount(HeartColor.GRAY)).toBe(1);
    expect(rerolled.bonusHearts.getColorCount(HeartColor.ORANGE)).toBe(0);
    const session = sessionFor({
      ...state,
      manualOperationMode: 'FREE',
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      firstPlayerIndex: 0,
      activePlayerIndex: 0,
    });
    expect(session.executeCommand(createRevealCheerCardCommand(P1)).success).toBe(true);
    expect(getCheerCardEffectiveBladeHearts(session.state!, P1, 'free')).toEqual(orange);
    expect(session.state!.players[0].hand.cardIds).toEqual(['drawn']);
  });

  it('runs LIVE_START, normal RULES cheer, judgment and source success score through GameService and clears the rule at LIVE end', () => {
    const cards = Array.from({ length: 6 }, (_, i) => cheer(`blank-${i}`));
    const stageMember = member('TEST-BLADE', 'blade', P1, {
      cost: 1,
      blade: 6,
      hearts: [
        { color: HeartColor.PINK, count: 2 },
        { color: HeartColor.YELLOW, count: 2 },
        { color: HeartColor.PURPLE, count: 2 },
      ],
      bladeHearts: [],
    });
    const { game, source } = setup([...cards, stageMember]);
    let state = updatePlayer(stage(game, [stageMember]), P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    }));
    state = {
      ...state,
      manualOperationMode: 'RULES',
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      firstPlayerIndex: 0,
      activePlayerIndex: 0,
      effectWindowType: EffectWindowType.LIVE_START,
    };
    const service = new GameService();
    const checked = service.executeCheckTiming(state, [TriggerCondition.ON_LIVE_START]);
    expect(checked.success).toBe(true);
    const session = sessionFor(checked.gameState);
    expect(confirm(session, P1).success).toBe(true);
    const reveal = service.processAction(
      session.state!,
      createConfirmSubPhaseAction(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(reveal.success).toBe(true);
    expect(reveal.gameState.liveResolution.firstPlayerCheerCardIds).toHaveLength(6);
    const judged = service.processAction(reveal.gameState, {
      type: GameActionType.CONFIRM_JUDGMENT,
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: 1,
    });
    expect(judged.success).toBe(true);
    expect(judged.gameState.liveResolution.liveResults.get(source.instanceId)).toBe(true);
    expect(judged.gameState.liveResolution.playerLiveJudgmentHearts.get(P1)).toContainEqual({
      color: HeartColor.GRAY,
      count: 6,
    });
    expect(
      judged.gameState.liveResolution.playerLiveJudgmentHearts
        .get(P1)
        ?.some((heart) => heart.color === HeartColor.ORANGE)
    ).toBe(false);
    const scored = success(judged.gameState, source);
    expect(confirm(scored, P1).success).toBe(true);
    expect(scored.state!.liveResolution.playerScores.get(P1)).toBe(7);
    const ended = service.finalizeLiveResult({
      ...scored.state!,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      pendingAbilities: [],
      activeEffect: null,
    });
    expect(ended.success).toBe(true);
    expect(ended.gameState.liveResolution.liveModifiers).toEqual([]);
    expect(getCheerCardEffectiveBladeHearts(ended.gameState, P1, cards[0].instanceId)).toEqual([]);
  });
});
