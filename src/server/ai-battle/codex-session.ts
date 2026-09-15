import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { CodexAiBattleModel, AiTokenUsage } from '../../online/ai-battle-billing-types.js';
import type { LocalCodexConfig } from './local-codex-config.js';
import {
  CODEX_ISOLATION_CONFIG,
  codexEnvironment,
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

/** One private, ephemeral thread per client. Fail closed after cancellation/failure; no automatic resume. */
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
  private historyBytes = 0;
  private lastInputTokens = 0;
  private contextLimit = 150_000;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private turn?: {
    id?: string;
    text?: string;
    usage: AiTokenUsage | null;
    resolve: (value: { text: string; usage: AiTokenUsage | null }) => void;
    reject: (error: Error) => void;
  };
  constructor(
    private readonly config: LocalCodexConfig,
    private readonly model: CodexAiBattleModel
  ) {}

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
  private fail() {
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
      this.fail();
    }
  }
  private receive(message: any) {
    if (message.method && message.id !== undefined) {
      if (message.method === 'account/chatgptAuthTokens/refresh')
        void this.refresh(message.id, message.params?.previousAccountId);
      else this.fail(); // Reject tool calls, approval requests and any unexpected server RPC.
      return;
    }
    if (message.id !== undefined) {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      if (message.error) p.reject(new Error('Codex protocol request failed'));
      else {
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
      this.turn.usage = parseCodexUsage({
        input_tokens: u?.inputTokens,
        cached_input_tokens: u?.cachedInputTokens,
        output_tokens: u?.outputTokens,
        cache_write_input_tokens: u?.cacheWriteInputTokens,
      });
      if (this.turn.usage) this.lastInputTokens = u.inputTokens;
      if (
        Number.isSafeInteger(p.tokenUsage?.modelContextWindow) &&
        p.tokenUsage.modelContextWindow > 0
      )
        this.contextLimit = Math.min(150_000, Math.floor(p.tokenUsage.modelContextWindow * 0.75));
    } else if (message.method === 'item/started' || message.method === 'item/completed') {
      if (!['userMessage', 'agentMessage', 'reasoning'].includes(p.item?.type)) return this.fail();
      if (message.method === 'item/completed' && p.item.type === 'agentMessage')
        this.turn.text = p.item.text;
    } else if (message.method === 'turn/completed') {
      const turn = this.turn;
      this.turn = undefined;
      if (
        p.turn?.status !== 'completed' ||
        typeof turn.text !== 'string' ||
        Buffer.byteLength(turn.text) > 256 * 1024
      ) {
        turn.reject(new Error('Codex turn incomplete'));
        this.fail();
      } else {
        this.historyBytes += Buffer.byteLength(turn.text);
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
    this.accountId = login.chatgptAccountId;
    this.accessFingerprint = createHash('sha256').update(login.accessToken).digest('hex');
    this.child = spawn(
      this.config.cliPath,
      [
        'app-server',
        '--stdio',
        '--strict-config',
        ...CODEX_SESSION_CONFIG.flatMap((v) => ['-c', v]),
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
    this.child.on('error', () => this.fail());
    this.child.on('close', () => this.fail());
    this.child.stdin.on('error', () => this.fail());
    this.child.stderr.on('data', (chunk) => {
      this.bytes += chunk.length;
      if (this.bytes > 2 * 1024 * 1024) this.fail();
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.bytes += Buffer.byteLength(chunk);
      this.buffer += chunk;
      if (this.bytes > 2 * 1024 * 1024) return this.fail();
      let at: number;
      while ((at = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        if (!line.trim()) continue;
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.fail();
        }
      }
    });
    await this.rpc('initialize', {
      clientInfo: { name: 'loveca_ai_battle', version: '1' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
    await this.rpc('account/login/start', { type: 'chatgptAuthTokens', ...login });
    const result = await this.rpc('thread/start', {
      model: this.model.slice('codex:'.length),
      cwd,
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
    if (
      size > 512 * 1024 ||
      this.historyBytes + size > 1024 * 1024 ||
      this.lastInputTokens + size > this.contextLimit
    ) {
      await this.close();
      throw new CodexInvocationNotStartedError('Codex context limit reached');
    }
    this.busy = true;
    this.refreshed = false;
    this.bytes = 0;
    let sent = false;
    const abort = () => this.fail();
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (!this.threadId) {
        this.starting = this.start();
        await this.starting;
      } else if ((await existingLogin()).chatgptAccountId !== this.accountId)
        throw new Error('Codex account changed');
      if (signal.aborted || this.closed) throw new Error('Codex cancelled');
      const result = new Promise<{ text: string; usage: AiTokenUsage | null }>(
        (resolve, reject) => {
          this.turn = { resolve, reject, usage: null };
        }
      );
      // Attach immediately: an abort or process exit may reject before turn/start responds.
      void result.catch(() => {});
      sent = true;
      const started = await this.rpc('turn/start', {
        threadId: this.threadId,
        effort: this.config.reasoningEffort,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
        outputSchema: schema,
      });
      if (this.turn && !this.turn.id) this.turn.id = started.turn?.id;
      const response = await result;
      this.historyBytes += size;
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
