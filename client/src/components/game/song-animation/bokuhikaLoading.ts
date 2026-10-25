import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import type { EffectImageCache } from '@/lib/effectImageCache';

/** The caller owns a song-only cache, so cancellation cannot interrupt another card's images. */
export function prepareBokuhikaImages(
  images: EffectImageCache,
  urls: readonly string[],
  signal: AbortSignal,
  renderedPortraits: Promise<void>
): Promise<HTMLImageElement[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, loaded?: HTMLImageElement[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        images.clear();
        reject(error);
      } else resolve(loaded!);
    };
    const abort = () => finish(new DOMException('Bokuhika cancelled', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('Bokuhika assets timeout')),
      ENTRANCE_LOAD_TIMEOUT_MS
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else
      Promise.all([Promise.all(urls.map((url) => images.load(url))), renderedPortraits]).then(
        ([loaded]) => finish(undefined, loaded),
        () => finish(new Error('Bokuhika asset decode failed'))
      );
  });
}
