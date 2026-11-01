import { describe, expect, it } from 'vitest';
import {
  N_BP8_012_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID as DRAW_ID,
  PL_BP8_009_ACTIVATED_PAY_TWO_ENERGY_STACK_HAND_MEMBER_BELOW_ABILITY_ID as ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getAbilityTurnLimitStatus } from '../../src/application/card-effects/runtime/ability-turn-limit';
import { getGrantedMemberBelowAbilityDefinitions } from '../../src/application/card-effects/runtime/granted-member-below-abilities';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/member-slot-moved-triggers';
import { enqueueTriggeredCardEffects } from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  addMemberCostLiveModifierForMember,
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  countDistinctMemberEffectiveCostsBelowSourceMember,
  getMemberEffectiveCost,
} from '../../src/domain/rules/member-effective-cost';
import { buildPlayMemberCostResources } from '../../src/application/effects/play-member-cost';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition as S,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import { projectPlayerViewState } from '../../src/online/projector';
import { getOctober31LiveData, getOctober31MemberData } from '../helpers/october-31-draft-effects';
import { getOctober26CardData } from '../helpers/october-26-card-effects';
import {
  getNicoEvidencePresentation,
  isNicoEvidenceCurrent,
} from '../../client/src/lib/nicoEvidence';

const P1 = 'p1',
  P2 = 'p2',
  SOURCE = 'nico';
