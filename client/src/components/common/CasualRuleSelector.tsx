import { useId } from 'react';
import { Infinity, Layers3 } from 'lucide-react';
import type { CasualRuleMode } from '@game/online/casual-table-types';
import { casualRuleName } from '@/lib/casualRules';
import './casual-rule-selector.css';

export function CasualRuleMark({ mode }: { mode: CasualRuleMode }) {
  const Icon = mode === 'UNLIMITED' ? Infinity : Layers3;
  return (
    <span className={`casual-rule-mark casual-rule-${mode.toLowerCase()}`} aria-hidden="true">
      <Icon size={20} strokeWidth={1.8} />
    </span>
  );
}

export function CasualRuleBadge({
  mode,
  showMark = true,
}: {
  mode: CasualRuleMode;
  showMark?: boolean;
}) {
  return (
    <span className={`casual-rule-badge ${mode === 'UNLIMITED' ? 'casual-rule-unlimited' : ''}`}>
      {showMark && <CasualRuleMark mode={mode} />}
      {casualRuleName(mode)}
      {mode === 'UNLIMITED' ? ' · PT 不限' : ''}
    </span>
  );
}

export function CasualRuleSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: CasualRuleMode;
  onChange: (mode: CasualRuleMode) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="casual-rule-selector" disabled={disabled}>
      <legend>自组对战规则</legend>
      <div className="casual-rule-options">
        {(['NORMAL', 'UNLIMITED'] as const).map((mode) => (
          <label
            key={mode}
            className={`casual-rule-option casual-rule-${mode.toLowerCase()} ${value === mode ? 'is-selected' : ''}`}
          >
            <input
              type="radio"
              name={name}
              aria-label={`${casualRuleName(mode)}${mode === 'UNLIMITED' ? ' PT 不限' : ''}`}
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
            />
            <CasualRuleMark mode={mode} />
            <span>{casualRuleName(mode)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
