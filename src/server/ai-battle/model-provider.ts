export const AI_MODEL_PROVIDER_PROFILE_VERSION =
  'ai-battle.model-provider.alibaba-qwen-plus-2025-12-01/v1' as const;
export const AI_MODEL_PROVIDER_ID = 'ALIBABA_DASHSCOPE' as const;
export const AI_MODEL_ID = 'qwen-plus-2025-12-01' as const;
export const AI_MODEL_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1' as const;
export const AI_MODEL_MAX_COMPLETION_TOKENS = 512 as const;
export const AI_MODEL_MAX_RESPONSE_BYTES = 1_048_576 as const;

export interface AiModelProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface AiModelProviderSuccess {
  readonly ok: true;
  readonly rawOutput: string;
  readonly usage: AiModelProviderUsage;
  readonly providerRequestId: string | null;
  readonly finishReason: string | null;
}

export type AiModelProviderFailureCode =
  | 'ABORTED'
  | 'NETWORK'
  | 'HTTP_RETRYABLE'
  | 'HTTP_FATAL'
  | 'INVALID_RESPONSE'
  | 'EMPTY_RESPONSE'
  | 'RESPONSE_TOO_LARGE';

export interface AiModelProviderFailure {
  readonly ok: false;
  readonly code: AiModelProviderFailureCode;
  readonly retryable: boolean;
}

export type AiModelProviderResult = AiModelProviderSuccess | AiModelProviderFailure;

export interface AiModelProviderRequest {
  readonly systemMessage: string;
  readonly userMessage: string;
}

export interface AiModelProvider {
  readonly providerId: typeof AI_MODEL_PROVIDER_ID;
  readonly profileVersion: typeof AI_MODEL_PROVIDER_PROFILE_VERSION;
  readonly modelId: typeof AI_MODEL_ID;
  invoke(request: AiModelProviderRequest, signal: AbortSignal): Promise<AiModelProviderResult>;
}

export interface CreateAlibabaDashScopeModelProviderInput {
  readonly apiKey: string;
  readonly fetchImpl?: typeof globalThis.fetch;
}

export interface AiBattleModelConfigurationStatus {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly providerId: typeof AI_MODEL_PROVIDER_ID;
  readonly profileVersion: typeof AI_MODEL_PROVIDER_PROFILE_VERSION;
  readonly modelId: typeof AI_MODEL_ID;
}

export function readAiBattleModelConfigurationStatus(
  env: Readonly<Record<string, string | undefined>> = process.env
): AiBattleModelConfigurationStatus {
  return {
    enabled: env.AI_BATTLE_MODEL_ENABLED !== '0',
    configured: Boolean(env.DASHSCOPE_API_KEY?.trim()),
    providerId: AI_MODEL_PROVIDER_ID,
    profileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
    modelId: AI_MODEL_ID,
  };
}

export function createConfiguredAiBattleModelProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl?: typeof globalThis.fetch
): AiModelProvider | null {
  const status = readAiBattleModelConfigurationStatus(env);
  if (!status.enabled || !status.configured) return null;
  return createAlibabaDashScopeModelProvider({
    apiKey: env.DASHSCOPE_API_KEY!,
    fetchImpl,
  });
}

/**
 * Fixed Phase 4 provider adapter.
 *
 * Credentials remain in this closure and are never included in model request
 * envelopes, strategy records, provider results, or thrown errors.
 */
export function createAlibabaDashScopeModelProvider(
  input: CreateAlibabaDashScopeModelProviderInput
): AiModelProvider {
  if (!input.apiKey.trim()) {
    throw new Error('DashScope API key is required');
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const endpoint = `${AI_MODEL_BASE_URL}/chat/completions`;

  return {
    providerId: AI_MODEL_PROVIDER_ID,
    profileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
    modelId: AI_MODEL_ID,
    async invoke(request, signal) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: AI_MODEL_ID,
            messages: [
              { role: 'system', content: request.systemMessage },
              { role: 'user', content: request.userMessage },
            ],
            response_format: { type: 'json_object' },
            enable_thinking: false,
            temperature: 0.1,
            max_completion_tokens: AI_MODEL_MAX_COMPLETION_TOKENS,
            stream: false,
          }),
          signal,
        });
      } catch (error) {
        return signal.aborted || isAbortError(error)
          ? { ok: false, code: 'ABORTED', retryable: false }
          : { ok: false, code: 'NETWORK', retryable: true };
      }

      let responseText: string | null;
      try {
        responseText = await readBoundedResponseText(response);
      } catch (error) {
        return signal.aborted || isAbortError(error)
          ? { ok: false, code: 'ABORTED', retryable: false }
          : { ok: false, code: 'NETWORK', retryable: true };
      }
      if (responseText === null) {
        return { ok: false, code: 'RESPONSE_TOO_LARGE', retryable: false };
      }
      if (!response.ok) {
        return {
          ok: false,
          code:
            response.status === 408 || response.status === 429 || response.status >= 500
              ? 'HTTP_RETRYABLE'
              : 'HTTP_FATAL',
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        };
      }

      const payload = parseProviderPayload(responseText);
      if (!payload) return { ok: false, code: 'INVALID_RESPONSE', retryable: true };
      const rawOutput = payload.choices[0]?.message?.content;
      if (typeof rawOutput !== 'string' || !rawOutput.trim()) {
        return { ok: false, code: 'EMPTY_RESPONSE', retryable: true };
      }
      const inputTokens = normalizeTokenCount(payload.usage?.prompt_tokens);
      const outputTokens = normalizeTokenCount(payload.usage?.completion_tokens);
      return {
        ok: true,
        rawOutput,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens:
            normalizeTokenCount(payload.usage?.total_tokens) || inputTokens + outputTokens,
        },
        providerRequestId:
          response.headers.get('x-request-id') ??
          normalizeOptionalString(payload.request_id) ??
          normalizeOptionalString(payload.id),
        finishReason: normalizeOptionalString(payload.choices[0]?.finish_reason),
      };
    },
  };
}

interface ProviderPayload {
  readonly id?: unknown;
  readonly request_id?: unknown;
  readonly choices: readonly {
    readonly message?: { readonly content?: unknown };
    readonly finish_reason?: unknown;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
  };
}

function parseProviderPayload(value: string): ProviderPayload | null {
  try {
    const payload = JSON.parse(value) as unknown;
    if (!payload || typeof payload !== 'object') return null;
    const choices = (payload as { readonly choices?: unknown }).choices;
    return Array.isArray(choices) ? (payload as ProviderPayload) : null;
  } catch {
    return null;
  }
}

async function readBoundedResponseText(response: Response): Promise<string | null> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > AI_MODEL_MAX_RESPONSE_BYTES) {
      return null;
    }
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    totalBytes += next.value.byteLength;
    if (totalBytes > AI_MODEL_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function normalizeTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
