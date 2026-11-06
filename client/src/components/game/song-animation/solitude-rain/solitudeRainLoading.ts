import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import type { EffectImageCache } from '@/lib/effectImageCache';

/** Dedicated bounded cache: abort/timeout cannot disturb other songs' resources. */
export function prepareSolitudeRainImages(
  cache: Pick<EffectImageCache, 'load' | 'clear'>,
  urls: readonly string[],
  signal: AbortSignal
): Promise<HTMLImageElement[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const end = (error?: Error, images?: HTMLImageElement[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        cache.clear();
        reject(error);
      } else resolve(images!);
    };
    const abort = () => end(new DOMException('Solitude Rain cancelled', 'AbortError'));
    const timer = setTimeout(
      () => end(new Error('Solitude Rain assets timeout')),
      ENTRANCE_LOAD_TIMEOUT_MS
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else
      Promise.all(urls.map((url) => cache.load(url))).then(
        (images) => end(undefined, images),
        () => end(new Error('Solitude Rain image unavailable'))
      );
  });
}
