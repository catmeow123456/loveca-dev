import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
  PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
  PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
  S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID,
  S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
  S_BP7_005_CONTINUOUS_AQOURS_HOST_WITH_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
  S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import invocationRows from '../fixtures/november-11-on-enter-invocation.json';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { GameService } from '../../src/application/game-service';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  type GameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(code: string, id: string, cost = 15) {
  const memberData: MemberCardData = {
    cardCode: code,
    name: id,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
  return createCardInstance(memberData, P1, id);
}

function energy(id: string, ownerId = P1) {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, ownerId, id);
}

function live(id: string, ownerId = P1) {
  const liveData: LiveCardData = {
    cardCode: id,
    name: id,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({}),
  };
  return createCardInstance(liveData, ownerId, id);
}

describe('PL!S-bp7-005-SEC 渡边曜', () => {
  it('常时效果以每张曜为真实来源、以每名下方有成员的 Aqours host 为显式目标，且实时影响实际声援数', () => {
    const sources = [member('PL!S-bp7-005-SEC', 'you-a'), member('PL!S-bp7-005-SEC', 'you-b')];
    const host = member('PL!S-test-host', 'aqours-host');
    const belowCards = [
      member('PL!S-test-below-a', 'below-a'),
      member('PL!S-test-below-b', 'below-b'),
      member('PL!S-test-below-host', 'below-host'),
    ];
    const cheerCards = Array.from({ length: 10 }, (_, index) => energy(`cheer-${index}`));
    let game = registerCards(createGameState('you-continuous-targets', P1, 'P1', P2, 'P2'), [
      ...sources,
      host,
      ...belowCards,
      ...cheerCards,
    ]);
    game = updatePlayer(game, P1, (player) => {
      let memberSlots = placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, sources[0]!.instanceId),
          SlotPosition.CENTER,
          sources[1]!.instanceId
        ),
        SlotPosition.RIGHT,
        host.instanceId
      );
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.LEFT, belowCards[0]!.instanceId);
      memberSlots = addMemberBelowMember(
        memberSlots,
        SlotPosition.CENTER,
        belowCards[1]!.instanceId
      );
      memberSlots = addMemberBelowMember(
        memberSlots,
        SlotPosition.RIGHT,
        belowCards[2]!.instanceId
      );
      return {
        ...player,
        memberSlots,
        mainDeck: { ...player.mainDeck, cardIds: cheerCards.map((card) => card.instanceId) },
      };
    });

    const modifiers = collectLiveModifiers(game).filter(
      (modifier) =>
        modifier.kind === 'BLADE' &&
        modifier.abilityId ===
          S_BP7_005_CONTINUOUS_AQOURS_HOST_WITH_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID
    );
    const targetIds = [...sources.map((source) => source.instanceId), host.instanceId];
    expect(modifiers).toHaveLength(6);
    for (const source of sources) {
      for (const targetMemberCardId of targetIds) {
        expect(modifiers).toContainEqual({
          kind: 'BLADE',
          target: 'TARGET_MEMBER',
          playerId: P1,
          countDelta: 1,
          sourceCardId: source.instanceId,
          targetMemberCardId,
          abilityId: S_BP7_005_CONTINUOUS_AQOURS_HOST_WITH_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
        });
      }
    }

    const afterCheer = (
      new GameService() as unknown as {
        autoRevealPerformanceCheer(state: GameState, playerId: string): GameState;
      }
    ).autoRevealPerformanceCheer(game, P1);
    expect(afterCheer.liveResolution.firstPlayerCheerCardIds).toHaveLength(9);

    const firstSourceLeft = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const afterSourceLeaves = collectLiveModifiers(firstSourceLeft).filter(
      (modifier) =>
        modifier.kind === 'BLADE' &&
        modifier.abilityId ===
          S_BP7_005_CONTINUOUS_AQOURS_HOST_WITH_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID
    );
    expect(afterSourceLeaves).toHaveLength(2);
    expect(afterSourceLeaves).toEqual(
      expect.arrayContaining(
        [sources[1]!.instanceId, host.instanceId].map((targetMemberCardId) =>
          expect.objectContaining({
            target: 'TARGET_MEMBER',
            sourceCardId: sources[1]!.instanceId,
            targetMemberCardId,
          })
        )
      )
    );

    const targetLeft = updatePlayer(firstSourceLeft, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
    }));
    expect(
      collectLiveModifiers(targetLeft).filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            S_BP7_005_CONTINUOUS_AQOURS_HOST_WITH_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        target: 'TARGET_MEMBER',
        sourceCardId: sources[1]!.instanceId,
        targetMemberCardId: sources[1]!.instanceId,
      }),
    ]);
  });

  it('ON_ENTER 可将休息室成员压到自身或其他顶层成员下方', () => {
    const you = member('PL!S-bp7-005-SEC', 'you');
    const host = member('HOST', 'host');
    const below = member('BELOW', 'below');
    let game = registerCards(createGameState('you-enter', P1, 'P1', P2, 'P2'), [you, host, below]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, below.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        host.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const pending: PendingAbilityState = {
      id: 'you-enter-pending',
      abilityId: S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
      sourceCardId: you.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [],
      sourceSlot: SlotPosition.CENTER,
    };
    const selectingMember = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pending],
    }).gameState;
    const selectingHost = confirmActiveEffectStep(
      selectingMember,
      P1,
      selectingMember.activeEffect!.id,
      below.instanceId
    );
    expect(selectingHost.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([you.instanceId, host.instanceId])
    );
    const done = confirmActiveEffectStep(
      selectingHost,
      P1,
      selectingHost.activeEffect!.id,
      host.instanceId
    );
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([below.instanceId]);
  });

  it('已入队 ON_ENTER 在来源曜离场后仍只重验当前休息室成员与当前 host', () => {
    const you = member('PL!S-bp7-005-SEC', 'you-left');
    const host = member('HOST', 'remaining-host');
    const below = member('BELOW', 'queued-below');
    let game = registerCards(createGameState('you-enter-source-left', P1, 'P1', P2, 'P2'), [
      you,
      host,
      below,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, below.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
        SlotPosition.RIGHT,
        host.instanceId
      ),
    }));
    const pending: PendingAbilityState = {
      id: 'you-left-enter-pending',
      abilityId: S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
      sourceCardId: you.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [],
      sourceSlot: SlotPosition.CENTER,
    };
    game = updatePlayer({ ...game, pendingAbilities: [pending] }, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const selectingMember = resolvePendingCardEffects(game).gameState;
    expect(selectingMember.activeEffect?.selectableCardIds).toContain(below.instanceId);
    const selectingHost = confirmActiveEffectStep(
      selectingMember,
      P1,
      selectingMember.activeEffect!.id,
      below.instanceId
    );
    expect(selectingHost.activeEffect?.selectableCardIds).toEqual([host.instanceId]);
    const done = confirmActiveEffectStep(
      selectingHost,
      P1,
      selectingHost.activeEffect!.id,
      host.instanceId
    );
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([below.instanceId]);
  });

  it('弃实际2手后允许选择两个 ON_ENTER 的顺序，子能力连续完成再回到全局', () => {
    const you = member('PL!S-bp7-005-SEC', 'you');
    const target = member('PL!S-bp7-002-P', 'target', 9);
    const discarded = [energy('discard-1'), energy('discard-2')];
    const drawn = member('DRAWN', 'drawn');
    let game = registerCards(createGameState('you-activated', P1, 'P1', P2, 'P2'), [
      you,
      target,
      ...discarded,
      drawn,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: discarded.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
      mainDeck: { ...player.mainDeck, cardIds: [drawn.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        target.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
    const started = activateCardAbility(
      game,
      P1,
      you.instanceId,
      S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
    );
    const selectingTarget = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      discarded.map((card) => card.instanceId)
    );
    expect(selectingTarget.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(discarded.map((card) => card.instanceId))
    );
    const selectingOrder = confirmActiveEffectStep(
      selectingTarget,
      P1,
      selectingTarget.activeEffect!.id,
      target.instanceId
    );
    expect(selectingOrder.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'source-first',
      'target-first',
    ]);
    const done = confirmActiveEffectStep(
      selectingOrder,
      P1,
      selectingOrder.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'source-first'
    );
    expect(done.delegatedAbilitySequence).toBeNull();
    expect(done.players[0].hand.cardIds).toContain(drawn.instanceId);
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    const sequenceActions = done.actionHistory.filter((action) =>
      ['START_DELEGATED_ON_ENTER_SEQUENCE', 'DELEGATED_ABILITY_SEQUENCE_COMPLETE'].includes(
        String(action.payload.step)
      )
    );
    expect(sequenceActions.map((action) => action.payload.step)).toEqual([
      'START_DELEGATED_ON_ENTER_SEQUENCE',
      'DELEGATED_ABILITY_SEQUENCE_COMPLETE',
    ]);
    expect(sequenceActions[1]?.payload.resolvedPendingAbilityIds).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`:${you.instanceId}:`),
        expect.stringContaining(`:${target.instanceId}:`),
      ])
    );
    expect(sequenceActions[1]?.payload.resolvedAbilityIds).toEqual(
      expect.arrayContaining([
        S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
        S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID,
      ])
    );
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId === S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('手牌不足2时不能发动且不消耗 turn1', () => {
    const you = member('PL!S-bp7-005-SEC', 'you');
    const target = member('PL!S-bp7-002-P', 'target', 9);
    const one = energy('one');
    let game = registerCards(createGameState('you-short-hand', P1, 'P1', P2, 'P2'), [
      you,
      target,
      one,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, one.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
        SlotPosition.RIGHT,
        target.instanceId
      ),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
    const result = activateCardAbility(
      game,
      P1,
      you.instanceId,
      S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
    );
    expect(result).toBe(game);
    expect(
      result.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
          S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
      )
    ).toBe(false);
  });

  it.each([
    [
      'PL!S-pb1-001-R',
      PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
      'waiting-live',
      2,
    ],
    [
      'PL!S-pb1-002-R',
      PL_S_PB1_002_ON_ENTER_OPPONENT_DISCARD_LIVE_OR_SOURCE_SCORE_ABILITY_ID,
      null,
      1,
    ],
    [
      'PL!S-bp5-004-R',
      PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
      null,
      0,
    ],
  ] as const)(
    '通过曜的真实 runner 委托打开 %s 的历史 ON_ENTER workflow',
    (targetCardCode, expectedAbilityId, waitingLiveId, opponentHandCount) => {
      const you = member('PL!S-bp7-005-SEC', `you:${targetCardCode}`);
      const target = member(targetCardCode, `target:${targetCardCode}`);
      const discarded = [
        energy(`discard-1:${targetCardCode}`),
        energy(`discard-2:${targetCardCode}`),
      ];
      const waitingLive = waitingLiveId ? live(`${waitingLiveId}:${targetCardCode}`) : null;
      const opponentCards = Array.from({ length: opponentHandCount }, (_, index) =>
        index === 0 && targetCardCode === 'PL!S-pb1-002-R'
          ? live(`opponent-live:${targetCardCode}`, P2)
          : energy(`opponent-card-${index}:${targetCardCode}`, P2)
      );
      let game = registerCards(
        createGameState(`you-delegates:${targetCardCode}`, P1, 'P1', P2, 'P2'),
        [you, target, ...discarded, ...opponentCards, ...(waitingLive ? [waitingLive] : [])]
      );
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        hand: discarded.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
        waitingRoom: waitingLive
          ? addCardToZone(player.waitingRoom, waitingLive.instanceId)
          : player.waitingRoom,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
          SlotPosition.RIGHT,
          target.instanceId
        ),
      }));
      game = updatePlayer(game, P2, (player) => ({
        ...player,
        hand: opponentCards.reduce(
          (zone, card) => addCardToZone(zone, card.instanceId),
          player.hand
        ),
      }));
      game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };

      const discardWindow = activateCardAbility(
        game,
        P1,
        you.instanceId,
        S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
      );
      const targetWindow = confirmActiveEffectStep(
        discardWindow,
        P1,
        discardWindow.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        discarded.map((card) => card.instanceId)
      );
      const orderWindow = confirmActiveEffectStep(
        targetWindow,
        P1,
        targetWindow.activeEffect!.id,
        target.instanceId
      );
      const delegated = confirmActiveEffectStep(
        orderWindow,
        P1,
        orderWindow.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'target-first'
      );

      expect(delegated.delegatedAbilitySequence).not.toBeNull();
      expect(delegated.activeEffect).toMatchObject({
        abilityId: expectedAbilityId,
        sourceCardId: target.instanceId,
      });
    }
  );
});

