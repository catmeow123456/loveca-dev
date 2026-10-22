import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_BP8_011_LIVE_START_SUCCESS_SCORE_SIX_WAIT_ORIGINAL_BLADE_THREE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createLeaveStageEvent,
  createLiveStartEvent,
} from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  sumSuccessfulLiveScore,
  sumSuccessfulLiveScoreForCardEffect,
} from '../../src/domain/rules/success-live-score';
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

const P1 = 'p1';
const P2 = 'p2';
const TEXT =
  '【LIVE开始时】存在于自己的成功LIVE卡区的卡片的分数合计大于等于６的场合，将存在于对方的舞台的１名原本持有的[ブレード]的数量小于等于３的成员变为待机状态。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）';

function member(code: string, id: string, blade: number, owner = P1, cost = 1) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, owner, id);
}
function live(score: number, id: string, owner = P1) {
  return createCardInstance(
    {
      cardCode: `TEST-${id}`,
      name: id,
      cardType: CardType.LIVE,
      score,
      requirements: createHeartRequirement({}),
    },
    owner,
    id
  );
}
function setup(
  options: { code?: string; scores?: number[]; umi?: boolean; target?: boolean } = {}
) {
  // Local exported card fixtures; synthetic targets and LIVE cards isolate numeric thresholds.
  const source = createCardInstance(
    {
      cardCode: options.code ?? 'PL!-bp8-011-N',
      name: '绚濑绘里',
      cardType: CardType.MEMBER,
      cost: 5,
      blade: 2,
      groupNames: ['μ’s'],
      unitName: 'BiBi',
      hearts: [createHeartIcon(HeartColor.YELLOW, 1), createHeartIcon(HeartColor.PURPLE, 1)],
    },
    P1,
    'eli'
  );
  const umi = createCardInstance(
    {
      cardCode: 'PL!-bp8-013-N',
      name: '园田海未',
      cardType: CardType.MEMBER,
      cost: 2,
      blade: 1,
      groupNames: ['μ’s'],
      unitName: 'lily white',
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    P1,
    'umi'
  );
  const low = member('TEST-BLADE-THREE', 'low', 3, P2);
  const high = member('TEST-BLADE-FOUR', 'high', 4, P2);
  const waiting = member('TEST-WAITING', 'waiting', 0, P2);
  const scores = (options.scores ?? [3, 3]).map((score, i) => live(score, `success-${i}`));
  const current = live(0, 'current-live');
  const deck = member('TEST-DECK', 'deck', 0);
  const enemyDeck = member('TEST-ENEMY-DECK', 'enemy-deck', 0, P2);
  let game = registerCards(createGameState('bp8-011', P1, 'P1', P2, 'P2'), [
    source,
    umi,
    low,
    high,
    waiting,
    ...scores,
    current,
    deck,
    enemyDeck,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['deck'] },
    successZone: { ...player.successZone, cardIds: scores.map((card) => card.instanceId) },
    liveZone: addCardToStatefulZone(player.liveZone, 'current-live', { face: FaceState.FACE_UP }),
    memberSlots: placeCardInSlot(
      options.umi
        ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'umi')
        : player.memberSlots,
      SlotPosition.CENTER,
      'eli'
    ),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['enemy-deck'] },
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        options.target === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'low'),
        SlotPosition.CENTER,
        'high'
      ),
      SlotPosition.RIGHT,
      'waiting',
      { orientation: OrientationState.WAITING }
    ),
  }));
  return { game, source, low, high };
}
function start(game: GameState): GameState {
  const event = createLiveStartEvent(P1, ['current-live']);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_LIVE_START])
  ).gameState;
}
function select(game: GameState, id: string | null) {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, id);
}
function waitEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
}

