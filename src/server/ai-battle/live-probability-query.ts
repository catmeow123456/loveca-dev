import { z } from 'zod';
import { HeartColor } from '../../shared/types/enums.js';
import type { AiDecisionInput } from './protocol.js';
import type { AiFrozenKnowledge } from './presets.js';
import type { AiModelOutcome } from './runtime.js';
import { estimateAiLiveSets } from './live-probability-summary.js';

export const LIVE_PROBABILITY_QUERY = 'LIVE_PROBABILITY_QUERY';
const count = z.number().int().min(0).max(120);
const querySelection = z.strictObject({
  kind: z.literal(LIVE_PROBABILITY_QUERY),
  scenarios: z
    .array(
      z.strictObject({
        id: z
          .string()
          .min(1)
          .max(32)
          .regex(/^[a-zA-Z0-9_-]+$/),
        cardRefs: z.array(z.string().min(1).max(128)).min(1).max(3),
        additionalHearts: z.array(z.strictObject({ color: z.enum(HeartColor), count })).max(9),
        additionalCheer: count,
        assumptionNote: z.string().max(160),
      })
    )
    .min(1)
    .max(8),
});
const queryEnvelope = z.strictObject({
  selection: querySelection,
  tradeoff: z.string().max(300),
});
// This is provider-only output, never an authority command or a public player protocol.
const generatedSchema = z.toJSONSchema(querySelection, { target: 'draft-7' });
delete generatedSchema.$schema;
// Use enum like the existing Codex wire schema. Keep this schema stable between windows.
generatedSchema.properties!.kind = { type: 'string', enum: [LIVE_PROBABILITY_QUERY] };
export const liveProbabilityQuerySchema = generatedSchema;

export interface LiveProbabilityExchange {
  readonly requestText: string;
  readonly resultText: string;
}

export const LIVE_PROBABILITY_QUERY_INSTRUCTIONS =
  '仅 LIVE_SET 可以用 selection.kind=LIVE_PROBABILITY_QUERY 发起一批只读条件查询（最多8组，每窗口最多一批）；不需要查询时直接提交最终选择。每组填 id、cardRefs（完整最终盖牌，含成员）、additionalHearts（[{color,count}]，无补心用[]，颜色不得重复）、additionalCheer（额外声援次数，无则0）、assumptionNote（补心/加刀来源、费用与成立条件）。HEART颜色使用PINK/RED/YELLOW/GREEN/BLUE/PURPLE/ORANGE/GRAY/RAINBOW；GRAY只计总量，RAINBOW为ALL，不把任意选色误当ALL。只填尚未计入当前资源的增量，不重复计算已成立加成。程序不核验假设卡效是否合法，也不执行盖牌或付费；返回结果后必须提交原格式最终selection，不再查询。必要时把不同补心颜色、歌组、追加声援一并比较；无需逐组往返。查询后的模型回复仍消耗一次调用，已有基线足以决策时不要查询。';

export function liveProbabilityResultMessage(exchange: LiveProbabilityExchange): string {
  return `本窗口只读批量概率查询结果；局面未推进，没有执行任何盖牌或卡效。假设由你提出且未验证，只能在费用、时点、选色确实成立时用于比较；不是胜率，分数仍须另算未来加分。查询额度已用完，请使用本窗口原候选提交最终 ACTION/CARDS selection，禁止再次查询。\n${exchange.resultText}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readQuery(outcome: AiModelOutcome): Record<string, unknown> | null {
  if (outcome.kind !== 'RESPONSE' || outcome.truncated) return null;
  try {
    const value: unknown = JSON.parse(outcome.text);
    return isRecord(value) &&
      isRecord(value.selection) &&
      value.selection.kind === LIVE_PROBABILITY_QUERY
      ? value
      : null;
  } catch {
    return null;
  }
}

/** One optional batch, then one final answer, under the caller's unchanged window/signal/deadline. */
export async function withLiveProbabilityQuery(
  input: AiDecisionInput,
  knowledge: AiFrozenKnowledge,
  signal: AbortSignal,
  request: (exchange?: LiveProbabilityExchange) => Promise<AiModelOutcome>,
  capture: (stage: string, payload: Record<string, unknown>) => void
): Promise<AiModelOutcome> {
  const first = await request();
  const raw = readQuery(first);
  if (!raw) return first;
  if (signal.aborted)
    return { kind: 'SERVICE_ERROR', message: 'Probability query cancelled', retryable: false };
  if (input.purpose !== 'LIVE_SET' || input.space.kind !== 'CARDS') {
    capture('LIVE_PROBABILITY_REJECTED', { reason: 'NOT_LIVE_SET' });
    return { kind: 'RESPONSE', text: '' }; // Original invalid-output fallback; never execute a query.
  }
  const parsed = queryEnvelope.safeParse(raw);
  let result: Record<string, unknown>;
  if (!parsed.success) result = { status: 'INVALID_QUERY', reason: 'INVALID_QUERY_SHAPE' };
  else {
    const scenarios = parsed.data.selection.scenarios;
    if (
      new Set(scenarios.map((s) => s.id)).size !== scenarios.length ||
      scenarios.some(
        (s) => new Set(s.additionalHearts.map((h) => h.color)).size !== s.additionalHearts.length
      )
    )
      result = { status: 'INVALID_QUERY', reason: 'DUPLICATE_ID_OR_COLOR' };
    else {
      const plans = scenarios.map((s) => ({
        finalSetRefs: s.cardRefs,
        assumptions: {
          additionalHearts: Object.fromEntries(s.additionalHearts.map((h) => [h.color, h.count])),
          additionalCheer: s.additionalCheer,
        },
      }));
      const results = estimateAiLiveSets(input, knowledge.ownDeck, plans);
      result = {
        status: 'RESULT',
        assumptionsVerified: false,
        basis: 'CONDITIONAL_UNIFORM_REMAINDER_NOT_WIN_PROBABILITY',
        limitation:
          '未知剩余牌按均匀混合；未重建历史底牌群。仅印刷判心与当前已成立数值及本次假设，未来需求修正、重判和加分不自动模拟。',
        scenarios: scenarios.map((s, i) => ({ ...s, result: results[i] })),
      };
    }
  }
  capture('LIVE_PROBABILITY_QUERY', { request: raw });
  capture('LIVE_PROBABILITY_RESULT', result);
  if (signal.aborted)
    return { kind: 'SERVICE_ERROR', message: 'Probability query cancelled', retryable: false };
  const final = await request({
    requestText: (first as Extract<AiModelOutcome, { kind: 'RESPONSE' }>).text,
    resultText: JSON.stringify(result),
  });
  if (signal.aborted)
    return { kind: 'SERVICE_ERROR', message: 'Probability result superseded', retryable: false };
  if (readQuery(final)) {
    capture('LIVE_PROBABILITY_REJECTED', { reason: 'QUERY_ALREADY_USED' });
    return { kind: 'RESPONSE', text: '' };
  }
  // A failed continuation must not restart the whole query sequence via the service retry.
  return final.kind === 'SERVICE_ERROR' ? { ...final, retryable: false } : final;
}
