import { describe, expect, it } from 'vitest';
import {
  HS_BP8_014_ON_ENTER_OTHER_HASUNOSORA_DRAW_ONE_ABILITY_ID as HIME_ENTER,
  HS_BP8_021_LIVE_START_RETURN_MIRACRA_MEMBER_PLAY_SAME_COST_ABILITY_ID as MIRA,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID as KAHO_AUTO,
} from '../../src/application/card-effects/ability-ids';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { getHandMemberEffectiveCost } from '../../src/application/effects/play-member-cost';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  type CardInstance,
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
  addCardToZone,
  addEnergyBelowMember,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromStatefulZone,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  createNovember04DraftCard,
  getNovember04DraftRow,
} from '../helpers/november-04-draft-effects';
import { getOctober26CardData } from '../helpers/october-26-card-effects';

const P1 = 'p1';
const P2 = 'p2';
const LIVE = 'mira';
const LEFT = SlotPosition.LEFT;
const CENTER = SlotPosition.CENTER;
const RIGHT = SlotPosition.RIGHT;

function member(id: string, cost: number, unitName = 'みらくらぱーく!', owner = P1, cardCode = id) {
  const data: MemberCardData = {
    cardCode,
    name: id,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
    unitName,
    groupNames: ['蓮ノ空'],
  };
  return createCardInstance(data, owner, id);
}

const hime20 = () => createNovember04DraftCard('PL!HS-bp6-006-P', P1, 'hime20');
const hime2 = () => createCardInstance(getOctober26CardData('PL!HS-bp8-014-N'), P1, 'hime2');

function setup(
  options: {
    stage?: readonly { card: CardInstance; slot: SlotPosition }[];
    hand?: readonly CardInstance[];
    below?: boolean;
    secondLive?: boolean;
    liveCode?: string;
  } = {}
) {
  const source = createNovember04DraftCard('PL!HS-bp8-021-SECL', P1, LIVE);
  const live = options.liveCode
    ? { ...source, data: { ...source.data, cardCode: options.liveCode } }
    : source;
  const otherLive = createNovember04DraftCard('PL!HS-bp8-021-SECL', P1, 'other-mira');
  const below = options.below ? [member('below-1', 2), member('below-2', 3)] : [];
  const energy = createCardInstance(
    { cardCode: 'test-energy', name: 'energy', cardType: CardType.ENERGY },
    P1,
    'below-energy'
  );
  const stage = options.stage ?? [{ card: hime20(), slot: LEFT }];
  const hand = options.hand ?? [];
  const enemy = member('enemy-member', 20, 'Mira-Cra Park!', P2);
  let game = registerCards(createGameState('mira-creation', P1, 'P1', P2, 'P2'), [
    live,
    ...(options.secondLive ? [otherLive] : []),
    ...stage.map(({ card }) => card),
    ...hand,
    ...below,
    ...(options.below ? [energy] : []),
    enemy,
    member('deck', 1),
    member('enemy-deck', 1, 'BiBi', P2),
  ]);
  game = updatePlayer(game, P1, (player) => {
    let slots = player.memberSlots;
    for (const { card, slot } of stage) {
      slots = placeCardInSlot(slots, slot, card.instanceId, {
        face: FaceState.FACE_UP,
        orientation: OrientationState.WAITING,
      });
    }
    if (options.below) {
      for (const card of below) slots = addMemberBelowMember(slots, LEFT, card.instanceId);
      slots = addEnergyBelowMember(slots, LEFT, energy.instanceId);
    }
    let liveZone = addCardToStatefulZone(player.liveZone, live.instanceId, {
      face: FaceState.FACE_DOWN,
      orientation: OrientationState.ACTIVE,
    });
    if (options.secondLive)
      liveZone = addCardToStatefulZone(liveZone, otherLive.instanceId, {
        face: FaceState.FACE_DOWN,
        orientation: OrientationState.ACTIVE,
      });
    return {
      ...player,
      memberSlots: slots,
      liveZone,
      hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
      mainDeck: addCardToZone(player.mainDeck, 'deck'),
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, LEFT, enemy.instanceId),
    mainDeck: addCardToZone(player.mainDeck, 'enemy-deck'),
  }));
  const session = createGameSession();
  session.createGame('mira-creation', P1, 'P1', P2, 'P2');
  set(session, {
    ...game,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
    currentTurnType: TurnType.LIVE_PHASE,
    activePlayerIndex: 0,
    liveSetCompletedPlayers: [P1],
  });
  session.setManualOperationMode('RULES');
  const started = session.executeCommand(
    createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
  );
  expect(started.success, started.error).toBe(true);
  expect(session.state!.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
  return session;
}

