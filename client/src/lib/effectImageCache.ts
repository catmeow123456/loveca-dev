// Small card faces only. Large entrance portraits keep their existing download-only policy.
export const EFFECT_IMAGE_CACHE_LIMIT = 16;
export const EFFECT_IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
export const EFFECT_IMAGE_LOAD_TIMEOUT_MS = 120_000;
const CONCURRENCY = 2;

interface Entry {
  url: string;
  promise: Promise<HTMLImageElement>;
  resolve: (image: HTMLImageElement) => void;
  reject: (error: Error) => void;
  state: 'queued' | 'loading' | 'ready' | 'cancelled';
  foreground: boolean;
  image?: HTMLImageElement;
  bytes: number;
  cancel: () => void;
}

/** One match/viewer owns this bounded decoded working set; it never blocks game commands. */
export class EffectImageCache {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private running = new Set<Entry>();

  constructor(private makeImage: () => HTMLImageElement = () => new Image()) {}

  preload(urls: readonly string[]) {
    const wanted = new Set(urls.slice(0, EFFECT_IMAGE_CACHE_LIMIT));
    // Replace obsolete background work; never cancel an active presentation's request.
    for (const entry of this.queue) if (!entry.foreground && !wanted.has(entry.url)) entry.cancel();
    this.queue = this.queue.filter((entry) => entry.state === 'queued');
    for (const url of wanted) void this.request(url, false).catch(() => {});
  }

  load(url: string): Promise<HTMLImageElement> {
    return this.request(url, true);
  }

  clear() {
    this.queue = [];
    for (const entry of this.entries.values()) if (entry.state !== 'ready') entry.cancel();
    this.entries.clear();
  }

  private request(url: string, foreground: boolean): Promise<HTMLImageElement> {
    const existing = this.entries.get(url);
    if (existing) {
      this.entries.delete(url);
      this.entries.set(url, existing);
      if (foreground) {
        existing.foreground = true;
        if (existing.image) existing.image.fetchPriority = 'auto';
        if (existing.state === 'queued') {
          this.queue = [existing, ...this.queue.filter((entry) => entry !== existing)];
          this.prioritize();
        }
      }
      return existing.promise;
    }
    let resolve!: Entry['resolve'], reject!: Entry['reject'];
    const promise = new Promise<HTMLImageElement>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const entry: Entry = {
      url,
      promise,
      resolve,
      reject,
      foreground,
      bytes: 0,
      state: 'queued',
      cancel: () => {
        entry.state = 'cancelled';
        this.entries.delete(url);
        reject(new DOMException('Effect image released', 'AbortError'));
      },
    };
    this.entries.set(url, entry);
    if (foreground) this.queue.unshift(entry);
    else this.queue.push(entry);
    this.prioritize();
    return promise;
  }

  private prioritize() {
    // A slow speculative card must not consume the current presentation's 2-second budget.
    if (this.queue[0]?.foreground && this.running.size >= CONCURRENCY) {
      [...this.running].find((entry) => !entry.foreground)?.cancel();
    }
    this.pump();
  }

  private pump() {
    while (this.running.size < CONCURRENCY && this.queue.length) {
      const entry = this.queue.shift()!;
      if (entry.state !== 'queued') continue;
      entry.state = 'loading';
      this.running.add(entry);
      const image = this.makeImage();
      entry.image = image;
      image.fetchPriority = entry.foreground ? 'auto' : 'low';
      image.decoding = 'async';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.running.delete(entry);
        if (error) {
          entry.state = 'cancelled';
          image.removeAttribute('src');
          this.entries.delete(entry.url);
          entry.reject(error);
        } else {
          entry.state = 'ready';
          entry.bytes = image.naturalWidth * image.naturalHeight * 4;
          entry.resolve(image);
          this.trim();
        }
        this.pump();
      };
      entry.cancel = () => finish(new DOMException('Effect image released', 'AbortError'));
      const timer = setTimeout(
        () => finish(new Error('Effect image timeout')),
        EFFECT_IMAGE_LOAD_TIMEOUT_MS
      );
      image.src = entry.url;
      image.decode().then(
        () =>
          finish(
            image.naturalWidth && image.naturalHeight ? undefined : new Error('Empty effect image')
          ),
        () => finish(new Error('Effect image decode failed'))
      );
    }
  }

  private trim() {
    const ready = [...this.entries.values()].filter((entry) => entry.state === 'ready');
    let bytes = ready.reduce((total, entry) => total + entry.bytes, 0),
      count = ready.length;
    for (const entry of ready) {
      if (count <= EFFECT_IMAGE_CACHE_LIMIT && bytes <= EFFECT_IMAGE_CACHE_BYTES) break;
      this.entries.delete(entry.url);
      bytes -= entry.bytes;
      count--;
      // Drop only our reference. A current canvas presentation may still own this image.
    }
  }
}