// Narrow member snapshot from the user-designated cards_export_2026-11-07.json.
function invocationMemberData(cardCode: string): MemberCardData {
  const data = invocationRows[cardCode as keyof typeof invocationRows];
  expect(data).toBeDefined();
  return structuredClone(data) as unknown as MemberCardData;
}
function createYouRulesSession(targetCode: string | null, sourceCode = 'PL!S-bp7-005-SEC') {
  const you = createCardInstance(invocationMemberData(sourceCode), P1, 'rules-you');
  const target = targetCode
    ? createCardInstance(invocationMemberData(targetCode), P1, 'rules-target')
    : null;
  const below = createCardInstance(invocationMemberData('PL!S-sd1-008-SD'), P1, 'rules-below');
  const discarded = [energy('rules-discard-1'), energy('rules-discard-2')];
  const deck = [energy('rules-deck-1'), energy('rules-deck-2'), energy('rules-deck-3')];
  let game = registerCards(createGameState('you-qa-rules', P1, 'P1', P2, 'P2'), [
    you,
    below,
    ...discarded,
    ...deck,
    ...(target ? [target] : []),
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: discarded.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: [below.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots: target
      ? placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
          SlotPosition.RIGHT,
          target.instanceId
        )
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, you.instanceId),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
    manualOperationMode: 'RULES',
  };
  const session = createGameSession();
  session.createGame('you-qa-rules', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}
function payYouRulesCost(session: ReturnType<typeof createYouRulesSession>) {
  const started = session.executeCommand(
    createActivateAbilityCommand(
      P1,
      'rules-you',
      S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
    )
  );
  expect(started.success, started.error).toBe(true);
  const beforeInvalid = session.state!;
  const invalid = session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['rules-discard-1', 'rules-discard-1']
    )
  );
  expect(invalid.success).toBe(false);
  expect(session.state!.players[0].hand.cardIds).toEqual(beforeInvalid.players[0].hand.cardIds);
  expect(session.state!.actionHistory.filter((action) => action.type === 'PAY_COST')).toEqual([]);
  const paid = session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['rules-discard-1', 'rules-discard-2']
    )
  );
  expect(paid.success, paid.error).toBe(true);
}
function finishYouRulesStack(session: ReturnType<typeof createYouRulesSession>) {
  expect(session.state!.activeEffect?.abilityId).toBe(
    S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID
  );
  for (const cardId of ['rules-below', 'rules-you']) {
    const result = session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, cardId)
    );
    expect(result.success, result.error).toBe(true);
  }
  expect(session.state!.activeEffect).toBeNull();
  expect(session.state!.delegatedAbilitySequence ?? null).toBeNull();
}

