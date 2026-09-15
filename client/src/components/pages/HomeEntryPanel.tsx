import { useState, type ComponentType } from 'react';
import { ArrowRight, LayoutGrid, RotateCcw } from 'lucide-react';
import {
  readHiddenHomeEntries,
  writeHiddenHomeEntries,
  type HomeEntryId,
} from '@/lib/homeEntryPreferences';

export interface HomeEntryAction {
  id: HomeEntryId;
  title: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tone: 'blue' | 'green' | 'warning' | 'muted';
}

export function HomeEntryPanel({ actions }: { actions: HomeEntryAction[] }) {
  const [isEditing, setIsEditing] = useState(false);
  const [hiddenEntries, setHiddenEntries] = useState(readHiddenHomeEntries);
  const [saveFailed, setSaveFailed] = useState(false);
  const visibleActions = actions.filter((action) => !hiddenEntries.includes(action.id));

  function save(next: HomeEntryId[]) {
    setHiddenEntries(next);
    setSaveFailed(!writeHiddenHomeEntries(next));
  }

  return (
    <aside className="lobby-entry-panel" aria-labelledby="home-entries-heading">
      <div className="lobby-entry-panel__header">
        <h2 id="home-entries-heading">
          <LayoutGrid size={17} aria-hidden="true" />
          常用入口
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={isEditing}
          aria-controls="home-entries"
          onClick={() => setIsEditing(!isEditing)}
          className="lobby-entry-edit"
        >
          自定义
          <span className="lobby-entry-edit__track" aria-hidden="true">
            <span />
          </span>
        </button>
      </div>
      <div id="home-entries">
        {isEditing ? (
          <fieldset className="lobby-entry-grid">
            <legend className="sr-only">选择首页显示的入口</legend>
            {actions.map((action) => {
              const isVisible = !hiddenEntries.includes(action.id);
              return (
                <label
                  key={action.id}
                  className="lobby-shortcut lobby-shortcut--choice"
                  data-selected={isVisible}
                >
                  <EntryCopy action={action} />
                  <span className="lobby-shortcut__selection">
                    <span aria-hidden="true">{isVisible ? '已显示' : '已隐藏'}</span>
                    <input
                      type="checkbox"
                      aria-label={`显示${action.title}`}
                      checked={isVisible}
                      onChange={() =>
                        save(
                          isVisible
                            ? [...hiddenEntries, action.id]
                            : hiddenEntries.filter((id) => id !== action.id)
                        )
                      }
                    />
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : visibleActions.length > 0 ? (
          <div className="lobby-entry-grid">
            {visibleActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="lobby-shortcut"
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={action.title}
                aria-describedby={
                  action.disabled && action.disabledReason
                    ? `home-entry-${action.id}-reason`
                    : undefined
                }
              >
                <EntryCopy action={action} />
                {!action.disabled && (
                  <ArrowRight className="lobby-shortcut__arrow" size={14} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="lobby-entry-empty">
            <LayoutGrid size={24} aria-hidden="true" />
            <strong>已隐藏所有常用入口</strong>
            <p>打开「自定义」，选择想显示的入口。</p>
          </div>
        )}
      </div>
      {isEditing && (
        <div className="lobby-entry-panel__footer">
          <span role="status">
            已显示 {visibleActions.length} / {actions.length} 项
          </span>
          <button
            type="button"
            className="lobby-entry-reset"
            disabled={hiddenEntries.length === 0}
            onClick={() => save([])}
          >
            <RotateCcw size={13} aria-hidden="true" />
            恢复默认
          </button>
        </div>
      )}
      {saveFailed && (
        <p className="lobby-entry-save-error" role="status">
          浏览器未能保存设置，刷新后可能丢失。请允许本站存储后重试。
        </p>
      )}
    </aside>
  );
}

function EntryCopy({ action }: { action: HomeEntryAction }) {
  const Icon = action.icon;
  return (
    <>
      <span className={`lobby-shortcut__icon lobby-shortcut__icon--${action.tone}`}>
        <Icon size={19} aria-hidden="true" />
      </span>
      <span className="lobby-shortcut__copy">
        <strong>{action.title}</strong>
        {action.disabled && action.disabledReason && (
          <span id={`home-entry-${action.id}-reason`}>{action.disabledReason}</span>
        )}
      </span>
    </>
  );
}
