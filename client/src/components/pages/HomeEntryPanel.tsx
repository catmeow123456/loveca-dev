import { useRef, useState, type ComponentType } from 'react';
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import {
  DEFAULT_HIDDEN_HOME_ENTRIES,
  DEFAULT_HOME_ENTRY_ORDER,
  readHiddenHomeEntries,
  readHomeEntryOrder,
  writeHiddenHomeEntries,
  writeHomeEntryOrder,
  type HomeEntryId,
} from '@/lib/homeEntryPreferences';
import { HomeDialog } from './HomeDialog';

export interface HomeEntryAction {
  id: HomeEntryId;
  title: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function HomeEntryPanel({ actions }: { actions: HomeEntryAction[] }) {
  const [hiddenEntries, setHiddenEntries] = useState(readHiddenHomeEntries);
  const [order, setOrder] = useState(readHomeEntryOrder);
  const [draft, setDraft] = useState<HomeEntryId[] | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const orderedActions = [...actions].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const visibleActions = orderedActions.filter((action) => !hiddenEntries.includes(action.id));
  const close = () => setDraft(null);

  function save() {
    if (!draft) return;
    const availableIds = actions.map((action) => action.id);
    const hidden = [
      ...hiddenEntries.filter((id) => !availableIds.includes(id)),
      ...availableIds.filter((id) => !draft.includes(id)),
    ];
    const nextOrder = [...draft, ...order.filter((id) => !draft.includes(id))];
    const hiddenSaved = writeHiddenHomeEntries(hidden);
    const orderSaved = writeHomeEntryOrder(nextOrder);
    setHiddenEntries(hidden);
    setOrder(nextOrder);
    setSaveFailed(!hiddenSaved || !orderSaved);
    close();
  }

  function move(id: HomeEntryId, direction: -1 | 1) {
    if (!draft) return;
    const index = draft.indexOf(id);
    const next = index + direction;
    if (next < 0 || next >= draft.length) return;
    const updated = [...draft];
    [updated[index], updated[next]] = [updated[next], updated[index]];
    setDraft(updated);
    if (next + direction < 0 || next + direction >= updated.length) {
      requestAnimationFrame(() =>
        editor.current?.querySelector<HTMLInputElement>(`input[value="${id}"]`)?.focus()
      );
    }
  }

  const editorActions =
    draft === null
      ? []
      : [
          ...draft.map((id) => actions.find((action) => action.id === id)!).filter(Boolean),
          ...orderedActions.filter((action) => !draft.includes(action.id)),
        ];

  return (
    <section className="lobby-entry-panel" aria-labelledby="home-entries-heading">
      <div className="lobby-section-heading">
        <h2 id="home-entries-heading">常用入口</h2>
        <button
          type="button"
          className="home-text-button"
          onClick={() => setDraft(visibleActions.map((action) => action.id))}
        >
          自定义
          <Pencil size={13} aria-hidden="true" />
        </button>
      </div>
      {visibleActions.length ? (
        <div className="lobby-entry-grid">
          {visibleActions.map(({ icon: Icon, ...action }) => (
            <button
              key={action.id}
              type="button"
              className="lobby-shortcut"
              onClick={action.onClick}
              disabled={action.disabled}
              aria-describedby={
                action.disabledReason ? `home-entry-${action.id}-reason` : undefined
              }
            >
              <Icon size={19} aria-hidden="true" />
              <span>
                <strong>{action.title}</strong>
                {action.disabled && action.disabledReason && (
                  <small id={`home-entry-${action.id}-reason`}>{action.disabledReason}</small>
                )}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="lobby-entry-empty">按你的习惯添加入口。</p>
      )}
      {saveFailed && (
        <p className="home-inline-warning" role="status">
          已应用到当前页面，浏览器未能保存设置。
        </p>
      )}
      {draft !== null && (
        <HomeDialog title="自定义常用入口" onClose={close}>
          <p className="home-dialog-intro">选择需要的入口，并调整显示顺序。</p>
          <div className="home-shortcut-editor" ref={editor}>
            {editorActions.map(({ id, title, icon: Icon }) => {
              const index = draft.indexOf(id);
              return (
                <div className="home-shortcut-row" key={id}>
                  <label>
                    <input
                      type="checkbox"
                      value={id}
                      checked={index >= 0}
                      onChange={(event) => {
                        setDraft(
                          event.target.checked
                            ? [...draft, id]
                            : draft.filter((value) => value !== id)
                        );
                      }}
                    />
                    <Icon size={18} aria-hidden="true" />
                    <span>{title}</span>
                  </label>
                  {index >= 0 && (
                    <div className="home-shortcut-order">
                      <button
                        type="button"
                        className="home-icon-button"
                        aria-label={`上移${title}`}
                        disabled={index === 0}
                        onClick={() => move(id, -1)}
                      >
                        <ChevronUp size={18} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="home-icon-button"
                        aria-label={`下移${title}`}
                        disabled={index === draft.length - 1}
                        onClick={() => move(id, 1)}
                      >
                        <ChevronDown size={18} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="home-shortcut-actions">
            <button
              type="button"
              className="home-text-button"
              onClick={() =>
                setDraft(
                  DEFAULT_HOME_ENTRY_ORDER.filter(
                    (id) =>
                      actions.some((action) => action.id === id) &&
                      !DEFAULT_HIDDEN_HOME_ENTRIES.includes(id)
                  )
                )
              }
            >
              恢复默认
            </button>
            <div>
              <button type="button" className="home-secondary-button" onClick={close}>
                取消
              </button>
              <button type="button" className="home-primary-button" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </HomeDialog>
      )}
    </section>
  );
}