describe('PL!S-bp7-005 费用15「渡边曜」Q306–308 RULES commands', () => {
  it('Q306 rejects activation with no other Aqours and leaves both cost and turn limit unused', () => {
    const session = createYouRulesSession(null);
    const before = session.state!;
    expect(
      session.executeCommand(
        createActivateAbilityCommand(
          P1,
          'rules-you',
          S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
        )
      ).success
    ).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toEqual(before.players[0].hand.cardIds);
    expect(
      session.state!.actionHistory.filter((action) => action.payload.step === 'ABILITY_USE')
    ).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });
  it.each(['PL!S-bp7-005-P', 'PL!S-bp7-005-P+', 'PL!S-bp7-005-R+', 'PL!S-bp7-005-SEC'])(
    'Q307 %s selects an Aqours with only LIVE_START, skips its absent ON_ENTER, and completes You',
    (sourceCode) => {
      const session = createYouRulesSession('PL!S-sd1-004-SD', sourceCode);
      payYouRulesCost(session);
      expect(session.state!.activeEffect?.selectableCardIds).toEqual(['rules-target']);
      const beforeInvalid = session.state!;
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'rules-you')
        ).success
      ).toBe(false);
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      expect(session.state!.activeEffect).toEqual(beforeInvalid.activeEffect);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'rules-target')
        ).success
      ).toBe(true);
      finishYouRulesStack(session);
      expect(session.state!.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toContain(
        'rules-below'
      );
      expect(session.state!.actionHistory).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            step: 'START_DELEGATED_ON_ENTER_SEQUENCE',
            delegatedAbilityIds: [
              S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
            ],
            delegatedSourceCardIds: ['rules-you'],
          }),
        })
      );
      expect(
        session.state!.actionHistory.filter((action) => action.type === 'PAY_COST')
      ).toHaveLength(1);
      expect(
        session.executeCommand(
          createActivateAbilityCommand(
            P1,
            'rules-you',
            S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID
          )
        ).success
      ).toBe(false);
      expect(
        session.state!.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE
        )
      ).toEqual([]);
    }
  );
  it('Q307 preserves the paid cost and finishes if the chosen target has left before confirmation', () => {
    const session = createYouRulesSession('PL!S-sd1-004-SD');
    payYouRulesCost(session);
    const stale = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
      waitingRoom: addCardToZone(player.waitingRoom, 'rules-target'),
    }));
    (session as unknown as { authorityState: GameState }).authorityState = stale;
    const result = session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'rules-target')
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.delegatedAbilitySequence ?? null).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('rules-below');
    expect(
      session.state!.actionHistory.filter((action) => action.type === 'PAY_COST')
    ).toHaveLength(1);
  });
  it.each(['rules-you', 'rules-target'])(
    'keeps the paid selection bound to its original lifecycle when %s leaves and re-enters',
    (reenteredCardId) => {
      const session = createYouRulesSession('PL!S-bp6-011-N');
      payYouRulesCost(session);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'rules-target')
        ).success
      ).toBe(true);
      const reentered = emitGameEvent(
        session.state!,
        createEnterStageEvent(
          reenteredCardId,
          ZoneType.WAITING_ROOM,
          reenteredCardId === 'rules-you' ? SlotPosition.CENTER : SlotPosition.RIGHT,
          P1,
          P1
        )
      );
      (session as unknown as { authorityState: GameState }).authorityState = reentered;
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            session.state!.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            'source-first'
          )
        ).success
      ).toBe(true);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.delegatedAbilitySequence ?? null).toBeNull();
      expect(session.state!.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
      expect(
        session.state!.actionHistory.filter((action) => action.type === 'PAY_COST')
      ).toHaveLength(1);
    }
  );
  it.each(['source-first', 'target-first'])(
    'Q308 %s does not treat an earlier waiting-room entry as the invoked Riko entry, and continues the other ability',
    (order) => {
      const session = createYouRulesSession('PL!S-bp6-011-N');
      const withHistory = emitGameEvent(
        session.state!,
        createEnterStageEvent('rules-target', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, P1, P1)
      );
      (session as unknown as { authorityState: GameState }).authorityState = withHistory;
      payYouRulesCost(session);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'rules-target')
        ).success
      ).toBe(true);
      const ordered = session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          order
        )
      );
      expect(ordered.success, ordered.error).toBe(true);
      finishYouRulesStack(session);
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      expect(session.state!.players[0].mainDeck.cardIds).toEqual([
        'rules-deck-1',
        'rules-deck-2',
        'rules-deck-3',
      ]);
      expect(session.state!.actionHistory).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            abilityId: S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
            step: 'ON_ENTER_SOURCE_ZONE_MISMATCH',
            actualFromZone: null,
          }),
        })
      );
      expect(
        session.state!.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE
        )
      ).toHaveLength(1);
      const complete = session.state!.actionHistory.find(
        (action) => action.payload.step === 'DELEGATED_ABILITY_SEQUENCE_COMPLETE'
      );
      expect(complete?.payload.resolvedAbilityIds).toEqual(
        order === 'source-first'
          ? [
              S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
              S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
            ]
          : [
              S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
              S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
            ]
      );
    }
  );
});
