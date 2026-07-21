import { describe, expect, it } from 'vitest';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_BP7_001_AUTO_RELAY_STACK_SELF_BELOW_REPLACEMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
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

function member(code: string, id: string, groups: readonly string[] = ['Liella!']) {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      groupNames: groups,
      cardType: CardType.MEMBER,
      cost: 10,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
    },
    P1,
    id
  );
}

function setup(options: { replacingCardId?: string; sourceInWaiting?: boolean } = {}) {
  const kanon = member('PL!SP-bp7-001-P', 'kanon');
  const replacement = member('REPLACEMENT', 'replacement', ['Aqours']);
  let game = registerCards(createGameState('kanon-bp7', P1, 'P1', P2, 'P2'), [
    kanon,
    replacement,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom:
      options.sourceInWaiting === false
        ? player.waitingRoom
        : addCardToStatefulZone(player.waitingRoom, kanon.instanceId),
    memberSlots: placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      replacement.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  game = emitGameEvent(game, {
    eventId: 'leave-kanon',
    eventType: TriggerCondition.ON_LEAVE_STAGE,
    timestamp: 1,
    triggerPlayerId: P1,
    cardInstanceId: kanon.instanceId,
    fromZone: ZoneType.MEMBER_SLOT,
    toZone: ZoneType.WAITING_ROOM,
    fromSlot: SlotPosition.CENTER,
    ownerId: P1,
    controllerId: P1,
    ...(options.replacingCardId === undefined
      ? { replacingCardId: replacement.instanceId }
      : options.replacingCardId
        ? { replacingCardId: options.replacingCardId }
        : {}),
  });
  const pending: PendingAbilityState = {
    id: 'pending-kanon',
    abilityId: SP_BP7_001_AUTO_RELAY_STACK_SELF_BELOW_REPLACEMENT_ABILITY_ID,
    sourceCardId: kanon.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LEAVE_STAGE,
    eventIds: ['leave-kanon'],
    sourceSlot: SlotPosition.CENTER,
  };
  return { game: { ...game, pendingAbilities: [pending] }, kanon, replacement };
}

function resolve(game: GameState) {
  return resolvePendingCardEffects(game).gameState;
}

describe('PL!SP-bp7-001-P 涩谷香音', () => {
  it('只按真实换手离场事件将自身从休息室压到 replacement 下方', () => {
    const { game, kanon, replacement } = setup();
    const done = resolve(game);
    expect(done.players[0].waitingRoom.cardIds).not.toContain(kanon.instanceId);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      kanon.instanceId,
    ]);
    expect(done.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(replacement.instanceId);
    expect(done.pendingAbilities).toEqual([]);
  });

  it('replacement 结算前移槽时按实例当前顶层槽位压入', () => {
    const { game, kanon, replacement } = setup();
    const moved = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.RIGHT,
        replacement.instanceId
      ),
    }));
    const done = resolve(moved);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([
      kanon.instanceId,
    ]);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
  });

  it('replacement 已成为 memberBelow 时安全 no-op', () => {
    const { game, kanon, replacement } = setup();
    const host = member('HOST', 'host');
    let changed = registerCards(game, [host]);
    changed = updatePlayer(changed, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        placeCardInSlot(
          removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
          SlotPosition.CENTER,
          host.instanceId
        ),
        SlotPosition.CENTER,
        replacement.instanceId
      ),
    }));
    const done = resolve(changed);
    expect(done.players[0].waitingRoom.cardIds).toContain(kanon.instanceId);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      replacement.instanceId,
    ]);
  });

  it.each([
    ['普通离场', { replacingCardId: '' }],
    ['来源已离开休息室', { sourceInWaiting: false }],
    ['replacement 不是当前槽位顶层', { replacingCardId: 'stale' }],
  ])('%s 时安全 no-op', (_label, options) => {
    const { game, kanon } = setup(options);
    const done = resolve(game);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.pendingAbilities).toEqual([]);
    if (options.sourceInWaiting !== false) {
      expect(done.players[0].waitingRoom.cardIds).toContain(kanon.instanceId);
    }
  });
});
