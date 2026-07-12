import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID,
  PL_BP3_008_LIVE_START_OPTIONAL_WAIT_MUSE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { activateCardAbility, confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(code: string, id: string, groupNames: readonly string[] = ["μ's"]): CardInstance<MemberCardData> {
  return createCardInstance({ cardCode: code, name: code, groupNames, cardType: CardType.MEMBER, cost: 15, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] }, PLAYER1, id);
}

function live(code: string, id: string, groupNames: readonly string[] = ["μ's"]): CardInstance<LiveCardData> {
  return createCardInstance({ cardCode: code, name: code, groupNames, cardType: CardType.LIVE, score: 5, requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }) }, PLAYER1, id);
}

function setup(options: { readonly rarity?: 'R＋' | 'P' | 'P＋' | 'SEC'; readonly recovery?: boolean; readonly activeMuse?: boolean; readonly activeSource?: boolean } = {}) {
  const source = member(`PL!-bp3-008-${options.rarity ?? 'R＋'}`, 'hanayo');
  const museTarget = member('PL!-test-muse-member', 'muse-target');
  const nonMuseTarget = member('PL!-test-non-muse-member', 'non-muse-target', ['Aqours']);
  const museLive = live('PL!-test-muse-live', 'muse-live');
  const nonMuseLive = live('PL!-test-non-muse-live', 'non-muse-live', ['Aqours']);
  let game = createGameState('pl-bp3-008-hanayo', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, museTarget, nonMuseTarget, museLive, nonMuseLive]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: options.activeSource === false ? OrientationState.WAITING : OrientationState.ACTIVE, face: FaceState.FACE_UP }),
      SlotPosition.LEFT,
      museTarget.instanceId,
      { orientation: options.activeMuse === false ? OrientationState.WAITING : OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
    waitingRoom: { ...player.waitingRoom, cardIds: options.recovery === false ? [nonMuseLive.instanceId] : [museLive.instanceId, nonMuseLive.instanceId] },
  }));
  return { game: { ...game, currentPhase: GamePhase.MAIN_PHASE }, source, museTarget, nonMuseTarget, museLive, nonMuseLive };
}

function queuedLiveStart(sourceCardId: string): PendingAbilityState {
  return { id: 'hanayo-live-start', abilityId: PL_BP3_008_LIVE_START_OPTIONAL_WAIT_MUSE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID, sourceCardId, controllerId: PLAYER1, mandatory: true, timingId: TriggerCondition.ON_LIVE_START, eventIds: ['live-start'] };
}

function player(game: ReturnType<typeof setup>['game']) {
  return game.players.find((candidate) => candidate.id === PLAYER1)!;
}

function yellowHeartCount(game: ReturnType<typeof setup>['game'], memberId: string): number {
  return getMemberEffectiveHeartIcons(game, PLAYER1, memberId).filter((heart) => heart.color === HeartColor.YELLOW).reduce((total, heart) => total + heart.count, 0);
}

