import { BoardBackground } from '@/components/game/BoardBackground';
import { cn } from '@/lib/utils';
import type { WallpaperFocus, WallpaperLayout } from '@game/online/player-wallpaper-types';

interface WallpaperTablePreviewProps {
  readonly layout: WallpaperLayout;
  readonly sourceUrl: string | null;
  readonly solidColor: string | null;
  readonly focus: WallpaperFocus;
  readonly theme: 'light' | 'dark';
  readonly label: string;
  readonly className?: string;
}

export function WallpaperTablePreview({
  layout,
  sourceUrl,
  solidColor,
  focus,
  theme,
  label,
  className,
}: WallpaperTablePreviewProps) {
  const compact = layout === 'COMPACT';
  return (
    <figure className={cn('min-w-0', className)}>
      <figcaption className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
        <span>{label}</span>
        <span className="font-mono text-[10px] font-normal text-[var(--text-muted)]">
          {compact ? '9:16' : '16:9'}
        </span>
      </figcaption>
      <div
        data-wallpaper-preview-layout={layout}
        className={cn(
          'relative isolate overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--board-wallpaper-base)] shadow-[var(--shadow-md)]',
          compact ? 'mx-auto aspect-[9/16] max-h-[360px]' : 'aspect-video w-full'
        )}
      >
        <BoardBackground
          sourceUrl={sourceUrl}
          solidColor={solidColor}
          focus={focus}
          isCustom={!!sourceUrl || !!solidColor}
          theme={theme}
        />
        <div className="pointer-events-none absolute inset-[8%] z-10 rounded-lg border border-dashed border-[color:color-mix(in_srgb,var(--brand-card-white)_38%,transparent)]" />
        <div
          className={cn(
            'absolute inset-0 z-10 grid p-[7%]',
            compact ? 'grid-rows-[1fr_auto_1fr] gap-[5%]' : 'grid-cols-[1fr_auto_1fr] gap-[4%]'
          )}
        >
          <PreviewSeat compact={compact} muted />
          <div
            className={cn(
              'self-center rounded-full border border-[color:color-mix(in_srgb,var(--brand-card-white)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--brand-stage-ink)_58%,transparent)] text-center text-[8px] font-semibold text-white backdrop-blur-sm',
              compact ? 'justify-self-center px-2 py-1' : 'px-2 py-1.5'
            )}
          >
            LIVE
          </div>
          <PreviewSeat compact={compact} />
        </div>
      </div>
    </figure>
  );
}

function PreviewSeat({ compact, muted = false }: { compact: boolean; muted?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-[4%] rounded-lg border border-[color:color-mix(in_srgb,var(--brand-card-white)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--brand-stage-ink)_28%,transparent)] p-[5%] backdrop-blur-[1px]',
        compact && 'flex-row',
        muted && 'opacity-75'
      )}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="aspect-[5/7] max-h-full min-h-4 flex-1 rounded-[3px] border border-[color:color-mix(in_srgb,var(--brand-card-white)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--brand-card-white)_32%,var(--brand-coral))] shadow-sm"
        />
      ))}
    </div>
  );
}
