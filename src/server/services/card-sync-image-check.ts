import {
  inspectCandidateImage,
  inspectImageLink,
  type CloudBaseApp,
} from '../../scripts/sync-cards-cloudbase-new.js';

export type ImageCheckMode = 'LINK' | 'DECODE';
export interface ImageCheckResult {
  readonly state: 'OK' | 'UNAVAILABLE' | 'UNCERTAIN';
  readonly message: string;
}

// Shared across previews: duplicate URLs share a promise; only four probes run per process.
export class CardSyncImageChecker {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly cache = new Map<string, { until: number; result: Promise<ImageCheckResult> }>();

  constructor(
    private readonly probe = async (app: CloudBaseApp, uri: string, mode: ImageCheckMode) => {
      if (mode === 'LINK') await inspectImageLink(app, uri);
      else {
        const size = await inspectCandidateImage(app, uri);
        if (size.width <= 16 || size.height <= 16)
          throw new Error('image dimensions suggest placeholder');
      }
    }
  ) {}

  async check(app: CloudBaseApp, uri: string, mode: ImageCheckMode): Promise<ImageCheckResult> {
    const key = `${mode}:${uri}`;
    const existing = this.cache.get(key);
    if (existing && existing.until > Date.now()) return existing.result;
    if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
    const item = {
      until: Infinity,
      result: Promise.resolve({ state: 'OK', message: '' } as ImageCheckResult),
    };
    item.result = this.run(app, uri, mode).then((result) => {
      item.until = Date.now() + (result.state === 'OK' ? 5 * 60_000 : 30_000);
      return result;
    });
    this.cache.set(key, item);
    return item.result;
  }

  private async run(
    app: CloudBaseApp,
    uri: string,
    mode: ImageCheckMode
  ): Promise<ImageCheckResult> {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      await this.probe(app, uri, mode);
      return {
        state: 'OK',
        message: mode === 'LINK' ? '卡图链接可访问（内容在导入时校验）' : '卡图可下载并解码',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const unavailable =
        /404|410|not.?found|not.?exist|non-image|empty|unsupported image|corrupt|placeholder|invalid image|Input buffer/i.test(
          message
        );
      return unavailable
        ? {
            state: 'UNAVAILABLE',
            message: '卡图缺失、不是有效图片或疑似占位图；可强制导入无图草稿',
          }
        : {
            state: 'UNCERTAIN',
            message: '卡图暂时无法确认（可能超时、访问受限或不支持快速检查）；可完整检查或强制导入',
          };
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export const cardSyncImageChecker = new CardSyncImageChecker();
