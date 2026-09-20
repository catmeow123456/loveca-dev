import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiBattleModelClient, AiModelRequestContext } from './driver.js';
import { AiBattleSetupError, type AiFrozenKnowledge, type AiKnowledgeMaterial } from './presets.js';
import type { AiDecisionInput } from './protocol.js';
import {
  AI_MODEL_TIMEOUT_MS,
  AI_THINKING_MODEL_TIMEOUT_MS,
  type AiModelOutcome,
} from './runtime.js';
import type { AiBattleTraceStore } from './trace-store.js';
import { redactAiText } from './redaction.js';
import { compactAiDecisionInput } from './model-input.js';
import {
  API_AI_BATTLE_MODELS,
  type ApiAiBattleModel,
} from '../../online/ai-battle-model-registry.js';
import { parseAiTokenUsage, safeAiErrorForLog, type AiBattleBilling } from './billing.js';
import type { AiUpstreamConfiguration } from '../services/ai-effect-extraction-service.js';
import {
  LIVE_PROBABILITY_QUERY_INSTRUCTIONS,
  liveProbabilityQuerySchema,
  liveProbabilityResultMessage,
  withLiveProbabilityQuery,
} from './live-probability-query.js';

/** An injected upstream validator throws this for transient infrastructure faults (e.g. DNS). */
export class AiUpstreamTransientError extends Error {}

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface AiModelConfig {
  readonly endpoint: string;
  readonly model: ApiAiBattleModel;
  readonly apiKey: string;
  readonly temperature: number;
  readonly maxTokens?: number;
  readonly enableThinking: boolean;
}

