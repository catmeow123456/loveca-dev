import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function setup(options: { readonly includeSideMembers: boolean }): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly centerId: string;
  readonly rightId: string | null;
} {
  const source = createCardInstance(member('PL!S-bp7-018-N', '黑泽露比'), P1, 'ruby');
  const center = createCardInstance(member('PL!S-test-center', 'Center'), P1, 'center');
  const right = options.includeSideMembers
    ? createCardInstance(member('PL!S-test-right', 'Right'), P1, 'right')
    : null;
  let game = registerCards(createGameState('s-bp7-018-ruby', P1, 'P1', P2, 'P2'), [
    source,
    center,
    ...(right ? [right] : []),
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      options.includeSideMembers ? SlotPosition.LEFT : SlotPosition.CENTER,
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    if (options.includeSideMembers) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, center.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, right!.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
  const pending: PendingAbilityState = {
    id: 's-bp7-018-pending',
    abilityId: S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID,
    sourceCardId: source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: options.includeSideMembers ? SlotPosition.LEFT : SlotPosition.CENTER,
    eventIds: ['enter-event'],
  };
  return {
    game: { ...game, pendingAbilities: [pending] },
    sourceId: source.instanceId,
    centerId: options.includeSideMembers ? center.instanceId : source.instanceId,
    rightId: right?.instanceId ?? null,
  };
}

describe('PL!S-bp7-018 黑泽露比', () => {
  it('selects only LEFT/RIGHT members and swaps the chosen member into CENTER with events', () => {
    const scenario = setup({ includeSideMembers: true });
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID,
      effectText: '【登场】将存在于自己的舞台的1名成员站位变换到中央区域。',
      selectableCardIds: [scenario.sourceId, scenario.rightId],
      selectionLabel: '选择要移动到中央区域的成员',
      confirmSelectionLabel: '站位变换',
      canSkipSelection: false,
    });
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.centerId);

    const resolved = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      scenario.rightId
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: scenario.sourceId,
      [SlotPosition.CENTER]: scenario.rightId,
      [SlotPosition.RIGHT]: scenario.centerId,
    });
    const moveEvents = resolved.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED);
    expect(moveEvents).toHaveLength(2);
    expect(moveEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardInstanceId: scenario.rightId,
          fromSlot: SlotPosition.RIGHT,
          toSlot: SlotPosition.CENTER,
        }),
        expect.objectContaining({
          cardInstanceId: scenario.centerId,
          fromSlot: SlotPosition.CENTER,
          toSlot: SlotPosition.RIGHT,
        }),
      ])
    );
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID,
      step: 'MOVE_STAGE_MEMBER_TO_CENTER',
      targetMemberCardId: scenario.rightId,
      fromSlot: SlotPosition.RIGHT,
      toSlot: SlotPosition.CENTER,
      swappedCardId: scenario.centerId,
    });
  });

  it('safely consumes the pending ability when only the CENTER member exists', () => {
    const scenario = setup({ includeSideMembers: false });
    const resolved = resolvePendingCardEffects(scenario.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NO_SIDE_STAGE_MEMBER_TO_MOVE_TO_CENTER',
      selectableCardIds: [],
    });
  });
});
