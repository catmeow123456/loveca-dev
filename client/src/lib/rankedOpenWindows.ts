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
export const MAX_RANKED_OPEN_WINDOWS = 32;

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
  const consumedIndexes = new Set<number>();
  const editableWindows: EditableRankedOpenWindow[] = [];

  windows.forEach((window, index) => {
    if (consumedIndexes.has(index)) return;

    let collapsed: EditableRankedOpenWindow | null = null;
    for (let candidateIndex = index + 1; candidateIndex < windows.length; candidateIndex += 1) {
      if (consumedIndexes.has(candidateIndex)) continue;
      collapsed = collapseRankedOpenWindows([window, windows[candidateIndex]]);
      if (collapsed) {
        consumedIndexes.add(candidateIndex);
        break;
      }
    }

    editableWindows.push(
      collapsed ?? {
        weekdays: [...window.weekdays],
        startMinute: window.startMinute,
        endMinute: window.endMinute,
      }
    );
  });

  return editableWindows;
}

export function prepareRankedOpenWindowsForApi(
  windows: readonly EditableRankedOpenWindow[]
): EditableRankedOpenWindow[] {
  return windows.flatMap(expandRankedOpenWindow);
}

export function isCrossMidnightRankedOpenWindow(window: RankedOpenWindowValue): boolean {
  return window.endMinute < window.startMinute;
}

export function isEditableRankedOpenWindowValid(window: RankedOpenWindowValue): boolean {
  return window.startMinute !== window.endMinute || window.startMinute === 0;
}

export function getRankedOpenWindowsValidationError(
  windows: readonly EditableRankedOpenWindow[]
): string | null {
  if (windows.length === 0) {
    return '至少需要一个开放时段。';
  }

  for (const window of windows) {
    if (
      window.weekdays.length === 0 ||
      window.weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7)
    ) {
      return '每个开放时段至少需要选择一个有效开放日。';
    }
    if (
      !Number.isInteger(window.startMinute) ||
      !Number.isInteger(window.endMinute) ||
      window.startMinute < 0 ||
      window.startMinute >= MINUTES_PER_DAY ||
      window.endMinute < 0 ||
      window.endMinute > MINUTES_PER_DAY
    ) {
      return '开放时间必须在 00:00–24:00 范围内。';
    }
    if (!isEditableRankedOpenWindowValid(window)) {
      return '开始与结束时间不能相同。如需全天开放，请设为 00:00–00:00。';
    }
  }

  const expandedWindows = prepareRankedOpenWindowsForApi(windows);
  if (expandedWindows.length > MAX_RANKED_OPEN_WINDOWS) {
    return `拆分跨日时段后最多允许 ${MAX_RANKED_OPEN_WINDOWS} 个开放窗口。`;
  }

  const occupiedMinutes = new Set<number>();
  for (const window of expandedWindows) {
    for (const weekday of window.weekdays) {
      for (let minute = window.startMinute; minute < window.endMinute; minute += 1) {
        const key = weekday * MINUTES_PER_DAY + minute;
        if (occupiedMinutes.has(key)) {
          return '开放时段之间不能重叠。';
        }
        occupiedMinutes.add(key);
      }
    }
  }
  return null;
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
