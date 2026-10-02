import type { CardEntranceProfile } from './cardEntranceProfiles';

export const ENTRANCE_LOAD_TIMEOUT_MS = 2000;
/** No permanent decoded-image cache: browsers cache URLs; each presentation releases its images. */
export async function prepareEntranceAssets(
  profile: CardEntranceProfile,
  cardUrl: string | null,
  signal: AbortSignal,
  makeImage: () => HTMLImageElement = () => new Image()
): Promise<{ portrait: HTMLImageElement; card: HTMLImageElement | null }> {
  const pendingImages: HTMLImageElement[] = [];
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void = () => {};
  let stopped = false;
  const abortError = () => new DOMException('Entrance cancelled', 'AbortError');
  const guard = () => {
    if (stopped || signal.aborted) throw abortError();
  };
  const load = async (url: string) => {
    guard();
    const image = makeImage();
    pendingImages.push(image);
    image.src = url;
    await image.decode();
    guard();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty entrance image');
    return image;
  };
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new Error('Entrance asset timeout')), ENTRANCE_LOAD_TIMEOUT_MS);
  });
  try {
    guard();
    return await Promise.race([
      Promise.all([
        profile.loadArt().then(({ default: url }) => load(url)),
        cardUrl ? load(cardUrl) : Promise.resolve(null),
      ]).then(([portrait, card]) => ({ portrait, card })),
      interrupted,
    ]);
  } catch (error) {
    for (const image of pendingImages) image.removeAttribute('src');
    throw error;
  } finally {
    stopped = true;
    clearTimeout(timer!);
    signal.removeEventListener('abort', abort);
  }
}