const FACE = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
function set(session: GameSession, state: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}
function member(id: string, cost = 2, code = `TEST-${id}`, owner = P1) {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [],
      groupNames: ["μ's"],
    },
    owner,
    id
  );
}
function setup(
  options: {
    rarity?: string;
    energy?: number;
    active?: number;
    marked?: string[];
    hand?: string[];
    host?: boolean;
    copies?: number;
  } = {}
) {
  const session = createGameSession();
  session.createGame('nico-bp8-009', P1, 'P1', P2, 'P2');
  const nico = {
    ...getOctober31MemberData('PL!-bp8-009'),
    cardCode: `PL!-bp8-009-${options.rarity ?? 'SEC'}`,
  };
  const source = options.host
    ? member(SOURCE, 15, 'LL-bp8-001-R+')
    : createCardInstance(nico, P1, SOURCE);
  const below = options.host
    ? Array.from({ length: options.copies ?? 1 }, (_, i) =>
        createCardInstance(nico, P1, `grant-${i}`)
      )
    : [];
  const energy = Array.from({ length: options.energy ?? 6 }, (_, i) =>
    createCardInstance(
      { cardCode: `E-${i}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `e${i}`
    )
  );
  const hand = [member('h0', 2), member('h1', 3), member('h2', 2), member('h3', 4)];
  let state = registerCards(session.state!, [source, ...below, ...energy, ...hand, member('deck')]);
  state = updatePlayer(state, P1, (p) => {
    let slots = placeCardInSlot(p.memberSlots, S.CENTER, SOURCE, FACE);
    for (const card of below) slots = addMemberBelowMember(slots, S.CENTER, card.instanceId);
    return {
      ...p,
      memberSlots: slots,
      hand: { ...p.hand, cardIds: options.hand ?? hand.map((c) => c.instanceId) },
      mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
      energyZone: energy.reduce(
        (z, card, i) =>
          addCardToStatefulZone(z, card.instanceId, {
            ...FACE,
            orientation:
              i < (options.active ?? energy.length)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
          }),
        p.energyZone
      ),
    };
  });
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    energyActivePhaseSkips: (options.marked ?? []).map((energyCardId) => ({
      playerId: P1,
      energyCardId,
      sourceCardId: 'marker',
      abilityId: 'marker',
    })),
  };
  state = emitGameEvent(state, createEnterStageEvent(SOURCE, ZoneType.HAND, S.CENTER, P1, P1));
  set(session, state);
  return session;
}
function activate(session: GameSession, instance?: string) {
  return session.executeCommand(createActivateAbilityCommand(P1, SOURCE, ID, instance));
}
function choose(session: GameSession, id?: string | null, ids?: string[]) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      id,
      undefined,
      undefined,
      undefined,
      ids
    )
  );
}
function restore(session: GameSession) {
  set(
    session,
    rehydrateAuthorityGameState(
      serializeReplayPayload(session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    )
  );
}
function useRecords(session: GameSession) {
  return session.state!.actionHistory.filter(
    (a) => a.payload.abilityId === ID && a.payload.step === 'ABILITY_USE'
  );
}
function leaveAndReenter(session: GameSession) {
  let state = updatePlayer(session.state!, P1, (p) => ({
    ...p,
    memberSlots: removeCardFromSlot(p.memberSlots, S.CENTER),
    waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, SOURCE] },
  }));
  state = emitGameEvent(
    state,
    createLeaveStageEvent(SOURCE, S.CENTER, ZoneType.WAITING_ROOM, P1, P1)
  );
  state = updatePlayer(state, P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, S.CENTER, SOURCE, FACE),
    waitingRoom: { ...p.waitingRoom, cardIds: p.waitingRoom.cardIds.filter((id) => id !== SOURCE) },
  }));
  set(
    session,
    emitGameEvent(state, createEnterStageEvent(SOURCE, ZoneType.WAITING_ROOM, S.CENTER, P1, P1))
  );
}

describe('PL!-bp8-009 费用11「矢泽日香（矢泽妮可）」', () => {
  it.each(['SEC', 'R+', 'OTHER'])('%s全罕度两段完整正文与每回合2次', (rare) => {
    const defs = getCardAbilityDefinitionsForCardCode(`PL!-bp8-009-${rare}`);
    expect(defs.map((d) => d.effectText)).toEqual([
      '【常时】放置于此成员下方的费用各不相同的成员卡每有１张，此成员的费用＋２，获得[桃ハート][ブレード]。',
      '【起动】【１回合２次】[E][E]：从自己的手牌将１张成员卡放置于此成员的下方。',
    ]);
    expect(defs[1].activatedUi?.text).toBe(
      '【起动】【１回合２次】[E][E]：从自己的手牌将１张成员卡放置于此成员的下方。'
    );
    expect(defs[1].perTurnLimit).toBe(2);
  });
  it('按下方不同有效费用种类同时加费用桃Heart和Blade，重复费用只计一次', () => {
    const session = setup();
    for (const id of ['h0', 'h2']) {
      expect(activate(session).success).toBe(true);
      expect(choose(session, id).success).toBe(true);
    }
    const game = session.state!;
    expect(countDistinctMemberEffectiveCostsBelowSourceMember(game, P1, SOURCE)).toBe(1);
    expect(getMemberEffectiveCost(game, P1, SOURCE)).toBe(13);
    expect(getMemberEffectiveBladeCount(game, P1, SOURCE)).toBe(5);
    expect(getMemberEffectiveHeartIcons(game, P1, SOURCE)).toContainEqual({
      color: HeartColor.PINK,
      count: 1,
    });
    expect(buildPlayMemberCostResources(game, P1, 'h1')?.stageMembers[0].effectiveCost).toBe(13);
    expect(activate(session).success).toBe(false);
    set(session, { ...game, turnCount: game.turnCount + 1 });
    expect(activate(session).success).toBe(true);
    expect(choose(session, 'h1').success).toBe(true);
    expect(getMemberEffectiveCost(session.state!, P1, SOURCE)).toBe(15);
  });
  it('隐藏手牌可选择不放置，空手和没有成员仍支付费用并消耗一次', () => {
    for (const hand of [undefined, []]) {
      const session = setup({ energy: 2, hand });
      expect(activate(session).success).toBe(true);
      if (hand === undefined) {
        expect(session.state!.activeEffect).toMatchObject({
          canSkipSelection: true,
          skipSelectionLabel: '不放置',
          minSelectableCards: 0,
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        });
        expect(choose(session, null).success).toBe(true);
      }
      expect(session.state!.activeEffect).toBeNull();
      expect(useRecords(session)).toHaveLength(1);
      expect(session.state!.players[0].energyZone.cardStates.get('e0')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(session.state!.players[0].memberSlots.memberBelow[S.CENTER]).toEqual([]);
    }
  });
  it('没有MEMBER的手牌仍支付且不公开其他手牌，私密候选仅控制者可见', () => {
    const session = setup({ energy: 2 });
    activate(session);
    const own = JSON.stringify(projectPlayerViewState(session.state!, P1));
    const opponent = JSON.stringify(projectPlayerViewState(session.state!, P2));
    expect(own).toContain('TEST-h0');
    expect(opponent).not.toContain('TEST-h0');
    choose(session, null);
    const noMember = setup({ energy: 2, hand: ['private-live'] });
    set(
      noMember,
      registerCards(noMember.state!, [
        createCardInstance(getOctober31LiveData('PL!N-bp8-025'), P1, 'private-live'),
      ])
    );
    expect(activate(noMember).success).toBe(true);
    expect(noMember.state!.activeEffect).toBeNull();
    expect(noMember.state!.players[0].hand.cardIds).toEqual(['private-live']);
    expect(useRecords(noMember)).toHaveLength(1);
    expect(JSON.stringify(projectPlayerViewState(noMember.state!, P2))).not.toContain(
      'PL!N-bp8-025'
    );
  });
  it('已支付后stale手牌不能叠入，保留费用并可不放置结束', () => {
    const session = setup();
    activate(session);
    set(
      session,
      updatePlayer(session.state!, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: p.hand.cardIds.filter((id) => id !== 'h0') },
        waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, 'h0'] },
      }))
    );
    expect(choose(session, 'h0').success).toBe(false);
    expect(useRecords(session)).toHaveLength(1);
    expect(choose(session, null).success).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('h0');
  });
  it('不足能量不启动；普通超额自动支付区域前2张；非法手牌不推进', () => {
    const insufficient = setup({ energy: 1 });
    expect(activate(insufficient).success).toBe(false);
    expect(useRecords(insufficient)).toEqual([]);
    const session = setup();
    activate(session);
    expect(
      session.state!.actionHistory.find((a) => a.type === 'PAY_COST' && a.payload.abilityId === ID)
        ?.payload.energyCardIds
    ).toEqual(['e0', 'e1']);
    const before = session.state!;
    expect(choose(session, 'deck').success).toBe(false);
    expect(session.state).toBe(before);
    choose(session, 'h0');
    expect(session.state!.players[0].hand.cardIds).not.toContain('h0');
  });
  it('特殊能量恢复保留宿主和次数身份，重复/非法/stale能量不支付', () => {
    const session = setup({ energy: 3, marked: ['e2'] });
    expect(activate(session).success).toBe(true);
    expect(session.state!.activeEffect?.stepText).toBe('请选择用于支付[E][E]的活跃能量卡。');
    expect(useRecords(session)).toEqual([]);
    restore(session);
    expect(choose(session, undefined, ['e2', 'e2']).success).toBe(false);
    expect(choose(session, undefined, ['e2', 'bad']).success).toBe(false);
    expect(choose(session, undefined, ['e2', 'e1']).success).toBe(true);
    expect(session.state!.activeEffect?.stepId).toBe('PL_BP8_009_SELECT_HAND_MEMBER_BELOW');
    choose(session, 'h0');
    expect(useRecords(session)).toHaveLength(1);
    expect(session.state!.players[0].energyZone.cardStates.get('e0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });
  it('特殊能量选择中宿主重登仍支付但不叠给新对象；旧调用次数不占新对象', () => {
    const session = setup({ energy: 3, marked: ['e2'] });
    activate(session);
    const oldLifecycle = session.state!.activeEffect!.sourceLifecycleId;
    restore(session);
    leaveAndReenter(session);
    expect(choose(session, undefined, ['e2', 'e1']).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toContain('h0');
    expect(useRecords(session)[0].payload.sourceLifecycleId).toBe(oldLifecycle);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE)?.used).toBe(0);
    expect(session.state!.players[0].energyZone.cardStates.get('e2')?.orientation).toBe(
      OrientationState.WAITING
    );
  });
  it('费用种类纯查询排除能量、非己方成员与其他槽；下方成员场上常时加费失效', () => {
    const session = setup({ energy: 11 });
    const below = [
      member('cost2', 2),
      member('same2', 2),
      member('cost3', 3),
      member('foreign', 8, 'X', P2),
      member('stagebonus', 2, 'PL!SP-pb1-010-R'),
    ];
    let game = registerCards(session.state!, [
      ...below,
      member('other-slot', 99),
      member('other-below', 88),
    ]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, S.LEFT, 'stagebonus', FACE),
    }));
    expect(getMemberEffectiveCost(game, P1, 'stagebonus')).toBe(6);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: {
        ...placeCardInSlot(removeCardFromSlot(p.memberSlots, S.LEFT), S.RIGHT, 'other-slot', FACE),
        memberBelow: {
          ...p.memberSlots.memberBelow,
          [S.CENTER]: below.map((c) => c.instanceId),
          [S.RIGHT]: ['other-below'],
        },
        energyBelow: { ...p.memberSlots.energyBelow, [S.CENTER]: ['e0'] },
      },
      energyZone: { ...p.energyZone, cardIds: p.energyZone.cardIds.filter((id) => id !== 'e0') },
    }));
    expect(countDistinctMemberEffectiveCostsBelowSourceMember(game, P1, SOURCE)).toBe(2);
    expect(getMemberEffectiveCost(game, P1, 'stagebonus')).toBe(2);
    expect(getMemberEffectiveCost(game, P1, SOURCE)).toBe(15);
    for (const viewer of [P1, P2]) {
      expect(projectPlayerViewState(game, viewer).objects.obj_nico.nicoEvidence?.costKinds).toBe(2);
    }
    const gone = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, S.CENTER),
    }));
    expect(getMemberEffectiveCost(gone, P1, SOURCE)).toBe(11);
    expect(collectLiveModifiers(gone).filter((m) => m.sourceCardId === SOURCE)).toEqual([]);
  });
  it('真实离场清除旧成员费用修正，下方再次读取不携带旧加费', () => {
    const session = setup();
    let game = registerCards(session.state!, [member('target', 2)]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, S.LEFT, 'target', FACE),
    }));
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P1,
      sourceCardId: SOURCE,
      memberCardId: 'target',
      abilityId: 'test-cost',
      countDelta: 4,
    })!.gameState;
    expect(getMemberEffectiveCost(game, P1, 'target')).toBe(6);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'target',
      enqueueTriggeredCardEffects
    )!;
    game = updatePlayer(left.gameState, P1, (p) => ({
      ...p,
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'target'),
      },
      memberSlots: addMemberBelowMember(p.memberSlots, S.CENTER, 'target'),
    }));
    expect(getMemberEffectiveCost(game, P1, 'target')).toBe(2);
    expect(countDistinctMemberEffectiveCostsBelowSourceMember(game, P1, SOURCE)).toBe(1);
  });
  it.each(['EMPTY_HAND', 'REENTERED_HOST'] as const)(
    '特殊能量恢复%s后统一继续已有pending，费用次数只记一次',
    (scenario) => {
      const session = setup({
        energy: 3,
        marked: ['e2'],
        hand: scenario === 'EMPTY_HAND' ? [] : undefined,
      });
      activate(session);
      if (scenario === 'REENTERED_HOST') leaveAndReenter(session);
      const drawSource = member('draw-source', 4, 'PL!N-bp8-012-R');
      let game = registerCards(session.state!, [drawSource]);
      game = {
        ...game,
        pendingAbilities: [
          {
            id: 'queued-draw',
            abilityId: DRAW_ID,
            sourceCardId: drawSource.instanceId,
            controllerId: P1,
            mandatory: true,
            timingId: TriggerCondition.ON_LIVE_SUCCESS,
            eventIds: [],
          },
        ],
      };
      set(session, game);
      expect(choose(session, undefined, ['e2', 'e1']).success).toBe(true);
      expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(session.state!.activeEffect?.abilityId).toBe(DRAW_ID);
      expect(session.state!.players[0].hand.cardIds).not.toContain('deck');
      expect(useRecords(session)).toHaveLength(1);
      expect(
        session.state!.actionHistory.filter(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === ID
        )
      ).toHaveLength(1);
      expect(choose(session).success).toBe(true);
      expect(session.state!.players[0].hand.cardIds).toContain('deck');
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.pendingAbilities).toEqual([]);
    }
  );
  it('stale能量ID不推进支付', () => {
    const session = setup({ energy: 3, marked: ['e2'] });
    activate(session);
    set(
      session,
      updatePlayer(session.state!, P1, (p) => ({
        ...p,
        energyZone: { ...p.energyZone, cardIds: p.energyZone.cardIds.filter((id) => id !== 'e2') },
        exileZone: { ...p.exileZone, cardIds: [...p.exileZone.cardIds, 'e2'] },
      }))
    );
    expect(choose(session, undefined, ['e2', 'e1']).success).toBe(false);
    expect(useRecords(session)).toEqual([]);
  });
  it('实际槽位移动不重置两次限制', () => {
    const session = setup();
    for (let i = 0; i < 2; i++) {
      activate(session);
      choose(session, null);
    }
    const moved = moveMemberBetweenSlotsAndEnqueueTriggers(
      session.state!,
      P1,
      SOURCE,
      S.LEFT,
      enqueueTriggeredCardEffects
    )!;
    set(session, moved.gameState);
    expect(session.state!.players[0].memberSlots.slots[S.LEFT]).toBe(SOURCE);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE)?.used).toBe(2);
    expect(activate(session).success).toBe(false);
  });
  it('原生Nico与LL宿主两份授予的计次分别独立', () => {
    const session = setup({ host: true, copies: 2, energy: 4 });
    const grants = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE);
    const native = createCardInstance(getOctober31MemberData('PL!-bp8-009'), P1, 'native-nico');
    let game = registerCards(session.state!, [native]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, S.LEFT, native.instanceId, FACE),
    }));
    set(session, game);
    expect(activate(session, grants[0].abilityInstanceId).success).toBe(true);
    choose(session, null);
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, native.instanceId, ID)).success
    ).toBe(true);
    choose(session, null);
    expect(getAbilityTurnLimitStatus(session.state!, P1, ID, native.instanceId)?.used).toBe(1);
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, grants[0].abilityInstanceId)?.used
    ).toBe(1);
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, grants[1].abilityInstanceId)?.used
    ).toBe(0);
  });
  it.each([0, 1])('真实RULES换手按下方%i种费用减免，15费用成员用2能量仅在加费后能登场', (count) => {
    const session = setup({ energy: 2 });
    // This existing frozen member was checked against the specified October 31 export.
    const maki = createCardInstance(getOctober26CardData('PL!-bp8-006-P'), P1, 'relay-maki');
    let game = registerCards(session.state!, [maki]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: [maki.instanceId] },
      memberSlots: count ? addMemberBelowMember(p.memberSlots, S.CENTER, 'h0') : p.memberSlots,
    }));
    set(session, {
      ...game,
      manualOperationMode: 'RULES',
      waitingForInput: false,
      waitingPlayerId: null,
    });
    expect(session.manualOperationMode).toBe('RULES');
    expect(getMemberEffectiveCost(session.state!, P1, SOURCE)).toBe(11 + count * 2);
    const played = session.executeCommand(
      createPlayMemberToSlotCommand(P1, maki.instanceId, S.CENTER, { relayMode: 'SINGLE' })
    );
    expect(played.success, played.error).toBe(count === 1);
    if (!count) {
      expect(session.state!.players[0].memberSlots.slots[S.CENTER]).toBe(SOURCE);
      return;
    }
    const entrance = session.state!.entranceRuntime?.pending;
    if (entrance)
      expect(
        session.executeCommand({
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId: P1,
          entranceId: entrance.id,
          timestamp: Date.now(),
        }).success
      ).toBe(true);
    expect(session.state!.players[0].memberSlots.slots[S.CENTER]).toBe(maki.instanceId);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([SOURCE, 'h0'])
    );
    expect(
      session.state!.players[0].energyZone.cardIds.filter(
        (id) =>
          session.state!.players[0].energyZone.cardStates.get(id)?.orientation ===
          OrientationState.WAITING
      )
    ).toHaveLength(2);
  });
  it('LL授予经特殊能量恢复保留精确实例；缺省伪造错配实例拒绝', () => {
    const session = setup({ host: true, copies: 2, energy: 3, marked: ['e2'] });
    const grants = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE);
    expect(activate(session).success).toBe(false);
    expect(activate(session, 'forged').success).toBe(false);
    expect(activate(session, grants[0].abilityInstanceId).success).toBe(true);
    const captured = {
      abilityInstanceId: session.state!.activeEffect!.abilityInstanceId,
      sourceLifecycleId: session.state!.activeEffect!.sourceLifecycleId,
    };
    restore(session);
    expect(session.state!.activeEffect).toMatchObject(captured);
    choose(session, undefined, ['e2', 'e1']);
    expect(session.state!.activeEffect).toMatchObject(captured);
    choose(session, 'h0');
    expect(useRecords(session)[0].payload).toMatchObject(captured);
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, grants[0].abilityInstanceId)?.used
    ).toBe(1);
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, grants[1].abilityInstanceId)?.used
    ).toBe(0);
  });
  it('LL精确授予移除后不能借另一相同副本继续新起动', () => {
    const session = setup({ host: true, copies: 2 });
    const grants = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE);
    set(
      session,
      updatePlayer(session.state!, P1, (p) => ({
        ...p,
        memberSlots: {
          ...p.memberSlots,
          memberBelow: { ...p.memberSlots.memberBelow, [S.CENTER]: ['grant-1'] },
        },
        waitingRoom: { ...p.waitingRoom, cardIds: ['grant-0'] },
      }))
    );
    expect(activate(session, grants[0].abilityInstanceId).success).toBe(false);
    expect(activate(session, grants[1].abilityInstanceId).success).toBe(true);
    choose(session, null);
    expect(useRecords(session)).toHaveLength(1);
    expect(useRecords(session)[0].payload.abilityInstanceId).toBe(grants[1].abilityInstanceId);
  });
  it('LL只授予起动，两副本次数独立，每副本各能使用两次', () => {
    const session = setup({ host: true, copies: 2, energy: 8 });
    const grants = getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE);
    expect(grants.map((g) => g.definition.abilityId)).toEqual([ID, ID]);
    for (const grant of grants) {
      for (let i = 0; i < 2; i++) {
        expect(activate(session, grant.abilityInstanceId).success).toBe(true);
        choose(session, null);
        restore(session);
      }
      expect(activate(session, grant.abilityInstanceId).success).toBe(false);
      expect(
        getAbilityTurnLimitStatus(session.state!, P1, ID, SOURCE, grant.abilityInstanceId)?.used
      ).toBe(2);
    }
    expect(getMemberEffectiveCost(session.state!, P1, SOURCE)).toBe(15);
    expect(getMemberEffectiveBladeCount(session.state!, P1, SOURCE)).toBe(1);
    expect(useRecords(session).map((r) => r.payload.abilityInstanceId)).toEqual(
      grants.flatMap((g) => [g.abilityInstanceId, g.abilityInstanceId])
    );
  });
});

describe('11费妮可：公开线索动画投影', () => {
  it.each(['SEC', 'R+', 'OTHER'])(
    '全罕度成功叠卡后双方才获得公开线索；重复费用不表现额外成长 (%s)',
    (rarity) => {
      const session = setup({ rarity });
      let sequence = 1;
      for (const id of ['h0', 'h2']) {
        expect(activate(session).success).toBe(true);
        const previous = [P1, P2].map((viewer) =>
          projectPlayerViewState(session.state!, viewer, { seq: sequence++ })
        );
        expect(previous[1].objects[`obj_${id}`]?.frontInfo).toBeUndefined();
        expect(choose(session, id).success).toBe(true);
        for (const [i, viewer] of [P1, P2].entries()) {
          const next = projectPlayerViewState(session.state!, viewer, { seq: sequence++ });
          const cue = getNicoEvidencePresentation(previous[i], next);
          expect(cue).toMatchObject({
            hostId: 'obj_nico',
            cardId: `obj_${id}`,
            newCostKind: id === 'h0',
          });
          expect(next.objects.obj_nico.nicoEvidence?.costKinds).toBe(1);
          expect(isNicoEvidenceCurrent(next, cue!)).toBe(true);
          expect(getNicoEvidencePresentation(next, next)).toBeNull();
          expect(getNicoEvidencePresentation(null, next)).toBeNull();
          expect(getNicoEvidencePresentation(next, previous[i])).toBeNull();
          expect(
            getNicoEvidencePresentation({ ...previous[i], activeEffect: null }, next)
          ).toBeNull();
          const left = updatePlayer(session.state!, P1, (p) => ({
            ...p,
            memberSlots: removeCardFromSlot(p.memberSlots, S.CENTER),
            waitingRoom: { ...p.waitingRoom, cardIds: ['nico', id] },
          }));
          const gone = projectPlayerViewState(left, viewer, { seq: sequence++ });
          expect(gone.objects.obj_nico.nicoEvidence).toBeUndefined();
          expect(isNicoEvidenceCurrent(gone, cue!)).toBe(false);
          expect(
            isNicoEvidenceCurrent(
              {
                ...next,
                objects: {
                  ...next.objects,
                  obj_nico: {
                    ...next.objects.obj_nico,
                    nicoEvidence: { costKinds: 1, incarnation: 'new-entry' },
                  },
                },
              },
              cue!
            )
          ).toBe(false);
        }
        expect(session.state!.activeEffect).toBeNull(); // No cosmetic wait is inserted into the rule flow.
      }
    }
  );
  it('不放置、无手牌、借用起动的其他成员均没有妮可专属演出', () => {
    for (const options of [{}, { hand: [] }, { host: true }]) {
      const session = setup(options);
      const instance = options.host
        ? getGrantedMemberBelowAbilityDefinitions(session.state!, P1, SOURCE)[0].abilityInstanceId
        : undefined;
      expect(activate(session, instance).success).toBe(true);
      const before = projectPlayerViewState(session.state!, P1, { seq: 1 });
      if (session.state!.activeEffect)
        expect(choose(session, options.host ? 'h0' : null).success).toBe(true);
      const after = projectPlayerViewState(session.state!, P1, { seq: 2 });
      expect(getNicoEvidencePresentation(before, after)).toBeNull();
    }
  });
  it('第二种费用由规则端投影为新增线索，对局结束撤掉来源状态', () => {
    const session = setup();
    expect(activate(session).success).toBe(true);
    expect(choose(session, 'h0').success).toBe(true);
    expect(activate(session).success).toBe(true);
    const before = projectPlayerViewState(session.state!, P1, { seq: 1 });
    expect(choose(session, 'h1').success).toBe(true);
    const after = projectPlayerViewState(session.state!, P1, { seq: 2 });
    expect(after.objects.obj_nico.nicoEvidence?.costKinds).toBe(2);
    expect(getNicoEvidencePresentation(before, after)?.newCostKind).toBe(true);
    const hidden = projectPlayerViewState({ ...session.state!, isEnded: true }, P2, { seq: 3 });
    expect(hidden.objects.obj_nico.nicoEvidence).toBeUndefined();
  });
});
