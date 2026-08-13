import { memo, type CSSProperties } from 'react';
import { getDeckBackUrl } from '@/lib/imageService';
import { cn } from '@/lib/utils';
import type { WallpaperFocus } from '@game/online/player-wallpaper-types';

interface BoardBackgroundProps {
  readonly sourceUrl?: string | null;
  readonly solidColor?: string | null;
  readonly focus?: WallpaperFocus;
  readonly isCustom?: boolean;
  readonly theme?: 'light' | 'dark';
  readonly className?: string;
}

const CENTER_FOCUS: WallpaperFocus = { x: 0.5, y: 0.5 };

export const BoardBackground = memo(function BoardBackground({
  sourceUrl = null,
  solidColor = null,
  focus = CENTER_FOCUS,
  isCustom = false,
  theme,
  className,
}: BoardBackgroundProps) {
  const hasCustomWallpaper = isCustom || !!sourceUrl || !!solidColor;
  const backgroundStyle = (url: string, backgroundFocus: WallpaperFocus): CSSProperties => ({
    backgroundImage: `url(${url})`,
    backgroundSize: 'cover',
    backgroundPosition: `${backgroundFocus.x * 100}% ${backgroundFocus.y * 100}%`,
    backgroundRepeat: 'no-repeat',
  });

  return (
    <div
      aria-hidden="true"
      data-board-background-theme={theme}
      className={cn(
        'board-background pointer-events-none absolute inset-0 overflow-hidden bg-[var(--board-wallpaper-base)]',
        className
      )}
    >
      <div className="absolute inset-0" style={backgroundStyle(getDeckBackUrl(), CENTER_FOCUS)} />
      {solidColor ? (
        <div
          data-board-solid-wallpaper="true"
          className="absolute inset-0"
          style={{ backgroundColor: solidColor }}
        />
      ) : null}
      {sourceUrl ? (
        <div
          data-board-custom-wallpaper="true"
          className="absolute inset-0"
          style={backgroundStyle(sourceUrl, focus)}
        />
      ) : null}
      <div
        className={cn(
          'absolute inset-0',
          hasCustomWallpaper
            ? 'board-background-custom-overlay bg-[var(--board-wallpaper-overlay)]'
            : 'bg-[color:color-mix(in_srgb,var(--board-overlay)_42%,transparent)] md:bg-[var(--board-overlay)]'
        )}
      />
      <div className="absolute inset-0" style={{ background: 'var(--gradient-spotlight)' }} />
      <div className="absolute inset-0" style={{ background: 'var(--gradient-stage-glow)' }} />
    </div>
  );
});
