import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_024_LIVE_START_TARGET_AQOURS_MEMBER_ORIGINAL_HEART_GREEN_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  addLiveModifier,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
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
const ABILITY = S_BP7_024_LIVE_START_TARGET_AQOURS_MEMBER_ORIGINAL_HEART_GREEN_ABILITY_ID;

function live(cardCode = 'PL!S-bp7-024-L'): LiveCardData {
  return {
    cardCode,
    name: 'ときめき分類学',
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 2 }),
  };
}

function member(
  cardCode: string,
  groupNames: readonly string[],
  hearts: readonly ReturnType<typeof createHeartIcon>[] = [createHeartIcon(HeartColor.PINK, 1)]
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts,
  };
}

function stageState() {
  return { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: `${ABILITY}:pending`,
    abilityId: ABILITY,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
  };
}

function setup(
  options: {
    readonly ownAqoursCount?: number;
    readonly includeOwnNonAqours?: boolean;
    readonly includeOpponentAqours?: boolean;
    readonly includeAqoursBelow?: boolean;
    readonly modifiers?: readonly LiveModifierState[];
  } = {}
) {
  const source = createCardInstance(live(), P1, 'tokimeki-bunruigaku');
  const aqours = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]
    .slice(0, options.ownAqoursCount ?? 1)
    .map((slot, index) => ({
      slot,
      card: createCardInstance(
        member(
          `PL!S-test-aqours-${index}`,
          ['Aqours'],
          index === 0
            ? [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.BLUE, 2)]
            : [createHeartIcon(HeartColor.YELLOW, 1)]
        ),
        P1,
        `aqours-${index}`
      ),
    }));
  const ownNonAqours = options.includeOwnNonAqours
    ? createCardInstance(member('PL!SP-test-liella', ['Liella!']), P1, 'own-non-aqours')
    : null;
  const opponentAqours = options.includeOpponentAqours
    ? createCardInstance(member('PL!S-test-opponent-aqours', ['Aqours']), P2, 'opponent-aqours')
    : null;
  const aqoursBelow = options.includeAqoursBelow
    ? createCardInstance(member('PL!S-test-aqours-below', ['Aqours']), P1, 'aqours-below')
    : null;
  let game = registerCards(createGameState('s-bp7-024', P1, 'P1', P2, 'P2'), [
    source,
    ...aqours.map(({ card }) => card),
    ...(ownNonAqours ? [ownNonAqours] : []),
    ...(opponentAqours ? [opponentAqours] : []),
    ...(aqoursBelow ? [aqoursBelow] : []),
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of aqours) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, stageState());
    }
    if (ownNonAqours) {
      const emptySlot =
        options.includeAqoursBelow && !memberSlots.slots[SlotPosition.CENTER]
          ? SlotPosition.CENTER
          : [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].find(
              (slot) => !memberSlots.slots[slot]
            );
      if (emptySlot) {
        memberSlots = placeCardInSlot(
          memberSlots,
          emptySlot,
          ownNonAqours.instanceId,
          stageState()
        );
      }
    }
    if (aqoursBelow) {
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, aqoursBelow.instanceId);
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId, stageState()),
      memberSlots,
    };
  });
  if (opponentAqours) {
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentAqours.instanceId,
        stageState()
      ),
    }));
  }
  for (const modifier of options.modifiers ?? []) {
    game = addLiveModifier(game, modifier);
  }
  return {
    game: {
      ...game,
      pendingAbilities: [pending(source.instanceId)],
    },
    sourceId: source.instanceId,
    targetIds: aqours.map(({ card }) => card.instanceId),
    ownNonAqoursId: ownNonAqours?.instanceId ?? null,
    opponentAqoursId: opponentAqours?.instanceId ?? null,
    aqoursBelowId: aqoursBelow?.instanceId ?? null,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function choose(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    selectedCardId,
    null,
    false,
    null
  );
}

