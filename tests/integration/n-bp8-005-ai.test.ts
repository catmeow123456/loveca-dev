import { describe, expect, it } from 'vitest';
import { N_BP8_005_ACTIVATED_TAP_ENERGY_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID as ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getGrantedMemberBelowAbilityDefinitions } from '../../src/application/card-effects/runtime/granted-member-below-abilities';
import { getAbilityTurnLimitStatus } from '../../src/application/card-effects/runtime/ability-turn-limit';
import {
  buildPlayMemberCostResources,
  getHandMemberEffectiveCost,
} from '../../src/application/effects/play-member-cost';
import {
  createActivateAbilityCommand,
  createConfirmCostPaymentCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { costCalculator } from '../../src/domain/rules/cost-calculator';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
  addMemberCostSetLiveModifierForMember,
} from '../../src/domain/rules/live-modifiers';
import { isStageMemberActivatedAbilityProhibited } from '../../src/domain/rules/member-activated-ability-prohibitions';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import { HeartPool } from '../../src/domain/value-objects/heart';
import { liveResolver } from '../../src/domain/rules/live-resolver';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLeaveStageEvent } from '../../src/domain/events/game-events';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import {
  CardType,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getOctober29MemberData } from '../helpers/october-29-draft-effects';
import {
  P1,
  P2,
  SOURCE,
  TARGET,
  activateAi,
  chooseAi,
  finishAiRecovery,
  setAiState,
  setupAi,
  testMember,
} from '../helpers/n-bp8-ai-effects';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

const TEXTS = [
  '【常时】自己的能量卡组的卡片每有１张，手牌的此成员卡的费用加１。',
  '【常时】存在于自己的舞台的所有『虹咲』的成员，和存在于对方的舞台的所有成员，获得[赤ハート]。',
  '【起动】【１回合１次】[E]将存在于能量区的１张能量卡放置于此成员的下方：从自己的休息室将１张『虹咲』的成员卡加入手牌。',
];
const payments = (session: ReturnType<typeof setupAi>) =>
  session.state!.actionHistory.filter(
    (action) => action.type === 'PAY_COST' && action.payload.abilityId === ID
  );
const uses = (session: ReturnType<typeof setupAi>) =>
  session.state!.actionHistory.filter(
    (action) => action.payload.abilityId === ID && action.payload.step === 'ABILITY_USE'
  );
const belowEvents = (session: ReturnType<typeof setupAi>) =>
  session.state!.eventLog.filter(
    ({ event }) => event.eventType === TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER
  );
