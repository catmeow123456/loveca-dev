export interface RankedOpenWindowValue {
  readonly weekdays: readonly number[];
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface EditableRankedOpenWindow {
  weekdays: number[];
  startMinute: number;
  endMinute: number;
}

const MINUTES_PER_DAY = 24 * 60;

export function expandRankedOpenWindow(
  window: EditableRankedOpenWindow
): EditableRankedOpenWindow[] {
  const weekdays = normalizeWeekdays(window.weekdays);
  if (window.startMinute === 0 && window.endMinute === 0) {
    return [{ weekdays, startMinute: 0, endMinute: MINUTES_PER_DAY }];
  }
  if (window.startMinute === window.endMinute) {
    throw new Error('排位开放时间的开始与结束不能相同');
  }
  if (window.endMinute > window.startMinute) {
    return [{ ...window, weekdays }];
  }
  return [
    {
      weekdays,
      startMinute: window.startMinute,
      endMinute: MINUTES_PER_DAY,
    },
    {
      weekdays: shiftWeekdays(weekdays),
      startMinute: 0,
      endMinute: window.endMinute,
    },
  ];
}

export function collapseRankedOpenWindows(
  windows: readonly RankedOpenWindowValue[]
): EditableRankedOpenWindow | null {
  if (windows.length === 1) {
    const [window] = windows;
    return {
      weekdays: normalizeWeekdays(window.weekdays),
      startMinute: window.startMinute,
      endMinute: window.endMinute,
    };
  }
  if (windows.length !== 2) {
    return null;
  }

  const lateWindow = windows.find(
    (window) => window.startMinute > 0 && window.endMinute === MINUTES_PER_DAY
  );
  const earlyWindow = windows.find(
    (window) =>
      window.startMinute === 0 && window.endMinute > 0 && window.endMinute < MINUTES_PER_DAY
  );
  if (!lateWindow || !earlyWindow) {
    return null;
  }

  const weekdays = normalizeWeekdays(lateWindow.weekdays);
  if (
    earlyWindow.endMinute >= lateWindow.startMinute ||
    !sameWeekdays(shiftWeekdays(weekdays), normalizeWeekdays(earlyWindow.weekdays))
  ) {
    return null;
  }
  return {
    weekdays,
    startMinute: lateWindow.startMinute,
    endMinute: earlyWindow.endMinute,
  };
}

export function prepareRankedOpenWindowsForForm(
  windows: readonly RankedOpenWindowValue[]
): EditableRankedOpenWindow[] {
  const collapsed = collapseRankedOpenWindows(windows);
  return collapsed
    ? [collapsed]
    : windows.map((window) => ({
        weekdays: [...window.weekdays],
        startMinute: window.startMinute,
        endMinute: window.endMinute,
      }));
}

export function prepareRankedOpenWindowsForApi(
  windows: readonly EditableRankedOpenWindow[]
): EditableRankedOpenWindow[] {
  return windows.length === 1
    ? expandRankedOpenWindow(windows[0])
    : windows.map((window) => ({ ...window, weekdays: [...window.weekdays] }));
}

export function isCrossMidnightRankedOpenWindow(window: RankedOpenWindowValue): boolean {
  return window.endMinute < window.startMinute;
}

export function isEditableRankedOpenWindowValid(window: RankedOpenWindowValue): boolean {
  return window.startMinute !== window.endMinute || window.startMinute === 0;
}

function shiftWeekdays(weekdays: readonly number[]): number[] {
  return normalizeWeekdays(weekdays.map((weekday) => (weekday === 7 ? 1 : weekday + 1)));
}

function normalizeWeekdays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays)].sort((left, right) => left - right);
}

function sameWeekdays(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((weekday, index) => weekday === right[index]);
}
