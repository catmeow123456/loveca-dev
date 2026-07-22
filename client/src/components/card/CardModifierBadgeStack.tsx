import { memo } from 'react';
import { cn } from '@/lib/utils';
import { HeartColor } from '@game/shared/types/enums';
import type { ViewMemberModifierDelta } from '@game/online';
import { HEART_ICON_SOURCE_BY_COLOR, MODIFIER_ICON_SOURCE } from '@/lib/modifierIconAssets';

interface CardModifierBadgeStackProps {
  readonly modifierDelta?: ViewMemberModifierDelta;
  readonly className?: string;
}

const HEART_COLOR_ORDER = [
  HeartColor.RED,
  HeartColor.PINK,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
  HeartColor.GRAY,
  HeartColor.RAINBOW,
] as const;

export const CardModifierBadgeStack = memo(function CardModifierBadgeStack({
  modifierDelta,
  className,
}: CardModifierBadgeStackProps) {
  const costDelta = modifierDelta?.costDelta ?? 0;
  const bladeDelta = modifierDelta?.bladeDelta ?? 0;
  const heartDeltaByColor = new Map<HeartColor, number>();

  for (const heartDelta of modifierDelta?.heartDeltas ?? []) {
    if (heartDelta.count !== 0) {
      heartDeltaByColor.set(
        heartDelta.color,
        (heartDeltaByColor.get(heartDelta.color) ?? 0) + heartDelta.count
      );
    }
  }

  const heartRows = HEART_COLOR_ORDER.map((color) => ({
    color,
    count: heartDeltaByColor.get(color) ?? 0,
  })).filter((row) => row.count !== 0);

  if (costDelta === 0 && bladeDelta === 0 && heartRows.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute right-full top-1 z-30 mr-0 flex flex-col gap-1 md:mr-1',
        className
      )}
      aria-hidden="true"
    >
      {costDelta !== 0 ? (
        <ModifierBadge iconSrc={MODIFIER_ICON_SOURCE.cost} value={costDelta} />
      ) : null}
      {bladeDelta !== 0 ? (
        <ModifierBadge iconSrc={MODIFIER_ICON_SOURCE.blade} value={bladeDelta} />
      ) : null}
      {heartRows.map((heart) => (
        <ModifierBadge
          key={heart.color}
          iconSrc={HEART_ICON_SOURCE_BY_COLOR[heart.color]}
          value={heart.count}
        />
      ))}
    </div>
  );
});

interface ModifierBadgeProps {
  readonly iconSrc: string;
  readonly value: number;
}

const ModifierBadge = memo(function ModifierBadge({ iconSrc, value }: ModifierBadgeProps) {
  return (
    <div
      className={cn(
        'flex h-5 min-w-10 items-center gap-0.5 rounded border border-white/50 bg-slate-950/65 pl-1 pr-1.5 shadow backdrop-blur',
        'md:h-6 md:min-w-11 md:gap-1 md:pr-2'
      )}
    >
      <img src={iconSrc} alt="" className="h-4 w-4 object-contain" draggable={false} />
      <span className="text-[10px] font-bold leading-none text-white drop-shadow md:text-[11px]">
        {value > 0 ? `+${value}` : `${value}`}
      </span>
    </div>
  );
});
