import { describe, expect, it } from 'vitest';
import type { CardInstance, EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addEnergyBelowMember, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { activateCardAbility, confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { PL_N_BP3_007_ACTIVATED_PAY_TWO_SEND_SELF_PLAY_SETUNA_ATTACH_ENERGY_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { returnEnergyBelowMemberToEnergyDeck } from '../../src/application/effects/energy-below';
import { projectPlayerViewState } from '../../src/online/projector';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1', P2 = 'p2';
const member = (code: string, id: string, name = '優木せつ菜', cost = 9, owner = P1): CardInstance<MemberCardData> =>
  createCardInstance({ cardCode: code, name, cardType: CardType.MEMBER, cost, blade: 1, hearts: [createHeartIcon(HeartColor.RED, 1)] }, owner, id);
const live = (id: string): CardInstance<LiveCardData> => createCardInstance({ cardCode: `LIVE-${id}`, name: '優木せつ菜', cardType: CardType.LIVE, score: 1, requirements: createHeartRequirement({ [HeartColor.RED]: 1 }) }, P1, id);
const energy = (id: string): CardInstance<EnergyCardData> => createCardInstance({ cardCode: `ENE-${id}`, name: id, cardType: CardType.ENERGY }, P1, id);

function setup(options: { active?: number; waiting?: number; targets?: readonly CardInstance[]; occupiedAfterStart?: boolean; sourceEnergyBelow?: boolean } = {}) {
  const source = member('PL!N-bp3-007-R', 'source');
  const targets = options.targets ?? [member('PL!N-test-setuna', 'target', '優木せつ菜', 13)];
  const energies = Array.from({ length: (options.active ?? 2) + (options.waiting ?? 1) }, (_, index) => energy(`energy-${index}`));
  const oldBelow = energy('old-below');
  let game = registerCards(createGameState('n-bp3-007', P1, 'P1', P2, 'P2'), [source, ...targets, ...energies, oldBelow]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP });
    if (options.sourceEnergyBelow) memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, oldBelow.instanceId);
    return {
      ...player,
      memberSlots,
      hand: { ...player.hand, cardIds: targets.map((card) => card.instanceId) },
      energyZone: {
        ...player.energyZone,
        cardIds: energies.map((card) => card.instanceId),
        cardStates: new Map(energies.map((card, index) => [card.instanceId, { orientation: index < (options.active ?? 2) ? OrientationState.ACTIVE : OrientationState.WAITING, face: FaceState.FACE_UP }])),
      },
    };
  });
  return { ...game, currentPhase: GamePhase.MAIN_PHASE };
}

const activate = (game: ReturnType<typeof setup>) => activateCardAbility(game, P1, 'source', ABILITY_ID);
const choose = (game: ReturnType<typeof setup>, cardId: string) => confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);

