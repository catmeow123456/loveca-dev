import { describe, expect, it } from 'vitest';
import {
  collectBattleAnimationAnchors,
  collectBattleObjectLocations,
  createBattleAnimationEventsFromViewDiff,
  findBattleObjectLocation,
  type BattleAnimationEvent,
  type BattleAnimationAnchorMaps,
  type BattleAnimationRect,
} from '../../client/src/lib/battleAnimationEvents';
import { createSequencedBattleAnimationEvents } from '../../client/src/lib/battleAnimationSequencing';
import type {
  PlayerViewState,
  Seat,
  ViewCardObject,
  ViewZoneKey,
  ViewZoneState,
} from '../../src/online';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  GamePhase,
  OrientationState,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';

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

function fakeAnchorElement({
  objectId,
  left,
  top,
  imageSrc,
}: {
  readonly objectId: string;
  readonly left: number;
  readonly top: number;
  readonly imageSrc?: string;
}): HTMLElement {
  return {
    dataset: { objectId },
    id: '',
    getBoundingClientRect: () => ({ left, top, width: 50, height: 70 }),
    matches: () => false,
    querySelector: () => (imageSrc ? { currentSrc: imageSrc, src: imageSrc } : null),
  } as unknown as HTMLElement;
}

function withFakeDocument<T>(documentValue: Pick<Document, 'querySelectorAll'>, run: () => T): T {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    value: documentValue,
    configurable: true,
  });
  try {
    return run();
  } finally {
    if (originalDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        value: originalDocument,
        configurable: true,
      });
    }
  }
}

function moveEvent(
  objectId: string,
  fromZoneType: ZoneType,
  toZoneType: ZoneType
): Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }> {
  return {
    id: `move:${objectId}:${fromZoneType}->${toZoneType}`,
    kind: 'CARD_MOVE',
    render: {
      objectId,
      cardId: objectId.replace(/^obj_/, ''),
      fromSurface: 'BACK',
      toSurface: 'FRONT',
      surface: 'FRONT',
    },
    fromZoneType,
    toZoneType,
    fromRect: rect(0, 0),
    toRect: rect(100, 100),
  };
}