describe('LIVE start target member original Heart color shared workflow', () => {
  it('keeps the forced public choice for one target and replaces the mixed printed total with Green', () => {
    const scenario = setup();
    const started = start(scenario.game);
    expect(started.activeEffect).toMatchObject({
      abilityId: ABILITY,
      selectableCardIds: scenario.targetIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      canSkipSelection: false,
      stepText: '请选择自己舞台上的1名『Aqours』成员，使其原本持有的HEART全部变为[緑ハート]。',
      selectionLabel: '选择原本HEART变为[緑ハート]的成员',
      confirmSelectionLabel: '将原本HEART变为[緑ハート]',
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();

    const resolved = choose(started, scenario.targetIds[0]!);
    expect(getMemberEffectiveHeartIcons(resolved, P1, scenario.targetIds[0]!)).toEqual([
      createHeartIcon(HeartColor.GREEN, 3),
    ]);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: P1,
      memberCardId: scenario.targetIds[0],
      color: HeartColor.GREEN,
      sourceCardId: scenario.sourceId,
      abilityId: ABILITY,
    });
  });

  it('keeps normal member Heart bonuses appended after replacing only printed original Hearts', () => {
    const first = setup();
    const bonus: LiveModifierState = {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: P1,
      targetMemberCardId: first.targetIds[0],
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      sourceCardId: 'other-source',
      abilityId: 'test:purple-heart-bonus',
    };
    const scenario = setup({ modifiers: [bonus] });
    const resolved = choose(start(scenario.game), scenario.targetIds[0]!);
    expect(getMemberEffectiveHeartIcons(resolved, P1, scenario.targetIds[0]!)).toEqual([
      createHeartIcon(HeartColor.GREEN, 3),
      createHeartIcon(HeartColor.PURPLE, 1),
    ]);
  });

  it('lists only own top-level Aqours members and keeps a forced choice for multiple targets', () => {
    const scenario = setup({
      ownAqoursCount: 2,
      includeOwnNonAqours: true,
      includeOpponentAqours: true,
      includeAqoursBelow: true,
    });
    const started = start(scenario.game);
    expect(started.activeEffect?.selectableCardIds).toEqual(scenario.targetIds);
    expect(started.activeEffect?.selectableCardIds).not.toEqual(
      expect.arrayContaining([
        scenario.ownNonAqoursId,
        scenario.opponentAqoursId,
        scenario.aqoursBelowId,
      ])
    );
    expect(started.activeEffect?.canSkipSelection).toBe(false);
  });

  it('consumes the pending safely when there is no own top-level Aqours target', () => {
    const scenario = setup({
      ownAqoursCount: 0,
      includeOwnNonAqours: true,
      includeOpponentAqours: true,
      includeAqoursBelow: true,
    });
    const resolved = start(scenario.game);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: ABILITY,
      reason: 'NO_AQOURS_STAGE_MEMBER_TARGET',
    });
  });

  it('rejects illegal input and consumes a formerly legal target that became stale on confirmation', () => {
    const scenario = setup({ ownAqoursCount: 2 });
    const started = start(scenario.game);
    const illegal = choose(started, 'not-a-candidate');
    expect(illegal).toBe(started);

    const stale = updatePlayer(started, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, scenario.targetIds[0]!],
      },
    }));
    const resolved = choose(stale, scenario.targetIds[0]!);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: ABILITY,
      step: 'STALE_OR_INVALID_MEMBER_SELECTION',
      selectedCardId: scenario.targetIds[0],
      selectableCardIds: [scenario.targetIds[1]],
    });
  });

  it('consumes the selection without replacement when the source LIVE leaves before confirmation', () => {
    const scenario = setup();
    const started = start(scenario.game);
    const sourceLeft = updatePlayer(started, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.sourceId),
    }));

    const resolved = choose(sourceLeft, scenario.targetIds[0]!);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: ABILITY,
      step: 'SOURCE_LIVE_INVALID',
      selectedCardId: scenario.targetIds[0],
    });
  });

  it('clears the replacement when the target leaves and does not restore it on re-entry', () => {
    const scenario = setup();
    const granted = choose(start(scenario.game), scenario.targetIds[0]!);
    const replacementCleared = enqueueTriggeredCardEffects(
      granted,
      [TriggerCondition.ON_LEAVE_STAGE],
      {
        leaveStageEvents: [
          createLeaveStageEvent(
            scenario.targetIds[0]!,
            SlotPosition.LEFT,
            ZoneType.WAITING_ROOM,
            P1,
            P1,
            'replacement-member'
          ),
        ],
      }
    );
    expect(
      replacementCleared.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT' &&
          modifier.memberCardId === scenario.targetIds[0]
      )
    ).toBe(false);

    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      granted,
      P1,
      scenario.targetIds[0]!,
      enqueueTriggeredCardEffects
    )!;
    expect(
      left.gameState.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT' &&
          modifier.memberCardId === scenario.targetIds[0]
      )
    ).toBe(false);

    const reentered = updatePlayer(left.gameState, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== scenario.targetIds[0]),
      },
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        scenario.targetIds[0]!,
        stageState()
      ),
    }));
    expect(getMemberEffectiveHeartIcons(reentered, P1, scenario.targetIds[0]!)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.BLUE, 2),
    ]);
  });
});
