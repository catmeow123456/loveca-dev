import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import {
  createCardInstance,
  createHeartIcon,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID as A,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
const P1 = 'p1',
  P2 = 'p2';
const member = (code: string, unit = 'lilywhite'): MemberCardData => ({
  cardCode: code,
  name: code,
  cardType: CardType.MEMBER,
  cost: 1,
  blade: 1,
  hearts: [createHeartIcon(HeartColor.PINK, 1)],
  groupNames: ["μ's"],
  unitName: unit,
});
const live = (code: string, group = "μ's"): LiveCardData => ({
  cardCode: code,
  name: code,
  cardType: CardType.LIVE,
  score: 1,
  requiredHearts: [],
  groupNames: [group],
});
function setup(
  success: number,
  hand = 3,
  other = true,
  target = true,
  handLive = true,
  otherUnit = 'lilywhite',
  includeWaitingTrigger = false
) {
  const source = createCardInstance(member('PL!-pb1-007-R'), P1, 'source');
  const ally = createCardInstance(member('ally', otherUnit), P1, 'ally');
  const waitingTriggerSource = createCardInstance(
    member('PL!HS-pb1-003-R', 'みらくらぱーく！'),
    P1,
    'waiting-trigger-source'
  );
  const continuationSource = createCardInstance(
    member('PL!HS-bp5-011'),
    P1,
    'continuation-source'
  );
  const continuationDraw = createCardInstance(member('continuation-draw'), P1, 'continuation-draw');
  const hands = Array.from({ length: hand }, (_, i) =>
    createCardInstance(
      i === 0 && handLive ? live('hand-live') : member(`hand-${i}`),
      P1,
      `hand-${i}`
    )
  );
  const targets = target ? [createCardInstance(live('target'), P1, 'target')] : [];
  const successes = Array.from({ length: success }, (_, i) =>
    createCardInstance(live(`success-${i}`), P1, `success-${i}`)
  );
  let game = registerCards(createGameState('007', P1, 'P1', P2, 'P2'), [
    source,
    ally,
    waitingTriggerSource,
    continuationSource,
    continuationDraw,
    ...hands,
    ...targets,
    ...successes,
  ]);
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE };
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(
      includeWaitingTrigger
        ? placeCardInSlot(
            other
              ? placeCardInSlot(p.memberSlots, SlotPosition.LEFT, ally.instanceId, {
                  orientation: OrientationState.ACTIVE,
                  face: FaceState.FACE_UP,
                })
              : p.memberSlots,
            SlotPosition.RIGHT,
            waitingTriggerSource.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
          )
        : other
          ? placeCardInSlot(p.memberSlots, SlotPosition.LEFT, ally.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            })
          : p.memberSlots,
      SlotPosition.CENTER,
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
    hand: hands.reduce((z, c) => addCardToZone(z, c.instanceId), p.hand),
    waitingRoom: targets.reduce((z, c) => addCardToZone(z, c.instanceId), p.waitingRoom),
    successZone: successes.reduce((z, c) => addCardToZone(z, c.instanceId), p.successZone),
    mainDeck: addCardToZone(p.mainDeck, continuationDraw.instanceId),
  }));
  const continuationPending: PendingAbilityState = {
    id: 'continuation-pending',
    abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
    sourceCardId: continuationSource.instanceId,
    sourceSlot: SlotPosition.RIGHT,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['continuation-event'],
  };
  return {
    game: { ...game, pendingAbilities: [continuationPending] },
    source,
    hands,
    targets,
    continuationDraw,
    continuationSource,
    waitingTriggerSource,
  };
}