describe('battle animation events', () => {
  it('aligns DOM data object ids with projected public object ids', () => {
    const objectId = createPublicObjectId('card-1');
    const element = fakeAnchorElement({
      objectId,
      left: 12,
      top: 34,
      imageSrc: '/cards/card-1.webp',
    });
    const state = viewState({
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: [objectId] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: {
        [objectId]: cardObject(objectId),
      },
    });

    const collectedAnchors = withFakeDocument(
      {
        querySelectorAll: (selector: string) =>
          selector === '[data-object-id]' ? ([element] as unknown as NodeListOf<HTMLElement>) : [],
      },
      () => collectBattleAnimationAnchors()
    );

    expect(collectedAnchors.cards.get(objectId)).toMatchObject({
      left: 12,
      top: 34,
      width: 50,
      height: 70,
      imageSrc: '/cards/card-1.webp',
    });
    expect(findBattleObjectLocation(state, objectId)?.key).toBe(`FIRST_HAND:list:0:${objectId}`);
  });

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
    const objects = Object.fromEntries(
      objectIds.map((objectId) => [objectId, cardObject(objectId)])
    );
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
      nextAnchors: anchors(
        objectIds.map((objectId, index) => [objectId, rect(100 + index * 4, 80)])
      ),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(4);
    expect(events.every((event) => event.kind === 'ZONE_PULSE')).toBe(true);
  });

  it('does not create long-distance card move events for main deck inspection', () => {
    const previous = viewState({
      seq: 4,
      zones: {
        FIRST_MAIN_DECK: zone(ZoneType.MAIN_DECK, { objectIds: ['obj_top'] }),
        FIRST_INSPECTION_ZONE: zone(ZoneType.INSPECTION_ZONE, { objectIds: [] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: { obj_top: cardObject('obj_top') },
    });
    const next = viewState({
      seq: 5,
      zones: {
        FIRST_MAIN_DECK: zone(ZoneType.MAIN_DECK, { objectIds: [] }),
        FIRST_INSPECTION_ZONE: zone(ZoneType.INSPECTION_ZONE, { objectIds: ['obj_top'] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: { obj_top: cardObject('obj_top') },
    });

    const events = createBattleAnimationEventsFromViewDiff({
      previousViewState: previous,
      nextViewState: next,
      previousAnchors: anchors([['obj_top', rect(0, 0)]]),
      nextAnchors: anchors([['obj_top', rect(100, 100)]]),
    });

    expect(events).toEqual([]);
  });

  it('uses zone pulse instead of card move when a stacked member card changes location', () => {
    const previous = viewState({
      seq: 6,
      zones: {
        FIRST_MEMBER_LEFT: zone(ZoneType.MEMBER_SLOT, {
          slotMap: { LEFT: 'obj_member' },
          memberBelow: { LEFT: ['obj_below'] },
        }),
        FIRST_WAITING_ROOM: zone(ZoneType.WAITING_ROOM, { objectIds: [] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: {
        obj_member: cardObject('obj_member'),
        obj_below: cardObject('obj_below'),
      },
    });
    const next = viewState({
      seq: 7,
      zones: {
        FIRST_MEMBER_LEFT: zone(ZoneType.MEMBER_SLOT, {
          slotMap: { LEFT: 'obj_member' },
          memberBelow: { LEFT: [] },
        }),
        FIRST_WAITING_ROOM: zone(ZoneType.WAITING_ROOM, { objectIds: ['obj_below'] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: {
        obj_member: cardObject('obj_member'),
        obj_below: cardObject('obj_below'),
      },
    });

    const events = createBattleAnimationEventsFromViewDiff({
      previousViewState: previous,
      nextViewState: next,
      previousAnchors: anchors([['obj_below', rect(0, 0)]]),
      nextAnchors: anchors([['obj_below', rect(100, 100)]]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'ZONE_PULSE',
      id: 'pulse:7:stack:seat-FIRST::waiting-room',
    });
  });

  it('does not occlude hand cards that only shift index after another hand card leaves', () => {
    const previous = viewState({
      seq: 8,
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: ['obj_a', 'obj_b', 'obj_c'] }),
        FIRST_MEMBER_LEFT: zone(ZoneType.MEMBER_SLOT, { slotMap: { LEFT: null } }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: {
        obj_a: cardObject('obj_a'),
        obj_b: cardObject('obj_b'),
        obj_c: cardObject('obj_c'),
      },
    });
    const next = viewState({
      seq: 9,
      zones: {
        FIRST_HAND: zone(ZoneType.HAND, { objectIds: ['obj_b', 'obj_c'] }),
        FIRST_MEMBER_LEFT: zone(ZoneType.MEMBER_SLOT, { slotMap: { LEFT: 'obj_a' } }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects: {
        obj_a: cardObject('obj_a'),
        obj_b: cardObject('obj_b'),
        obj_c: cardObject('obj_c'),
      },
    });

    const events = createBattleAnimationEventsFromViewDiff({
      previousViewState: previous,
      nextViewState: next,
      previousAnchors: anchors([
        ['obj_a', rect(0, 0)],
        ['obj_b', rect(60, 0)],
        ['obj_c', rect(120, 0)],
      ]),
      nextAnchors: anchors([
        ['obj_a', rect(300, 80)],
        ['obj_b', rect(0, 0)],
        ['obj_c', rect(60, 0)],
      ]),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'CARD_MOVE',
      render: { objectId: 'obj_a' },
    });
  });

  it('uses one zone pulse when inspection cleanup moves multiple cards to waiting room', () => {
    const objectIds = ['obj_reveal_1', 'obj_reveal_2', 'obj_reveal_3'];
    const objects = Object.fromEntries(
      objectIds.map((objectId) => [objectId, cardObject(objectId)])
    );
    const previous = viewState({
      seq: 10,
      zones: {
        FIRST_INSPECTION_ZONE: zone(ZoneType.INSPECTION_ZONE, { objectIds }),
        FIRST_WAITING_ROOM: zone(ZoneType.WAITING_ROOM, { objectIds: [] }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects,
    });
    const next = viewState({
      seq: 11,
      zones: {
        FIRST_INSPECTION_ZONE: zone(ZoneType.INSPECTION_ZONE, { objectIds: [] }),
        FIRST_WAITING_ROOM: zone(ZoneType.WAITING_ROOM, { objectIds }),
      } as Record<ViewZoneKey, ViewZoneState>,
      objects,
    });

    const events = createBattleAnimationEventsFromViewDiff({
      previousViewState: previous,
      nextViewState: next,
      previousAnchors: anchors(objectIds.map((objectId, index) => [objectId, rect(index * 60, 0)])),
      nextAnchors: {
        cards: new Map(objectIds.map((objectId, index) => [objectId, rect(400 + index, 80)])),
        zones: new Map([['seat-FIRST::waiting-room', rect(400, 80)]]),
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'ZONE_PULSE',
      id: 'pulse:11:inspection-cleanup:seat-FIRST::waiting-room',
    });
  });

  it('delays ordinary follow-up moves after a stage entry move', () => {
    const stageEntry = moveEvent('obj_member', ZoneType.HAND, ZoneType.MEMBER_SLOT);
    const waitingRoomMove = moveEvent('obj_cost_card', ZoneType.HAND, ZoneType.WAITING_ROOM);

    const scheduledEvents = createSequencedBattleAnimationEvents([stageEntry, waitingRoomMove]);

    expect(scheduledEvents.find((scheduled) => scheduled.event.id === stageEntry.id)?.delayMs).toBe(
      0
    );
    const waitingRoomDelay = scheduledEvents.find(
      (scheduled) => scheduled.event.id === waitingRoomMove.id
    )?.delayMs;
    expect(waitingRoomDelay).toBeGreaterThan(0);
  });
});
