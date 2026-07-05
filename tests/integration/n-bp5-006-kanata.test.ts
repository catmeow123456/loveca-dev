import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const LIVE_ID = 'n-bp5-006-live';

function createKanata(): MemberCardData {
  return {
    cardCode: 'PL!N-bp5-006-R',
    name: '近江彼方',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createOtherMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLive(): LiveCardData {
  return {
    cardCode: 'N-BP5-006-LIVE',
    name: 'N-BP5-006 Live',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupKanataLiveSuccess(options: {
  readonly removeSource?: boolean;
  readonly includeOtherMember?: boolean;
  readonly sourceOrientation?: OrientationState;
  readonly secondPending?: boolean;
}): GameState {
  const source = createCardInstance(createKanata(), PLAYER1, 'n-bp5-006-source');
  const secondSource = createCardInstance(createKanata(), PLAYER1, 'n-bp5-006-source-2');
  const other = createCardInstance(createOtherMember('OTHER-MEMBER'), PLAYER1, 'other-member');
  const live = createCardInstance(createLive(), PLAYER1, LIVE_ID);
  let game = createGameState('n-bp5-006-kanata', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, secondSource, other, live]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.secondPending) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    } else if (options.includeOtherMember !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, other.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (options.removeSource) {
      memberSlots = removeCardFromSlot(memberSlots, SlotPosition.CENTER);
    }
    return {
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [live.instanceId],
      },
      memberSlots,
    };
  });

  return {
    ...game,
    pendingAbilities: [
      {
        id: 'n-bp5-006-live-success',
        abilityId: N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ['live-success'],
        sourceSlot: SlotPosition.CENTER,
      },
      ...(options.secondPending
        ? [
            {
              id: 'n-bp5-006-live-success-2',
              abilityId: N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID,
              sourceCardId: secondSource.instanceId,
              controllerId: PLAYER1,
              mandatory: true,
              timingId: TriggerCondition.ON_LIVE_SUCCESS,
              eventIds: ['live-success-2'],
              sourceSlot: SlotPosition.RIGHT,
            },
          ]
        : []),
    ],
  };
}

function withSuccessfulLiveResult(game: GameState): GameState {
  return updateLiveResolution({ ...game, pendingAbilities: [] }, (liveResolution) => {
    const liveResults = new Map(liveResolution.liveResults);
    const playerScores = new Map(liveResolution.playerScores);
    liveResults.set(LIVE_ID, true);
    playerScores.set(PLAYER1, 1);
    return {
      ...liveResolution,
      performingPlayerId: PLAYER1,
      liveResults,
      playerScores,
    };
  });
}

function sourceOrientation(game: GameState, cardId = 'n-bp5-006-source'): OrientationState | undefined {
  return game.players[0].memberSlots.cardStates.get(cardId)?.orientation;
}

function memberStateChangedEventsFor(game: GameState, cardId: string) {
  return game.eventLog.filter(
    (entry) =>
      entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
      entry.event.cardInstanceId === cardId
  );
}

