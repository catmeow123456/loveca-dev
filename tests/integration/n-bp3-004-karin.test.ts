import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { activateCardAbility, confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID as ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1', P2 = 'p2';
const member = (code: string, id: string): CardInstance<MemberCardData> => createCardInstance({ cardCode: code, name: code, groupNames: ['虹ヶ咲'], cardType: CardType.MEMBER, cost: 13, blade: 4, hearts: [createHeartIcon(HeartColor.BLUE, 1)] }, P1, id);
const live = (code: string, id: string, groups = ['虹ヶ咲']): CardInstance<LiveCardData> => createCardInstance({ cardCode: code, name: code, groupNames: groups, cardType: CardType.LIVE, score: 3, requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }) }, P1, id);
function setup(rarity: 'R' | 'P' = 'R', handIds = ['hand-member'], waitingIds = ['nijigasaki-live', 'other-live']) {
  const cards = [member(`PL!N-bp3-004-${rarity}`, 'source'), member('PL!N-test-member', 'hand-member'), live('PL!N-test-live', 'hand-nijigasaki-live'), live('PL!N-wait-live', 'nijigasaki-live'), live('PL!S-wait-live', 'other-live', ['Aqours'])];
  let game = registerCards(createGameState('n-bp3-004', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (p) => ({ ...p, memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), hand: { ...p.hand, cardIds: handIds }, waitingRoom: { ...p.waitingRoom, cardIds: waitingIds } }));
  return { ...game, currentPhase: GamePhase.MAIN_PHASE };
}
const activate = (game: ReturnType<typeof setup>) => activateCardAbility(game, P1, 'source', ABILITY_ID);
const choose = (game: ReturnType<typeof setup>, cardId?: string) => confirmActiveEffectStepThroughPublicReveal(game, P1, game.activeEffect!.id, cardId);

describe('PL!N-bp3-004 朝香果林', () => {
  it.each(['R', 'P'] as const)('先待机、后强制弃手，再强制回收虹咲LIVE：%s', (rarity) => {
    const started = activate(setup(rarity));
    expect(started.players[0]!.memberSlots.cardStates.get('source')?.orientation).toBe(OrientationState.WAITING);
    expect(started.activeEffect).toMatchObject({ stepText: expect.stringContaining('请选择1张手牌'), selectableCardIds: ['hand-member'], canSkipSelection: false });
    expect(started.actionHistory.some((action) => action.payload.step === 'ABILITY_USE')).toBe(false);
    const afterDiscard = choose(started, 'hand-member');
    expect(afterDiscard.players[0]!.waitingRoom.cardIds).toContain('hand-member');
    expect(afterDiscard.activeEffect).toMatchObject({ selectableCardIds: ['nijigasaki-live'], canSkipSelection: false });
    expect(afterDiscard.actionHistory.some((action) => action.payload.step === 'ABILITY_USE')).toBe(true);
    const done = choose(afterDiscard, 'nijigasaki-live');
    expect(done.players[0]!.hand.cardIds).toContain('nijigasaki-live');
    expect(done.activeEffect).toBeNull();
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({ step: 'RECOVER_NIJIGASAKI_LIVE', discardedCardIds: ['hand-member'], recoveredCardIds: ['nijigasaki-live'] });
    expect(done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(1);
    expect(done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)).toHaveLength(1);
  });

  it('刚弃置的虹咲LIVE可立即选回', () => {
    const started = activate(setup('R', ['hand-nijigasaki-live'], []));
    const recovery = choose(started, 'hand-nijigasaki-live');
    expect(recovery.activeEffect?.selectableCardIds).toEqual(['hand-nijigasaki-live']);
    const done = choose(recovery, 'hand-nijigasaki-live');
    expect(done.players[0]!.hand.cardIds).toEqual(['hand-nijigasaki-live']);
  });

  it('支付后无合法目标时保留两项费用并正常结束', () => {
    const done = choose(activate(setup('R', ['hand-member'], ['other-live'])), 'hand-member');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0]!.waitingRoom.cardIds).toEqual(['other-live', 'hand-member']);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({ step: 'PAID_COST_NO_TARGET', recoveredCardIds: [] });
    expect(activateCardAbility(done, P1, 'source', ABILITY_ID)).toBe(done);
  });

  it('非法与 stale 弃手/回收选择保持原窗口', () => {
    const discard = activate(setup());
    expect(choose(discard, 'other-live')).toBe(discard);
    const staleDiscard = updatePlayer(discard, P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: [] } }));
    expect(choose(staleDiscard, 'hand-member')).toBe(staleDiscard);
    const recovery = choose(discard, 'hand-member');
    expect(choose(recovery, 'other-live')).toBe(recovery);
    const staleRecovery = updatePlayer(recovery, P1, (p) => ({ ...p, waitingRoom: { ...p.waitingRoom, cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'nijigasaki-live') } }));
    expect(choose(staleRecovery, 'nijigasaki-live')).toBe(staleRecovery);
  });

  it('费用支付后来源离场不取消回收', () => {
    const recovery = choose(activate(setup()), 'hand-member');
    const sourceLeft = updatePlayer(recovery, P1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER) }));
    const done = choose(sourceLeft, 'nijigasaki-live');
    expect(done.players[0]!.hand.cardIds).toContain('nijigasaki-live');
  });

  it('只在自己主要阶段、当前玩家、来源ACTIVE且有手牌时发动', () => {
    const base = setup();
    expect(activate({ ...base, currentPhase: GamePhase.LIVE_PHASE })).toEqual({ ...base, currentPhase: GamePhase.LIVE_PHASE });
    expect(activate({ ...base, activePlayerIndex: 1 })).toEqual({ ...base, activePlayerIndex: 1 });
    const waiting = updatePlayer(base, P1, (p) => ({ ...p, memberSlots: { ...p.memberSlots, cardStates: new Map([['source', { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }]]) } }));
    expect(activate(waiting)).toBe(waiting);
    const noHand = updatePlayer(base, P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: [] } }));
    expect(activate(noHand)).toBe(noHand);
  });

  it('弃手触发在回收窗口后按 continuation 结算，不抢占 activeEffect', () => {
    const provingSource = member('PL!HS-pb1-003-P＋', 'waiting-room-proving-source');
    let game = registerCards(setup(), [provingSource]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        provingSource.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));

    const discardWindow = activate(game);
    const recoveryWindow = choose(discardWindow, 'hand-member');
    expect(recoveryWindow.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      selectableCardIds: ['nijigasaki-live'],
    });
    const downstreamPending = recoveryWindow.pendingAbilities.find(
      (ability) =>
        ability.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
    );
    expect(downstreamPending).toMatchObject({
      sourceCardId: provingSource.instanceId,
      timingId: TriggerCondition.ON_ENTER_WAITING_ROOM,
    });
    expect(
      recoveryWindow.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(
      recoveryWindow.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId ===
          HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(false);

    const finished = choose(recoveryWindow, 'nijigasaki-live');
    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).not.toContainEqual(
      expect.objectContaining({
        abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
      })
    );
    const karinResolveIndex = finished.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === ABILITY_ID &&
        action.payload.step === 'RECOVER_NIJIGASAKI_LIVE'
    );
    const downstreamResolveIndex = finished.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
        action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
    );
    expect(karinResolveIndex).toBeGreaterThanOrEqual(0);
    expect(downstreamResolveIndex).toBeGreaterThan(karinResolveIndex);
    expect(
      finished.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId ===
          HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toHaveLength(2);
  });
});
