import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { describe, expect, it } from 'vitest';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID as RURINO,
  PL_PB2_024_LIVE_START_ONLY_BIBI_WAIT_LOW_COST_OPPONENT_ABILITY_ID as MAKI,
  PL_PB2_028_LIVE_START_WAIT_SELF_GAIN_YELLOW_HEART_ABILITY_ID as HONOKA,
  PL_PB2_031_LIVE_START_DISCARD_MUSE_GAIN_PURPLE_HEART_ABILITY_ID as UMI,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardType,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

function member(code: string, cost = 2, unitName = 'BiBi', groupNames = ['μ’s']) {
  return createCardInstance(
    {
      cardCode: code,
      cardType: CardType.MEMBER,
      name: code,
      cost,
      blade: 1,
      hearts: [],
      unitName,
      groupNames,
    } as MemberCardData,
    'p1',
    code
  );
}
function setup(code: string, abilityId: string) {
  const sourceData: Record<
    string,
    {
      name: string;
      cost: number;
      unitName: string;
      blade: number;
      hearts: { color: HeartColor; count: number }[];
    }
  > = {
    [MAKI]: {
      name: '西木野真姬',
      cost: 4,
      unitName: 'BiBi',
      blade: 2,
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
    },
    [HONOKA]: { name: '高坂穗乃果', cost: 2, unitName: 'Printemps', blade: 1, hearts: [] },
    [UMI]: {
      name: '园田海未',
      cost: 4,
      unitName: 'lily white',
      blade: 2,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    },
  };
  const raw = member(code);
  const source = { ...raw, data: { ...raw.data, ...sourceData[abilityId] } };

  let game = registerCards(createGameState('pb2-stage', 'p1', 'P1', 'p2', 'P2'), [source]);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  return {
    ...game,
    pendingAbilities: [
      {
        id: 'pending',
        abilityId,
        sourceCardId: source.instanceId,
        controllerId: 'p1',
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [],
      },
    ],
  };
}
function resolve(game: GameState) {
  return resolvePendingCardEffects(game).gameState;
}
function select(game: GameState, cardId?: string, option?: string) {
  return confirmActiveEffectStep(
    game,
    'p1',
    game.activeEffect!.id,
    cardId,
    undefined,
    undefined,
    option
  );
}
function opponent(game: GameState, cost = 2) {
  const card = { ...member('target', cost), ownerId: 'p2' };
  return updatePlayer(registerCards(game, [card]), 'p2', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, card.instanceId),
  }));
}

