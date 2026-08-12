import { describe, expect, it } from 'vitest';
import {
  collapseRankedOpenWindows,
  expandRankedOpenWindow,
  prepareRankedOpenWindowsForApi,
  prepareRankedOpenWindowsForForm,
} from '../../client/src/lib/rankedOpenWindows';

describe('ranked admin open-window model', () => {
  it('将部分星期的跨日时段拆为当日与次日窗口', () => {
    expect(
      expandRankedOpenWindow({ weekdays: [1, 3, 5], startMinute: 1080, endMinute: 60 })
    ).toEqual([
      { weekdays: [1, 3, 5], startMinute: 1080, endMinute: 1440 },
      { weekdays: [2, 4, 6], startMinute: 0, endMinute: 60 },
    ]);
  });

  it('次日开放日会从星期日回绕到星期一', () => {
    expect(expandRankedOpenWindow({ weekdays: [7], startMinute: 1320, endMinute: 120 })).toEqual([
      { weekdays: [7], startMinute: 1320, endMinute: 1440 },
      { weekdays: [1], startMinute: 0, endMinute: 120 },
    ]);
  });

  it('每日跨夜时保持两个窗口均为全星期', () => {
    expect(
      expandRankedOpenWindow({
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        startMinute: 1080,
        endMinute: 60,
      })
    ).toEqual([
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 1080, endMinute: 1440 },
      { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 60 },
    ]);
  });

  it('不拆分当日时段与以午夜为结束的时段', () => {
    expect(expandRankedOpenWindow({ weekdays: [1], startMinute: 1080, endMinute: 1440 })).toEqual([
      { weekdays: [1], startMinute: 1080, endMinute: 1440 },
    ]);
    expect(expandRankedOpenWindow({ weekdays: [1], startMinute: 0, endMinute: 60 })).toEqual([
      { weekdays: [1], startMinute: 0, endMinute: 60 },
    ]);
    expect(expandRankedOpenWindow({ weekdays: [1], startMinute: 0, endMinute: 0 })).toEqual([
      { weekdays: [1], startMinute: 0, endMinute: 1440 },
    ]);
  });

  it('将顺序任意的规范窗口合并回单个跨日表单时段', () => {
    expect(
      collapseRankedOpenWindows([
        { weekdays: [2, 4, 6], startMinute: 0, endMinute: 60 },
        { weekdays: [1, 3, 5], startMinute: 1080, endMinute: 1440 },
      ])
    ).toEqual({ weekdays: [1, 3, 5], startMinute: 1080, endMinute: 60 });
  });

  it('不合并不同星期或超过 24 小时的独立窗口', () => {
    expect(
      collapseRankedOpenWindows([
        { weekdays: [1], startMinute: 1080, endMinute: 1440 },
        { weekdays: [3], startMinute: 0, endMinute: 60 },
      ])
    ).toBeNull();
    expect(
      collapseRankedOpenWindows([
        { weekdays: [1], startMinute: 1080, endMinute: 1440 },
        { weekdays: [2], startMinute: 0, endMinute: 1200 },
      ])
    ).toBeNull();
  });

  it('跨日时段经过接口与表单转换后保持不变', () => {
    const formWindows = [{ weekdays: [7], startMinute: 1320, endMinute: 120 }];
    expect(prepareRankedOpenWindowsForForm(prepareRankedOpenWindowsForApi(formWindows))).toEqual(
      formWindows
    );
  });

  it('不可合并的多窗口经过表单往返后原样保留', () => {
    const complexWindows = [
      { weekdays: [1, 3], startMinute: 600, endMinute: 720 },
      { weekdays: [5], startMinute: 1080, endMinute: 1320 },
      { weekdays: [7], startMinute: 0, endMinute: 60 },
    ];
    expect(prepareRankedOpenWindowsForApi(prepareRankedOpenWindowsForForm(complexWindows))).toEqual(
      complexWindows
    );
  });

  it('拒绝非零点起止时间完全相同的窗口', () => {
    expect(() =>
      expandRankedOpenWindow({ weekdays: [1], startMinute: 1080, endMinute: 1080 })
    ).toThrow('开始与结束不能相同');
  });
});
