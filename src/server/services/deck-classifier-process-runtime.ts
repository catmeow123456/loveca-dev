import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { DeckClassifierPreviewView } from '../../online/deck-classifier-types.js';
import type {
  DeckClassifierProcessRequest,
  DeckClassifierProcessResponse,
} from './deck-classifier-process-protocol.js';

export class DeckClassifierProcessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

function processError(message: string, code = 'DECK_CLASSIFIER_UNAVAILABLE', statusCode = 503) {
  return new DeckClassifierProcessError(message, code, statusCode);
}

/** Owns one supervised OS process; no classification or database payloads run in the API. */
export class DeckClassifierProcessRuntime {
  private child: ChildProcess | null = null;
  private restart: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private pending: {
    id: string;
    resolve: (value: DeckClassifierPreviewView) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.spawn();
  }

  stop(): void {
    this.stopped = true;
    if (this.restart) clearTimeout(this.restart);
    this.restart = null;
    this.rejectPending(processError('分类服务正在停止'));
    const child = this.child;
    this.child = null;
    if (child) {
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      forceKill.unref();
      child.once('exit', () => clearTimeout(forceKill));
    }
  }

  notify(): void {
    // Durable queued tasks are also polled after restart, so a missed hint is safe.
    if (this.child?.connected) this.send({ kind: 'notify' });
  }

  preview(revision: number, matchLimit: number | null): Promise<DeckClassifierPreviewView> {
    if (!this.child?.connected) return Promise.reject(processError('分类服务暂不可用，请稍后重试'));
    if (this.pending)
      return Promise.reject(
        processError('已有分类预览正在执行，请稍后重试', 'DECK_CLASSIFIER_PREVIEW_BUSY', 409)
      );
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        // Keep the slot busy until the child finishes. A preview timeout must not
        // terminate an unrelated durable classification transaction in that process.
        this.pending?.reject(
          processError('分类预览耗时较长，请稍后重试', 'DECK_CLASSIFIER_PREVIEW_TIMEOUT', 504)
        );
      }, 5 * 60_000);
      timer.unref();
      this.pending = { id, resolve, reject, timer };
      this.send({ kind: 'preview', id, revision, matchLimit });
    });
  }

  private send(message: DeckClassifierProcessRequest): void {
    this.child?.send(message, (error) => {
      if (error) this.rejectPending(processError('分类进程通信中断，请稍后重试'));
    });
  }

  private spawn(): void {
    if (this.stopped) return;
    const child = fork(
      fileURLToPath(new URL('../deck-classifier-process.js', import.meta.url)),
      [],
      {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        // The compiled child must not inherit API --watch/--inspect entrypoint flags.
        execArgv: [],
        env: { ...process.env, DECK_CLASSIFIER_PROCESS: '1' },
      }
    );
    this.child = child;
    child.on('message', (message: DeckClassifierProcessResponse) => {
      const pending = this.pending;
      if (child !== this.child || !pending || message.id !== pending.id) return;
      clearTimeout(pending.timer);
      this.pending = null;
      if (message.kind === 'preview-result') pending.resolve(message.result);
      else pending.reject(processError(message.message, message.code, message.statusCode));
    });
    child.on('error', () => this.rejectPending(processError('分类进程启动或通信失败')));
    // A failed spawn emits error + close, but may never emit exit.
    child.once('close', () => {
      if (child !== this.child) return;
      this.child = null;
      this.rejectPending(processError('分类进程已重启，请重新发起预览'));
      if (!this.stopped) {
        console.error('[DeckClassifier] Process exited; restarting in 5 seconds');
        this.restart = setTimeout(() => this.spawn(), 5_000);
        this.restart.unref();
      }
    });
  }

  private rejectPending(error: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = null;
  }
}

export const deckClassifierProcess = new DeckClassifierProcessRuntime();
