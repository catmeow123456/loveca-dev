import { CODEX_SESSION_INSTRUCTIONS } from './codex-instructions.js';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexAiBattleModel } from '../../online/ai-battle-model-registry.js';
import type { AiTokenUsage } from '../../online/ai-battle-billing-types.js';
import type { LocalCodexConfig } from './local-codex-config.js';
import { z } from 'zod';

export class CodexInvocationNotStartedError extends Error {}
const SAFE_ENV = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'CODEX_HOME',
  'CODEX_CA_CERTIFICATE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];
export function codexEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    SAFE_ENV.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])
  );
}

/** CLI uses its login; model tools receive only this restricted filesystem and no network. */
export const CODEX_ISOLATION_CONFIG = [
  'forced_login_method="chatgpt"',
  'model_provider="openai"',
  'approval_policy="never"',
  'default_permissions="ai_decision"',
  'permissions.ai_decision.filesystem={":minimal"="read",":workspace_roots"="read"}',
  'permissions.ai_decision.network.enabled=false',
  'project_doc_max_bytes=0',
  'web_search="disabled"',
  'mcp_servers={}',
  'features.shell_tool=false',
  'features.unified_exec=false',
  'features.shell_snapshot=false',
  'features.code_mode=false',
  'features.code_mode_host=false',
  'features.multi_agent=false',
  'features.apps=false',
  'features.plugins=false',
  'features.remote_plugin=false',
  'features.hooks=false',
  'features.memories=false',
  'features.context_management=false',
  'features.browser_use=false',
  'features.computer_use=false',
  'features.image_generation=false',
  'features.view_image=false',
  'features.skill_search=false',
  'features.skip_host_skill_discovery=true',
  'features.skill_mcp_dependency_install=false',
  'features.workspace_dependencies=false',
  'features.goals=false',
  'features.tool_suggest=false',
  'features.sleep_tool=false',
  'tools.update_plan.enabled=false',
  'history.persistence="none"',
];

export function codexExecArgs(
  config: LocalCodexConfig,
  model: CodexAiBattleModel,
  schemaPath: string,
  instructionsPath?: string
): string[] {
  return [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--ephemeral',
    '--skip-git-repo-check',
    '--json',
    '--color',
    'never',
    '--model',
    model.slice('codex:'.length),
    ...[...CODEX_ISOLATION_CONFIG, `model_reasoning_effort="${config.reasoningEffort}"`].flatMap(
      (value) => ['-c', value]
    ),
    ...(instructionsPath
      ? ['-c', `model_instructions_file=${JSON.stringify(instructionsPath)}`]
      : []),
    '--output-schema',
    schemaPath,
    '-',
  ];
}

/** Spawn without a shell; settle only after close so an aborted invocation cannot keep running. */
export function runCodexProcess(
  binary: string,
  args: readonly string[],
  cwd: string,
  input: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
  maxBytes = 512 * 1024,
  onStarted?: () => void
): Promise<{ stdout: string; stderr: string }> {
  if (signal.aborted) return Promise.reject(new Error('Codex invocation cancelled'));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.once('spawn', () => onStarted?.());
    let stdout = '',
      stderr = '',
      bytes = 0;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        /* Process may have exited between abort and signal delivery. */
      }
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 500);
      killTimer.unref();
    };
    const abort = () => stop(new Error('Codex invocation cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.on('error', () => stop(new Error('Cannot start Codex CLI')));
    // A CLI that exits without draining stdin (e.g. `codex --version`) closes the pipe's
    // read end; the flush then surfaces here as EPIPE. The exit code and captured output
    // already describe that outcome, so a stdin error is not itself an invocation failure.
    child.stdin.on('error', () => {});
    for (const [stream, isOut] of [
      [child.stdout, true],
      [child.stderr, false],
    ] as const) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) return stop(new Error('Codex output limit exceeded'));
        if (isOut) stdout += chunk;
        else stderr += chunk;
      });
    }
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
      // A parent can exit on TERM while a descendant ignores it and closes its pipes.
      // Do not leave that descendant alive just because the parent emitted close early.
      if (failure) kill('SIGKILL');
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Codex CLI exited with code ${code}; no API fallback`));
      else resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export async function verifyCodexLogin(
  config: LocalCodexConfig,
  externalSignal?: AbortSignal
): Promise<void> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(15_000),
    ...(externalSignal ? [externalSignal] : []),
  ]);
  const env = codexEnvironment();
  // Local deployment is already explicitly gated. Allow CLI upgrades without a version
  // allowlist; actual calls still require strict config, isolation and valid responses.
  const login = await runCodexProcess(
    config.cliPath,
    ['login', 'status'],
    tmpdir(),
    '',
    signal,
    env,
    32_768
  );
  if (
    !`${login.stdout}\n${login.stderr}`
      .split(/\r?\n/)
      .some((line) => line.trim().toLowerCase() === 'logged in using chatgpt')
  )
    throw new Error('Codex requires ChatGPT login; API key authentication is refused');
}

const token = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({
  input_tokens: token,
  cached_input_tokens: token,
  output_tokens: token,
  cache_write_input_tokens: token.optional(),
});
export function parseCodexUsage(value: unknown): AiTokenUsage | null {
  const parsed = usageSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.cached_input_tokens > parsed.data.input_tokens ||
    (parsed.success && (parsed.data.cache_write_input_tokens ?? 0) !== 0)
  )
    return null;
  return {
    inputTokens: parsed.data.input_tokens - parsed.data.cached_input_tokens,
    implicitCachedTokens: parsed.data.cached_input_tokens,
    explicitCachedTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: parsed.data.output_tokens,
  };
}

export function parseCodexOutput(stdout: string): { text: string; usage: AiTokenUsage | null } {
  let text: string | undefined,
    usage: AiTokenUsage | null = null,
    completed = 0;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'turn.failed' || event.type === 'error')
      throw new Error('Codex turn failed');
    if (event.type?.startsWith('item.')) {
      // Defence in depth; the CLI config and sandbox prevent tool access before this check.
      if (!['agent_message', 'reasoning', 'error'].includes(event.item?.type))
        throw new Error('Unexpected Codex tool activity');
      if (event.type === 'item.completed' && event.item.type === 'agent_message')
        text = event.item.text;
    }
    if (event.type === 'turn.completed') {
      completed++;
      usage = parseCodexUsage(event.usage);
    }
  }
  if (completed !== 1 || typeof text !== 'string' || Buffer.byteLength(text) > 256 * 1024)
    throw new Error('Missing or invalid Codex final response');
  return { text, usage };
}

export async function executeCodexDecision(
  config: LocalCodexConfig,
  model: CodexAiBattleModel,
  prompt: string,
  schema: Readonly<Record<string, unknown>>,
  signal: AbortSignal
): Promise<{ text: string; usage: AiTokenUsage | null }> {
  let directory: string | undefined;
  let started = false;
  try {
    directory = await mkdtemp(join(tmpdir(), 'loveca-codex-'));
    const schemaPath = join(directory, 'response-schema.json');
    const instructionsPath = join(directory, 'instructions.txt');
    await writeFile(instructionsPath, CODEX_SESSION_INSTRUCTIONS, { mode: 0o600 });
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    const result = await runCodexProcess(
      config.cliPath,
      codexExecArgs(config, model, schemaPath, instructionsPath),
      directory,
      prompt,
      signal,
      codexEnvironment(),
      512 * 1024,
      () => {
        started = true;
      }
    );
    return parseCodexOutput(result.stdout);
  } catch (error) {
    if (!started) throw new CodexInvocationNotStartedError('Codex invocation never started');
    throw error;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
