import {
  getRankedOpenWindowsValidationError,
  isCrossMidnightRankedOpenWindow,
  isEditableRankedOpenWindowValid,
  MAX_RANKED_OPEN_WINDOWS,
  type EditableRankedOpenWindow,
} from '@/lib/rankedOpenWindows';

export function SeasonOpenWindowsFields({
  openWindows,
  onChange,
}: {
  openWindows: EditableRankedOpenWindow[];
  onChange: (openWindows: EditableRankedOpenWindow[]) => void;
}) {
  const validationError = getRankedOpenWindowsValidationError(openWindows);
  return (
    <div className="grid gap-3 sm:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--text-primary)]">开放时段</span>
        <button
          type="button"
          className="button-secondary min-h-9 px-3 text-sm"
          disabled={openWindows.length >= MAX_RANKED_OPEN_WINDOWS}
          onClick={() =>
            onChange([...openWindows, { weekdays: [1], startMinute: 1080, endMinute: 1320 }])
          }
        >
          添加开放时段
        </button>
      </div>
      {openWindows.map((openWindow, index) => (
        <section
          key={index}
          aria-label={`开放时段 ${index + 1}`}
          className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3 sm:grid-cols-2"
        >
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              开放时段 {index + 1}
            </span>
            {openWindows.length > 1 ? (
              <button
                type="button"
                className="text-sm text-[var(--semantic-error)]"
                onClick={() => onChange(openWindows.filter((_, itemIndex) => itemIndex !== index))}
              >
                删除此时段
              </button>
            ) : null}
          </div>
          <OpenWindowFields
            openWindow={openWindow}
            onChange={(nextOpenWindow) =>
              onChange(
                openWindows.map((item, itemIndex) => (itemIndex === index ? nextOpenWindow : item))
              )
            }
          />
        </section>
      ))}
      {validationError ? (
        <p className="text-sm text-[var(--semantic-error)]">{validationError}</p>
      ) : null}
    </div>
  );
}

function OpenWindowFields({
  openWindow,
  onChange,
}: {
  openWindow?: EditableRankedOpenWindow;
  onChange: (openWindow: EditableRankedOpenWindow) => void;
}) {
  const current = openWindow ?? {
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    startMinute: 0,
    endMinute: 1440,
  };
  const crossesMidnight = isCrossMidnightRankedOpenWindow(current);
  const isValid = isEditableRankedOpenWindowValid(current);
  return (
    <>
      <Field label="每日开放">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <input
            type="time"
            aria-label="开始时间"
            className="input-field"
            value={minuteToTime(current.startMinute)}
            onChange={(event) =>
              onChange({ ...current, startMinute: timeToMinute(event.target.value) })
            }
          />
          <span className="whitespace-nowrap">—{crossesMidnight ? ' 次日' : ''}</span>
          <input
            type="time"
            aria-label="结束时间"
            className="input-field"
            value={minuteToTime(current.endMinute, true)}
            onChange={(event) =>
              onChange({ ...current, endMinute: timeToMinute(event.target.value, true) })
            }
          />
        </div>
        {!isValid ? (
          <span className="text-xs text-[var(--semantic-error)]">
            开始与结束时间不能相同。如需全天开放，请设为 00:00–00:00。
          </span>
        ) : null}
      </Field>
      <Field label="开放日">
        <div className="grid grid-cols-7 gap-1">
          {['一', '二', '三', '四', '五', '六', '日'].map((label, index) => {
            const weekday = index + 1;
            const selected = current.weekdays.includes(weekday);
            return (
              <button
                key={weekday}
                type="button"
                className={`h-9 rounded-lg text-xs ${
                  selected
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                }`}
                onClick={() => {
                  const weekdays = selected
                    ? current.weekdays.filter((value) => value !== weekday)
                    : [...current.weekdays, weekday].sort();
                  if (weekdays.length > 0) onChange({ ...current, weekdays });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
      {label}
      {children}
    </label>
  );
}

function minuteToTime(minute: number, isEnd = false) {
  const normalized = isEnd && minute === 1440 ? 0 : minute;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function timeToMinute(value: string, isEnd = false) {
  const [hour = '0', minute = '0'] = value.split(':');
  const total = Number(hour) * 60 + Number(minute);
  return isEnd && total === 0 ? 1440 : total;
}
