import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { CodexAiBattleModel } from '../../online/ai-battle-model-registry.js';
import type { AiTokenUsage } from '../../online/ai-battle-billing-types.js';
import type { LocalCodexConfig } from './local-codex-config.js';
import {
  CODEX_ISOLATION_CONFIG,
  codexEnvironment,
  codexSpeedConfig,
  CodexInvocationNotStartedError,
  parseCodexUsage,
} from './codex-process.js';

import { CODEX_SESSION_INSTRUCTIONS } from './codex-instructions.js';
export { CODEX_SESSION_INSTRUCTIONS } from './codex-instructions.js';
export const CODEX_SESSION_CONFIG = [
  ...CODEX_ISOLATION_CONFIG,
  'cli_auth_credentials_store="ephemeral"',
  // Stop locally before the context limit; never silently compact player history.
  'model_auto_compact_token_limit=1000000000',
];
export class CodexContextLimitError extends CodexInvocationNotStartedError {}
type SessionFailureReason =
  | 'RPC_ERROR'
  | 'PROCESS_ERROR'
  | 'PROCESS_EXIT'
  | 'STDIN_ERROR'
  | 'OUTPUT_LIMIT'
  | 'INVALID_JSON'
  | 'AUTH_REFRESH_FAILED'
  | 'UNEXPECTED_RPC'
  | 'UNEXPECTED_ITEM'
  | 'TURN_FAILED'
  | 'INVALID_RESPONSE'
  | 'CANCELLED';
