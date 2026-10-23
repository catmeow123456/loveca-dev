import { useEffect, useRef, useState } from 'react';
import { BokuhikaScene } from './BokuhikaScene';
import { BOKUHIKA_SUCCESS_DURATION, type BokuhikaContribution } from './bokuhikaCast';
import { bokuhikaSongImage, bokuhikaPortraitImage } from './bokuhikaAssets';

/** Only owns playback; the shared barrier acknowledges it without submitting an effect confirmation. */
export function BokuhikaPlayback({
  contribution,
  reduced,
  onDone,
}: {
  contribution: BokuhikaContribution;
  reduced: boolean;
  onDone: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!ready) return;
    const start = performance.now();
    const duration = reduced ? 550 : BOKUHIKA_SUCCESS_DURATION;
    let raf = 0;
    const tick = (now: number) => {
      if (now - start >= duration) {
        done.current();
        return;
      }
      setElapsed(reduced ? 1950 : now - start);
      raf = requestAnimationFrame(tick);
    };
    tick(start);
    return () => cancelAnimationFrame(raf);
  }, [ready, reduced]);
  return (
    <div className="bokuhika-playback" role="status" aria-label="仆光 LIVE 成功演出">
      <BokuhikaScene
        imageUrl={bokuhikaSongImage}
        portraitUrl={bokuhikaPortraitImage}
        contribution={contribution}
        elapsed={reduced ? 1950 : elapsed}
        reducedMotion={reduced}
        onReady={() => setReady(true)}
      />
      <button
        className="card-entrance-skip"
        onClick={(event) => {
          event.stopPropagation();
          done.current();
        }}
      >
        跳过演出
      </button>
    </div>
  );
}
