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
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY = N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID;

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

function setup() {
  const shizuku = member('PL!N-bp7-003-SEC', 'shizuku', { cost: 15 });
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
  let game = registerCards(createGameState('shizuku-bp7', P1, 'P1', P2, 'P2'), [
    shizuku,
    ...deck,
  ]);
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

describe('PL!N-bp7-003-SEC 樱坂雫', () => {
  it('先公开顶5费用，再从当前休息室结构化选择并快照完整印刷 Heart', () => {
    const { game, shizuku, target, invalidGroup, tooExpensive } = setup();
    const revealed = activateCardAbility(game, P1, shizuku.instanceId, ABILITY);
    expect(revealed.activeEffect?.revealedCardIds).toHaveLength(5);
    expect(revealed.activeEffect?.stepText).toContain('5张');
    expect(revealed.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toHaveLength(1);

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
    const combined = member('COMBINED', 'combined', { name: '上原歩夢&桜坂しずく' });
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
    const resolved = resolveLiveStart({ ...game, pendingAbilities: [livePending(shizuku.instanceId)] });
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