// CLI wire enums only. Upstream messages/additionalDetails may contain private data.
const upstreamErrorNames = [
  'contextWindowExceeded',
  'sessionBudgetExceeded',
  'usageLimitExceeded',
  'rateLimitExceeded',
  'serverOverloaded',
  'cyberPolicy',
  'misalignmentPolicyViolation',
  'internalServerError',
  'unauthorized',
  'badRequest',
  'threadRollbackFailed',
  'sandboxError',
  'other',
] as const;
const upstreamHttpErrors = [
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
] as const;
function safeUpstreamError(info: unknown): { category: string; httpStatusCode?: number } {
  if (typeof info === 'string' && upstreamErrorNames.some((name) => name === info))
    return { category: info };
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    for (const category of upstreamHttpErrors) {
      if (!Object.hasOwn(info, category)) continue;
      const detail = (info as Record<string, unknown>)[category];
      const status =
        detail && typeof detail === 'object'
          ? (detail as Record<string, unknown>).httpStatusCode
          : undefined;
      return {
        category,
        ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
          ? { httpStatusCode: status }
          : {}),
      };
    }
  }
  return { category: 'UNKNOWN' };
}
const credentials = z.object({
  tokens: z.object({ access_token: z.string().min(1), account_id: z.string().min(1) }),
});
/** Read existing CLI login only into memory; never copy auth.json or refresh tokens into the sandbox. */
async function existingLogin() {
  const value = credentials.parse(
    JSON.parse(
      await readFile(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json'), 'utf8')
    )
  );
  return { accessToken: value.tokens.access_token, chatgptAccountId: value.tokens.account_id };
}
const liveSessions = new Set<CodexBattleSession>();
let exitHookInstalled = false;

/** One private ephemeral thread per client; subsequent windows append only current input. Fail closed after cancellation/failure; no automatic resume. */
export class CodexBattleSession {
  private child?: ChildProcessWithoutNullStreams;
  private directory?: string;
  private threadId?: string;
  private accountId?: string;
  private accessFingerprint?: string;
  private refreshed = false;
  private closed = false;
  private closing?: Promise<void>;
  private starting?: Promise<void>;
  private busy = false;
  private sequence = 0;
  private buffer = '';
  private bytes = 0;
  private contextLimit = 150_000;
  private lastContextTokens: number | null = null;
  private modelContextWindow: number | null = null;
  private completedTurns = 0;
  private compactions = 0;
  private phase: 'INITIALIZE' | 'LOGIN' | 'THREAD_START' | 'TURN_START' | 'TURN_RUNNING' =
    'INITIALIZE';
  private failure?: { reason: SessionFailureReason; rpcCode?: number };
  private upstreamFailure?: ReturnType<typeof safeUpstreamError>;
  /** Fixed local labels only: never expose upstream messages, stderr or credentials. */
  get failureDiagnostics() {
    return {
      phase: this.phase,
      ...this.failure,
      ...(this.upstreamFailure ? { upstream: { ...this.upstreamFailure } } : {}),
    };
  }
  private recordFailure(reason: SessionFailureReason, rpcCode?: number) {
    this.failure ??= { reason, ...(Number.isSafeInteger(rpcCode) ? { rpcCode } : {}) };
  }
  get contextStatus() {
    return {
      lastContextTokens: this.lastContextTokens,
      modelContextWindow: this.modelContextWindow,
      stopAtTokens: this.contextLimit,
      completedTurns: this.completedTurns,
      automaticCompaction: false,
      compactions: this.compactions,
    };
  }
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private turn?: {
    id?: string;
    operation?: 'COMPACTION';
    compactionCompleted?: boolean;
    text?: string;
    usage: AiTokenUsage | null;
    resolve: (value: { text: string; usage: AiTokenUsage | null }) => void;
    reject: (error: Error) => void;
  };
  constructor(
    private readonly config: LocalCodexConfig,
    private readonly model: CodexAiBattleModel
  ) {}

  /** Replace a completed thread without changing the game account or carrying its old snapshots. */
  async createSuccessor(): Promise<CodexBattleSession> {
    if (this.closed || this.busy || !this.accountId || !this.threadId)
      throw new CodexInvocationNotStartedError('Codex thread rotation unavailable');
    const next = new CodexBattleSession(this.config, this.model);
    next.accountId = this.accountId;
    await this.close();
    return next;
  }

  private send(message: unknown) {
    if (this.closed || !this.child) throw new Error('Codex session closed');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  private rpc(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ id, method, params });
      } catch {
        this.pending.delete(id);
        reject(new Error('Codex session closed'));
      }
    });
  }
  private fail(reason?: SessionFailureReason) {
    if (reason && !this.closed) this.recordFailure(reason);
    void this.close().catch(() => {});
  }
  private async refresh(id: number, previousAccountId?: string) {
    try {
      const login = await existingLogin();
      const fingerprint = createHash('sha256').update(login.accessToken).digest('hex');
      if (
        this.refreshed ||
        fingerprint === this.accessFingerprint ||
        login.chatgptAccountId !== this.accountId ||
        (previousAccountId && previousAccountId !== this.accountId)
      )
        throw new Error('Account changed');
      // The desktop/CLI owns refresh. Supply its current access token; never mutate its login.
      this.refreshed = true;
      this.accessFingerprint = fingerprint;
      this.send({ id, result: login });
    } catch {
      this.fail('AUTH_REFRESH_FAILED');
    }
  }
  private receive(message: any) {
    if (message.method && message.id !== undefined) {
      if (message.method === 'account/chatgptAuthTokens/refresh')
        void this.refresh(message.id, message.params?.previousAccountId);
      else this.fail('UNEXPECTED_RPC'); // Reject tool calls, approval requests and any unexpected server RPC.
      return;
    }
    if (message.id !== undefined) {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      if (message.error) {
        this.recordFailure('RPC_ERROR', message.error.code);
        p.reject(new Error('Codex protocol request failed'));
      } else {
        if (this.turn && typeof message.result?.turn?.id === 'string')
          this.turn.id = message.result.turn.id;
        p.resolve(message.result);
      }
      return;
    }
    const p = message.params;
    if (!this.turn || p?.threadId !== this.threadId) return;
    const id = p.turnId ?? p.turn?.id;
    if (message.method === 'turn/started' && !this.turn.id && typeof id === 'string')
      this.turn.id = id;
    if (!id || id !== this.turn.id) return;
    if (message.method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage?.last;
      if (this.turn.operation === 'COMPACTION') {
        // Native remote compaction currently resets last usage to zero without accounting
        // for the compact request. totalTokens here is the new context size, NOT a bill.
        this.turn.usage = null;
        if (Number.isSafeInteger(u?.totalTokens) && u.totalTokens >= 0)
          this.lastContextTokens = u.totalTokens;
      } else {
        this.turn.usage = parseCodexUsage({
          input_tokens: u?.inputTokens,
          cached_input_tokens: u?.cachedInputTokens,
          output_tokens: u?.outputTokens,
          cache_write_input_tokens: u?.cacheWriteInputTokens,
        });
        if (this.turn.usage) this.lastContextTokens = u.inputTokens + u.outputTokens;
      }
      if (
        Number.isSafeInteger(p.tokenUsage?.modelContextWindow) &&
        p.tokenUsage.modelContextWindow > 0
      ) {
        this.modelContextWindow = p.tokenUsage.modelContextWindow;
        this.contextLimit = Math.floor(p.tokenUsage.modelContextWindow * 0.8);
      }
    } else if (message.method === 'item/started' || message.method === 'item/completed') {
      if (p.item?.type === 'contextCompaction' && this.turn.operation === 'COMPACTION') {
        if (message.method === 'item/completed') this.turn.compactionCompleted = true;
        return;
      }
      if (!['userMessage', 'agentMessage', 'reasoning'].includes(p.item?.type))
        return this.fail('UNEXPECTED_ITEM');
      if (message.method === 'item/completed' && p.item.type === 'agentMessage')
        this.turn.text = p.item.text;
    } else if (message.method === 'turn/completed') {
      const turn = this.turn;
      this.turn = undefined;
      if (turn.operation === 'COMPACTION') {
        if (!turn.compactionCompleted) {
          turn.reject(new Error('Codex compaction incomplete'));
          this.fail();
          return;
        }
        turn.text = '';
      }
      if (
        p.turn?.status !== 'completed' ||
        typeof turn.text !== 'string' ||
        Buffer.byteLength(turn.text) > 256 * 1024
      ) {
        if (p.turn?.status === 'failed')
          this.upstreamFailure = safeUpstreamError(p.turn?.error?.codexErrorInfo);
        this.recordFailure(p.turn?.status !== 'completed' ? 'TURN_FAILED' : 'INVALID_RESPONSE');
        turn.reject(new Error('Codex turn incomplete'));
        this.fail();
      } else {
        turn.resolve({ text: turn.text, usage: turn.usage });
      }
    }
  }
  private async start() {
    this.directory = await mkdtemp(join(tmpdir(), 'loveca-codex-session-'));
    if (this.closed) {
      await rm(this.directory, { recursive: true, force: true });
      throw new Error('Codex session closed');
    }
    const home = join(this.directory, 'home'),
      cwd = join(this.directory, 'work');
    await mkdir(home);
    await mkdir(cwd);
    const login = await existingLogin();
    if (this.closed) throw new Error('Codex session closed');
    if (this.accountId && this.accountId !== login.chatgptAccountId)
      throw new Error('Codex account changed across thread rotation');
    this.accountId = login.chatgptAccountId;
    this.accessFingerprint = createHash('sha256').update(login.accessToken).digest('hex');
    this.child = spawn(
      this.config.cliPath,
      [
        'app-server',
        '--stdio',
        '--strict-config',
        ...[...CODEX_SESSION_CONFIG, ...codexSpeedConfig(this.config)].flatMap((v) => ['-c', v]),
      ],
      {
        cwd,
        env: { ...codexEnvironment(), CODEX_HOME: home },
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    liveSessions.add(this);
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once('exit', () => {
        for (const session of liveSessions) session.kill('SIGKILL');
      });
      for (const [signal, code] of [
        ['SIGTERM', 143],
        ['SIGINT', 130],
      ] as const) {
        process.once(signal, () => {
          void Promise.allSettled([...liveSessions].map((session) => session.close())).finally(() =>
            process.exit(code)
          );
        });
      }
    }
    this.child.on('error', () => this.fail('PROCESS_ERROR'));
    this.child.on('close', () => this.fail('PROCESS_EXIT'));
    this.child.stdin.on('error', () => this.fail('STDIN_ERROR'));
    this.child.stderr.on('data', (chunk) => {
      this.bytes += chunk.length;
      if (this.bytes > 2 * 1024 * 1024) this.fail('OUTPUT_LIMIT');
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.bytes += Buffer.byteLength(chunk);
      this.buffer += chunk;
      if (this.bytes > 2 * 1024 * 1024) return this.fail('OUTPUT_LIMIT');
      let at: number;
      while ((at = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        if (!line.trim()) continue;
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.fail('INVALID_JSON');
        }
      }
    });
    await this.rpc('initialize', {
      clientInfo: { name: 'loveca_ai_battle', version: '1' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
    this.phase = 'LOGIN';
    await this.rpc('account/login/start', { type: 'chatgptAuthTokens', ...login });
  }
  private async startThread() {
    this.phase = 'THREAD_START';
    const result = await this.rpc('thread/start', {
      model: this.model.slice('codex:'.length),
      serviceTier: this.config.fastMode ? 'priority' : null,
      cwd: join(this.directory!, 'work'),
      ephemeral: true,
      permissions: 'ai_decision',
      baseInstructions: CODEX_SESSION_INSTRUCTIONS,
      environments: [],
      dynamicTools: [],
      allowProviderModelFallback: false,
    });
    if (typeof result.thread?.id !== 'string' || result.thread.ephemeral === false)
      throw new Error('Invalid Codex thread');
    this.threadId = result.thread.id;
  }
  async decide(prompt: string, schema: Readonly<Record<string, unknown>>, signal: AbortSignal) {
    if (this.closed || this.busy || signal.aborted)
      throw new CodexInvocationNotStartedError('Codex session unavailable');
    const size = Buffer.byteLength(prompt);
    // Bytes limit transport size only. The context watermark uses reported tokens,
    // not a byte-based prediction of the next request; the upstream still enforces its window.
    if (
      size > 512 * 1024 ||
      (this.completedTurns > 0 &&
        (this.lastContextTokens === null || this.lastContextTokens >= this.contextLimit))
    ) {
      await this.close();
      throw new CodexContextLimitError('Codex context watermark reached or usage unavailable');
    }
    this.busy = true;
    this.refreshed = false;
    this.bytes = 0;
    let sent = false;
    const abort = () => this.fail('CANCELLED');
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (!this.child) {
        this.starting = this.start();
        await this.starting;
      } else if ((await existingLogin()).chatgptAccountId !== this.accountId)
        throw new Error('Codex account changed');
      if (signal.aborted || this.closed) throw new Error('Codex cancelled');
      if (!this.threadId) await this.startThread();
      this.lastContextTokens = null;
      const result = new Promise<{ text: string; usage: AiTokenUsage | null }>(
        (resolve, reject) => {
          this.turn = { resolve, reject, usage: null };
        }
      );
      // Attach immediately: an abort or process exit may reject before turn/start responds.
      void result.catch(() => {});
      sent = true;
      this.phase = 'TURN_START';
      const started = await this.rpc('turn/start', {
        threadId: this.threadId,
        effort: this.config.reasoningEffort,
        serviceTier: this.config.fastMode ? 'priority' : null,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
        outputSchema: schema,
      });
      if (!this.failure) this.phase = 'TURN_RUNNING';
      if (this.turn && !this.turn.id) this.turn.id = started.turn?.id;
      const response = await result;
      this.completedTurns++;
      return response;
    } catch {
      await this.close();
      if (!sent) throw new CodexInvocationNotStartedError('Codex session initialization failed');
      throw new Error('Codex session interrupted; no fallback');
    } finally {
      signal.removeEventListener('abort', abort);
      this.busy = false;
    }
  }
  /** Explicit native diagnostic operation; never called automatically by decide().
   * Count as an upstream invocation even when the CLI does not report its usage.
   */
  async compact(signal: AbortSignal) {
    if (this.closed || this.busy || signal.aborted || !this.threadId)
      throw new CodexInvocationNotStartedError('Codex compaction unavailable');
    this.busy = true;
    this.refreshed = false;
    this.bytes = 0;
    let sent = false;
    const abort = () => this.fail();
    signal.addEventListener('abort', abort, { once: true });
    try {
      if ((await existingLogin()).chatgptAccountId !== this.accountId || signal.aborted)
        throw new Error('Codex account changed or cancelled');
      this.lastContextTokens = null;
      const result = new Promise<{ text: string; usage: AiTokenUsage | null }>(
        (resolve, reject) => {
          this.turn = { operation: 'COMPACTION', resolve, reject, usage: null };
        }
      );
      void result.catch(() => {});
      sent = true;
      await this.rpc('thread/compact/start', { threadId: this.threadId });
      await result;
      this.compactions++;
      return { usage: null, context: this.contextStatus };
    } catch {
      await this.close();
      if (!sent) throw new CodexInvocationNotStartedError('Codex compaction not started');
      throw new Error('Codex compaction interrupted; no fallback');
    } finally {
      signal.removeEventListener('abort', abort);
      this.busy = false;
    }
  }
  private kill(signal: NodeJS.Signals) {
    try {
      if (this.child?.pid && process.platform !== 'win32') process.kill(-this.child.pid, signal);
      else this.child?.kill(signal);
    } catch {
      /* Already exited. */
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error('Codex session closed'));
    this.pending.clear();
    this.turn?.reject(new Error('Codex session closed'));
    this.turn = undefined;
    this.closing = (async () => {
      // Initialization may still be creating directories when cancellation arrives.
      await this.starting?.catch(() => {});
      const child = this.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.kill('SIGKILL');
            resolve();
          }, 500);
          child.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
          this.kill('SIGTERM');
        });
        this.kill('SIGKILL');
      }
      liveSessions.delete(this);
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
    })();
    return this.closing;
  }
}
