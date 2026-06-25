import { memo } from 'react';
import { cn } from '@/lib/utils';
import { HeartColor } from '@game/shared/types/enums';
import type { ViewMemberModifierDelta } from '@game/online';
import bladeIcon from '@/assets/modifier-icons/blade.png';
import costIcon from '@/assets/modifier-icons/cost.png';
import heartAllIcon from '@/assets/modifier-icons/heart_all.png';
import heartBlueIcon from '@/assets/modifier-icons/heart_blue.png';
import heartGreenIcon from '@/assets/modifier-icons/heart_green.png';
import heartPinkIcon from '@/assets/modifier-icons/heart_pink.png';
import heartPurpleIcon from '@/assets/modifier-icons/heart_purple.png';
import heartRedIcon from '@/assets/modifier-icons/heart_red.png';
import heartYellowIcon from '@/assets/modifier-icons/heart_yellow.png';

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
  HeartColor.RAINBOW,
] as const;

const HEART_ICON_BY_COLOR: Partial<Record<HeartColor, string>> = {
  [HeartColor.RED]: heartRedIcon,
  [HeartColor.PINK]: heartPinkIcon,
  [HeartColor.YELLOW]: heartYellowIcon,
  [HeartColor.GREEN]: heartGreenIcon,
  [HeartColor.BLUE]: heartBlueIcon,
  [HeartColor.PURPLE]: heartPurpleIcon,
  [HeartColor.RAINBOW]: heartAllIcon,
};

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

  if (costDelta === 0 && bladeDelta <= 0 && heartRows.length === 0) {
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
      {costDelta !== 0 ? <ModifierBadge iconSrc={costIcon} value={costDelta} /> : null}
      {bladeDelta > 0 ? <ModifierBadge iconSrc={bladeIcon} value={bladeDelta} /> : null}
      {heartRows.map((heart) => (
        <ModifierBadge
          key={heart.color}
          iconSrc={HEART_ICON_BY_COLOR[heart.color]}
          value={heart.count}
          fallback={heart.color === HeartColor.RAINBOW ? 'rainbow' : undefined}
        />
      ))}
    </div>
  );
});

interface ModifierBadgeProps {
  readonly iconSrc?: string;
  readonly value: number;
  readonly fallback?: 'rainbow';
}

const ModifierBadge = memo(function ModifierBadge({
  iconSrc,
  value,
  fallback,
}: ModifierBadgeProps) {
  return (
    <div
      className={cn(
        'flex h-5 min-w-10 items-center gap-0.5 rounded border border-white/50 bg-slate-950/65 pl-1 pr-1.5 shadow backdrop-blur',
        'md:h-6 md:min-w-11 md:gap-1 md:pr-2'
      )}
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className="h-4 w-4 object-contain" draggable={false} />
      ) : (
        <span
          className={cn(
            'inline-flex h-4 w-4 items-center justify-center text-[13px] leading-none',
            fallback === 'rainbow' &&
              'bg-linear-to-r from-red-400 via-yellow-300 to-blue-400 bg-clip-text text-transparent'
          )}
        >
          ♥
        </span>
      )}
      <span className="text-[10px] font-bold leading-none text-white drop-shadow md:text-[11px]">
        {value > 0 ? `+${value}` : `${value}`}
      </span>
    </div>
  );
});