describe('PL!N-bp3-007 费用9「優木せつ菜」', () => {
  it('支付2能量并自送，再从手牌同槽登场并附着剩余能量', () => {
    const started = activate(setup({ active: 2, waiting: 1 }));
    expect(started.players[0].energyZone.cardIds).toHaveLength(3);
    expect(started.players[0].energyZone.cardIds.filter((id) => started.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING)).toHaveLength(3);
    expect(started.players[0].waitingRoom.cardIds).toContain('source');
    expect(started.players[0].memberSlots.slots.CENTER).toBeNull();
    expect(started.activeEffect).toMatchObject({ selectableCardIds: ['target'], canSkipSelection: false, selectableCardVisibility: 'AWAITING_PLAYER_ONLY' });

    const done = choose(started, 'target');
    expect(done.players[0].memberSlots.slots.CENTER).toBe('target');
    expect(done.players[0].movedToStageThisTurn).toContain('target');
    expect(done.players[0].memberSlots.energyBelow.CENTER).toHaveLength(1);
    expect(done.players[0].energyZone.cardIds).toHaveLength(2);
    expect(done.eventLog.map((entry) => entry.event.eventType)).toEqual(expect.arrayContaining([TriggerCondition.ON_LEAVE_STAGE, TriggerCondition.ON_ENTER_WAITING_ROOM, TriggerCondition.ON_ENTER_STAGE]));
    expect(done.actionHistory.find((action) => action.type === 'PAY_COST')?.payload).toMatchObject({ paidEnergyCardIds: ['energy-0', 'energy-1'], movedToWaitingRoomCardIds: ['source'], sourceSlot: SlotPosition.CENTER });
    expect(done.actionHistory.find((action) => action.payload.step === 'PLAY_SETUNA_ATTACH_ENERGY')?.payload).toMatchObject({ playedCardId: 'target', sourceSlot: SlotPosition.CENTER, stackedEnergyCardIds: ['energy-0'] });
  });

  it('特殊能量存在时分别选择支付能量与附着能量，并保持自送费用顺序', () => {
    const base = setup({ active: 3, waiting: 1 });
    const marked = {
      ...base,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: 'energy-2',
          sourceCardId: 'marker-source',
          abilityId: 'marker-ability',
        },
      ],
    };
    const selectingPayment = activate(marked);
    expect(selectingPayment.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(selectingPayment.players[0].waitingRoom.cardIds).not.toContain('source');
    const paid = confirmActiveEffectStep(
      selectingPayment,
      P1,
      selectingPayment.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['energy-0', 'energy-2']
    );
    expect(paid.players[0].waitingRoom.cardIds).toContain('source');
    expect(paid.activeEffect?.selectableCardIds).toEqual(['target']);

    const selectingAttachment = choose(paid, 'target');
    expect(selectingAttachment.activeEffect?.stepId).toBe(
      'COMMON_ENERGY_OPERATION_SELECTION'
    );
    const done = confirmActiveEffectStep(
      selectingAttachment,
      P1,
      selectingAttachment.activeEffect!.id,
      'energy-1'
    );
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.energyBelow.CENTER).toEqual(['energy-1']);
    expect(
      done.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.paidEnergyCardIds
    ).toEqual(['energy-0', 'energy-2']);
  });

  it('发动前要求合法目标、2张活跃能量且支付后仍有能量可附着', () => {
    const notEnoughActive = setup({ active: 1, waiting: 2 });
    expect(activate(notEnoughActive)).toBe(notEnoughActive);
    const noEnergyAfterPayment = setup({ active: 2, waiting: 0 });
    expect(activate(noEnergyAfterPayment)).toBe(noEnergyAfterPayment);
    const noTarget = setup({ targets: [member('PL!N-other', 'other', '上原歩夢', 9)] });
    expect(activate(noTarget)).toBe(noTarget);
  });

  it('只允许费用13以下同名成员，排除LIVE、费用14与其他角色', () => {
    const game = setup({ targets: [member('OK', 'ok', '優木せつ菜', 13), live('live'), member('HIGH', 'high', '優木せつ菜', 14), member('OTHER', 'other', '上原歩夢', 9)] });
    expect(activate(game).activeEffect?.selectableCardIds).toEqual(['ok']);
  });

  it('即使异常状态把来源ID同时放入手牌，也不能将来源自己作为目标', () => {
    const base = setup();
    const malformed = updatePlayer(base, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['source'] },
    }));
    expect(activate(malformed)).toBe(malformed);
  });

  it('非法或陈旧选择不移动卡牌且不重复支付', () => {
    const started = activate(setup());
    expect(choose(started, 'other')).toBe(started);
    const stale = updatePlayer(started, P1, (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } }));
    const payCostCount = stale.actionHistory.filter((action) => action.type === 'PAY_COST').length;
    expect(choose(stale, 'target')).toBe(stale);
    expect(stale.actionHistory.filter((action) => action.type === 'PAY_COST')).toHaveLength(payCostCount);
  });

  it('原槽被占用时不覆盖成员', () => {
    const started = activate(setup());
    const occupied = updatePlayer(started, P1, (player) => ({ ...player, memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'blocker') }));
    expect(choose(occupied, 'target')).toBe(occupied);
  });

  it('来源下方能量离场时回能量卡组，新成员下方能量之后也可按同一生命周期返回', () => {
    const started = activate(setup({ sourceEnergyBelow: true }));
    expect(started.players[0].energyDeck.cardIds).toContain('old-below');
    const done = choose(started, 'target');
    const stackedId = done.players[0].memberSlots.energyBelow.CENTER[0];
    const returned = returnEnergyBelowMemberToEnergyDeck(done, P1, SlotPosition.CENTER);
    expect(returned.returnedEnergyCardIds).toEqual([stackedId]);
    expect(returned.gameState.players[0].energyDeck.cardIds).toContain(stackedId);
  });

  it('新成员真实登场能力在附着能量完成后才继续处理', () => {
    const targetWithOnEnter = member('PL!N-bp3-006-R', 'target-on-enter', '優木せつ菜', 9);
    const done = choose(activate(setup({ targets: [targetWithOnEnter] })), targetWithOnEnter.instanceId);
    const attachIndex = done.actionHistory.findIndex((action) => action.payload.step === 'PLAY_SETUNA_ATTACH_ENERGY');
    const onEnterIndex = done.actionHistory.findIndex((action) => action.payload.abilityId === 'PL!N-bp3-006:on-enter-wait-self' && action.type === 'RESOLVE_ABILITY');
    expect(attachIndex).toBeGreaterThanOrEqual(0);
    expect(onEnterIndex).toBeGreaterThan(attachIndex);
    expect(done.players[0].memberSlots.energyBelow.CENTER).toHaveLength(1);
    expect(done.players[0].memberSlots.cardStates.get('target-on-enter')?.orientation).toBe(OrientationState.WAITING);
  });

  it('手牌候选只投影给等待玩家且中文窗口不含内部术语', () => {
    const started = activate(setup());
    const p1View = projectPlayerViewState(started, P1);
    const p2View = projectPlayerViewState(started, P2);
    expect(JSON.stringify(p1View.activeEffect)).toContain('target');
    expect(JSON.stringify(p2View.activeEffect)).not.toContain('target');
    const copy = `${started.activeEffect?.stepText} ${started.activeEffect?.selectionLabel} ${started.activeEffect?.confirmSelectionLabel}`;
    expect(copy).not.toMatch(/source|pending|payload|eventId|stale/);
    expect(started.activeEffect?.canSkipSelection).toBe(false);
  });

  it('来源已离场或不再是己方舞台上的该基础编号时安全拒绝', () => {
    const base = setup();
    const left = updatePlayer(base, P1, (player) => ({ ...player, memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER) }));
    expect(activate(left)).toBe(left);
  });
});
