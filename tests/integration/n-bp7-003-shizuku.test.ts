import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
  N_BP7_003_LIVE_START_DIFFERENT_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  queryActivatedAbilityStart,
  resolveActivatedAbilityWithRegistry,
} from '../../src/application/card-effects/runtime/activated-registry';
import { hasRemainingLimitedActivatedAbilityForStageMember } from '../../src/application/card-effects/runtime/limited-activated-ability-status';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { clearPreviousStageMemberInstanceState } from '../../src/application/effects/member-state';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { removeStageMemberBoundLiveModifiers } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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
import { prepareShizukuRole } from '../helpers/shizuku-role-fixture';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY = N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID;
const RARITIES = ['P', 'P+', 'R+', 'SEC'] as const;

function member(
  code: string,
  id: string,
  options: {
    groups?: readonly string[];
    cost?: number;
    hearts?: ReturnType<typeof createHeartIcon>[];
    name?: string;
  } = {}
) {
  return createCardInstance(
    {
      cardCode: code,
      name: options.name ?? id,
      groupNames: options.groups ?? ['虹ヶ咲'],
      cardType: CardType.MEMBER,
      cost: options.cost ?? 5,
      blade: 1,
      hearts: options.hearts ?? [createHeartIcon(HeartColor.RED, 1)],
    },
    P1,
    id
  );
}

function livePending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'shizuku-live-start-pending',
    abilityId: N_BP7_003_LIVE_START_DIFFERENT_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolveLiveStart(game: GameState): GameState {
  const started = resolvePendingCardEffects(game).gameState;
  return started.activeEffect
    ? confirmActiveEffectStep(started, P1, started.activeEffect.id)
    : started;
}

function setup(rarity: string = 'SEC') {
  const shizuku = member(`PL!N-bp7-003-${rarity}`, 'shizuku', { cost: 15 });
  const target = member('TARGET', 'target', {
    hearts: [createHeartIcon(HeartColor.BLUE, 2), createHeartIcon(HeartColor.GREEN, 1)],
  });
  const invalidGroup = member('INVALID-GROUP', 'invalid-group', { groups: ['Aqours'] });
  const tooExpensive = member('TOO-EXPENSIVE', 'too-expensive', { cost: 18 });
  const fillers = [
    member('FILLER-1', 'filler-1'),
    member('FILLER-2', 'filler-2'),
    member('SENTINEL', 'sentinel'),
  ];
  const deck = [target, invalidGroup, tooExpensive, ...fillers];
  let game = registerCards(createGameState('shizuku-bp7', P1, 'P1', P2, 'P2'), [shizuku, ...deck]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, shizuku.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
  return { game, shizuku, target, invalidGroup, tooExpensive };
}

function rulesSession(game: GameState) {
  const session = createGameSession({ now: () => 1000 });
  session.restoreRuntimeState({
    authorityState: {
      ...game,
      isStarted: true,
      waitingForInput: false,
      waitingPlayerId: null,
      manualOperationMode: 'RULES',
    },
    currentPublicSeq: 0,
  });
  return session;
}

function abilityUses(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.payload.abilityId === ABILITY && action.payload.step === 'ABILITY_USE'
  );
}

function costPayments(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.payload.abilityId === ABILITY && action.type === 'PAY_COST'
  );
}

