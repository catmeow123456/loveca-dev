import { useId, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Filter, Search } from 'lucide-react';
import { ActionButton, SelectMenu, TextInput } from '@/components/common';
import './match-record-filters.css';

export interface AdminActivityFilterOption {
  readonly value: string;
  readonly label: string;
}

export function AdminMatchRecordFiltersPanel({
  userQuery,
  playerAQuery,
  playerBQuery,
  onPlayerAQueryChange,
  onPlayerBQueryChange,
  rankedOnly = false,
  collapsible = false,
  dateFrom,
  dateTo,
  activity,
  activityOptions,
  activityOptionsError,
  appliedFilterCount,
  onUserQueryChange,
  onDateFromChange,
  onDateToChange,
  onActivityChange,
  onApply,
  onReset,
  disabled,
}: {
  userQuery: string;
  playerAQuery: string;
  playerBQuery: string;
  onPlayerAQueryChange: (value: string) => void;
  onPlayerBQueryChange: (value: string) => void;
  rankedOnly?: boolean;
  collapsible?: boolean;
  dateFrom: string;
  dateTo: string;
  activity: string;
  activityOptions: readonly AdminActivityFilterOption[];
  activityOptionsError: string | null;
  appliedFilterCount: number;
  onUserQueryChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onActivityChange: (value: string) => void;
  onApply: () => void;
  onReset: () => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  const detailsId = useId();
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const hasFilterValue = Boolean(
    activity ||
    userQuery.trim() ||
    playerAQuery.trim() ||
    playerBQuery.trim() ||
    dateFrom ||
    dateTo ||
    appliedFilterCount > 0
  );

  return (
    <form
      className="match-record-filters"
      aria-label="对局筛选"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        onApply();
        if (collapsible) {
          setExpanded(false);
          filterToggleRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <div className="match-record-filters-search">
        <label className="min-w-0">
          <span className="sr-only">搜索参与者或对局</span>
          <TextInput
            value={userQuery}
            onChange={(event) => onUserQueryChange(event.target.value)}
            type="search"
            autoComplete="off"
            maxLength={120}
            placeholder="用户名、房间号或对局 ID"
          />
        </label>
        <ActionButton type="submit" variant="secondary" disabled={disabled}>
          <Search size={14} aria-hidden="true" /> 查询
        </ActionButton>
      </div>

      <div className="match-record-filters-toolbar">
        {collapsible ? (
          <ActionButton
            ref={filterToggleRef}
            variant="ghost"
            size="compact"
            aria-label="筛选对局"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((current) => !current)}
          >
            <Filter size={14} aria-hidden="true" /> 筛选
            <ChevronDown size={14} aria-hidden="true" className={expanded ? 'rotate-180' : ''} />
          </ActionButton>
        ) : (
          <h3 className="text-sm font-semibold">筛选对局</h3>
        )}
        <span className="match-record-filters-applied" role="status">
          {appliedFilterCount > 0 ? `${appliedFilterCount} 项生效` : ''}
        </span>
        <ActionButton
          variant="ghost"
          size="compact"
          onClick={onReset}
          disabled={disabled || !hasFilterValue}
        >
          清空
        </ActionButton>
      </div>

      <div
        id={detailsId}
        className="match-record-filters-details"
        hidden={collapsible && !expanded}
      >
        <div className="match-record-filter-field">
          <span>{rankedOnly ? '排位赛季' : '所属活动'}</span>
          <SelectMenu
            label={rankedOnly ? '按排位赛季筛选' : '按所属活动筛选'}
            value={activity}
            options={[
              { value: '', label: rankedOnly ? '全部赛季' : '全部活动' },
              ...activityOptions,
            ]}
            onChange={onActivityChange}
            disabled={disabled}
            className="match-record-filters-activity"
          />
        </div>
        {activityOptionsError ? (
          <p className="match-record-filter-warning" role="status">
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{activityOptionsError}</span>
          </p>
        ) : null}

        <div className="match-record-filters-pair">
          <label className="match-record-filter-field">
            玩家 A
            <TextInput
              type="search"
              maxLength={120}
              placeholder="显示名或用户 ID"
              value={playerAQuery}
              onChange={(event) => onPlayerAQueryChange(event.target.value)}
            />
          </label>
          <label className="match-record-filter-field">
            玩家 B
            <TextInput
              type="search"
              maxLength={120}
              placeholder="显示名或用户 ID"
              value={playerBQuery}
              onChange={(event) => onPlayerBQueryChange(event.target.value)}
            />
          </label>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs text-[var(--text-secondary)]">开局日期</legend>
          <div className="match-record-filters-pair">
            <label className="match-record-filter-field">
              开始
              <TextInput
                value={dateFrom}
                onChange={(event) => onDateFromChange(event.target.value)}
                type="date"
                max={dateTo || undefined}
              />
            </label>
            <label className="match-record-filter-field">
              结束
              <TextInput
                value={dateTo}
                onChange={(event) => onDateToChange(event.target.value)}
                type="date"
                min={dateFrom || undefined}
              />
            </label>
          </div>
        </fieldset>
      </div>
    </form>
  );
}
