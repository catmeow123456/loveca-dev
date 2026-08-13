import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface MatchEmoteVisualResource {
  readonly staticImageUrl: string;
  readonly animatedImageUrl: string | null;
  readonly assetRevision: string;
}

interface MatchEmoteVisualProps {
  readonly emote: MatchEmoteVisualResource;
  readonly className?: string;
}

export function MatchEmoteVisual({ emote, className }: MatchEmoteVisualProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const [isVisible, setIsVisible] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
  const [failedAnimationKey, setFailedAnimationKey] = useState<string | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry?.isIntersecting === true),
      { threshold: 0.05 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const handleVisibilityChange = () => setIsPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const animationKey = `${emote.assetRevision}:${emote.animatedImageUrl ?? ''}`;

  const shouldAnimate =
    Boolean(emote.animatedImageUrl) &&
    reduceMotion !== true &&
    isVisible &&
    isPageVisible &&
    failedAnimationKey !== animationKey;
  const src = shouldAnimate ? emote.animatedImageUrl! : emote.staticImageUrl;

  return (
    <span ref={rootRef} className={cn('match-emote-visual', className)} aria-hidden="true">
      <img
        key={src}
        src={src}
        alt=""
        draggable={false}
        decoding="async"
        onError={() => {
          if (shouldAnimate) {
            setFailedAnimationKey(animationKey);
          }
        }}
        className="block h-full w-full object-contain"
      />
    </span>
  );
}
