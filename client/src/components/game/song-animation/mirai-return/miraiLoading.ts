import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import type { EffectImageCache } from '@/lib/effectImageCache';
/** This queue belongs only to Mirai; failure cannot cancel another animation's assets. */
export function prepareMiraiImages(
  images: Pick<EffectImageCache, 'load' | 'clear'>,
  urls: readonly string[],
  signal: AbortSignal
): Promise<HTMLImageElement[]> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const end = (error?: Error, loaded?: HTMLImageElement[]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        images.clear();
        reject(error);
      } else resolve(loaded!);
    };
    const abort = () => end(new DOMException('Mirai presentation cancelled', 'AbortError'));
    const timer = setTimeout(
      () => end(new Error('Mirai assets timeout')),
      ENTRANCE_LOAD_TIMEOUT_MS
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else
      Promise.all(urls.map((url) => images.load(url))).then(
        (loaded) => end(undefined, loaded),
        () => end(new Error('Mirai asset unavailable'))
      );
  });
}