describe('PL!N-bp5-006 Kanata live-success workflow', () => {
  it('queues from the real LIVE_SUCCESS timing path and waits the source after confirmation', () => {
    const checkResult = new GameService().executeCheckTiming(
      withSuccessfulLiveResult(setupKanataLiveSuccess({ includeOtherMember: true })),
      [TriggerCondition.ON_LIVE_SUCCESS]
    );
    expect(checkResult.success, checkResult.error).toBe(true);
    const confirmation = checkResult.gameState;

    expect(confirmation.activeEffect).toMatchObject({
      abilityId: N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID,
      sourceCardId: 'n-bp5-006-source',
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(confirmation.activeEffect?.effectText).toContain('自己的舞台有1名其他成员');
    expect(sourceOrientation(confirmation)).toBe(OrientationState.ACTIVE);

    const result = confirmIfConfirmOnly(confirmation, PLAYER1);

    expect(sourceOrientation(result)).toBe(OrientationState.WAITING);
    expect(memberStateChangedEventsFor(result, 'n-bp5-006-source')).toHaveLength(1);
  });

  it('opens single pending confirm-only and waits the source only after confirmation', () => {
    const confirmation = resolvePendingCardEffects(
      setupKanataLiveSuccess({ includeOtherMember: true })
    ).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain('【LIVE成功时】');
    expect(confirmation.activeEffect?.effectText).toContain('自己的舞台有1名其他成员');
    expect(confirmation.activeEffect?.effectText).toContain('将此成员变为待机状态');
    expect(confirmation.activeEffect?.effectText).not.toContain('确认后');
    expect(confirmation.activeEffect?.stepText).toBe(
      '自己的舞台有1名其他成员；此成员当前为活跃状态。将此成员变为待机状态。'
    );
    expect(sourceOrientation(confirmation)).toBe(OrientationState.ACTIVE);

    const result = confirmIfConfirmOnly(confirmation, PLAYER1);

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(sourceOrientation(result)).toBe(OrientationState.WAITING);
    expect(memberStateChangedEventsFor(result, 'n-bp5-006-source')).toHaveLength(1);
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID
      )?.payload
    ).toMatchObject({
      step: 'WAIT_SELF_BY_OTHER_STAGE_MEMBER',
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      otherStageMemberCount: 1,
    });
  });

  it('consumes pending as no-op when there is no other stage member or the source left stage', () => {
    for (const options of [
      { includeOtherMember: false },
      { includeOtherMember: true, removeSource: true },
    ] as const) {
      const result = confirmIfConfirmOnly(
        resolvePendingCardEffects(setupKanataLiveSuccess(options)).gameState,
        PLAYER1
      );
      const resolveAction = result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID
      );

      expect(result.pendingAbilities).toEqual([]);
      expect(resolveAction?.payload.step).not.toBe('WAIT_SELF_BY_OTHER_STAGE_MEMBER');
      expect(memberStateChangedEventsFor(result, 'n-bp5-006-source')).toHaveLength(0);
    }
  });

  it('resolves multiple pending abilities in order without opening confirm-only prompts', () => {
    const orderSelection = resolvePendingCardEffects(
      setupKanataLiveSuccess({ secondPending: true })
    ).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');

    const result = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(sourceOrientation(result, 'n-bp5-006-source')).toBe(OrientationState.WAITING);
    expect(sourceOrientation(result, 'n-bp5-006-source-2')).toBe(OrientationState.WAITING);
    expect(
      result.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID &&
          action.payload.step === 'WAIT_SELF_BY_OTHER_STAGE_MEMBER'
      )
    ).toHaveLength(2);
  });

  it('shows a confirm-only bridge before resolving a manually selected pending ability', () => {
    const orderSelection = resolvePendingCardEffects(
      setupKanataLiveSuccess({ secondPending: true })
    ).gameState;

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      'n-bp5-006-source'
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID,
      sourceCardId: 'n-bp5-006-source',
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(sourceOrientation(preview, 'n-bp5-006-source')).toBe(OrientationState.ACTIVE);

    const afterFirst = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(afterFirst.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(afterFirst.activeEffect?.sourceCardId).toBe('n-bp5-006-source-2');
  });

  it('does not create a fake member-state changed event when the source is already waiting', () => {
    const result = confirmIfConfirmOnly(
      resolvePendingCardEffects(
        setupKanataLiveSuccess({
          includeOtherMember: true,
          sourceOrientation: OrientationState.WAITING,
        })
      ).gameState,
      PLAYER1
    );

    expect(result.pendingAbilities).toEqual([]);
    expect(sourceOrientation(result)).toBe(OrientationState.WAITING);
    expect(memberStateChangedEventsFor(result, 'n-bp5-006-source')).toHaveLength(0);
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_006_LIVE_SUCCESS_OTHER_STAGE_MEMBER_WAIT_SELF_ABILITY_ID
      )?.payload.step
    ).toBe('SOURCE_ALREADY_WAITING');
  });
});
