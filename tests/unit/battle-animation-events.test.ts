import { describe, expect, it } from 'vitest';
import {
  collectBattleObjectLocations,
  createBattleAnimationEventsFromViewDiff,
  findBattleObjectLocation,
  type BattleAnimationAnchorMaps,
  type BattleAnimationRect,
} from '../../client/src/lib/battleAnimationEvents';
import type {
  PlayerViewState,
  Seat,
  ViewCardObject,
  ViewZoneKey,
  ViewZoneState,
} from '../../src/online';
import { CardType, GamePhase, OrientationState, SubPhase, ZoneType } from '../../src/shared/types/enums';

function rect(left: number, top: number): BattleAnimationRect {
  return { left, top, width: 50, height: 70 };
}

function cardObject(objectId: string, ownerSeat: Seat = 'FIRST'): ViewCardObject {
  return {
    publicObjectId: objectId,
    ownerSeat,
    controllerSeat: ownerSeat,
    cardType: CardType.MEMBER,
    surface: 'FRONT',
    orientation: OrientationState.ACTIVE,
    frontInfo: {
      cardCode: `CARD-${objectId}`,
      name: objectId,
      cardType: CardType.MEMBER,
    },
  };
}

function zone(zone: ZoneType, state: Partial<ViewZoneState> = {}): ViewZoneState {
  return {
    zone,
    count: state.objectIds?.length ?? 0,
    ordered: true,
    ...state,
  };
}

function viewState({
  matchId = 'match-1',
  seq = 1,
  zones,
  objects,
}: {
  readonly matchId?: string;
  readonly seq?: number;
  readonly zones: Record<ViewZoneKey, ViewZoneState>;
  readonly objects: Record<string, ViewCardObject>;
}): PlayerViewState {
  return {
    match: {
      matchId,
      viewerSeat: 'FIRST',
      participants: {
        FIRST: { id: 'p1', name: 'first' },
        SECOND: { id: 'p2', name: 'second' },
      },
      turnCount: 1,
      phase: GamePhase.MAIN_PHASE,
      subPhase: SubPhase.NONE,
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
      window: null,
      seq,
    },
    table: { zones },
    objects,
    permissions: { availableCommands: [] },
  };
}

function anchors(entries: readonly [string, BattleAnimationRect][]): BattleAnimationAnchorMaps {
  return {
    cards: new Map(entries),
    zones: new Map(),
  };
}

describe('battle animation events', () => {
  it('collects object locations across lists, slots, overlays, and memberBelow', () => {
    const state = viewState({
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: ['obj_hand'] }),
        FIRST_MEMBER_LEFT: zone(ZoneType.MEMBER_SLOT, {
          slotMap: { LEFT: 'obj_slot' },
          overlays: { LEFT: ['obj_overlay_1', 'obj_overlay_2'] },
          memberBelow: { LEFT: ['obj_below'] },
        }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: {
        obj_hand: cardObject('obj_hand'),
        obj_slot: cardObject('obj_slot'),
        obj_overlay_1: cardObject('obj_overlay_1'),
        obj_overlay_2: cardObject('obj_overlay_2'),
        obj_below: cardObject('obj_below'),
      },
    });

    const locations = collectBattleObjectLocations(state);
    expect(locations.get('obj_hand')?.key).toBe('FIRST_HAND:list:0:obj_hand');
    expect(locations.get('obj_slot')?.key).toBe('FIRST_MEMBER_LEFT:slot:LEFT');
    expect(locations.get('obj_overlay_2')?.key).toBe('FIRST_MEMBER_LEFT:overlay:LEFT:1');
    expect(findBattleObjectLocation(state, 'obj_below')?.key).toBe(
      'FIRST_MEMBER_LEFT:below:LEFT:0'
    );
  });

  it('creates a card move event when an object changes view location in the same match', () => {
    const previous = viewState({
      seq: 1,
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: ['obj_a'] }),
        FIRST_MEMBER_LEFT: zone(ZoneType.MEMBER_SLOT, { slotMap: { LEFT: null } }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: { obj_a: cardObject('obj_a') },
    });
    const next = viewState({
      seq: 2,
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: [] }),
        FIRST_MEMBER_LEFT: zone(ZoneType.MEMBER_SLOT, { slotMap: { LEFT: 'obj_a' } }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: { obj_a: cardObject('obj_a') },
    });

    const events = createBattleAnimationEventsFromViewDiff({
      previousViewState: previous,
      nextViewState: next,
      previousAnchors: anchors([['obj_a', rect(0, 0)]]),
      nextAnchors: anchors([['obj_a', rect(120, 20)]]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'move:2:obj_a:FIRST_HAND:list:0:obj_a->FIRST_MEMBER_LEFT:slot:LEFT',
      kind: 'CARD_MOVE',
      fromZoneType: ZoneType.HAND,
      toZoneType: ZoneType.MEMBER_SLOT,
    });
  });

  it('does not animate across match changes', () => {
    const previous = viewState({
      matchId: 'old',
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: ['obj_a'] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: { obj_a: cardObject('obj_a') },
    });
    const next = viewState({
      matchId: 'new',
      seq: 2,
      zones: {
        FIRST_WAITING_ROOM: zone(ZoneType.WAITING_ROOM, { objectIds: ['obj_a'] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: { obj_a: cardObject('obj_a') },
    });

    expect(
      createBattleAnimationEventsFromViewDiff({
        previousViewState: previous,
        nextViewState: next,
        previousAnchors: anchors([['obj_a', rect(0, 0)]]),
        nextAnchors: anchors([['obj_a', rect(100, 100)]]),
      })
    ).toEqual([]);
  });

  it('falls back to zone pulses when too many cards move at once', () => {
    const objectIds = Array.from({ length: 9 }, (_, index) => `obj_${index}`);
    const objects = Object.fromEntries(objectIds.map((objectId) => [objectId, cardObject(objectId)]));
    const previous = viewState({
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds }),
        FIRST_WAITING_ROOM: zone(ZoneType.WAITING_ROOM, { objectIds: [] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects,
    });
    const next = viewState({
      seq: 3,
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: [] }),
        FIRST_WAITING_ROOM: zone(ZoneType.WAITING_ROOM, { objectIds }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects,
    });

    const events = createBattleAnimationEventsFromViewDiff({
      previousViewState: previous,
      nextViewState: next,
      previousAnchors: anchors(objectIds.map((objectId, index) => [objectId, rect(index * 4, 0)])),
      nextAnchors: anchors(objectIds.map((objectId, index) => [objectId, rect(100 + index * 4, 80)])),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(4);
    expect(events.every((event) => event.kind === 'ZONE_PULSE')).toBe(true);
  });
});
