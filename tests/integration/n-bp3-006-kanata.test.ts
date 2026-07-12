import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState, type PendingAbilityState } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  PL_N_BP3_006_ON_ENTER_WAIT_SELF_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1', P2 = 'p2';
const member = (code: string): MemberCardData => ({ cardCode: code, name: code, cardType: CardType.MEMBER, cost: 9, blade: 2, hearts: [createHeartIcon(HeartColor.YELLOW, 1)] });
function setup(rarity: 'R' | 'P' = 'R', orientation = OrientationState.ACTIVE): GameState {
  const source = createCardInstance(member(`PL!N-bp3-006-${rarity}`), P1, 'source');
  const below = createCardInstance(member('PL!N-test-below'), P1, 'below');
  let game = registerCards(createGameState('n-bp3-006', P1, 'P1', P2, 'P2'), [source, below]);
  game = updatePlayer(game, P1, (p) => {
    const slots = placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source', { orientation, face: FaceState.FACE_UP });
    return { ...p, memberSlots: { ...slots, memberBelow: new Map([[SlotPosition.CENTER, ['below']]]) } };
  });
  return { ...game, pendingAbilities: [pending()] };
}
function pending(id = 'pending'): PendingAbilityState {
  return { id, abilityId: PL_N_BP3_006_ON_ENTER_WAIT_SELF_ABILITY_ID, sourceCardId: 'source', controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['enter'], sourceSlot: SlotPosition.CENTER };
}

describe('PL!N-bp3-006 近江彼方', () => {
  it.each(['R', 'P'] as const)('R/P共用登场强制待机 workflow：%s', (rarity) => {
    const done = resolvePendingCardEffects(setup(rarity)).gameState;
    expect(done.players[0]!.memberSlots.cardStates.get('source')?.orientation).toBe(OrientationState.WAITING);
    expect(done.players[0]!.memberSlots.memberBelow.get(SlotPosition.CENTER)).toEqual(['below']);
    const events = done.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toMatchObject({
      cardInstanceId: 'source',
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: 'source',
        abilityId: PL_N_BP3_006_ON_ENTER_WAIT_SELF_ABILITY_ID,
        pendingAbilityId: 'pending',
      },
    });
    expect(done.pendingAbilities).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({ step: 'WAIT_SELF', memberStateChangedEventIds: [events[0]!.event.eventId] });
  });

  it('来源已待机时不重复写状态事件但正常消费 pending', () => {
    const done = resolvePendingCardEffects(setup('R', OrientationState.WAITING)).gameState;
    expect(done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(0);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({ step: 'SOURCE_ALREADY_WAITING', memberStateChangedEventIds: [] });
  });

  it('结算前离开舞台时安全 no-op 并继续', () => {
    const left = updatePlayer(setup(), P1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER) }));
    const done = resolvePendingCardEffects(left).gameState;
    expect(done.pendingAbilities).toEqual([]);
    expect(done.eventLog.filter((e) => e.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(0);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({ step: 'SOURCE_NOT_ON_OWN_STAGE' });
  });

  it('真实状态变化 proving ability 在006消费后按 continuation 开始并完成', () => {
    const provingSource = createCardInstance(member('PL!N-bp4-018-N'), P1, 'proving-source');
    const drawn = createCardInstance(member('PL!N-test-drawn'), P1, 'drawn');
    let game = registerCards(createGameState('n-bp3-006-continuation', P1, 'P1', P2, 'P2'), [
      provingSource,
      drawn,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, provingSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      mainDeck: { ...player.mainDeck, cardIds: [drawn.instanceId] },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      pendingAbilities: [{ ...pending('006-pending'), sourceCardId: provingSource.instanceId }],
    };

    const continued = resolvePendingCardEffects(
      addCheckTimingRuleSentinel(game, P1, 'n-bp3-006-continuation')
    ).gameState;
    expect(continued.pendingAbilities.some((ability) => ability.id === '006-pending')).toBe(false);
    expect(
      continued.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID
      )
    ).toBe(true);
    expect(continued.activeEffect).toMatchObject({
      abilityId: N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
      sourceCardId: provingSource.instanceId,
      selectableCardIds: [drawn.instanceId],
    });
    expect(continued.players[0]!.hand.cardIds).toEqual([drawn.instanceId]);

    const finished = confirmActiveEffectStep(
      continued,
      P1,
      continued.activeEffect!.id,
      drawn.instanceId
    );
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0]!.waitingRoom.cardIds).toContain(drawn.instanceId);
    expect(
      finished.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD'
      )
    ).toBe(true);
  });
});
