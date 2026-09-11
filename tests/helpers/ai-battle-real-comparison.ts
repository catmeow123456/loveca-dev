/** Offline, explicit real requests for a hash-verified fixed-input plan. No match or command
 * execution. The production client still owns normal six-message assembly; this QA experiment
 * sends the plan's recorded message variants and archives the actual bytes it sends.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { z } from 'zod';
import { readAiModelConfig, validateAiUpstream } from '../../src/server/ai-battle/configuration.js';
import { pool } from '../../src/server/db/pool.js';
import {
  parseAiBattleResponse,
  type AiDecisionInput,
} from '../../src/server/ai-battle/protocol.js';
import { redactAiText } from '../../src/server/ai-battle/redaction.js';
import type { prepareAiEvaluation } from './ai-battle-evaluation.js';

if (process.env.AI_BATTLE_QA_MODEL_MODE !== 'REAL')
  throw new Error('Explicit REAL QA mode required');
const [planPath, outputPath] = process.argv.slice(2);
if (!planPath || !outputPath)
  throw new Error('Usage: ai-battle-real-comparison.ts PLAN.json OUTPUT.jsonl');
const planText = readFileSync(planPath, 'utf8');
const plan = JSON.parse(planText) as ReturnType<typeof prepareAiEvaluation>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
if (plan.format !== 'loveca-ai-fixed-input-plan-v1' || plan.commandExecution !== 'NONE')
  throw new Error('Unsupported comparison plan');
const configuration = await readAiModelConfig().finally(() => pool.end());
const modelParameters = {
  model: configuration.model,
  temperature: configuration.temperature,
  max_tokens: configuration.maxTokens,
  enable_thinking: false,
  response_format: { type: 'json_object' },
  stream: false,
};
const envelope = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
        finish_reason: z.string(),
      })
    )
    .min(1),
});
writeFileSync(
  outputPath,
  JSON.stringify({
    format: 'loveca-ai-real-comparison-v1',
    planSha256: hash(planText),
    endpoint: configuration.endpoint,
    modelParameters,
    startedAt: Date.now(),
    commandExecution: 'NONE',
  }) + '\n',
  { flag: 'wx' }
);

async function readResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    bytes += chunk.value.byteLength;
    if (bytes > 256 * 1024) {
      await reader.cancel();
      throw new Error('QA_RESPONSE_LIMIT');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

for (const sample of plan.samples) {
  const inputCase = plan.cases.find((item) => item.id === sample.caseId)!;
  const comparison = inputCase.comparisons.find((item) => item.variant === sample.variant)!;
  if (
    hash(inputCase.inputJson) !== inputCase.inputSha256 ||
    hash(JSON.stringify(comparison.messages)) !== comparison.messagesSha256 ||
    comparison.messages.at(-1)?.content !== `本次决策；只使用本次引用\n${inputCase.inputJson}`
  )
    throw new Error('Frozen input or message hash mismatch');
  const input = JSON.parse(inputCase.inputJson) as AiDecisionInput;
  const body = JSON.stringify({ ...modelParameters, messages: comparison.messages });
  if (Buffer.byteLength(body) > 512 * 1024 || redactAiText(body, [configuration.apiKey]).count > 0)
    throw new Error('Request is oversized or would require redaction');
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(30_000);
    let rawResponse: string | null = null;
    let httpStatus: number | null = null;
    let requestId: string | null = null;
    let finishReason: string | null = null;
    let responseContent: string | null = null;
    let error: string | null = null;
    let status: 'SERVICE_ERROR' | 'INVALID_RESPONSE' | 'VALID_SELECTION' = 'SERVICE_ERROR';
    let parsed: ReturnType<typeof parseAiBattleResponse> | null = null;
    let retryable = false;
    try {
      await validateAiUpstream(configuration.endpoint);
      const response = await globalThis.fetch(configuration.endpoint, {
        method: 'POST',
        body,
        signal,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${configuration.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      httpStatus = response.status;
      requestId = response.headers.get('x-request-id');
      rawResponse = redactAiText(await readResponse(response), [configuration.apiKey]).text;
      if (!response.ok) {
        retryable = response.status === 429 || response.status >= 500;
        throw new Error(`HTTP_${response.status}`);
      }
      status = 'INVALID_RESPONSE';
      const result = envelope.parse(JSON.parse(rawResponse));
      finishReason = result.choices[0]!.finish_reason;
      responseContent = result.choices[0]!.message.content;
      if (finishReason !== 'stop') throw new Error(`FINISH_${finishReason}`);
      parsed = parseAiBattleResponse({ input }, responseContent);
      status = 'VALID_SELECTION';
    } catch (caught) {
      error = redactAiText(caught instanceof Error ? caught.message : String(caught), [
        configuration.apiKey,
      ]).text;
      if (httpStatus === null && !signal.aborted) retryable = true;
    }
    const endedAt = Date.now();
    const willRetry = attempt === 0 && status === 'SERVICE_ERROR' && retryable;
    appendFileSync(
      outputPath,
      JSON.stringify({
        ...sample,
        status,
        attempt,
        willRetry,
        startedAt,
        endedAt,
        elapsedMs: endedAt - startedAt,
        inputSha256: inputCase.inputSha256,
        endpoint: configuration.endpoint,
        body,
        bodySha256: hash(body),
        httpStatus,
        requestId,
        rawResponse,
        finishReason,
        responseContent,
        parsed,
        error,
        commandExecution: 'NONE',
      }) + '\n'
    );
    console.log(
      JSON.stringify({
        sample: sample.id,
        status,
        attempt,
        elapsedMs: endedAt - startedAt,
        willRetry,
      })
    );
    if (!willRetry) break;
  }
}