function confirmDiscard(
  game: ReturnType<typeof activateCardAbility>,
  selectedCardIds: readonly string[]
) {
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

function expectContinuationResolved(game: ReturnType<typeof activateCardAbility>) {
  const action = game.actionHistory.find(
    (candidate) =>
      candidate.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
      candidate.payload.step === 'ON_ENTER_DRAW_ONE'
  );
  expect(action).toBeDefined();
  expect(game.players[0].hand.cardIds).toContain(action?.payload.drawnCardIds?.[0]);
  expect(game.activeEffect).toBeNull();
}

function abilityUseCount(game: ReturnType<typeof activateCardAbility>) {
  return game.actionHistory.filter(
    (action) => action.payload.abilityId === A && action.payload.step === 'ABILITY_USE'
  ).length;
}
describe('PL!-pb1-007 東條 希', () => {
  it.each([
    [0, 3],
    [1, 2],
    [2, 1],
  ])('uses dynamic discard count for %i success cards', (success, count) => {
    const s = setup(success);
    const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    expect(started.activeEffect?.minSelectableCards).toBe(count);
    expect(started.activeEffect?.maxSelectableCards).toBe(count);
  });
  it.each([3, 4])('uses zero cost for %i or more success cards and records turn use', (success) => {
    const s = setup(success, 0, true, false);
    const done = activateCardAbility(s.game, P1, s.source.instanceId, A);
    expect(done.activeEffect).toBeNull();
    expect(
      done.actionHistory.some((a) => a.payload.abilityId === A && a.payload.step === 'ABILITY_USE')
    ).toBe(true);
    expect(activateCardAbility(done, P1, s.source.instanceId, A)).toBe(done);
  });
  it("blocks insufficient hand, pays exactly, and can recover a just-discarded μ's LIVE", () => {
    const blocked = setup(0, 2);
    expect(activateCardAbility(blocked.game, P1, blocked.source.instanceId, A)).toBe(blocked.game);
    const s = setup(2, 1, true, false);
    const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    const paid = confirmActiveEffectStepThroughPublicReveal(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [s.hands[0].instanceId]
    );
    expect(paid.activeEffect?.selectableCardIds).toEqual([s.hands[0].instanceId]);
    const done = confirmActiveEffectStepThroughPublicReveal(paid, P1, paid.activeEffect!.id, s.hands[0].instanceId);
    expect(done.players[0].hand.cardIds).toContain(s.hands[0].instanceId);
    expect(done.activeEffect).toBeNull();
    expectContinuationResolved(done);
  });
  it('excludes the source itself from lily white and keeps paid cost on no-condition/no-target branches', () => {
    for (const [other, target] of [
      [false, true],
      [true, false],
    ] as const) {
      const s = setup(2, 1, other, target, target);
      const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
      const done = confirmActiveEffectStepThroughPublicReveal(
        started,
        P1,
        started.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [s.hands[0].instanceId]
      );
      expect(done.players[0].hand.cardIds).not.toContain(s.hands[0].instanceId);
      expect(done.activeEffect).toBeNull();
      expect(
        done.actionHistory.some(
          (a) => a.payload.abilityId === A && a.payload.step === 'ABILITY_USE'
        )
      ).toBe(true);
      expectContinuationResolved(done);
    }
  });

  it('records the hand-to-waiting-room event and enqueues the matching waiting-room trigger', () => {
    const s = setup(2, 1, true, true, false, 'lilywhite', true);
    const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    const paid = confirmDiscard(started, [s.hands[0].instanceId]);
    const event = paid.eventLog
      .map((entry) => entry.event)
      .find(
        (candidate) =>
          candidate.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          candidate.fromZone === ZoneType.HAND &&
          candidate.cardInstanceIds.includes(s.hands[0].instanceId)
      );
    expect(event).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      fromZone: ZoneType.HAND,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: P1,
      controllerId: P1,
      cardInstanceIds: [s.hands[0].instanceId],
    });
    expect(
      paid.pendingAbilities.some(
        (pending) =>
          pending.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          pending.sourceCardId === s.waitingTriggerSource.instanceId &&
          pending.eventIds?.includes(event!.eventId)
      )
    ).toBe(true);
  });

  it('consumes an originally legal recovery target that becomes stale without refunding cost or turn use', () => {
    const s = setup(2, 1, true, true, false);
    const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    const paid = confirmDiscard(started, [s.hands[0].instanceId]);
    const targetId = s.targets[0].instanceId;
    expect(paid.activeEffect?.selectableCardIds).toContain(targetId);
    const staleState = updatePlayer(paid, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== targetId),
      },
    }));
    const done = confirmActiveEffectStepThroughPublicReveal(staleState, P1, paid.activeEffect!.id, targetId);
    expect(done.players[0].hand.cardIds).not.toContain(targetId);
    expect(done.players[0].hand.cardIds).not.toContain(s.hands[0].instanceId);
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === A &&
          action.payload.discardedHandCardIds?.includes(s.hands[0].instanceId)
      )
    ).toBe(true);
    expect(abilityUseCount(done)).toBe(1);
    expect(
      done.actionHistory.filter(
        (action) => action.payload.abilityId === A && action.payload.step === 'STALE_TARGET'
      )
    ).toHaveLength(1);
    expectContinuationResolved(done);
  });

  it('rejects an ID never offered by the recovery window without consuming or duplicating turn use', () => {
    const s = setup(2, 1, true, true, false);
    const started = activateCardAbility(s.game, P1, s.source.instanceId, A);
    const paid = confirmDiscard(started, [s.hands[0].instanceId]);
    const illegal = confirmActiveEffectStepThroughPublicReveal(paid, P1, paid.activeEffect!.id, 'never-selectable');
    expect(illegal).toBe(paid);
    expect(illegal.activeEffect).toBe(paid.activeEffect);
    expect(abilityUseCount(illegal)).toBe(1);
  });

  it('opens and completes recovery at zero cost when a legal target exists', () => {
    const s = setup(3, 0, true, true);
    const gameWithContinuationSource = updatePlayer(s.game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        s.continuationSource.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const started = activateCardAbility(
      addCheckTimingRuleSentinel(
        { ...gameWithContinuationSource, pendingAbilities: [] },
        P1,
        'pl-pb1-007-zero-cost'
      ),
      P1,
      s.source.instanceId,
      A
    );
    expect(started.activeEffect?.selectableCardIds).toEqual([s.targets[0].instanceId]);
    let done = confirmActiveEffectStepThroughPublicReveal(
      started,
      P1,
      started.activeEffect!.id,
      s.targets[0].instanceId
    );
    if (done.activeEffect?.abilityId === 'system:select-pending-card-effect') {
      const continuation = done.pendingAbilities.find(
        (ability) => ability.id === 'continuation-pending'
      );
      expect(continuation).toBeTruthy();
      done = confirmActiveEffectStep(
        done,
        P1,
        done.activeEffect.id,
        null,
        null,
        false,
        continuation!.id
      );
    }
    expect(done.players[0].hand.cardIds).toContain(s.targets[0].instanceId);
    expect(abilityUseCount(done)).toBe(1);
    expect(done.activeEffect).toBeNull();
  });

  it('requires another lily white member and filters non-Muse LIVE and member recovery targets', () => {
    const nonLily = setup(2, 1, true, true, false, 'BiBi');
    const noCondition = confirmDiscard(
      activateCardAbility(nonLily.game, P1, nonLily.source.instanceId, A),
      [nonLily.hands[0].instanceId]
    );
    expect(noCondition.activeEffect).toBeNull();
    expectContinuationResolved(noCondition);

    const s = setup(2, 1, true, false, false);
    const wrongLive = createCardInstance(live('aqours-live', 'Aqours'), P1, 'aqours-live');
    const wrongMember = createCardInstance(member('muse-member'), P1, 'muse-member');
    let game = registerCards(s.game, [wrongLive, wrongMember]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(
        addCardToZone(player.waitingRoom, wrongLive.instanceId),
        wrongMember.instanceId
      ),
    }));
    const done = confirmDiscard(activateCardAbility(game, P1, s.source.instanceId, A), [
      s.hands[0].instanceId,
    ]);
    expect(done.activeEffect).toBeNull();
    expectContinuationResolved(done);
  });
});
