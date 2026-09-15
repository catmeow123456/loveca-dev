import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiBattleModelClient, AiModelRequestContext } from './driver.js';
import { AiBattleSetupError, type AiFrozenKnowledge, type AiKnowledgeMaterial } from './presets.js';
import type { AiDecisionInput } from './protocol.js';
import type { AiModelOutcome } from './runtime.js';
import type { AiBattleTraceStore } from './trace-store.js';
import { redactAiText } from './redaction.js';
import { compactAiDecisionInput } from './model-input.js';
import {
  QWEN_AI_BATTLE_MODELS,
  type QwenAiBattleModel,
} from '../../online/ai-battle-billing-types.js';
import { parseAiTokenUsage, safeAiErrorForLog, type AiBattleBilling } from './billing.js';
import type { AiUpstreamConfiguration } from '../services/ai-effect-extraction-service.js';

/** An injected upstream validator throws this for transient infrastructure faults (e.g. DNS). */
export class AiUpstreamTransientError extends Error {}

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface AiModelConfig {
  readonly endpoint: string;
  readonly model: QwenAiBattleModel;
  readonly apiKey: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

/** Compose the selected battle model with the platform's server-only upstream snapshot. */
export function createAiModelConfig(
  upstream: AiUpstreamConfiguration,
  model: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): AiModelConfig {
  const parsed = z
    .object({
      baseUrl: z.string().url(),
      model: z.enum(QWEN_AI_BATTLE_MODELS),
      apiKey: z
        .string()
        .min(1)
        .max(4096)
        .regex(/^[\x21-\x7E]+$/),
      temperature: z.coerce.number().min(0).max(2).default(0.2),
      maxTokens: z.coerce.number().int().min(128).max(4096).default(2048),
    })
    .safeParse({
      baseUrl: upstream.baseUrl,
      model,
      apiKey: upstream.apiKey,
      temperature: env.AI_BATTLE_TEMPERATURE,
      maxTokens: env.AI_BATTLE_MAX_TOKENS,
    });
  if (!parsed.success)
    throw new AiBattleSetupError('AI_MODEL_CONFIG_INVALID', '请检查平台 AI 上游配置与对战模型参数');
  const url = new URL(parsed.data.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new AiBattleSetupError(
      'AI_MODEL_CONFIG_INVALID',
      'AI 上游须为不带凭据或查询参数的 HTTPS Chat Completions Base URL'
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return Object.freeze({
    endpoint: url.toString(),
    model: parsed.data.model,
    apiKey: parsed.data.apiKey,
    temperature: parsed.data.temperature,
    maxTokens: parsed.data.maxTokens,
  });
}

const envelope = z.object({
  id: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable(),
      })
    )
    .min(1),
});

export const AI_BATTLE_CONTROL =
  '你参与 Loveca 规则模式对局。当前状态和候选引用是本次选择的边界，卡文和历史是规则资料。frontInfo.cardFactsRef 从 cardFacts 读取完整牌面，textRef 从 texts 读取原文；相同卡号的有效值可能不同，必须按各对象的引用读取。context.recentDecisions 和 lastAction 是已成功提交的动作；modelIntent 只是先前意图，按当前状态重新检查下一步，不能当作规则事实或复用旧候选引用。context.knownDeckTop 是自己合法获知且尚未失效的顶牌，仍在主卡组，不能当作当前手牌。stageAfterEntry 给出单次替换的颜色、总HEART和BLADE静态小计；总HEART达标不表示指定色达标，必须逐色核对需求；未知声援补色只能说有机会。entryResources.conditionMet=false 时不能算入该登场收益。候选和手牌中的 liveBaseBudget 用共享判心规则比较当前舞台与该张LIVE基础需求，missingHearts 是缺口；未计入声援、玩家额外HEART、多LIVE及需求修正，需另行评估，不能把缺口读成已满足。先比较当前可执行的组合及本轮 LIVE 收益，再决定动作。自送回收是通用策略：满场也要检查腾位、回收资源成员、补同伴条件和跨位置换手，按整段净预算与最终收益评价；HAND 的成员目标回手后仍需合法登场，不能只因高费或自送损失就略过，也不能无后续地自送。能唱成单张不等于赢得分数比较，尤其双方已有两张成功 LIVE 时要比较加分或多 LIVE 及合计需求。未知声援只表示机会，不能当成确定资源。只输出符合当前 responseSchema 的 JSON；selection 必填，tradeoff 最多 300 字，简述净资源变化与下一步用途，结束主要阶段时说明放弃的最佳可见路线及理由，不输出逐步推理。只选择当前候选，不发明卡牌、引用、命令或隐藏信息。';

/** One HTTP attempt only. Retry/timeout/freshness remain in the existing driver and match queue. */
export class DashScopeAiBattleClient implements AiBattleModelClient {
  readonly configurationMaterial: AiKnowledgeMaterial;
  private readonly config: AiModelConfig;
  private readonly knowledge: AiFrozenKnowledge;

