import {
  CodexObservedHistory,
  CodexObservedHistoryCapacityError,
} from './codex-observed-history.js';
import { createHash } from 'node:crypto';
import {
  CodexBattleSession,
  CodexContextLimitError,
  CODEX_SESSION_INSTRUCTIONS,
} from './codex-session.js';
import type { AiBattleModelClient, AiModelRequestContext } from './driver.js';
import {
  CODEX_AI_REASONING_EFFORTS,
  type CodexAiBattleModel,
  type CodexAiReasoningEffort,
} from '../../online/ai-battle-model-registry.js';
import { AiBattleSetupError, type AiFrozenKnowledge } from './presets.js';
import type { AiDecisionInput } from './protocol.js';
import type { AiModelOutcome } from './runtime.js';
import type { AiBattleTraceStore } from './trace-store.js';
import type { AiBattleBilling } from './billing.js';
import { buildAiBattleMessages } from './model-client.js';
import { readLocalCodexConfig, type LocalCodexConfig } from './local-codex-config.js';
import {
  executeCodexDecision,
  verifyCodexLogin,
  CodexInvocationNotStartedError,
} from './codex-process.js';

import { codexResponseSchema } from './codex-response-schema.js';
import {
  liveProbabilityResultMessage,
  withLiveProbabilityQuery,
  type LiveProbabilityExchange,
} from './live-probability-query.js';
export { codexResponseSchema } from './codex-response-schema.js';