describe('PL!-bp8-011 费用5 绚濑绘里', () => {
  it.each(['N', 'P', 'P+', 'SEC', 'UNSEEN'])(
    'covers every rarity with complete Chinese text: %s',
    (rarity) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!-bp8-011-${rarity}`);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        abilityId: ABILITY,
        baseCardCodes: ['PL!-bp8-011'],
        category: 'LIVE_START',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
        effectText: TEXT,
      });
      expect(definitions[0]?.cardCodes).toBeUndefined();
      expect(start(setup({ code: `PL!-bp8-011-${rarity}` }).game).activeEffect?.effectText).toBe(
        TEXT
      );
    }
  );

  it('enters the real RULES LIVE-start check window and resolves through commands', () => {
    let game = setup().game;
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      liveSetCompletedPlayers: [P1],
    };
    const session = createGameSession();
    session.createGame('bp8-011', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;
    session.setManualOperationMode('RULES');
    const begun = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(begun.success, begun.error).toBe(true);
    expect(session.state!.eventLog.map((entry) => entry.event)).toContainEqual(
      expect.objectContaining({
        eventType: TriggerCondition.ON_LIVE_START,
        performerId: P1,
        liveCardIds: ['current-live'],
      })
    );
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      effectText: TEXT,
      selectableCardIds: ['low'],
      confirmSelectionLabel: '变为待机状态',
    });
    const done = session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'low')
    );
    expect(done.success, done.error).toBe(true);
    expect(session.state!.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(waitEvents(session.state!)).toEqual([
      expect.objectContaining({
        cardInstanceId: 'low',
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: expect.objectContaining({
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: 'eli',
          abilityId: ABILITY,
        }),
      }),
    ]);
  });

  it.each([0, 5])(
    'requires the successful-LIVE score threshold at %s and confirms the current no-op result',
    (score) => {
      const choosing = start(setup({ scores: [score] }).game);
      expect(choosing.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
      expect(choosing.activeEffect?.effectText).toContain(
        `当前自己的成功LIVE卡区卡效参照分数合计为${score}`
      );
      expect(choosing.activeEffect?.effectText).toContain('条件未满足');
      const done = select(choosing, null);
      expect(done.activeEffect).toBeNull();
      expect(waitEvents(done)).toEqual([]);
    }
  );

  it.each([6, 7])('allows the threshold at %s', (score) => {
    const choosing = start(setup({ scores: [score] }).game);
    expect(choosing.activeEffect?.selectableCardIds).toEqual(['low']);
    expect(select(choosing, 'low').players[1].memberSlots.cardStates.get('low')?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('feeds Umi card-effect score +2 into the gate without altering the real successful score', () => {
    const { game } = setup({ scores: [4], umi: true });
    expect(sumSuccessfulLiveScore(game, P1)).toBe(4);
    expect(sumSuccessfulLiveScoreForCardEffect(game, P1, 'eli', [P1])).toBe(6);
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['low']);
    expect(start(setup({ scores: [], umi: true }).game).activeEffect?.stepId).toBe(
      'CONFIRM_ONLY_EFFECT'
    );
  });

  it('does not count non-LIVE cards or opponent successful scores toward its own gate', () => {
    const extra = live(10, 'opponent-success', P2);
    let game = registerCards(setup({ scores: [5] }).game, [extra]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: ['success-0', 'umi', 'missing'] },
    }));
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [extra.instanceId] },
    }));
    expect(start(game).activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
  });

  it('uses original BLADE with replacements and excludes ordinary additions or reductions', () => {
    let game = addLiveModifier(setup().game, {
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: P2,
      sourceCardId: 'low',
      abilityId: 'test:bonus',
      countDelta: 10,
    });
    game = addLiveModifier(game, {
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: P2,
      sourceCardId: 'high',
      abilityId: 'test:reduction',
      countDelta: -1,
    });
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['low']);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P2,
      memberCardId: 'high',
      sourceCardId: 'high',
      abilityId: 'test:original',
      count: 3,
    });
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['low', 'high']);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P2,
      memberCardId: 'low',
      sourceCardId: 'low',
      abilityId: 'test:original-high',
      count: 4,
    });
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['high']);
  });

  it('confirms no legal targets and ends without state events', () => {
    const choosing = start(setup({ target: false }).game);
    expect(choosing.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(choosing.activeEffect?.effectText).toContain('分数合计为6');
    expect(choosing.activeEffect?.effectText).toContain('条件已满足');
    const done = select(choosing, null);
    expect(done.activeEffect).toBeNull();
    expect(waitEvents(done)).toEqual([]);
  });

  it('rejects foreign, high-BLADE, already-waiting, skipped and duplicate selections', () => {
    const choosing = start(setup().game);
    for (const id of ['eli', 'high', 'waiting', 'unknown', null])
      expect(select(choosing, id)).toBe(choosing);
    expect(confirmActiveEffectStep(choosing, P2, choosing.activeEffect!.id, 'low')).toBe(choosing);
    for (const ids of [[], ['low'], ['low', 'low'], ['low', 'high']]) {
      expect(
        confirmActiveEffectStep(
          choosing,
          P1,
          choosing.activeEffect!.id,
          undefined,
          undefined,
          false,
          undefined,
          ids
        )
      ).toBe(choosing);
    }
    expect(
      confirmActiveEffectStep(
        choosing,
        P1,
        choosing.activeEffect!.id,
        'low',
        undefined,
        false,
        'activate'
      )
    ).toBe(choosing);
    const done = select(choosing, 'low');
    expect(confirmActiveEffectStep(done, P1, choosing.activeEffect!.id, 'low')).toBe(done);
    expect(waitEvents(done)).toHaveLength(1);
  });

  it.each(['score-gate', 'original-blade', 'already-waiting', 'left-stage', 'reentered-stage'])(
    'revalidates submission against %s',
    (kind) => {
      let game = start(setup().game);
      if (kind === 'score-gate')
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          successZone: { ...player.successZone, cardIds: ['success-0'] },
        }));
      if (kind === 'original-blade')
        game = addLiveModifier(game, {
          kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
          playerId: P2,
          memberCardId: 'low',
          sourceCardId: 'low',
          abilityId: 'test:changed-original',
          count: 4,
        });
      if (kind === 'already-waiting')
        game = updatePlayer(game, P2, (player) => ({
          ...player,
          memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'low', {
            orientation: OrientationState.WAITING,
          }),
        }));
      if (kind === 'left-stage' || kind === 'reentered-stage') {
        game = updatePlayer(game, P2, (player) => ({
          ...player,
          memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        }));
        game = emitGameEvent(
          game,
          createLeaveStageEvent('low', SlotPosition.LEFT, ZoneType.HAND, P2, P2)
        );
        if (kind === 'reentered-stage') {
          game = updatePlayer(game, P2, (player) => ({
            ...player,
            memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'low'),
          }));
          game = emitGameEvent(
            game,
            createEnterStageEvent('low', ZoneType.HAND, SlotPosition.RIGHT, P2, P2)
          );
        }
      }
      const done = select(game, 'low');
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(waitEvents(done)).toEqual([]);
    }
  );
});
