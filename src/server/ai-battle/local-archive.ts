import { createReadStream, realpathSync, existsSync } from 'node:fs';
import { mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AiLocalArchiveStatus } from '../../online/ai-battle-observation-types.js';
import { readLocalAiEnvironment } from './local-codex-config.js';
import { AiBattleSetupError } from './presets.js';
import { serializeAiEvidence } from './redaction.js';

export interface LocalArchiveConfig {
  readonly directory: string;
  readonly frontendOrigin: string;
}

export function readLocalArchiveConfig(
  env: NodeJS.ProcessEnv = process.env
): LocalArchiveConfig | null {
  if (!env.AI_BATTLE_LOCAL_ARCHIVE || env.AI_BATTLE_LOCAL_ARCHIVE === '0') return null;
  const fail = () =>
    new AiBattleSetupError(
      'AI_LOCAL_ARCHIVE_DISABLED',
      '完整归档仅允许显式启用的本地开发环境，并需配置仓库外的绝对归档目录',
      503
    );
  if (env.AI_BATTLE_LOCAL_ARCHIVE !== '1') throw fail();
  const frontendOrigin = readLocalAiEnvironment(env, fail);
  const directory = env.AI_BATTLE_ARCHIVE_DIR;
  if (!directory || !isAbsolute(directory)) throw fail();
  return { directory: resolve(directory), frontendOrigin };
}

// Disk and queued writes are bounded independently of the small UI observation cache.
export const LOCAL_ARCHIVE_LIMITS = { fileBytes: 256 * 1024 * 1024, queueBytes: 8 * 1024 * 1024 };
type ArchiveLimits = typeof LOCAL_ARCHIVE_LIMITS;

function outsideRepository(directory: string, repository: string): void {
  let ancestor = directory;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const physical = resolve(realpathSync(ancestor), relative(ancestor, directory));
  const relation = relative(realpathSync(repository), physical);
  if (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  )
    throw new AiBattleSetupError('AI_ARCHIVE_DIRECTORY_INVALID', '归档目录必须位于仓库外', 400);
}

/** One append-only, redacted JSONL journal per opted-in game. Never reads authority state. */
export class LocalAiArchive {
  private tail: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private writtenBytes = 0;
  private writtenRecords = 0;
  private droppedRecords = 0;
  private sequence = 0;
  private ended = false;
  private closed = false;
  private failure?: AiLocalArchiveStatus['failure'];

  private constructor(
    private readonly file: FileHandle,
    readonly path: string,
    private readonly limits: ArchiveLimits,
    private readonly now: () => number
  ) {}

  static async create(
    config: LocalArchiveConfig,
    matchId: string,
    repository = fileURLToPath(new URL('../../../', import.meta.url)),
    limits: ArchiveLimits = LOCAL_ARCHIVE_LIMITS,
    now = Date.now
  ): Promise<LocalAiArchive> {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(matchId)) throw new Error('Invalid archive match ID');
    outsideRepository(config.directory, repository);
    await mkdir(config.directory, { recursive: true, mode: 0o700 });
    const directory = await realpath(config.directory);
    outsideRepository(directory, repository);
    const path = join(directory, `loveca-ai-${matchId}.jsonl`);
    const file = await open(path, 'wx', 0o600);
    const archive = new LocalAiArchive(file, path, limits, now);
    archive.record('HEADER', {
      format: 'loveca-ai-archive-v1',
      matchId,
      scope: 'AI_SEAT_OBSERVATION',
      startedAt: now(),
      maxBytes: limits.fileBytes,
    });
    await archive.flush();
    if (archive.failure) {
      await archive.close();
      throw new AiBattleSetupError('AI_ARCHIVE_OPEN_FAILED', '无法创建完整归档文件', 503);
    }
    return archive;
  }

  record(
    kind: 'HEADER' | 'SOURCES' | 'BEGIN' | 'APPEND' | 'BILLING' | 'END' | 'CAPTURE_FAILURE',
    payload: unknown
  ): void {
    if (this.failure || this.closed) {
      if (this.closed) this.fail('CAPTURE_FAILED');
      this.droppedRecords++;
      return;
    }
    let line: string;
    try {
      // Redact before admission to either the queue or disk, including nested text and Maps.
      const body = serializeAiEvidence(payload);
      line =
        JSON.stringify({
          sequence: ++this.sequence,
          timestamp: this.now(),
          kind,
          redactionCount: body.count,
        }).slice(0, -1) +
        ',"payload":' +
        body.text +
        '}\n';
    } catch {
      this.fail('CAPTURE_FAILED');
      this.droppedRecords++;
      return;
    }
    const bytes = Buffer.byteLength(line);
    if (this.writtenBytes + this.queuedBytes + bytes > this.limits.fileBytes) {
      this.fail('FILE_LIMIT');
      this.droppedRecords++;
      return;
    }
    if (this.queuedBytes + bytes > this.limits.queueBytes) {
      this.fail('QUEUE_LIMIT');
      this.droppedRecords++;
      return;
    }
    this.queuedBytes += bytes;
    this.tail = this.tail.then(async () => {
      try {
        // Already admitted records may drain after a capacity stop; never after a failed write.
        if (this.failure === 'WRITE_FAILED') {
          this.droppedRecords++;
          return;
        }
        await this.file.writeFile(line, 'utf8');
        this.writtenBytes += bytes;
        this.writtenRecords++;
      } catch {
        this.failure = 'WRITE_FAILED';
        this.droppedRecords++;
      } finally {
        this.queuedBytes -= bytes;
      }
    });
  }

  markEnded(endedAt: number): void {
    if (this.ended) return;
    this.record('END', { endedAt });
    this.ended = true;
  }

  reportCaptureFailure(): void {
    this.record('CAPTURE_FAILURE', {});
    this.fail('CAPTURE_FAILED');
  }

  private fail(reason: NonNullable<AiLocalArchiveStatus['failure']>): void {
    this.failure ??= reason;
  }

  status(): AiLocalArchiveStatus {
    return {
      state: this.failure ? 'FAILED' : this.ended ? 'ENDED' : 'RECORDING',
      writtenBytes: this.writtenBytes,
      queuedBytes: this.queuedBytes,
      maxBytes: this.limits.fileBytes,
      writtenRecords: this.writtenRecords,
      droppedRecords: this.droppedRecords,
      ...(this.failure ? { failure: this.failure } : {}),
    };
  }

  async flush(): Promise<void> {
    await this.tail;
  }

  /** Export a fixed completed prefix while gameplay may continue appending. */
  async snapshot() {
    await this.flush();
    const status = this.status();
    const manifest =
      JSON.stringify({
        kind: 'EXPORT',
        payload: {
          format: 'loveca-ai-archive-v1',
          exportedAt: this.now(),
          status,
          completeThroughExport:
            !status.failure && status.droppedRecords === 0 && status.queuedBytes === 0,
        },
      }) + '\n';
    return {
      manifest,
      bytes: status.writtenBytes,
      stream: status.writtenBytes
        ? createReadStream(this.path, { start: 0, end: status.writtenBytes - 1 })
        : null,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
    await this.file.close().catch(() => {
      this.fail('WRITE_FAILED');
    });
  }
}
