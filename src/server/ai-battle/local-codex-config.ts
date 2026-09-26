import {
  CODEX_AI_REASONING_EFFORTS,
  type CodexAiReasoningEffort,
} from '../../online/ai-battle-model-registry.js';
import type { CodexBattleBudget } from '../../online/ai-battle-billing-types.js';
import { AiBattleSetupError } from './presets.js';

export interface LocalCodexConfig {
  readonly cliPath: string;
  readonly budget?: CodexBattleBudget;
  /** Experimental same-thread continuation; stop at the reported context watermark. Off by default. */
  readonly sessionReuse?: boolean;
  readonly threadRotation?: boolean;
  readonly reasoningEffort: CodexAiReasoningEffort;
  readonly fastMode?: boolean;
  readonly frontendOrigin: string;
}

export function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(host);
}

/** Explicit deployment opt-in, not a guess based on a URL or NODE_ENV alone. */
export function readLocalCodexConfig(
  env: NodeJS.ProcessEnv = process.env
): LocalCodexConfig | null {
  if (!env.AI_BATTLE_LOCAL_CODEX || env.AI_BATTLE_LOCAL_CODEX === '0') return null;
  const fail = () =>
    new AiBattleSetupError(
      'AI_LOCAL_CODEX_DISABLED',
      'Codex 仅支持显式启用的本地开发环境：回环 API_HOST、本机数据库及本机 FRONTEND_URL',
      503
    );
  if (env.AI_BATTLE_LOCAL_CODEX !== '1') throw fail();
  const frontendOrigin = readLocalAiEnvironment(env, fail);
  const reuse = env.AI_BATTLE_CODEX_SESSION_REUSE ?? '0';
  if (!['0', '1'].includes(reuse)) throw fail();
  const rotation = env.AI_BATTLE_CODEX_THREAD_ROTATION ?? '0';
  if (!['0', '1'].includes(rotation) || (rotation === '1' && reuse !== '1')) throw fail();
  const effort = env.AI_BATTLE_CODEX_REASONING ?? 'low';
  if (!(CODEX_AI_REASONING_EFFORTS as readonly string[]).includes(effort)) throw fail();
  const cliPath = env.AI_BATTLE_CODEX_PATH ?? '/Applications/ChatGPT.app/Contents/Resources/codex';
  if (!cliPath.startsWith('/')) throw fail();
  const budgetValue = (key: string) => {
    const raw = env[key];
    if (raw === undefined) return undefined;
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new AiBattleSetupError('AI_CODEX_BUDGET_INVALID', `${key} 必须是正安全整数`, 503);
    return Number(raw);
  };
  const values = {
    maxCalls: budgetValue('AI_BATTLE_CODEX_MAX_CALLS'),
    maxInputTokens: budgetValue('AI_BATTLE_CODEX_MAX_INPUT_TOKENS'),
    maxUncachedInputTokens: budgetValue('AI_BATTLE_CODEX_MAX_UNCACHED_INPUT_TOKENS'),
    maxOutputTokens: budgetValue('AI_BATTLE_CODEX_MAX_OUTPUT_TOKENS'),
  };
  const budget = Object.values(values).some((value) => value !== undefined)
    ? Object.freeze(values)
    : undefined;
  return Object.freeze({
    ...(budget ? { budget } : {}),
    cliPath,
    sessionReuse: reuse === '1',
    threadRotation: rotation === '1',
    reasoningEffort: effort as CodexAiReasoningEffort,
    frontendOrigin,
  });
}

/** Shared deployment boundary for opt-in local diagnostics, independent of model provider. */
export function readLocalAiEnvironment(env: NodeJS.ProcessEnv, fail: () => Error): string {
  if (env.NODE_ENV !== 'development' || !['127.0.0.1', '::1'].includes(env.API_HOST ?? ''))
    throw fail();
  let database: URL;
  let frontend: URL;
  try {
    database = new URL(env.DATABASE_URL ?? '');
    frontend = new URL(env.FRONTEND_URL ?? '');
  } catch {
    throw fail();
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !isLoopbackHost(database.hostname) ||
    !isLoopbackHost(frontend.hostname) ||
    frontend.protocol !== 'http:' ||
    frontend.username ||
    frontend.password ||
    frontend.search ||
    frontend.hash ||
    frontend.pathname !== '/'
  )
    throw fail();
  return frontend.origin;
}

/** Raw socket addresses are authoritative; never trust req.ip / X-Forwarded-For alone. */
export function isLocalCodexRequest(
  config: Pick<LocalCodexConfig, 'frontendOrigin'>,
  request: {
    remoteAddress?: string;
    host?: string;
    origin?: string;
    forwarded?: string;
    forwardedFor?: string;
  }
): boolean {
  const localAddress = (address: string) =>
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  if (!localAddress(request.remoteAddress ?? '') || request.forwarded) return false;
  // Vite appends the actual peer; a remote caller cannot erase it by spoofing the header.
  if (
    request.forwardedFor &&
    !request.forwardedFor.split(',').every((ip) => localAddress(ip.trim()))
  )
    return false;
  try {
    const host = new URL(`http://${request.host ?? ''}`);
    if (
      !isLoopbackHost(host.hostname) ||
      host.username ||
      host.password ||
      host.pathname !== '/' ||
      host.search ||
      host.hash
    )
      return false;
    if (!request.origin || request.origin === host.origin) return true;
    const origin = new URL(request.origin);
    const frontend = new URL(config.frontendOrigin);
    return (
      request.origin === origin.origin &&
      isLoopbackHost(origin.hostname) &&
      origin.protocol === frontend.protocol &&
      origin.port === frontend.port
    );
  } catch {
    return false;
  }
}