/** Compose the selected battle model with the platform's server-only upstream snapshot. */
export function createAiModelConfig(
  upstream: AiUpstreamConfiguration,
  model: string,
  enableThinking = false,
  env: Readonly<Record<string, string | undefined>> = process.env
): AiModelConfig {
  const parsed = z
    .object({
      baseUrl: z.string().url(),
      model: z.enum(API_AI_BATTLE_MODELS),
      enableThinking: z.boolean(),
      apiKey: z
        .string()
        .min(1)
        .max(4096)
        .regex(/^[\x21-\x7E]+$/),
      temperature: z.coerce.number().min(0).max(2).default(0.2),
      maxTokens: z.coerce.number().int().min(128).optional(),
    })
    .safeParse({
      baseUrl: upstream.baseUrl,
      model,
      enableThinking,
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
    enableThinking: parsed.data.enableThinking,
    apiKey: parsed.data.apiKey,
    temperature: parsed.data.temperature,
    ...(parsed.data.maxTokens === undefined ? {} : { maxTokens: parsed.data.maxTokens }),
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

const CONTROL = [
  LIVE_PROBABILITY_QUERY_INSTRUCTIONS,
  '你参与 Loveca 规则模式对局。先读 decisionBrief：这里只统计当前可见资源，手牌印刷费用分布按实际张数，不含历史选牌或构筑参考。当前状态和候选引用是本次选择的边界；卡文描述能力，不保证本次有目标或收益。frontInfo.cardFactsRef 从 cardFacts 读取完整牌面，textRef 从 texts 读取原文；相同卡号的有效值可能不同，按各对象引用读取。',
  'MAIN 候选的 memberPlayRef 引用 space.memberPlays：每组仅一张手牌，actionRefs 是互斥位置选项，不是多张牌。common 与候选字段共同描述该动作，descriptionPrefix 加候选 description 是完整说明；未分组候选直接读取。选项仍用候选 ref 提交；不同动作的支付与手牌不能重复使用，刚登场成员本回合不能再被普通换手。',
  'context 是历史而非当前持牌：selectedCards 仅保留当时选牌身份，换牌的“换回卡组”不表示仍在手中。lastAction 若有 recentDecisionIndex，指向 recentDecisions 的该下标（从 0 起），不是另一次动作。resultSummary 是本次命令后的真实资源变化和已完成卡效结果，接受动作不等于获得预期收益。按实际结果重新检查路线，不复用旧引用。knownDeckTop 仍在主卡组，不是手牌，设置确认后才抽到的牌不能追加本次设置。',
  'selfResources.waitingRoomSummary 是己方休息室简表：成员名前数字为印刷费用，LIVE 名前数字为分数，括号内为卡号，×N 为张数。未知正面不猜测。activation.costs 是已查询费用，energyCost=0 不代表没有其他代价；targets 是支付来源费用后的可见目标，空列表不提供取得目标卡的收益，不能把构筑参考中的牌当成可回收对象。HAND 表示回手，成员仍需另付合法登场费用；SOURCE_MEMBER_SLOT 表示按能力直接登场。entryResources 仅覆盖已登记收益，缺项不代表无能力，conditionMet=false 不能计入该收益。',
  'stageAfterEntry 仅是静态成员替换小计；liveBaseBudget 比较当前舞台与单张 LIVE 基础需求，missingHearts 是缺口，不含未知声援、玩家额外 HEART、多 LIVE 或需求修正。总 HEART 足够不等于指定色足够，未知声援只表示机会。按通用教程和本局手册比较完整路线的实际收益。',
  'LIVE_SET 先读 decisionBrief.liveSet：先核对可唱目标，再确定近期必留牌，最后利用设置额度周转冗余。selection.cardRefs 表示本次确认时的最终盖牌完整集合：选择手牌候选会将其盖下，选择已盖候选会保留，不选择已盖候选会撤回；整组提交后系统立即确认并推进，不会让你逐张操作。printedCheerBaseline 是当前舞台与本构筑印刷声援的乐观基线，不是最终卡效结算；正缺口须指出可执行的补心、增声援或减需求来源，成功后的奖励不能提前补足成功条件。handMembers 按实例列出重复数量，保留多张须分别有近期位置、支付预算或能力用途；高费不自动等于衔接牌。最终盖牌数决定本次补抽，额外盖成员不耗能量，不以无LIVE或零能量停止周转。cardRefs 总张数不得超过 space.max（本次设置额度上限）：要表演的 LIVE、周转的成员与保留的已盖牌计入同一上限。超限、重复或引用不存在的候选会使整份输出无效，只能按保底策略降级，可能本轮一张都盖不下去，白白放弃表演与补抽。',
  'probabilityReference 是按 assumptions 计算的声援成功率参考，不是本轮赢分或整局胜率。范围反映成员周转与盖牌数差异；不能把上限直接套给任意盖牌。当前已知顶牌会先按补抽时点消费，其余牌均匀混合是近似，尤其注意洗成员回底等已知历史。未结算的补心、加刀、需求变化及重判须另行评价，printedScore也不含未来加分。比较单曲和不同多曲组合的得分与增量失败风险，不能仅因追加LIVE可能全败就排除，也不能只选最高成功率。对手已有两张成功LIVE时，先判断目标分数能否抵挡公开终结威胁，再考虑下轮留牌；唱成但输分仍可能立即输掉对局。',
  '比较方案时，同时考虑唱成后的赢分机会、失败后的后果，以及平局续战的资源价值。选择较低分的稳健方案，应说明该分数应对了哪些有公开依据的威胁、续局优势是什么；选择高风险方案，应说明额外分数改变了什么胜负结果。对手隐藏资源不明时保留不确定性，不默认对手拥有最强组合，不编造对手持牌概率，也不设固定的必赌成功率阈值。不直接以成功率乘分数决定动作；在预算结论中简述关键取舍即可。',
  '只输出JSON。只读查询使用readOnlyQuery.selectionSchema；最终动作使用当前 responseSchema：先写最多300字的 tradeoff 预算结论，再写与之对应的 selection（必填）。LIVE_SET 的预算结论包含：表演需求与可补心数、保留牌的使用回合/位置/支付、本次最终盖牌数与补抽数；仍有后续回合的合理预期时，使用 nextOwnMainBaseline 核对未来预算，不以当前剩余能量代替；printedPayments 是未计费用修正的差值，必需衔接可保留到第二轮，重复副本须各有用途。LIVE_SET 一次提交完整最终集合并立即确认，未用设置额度随确认作废，不能留到抽牌后使用；cardRefs 张数以 space.max 为硬上限，超出即整份无效。其他选择一次只提交一个当前动作；结束主要阶段说明放弃的最佳可见路线。不输出逐步推理，不发明卡牌、引用、命令或隐藏信息。',
].join('\n\n');

/** Shared production/QA assembly: variants change materials, never hand-written wire prompts. */
export function buildAiBattleMessages(
  input: AiDecisionInput,
  knowledge: AiFrozenKnowledge,
  includeStaticKnowledge = true
) {
  return [
    ...(includeStaticKnowledge ? [{ role: 'system' as const, content: CONTROL }] : []),
    ...(includeStaticKnowledge
      ? [knowledge.rules, knowledge.tutorial, knowledge.handbook, knowledge.ownDeck]
      : []
    ).map((source) => ({
      role: 'user' as const,
      content: `${source.title}\n${source.content}`,
    })),
    {
      role: 'user' as const,
      content: `本次决策；只使用本次引用\n${JSON.stringify({
        ...compactAiDecisionInput(input, knowledge.ownDeck),
        ...(input.purpose === 'LIVE_SET' && input.space.kind === 'CARDS'
          ? {
              readOnlyQuery: {
                maxBatches: 1,
                maxScenarios: 8,
                selectionSchema: liveProbabilityQuerySchema,
              },
            }
          : {}),
      })}`,
    },
  ];
}

/** One optional read-only batch between two model turns; rule execution stays in the driver. */
export class DashScopeAiBattleClient implements AiBattleModelClient {
  readonly configurationMaterial: AiKnowledgeMaterial;
  readonly requestTimeoutMs: number;
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
    this.requestTimeoutMs = config.enableThinking
      ? AI_THINKING_MODEL_TIMEOUT_MS
      : AI_MODEL_TIMEOUT_MS;
    this.knowledge = globalThis.structuredClone(knowledge);
    const content = JSON.stringify({
      provider: 'DASHSCOPE_COMPATIBLE',
      endpoint: config.endpoint,
      model: config.model,
      temperature: config.temperature,
      ...(config.maxTokens === undefined ? {} : { max_tokens: config.maxTokens }),
      enable_thinking: config.enableThinking,
      requestTimeoutMs: this.requestTimeoutMs,
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
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] =
      buildAiBattleMessages(input, this.knowledge);
    return withLiveProbabilityQuery(
      input,
      this.knowledge,
      signal,
      (exchange) => {
        const conversation = exchange
          ? [
              ...messages,
              { role: 'assistant' as const, content: exchange.requestText },
              { role: 'user' as const, content: liveProbabilityResultMessage(exchange) },
            ]
          : messages;
        return this.request(conversation, signal, context, exchange ? 1 : 0);
      },
      (stage, payload) => this.capture(context, stage, payload)
    );
  }

  private async request(
    messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
    signal: AbortSignal,
    context: AiModelRequestContext,
    queryRound: number
  ): Promise<AiModelOutcome> {
    const startedAt = this.now();
    const sources = [
      this.knowledge.rules,
      this.knowledge.tutorial,
      this.knowledge.handbook,
      this.knowledge.ownDeck,
    ];
    const body = JSON.stringify({
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      ...(this.config.maxTokens === undefined ? {} : { max_tokens: this.config.maxTokens }),
      enable_thinking: this.config.enableThinking,
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
        queryRound,
        endpoint: this.config.endpoint,
        // This string is the exact transmitted body. Auth headers never enter a capture payload.
        body: safeBody.text,
        redactionCount: safeBody.count,
        inputEncoding: 'DECISION_BRIEF_AND_GROUPED_MEMBER_PLAYS',
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
        ? parseAiTokenUsage((responseValue as Record<string, unknown>).usage, this.config.model)
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
        queryRound,
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