describe('PL!-bp3-008 小泉花陽 activated recovery and optional LIVE-start Heart', () => {
  it.each(['R＋', 'P', 'P＋', 'SEC'] as const)('recovers exactly one μ\'s LIVE after the activated WAIT cost for %s', (rarity) => {
    const scenario = setup({ rarity });
    const paid = activateCardAbility(scenario.game, PLAYER1, scenario.source.instanceId, PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID);
    expect(player(paid).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(paid.activeEffect?.selectableCardIds).toEqual([scenario.museLive.instanceId]);
    expect(paid.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(true);

    const resolved = confirmActiveEffectStepThroughPublicReveal(paid, PLAYER1, paid.activeEffect!.id, scenario.museLive.instanceId);
    expect(player(resolved).hand.cardIds).toContain(scenario.museLive.instanceId);
    expect(player(resolved).waitingRoom.cardIds).toContain(scenario.nonMuseLive.instanceId);
    expect(resolved.activeEffect).toBeNull();
  });

  it('keeps the paid cost and records turn use when no recovery target exists, then rejects a repeat activation', () => {
    const scenario = setup({ recovery: false });
    const paid = activateCardAbility(scenario.game, PLAYER1, scenario.source.instanceId, PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID);
    expect(paid.activeEffect).toBeNull();
    expect(player(paid).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(OrientationState.WAITING);
    const repeated = activateCardAbility(paid, PLAYER1, scenario.source.instanceId, PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID);
    expect(repeated).toBe(paid);
  });

  it('rejects invalid recovery selection without rolling back the paid WAIT cost', () => {
    const scenario = setup();
    const paid = activateCardAbility(scenario.game, PLAYER1, scenario.source.instanceId, PL_BP3_008_ACTIVATED_WAIT_SELF_RECOVER_MUSE_LIVE_ABILITY_ID);
    const invalid = confirmActiveEffectStepThroughPublicReveal(paid, PLAYER1, paid.activeEffect!.id, scenario.nonMuseLive.instanceId);
    expect(invalid).toBe(paid);
    expect(player(invalid).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(OrientationState.WAITING);
  });

  it('offers a real optional μ\'s ACTIVE-member selection and grants source-member yellow Heart after payment', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects({ ...scenario.game, pendingAbilities: [queuedLiveStart(scenario.source.instanceId)] }).gameState;
    expect(started.activeEffect).toMatchObject({ selectableCardIds: [scenario.museTarget.instanceId, scenario.source.instanceId], canSkipSelection: true, skipSelectionLabel: '不发动' });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    const resolved = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id, scenario.museTarget.instanceId);
    expect(player(resolved).memberSlots.cardStates.get(scenario.museTarget.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(yellowHeartCount(resolved, scenario.source.instanceId)).toBe(2);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('allows decline, handles no legal ACTIVE μ\'s target, and rejects stale target selection without a state event', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects({ ...scenario.game, pendingAbilities: [queuedLiveStart(scenario.source.instanceId)] }).gameState;
    const declined = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id);
    expect(player(declined).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(OrientationState.ACTIVE);
    expect(yellowHeartCount(declined, scenario.source.instanceId)).toBe(0);

    const none = setup({ activeMuse: false, activeSource: false });
    const noTarget = resolvePendingCardEffects({ ...none.game, pendingAbilities: [queuedLiveStart(none.source.instanceId)] }).gameState;
    expect(noTarget.activeEffect).toBeNull();

    const stale = updatePlayer(started, PLAYER1, (current) => ({
      ...current,
      memberSlots: removeCardFromSlot(current.memberSlots, SlotPosition.LEFT),
    }));
    const staleAttempt = confirmActiveEffectStepThroughPublicReveal(stale, PLAYER1, stale.activeEffect!.id, scenario.museTarget.instanceId);
    expect(staleAttempt).toBe(stale);
    expect(yellowHeartCount(staleAttempt, scenario.source.instanceId)).toBe(0);
  });

  it('keeps the selected μ\'s WAIT payment when the source left before resolution, without granting Heart', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects({ ...scenario.game, pendingAbilities: [queuedLiveStart(scenario.source.instanceId)] }).gameState;
    const sourceLeft = updatePlayer(started, PLAYER1, (current) => ({
      ...current,
      memberSlots: removeCardFromSlot(current.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = confirmActiveEffectStepThroughPublicReveal(sourceLeft, PLAYER1, sourceLeft.activeEffect!.id, scenario.museTarget.instanceId);
    expect(player(resolved).memberSlots.cardStates.get(scenario.museTarget.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(yellowHeartCount(resolved, scenario.source.instanceId)).toBe(0);
  });

  it('supports manual selection among multiple pending abilities, decline continuation, and exactly one WAIT event', () => {
    const scenario = setup();
    const secondSource = member('PL!-bp3-008-P', 'hanayo-second');
    let game = registerCards(scenario.game, [secondSource]);
    game = updatePlayer(game, PLAYER1, (current) => ({
      ...current,
      memberSlots: placeCardInSlot(current.memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        queuedLiveStart(scenario.source.instanceId),
        { ...queuedLiveStart(secondSource.instanceId), id: 'hanayo-second-live-start' },
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const manualSecond = confirmActiveEffectStepThroughPublicReveal(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      secondSource.instanceId
    );
    expect(manualSecond.activeEffect?.sourceCardId).toBe(secondSource.instanceId);
    const afterDecline = confirmActiveEffectStepThroughPublicReveal(
      manualSecond,
      PLAYER1,
      manualSecond.activeEffect!.id
    );
    expect(afterDecline.activeEffect?.sourceCardId).toBe(scenario.source.instanceId);
    const resolved = confirmActiveEffectStepThroughPublicReveal(
      afterDecline,
      PLAYER1,
      afterDecline.activeEffect!.id,
      scenario.source.instanceId
    );
    const stateEvents = resolved.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    );
    expect(stateEvents).toHaveLength(1);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('keeps each real selection window when ordered resolution continues multiple pending abilities', () => {
    const scenario = setup();
    const secondSource = member('PL!-bp3-008-P', 'hanayo-second');
    let game = registerCards(scenario.game, [secondSource]);
    game = updatePlayer(game, PLAYER1, (current) => ({
      ...current,
      memberSlots: placeCardInSlot(current.memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        queuedLiveStart(scenario.source.instanceId),
        { ...queuedLiveStart(secondSource.instanceId), id: 'hanayo-second-live-start' },
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    const firstSelection = confirmActiveEffectStepThroughPublicReveal(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(firstSelection.activeEffect?.sourceCardId).toBe(scenario.source.instanceId);
    const secondSelection = confirmActiveEffectStepThroughPublicReveal(
      firstSelection,
      PLAYER1,
      firstSelection.activeEffect!.id,
      scenario.source.instanceId
    );
    expect(secondSelection.activeEffect?.sourceCardId).toBe(secondSource.instanceId);
    const resolved = confirmActiveEffectStepThroughPublicReveal(
      secondSelection,
      PLAYER1,
      secondSelection.activeEffect!.id,
      secondSource.instanceId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
    ).toHaveLength(2);
  });
});
