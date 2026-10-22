import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { isCardMoveEvent } from '../../src/domain/events/game-events';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import {
  enqueueEnterSuccessZoneCardEffects,
  enqueueUntriggeredEnterSuccessZoneCardEffects,
  getEnterSuccessZoneEventsFromLog,
  recordSuccessZoneEntry,
} from '../../src/application/card-effects/runtime/success-zone-entry-triggers';
import { placeHandLiveCardInSuccessZoneForPlayer } from '../../src/application/card-effects/runtime/success-zone';
import { PL_BP8_021_AUTO_ENTER_SUCCESS_LOOK_TOP_FOUR_MUSE_MEMBER_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { CardType, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

function setup(successCardIds: readonly string[] = [], code = 'PL!-bp8-021-SECL') {
  const source = createCardInstance(
    {
      cardCode: code,
      name: '我们的奇迹',
      cardType: CardType.LIVE,
      score: 2,
      requirements: createHeartRequirement({}),
    },
    'p1',
    'source'
  );
  return updatePlayer(
    registerCards(createGameState('entry', 'p1', 'P1', 'p2', 'P2'), [source]),
    'p1',
    (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['source'] },
      successZone: { ...player.successZone, cardIds: successCardIds },
    })
  );
}

describe('actual success-zone entry trigger boundary', () => {
  it('records hand entry with post-entry count including the source, then queues once', () => {
    const before = setup();
    const moved = placeHandLiveCardInSuccessZoneForPlayer(before, 'p1', 'source')!;
    const events = getEnterSuccessZoneEventsFromLog(moved);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_SUCCESS_ZONE,
      cardInstanceId: 'source',
      fromZone: ZoneType.HAND,
      toZone: ZoneType.SUCCESS_ZONE,
      ownerId: 'p1',
      controllerId: 'p1',
      successZoneCardCountAfter: 1,
    });
    expect(isCardMoveEvent(events[0]!)).toBe(true);
    expect(moved.pendingAbilities).toEqual([]);
    const queued = enqueueEnterSuccessZoneCardEffects(moved, events);
    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: 'source',
      timingId: TriggerCondition.ON_ENTER_SUCCESS_ZONE,
      eventIds: [events[0]!.eventId],
      sourceLifecycleId: `source-lifecycle:event:${events[0]!.eventId}`,
      metadata: { successZoneCardCountAfter: 1 },
    });
    expect(enqueueUntriggeredEnterSuccessZoneCardEffects(queued)).toBe(queued);
    const resolved = { ...queued, pendingAbilities: [] };
    expect(enqueueEnterSuccessZoneCardEffects(resolved, events)).toBe(resolved);
  });

  it('captures count two and cannot resurrect that failed condition after another card leaves', () => {
    const moved = placeHandLiveCardInSuccessZoneForPlayer(setup(['existing']), 'p1', 'source')!;
    expect(getEnterSuccessZoneEventsFromLog(moved)[0]?.successZoneCardCountAfter).toBe(2);
    const later = updatePlayer(moved, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: ['source'] },
    }));
    const queued = enqueueUntriggeredEnterSuccessZoneCardEffects(later);
    expect(queued.pendingAbilities).toEqual([]);
    expect(enqueueUntriggeredEnterSuccessZoneCardEffects(queued)).toBe(queued);
  });

  it('retains an already triggered source when it leaves before dispatch', () => {
    const moved = placeHandLiveCardInSuccessZoneForPlayer(setup(), 'p1', 'source')!;
    const later = moveCardUniversal(moved, 'p1', 'source', ZoneType.SUCCESS_ZONE, ZoneType.HAND);
    const queued = enqueueUntriggeredEnterSuccessZoneCardEffects(later);
    expect(queued.pendingAbilities[0]).toMatchObject({
      sourceCardId: 'source',
      abilityId: ABILITY,
    });
    expect(queued.players[0].successZone.cardIds).toEqual([]);
  });

  it('records no event for same-zone, stale, failed placement or a different replacement card', () => {
    const before = setup();
    expect(placeHandLiveCardInSuccessZoneForPlayer(before, 'p1', 'missing')).toBeNull();
    const same = updatePlayer(before, 'p1', (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      successZone: { ...player.successZone, cardIds: ['source'] },
    }));
    expect(
      getEnterSuccessZoneEventsFromLog(
        moveCardUniversal(same, 'p1', 'source', ZoneType.SUCCESS_ZONE, ZoneType.SUCCESS_ZONE)
      )
    ).toEqual([]);
    expect(
      moveCardUniversal(before, 'p1', 'source', ZoneType.WAITING_ROOM, ZoneType.SUCCESS_ZONE)
    ).toBe(before);
    expect(recordSuccessZoneEntry(before, before, 'p1', 'source', ZoneType.HAND)).toBe(before);
    const failedRemoval = updatePlayer(before, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: ['source'] },
    }));
    expect(recordSuccessZoneEntry(before, failedRemoval, 'p1', 'source', ZoneType.HAND)).toBe(
      failedRemoval
    );
    const replaced = updatePlayer(before, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: ['replacement'] },
    }));
    expect(recordSuccessZoneEntry(before, replaced, 'p1', 'source', ZoneType.HAND)).toBe(replaced);
  });

  it('FREE movement records real entry, and a later listener does not consume old no-listener history', () => {
    const moved = moveCardUniversal(
      setup([], 'PL!-other'),
      'p1',
      'source',
      ZoneType.HAND,
      ZoneType.SUCCESS_ZONE
    );
    const marked = enqueueUntriggeredEnterSuccessZoneCardEffects(moved);
    expect(marked.pendingAbilities).toEqual([]);
    expect(
      marked.actionHistory.filter((action) => action.type === 'DISPATCH_TRIGGER_EVENT')
    ).toHaveLength(1);
    const source = marked.cardRegistry.get('source')!;
    const later: GameState = {
      ...marked,
      cardRegistry: new Map(marked.cardRegistry).set('source', {
        ...source,
        data: { ...source.data, cardCode: 'PL!-bp8-021-SECL' },
      }),
    };
    expect(enqueueUntriggeredEnterSuccessZoneCardEffects(later)).toBe(later);
  });
});
