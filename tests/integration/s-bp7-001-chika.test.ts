import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const SOURCE_ID = 's-bp7-001-source';
const ABILITY_ID = S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID;

function member(
  cardCode: string,
  id: string,
  options: { readonly name?: string; readonly cost?: number; readonly ownerId?: string } = {}
): CardInstance {
  const data: MemberCardData = {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function pending(id = 'pending:s-bp7-001'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event:${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly hand?: readonly CardInstance[];
    readonly waiting?: readonly CardInstance[];
    readonly sourceCode?: string;
    readonly extraPending?: readonly PendingAbilityState[];
  } = {}
): GameState {
  const source = member(options.sourceCode ?? 'PL!S-bp7-001-P', SOURCE_ID, {
    name: '高海千歌',
    cost: 9,
  });
  const hand = options.hand ?? [member('TEST-HAND', 'hand-card')];
  const waiting = options.waiting ?? [member('TEST-RIKO', 'riko', { name: '桜内梨子', cost: 10 })];
  let game = registerCards(createGameState('s-bp7-001-chika', P1, 'P1', P2, 'P2'), [
    source,
    ...hand,
    ...waiting,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waiting.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return {
    ...game,
    pendingAbilities: [pending(), ...(options.extraPending ?? [])],
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function discard(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

function recover(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, P1, game.activeEffect!.id, cardId);
}

describe('PL!S-bp7-001-P 费用9「高海千歌」登场效果', () => {
  it('无手牌时消费 pending；有手牌时可以不发动且不支付费用', () => {
    const noHand = start(setup({ hand: [] }));
    expect(noHand.pendingAbilities).toEqual([]);
    expect(noHand.activeEffect).toBeNull();

    const started = start(setup());
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: ['hand-card'],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const skipped = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].hand.cardIds).toEqual(['hand-card']);
    expect(skipped.players[0].waitingRoom.cardIds).toEqual(['riko']);
  });

  it('支付弃牌后重新扫描；没有费用10以上成员时保留费用并结束', () => {
    const state = discard(
      start(
        setup({
          hand: [member('TEST-LOW-HAND', 'low-hand', { cost: 2 })],
          waiting: [member('TEST-LOW-WAITING', 'low-waiting', { cost: 9 })],
        })
      ),
      'low-hand'
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.players[0].waitingRoom.cardIds).toEqual(['low-waiting', 'low-hand']);
    expect(state.actionHistory).toContainEqual(
      expect.objectContaining({ type: 'PAY_COST', playerId: P1 })
    );
  });

  it('刚作为费用弃置的高费成员也会成为候选，并可回手', () => {
    const riko = member('TEST-RIKO-HAND', 'riko-hand', { name: '桜内梨子', cost: 10 });
    let state = discard(start(setup({ hand: [riko], waiting: [] })), riko.instanceId);
    expect(state.activeEffect?.selectableCardIds).toEqual([riko.instanceId]);

    state = recover(state, riko.instanceId);
    expect(state.players[0].hand.cardIds).toEqual([riko.instanceId]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: P1,
      countDelta: 2,
      sourceCardId: SOURCE_ID,
      abilityId: ABILITY_ID,
    });
  });

  it('首次提交只公开目标，不移动卡牌也不提前给予BLADE', () => {
    let state = discard(start(setup()), 'hand-card');
    const effectId = state.activeEffect!.id;
    state = confirmActiveEffectStep(state, P1, effectId, 'riko');

    expect(state.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: ['riko'],
    });
    expect(state.players[0].waitingRoom.cardIds).toContain('riko');
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);

    state = confirmActiveEffectStep(state, P1, effectId);
    expect(state.players[0].hand.cardIds).toEqual(['riko']);
    expect(state.liveResolution.liveModifiers).toHaveLength(1);
  });

  it.each([
    ['桜内梨子', 2],
    ['樱内梨子', 2],
    ['渡辺曜', 2],
    ['渡边曜', 2],
    ['松浦果南', 0],
  ] as const)('回收「%s」时来源成员获得的BLADE为%s', (name, expectedBlade) => {
    const target = member(`TEST-${name}`, 'target', { name, cost: 11 });
    let state = discard(start(setup({ waiting: [target] })), 'hand-card');
    state = recover(state, target.instanceId);

    expect(state.players[0].hand.cardIds).toContain(target.instanceId);
    expect(state.liveResolution.liveModifiers).toHaveLength(expectedBlade > 0 ? 1 : 0);
    if (expectedBlade > 0) {
      expect(state.liveResolution.liveModifiers[0]).toMatchObject({
        kind: 'BLADE',
        sourceCardId: SOURCE_ID,
        countDelta: expectedBlade,
      });
    }
  });

  it('公开期间目标失效时不换取其他目标，并安全结束', () => {
    const substitute = member('TEST-SUBSTITUTE', 'substitute', { cost: 12 });
    let state = discard(
      start(
        setup({
          waiting: [member('TEST-RIKO', 'riko', { name: '桜内梨子', cost: 10 }), substitute],
        })
      ),
      'hand-card'
    );
    const effectId = state.activeEffect!.id;
    state = confirmActiveEffectStep(state, P1, effectId, 'riko');
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== 'riko'),
      },
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, 'riko'] },
    }));
    state = confirmActiveEffectStep(state, P1, effectId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toContain(substitute.instanceId);
    expect(state.players[0].hand.cardIds).not.toContain(substitute.instanceId);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('来源离场后仍完成回手，但BLADE不写给已离场来源', () => {
    let state = discard(start(setup()), 'hand-card');
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, SOURCE_ID],
      },
    }));
    state = recover(state, 'riko');

    expect(state.players[0].hand.cardIds).toContain('riko');
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('拒绝伪造弃牌与回收目标，并在成功后记录事件、继续后续pending', () => {
    const started = start(setup());
    const forgedDiscard = discard(started, 'forged');
    expect(forgedDiscard).toBe(started);

    let state = discard(started, 'hand-card');
    const beforeForgedRecovery = state;
    state = recover(state, 'forged');
    expect(state).toBe(beforeForgedRecovery);

    state = discard(start(setup()), 'hand-card');
    state = recover(state, 'riko');
    expect(
      state.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.HAND &&
          event.cardInstanceId === 'hand-card'
      )
    ).toBe(true);
    expect(
      state.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_HAND &&
          event.fromZone === ZoneType.WAITING_ROOM &&
          event.cardInstanceId === 'riko'
      )
    ).toBe(true);

    const next = pending('pending:next');
    state = discard(start(setup({ extraPending: [next] })), 'hand-card');
    state = recover(state, 'riko');
    expect(state.pendingAbilities.some((ability) => ability.id === next.id)).toBe(true);
    expect(state.activeEffect?.id).toContain('system:select-pending-card-effect');
  });
});
