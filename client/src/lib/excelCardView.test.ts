import { describe, expect, it } from 'vitest';
import type { PlayerViewState, ViewCardObject } from '@game/online/types';
import { CardType, HeartColor, OrientationState, ZoneType } from '@game/shared/types/enums';
import { selectExcelCard } from './excelCardView';
const emptyZones: PlayerViewState['table']['zones'] = {
  SHARED_RESOLUTION_ZONE: {
    zone: ZoneType.RESOLUTION_ZONE,
    count: 0,
    ordered: false,
    objectIds: [],
  },
};
const front: ViewCardObject = {
  publicObjectId: 'obj_public-a',
  ownerSeat: 'FIRST',
  controllerSeat: 'FIRST',
  surface: 'FRONT',
  orientation: OrientationState.WAITING,
  frontInfo: {
    cardCode: 'M-1',
    nameCn: '可见成员',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 3,
    hearts: [{ color: HeartColor.GREEN, count: 2 }],
    modifierDelta: { costDelta: -2, bladeDelta: 1 },
  },
};
function view(objects: Record<string, ViewCardObject>, result: object = {}) {
  return {
    objects,
    table: { zones: { FIRST_MEMBER_LEFT: { slotMap: { LEFT: 'obj_public-a' } } } },
    match: {
      liveResult: {
        requirementReductions: {},
        requirementModifiers: {},
        liveCardScoreModifiers: {},
        ...result,
      },
    },
  } as unknown as PlayerViewState;
}
describe('Excel projected card rows', () => {
  it('does not expose fronts attached to unauthorized surfaces or missing objects', () => {
    const state = view({ obj_secret: { ...front, publicObjectId: 'obj_secret', surface: 'BACK' } });
    expect(selectExcelCard(state, 'obj_secret')).toBeNull();
    expect(selectExcelCard(state, 'obj_missing')).toBeNull();
  });
  it('keeps instance identity stable when another card is revealed and reports effective stage values', () => {
    const first = selectExcelCard(view({ 'obj_public-a': front }), 'obj_public-a')!;
    const next = selectExcelCard(
      view({ obj_other: { ...front, publicObjectId: 'obj_other' }, 'obj_public-a': front }),
      'obj_public-a'
    )!;
    expect(first.cardId).toBe(next.cardId);
    expect(first.objectId).toBe(next.objectId);
    expect(first.metrics).toContain('费用 3（印刷 5）');
    expect(first.metrics).toContain('光棒 3');
    expect(first.state).toContain('待机');
  });
  it('does not invent an active state when orientation is absent', () => {
    const state = view({ 'obj_public-a': { ...front, orientation: undefined } });
    expect(selectExcelCard(state, 'obj_public-a')!.state).toBe('');
  });
  it('drops stage-only states when a member moves to the waiting room', () => {
    const member = { ...front, enteredStageThisTurn: true, skipsNextActivePhase: true };
    const state = view({ 'obj_public-a': member });
    expect(selectExcelCard(state, 'obj_public-a')!.state).toBe('待机；本回合登场；下次不活跃');
    const after: PlayerViewState = {
      ...state,
      table: {
        zones: {
          ...emptyZones,
          FIRST_WAITING_ROOM: {
            zone: ZoneType.WAITING_ROOM,
            count: 1,
            ordered: false,
            objectIds: ['obj_public-a'],
          },
        },
      },
    };
    expect(selectExcelCard(after, 'obj_public-a')!.state).toBe('');
  });
  it.each([
    ZoneType.HAND,
    ZoneType.WAITING_ROOM,
    ZoneType.MAIN_DECK,
    ZoneType.ENERGY_DECK,
    ZoneType.LIVE_ZONE,
    ZoneType.SUCCESS_ZONE,
    ZoneType.EXILE_ZONE,
    ZoneType.INSPECTION_ZONE,
    ZoneType.RESOLUTION_ZONE,
  ])('does not display orientation in %s', (zone) => {
    const state = view({ 'obj_public-a': front });
    const projected: PlayerViewState = {
      ...state,
      table: {
        zones: {
          ...emptyZones,
          FIRST_TEST: {
            zone,
            count: 1,
            ordered: false,
            objectIds: ['obj_public-a'],
          },
        },
      },
    };
    expect(selectExcelCard(projected, 'obj_public-a')!.state).toBe('');
  });
  it('retains energy-zone orientation but not stage-only statuses', () => {
    const energy: ViewCardObject = {
      ...front,
      enteredStageThisTurn: true,
      frontInfo: { cardCode: 'E-1', cardType: CardType.ENERGY },
    };
    for (const [orientation, label] of [
      [OrientationState.ACTIVE, '活跃'],
      [OrientationState.WAITING, '待机'],
    ] as const) {
      const state = view({ 'obj_public-a': { ...energy, orientation } });
      const projected: PlayerViewState = {
        ...state,
        table: {
          zones: {
            ...emptyZones,
            FIRST_ENERGY_ZONE: {
              zone: ZoneType.ENERGY_ZONE,
              count: 1,
              ordered: false,
              objectIds: ['obj_public-a'],
            },
          },
        },
      };
      expect(selectExcelCard(projected, 'obj_public-a')!.state).toBe(label);
    }
  });
  it.each(['overlays', 'memberBelow'] as const)(
    'does not treat %s as the stage occupant',
    (attachment) => {
      const state = view({ 'obj_public-a': front });
      const projected: PlayerViewState = {
        ...state,
        table: {
          zones: {
            ...emptyZones,
            FIRST_MEMBER_LEFT: {
              zone: ZoneType.MEMBER_SLOT,
              count: 2,
              ordered: false,
              slotMap: { LEFT: 'obj_other' },
              [attachment]: { LEFT: ['obj_public-a'] },
            },
          },
        },
      };
      expect(selectExcelCard(projected, 'obj_public-a')!.state).toBe('');
    }
  );
  it('applies authorized LIVE requirement and score modifiers without changing printed card data', () => {
    const live = {
      ...front,
      frontInfo: {
        cardCode: 'L-1',
        nameCn: '公开 LIVE',
        cardType: CardType.LIVE,
        score: 2,
        requiredHearts: { colorRequirements: { GREEN: 2 }, totalRequired: 4 },
      },
    } as ViewCardObject;
    const state = view(
      { 'obj_public-a': live },
      {
        liveCardScoreModifiers: { 'obj_public-a': 3 },
        requirementModifiers: { 'obj_public-a': [{ color: HeartColor.GREEN, countDelta: -1 }] },
      }
    );
    const row = selectExcelCard(state, 'obj_public-a')!;
    expect(row.metrics).toContain('当前分数 5（印刷 2）');
    expect(row.metrics).toContain('绿 1');
    expect(live.frontInfo?.score).toBe(2);
  });
});