describe('PL!N-bp7-003 费用15 樱坂雫', () => {
  it.each(RARITIES.flatMap((rarity) => [0, 1, 2, 3, 4].map((count) => [rarity, count] as const)))(
    '%s 当前主卡组仅有%d张时不能借休息室更新补足顶5费用，查询与命令一致拒绝',
    (rarity, deckCount) => {
      const { game, shizuku } = setup(rarity);
      const cards = game.players[0].mainDeck.cardIds;
      const insufficient = updatePlayer(game, P1, (player) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: cards.slice(0, deckCount) },
        waitingRoom: { ...player.waitingRoom, cardIds: cards.slice(deckCount) },
      }));
      const before = structuredClone(insufficient);
      expect(queryActivatedAbilityStart(insufficient, P1, shizuku.instanceId, ABILITY)).toBe(false);
      expect(insufficient).toEqual(before);
      expect(
        resolveActivatedAbilityWithRegistry(insufficient, P1, shizuku.instanceId, ABILITY)
      ).toBe(insufficient);
      const result = activateCardAbility(insufficient, P1, shizuku.instanceId, ABILITY);
      expect(result).toBe(insufficient);
      expect(result).toEqual(before);
      expect(result.eventLog).toEqual(before.eventLog);
      expect(result.actionHistory).toEqual(before.actionHistory);
      expect(costPayments(result)).toEqual([]);
      expect(abilityUses(result)).toEqual([]);

      const session = rulesSession(insufficient);
      const authorityBefore = session.state!;
      const command = session.executeCommand(
        createActivateAbilityCommand(P1, shizuku.instanceId, ABILITY)
      );
      expect(command.success).toBe(false);
      expect(session.state).toBe(authorityBefore);
      expect(session.state!.actionHistory).toEqual(before.actionHistory);
      expect(session.state!.eventLog).toEqual(before.eventLog);
    }
  );

  it.each(RARITIES)(
    '%s 恰好5张先完整支付，再更新整批费用牌和既有休息室；无后续目标仍消耗费用和次数',
    (rarity) => {
      const { game, shizuku } = setup(rarity);
      const cards = game.players[0].mainDeck.cardIds;
      const movedCardIds = cards.slice(0, 5);
      const exact = updatePlayer(game, P1, (player) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: movedCardIds },
        waitingRoom: { ...player.waitingRoom, cardIds: cards.slice(5) },
      }));
      const before = structuredClone(exact);
      expect(queryActivatedAbilityStart(exact, P1, shizuku.instanceId, ABILITY)).toBe(true);
      expect(hasRemainingLimitedActivatedAbilityForStageMember(exact, P1, shizuku.instanceId)).toBe(
        true
      );
      expect(
        projectPlayerViewState(exact, P1).objects.obj_shizuku.activatedAbilityUiConfigs
      ).toEqual([expect.objectContaining({ abilityId: ABILITY })]);
      expect(exact).toEqual(before);

      const session = rulesSession(exact);
      expect(
        session.executeCommand(createActivateAbilityCommand(P1, shizuku.instanceId, ABILITY))
          .success
      ).toBe(true);
      const paid = session.state!;
      expect(costPayments(paid)).toHaveLength(1);
      expect(costPayments(paid)[0].payload).toMatchObject({ movedCardIds, refreshCount: 1 });
      expect(abilityUses(paid)).toHaveLength(1);
      expect(paid.players[0].mainDeck.cardIds.toSorted()).toEqual(cards.toSorted());
      expect(paid.players[0].waitingRoom.cardIds).toEqual([]);
      const refreshActions = paid.actionHistory.filter(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      );
      expect(refreshActions).toHaveLength(1);
      expect(refreshActions[0].payload).toMatchObject({ movedCount: 6, mainDeckCountAfter: 6 });
      const millEvents = paid.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      );
      expect(millEvents).toHaveLength(1);
      expect(millEvents[0].event).toMatchObject({
        fromZone: ZoneType.MAIN_DECK,
        toZone: ZoneType.WAITING_ROOM,
        cardInstanceIds: movedCardIds,
        cause: {
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: shizuku.instanceId,
          abilityId: ABILITY,
        },
      });
      const refreshEvents = paid.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
      expect(refreshEvents).toHaveLength(1);
      expect(refreshEvents[0].event).toMatchObject({
        movedCardIds: expect.arrayContaining(cards),
        cause: { kind: 'RULE_ACTION', ruleAction: 'REFRESH' },
      });
      expect(paid.activeEffect?.revealedCardIds).toEqual(movedCardIds);
      expect(paid.activeEffect?.stepText).toBe(
        '已将卡组顶合计5张放置入休息室。支付费用后发生卡组更新。'
      );
      for (const viewer of [P1, P2]) {
        expect(projectPlayerViewState(paid, viewer).activeEffect?.revealedObjectIds).toEqual(
          movedCardIds.map(createPublicObjectId)
        );
      }
      const done = confirmActiveEffectStep(paid, P1, paid.activeEffect!.id);
      expect(done.activeEffect).toBeNull();
      expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
      expect(done.liveResolution.liveModifiers).toEqual([]);
      expect(
        done.actionHistory.filter(
          (action) => action.payload.step === 'PAID_NO_ELIGIBLE_WAITING_MEMBER'
        )
      ).toHaveLength(1);
      expect(costPayments(done)).toHaveLength(1);
      expect(abilityUses(done)).toHaveLength(1);
      expect(activateCardAbility(done, P1, shizuku.instanceId, ABILITY)).toBe(done);
      expect(hasRemainingLimitedActivatedAbilityForStageMember(done, P1, shizuku.instanceId)).toBe(
        false
      );
    }
  );

  it.each(RARITIES)('%s 当前主卡组有6张时只支付原顶5，无更新并保留后续下置', (rarity) => {
    const { game, shizuku, target } = setup(rarity);
    const cards = game.players[0].mainDeck.cardIds;
    const session = rulesSession(game);
    const view = session.getPlayerViewState(P1)!;
    expect(view.objects.obj_shizuku.activatedAbilityUiConfigs).toEqual([
      expect.objectContaining({ abilityId: ABILITY }),
    ]);
    expect(view.objects.obj_shizuku.hasRemainingLimitedActivatedAbility).toBe(true);
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, shizuku.instanceId, ABILITY)).success
    ).toBe(true);
    const paid = session.state!;
    expect(paid.players[0].mainDeck.cardIds).toEqual(cards.slice(5));
    expect(paid.players[0].waitingRoom.cardIds).toEqual(cards.slice(0, 5));
    expect(costPayments(paid)[0].payload).toMatchObject({
      movedCardIds: cards.slice(0, 5),
      refreshCount: 0,
    });
    expect(
      paid.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(false);
    const selecting = confirmActiveEffectStep(paid, P1, paid.activeEffect!.id);
    const done = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      target.instanceId
    );
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      target.instanceId,
    ]);
    expect(costPayments(done)).toHaveLength(1);
    expect(abilityUses(done)).toHaveLength(1);
  });

  it('投影可发动后主卡组缩为4张时，服务器重新校验而不支付或更新', () => {
    const { game, shizuku } = setup();
    const session = rulesSession(game);
    expect(
      session.getPlayerViewState(P1)!.objects.obj_shizuku.activatedAbilityUiConfigs
    ).toHaveLength(1);
    const cards = game.players[0].mainDeck.cardIds;
    const stale = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: cards.slice(0, 4) },
      waitingRoom: { ...player.waitingRoom, cardIds: cards.slice(4) },
    }));
    session.restoreRuntimeState({ authorityState: stale, currentPublicSeq: 0 });
    const before = session.state!;
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, shizuku.instanceId, ABILITY)).success
    ).toBe(false);
    expect(session.state).toBe(before);
    expect(session.state!.actionHistory).toEqual([]);
    expect(session.state!.eventLog).toEqual([]);
  });

  it('没有可下置的虹咲成员时仍可完整支付费用，结束后不退款也不退次数', () => {
    const { game, shizuku } = setup();
    const fillers = Array.from({ length: 7 }, (_, index) =>
      member(`AQOURS-${index}`, `aqours-${index}`, { groups: ['Aqours'] })
    );
    const withoutTargets = updatePlayer(registerCards(game, fillers), P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: fillers.map((card) => card.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));
    expect(queryActivatedAbilityStart(withoutTargets, P1, shizuku.instanceId, ABILITY)).toBe(true);
    const paid = activateCardAbility(withoutTargets, P1, shizuku.instanceId, ABILITY);
    const done = confirmActiveEffectStep(paid, P1, paid.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds).toEqual(
      fillers.slice(5).map((card) => card.instanceId)
    );
    expect(done.players[0].waitingRoom.cardIds).toEqual(
      fillers.slice(0, 5).map((card) => card.instanceId)
    );
    expect(costPayments(done)).toHaveLength(1);
    expect(abilityUses(done)).toHaveLength(1);
    expect(activateCardAbility(done, P1, shizuku.instanceId, ABILITY)).toBe(done);
  });

  it('恰好5张且包含米娅时保留整批入室事实，更新后的来源不能打断当前公开展示', () => {
    const fixture = prepareShizukuRole({ queuedMia: true, mode: 'OFF' });
    const movedCardIds = fixture.session.state!.players[0].mainDeck.cardIds.slice(0, 5);
    fixture.commit(
      updatePlayer(fixture.session.state!, P1, (player) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: movedCardIds },
      }))
    );
    expect(movedCardIds).toContain('mia');
    expect(fixture.activate().success).toBe(true);
    const paid = fixture.session.state!;
    expect(paid.activeEffect?.abilityId).toBe(ABILITY);
    expect(paid.activeEffect?.revealedCardIds).toEqual(movedCardIds);
    expect(paid.players[0].waitingRoom.cardIds).toEqual([]);
    expect(paid.players[0].mainDeck.cardIds).toContain('mia');
    const millEvents = paid.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(millEvents).toHaveLength(1);
    expect(millEvents[0].event).toMatchObject({ cardInstanceIds: movedCardIds });
    expect(paid.actionHistory.some((action) => action.payload.sourceCardId === 'mia')).toBe(false);
    expect(fixture.reveal().success).toBe(true);
    const done = fixture.session.state!;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].hand.cardIds).toEqual(['payment']);
    expect(costPayments(done)).toHaveLength(1);
    expect(abilityUses(done)).toHaveLength(1);
    expect(
      done.actionHistory.some((action) => action.payload.step === 'PAID_NO_ELIGIBLE_WAITING_MEMBER')
    ).toBe(true);
  });

  it('先公开顶5费用，再从当前休息室结构化选择并快照完整印刷 Heart', () => {
    const { game, shizuku, target, invalidGroup, tooExpensive } = setup();
    const revealed = activateCardAbility(game, P1, shizuku.instanceId, ABILITY);
    expect(revealed.activeEffect?.revealedCardIds).toHaveLength(5);
    expect(revealed.activeEffect?.stepText).toContain('5张');
    expect(
      revealed.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);

    const selecting = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    expect(selecting.activeEffect?.selectableCardIds).toContain(target.instanceId);
    expect(selecting.activeEffect?.selectableCardIds).not.toContain(invalidGroup.instanceId);
    expect(selecting.activeEffect?.selectableCardIds).not.toContain(tooExpensive.instanceId);

    const done = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      target.instanceId
    );
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      target.instanceId,
    ]);
    expect(done.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        memberCardId: shizuku.instanceId,
        hearts: [
          { color: HeartColor.BLUE, count: 2 },
          { color: HeartColor.GREEN, count: 1 },
        ],
      })
    );
  });

  it('选择后目标 stale 时不压人不写 Heart，但顶5和 turn1 不回滚', () => {
    const { game, shizuku, target } = setup();
    const revealed = activateCardAbility(game, P1, shizuku.instanceId, ABILITY);
    const selecting = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    const stale = updatePlayer(selecting, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
      },
    }));
    const done = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id, target.instanceId);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.liveResolution.liveModifiers).toEqual([]);
    expect(done.players[0].mainDeck.cardIds).toHaveLength(1);
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
  });

  it('空主卡组且空休息室时不能支付顶5，也不记录 PAY_COST 或 ABILITY_USE', () => {
    const { game, shizuku } = setup();
    const empty = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));
    const result = activateCardAbility(empty, P1, shizuku.instanceId, ABILITY);
    expect(result).toBe(empty);
    expect(result.activeEffect).toBeNull();
    expect(
      result.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY &&
          ['PAY_COST', 'ABILITY_USE'].includes(String(action.payload.step))
      )
    ).toBe(false);
  });

  it('LIVE开始按联合姓名的结构化身份求最大不同名，并在来源离场时结算0', () => {
    const shizuku = member('PL!N-bp7-003-SEC', 'live-shizuku', { name: '樱坂雫' });
    const ayumu = member('AYUMU', 'ayumu', { name: '上原歩夢' });
    const combined = member('COMBINED', 'combined', { name: '上原步梦&樱坂雫' });
    const shizukuName = member('SHIZUKU-NAME', 'shizuku-name', { name: '桜坂しずく' });
    let game = registerCards(createGameState('shizuku-live-names', P1, 'P1', P2, 'P2'), [
      shizuku,
      ayumu,
      combined,
      shizukuName,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        addMemberBelowMember(
          addMemberBelowMember(
            placeCardInSlot(player.memberSlots, SlotPosition.CENTER, shizuku.instanceId),
            SlotPosition.CENTER,
            ayumu.instanceId
          ),
          SlotPosition.CENTER,
          combined.instanceId
        ),
        SlotPosition.CENTER,
        shizukuName.instanceId
      ),
    }));
    const resolved = resolveLiveStart({
      ...game,
      pendingAbilities: [livePending(shizuku.instanceId)],
    });
    const resolvedAction = resolved.actionHistory.find(
      (action) => action.payload.step === 'GAIN_BLADE_BY_DIFFERENT_MEMBER_BELOW'
    );
    expect(resolvedAction?.payload).toMatchObject({
      differentNameCount: 2,
      bladeBonus: 2,
    });

    const left = updatePlayer(
      { ...game, pendingAbilities: [livePending(shizuku.instanceId)] },
      P1,
      (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      })
    );
    const noOp = resolveLiveStart(left);
    const noOpAction = noOp.actionHistory.find(
      (action) => action.payload.step === 'SOURCE_NOT_ON_STAGE'
    );
    expect(noOpAction?.payload).toMatchObject({
      step: 'SOURCE_NOT_ON_STAGE',
      differentNameCount: 0,
      bladeBonus: 0,
    });
  });

  it('Heart replacement 按来源成员实例在离场与重登清理', () => {
    const { game, shizuku, target } = setup();
    const revealed = activateCardAbility(game, P1, shizuku.instanceId, ABILITY);
    const selecting = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    const done = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      target.instanceId
    );
    expect(done.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        memberCardId: shizuku.instanceId,
      })
    );
    expect(
      removeStageMemberBoundLiveModifiers(done, [shizuku.instanceId]).liveResolution.liveModifiers
    ).toEqual([]);
    expect(
      clearPreviousStageMemberInstanceState(done, P1, shizuku.instanceId).liveResolution
        .liveModifiers
    ).toEqual([]);
  });
});
