import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_026_LIVE_START_DISCARD_UP_TO_TWO_TARGET_NIJIGASAKI_GAIN_BLADE_ABILITY_ID,
  N_BP7_026_LIVE_SUCCESS_TWO_NO_BLADE_HEART_MEMBERS_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { registerNBp7026JustBelieveWorkflowHandlers } from '../../src/application/card-effects/workflows/cards/n-bp7-026-just-believe';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type BladeHearts,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const LIVE_START_ABILITY_ID =
  N_BP7_026_LIVE_START_DISCARD_UP_TO_TWO_TARGET_NIJIGASAKI_GAIN_BLADE_ABILITY_ID;
const LIVE_SUCCESS_ABILITY_ID = N_BP7_026_LIVE_SUCCESS_TWO_NO_BLADE_HEART_MEMBERS_SCORE_ABILITY_ID;

registerNBp7026JustBelieveWorkflowHandlers({ enqueueTriggeredCardEffects });

function live(id = 'just-believe') {
  const data: LiveCardData = {
    cardCode: 'PL!N-bp7-026-SECL',
    name: 'Just Believe!!!',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function member(
  id: string,
  options: {
    readonly ownerId?: string;
    readonly groupNames?: readonly string[];
    readonly bladeHearts?: BladeHearts;
  } = {}
) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHearts ?? [],
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  id = `${abilityId}:pending`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId:
      abilityId === LIVE_START_ABILITY_ID
        ? TriggerCondition.ON_LIVE_START
        : TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [],
  };
}

function setupLiveStart(options: {
  readonly handCount: number;
  readonly targetCount: number;
  readonly includeNonNijigasakiTarget?: boolean;
}) {
  const source = live();
  const handCards = Array.from({ length: options.handCount }, (_, index) =>
    member(`hand-${index}`)
  );
  const targets = Array.from({ length: options.targetCount }, (_, index) =>
    member(`target-${index}`)
  );
  const nonNijigasaki = member('non-nijigasaki', { groupNames: ['Aqours'] });
  let game = registerCards(createGameState('n-bp7-026-live-start', P1, 'P1', P2, 'P2'), [
    source,
    ...handCards,
    ...targets,
    nonNijigasaki,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [index, target] of targets.entries()) {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!;
      memberSlots = placeCardInSlot(memberSlots, slot, target.instanceId, {
        orientation: index % 2 === 0 ? OrientationState.ACTIVE : OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    }
    if (options.includeNonNijigasakiTarget && targets.length < 3) {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][targets.length]!;
      memberSlots = placeCardInSlot(memberSlots, slot, nonNijigasaki.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      memberSlots,
    };
  });
  return {
    game: resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pending(LIVE_START_ABILITY_ID, source.instanceId)],
    }).gameState,
    source,
    handCards,
    targets,
    nonNijigasaki,
  };
}

function submitCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    cardIds.length === 1 ? cardIds[0] : undefined,
    undefined,
    undefined,
    cardIds.length === 0 ? null : undefined,
    cardIds.length <= 1 ? undefined : cardIds
  );
}

function withCheerFacts(
  game: GameState,
  revealedCardIds: readonly string[],
  options: { readonly additional?: boolean } = {}
): GameState {
  const event = createCheerEvent(P1, revealedCardIds, revealedCardIds.length, {
    automated: true,
    additional: options.additional,
  });
  return emitGameEvent(
    {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [
          ...game.liveResolution.firstPlayerCheerCardIds,
          ...revealedCardIds,
        ],
      },
    },
    event
  );
}

function resolveSuccessPending(
  game: GameState,
  sourceCardId: string,
  pendingId: string
): GameState {
  const selecting = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(LIVE_SUCCESS_ABILITY_ID, sourceCardId, pendingId)],
  }).gameState;
  expect(selecting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(selecting, P1, selecting.activeEffect!.id);
}

