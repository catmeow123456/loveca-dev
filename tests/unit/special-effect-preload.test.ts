import { describe, expect, it } from 'vitest';
import type { PlayerViewState, ViewZoneState } from '../../src/online/types';
import { collectSpecialEffectImageUrls } from '../../client/src/lib/specialEffectPreload';
import {
  MODIFIER_ICON_SOURCE,
  HEART_ICON_SOURCE_BY_COLOR,
} from '../../client/src/lib/modifierIconAssets';
import { EFFECT_IMAGE_CACHE_LIMIT } from '../../client/src/lib/effectImageCache';

const imagePath = (code: string) => `/images/${code}.png`;
const zone = (zone: string, objectIds: string[]): ViewZoneState => ({
  zone,
  objectIds,
  count: objectIds.length,
  ordered: false,
});
const view = () =>
  ({
    match: { entranceAssetIds: ['ginko', 'rina', 'honoka'] },
    objects: Object.fromEntries(
      ['live', 'success', 'member', 'waiting', 'hand', 'deck', 'back', 'revealed'].map((id) => [
        id,
        {
          surface: id === 'back' ? 'BACK' : 'FRONT',
          frontInfo: { cardCode: id },
        },
      ])
    ),
    table: {
      zones: {
        live: zone('LIVE_ZONE', ['live', 'back']),
        success: zone('SUCCESS_ZONE', ['success']),
        stage: { ...zone('MEMBER_SLOT', []), slotMap: { left: 'member', center: null } },
        waiting: zone('WAITING_ROOM', ['waiting']),
        hand: zone('HAND', ['hand']),
        deck: zone('MAIN_DECK', ['deck']),
      },
    },
    activeEffect: {
      selectableObjectIds: ['hand', 'deck', 'waiting'],
      revealedObjectIds: ['revealed'],
    },
  }) as unknown as PlayerViewState;
const collect = (v: PlayerViewState, reduced = false) =>
  collectSpecialEffectImageUrls(v, imagePath, reduced);

describe('public special-effect preload candidates', () => {
  it.each(['ginko', 'rina', 'honoka', 'shizuku'] as const)(
    'warms public cards for a %s-only match',
    (id) => {
      const v = view();
      expect(collect({ ...v, match: { ...v.match, entranceAssetIds: [id] } })).toContain(
        '/images/waiting.png'
      );
    }
  );

  it('prioritizes the public Shizuku role and its actual HEART assets', () => {
    const v = view();
    const updated = {
      ...v,
      match: {
        ...v.match,
        entranceAssetIds: ['shizuku'],
        entrance: {
          shizukuRole: {
            hostObjectId: 'member',
            sourceObjectId: 'waiting',
            hearts: [{ color: 'BLUE', count: 2 }],
          },
        },
      },
    } as PlayerViewState;
    expect(collect(updated).slice(0, 2)).toEqual([
      '/images/waiting.png',
      HEART_ICON_SOURCE_BY_COLOR.BLUE,
    ]);
    expect(collect(updated, true)).toEqual([]);
  });

  it('keeps the current copied ability source ahead of other waiting-room candidates', () => {
    const v = view();
    const updated = {
      ...v,
      match: { ...v.match, entrance: { abilityTransfer: { sourceObjectId: 'waiting' } } },
    } as PlayerViewState;
    expect(collect(updated)[1]).toBe('/images/waiting.png');
  });

  it('prioritizes revealed/selected public faces and never uses hidden zones or BACK identities', () => {
    expect(collect(view())).toEqual([
      MODIFIER_ICON_SOURCE.heart_all,
      '/images/revealed.png',
      '/images/waiting.png',
      '/images/live.png',
      '/images/success.png',
      '/images/member.png',
    ]);
  });
  it('uses only declared public movement snapshots after a card moves to a hidden destination', () => {
    const v = view();
    const updated = {
      ...v,
      match: {
        ...v.match,
        entrance: {
          rinaLiveSwap: { liveCardCode: 'returned-public-live' },
          honokaMemory: { recovered: { cardCode: 'recovered-public-member' } },
        },
      },
    } as PlayerViewState;
    expect(collect(updated).slice(1, 3)).toEqual([
      '/images/returned-public-live.png',
      '/images/recovered-public-member.png',
    ]);
    expect(collect(updated)).not.toContain('/images/hand.png');
  });
  it('skips unrelated matches and card decoding in reduced motion', () => {
    const v = view();
    expect(collect({ ...v, match: { ...v.match, entranceAssetIds: [] } })).toEqual([]);
    expect(collect(v, true)).toEqual([MODIFIER_ICON_SOURCE.heart_all]);
    expect(collect({ ...v, match: { ...v.match, entranceAssetIds: ['rina'] } }, true)).toEqual([]);
  });
  it('bounds and deduplicates the public working set while keeping LIVE faces ahead of waiting-room cards', () => {
    const v = view();
    const ids = Array.from({ length: 60 }, (_, i) => `waiting-${i}`);
    const many = {
      ...v,
      activeEffect: undefined,
      objects: {
        ...v.objects,
        ...Object.fromEntries(
          ids.map((id) => [id, { surface: 'FRONT', frontInfo: { cardCode: id } }])
        ),
      },
      table: { zones: { ...v.table.zones, waiting: zone('WAITING_ROOM', [...ids, 'live']) } },
    } as PlayerViewState;
    const result = collect(many);
    expect(result).toHaveLength(EFFECT_IMAGE_CACHE_LIMIT);
    expect(result.slice(0, 4)).toEqual([
      MODIFIER_ICON_SOURCE.heart_all,
      '/images/live.png',
      '/images/success.png',
      '/images/member.png',
    ]);
    expect(new Set(result).size).toBe(result.length);
  });
});