function set(session: GameSession, game: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

function choose(
  session: GameSession,
  cardId?: string | null,
  slot?: SlotPosition,
  ordered?: boolean
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, cardId, slot, ordered)
  );
}

function confirm(
  session: GameSession,
  cardId?: string | null,
  slot?: SlotPosition,
  ordered?: boolean
) {
  const result = choose(session, cardId, slot, ordered);
  expect(result.success, result.error).toBe(true);
  return session.state!;
}

function events(session: GameSession, trigger: TriggerCondition) {
  return session
    .state!.eventLog.map(({ event }) => event)
    .filter((event) => event.eventType === trigger);
}

describe('PL!HS-bp8-021 分数2「Mira-Creation」', () => {
  it.each(['SECL', 'L'])(
    '从真实 RULES LIVE 开始窗口以基础编号接线（%s）并保留可不返手',
    (rarity) => {
      const session = setup({ liveCode: `PL!HS-bp8-021-${rarity}` });
      expect(events(session, TriggerCondition.ON_LIVE_START)).toMatchObject([
        { performerId: P1, liveCardIds: [LIVE] },
      ]);
      expect(session.state!.activeEffect).toMatchObject({
        abilityId: MIRA,
        effectText: getNovember04DraftRow('PL!HS-bp8-021-SECL').cardTextCn,
        selectableCardIds: ['hime20'],
        confirmSelectionLabel: '放回手牌',
        skipSelectionLabel: '不发动',
      });
      expect(choose(session, 'enemy-member').success).toBe(false);
      expect(confirm(session, null).players[0].memberSlots.slots[LEFT]).toBe('hime20');
      expect(events(session, TriggerCondition.ON_LEAVE_STAGE)).toEqual([]);
    }
  );

  it('没有可返手成员时沿用单个 LIVE pending 的无目标确认', () => {
    const session = setup({
      stage: [{ card: member('wrong-unit', 20, 'DOLLCHESTRA'), slot: LEFT }],
    });
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: MIRA,
      stepText: '没有可选择的目标。',
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(confirm(session).activeEffect).toBeNull();
    expect(events(session, TriggerCondition.ON_LEAVE_STAGE)).toEqual([]);
  });

  it.each([1, 2])('费用20姬芽返手后场上还有%i名同小组成员时按手牌费用排除重登', (count) => {
    const stage = [
      { card: hime20(), slot: LEFT },
      { card: member('peer1', 4), slot: CENTER },
    ];
    if (count === 2) stage.push({ card: member('peer2', 7), slot: RIGHT });
    const session = setup({ stage });
    expect(getMemberEffectiveCost(session.state!, P1, 'hime20')).toBe(20);
    const state = confirm(session, 'hime20');
    expect(state.players[0].hand.cardIds).toEqual(['hime20']);
    expect(getHandMemberEffectiveCost(state, P1, 'hime20')).toBe(20 - 2 * count);
    expect(state.activeEffect).toMatchObject({
      selectableCardIds: [],
      skipSelectionLabel: '不登场',
    });
    expect(choose(session, 'hime20').success).toBe(false);
    expect(confirm(session, null).activeEffect).toBeNull();
    expect(events(session, TriggerCondition.ON_ENTER_STAGE)).toEqual([]);
    expect(events(session, TriggerCondition.ON_LEAVE_STAGE)).toMatchObject([
      {
        cardInstanceId: 'hime20',
        toZone: ZoneType.HAND,
        memberLastKnownInformation: { effectiveCost: 20 },
      },
    ]);
  });

  it('姬芽返手变为18费，另一名20费成员可登场至原槽且不继承下方牌', () => {
    const session = setup({
      stage: [
        { card: hime20(), slot: LEFT },
        { card: member('peer', 4), slot: CENTER },
      ],
      hand: [member('replacement', 20)],
      below: true,
    });
    const returned = confirm(session, 'hime20');
    expect(getHandMemberEffectiveCost(returned, P1, 'hime20')).toBe(18);
    expect(returned.activeEffect?.selectableCardIds).toEqual(['replacement']);
    expect(returned.players[0].memberSlots.slots[LEFT]).toBeNull();
    expect(returned.players[0].waitingRoom.cardIds).toEqual(['below-1', 'below-2']);
    expect(returned.players[0].energyDeck.cardIds).toEqual(['below-energy']);

    confirm(session, 'replacement');
    const done = confirm(session, undefined, LEFT);
    expect(done.players[0].hand.cardIds).toEqual(['hime20']);
    expect(done.players[0].memberSlots.slots[LEFT]).toBe('replacement');
    expect(done.players[0].memberSlots.memberBelow[LEFT]).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[LEFT]).toEqual([]);
    expect(events(session, TriggerCondition.ON_ENTER_STAGE)).toMatchObject([
      { cardInstanceId: 'replacement', fromZone: ZoneType.HAND, toSlot: LEFT },
    ]);
  });

  it.each([LEFT, RIGHT])('同一实体可重登 %s，旧舞台对象和下方牌已经清理', (slot) => {
    const session = setup({ below: true });
    const initial = session.state!;
    const oldLifecycle = getStageMemberLifecycleId(initial, 'hime20');
    set(session, {
      ...initial,
      liveResolution: {
        ...initial.liveResolution,
        liveModifiers: [
          {
            kind: 'BLADE',
            target: 'SOURCE_MEMBER',
            playerId: P1,
            sourceCardId: 'hime20',
            abilityId: 'test-stage-blade',
            countDelta: 2,
          },
        ],
      },
    });
    const state = confirm(session, 'hime20');
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(getHandMemberEffectiveCost(state, P1, 'hime20')).toBe(20);
    expect(state.activeEffect?.selectableCardIds).toEqual(['hime20']);
    expect(state.players[0].waitingRoom.cardIds).toEqual(['below-1', 'below-2']);
    expect(state.players[0].energyDeck.cardIds).toEqual(['below-energy']);
    expect(events(session, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toEqual([]);
    expect(events(session, TriggerCondition.ON_ENTER_WAITING_ROOM)).toMatchObject([
      { fromZone: ZoneType.MEMBER_SLOT, cardInstanceIds: ['below-1', 'below-2'] },
    ]);
    expect(events(session, TriggerCondition.ON_ENTER_HAND)).toMatchObject([
      { fromZone: ZoneType.MEMBER_SLOT, cardInstanceIds: ['hime20'] },
    ]);
    confirm(session, 'hime20');
    const done = confirm(session, undefined, slot);
    expect(done.players[0].memberSlots.slots[slot]).toBe('hime20');
    expect(done.players[0].memberSlots.cardStates.get('hime20')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.players[0].memberSlots.memberBelow[slot]).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[slot]).toEqual([]);
    expect(done.liveResolution.liveModifiers).toEqual([]);
    expect(getStageMemberLifecycleId(done, 'hime20')).not.toBe(oldLifecycle);
    expect(events(session, TriggerCondition.ON_ENTER_STAGE)).toMatchObject([
      { cardInstanceId: 'hime20', fromZone: ZoneType.HAND, toSlot: slot },
    ]);
    expect(events(session, TriggerCondition.ON_LEAVE_STAGE)).toHaveLength(1);
    expect(events(session, TriggerCondition.ON_ENTER_WAITING_ROOM)).toHaveLength(1);
  });

  it('按实际返手时的有效费用匹配手牌并清理舞台旧修正，手牌候选对对手隐藏且可不登场', () => {
    const session = setup({
      hand: [member('private-same-cost', 22), member('private-wrong-unit', 22, 'DOLLCHESTRA')],
    });
    const state = session.state!;
    set(session, {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: P1,
            memberCardId: 'hime20',
            sourceCardId: LIVE,
            abilityId: 'test-cost',
            countDelta: 2,
          },
        ],
      },
    });
    const returned = confirm(session, 'hime20');
    expect(returned.liveResolution.liveModifiers).toEqual([]);
    expect(returned.activeEffect).toMatchObject({
      selectableCardIds: ['private-same-cost'],
      skipSelectionLabel: '不登场',
    });
    expect(events(session, TriggerCondition.ON_LEAVE_STAGE)).toMatchObject([
      { memberLastKnownInformation: { effectiveCost: 22 } },
    ]);
    expect(projectPlayerViewState(returned, P1).activeEffect?.selectableObjectIds).toHaveLength(1);
    const opponent = projectPlayerViewState(returned, P2);
    expect(opponent.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(JSON.stringify(opponent)).not.toContain('private-same-cost');
    expect(choose(session, 'private-wrong-unit').success).toBe(false);
    expect(confirm(session, null).players[0].hand.cardIds).toContain('hime20');
    expect(events(session, TriggerCondition.ON_ENTER_STAGE)).toEqual([]);
  });

  it('真实入场只抑制自身登场，其他 AUTO 与原 ordered 批次共同重新选序', () => {
    const session = setup({
      stage: [
        { card: member('return-me', 2), slot: LEFT },
        { card: member('kaho', 15, 'Cerise Bouquet', P1, 'PL!HS-pb1-009-R'), slot: CENTER },
      ],
      hand: [hime2()],
      secondLive: true,
    });
    expect(session.state!.activeEffect?.canResolveInOrder).toBe(true);
    confirm(session, undefined, undefined, true);
    expect(session.state!.activeEffect?.sourceCardId).toBe(LIVE);
    confirm(session, 'return-me');
    confirm(session, 'hime2');
    const done = confirm(session, undefined, LEFT);
    expect(events(session, TriggerCondition.ON_ENTER_STAGE)).toMatchObject([
      { cardInstanceId: 'hime2' },
    ]);
    expect(done.activeEffect?.selectableCardIds).toEqual(['other-mira', 'kaho']);
    expect(done.pendingAbilities.map((ability) => ability.abilityId)).toEqual([MIRA, KAHO_AUTO]);
    expect(
      done.actionHistory.some(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === HIME_ENTER
      )
    ).toBe(false);
    expect(confirm(session, 'kaho').activeEffect?.abilityId).toBe(KAHO_AUTO);
    const resolved = confirm(session);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({ kind: 'BLADE', sourceCardId: 'kaho', countDelta: 2 })
    );
    expect(resolved.activeEffect?.sourceCardId).toBe('other-mira');
    expect(resolved.players[0].hand.cardIds).toEqual(['return-me']);
  });

  it('返手后的公开窗口不透露是否存在同费用手牌', () => {
    const stage = [
      { card: hime20(), slot: LEFT },
      { card: member('peer', 4), slot: CENTER },
    ];
    const withMatch = setup({ stage, hand: [member('private-card', 20)] });
    const noMatch = setup({ stage, hand: [member('private-card', 19)] });
    const matching = confirm(withMatch, 'hime20');
    const unmatched = confirm(noMatch, 'hime20');
    expect(projectPlayerViewState(matching, P1).activeEffect?.selectableObjectIds).toHaveLength(1);
    expect(projectPlayerViewState(unmatched, P1).activeEffect?.selectableObjectIds).toEqual([]);
    const visibleWindow = (state: GameState) => ({
      ...projectPlayerViewState(state, P2).activeEffect,
      id: undefined,
    });
    expect(visibleWindow(matching)).toEqual(visibleWindow(unmatched));
    expect(confirm(withMatch, null).activeEffect).toBeNull();
    expect(confirm(noMatch, null).activeEffect).toBeNull();
  });

  it('失效的舞台对象和手牌重新验证，LIVE 来源离开不阻止已有独立效果', () => {
    const session = setup({ hand: [member('alternate', 20), member('blocker', 7, 'DOLLCHESTRA')] });
    const before = session.state!;
    set(
      session,
      emitGameEvent(before, createEnterStageEvent('hime20', ZoneType.HAND, LEFT, P1, P1))
    );
    const refreshed = confirm(session, 'hime20');
    expect(refreshed.activeEffect?.selectableCardIds).toEqual(['hime20']);
    expect(events(session, TriggerCondition.ON_LEAVE_STAGE)).toEqual([]);

    confirm(session, 'hime20');
    confirm(session, 'alternate');
    set(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        liveZone: removeCardFromStatefulZone(player.liveZone, LIVE),
        hand: removeCardFromZone(player.hand, 'alternate'),
        waitingRoom: addCardToZone(player.waitingRoom, 'alternate'),
      }))
    );
    expect(confirm(session, undefined, LEFT).activeEffect?.selectableCardIds).toEqual(['hime20']);
    confirm(session, 'hime20');
    set(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, LEFT, 'blocker'),
        hand: removeCardFromZone(player.hand, 'blocker'),
      }))
    );
    const slotsRefreshed = confirm(session, undefined, LEFT);
    expect(slotsRefreshed.activeEffect?.selectableSlots).toEqual([CENTER, RIGHT]);
    expect(slotsRefreshed.players[0].hand.cardIds).toEqual(['hime20']);
    expect(confirm(session, undefined, RIGHT).players[0].memberSlots.slots[RIGHT]).toBe('hime20');
  });
});