function roundtrip(session: ReturnType<typeof setupAi>) {
  setAiState(
    session,
    rehydrateAuthorityGameState(
      serializeReplayPayload(session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    )
  );
}

describe('PL!N-bp8-005 费用10「宫下爱」', () => {
  it.each(['SEC', 'R', 'P+'])('%s三段按基础编号登记并保留完整中文与token', (rarity) => {
    const definitions = getCardAbilityDefinitionsForCardCode(`PL!N-bp8-005-${rarity}`);
    expect(definitions.map((definition) => definition.effectText)).toEqual(TEXTS);
    expect(definitions.find((definition) => definition.abilityId === ID)?.activatedUi?.text).toBe(
      TEXTS[2]
    );
    expect(definitions.find((definition) => definition.abilityId === ID)?.perTurnLimit).toBe(1);
  });

  it('仅1张ACTIVE能量也可先支付再叠同一张，无回收目标仍消耗一次费用和次数', () => {
    const session = setupAi({ energies: 1, active: 1, target: false, live: false, marked: ['e0'] });
    expect(activateAi(session, ID).success).toBe(true);
    expect(session.state!.players[0].energyZone.cardIds).toEqual([]);
    expect(session.state!.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['e0']);
    expect(session.state!.energyActivePhaseSkips).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
    expect(payments(session)).toHaveLength(1);
    expect(payments(session)[0].payload).toMatchObject({
      paidEnergyCardIds: ['e0'],
      stackedEnergyCardIds: ['e0'],
    });
    expect(uses(session)).toHaveLength(1);
    expect(belowEvents(session)).toHaveLength(1);
    expect(activateAi(session, ID).success).toBe(false);
  });

  it('普通超额能量遵守支付后WAITING优先顺序，并强制公开回收虹咲成员', () => {
    const session = setupAi();
    expect(activateAi(session, ID).success).toBe(true);
    expect(payments(session)[0].payload).toMatchObject({
      paidEnergyCardIds: ['e0'],
      stackedEnergyCardIds: ['e0'],
    });
    expect(session.state!.activeEffect).toMatchObject({
      selectableCardIds: [TARGET],
      canSkipSelection: false,
      selectionLabel: '选择要加入手牌的成员卡',
      confirmSelectionLabel: '加入手牌',
    });
    chooseAi(session, TARGET);
    expect(session.state!.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(TARGET);
    expect(session.state!.players[0].hand.cardIds).not.toContain(TARGET);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toContain(TARGET);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('两次特殊能量选择及当前格式恢复保留两种真实ID，第二窗口前无局部扣费', () => {
    const session = setupAi({ active: 3, marked: ['e2'] });
    expect(activateAi(session, ID).success).toBe(true);
    expect(session.state!.activeEffect?.stepText).toBe('请选择用于支付[E]的活跃能量卡。');
    chooseAi(session, 'e1');
    expect(session.state!.activeEffect?.stepText).toBe('请选择要放到成员下方的能量。');
    expect(session.state!.players[0].energyZone.cardStates.get('e1')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(payments(session)).toEqual([]);
    expect(uses(session)).toEqual([]);
    expect(belowEvents(session)).toEqual([]);
    roundtrip(session);
    chooseAi(session, 'e2');
    expect(session.state!.players[0].energyZone.cardStates.get('e1')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state!.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['e2']);
    expect(payments(session)[0].payload).toMatchObject({
      paidEnergyCardIds: ['e1'],
      stackedEnergyCardIds: ['e2'],
    });
    expect(payments(session)).toHaveLength(1);
    expect(uses(session)).toHaveLength(1);
    expect(belowEvents(session)).toHaveLength(1);
    finishAiRecovery(session);
  });

  it('不足、重复/非法输入及已失效能量均不部分支付或消耗次数', () => {
    const insufficient = setupAi({ active: 0 });
    expect(activateAi(insufficient, ID).success).toBe(false);
    expect(payments(insufficient)).toEqual([]);
    const session = setupAi({ active: 3, marked: ['e2'] });
    activateAi(session, ID);
    for (const ids of [['e0', 'e0'], ['bad']]) {
      const result = session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ids
        )
      );
      expect(result.success).toBe(false);
      expect(payments(session)).toEqual([]);
      expect(uses(session)).toEqual([]);
    }
    setAiState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        energyZone: {
          ...player.energyZone,
          cardIds: player.energyZone.cardIds.filter((id) => id !== 'e2'),
        },
      }))
    );
    const stale = session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'e2')
    );
    expect(stale.success).toBe(false);
    expect(payments(session)).toEqual([]);
    expect(uses(session)).toEqual([]);
    expect(belowEvents(session)).toEqual([]);
  });

  it('付费后来源离场不回滚支付，也不阻止已公开的合法成员回收', () => {
    const session = setupAi();
    activateAi(session, ID);
    chooseAi(session, TARGET);
    setAiState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        waitingRoom: { ...player.waitingRoom, cardIds: [...player.waitingRoom.cardIds, SOURCE] },
      }))
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toContain(TARGET);
    expect(payments(session)).toHaveLength(1);
    expect(uses(session)).toHaveLength(1);
  });

  it('公开恢复时目标失效不移动其他牌，不退款', () => {
    const session = setupAi();
    activateAi(session, ID);
    chooseAi(session, TARGET);
    setAiState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((id) => id !== TARGET),
        },
      }))
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).not.toContain(TARGET);
    expect(session.state!.activeEffect).toBeNull();
    expect(payments(session)).toHaveLength(1);
  });

  it('能量叠卡产生一次精确事件，新的步梦诱发等回收完整结束后才处理', () => {
    const session = setupAi({ energyDeckCount: 2 });
    let game = registerCards(session.state!, [
      testMember('listener', P1, '虹ヶ咲', 'PL!N-bp7-001-P'),
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'listener'),
    }));
    setAiState(session, game);
    activateAi(session, ID);
    expect(session.state!.activeEffect?.abilityId).toBe(ID);
    expect(
      session.state!.pendingAbilities.some((pending) => pending.sourceCardId === 'listener')
    ).toBe(true);
    expect(belowEvents(session)[0].event).toMatchObject({
      energyCardIds: ['e0'],
      targetMemberCardId: SOURCE,
      cause: { sourceCardId: SOURCE, abilityId: ID },
    });
    finishAiRecovery(session);
    expect(session.state!.players[0].hand.cardIds).toContain(TARGET);
    expect(
      session.state!.actionHistory.filter(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.sourceCardId === 'listener'
      )
    ).toHaveLength(1);
  });

  it('两次特殊能量恢复后无回收目标，完成边界及时处理叠卡产生的AUTO', () => {
    const session = setupAi({
      energyDeckCount: 2,
      active: 3,
      marked: ['e2'],
      target: false,
      live: false,
    });
    let game = registerCards(session.state!, [
      testMember('listener', P1, '虹ヶ咲', 'PL!N-bp7-001-P'),
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'listener'),
    }));
    setAiState(session, game);
    activateAi(session, ID);
    chooseAi(session, 'e1');
    expect(session.state!.pendingAbilities).toEqual([]);
    chooseAi(session, 'e2');
    expect(session.state!.activeEffect?.abilityId).not.toBe(ID);
    expect(
      session.state!.pendingAbilities.length === 0 || session.state!.activeEffect !== null
    ).toBe(true);
    expect(
      session.state!.actionHistory.some(
        (action) => action.payload.sourceCardId === 'listener' && action.type === 'RESOLVE_ABILITY'
      )
    ).toBe(true);
    expect(payments(session)).toHaveLength(1);
    expect(uses(session)).toHaveLength(1);
    expect(belowEvents(session)).toHaveLength(1);
  });

  it('第二能量窗口中先前选定的支付卡失效时，不改用其他能量补付', () => {
    const session = setupAi({ active: 3, marked: ['e2'] });
    activateAi(session, ID);
    chooseAi(session, 'e1');
    setAiState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        energyZone: {
          ...player.energyZone,
          cardStates: new Map(player.energyZone.cardStates).set('e1', {
            ...player.energyZone.cardStates.get('e1')!,
            orientation: OrientationState.WAITING,
          }),
        },
      }))
    );
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'e2')
    );
    expect(payments(session)).toEqual([]);
    expect(uses(session)).toEqual([]);
    expect(belowEvents(session)).toEqual([]);
    expect(session.state!.players[0].energyZone.cardStates.get('e0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state!.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
  });

  it.each([false, true])(
    '能量窗口中出现起动禁止不阻断已开始流程，但具体授予移除仍终止：%s',
    (removeGrant) => {
      const session = setupAi({ host: 'LL', copies: 2, active: 3, marked: ['e2'] });
      setAiState(
        session,
        addMemberCostSetLiveModifierForMember(session.state!, {
          playerId: P1,
          memberCardId: SOURCE,
          sourceCardId: 'cost-set',
          abilityId: 'test-cost-set',
          setTo: 4,
        })!.gameState
      );
      const instance = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE).find(
        (copy) => copy.grantingMemberBelowCardId === 'below-0'
      )!.abilityInstanceId;
      expect(activateAi(session, ID, instance).success).toBe(true);
      let game = registerCards(session.state!, [
        createCardInstance(getOctober29MemberData('PL!HS-bp8-007'), P2, 'prohibition'),
        createCardInstance(getOctober29MemberData('PL!HS-bp8-008'), P2, 'izumi'),
      ]);
      game = updatePlayer(game, P2, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'prohibition'),
          SlotPosition.LEFT,
          'izumi',
          { orientation: OrientationState.ACTIVE }
        ),
      }));
      if (removeGrant)
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          memberSlots: {
            ...player.memberSlots,
            memberBelow: { ...player.memberSlots.memberBelow, [SlotPosition.CENTER]: ['below-1'] },
          },
        }));
      expect(isStageMemberActivatedAbilityProhibited(game, P1, SOURCE)).toBe(true);
      setAiState(session, game);
      chooseAi(session, 'e1');
      if (removeGrant) {
        expect(session.state!.activeEffect).toBeNull();
        expect(payments(session)).toEqual([]);
        expect(uses(session)).toEqual([]);
      } else {
        expect(session.state!.activeEffect?.stepText).toBe('请选择要放到成员下方的能量。');
        chooseAi(session, 'e2');
        finishAiRecovery(session);
        expect(payments(session)).toHaveLength(1);
        expect(uses(session)).toHaveLength(1);
      }
    }
  );

  it('LL授予的两次能量选择恢复保留宿主和具体实例，两个实例分别限次', () => {
    const session = setupAi({ host: 'LL', copies: 2, active: 3, marked: ['e2'] });
    const copies = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE);
    const first = copies.find(
      (copy) => copy.grantingMemberBelowCardId === 'below-0'
    )!.abilityInstanceId;
    const second = copies.find(
      (copy) => copy.grantingMemberBelowCardId === 'below-1'
    )!.abilityInstanceId;
    expect(activateAi(session, ID, `${first}-fake`).success).toBe(false);
    expect(activateAi(session, ID).success).toBe(false);
    expect(activateAi(session, ID, first).success).toBe(true);
    const lifecycle = session.state!.activeEffect!.sourceLifecycleId;
    chooseAi(session, 'e1');
    roundtrip(session);
    expect(session.state!.activeEffect).toMatchObject({
      abilityInstanceId: first,
      sourceLifecycleId: lifecycle,
    });
    chooseAi(session, 'e2');
    finishAiRecovery(session);
    expect(uses(session)[0].payload).toMatchObject({
      sourceCardId: SOURCE,
      sourceLifecycleId: lifecycle,
      abilityInstanceId: first,
    });
    expect(session.state!.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['e2']);
    expect(activateAi(session, ID, first).success).toBe(false);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, second)?.used).toBe(0);
    expect(activateAi(session, ID, second).success).toBe(true);
    expect(uses(session)).toHaveLength(2);
    expect(uses(session)[1].payload).toMatchObject({
      abilityInstanceId: second,
      sourceCardId: SOURCE,
    });
  });

  it('原卡与LL宿主次数隔离，宿主离场重登后新规则对象可再次使用', () => {
    const session = setupAi({ host: 'LL', active: 3, energies: 4 });
    const instance = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE)[0]!
      .abilityInstanceId;
    let game = registerCards(session.state!, [
      createCardInstance(getOctober29MemberData('PL!N-bp8-005'), P1, 'direct-ai'),
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'direct-ai'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('direct-ai', ZoneType.HAND, SlotPosition.LEFT, P1, P1)
    );
    setAiState(session, game);
    expect(session.executeCommand(createActivateAbilityCommand(P1, 'direct-ai', ID)).success).toBe(
      true
    );
    finishAiRecovery(session);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, instance)?.used).toBe(0);
    expect(activateAi(session, ID, instance).success).toBe(true);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, instance)?.used).toBe(1);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, 'direct-ai')?.used).toBe(1);
    game = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.CENTER,
        SOURCE
      ),
    }));
    game = emitGameEvent(
      game,
      createLeaveStageEvent(SOURCE, SlotPosition.CENTER, ZoneType.WAITING_ROOM, P1, P1)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent(SOURCE, ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    setAiState(session, game);
    roundtrip(session);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, instance)?.used).toBe(0);
    expect(activateAi(session, ID, instance).success).toBe(true);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, instance)?.used).toBe(1);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, 'direct-ai')?.used).toBe(1);
  });

  it.each(['GRANT_REMOVED', 'REENTERED', 'SOURCE_LEFT'] as const)(
    '%s：旧能量窗口结束且不付款、不计次，不能借用另一份同能力',
    (kind) => {
      const session = setupAi({ host: 'LL', copies: 2, active: 3, marked: ['e2'] });
      const instance = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE).find(
        (copy) => copy.grantingMemberBelowCardId === 'below-0'
      )!.abilityInstanceId;
      activateAi(session, ID, instance);
      chooseAi(session, 'e1');
      let game = session.state!;
      if (kind === 'GRANT_REMOVED') {
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          memberSlots: {
            ...player.memberSlots,
            memberBelow: { ...player.memberSlots.memberBelow, [SlotPosition.CENTER]: ['below-1'] },
          },
          waitingRoom: {
            ...player.waitingRoom,
            cardIds: [...player.waitingRoom.cardIds, 'below-0'],
          },
        }));
      } else {
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        }));
        game = emitGameEvent(
          game,
          createLeaveStageEvent(SOURCE, SlotPosition.CENTER, ZoneType.WAITING_ROOM, P1, P1)
        );
        if (kind === 'REENTERED') {
          game = updatePlayer(game, P1, (player) => ({
            ...player,
            memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE),
          }));
          game = emitGameEvent(
            game,
            createEnterStageEvent(SOURCE, ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
          );
        }
      }
      setAiState(session, game);
      roundtrip(session);
      chooseAi(session, 'e2');
      expect(session.state!.activeEffect).toBeNull();
      expect(payments(session)).toEqual([]);
      expect(uses(session)).toEqual([]);
      expect(belowEvents(session)).toEqual([]);
      expect(session.state!.players[0].energyZone.cardStates.get('e1')?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  );

  it('手牌费用随自己energyDeck变化，普通特殊能量支付与换手使用同一资源快照', () => {
    const session = setupAi({
      inHand: true,
      energyDeckCount: 2,
      energies: 14,
      active: 14,
      marked: ['e13'],
    });
    expect(getHandMemberEffectiveCost(session.state!, P1, SOURCE)).toBe(12);
    const resources = buildPlayMemberCostResources(session.state!, P1, SOURCE)!;
    expect(resources.energyDeckCardCount).toBe(2);
    const relayPlan = costCalculator.checkCanPayCost(
      getOctober29MemberData('PL!N-bp8-005'),
      SlotPosition.CENTER,
      {
        ...resources,
        stageMembers: [
          {
            cardId: 'replacement',
            data: { ...getOctober29MemberData('PL!N-bp8-017'), cost: 4 },
            position: SlotPosition.CENTER,
            orientation: OrientationState.ACTIVE,
          },
        ],
      }
    );
    expect(
      relayPlan.availablePlans.some(
        (plan) => plan.modifiedCost === 12 && plan.actualEnergyCost === 8
      )
    ).toBe(true);
    const command = createPlayMemberToSlotCommand(P1, SOURCE, SlotPosition.CENTER);
    const prepared = (
      session as unknown as {
        preparePlayMemberCostPayment(
          game: GameState,
          input: typeof command
        ): { success: boolean; pendingCostPayment?: GameState['pendingCostPayment'] };
      }
    ).preparePlayMemberCostPayment(session.state!, command);
    expect(prepared.success).toBe(true);
    const payment = prepared.pendingCostPayment!;
    expect(payment.finalEnergyCost).toBe(12);
    expect(payment.explanation).toContain('费用增加 2');
    setAiState(session, { ...session.state!, pendingCostPayment: payment });
    const paid = session.executeCommand(
      createConfirmCostPaymentCommand(
        P1,
        payment.id,
        Array.from({ length: 12 }, (_, i) => `e${i}`)
      )
    );
    expect(paid.success, paid.error).toBe(true);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(SOURCE);
    expect(getMemberEffectiveCost(session.state!, P1, SOURCE)).toBe(10);
  });

  it('双方TARGET_MEMBER红Heart实时叠加，只有自己的虹咲获益，来源离场/下方不保留光环', () => {
    const session = setupAi();
    let game = registerCards(session.state!, [
      testMember('niji'),
      testMember('liella', P1, 'Liella!'),
      testMember('opponent', P2, 'Aqours'),
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'niji'),
        SlotPosition.RIGHT,
        'liella'
      ),
    }));
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'opponent'),
    }));
    const red = (id: string, owner: string) =>
      getMemberEffectiveHeartIcons(game, owner, id)
        .filter((heart) => heart.color === HeartColor.RED)
        .reduce((sum, heart) => sum + heart.count, 0);
    expect(red(SOURCE, P1)).toBe(3);
    expect(red('niji', P1)).toBe(1);
    expect(red('liella', P1)).toBe(0);
    expect(red('opponent', P2)).toBe(1);
    expect(
      HeartPool.fromHeartIcons(getMemberEffectiveHeartIcons(game, P2, 'opponent')).canSatisfy(
        createHeartRequirement({ [HeartColor.RED]: 1 })
      )
    ).toBe(true);
    const judge = () =>
      liveResolver.performLive(
        P2,
        [
          {
            ...testMember('opponent', P2, 'Aqours').data,
            hearts: getMemberEffectiveHeartIcons(game, P2, 'opponent'),
          },
        ],
        [
          {
            cardId: 'judgment-live',
            data: {
              cardCode: 'TEST-JUDGMENT',
              name: '红Heart LIVE',
              cardType: CardType.LIVE,
              score: 2,
              requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
            },
          },
        ],
        []
      );
    expect(judge().liveJudgments[0].isSuccess).toBe(true);
    expect(judge().totalScore).toBe(2);
    expect(
      collectLiveModifiers(game).filter(
        (modifier) => modifier.abilityId === 'PL!N-bp8-005:continuous-stage-red-hearts'
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: P2,
          target: 'TARGET_MEMBER',
          sourceCardId: SOURCE,
          targetMemberCardId: 'opponent',
        }),
      ])
    );
    game = registerCards(game, [
      createCardInstance(
        { ...getOctober29MemberData('PL!N-bp8-005'), cardCode: 'PL!N-bp8-005-R' },
        P1,
        'second-ai'
      ),
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'second-ai', {
        orientation: OrientationState.WAITING,
      }),
    }));
    expect(red('opponent', P2)).toBe(2);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.LEFT,
        SOURCE
      ),
    }));
    expect(red('opponent', P2)).toBe(1);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
    }));
    expect(red('opponent', P2)).toBe(0);
    expect(
      HeartPool.fromHeartIcons(getMemberEffectiveHeartIcons(game, P2, 'opponent')).canSatisfy(
        createHeartRequirement({ [HeartColor.RED]: 1 })
      )
    ).toBe(false);
    expect(judge().liveJudgments[0].isSuccess).toBe(false);
    expect(judge().totalScore).toBe(0);
  });
});