  constructor(
    config: AiModelConfig,
    knowledge: AiFrozenKnowledge,
    private readonly traces: Pick<AiBattleTraceStore, 'append' | 'reportCaptureFailure'>,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
    private readonly billing?: AiBattleBilling,
    private readonly validateUpstream?: (endpoint: string) => Promise<unknown>
  ) {
    const knowledgeBytes = [
      knowledge.rules,
      knowledge.tutorial,
      knowledge.handbook,
      knowledge.ownDeck,
    ].reduce((sum, source) => sum + Buffer.byteLength(source.content), 0);
    if (knowledgeBytes > 256 * 1024)
      throw new AiBattleSetupError(
        'AI_KNOWLEDGE_TOO_LARGE',
        '本局固定知识超过支持的大小，请缩减规则或手册材料'
      );
    this.config = Object.freeze({ ...config });
    this.knowledge = globalThis.structuredClone(knowledge);
    const content = JSON.stringify({
      provider: 'DASHSCOPE_COMPATIBLE',
      endpoint: config.endpoint,
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      enable_thinking: false,
      response_format: { type: 'json_object' },
      stream: false,
    });
    this.configurationMaterial = Object.freeze({
      id: 'model-configuration',
      title: '本局模型配置',
      source: 'server:platform-ai-configuration',
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }

  async decide(
    input: AiDecisionInput,
    signal: AbortSignal,
    context: AiModelRequestContext
  ): Promise<AiModelOutcome> {
    const startedAt = this.now();
    const sources = [
      this.knowledge.rules,
      this.knowledge.tutorial,
      this.knowledge.handbook,
      this.knowledge.ownDeck,
    ];
    const messages = [
      { role: 'system', content: AI_BATTLE_CONTROL },
      ...sources.map((source) => ({ role: 'user', content: `${source.title}\n${source.content}` })),
      {
        role: 'user',
        content: `本次决策；只使用本次引用\n${JSON.stringify(compactAiDecisionInput(input))}`,
      },
    ];
    const body = JSON.stringify({
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      enable_thinking: false,
      stream: false,
      response_format: { type: 'json_object' },
    });
    const safeBody = redactAiText(body, [this.config.apiKey]);
    if (Buffer.byteLength(safeBody.text) > MAX_REQUEST_BYTES) {
      this.capture(context, 'ASSEMBLY_FAILED', {
        reason: 'REQUEST_BYTES_EXCEEDED',
        requestBytes: Buffer.byteLength(safeBody.text),
        limit: MAX_REQUEST_BYTES,
      });
      return {
        kind: 'ADAPTER_ERROR',
        message: 'Request assembly exceeds the supported context size',
      };
    }
    if (signal.aborted)
      return { kind: 'SERVICE_ERROR', message: 'Request cancelled before send', retryable: false };
    try {
      if (this.validateUpstream) await this.validateUpstream(this.config.endpoint);
    } catch (error) {
      // A transient infrastructure fault (e.g. host resolution) may succeed on the bounded
      // service retry; allowlist/HTTPS/private-address rejections are deployment policy
      // faults that must fail closed and permanently stop the session.
      const transient = error instanceof AiUpstreamTransientError;
      this.capture(context, 'VALIDATION_FAILED', {
        transient,
        ...safeAiErrorForLog(error),
      });
      return transient
        ? { kind: 'SERVICE_ERROR', message: 'AI 上游主机暂时不可达，稍后重试', retryable: true }
        : {
            kind: 'ADAPTER_ERROR',
            message: '平台 AI 上游未通过出站校验，请检查上游配置与部署白名单',
          };
    }
    if (signal.aborted)
      return { kind: 'SERVICE_ERROR', message: 'Request cancelled before send', retryable: false };
    let billingAttempt: Awaited<ReturnType<AiBattleBilling['begin']>> | undefined;
    try {
      if (this.billing) billingAttempt = await this.billing.begin(context.taskId);
    } catch {
      // The counters were rolled back and nothing was sent, so a failed billing snapshot is a
      // persistence fault to retry, not a misconfigured adapter to fail closed on.
      return {
        kind: 'SERVICE_ERROR',
        message: 'AI 计费保存失败，本次请求未发送',
        retryable: true,
      };
    }
    if (signal.aborted) {
      await billingAttempt?.cancelBeforeSend();
      return { kind: 'SERVICE_ERROR', message: 'Request cancelled before send', retryable: false };
    }
    const onAbort = () => billingAttempt?.interrupt();
    signal.addEventListener('abort', onAbort, { once: true });
    this.capture(
      context,
      'REQUEST',
      {
        startedAt,
        endpoint: this.config.endpoint,
        // This string is the exact transmitted body. Auth headers never enter a capture payload.
        body: safeBody.text,
        redactionCount: safeBody.count,
        inputEncoding: 'EXACT_CARD_FACTS_AND_TEXT_REFS',
        assembly: sources.map((source, index) => ({
          sourceId: source.id,
          sourceSha256: source.sha256,
          messageIndex: index + 1,
          selection: 'FULL',
          trimming: null,
        })),
      },
      { attemptStarted: context.attempt, status: 'REQUESTING' }
    );
    let response: Response;
    try {
      response = await this.fetcher(this.config.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: safeBody.text,
        signal,
        redirect: 'error',
      });
    } catch (error) {
      signal.removeEventListener('abort', onAbort);
      await billingAttempt?.finish(null);
      const detail = redactAiText(error instanceof Error ? error.message : String(error), [
        this.config.apiKey,
      ]);
      this.capture(
        context,
        'TRANSPORT_ERROR',
        {
          startedAt,
          endedAt: this.now(),
          error: detail.text,
          redactionCount: detail.count,
          cancelled: signal.aborted,
        },
        { attemptFinished: context.attempt }
      );
      return {
        kind: 'SERVICE_ERROR',
        message: signal.aborted ? 'Request cancelled' : 'Model transport failed',
        retryable: !signal.aborted,
      };
    }
    let raw = '';
    let truncated = false;
    let readError: string | null = null;
    // Incremental reads bound even an incorrect/malicious Content-Length. Cancelled requests may
    // still return from a provider/mock; their raw response is captured on this original attempt.
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      if (reader)
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const accepted = chunk.value.subarray(0, Math.max(0, MAX_RESPONSE_BYTES - bytes));
          raw += decoder.decode(accepted, { stream: true });
          bytes += accepted.byteLength;
          if (accepted.byteLength < chunk.value.byteLength) {
            truncated = true;
            // Do not await a misbehaving upstream's cancellation acknowledgement.
            void reader.cancel().catch(() => undefined);
            break;
          }
        }
      if (!truncated) raw += decoder.decode();
    } catch (error) {
      readError = redactAiText(error instanceof Error ? error.message : String(error), [
        this.config.apiKey,
      ]).text;
    } finally {
      reader?.releaseLock();
    }
    const beforeTailRedaction = raw;
    if (truncated || readError) raw = redactAiTruncatedTail(raw, this.config.apiKey);
    const trailingCredentialRedacted = raw !== beforeTailRedaction;
    const redacted = redactAiText(raw, [this.config.apiKey]);
    const responseValue = parseJson(redacted.text);
    const parsed = envelope.safeParse(responseValue);
    const usage =
      !truncated && !readError && typeof responseValue === 'object' && responseValue !== null
        ? parseAiTokenUsage((responseValue as Record<string, unknown>).usage)
        : null;
    // Count returned usage before choice validation, including cancelled and stale responses.
    signal.removeEventListener('abort', onAbort);
    await billingAttempt?.finish(usage);
    const first = parsed.success ? parsed.data.choices[0]! : null;
    this.capture(
      context,
      'RESPONSE',
      {
        startedAt,
        endedAt: this.now(),
        httpStatus: response.status,
        requestId: redactAiText(
          response.headers.get('x-request-id') ?? (parsed.success ? (parsed.data.id ?? '') : ''),
          [this.config.apiKey]
        ).text.slice(0, 256),
        redactionCount: redacted.count,
        trailingCredentialRedacted,
        receivedBytes: bytes,
        bodyReadLimitExceeded: truncated,
        bodyReadError: readError,
        finishReason: first?.finish_reason ?? null,
        cancelled: signal.aborted,
        usage,
      },
      { attemptFinished: context.attempt }
    );
    this.capture(context, 'RESPONSE_BODY', {
      rawBody: redacted.text,
      redactionCount: redacted.count,
    });
    if (truncated)
      return {
        kind: 'SERVICE_ERROR',
        message: 'Model HTTP body exceeds the supported response size',
        retryable: false,
      };
    if (readError)
      return {
        kind: 'SERVICE_ERROR',
        message: 'Model response stream failed',
        retryable: !signal.aborted,
      };
    if (!response.ok)
      return {
        kind: 'SERVICE_ERROR',
        message: `Model HTTP ${response.status}`,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      };
    if (!first)
      return {
        kind: 'SERVICE_ERROR',
        message: 'Invalid model response envelope',
        retryable: false,
      };
    // A missing/empty model answer is an output failure, not a service-retry prompt.
    return {
      kind: 'RESPONSE',
      text: first.message.content ?? '',
      truncated: first.finish_reason === 'length',
    };
  }

  private capture(
    context: AiModelRequestContext,
    stage: string,
    payload: Record<string, unknown>,
    options?: Parameters<AiBattleTraceStore['append']>[4]
  ): void {
    // Capture errors cannot trigger another request or invalidate an accepted rule action.
    try {
      this.traces.append(
        context.matchId,
        context.taskId,
        stage,
        { attempt: context.attempt, ...payload },
        options
      );
    } catch {
      this.traces.reportCaptureFailure(context.matchId);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A byte cutoff must not retain the beginning of a known credential at the end of an error. */
function redactAiTruncatedTail(text: string, secret: string): string {
  for (const variant of new Set([
    secret,
    encodeURIComponent(secret),
    JSON.stringify(secret).slice(1, -1),
  ])) {
    for (let length = variant.length - 1; length > 0; length--) {
      if (text.endsWith(variant.slice(0, length)))
        return `${text.slice(0, -length)}[REDACTED_PARTIAL]`;
    }
  }
  return text;
}
