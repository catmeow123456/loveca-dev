import { Disclosure } from '@/components/common';
import {
  HEXTECH_DEFINITIONS,
  HEXTECH_RARITY_LABELS,
  type HextechId,
} from '@game/domain/hextech/catalog';
import type { InitialHextechSetup } from '@game/domain/hextech/state';

export function InitialHextechPicker({
  value,
  onChange,
  disabled,
}: {
  value: InitialHextechSetup;
  onChange: (value: InitialHextechSetup) => void;
  disabled: boolean;
}) {
  const count = value[0].length + value[1].length;
  const toggle = (seat: 0 | 1, id: HextechId) => {
    const selected = value[seat].includes(id)
      ? value[seat].filter((item) => item !== id)
      : [...value[seat], id];
    onChange(seat === 0 ? [selected, value[1]] : [value[0], selected]);
  };
  return (
    <Disclosure
      summary={`海克斯测试${count ? ` · 已选 ${count} 项` : ' · 未启用'}`}
      className="my-3"
    >
      <p className="mb-3 text-sm text-[var(--text-secondary)]">
        双方完成换牌后取得所选海克斯。此配置仅用于本地双人调试。
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {([0, 1] as const).map((seat) => (
          <fieldset key={seat} disabled={disabled} className="min-w-0">
            <legend className="mb-2 font-bold">Player {seat + 1} 的海克斯</legend>
            <div className="grid gap-1">
              {HEXTECH_DEFINITIONS.map((definition) => (
                <label
                  key={definition.id}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-default)] p-2"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={value[seat].includes(definition.id)}
                    onChange={() => toggle(seat, definition.id)}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">
                      {HEXTECH_RARITY_LABELS[definition.rarity]} · {definition.name}
                    </span>
                    <span className="block text-[var(--text-secondary)]">
                      {definition.rulesText}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Disclosure>
  );
}