describe('PL!-pb2 stage and Heart effects', () => {
  it.each([
    ['024', MAKI],
    ['028', HONOKA],
    ['031', UMI],
  ])('covers printed and unknown rarity %s', (number, ability) => {
    for (const rarity of ['N', 'SEC', 'UNKNOWN'])
      expect(
        getCardAbilityDefinitionsForCardCode(`PL!-pb2-${number}-${rarity}`).some(
          (d) => d.abilityId === ability
        )
      ).toBe(true);
  });
  it('waits a legal opponent with one BiBi source and emits state event', () => {
    const window = resolve(opponent(setup('PL!-pb2-024-N', MAKI)));
    expect(window.activeEffect?.selectableCardIds).toEqual(['target']);
    expect(select(window, 'illegal')).toBe(window);
    const done = select(window, 'target');
    expect(done.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
    ).toHaveLength(1);
  });
  it('checks effective rather than printed cost and confirms no target', () => {
    let game = opponent(setup('PL!-pb2-024-N', MAKI));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: 'p2',
            sourceCardId: 'other',
            abilityId: 'test',
            memberCardId: 'target',
            countDelta: 3,
          },
        ],
      },
    };
    const window = resolve(game);
    expect(window.activeEffect?.selectableCardIds ?? []).toEqual([]);
    expect(window.activeEffect?.effectText).toContain('可选择目标0名');
    expect(select(window).activeEffect).toBeNull();
  });
  it('confirms failed all-BiBi condition and rechecks it after selecting a target', () => {
    const game = opponent(setup('PL!-pb2-024-N', MAKI));
    const other = member('other', 2, 'Printemps');
    const addOther = (s: GameState) =>
      updatePlayer(registerCards(s, [other]), 'p1', (p) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, other.instanceId),
      }));
    const window = resolve(addOther(game));
    expect(window.activeEffect?.effectText).toContain('条件未满足');
    expect(select(window).activeEffect).toBeNull();
    const stale = select(addOther(resolve(game)), 'target');
    expect(stale.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(stale.activeEffect).toBeNull();
  });
  it('does not wait a new stage instance through an old target selection', () => {
    const window = resolve(opponent(setup('PL!-pb2-024-N', MAKI)));
    const reentered = emitGameEvent(
      window,
      createEnterStageEvent('target', ZoneType.WAITING_ROOM, SlotPosition.CENTER, 'p2', 'p2')
    );
    const done = select(reentered, 'target');
    expect(done.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.activeEffect).toBeNull();
    expect(
      done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
    ).toHaveLength(0);
  });
  it('uses optional self wait with no fake card choice; pays and adds yellow source Heart', () => {
    const window = resolve(setup('PL!-pb2-028-N', HONOKA));
    expect(window.activeEffect?.selectableCardIds).toBeUndefined();
    expect(window.activeEffect?.selectableOptions).toEqual([{ id: 'WAIT_SOURCE', label: '发动' }]);
    expect(window.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(select(window, undefined, 'invalid')).toBe(window);
    const done = select(window, undefined, 'WAIT_SOURCE');
    expect(done.players[0].memberSlots.cardStates.get('PL!-pb2-028-N')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      })
    );
    expect(getMemberEffectiveHeartIcons(done, 'p1', 'PL!-pb2-028-N')).toContainEqual({
      color: HeartColor.YELLOW,
      count: 1,
    });
    expect(done.actionHistory.filter((a) => a.type === 'PAY_COST')).toHaveLength(1);
    expect(
      done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
    ).toHaveLength(1);
    expect(done.activeEffect).toBeNull();
  });
  it('supports decline, already waiting, and invalidated self-wait cost without a Heart', () => {
    const window = resolve(setup('PL!-pb2-028-N', HONOKA));
    expect(select(window).liveResolution.liveModifiers).toEqual([]);
    const waited = updatePlayer(window, 'p1', (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'PL!-pb2-028-N', {
        orientation: OrientationState.WAITING,
      }),
    }));
    expect(select(waited, undefined, 'WAIT_SOURCE').liveResolution.liveModifiers).toEqual([]);
    const waitingStart = resolve({
      ...waited,
      activeEffect: null,
      pendingAbilities: setup('PL!-pb2-028-N', HONOKA).pendingAbilities,
    });
    expect(select(waitingStart).activeEffect).toBeNull();
  });
  it('does not pay a stale Honoka instance; Umi still pays a legal fee without rewarding the replacement instance', () => {
    const honoka = resolve(setup('PL!-pb2-028-N', HONOKA));
    const reenteredHonoka = emitGameEvent(
      honoka,
      createEnterStageEvent('PL!-pb2-028-N', ZoneType.WAITING_ROOM, SlotPosition.CENTER, 'p1', 'p1')
    );
    const stopped = select(reenteredHonoka, undefined, 'WAIT_SOURCE');
    expect(stopped.liveResolution.liveModifiers).toEqual([]);
    expect(stopped.players[0].memberSlots.cardStates.get('PL!-pb2-028-N')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    let umi = registerCards(setup('PL!-pb2-031-N', UMI), [member('fee')]);
    umi = updatePlayer(umi, 'p1', (p) => ({ ...p, hand: { ...p.hand, cardIds: ['fee'] } }));
    const window = resolve(umi);
    const reenteredUmi = emitGameEvent(
      window,
      createEnterStageEvent('PL!-pb2-031-N', ZoneType.WAITING_ROOM, SlotPosition.CENTER, 'p1', 'p1')
    );
    const paid = select(reenteredUmi, 'fee');
    expect(paid.players[0].waitingRoom.cardIds).toContain('fee');
    expect(paid.liveResolution.liveModifiers).toEqual([]);
    expect(paid.activeEffect).toBeNull();
  });
  it('confirms no eligible Umi fee and removes the Heart when its recipient leaves', () => {
    const empty = resolve(setup('PL!-pb2-031-N', UMI));
    expect(empty.activeEffect?.stepText).toBe('没有可用于支付费用的手牌，确认后不处理。');
    expect(select(empty).activeEffect).toBeNull();
    const honoka = select(resolve(setup('PL!-pb2-028-N', HONOKA)), undefined, 'WAIT_SOURCE');
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      honoka,
      'p1',
      'PL!-pb2-028-N',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(left.liveResolution.liveModifiers).toEqual([]);
    const reentered = updatePlayer(left, 'p1', (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'PL!-pb2-028-N'),
    }));
    expect(reentered.liveResolution.liveModifiers).toEqual([]);
    expect(getMemberEffectiveHeartIcons(reentered, 'p1', 'PL!-pb2-028-N')).toEqual([]);
  });
  it('finishes fixed Heart before newly triggered hand-discard ability resolves', () => {
    const fee = member('muse-fee');
    const observer = member('PL!HS-pb1-003-R', 15, '', ['莲之空']);
    let game = registerCards(setup('PL!-pb2-031-N', UMI), [fee, observer]);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: [fee.instanceId] },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, observer.instanceId),
    }));
    const done = select(resolve(game), fee.instanceId);
    expect(getMemberEffectiveHeartIcons(done, 'p1', 'PL!-pb2-031-N')).toContainEqual({
      color: HeartColor.PURPLE,
      count: 1,
    });
    const ownResolution = done.actionHistory.findIndex(
      (a) =>
        a.type === 'RESOLVE_ABILITY' &&
        a.payload.abilityId === UMI &&
        a.payload.step === 'APPLY_HEART_BONUS'
    );
    const newResolution = done.actionHistory.findIndex(
      (a) => a.type === 'RESOLVE_ABILITY' && a.payload.abilityId === RURINO
    );
    expect(ownResolution).toBeGreaterThanOrEqual(0);
    expect(newResolution).toBeGreaterThan(ownResolution);
  });
  it('filters Umi discard to Muse, rejects illegal and stale fees, adds fixed purple without choice', () => {
    const muse = member('muse');
    const other = member('not-muse', 2, '', ['虹ヶ咲']);
    let game = registerCards(setup('PL!-pb2-031-N', UMI), [muse, other]);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['muse', 'not-muse'] },
    }));
    const window = resolve(game);
    expect(window.activeEffect?.selectableCardIds).toEqual(['muse']);
    expect(select(window, 'not-muse')).toBe(window);
    const stale = updatePlayer(window, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['not-muse'] },
    }));
    expect(select(stale, 'muse')).toBe(stale);
    const done = select(window, 'muse');
    expect(done.players[0].waitingRoom.cardIds).toContain('muse');
    expect(done.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      })
    );
    expect(done.activeEffect).toBeNull();
    expect(
      done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)
    ).toHaveLength(1);
    expect(select(window).players[0].hand.cardIds).toEqual(['muse', 'not-muse']);
  });
});