export class CodexAiBattleClient implements AiBattleModelClient {
  get reasoningEffort(): CodexAiReasoningEffort {
    return this.config.reasoningEffort;
  }
  readonly requestTimeoutMs = 90_000;
  readonly stopOnTimeout = true;
  readonly configurationMaterial;
  readonly codexBudget;
  private readonly knowledge: AiFrozenKnowledge;
  private session?: CodexBattleSession;
  private readonly observedHistory?: CodexObservedHistory;
  private generation = 1;
  private readonly execute: typeof executeCodexDecision;
  private identity?: string;
  private completedTurns = 0;
  private busy = false;
  private closed = false;
  async dispose(): Promise<void> {
    this.closed = true;
    await this.session?.close();
  }
  constructor(
    private readonly config: LocalCodexConfig,
    private readonly model: CodexAiBattleModel,
    knowledge: AiFrozenKnowledge,
    private readonly traces: Pick<AiBattleTraceStore, 'append' | 'reportCaptureFailure'>,
    private readonly billing: AiBattleBilling,
    execute: typeof executeCodexDecision | undefined = undefined,
    private readonly verify: typeof verifyCodexLogin = verifyCodexLogin
  ) {
    this.knowledge = globalThis.structuredClone(knowledge);
    if (config.threadRotation) this.observedHistory = new CodexObservedHistory();
    this.codexBudget = config.budget ? Object.freeze({ ...config.budget }) : undefined;
    if (execute) this.execute = execute;
    else if (!config.sessionReuse) this.execute = executeCodexDecision;
    else {
      this.session = new CodexBattleSession(config, model);
      this.execute = (_config, _model, prompt, schema, signal) =>
        this.session!.decide(prompt, schema, signal);
    }
    const content = JSON.stringify({
      provider: 'LOCAL_CODEX',
      budget: this.codexBudget,
      model,
      reasoningEffort: config.reasoningEffort,
      authentication: 'CHATGPT_SUBSCRIPTION',
      timeoutMs: this.requestTimeoutMs,
      apiFallback: false,
      transport: config.sessionReuse ? 'EPHEMERAL_APP_SERVER_EXPERIMENT' : 'EPHEMERAL_EXEC',
      staticKnowledge: config.sessionReuse ? 'FIRST_TURN_OF_EACH_GENERATION' : 'EVERY_REQUEST',
      threadRotation: config.threadRotation === true,
      baseInstructions: CODEX_SESSION_INSTRUCTIONS,
    });
    this.configurationMaterial = {
      id: 'model-configuration',
      title: '本局模型配置',
      source: 'server:local-codex',
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  async decide(
    input: AiDecisionInput,
    signal: AbortSignal,
    context: AiModelRequestContext
  ): Promise<AiModelOutcome> {
    const identity = `${context.matchId}:${input.state.selfSeat}`;
    if (this.closed || this.busy || (this.identity !== undefined && this.identity !== identity))
      return { kind: 'ADAPTER_ERROR', message: 'Codex 会话已结束、忙碌或席位不匹配' };
    this.identity = identity;
    this.busy = true;
    try {
      return await withLiveProbabilityQuery(
        input,
        this.knowledge,
        signal,
        (exchange) => this.decideCurrent(input, signal, context, exchange),
        (stage, payload) => {
          try {
            this.traces.append(context.matchId, context.taskId, stage, {
              attempt: context.attempt,
              ...payload,
            });
          } catch {
            this.traces.reportCaptureFailure(context.matchId);
          }
        }
      );
    } finally {
      this.busy = false;
    }
  }

  private async decideCurrent(
    input: AiDecisionInput,
    signal: AbortSignal,
    context: AiModelRequestContext,
    exchange?: LiveProbabilityExchange
  ): Promise<AiModelOutcome> {
    const capture = (
      stage: string,
      payload: Record<string, unknown>,
      options?: Parameters<AiBattleTraceStore['append']>[4]
    ) => {
      try {
        this.traces.append(context.matchId, context.taskId, stage, payload, options);
      } catch {
        this.traces.reportCaptureFailure(context.matchId);
      }
    };
    const billing = this.billing.view();
    const usage = billing.usage;
    const totalInput =
      usage.inputTokens +
      usage.implicitCachedTokens +
      usage.explicitCachedTokens +
      usage.cacheCreationTokens;
    const reason =
      billing.unreportedAttempts > 0
        ? '用量未确认'
        : this.codexBudget?.maxCalls !== undefined && billing.attempts >= this.codexBudget.maxCalls
          ? '调用次数达到上限'
          : this.codexBudget?.maxInputTokens !== undefined &&
              totalInput >= this.codexBudget.maxInputTokens
            ? '累计输入达到上限'
            : this.codexBudget?.maxUncachedInputTokens !== undefined &&
                usage.inputTokens + usage.cacheCreationTokens >=
                  this.codexBudget.maxUncachedInputTokens
              ? '非缓存输入达到上限'
              : this.codexBudget?.maxOutputTokens !== undefined &&
                  usage.outputTokens >= this.codexBudget.maxOutputTokens
                ? '累计输出达到上限'
                : null;
    if (reason) {
      capture('BUDGET_STOP', {
        provider: 'LOCAL_CODEX',
        reason,
        budget: this.codexBudget,
        billing,
      });
      await this.dispose();
      return { kind: 'ADAPTER_ERROR', message: `Codex 预算保护：${reason}；未发送后续请求` };
    }
    try {
      if (!readLocalCodexConfig()) throw new Error('Local mode disabled');
      await this.verify(this.config, signal);
    } catch {
      await this.dispose();
      return {
        kind: 'ADAPTER_ERROR',
        message: '本地 Codex 环境、CLI 版本或 ChatGPT 登录检查失败；未调用其他 API',
      };
    }
    let handover: ReturnType<CodexObservedHistory['handover']> | undefined;
    try {
      this.observedHistory?.observe(input);
      const contextStatus = this.session?.contextStatus;
      if (
        this.observedHistory &&
        contextStatus?.lastContextTokens !== null &&
        contextStatus?.lastContextTokens !== undefined &&
        contextStatus.lastContextTokens >= contextStatus.stopAtTokens
      ) {
        handover = this.observedHistory.handover();
        this.session = await this.session!.createSuccessor();
        this.completedTurns = 0;
        this.generation++;
        capture('THREAD_ROTATION', {
          generation: this.generation,
          priorContext: contextStatus,
          observedEventCount: handover.events.length,
          unobservedEventCount: handover.unobservedEventCount,
        });
      }
    } catch (error) {
      if (error instanceof CodexObservedHistoryCapacityError) {
        capture('HISTORY_STOP', {
          reason: 'CAPACITY',
          attemptedBytes: error.attemptedBytes,
          limitBytes: error.limitBytes,
        });
        await this.dispose();
        return {
          kind: 'ADAPTER_ERROR',
          message: `Codex 公开历史容量超限：本次累计 ${error.attemptedBytes} 字节，上限 ${error.limitBytes} 字节；已停止，未裁剪历史或发送模型请求`,
        };
      }
      await this.dispose();
      return {
        kind: 'ADAPTER_ERROR',
        message: 'Codex 换线程历史不可用或超限，已停止；未裁剪历史、重试或重开对局',
      };
    }
    const includesStaticKnowledge = !this.config.sessionReuse || this.completedTurns === 0;
    // Reused thread already has this exact observation and query. A rotated/stateless thread
    // must receive the full current window plus the unexecuted query before the result.
    const queryContinuation = !!exchange && this.config.sessionReuse && !includesStaticKnowledge;
    const messages = queryContinuation
      ? []
      : buildAiBattleMessages(input, this.knowledge, includesStaticKnowledge);
    if (handover)
      messages.splice(messages.length - 1, 0, {
        role: 'user',
        content: `同一局同一席的新线程。以下仅为此前实际收到的公开事件，序号缺口未知，不得补造。历史身份不证明当前隐藏位置，旧计划不等于已执行；当前状态、context与合法引用以本次决策为准。\n${JSON.stringify(handover)}`,
      });
    if (exchange) {
      if (!queryContinuation)
        messages.push({
          role: 'user',
          content: `此前只读查询（不是已执行动作）：\n${exchange.requestText}`,
        });
      messages.push({ role: 'user', content: liveProbabilityResultMessage(exchange) });
    }
    // Restate the current window after long card text/history. This is a reminder,
    // not validation: the original parser still rejects stale refs or wrong shapes.
    const currentWindow = {
      turn: input.state.turn,
      phase: input.state.phase,
      purpose: input.purpose,
      selectionKind: input.space.kind,
    };
    const prompt = `${messages.map((message) => message.content).join('\n\n')}\n\n当前窗口摘要：只回答本窗口，引用取当前 space.candidates；历史卡效不代表当前任务。\n${JSON.stringify(currentWindow)}`;
    const promptBytes = Buffer.byteLength(prompt);
    if (promptBytes > 512 * 1024) {
      capture('CONTEXT_STOP', { reason: 'REQUEST_BYTES', promptBytes, limitBytes: 512 * 1024 });
      await this.dispose();
      return {
        kind: 'ADAPTER_ERROR',
        message: `Codex 单次请求容量超限：${promptBytes} 字节，上限 ${512 * 1024} 字节；未发送模型请求`,
      };
    }
    if (signal.aborted) return { kind: 'SERVICE_ERROR', message: 'Codex 已取消', retryable: false };
    let attempt: Awaited<ReturnType<AiBattleBilling['begin']>>;
    try {
      attempt = await this.billing.begin(context.taskId);
    } catch {
      return { kind: 'ADAPTER_ERROR', message: '用量记录保存失败，未发送 Codex 请求' };
    }
    if (signal.aborted) {
      await attempt.cancelBeforeSend();
      return { kind: 'SERVICE_ERROR', message: 'Codex 已取消', retryable: false };
    }
    const interrupted = () => attempt.interrupt();
    signal.addEventListener('abort', interrupted, { once: true });
    const schema = codexResponseSchema(input);
    capture(
      'REQUEST',
      {
        provider: 'LOCAL_CODEX',
        model: this.model,
        queryRound: exchange ? 1 : 0,
        prompt,
        schema,
        sessionTurn: this.completedTurns + 1,
        generation: this.generation,
        includesStaticKnowledge,
        contextMode: this.config.sessionReuse ? 'APPEND_TO_EPHEMERAL_THREAD' : 'STATELESS',
      },
      { attemptStarted: context.attempt }
    );
    try {
      const result = await this.execute(this.config, this.model, prompt, schema, signal);
      this.completedTurns++;
      await attempt.finish(result.usage);
      capture(
        'RESPONSE',
        {
          text: result.text,
          queryRound: exchange ? 1 : 0,
          usage: result.usage,
          cancelled: signal.aborted,
          context: this.session?.contextStatus,
        },
        { attemptFinished: context.attempt }
      );
      if (signal.aborted)
        return { kind: 'SERVICE_ERROR', message: 'Codex 已取消，忽略迟到结果', retryable: false };
      if (result.usage === null) {
        capture('BUDGET_STOP', {
          provider: 'LOCAL_CODEX',
          reason: '用量未确认',
          budget: this.codexBudget,
        });
        await this.dispose();
        return {
          kind: 'ADAPTER_ERROR',
          message: 'Codex 预算保护：本次用量未确认，已停止；返回内容未执行',
        };
      }
      return { kind: 'RESPONSE', text: result.text };
    } catch (error) {
      await this.dispose();
      if (error instanceof CodexInvocationNotStartedError) await attempt.cancelBeforeSend();
      else await attempt.finish(null);
      // CLI stderr may contain local paths/credentials. Do not export it or retry another provider.
      capture(
        'TRANSPORT_ERROR',
        {
          provider: 'LOCAL_CODEX',
          cancelled: signal.aborted,
          context: this.session?.contextStatus,
          reason: error instanceof CodexContextLimitError ? 'CONTEXT_GUARD' : 'TRANSPORT_FAILURE',
          diagnostics: this.session?.failureDiagnostics,
        },
        { attemptFinished: context.attempt }
      );
      return {
        kind: 'ADAPTER_ERROR',
        message:
          error instanceof CodexContextLimitError
            ? 'Codex 上下文保护已停止后续请求；未自动压缩或重开'
            : '本地 Codex 调用失败或已取消；未切换 API',
      };
    } finally {
      signal.removeEventListener('abort', interrupted);
    }
  }
}

export async function createLocalCodexClient(
  config: LocalCodexConfig | null,
  model: CodexAiBattleModel,
  knowledge: AiFrozenKnowledge,
  traces: AiBattleTraceStore,
  billing: AiBattleBilling,
  reasoningEffort?: CodexAiReasoningEffort
): Promise<CodexAiBattleClient> {
  if (!config) throw new AiBattleSetupError('AI_LOCAL_CODEX_DISABLED', '本地 Codex 尚未启用', 503);
  if (reasoningEffort !== undefined && !CODEX_AI_REASONING_EFFORTS.includes(reasoningEffort))
    throw new AiBattleSetupError('AI_REASONING_UNSUPPORTED', '不支持的 Codex 思考强度', 400);
  const frozenConfig = Object.freeze({
    ...config,
    reasoningEffort: reasoningEffort ?? config.reasoningEffort,
  });
  try {
    await verifyCodexLogin(frozenConfig);
  } catch {
    throw new AiBattleSetupError(
      'AI_CODEX_LOGIN_REQUIRED',
      '请确认本地 Codex CLI 可执行且已通过 ChatGPT 登录；不会使用 API Key',
      503
    );
  }
  return new CodexAiBattleClient(frozenConfig, model, knowledge, traces, billing);
}
