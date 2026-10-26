import { useLayoutEffect, useRef } from 'react';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import {
  flowerClamp,
  ginkoFlowerTimeline,
  type AbilityTransferSource,
} from '@/lib/ginkoFlowerTransfer';

/** A local receipt that can outlive the animation's ACK, without owning any interaction barrier. */
export function GinkoTransferNotice({
  source,
  reduced,
  onDone,
}: {
  source: AbilityTransferSource;
  reduced: boolean;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const label = root.current!;
    const startedAt = performance.now();
    const { hold, fade } = ginkoFlowerTimeline.notice;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const target = collectBattleAnimationAnchors().cards.get(source.hostObjectId);
      if (elapsed >= hold + fade || !target?.width) {
        onDone();
        return;
      }
      const halfWidth = label.offsetWidth / 2;
      label.style.left = `${Math.max(halfWidth + 10, Math.min(window.innerWidth - halfWidth - 10, target.left + target.width / 2))}px`;
      label.style.top = `${Math.min(window.innerHeight - 64, target.top + target.height + 34)}px`;
      label.style.opacity = reduced ? '1' : String(1 - flowerClamp((elapsed - hold) / fade));
      raf = requestAnimationFrame(tick);
    };
    tick(startedAt);
    return () => cancelAnimationFrame(raf);
  }, [source, reduced, onDone]);

  return (
    <div ref={root} className="ginko-transfer-received" role="status">
      获得【登场】<span>· {source.name}</span>
    </div>
  );
}