describe('PL!N-bp7-026-SECL 分数5「Just Believe!!!」', () => {
  it('clamps discard count to payable target count, rejects invalid input, and resolves one target', () => {
    const scenario = setupLiveStart({
      handCount: 2,
      targetCount: 1,
      includeNonNijigasakiTarget: true,
    });
    expect(scenario.game.activeEffect).toMatchObject({
      maxSelectableCards: 1,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectionLabel: '选择要放置入休息室的卡',
      confirmSelectionLabel: '放置入休息室',
    });

    const invalid = submitCards(
      scenario.game,
      scenario.handCards.map((card) => card.instanceId)
    );
    expect(invalid.activeEffect?.stepId).toBe('N_BP7_026_SELECT_UP_TO_TWO_HAND_CARDS');
    expect(invalid.players[0].hand.cardIds).toHaveLength(2);

    const resolved = submitCards(scenario.game, [scenario.handCards[0]!.instanceId]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].waitingRoom.cardIds).toContain(scenario.handCards[0]!.instanceId);
    expect(
      resolved.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          'fromZone' in event &&
          event.fromZone === ZoneType.HAND &&
          'cardInstanceIds' in event &&
          event.cardInstanceIds?.includes(scenario.handCards[0]!.instanceId)
      )
    ).toBe(true);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        playerId: P1,
        sourceCardId: scenario.source.instanceId,
        targetMemberCardId: scenario.targets[0]!.instanceId,
        abilityId: LIVE_START_ABILITY_ID,
        countDelta: 1,
      })
    );
  });

  it('discards two, then requires two distinct current Nijigasaki targets and preserves source/target identity', () => {
    const scenario = setupLiveStart({ handCount: 3, targetCount: 3 });
    const selectedHandIds = scenario.handCards.slice(0, 2).map((card) => card.instanceId);
    const selectingTargets = submitCards(scenario.game, selectedHandIds);
    expect(selectingTargets.activeEffect).toMatchObject({
      stepId: 'N_BP7_026_SELECT_NIJIGASAKI_BLADE_TARGETS',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: false,
      selectionLabel: '选择获得[ブレード]的成员',
      confirmSelectionLabel: '获得[ブレード]',
    });

    const duplicate = submitCards(selectingTargets, [
      scenario.targets[0]!.instanceId,
      scenario.targets[0]!.instanceId,
    ]);
    expect(duplicate.activeEffect?.stepId).toBe('N_BP7_026_SELECT_NIJIGASAKI_BLADE_TARGETS');

    const selectedTargetIds = scenario.targets.slice(1, 3).map((card) => card.instanceId);
    const resolved = submitCards(selectingTargets, selectedTargetIds);
    const modifiers = resolved.liveResolution.liveModifiers.filter(
      (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === LIVE_START_ABILITY_ID
    );
    expect(modifiers).toHaveLength(2);
    expect(modifiers).toEqual(
      expect.arrayContaining(
        selectedTargetIds.map((targetMemberCardId) =>
          expect.objectContaining({
            sourceCardId: scenario.source.instanceId,
            targetMemberCardId,
            countDelta: 1,
          })
        )
      )
    );
    expect(
      modifiers.some(
        (modifier) =>
          'targetMemberCardId' in modifier &&
          modifier.targetMemberCardId === scenario.targets[0]!.instanceId
      )
    ).toBe(false);
  });

  it('supports declining and consumes no-op when there is no discard-target pair', () => {
    const declineScenario = setupLiveStart({ handCount: 2, targetCount: 2 });
    const declined = submitCards(declineScenario.game, []);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].hand.cardIds).toHaveLength(2);
    expect(declined.liveResolution.liveModifiers).toEqual([]);

    const noHand = setupLiveStart({ handCount: 0, targetCount: 2 });
    expect(noHand.game.activeEffect).toBeNull();
    expect(noHand.game.pendingAbilities).toEqual([]);
    const noTarget = setupLiveStart({ handCount: 2, targetCount: 0 });
    expect(noTarget.game.activeEffect).toBeNull();
    expect(noTarget.game.pendingAbilities).toEqual([]);
  });

  it('counts event-inclusive MEMBER cards with no Blade Heart and keeps SCORE replacement idempotent', () => {
    const source = live('success-source');
    const noHeartA = member('no-heart-a');
    const noHeartB = member('no-heart-b');
    const drawHeart = member('draw-heart', {
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    });
    const liveWithoutBladeHeart = live('cheer-live');
    let game = registerCards(createGameState('n-bp7-026-live-success', P1, 'P1', P2, 'P2'), [
      source,
      noHeartA,
      noHeartB,
      drawHeart,
      liveWithoutBladeHeart,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[P1, 5]]),
      },
    };
    game = withCheerFacts(game, [
      noHeartA.instanceId,
      drawHeart.instanceId,
      liveWithoutBladeHeart.instanceId,
    ]);
    game = withCheerFacts(game, [noHeartB.instanceId], { additional: true });

    const selecting = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pending(LIVE_SUCCESS_ABILITY_ID, source.instanceId, 'success-1')],
    }).gameState;
    expect(selecting.activeEffect?.effectText).toContain('不持有BLADE HEART的成员卡2张');
    expect(selecting.liveResolution.playerScores.get(P1)).toBe(5);
    const first = confirmActiveEffectStep(selecting, P1, selecting.activeEffect!.id);
    expect(first.liveResolution.playerScores.get(P1)).toBe(6);
    expect(
      first.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === LIVE_SUCCESS_ABILITY_ID
      )
    ).toHaveLength(1);

    const repeated = resolveSuccessPending(first, source.instanceId, 'success-2');
    expect(repeated.liveResolution.playerScores.get(P1)).toBe(6);
    expect(
      repeated.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === LIVE_SUCCESS_ABILITY_ID
      )
    ).toHaveLength(1);
  });
});
