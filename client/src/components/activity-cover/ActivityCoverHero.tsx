import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ActivityCoverPublicView } from '@game/online/activity-cover-types';
import { cn } from '@/lib/utils';
import './activity-cover.css';

export function ActivityCoverHero({
  activityKey,
  cover,
  variant,
  children,
  className,
}: {
  readonly activityKey: string;
  readonly cover: ActivityCoverPublicView;
  readonly variant: 'ranked' | 'theme';
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const compact = useCompactCoverSlot();
  const slot = compact ? 'compact' : 'wide';
  const asset = compact ? cover.compact : cover.wide;
  const resourceKey = `${activityKey}:${cover.revision}:${slot}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const hasCustomCover = cover.mode === 'CUSTOM' && asset;
  const imageReady = loadedKey === resourceKey;

  return (
    <section
      className={cn(
        'activity-cover-hero',
        `activity-cover-hero--${variant}`,
        imageReady && 'is-image-ready',
        className
      )}
      data-cover-mask={cover.maskLevel.toLowerCase()}
      data-cover-revision={cover.revision}
    >
      <div className="activity-cover-hero__fallback" aria-hidden="true" />
      {hasCustomCover ? (
        <div className="activity-cover-hero__media" aria-hidden="true">
          <img
            key={resourceKey}
            src={asset.url}
            alt=""
            decoding="async"
            style={
              {
                '--cover-focus': `${asset.focus.x * 100}% ${asset.focus.y * 100}%`,
              } as CSSProperties
            }
            onLoad={() => setLoadedKey(resourceKey)}
            onError={() => setLoadedKey(null)}
          />
        </div>
      ) : null}
      <div className="activity-cover-hero__mask" aria-hidden="true" />
      {children}
    </section>
  );
}

function useCompactCoverSlot(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 719px)').matches
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 719px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}
