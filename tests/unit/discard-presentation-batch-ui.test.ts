import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  createPublicDiscardPresentationEvent,
  DiscardPresentationBatch,
  getNextViewDiffGeneration,
  getPublicDiscardPresentationOcclusions,
} from '../../client/src/components/game/BattleAnimationLayer';
import type {
  BattleAnimationAnchorMaps,
  DiscardPresentationBatchEvent,
} from '../../client/src/lib/battleAnimationEvents';
import type { PublicDiscardRevealBatch } from '../../client/src/lib/publicDiscardRevealQueue';

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (...args: readonly unknown[]) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};

function batchEvent(count: number): DiscardPresentationBatchEvent {
  return {
    id: `discard:test:${count}`,
    kind: 'DISCARD_PRESENTATION_BATCH',
    cards: Array.from({ length: count }, (_, index) => ({
      render: {
        objectId: `obj_${index}`,
        cardId: `card_${index}`,
        fromSurface: 'BACK',
        toSurface: 'FRONT',
        surface: 'FRONT',
        cardCode: `CARD-${index}`,
      },
      fromRect: { left: 120, top: 640, width: 70, height: 98 },
    })),
    toSeat: 'FIRST',
    toZoneKey: 'FIRST_WAITING_ROOM',
    toRect: { left: 980, top: 580, width: 76, height: 106 },
  };
}

describe('discard presentation batch UI', () => {
  it('uses an individual hand origin only for the owner and an anonymous hand origin for the opponent', () => {
    const ownCardRect = { left: 120, top: 640, width: 70, height: 98 };
    const anonymousHandRect = { left: 80, top: 30, width: 420, height: 104 };
    const waitingRoomRect = { left: 620, top: 40, width: 45, height: 63 };
    const nextAnchors: BattleAnimationAnchorMaps = {
      cards: new Map(),
      zones: new Map([
        ['seat-SECOND::hand', anonymousHandRect],
        ['seat-SECOND::waiting-room', waitingRoomRect],
      ]),
    };
    const batch: PublicDiscardRevealBatch = {
      movementBatchId: 'match-1:movement-batch:10:SECOND',
      ownerSeat: 'SECOND',
      eventIds: ['match-1:10'],
      cards: [{ publicObjectId: 'obj_discarded', cardCode: 'CARD-DISCARDED' }],
      firstSeq: 10,
      lastSeq: 10,
      receivedAt: 1_000,
    };
    const recentSourceAnchors = new Map([
      ['obj_discarded', { matchId: 'match-1', rect: ownCardRect, capturedAt: 1_000 }],
    ]);

    const opponentPresentation = createPublicDiscardPresentationEvent({
      batch,
      matchId: 'match-1',
      viewerSeat: 'FIRST',
      nextAnchors,
      previousAnchors: null,
      recentSourceAnchors,
    });
    const ownerPresentation = createPublicDiscardPresentationEvent({
      batch,
      matchId: 'match-1',
      viewerSeat: 'SECOND',
      nextAnchors,
      previousAnchors: null,
      recentSourceAnchors,
    });

    expect(opponentPresentation?.cards[0]?.fromRect).toEqual(anonymousHandRect);
    expect(opponentPresentation?.cards[0]?.render.fromSurface).toBe('BACK');
    expect(ownerPresentation?.cards[0]?.fromRect).toEqual(ownCardRect);
    expect(ownerPresentation?.cards[0]?.render.fromSurface).toBe('FRONT');
  });

  it('renders every card face with a compact batch label and no pointer interaction', () => {
    const html = renderToStaticMarkup(
      createElement(DiscardPresentationBatch, {
        event: batchEvent(3),
        getCardImagePath: (cardCode: string) => `/cards/${cardCode}.webp`,
        reduceMotion: false,
        onDone: () => undefined,
      })
    );

    expect(html).toContain('放置入休息室 ×3');
    expect(html.match(/<img/g)).toHaveLength(3);
    expect(html).toContain('/cards/CARD-0.webp');
    expect(html).toContain('pointer-events-none');
  });

  it('keeps the same face-up batch in the reduced-motion presentation', () => {
    const html = renderToStaticMarkup(
      createElement(DiscardPresentationBatch, {
        event: batchEvent(6),
        getCardImagePath: (cardCode: string) => `/cards/${cardCode}.webp`,
        reduceMotion: true,
        onDone: () => undefined,
      })
    );

    expect(html).toContain('放置入休息室 ×6');
    expect(html.match(/data-discard-presentation-object-id=/g)).toHaveLength(6);
    expect(html.match(/<img/g)).toHaveLength(6);
  });

  it('uses the eventual animation IDs to occlude every card as soon as its batch queues', () => {
    const batch: PublicDiscardRevealBatch = {
      movementBatchId: 'match-1:movement-batch:20:FIRST',
      ownerSeat: 'FIRST',
      eventIds: ['match-1:20', 'match-1:21'],
      cards: [
        { publicObjectId: 'obj_first', cardCode: 'CARD-FIRST' },
        { publicObjectId: 'obj_second', cardCode: 'CARD-SECOND' },
      ],
      firstSeq: 20,
      lastSeq: 21,
      receivedAt: 1_000,
    };

    expect(getPublicDiscardPresentationOcclusions(batch)).toEqual([
      {
        eventId: 'public-discard:match-1:movement-batch:20:FIRST:obj_first',
        objectId: 'obj_first',
      },
      {
        eventId: 'public-discard:match-1:movement-batch:20:FIRST:obj_second',
        objectId: 'obj_second',
      },
    ]);
  });

  it('keeps delayed view-diff schedules valid across public-log and discard-pump rerenders', () => {
    const scheduledGeneration = getNextViewDiffGeneration(7, true);
    const afterPublicLogUpdate = getNextViewDiffGeneration(scheduledGeneration, false);
    const afterDiscardPumpUpdate = getNextViewDiffGeneration(afterPublicLogUpdate, false);

    expect(afterPublicLogUpdate).toBe(scheduledGeneration);
    expect(afterDiscardPumpUpdate).toBe(scheduledGeneration);
    expect(getNextViewDiffGeneration(afterDiscardPumpUpdate, true)).toBe(scheduledGeneration + 1);
  });
});
