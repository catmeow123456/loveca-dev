import type { CardEntranceProfile } from './cardEntranceProfiles';

// Background preparation gets time to finish on slow links; playback keeps its own short deadline.
export const ENTRANCE_PRELOAD_TIMEOUT_MS = 120_000;
const pendingImages = new Map<string, Promise<void>>();

/** Keep only in-flight downloads. HTTP/SW caches retain files, not a permanent decoded-image map. */
function preloadImage(url: string): Promise<void> {
  const pending = pendingImages.get(url);
  if (pending) return pending;

  const work = new Promise<void>((resolve) => {
    const image = new Image();
    image.fetchPriority = 'low';
    image.decoding = 'async';
    const finish = () => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      resolve();
    };
    const timer = setTimeout(finish, ENTRANCE_PRELOAD_TIMEOUT_MS);
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
  }).finally(() => pendingImages.delete(url));
  pendingImages.set(url, work);
  return work;
}

/**
 * One profile at a time (portrait + optional eyes). Never gates a game command or playback.
 * Stop queues on disable/leave, but let the current bounded downloads finish for later games.
 * A presentation's abort must not cancel this separate Image consumer of the same cached URL.
 */
export function preloadEntranceProfiles(profiles: readonly CardEntranceProfile[]): () => void {
  let stopped = false;
  const unique = [...new Map(profiles.map((profile) => [profile.id, profile])).values()];
  const load = async (importArt: CardEntranceProfile['loadArt']) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const asset = await Promise.race([
        importArt(),
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => resolve(undefined), ENTRANCE_PRELOAD_TIMEOUT_MS);
        }),
      ]);
      if (asset && !stopped) await preloadImage(asset.default);
    } finally {
      clearTimeout(timeout);
    }
  };
  // Yield initial board work; there is deliberately no loading screen or awaited readiness gate.
  const timer = setTimeout(() => {
    if (stopped || !unique.length) return;
    void document.fonts
      .load('900 32px "Loveca Entrance"', unique.map((profile) => profile.name).join(''))
      .catch(() => {});
    void (async () => {
      for (const profile of unique) {
        if (stopped) break;
        // Failure of one asset cannot prevent the other profiles from being warmed.
        await Promise.allSettled([
          load(profile.loadArt),
          ...(profile.blink ? [load(profile.blink.loadArt)] : []),
        ]);
      }
    })();
  }, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
