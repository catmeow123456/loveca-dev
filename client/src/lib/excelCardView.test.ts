import { describe, expect, it } from 'vitest';
import type { PlayerViewState, ViewCardObject } from '@game/online/types';
import {
  BladeHeartEffect,
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  ZoneType,
} from '@game/shared/types/enums';
import {
  formatFrontMetrics,
  formatTextHearts,
  formatTextJudgment,
  formatTextLiveRequirements,
  selectExcelCard,
} from './excelCardView';
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

describe('Excel judgment information', () => {
  const markers = [
    { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
    { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
    { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW },
    { effect: BladeHeartEffect.DRAW },
    { effect: BladeHeartEffect.DRAW },
    { effect: BladeHeartEffect.SCORE },
  ];
  const replacement = { fromColors: [HeartColor.YELLOW], toColor: HeartColor.BLUE };
  it('counts all printed markers, preserves rainbow hearts and never replaces draw or score', () => {
    expect(formatTextJudgment(markers)).toBe('黄 2、彩虹 1、抽卡 +2、分数 +1');
    expect(formatTextJudgment(markers, replacement)).toBe('蓝 2、彩虹 1、抽卡 +2、分数 +1');
    expect(markers[0].heartColor).toBe(HeartColor.YELLOW);
    expect(formatTextJudgment([])).toBe('—');
    expect(formatTextJudgment()).toBe('—');
  });
  it.each([CardType.MEMBER, CardType.LIVE])(
    'applies only the cheer owner replacement for %s, never to cards in other zones',
    (cardType) => {
      const card: ViewCardObject = {
        ...front,
        ownerSeat: 'SECOND',
        controllerSeat: 'FIRST',
        frontInfo: { ...front.frontInfo!, cardType, bladeHearts: markers },
      };
      const state = view(
        { 'obj_public-a': card },
        {
          cheerHeartColorReplacements: {
            FIRST: { fromColors: [HeartColor.YELLOW], toColor: HeartColor.PURPLE },
            SECOND: replacement,
          },
        }
      );
      const projected: PlayerViewState = {
        ...state,
        match: { ...state.match, phase: GamePhase.PERFORMANCE_PHASE },
        table: {
          zones: {
            SHARED_RESOLUTION_ZONE: {
              ...emptyZones.SHARED_RESOLUTION_ZONE,
              objectIds: ['obj_public-a'],
            },
          },
        },
      };
      const row = selectExcelCard(projected, 'obj_public-a')!;
      expect(row.printedJudgment).toBe('黄 2、彩虹 1、抽卡 +2、分数 +1');
      expect(row.currentJudgment).toBe('蓝 2、彩虹 1、抽卡 +2、分数 +1');
      expect(
        selectExcelCard(
          { ...projected, match: { ...projected.match, phase: GamePhase.LIVE_RESULT_PHASE } },
          'obj_public-a'
        )!.currentJudgment
      ).toBe(row.currentJudgment);
      for (const zone of [
        ZoneType.HAND,
        ZoneType.WAITING_ROOM,
        ZoneType.LIVE_ZONE,
        ZoneType.MEMBER_SLOT,
      ]) {
        const otherZone = {
          ...projected,
          table: {
            zones: {
              ...emptyZones,
              FIRST_HAND: { zone, count: 1, ordered: false, objectIds: ['obj_public-a'] },
            },
          },
        } as PlayerViewState;
        expect(selectExcelCard(otherZone, 'obj_public-a')!.currentJudgment).toBeUndefined();
        expect(selectExcelCard(otherZone, 'obj_public-a')!.printedJudgment).toBe(
          row.printedJudgment
        );
      }
      expect(
        selectExcelCard(
          { ...projected, objects: { 'obj_public-a': { ...card, surface: 'BACK' } } },
          'obj_public-a'
        )
      ).toBeNull();
    }
  );
  it('labels generic LIVE requirements as gray while gained rainbow hearts remain rainbow', () => {
    for (const color of [HeartColor.GRAY, HeartColor.RAINBOW]) {
      const requirements = { colorRequirements: { PINK: 5, [color]: 7 }, totalRequired: 12 };
      expect(formatTextLiveRequirements(requirements)).toBe('粉 5、灰心 7');
      expect(
        formatFrontMetrics({
          cardCode: 'LIVE',
          cardType: CardType.LIVE,
          score: 5,
          requiredHearts: requirements,
        })
      ).toContain('需求 粉 5、灰心 7；总心 12');
      const live = {
        ...front,
        frontInfo: {
          cardCode: 'LIVE',
          cardType: CardType.LIVE,
          score: 5,
          requiredHearts: requirements,
        },
      };
      expect(selectExcelCard(view({ 'obj_public-a': live }), 'obj_public-a')!.metrics).toContain(
        '当前需求 粉 5、灰心 7；总心 12'
      );
    }
    expect(formatTextHearts([{ color: HeartColor.RAINBOW, count: 1 }])).toBe('彩虹 1');
    expect(
      formatTextJudgment([{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }])
    ).toBe('彩虹 1');
  });
});
