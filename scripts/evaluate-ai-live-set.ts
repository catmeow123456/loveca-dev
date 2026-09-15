/** Fixed-input QA only. Preparation is offline; --run explicitly uses the user's DashScope env.
 * No platform settings, accounts, live matches or game commands are written by this runner.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { prepareAiEvaluation } from '../tests/helpers/ai-battle-evaluation';
import { expandAiDecisionInput } from '../tests/helpers/ai-model-input';
import { createLiveSetFixture } from '../tests/helpers/ai-battle-live-set-fixture';
import { buildAiBattleDecision } from '../src/server/ai-battle/decision';
import { buildAiBattleMessages, createAiModelConfig } from '../src/server/ai-battle/model-client';
import {
  parseAiBattleResponse,
  responseSchema,
  type AiDecisionInput,
} from '../src/server/ai-battle/protocol';
import { redactAiText } from '../src/server/ai-battle/redaction';
import type { AiFrozenKnowledge, AiKnowledgeMaterial } from '../src/server/ai-battle/presets';
import type { AiTraceExport } from '../src/online/ai-battle-observation-types';

const { values } = parseArgs({
  options: {
    export: { type: 'string' },
    out: { type: 'string' },
    run: { type: 'boolean', default: false },
    model: { type: 'string', default: 'deepseek-v4.1-flash' },
  },
  strict: true,
});
if (!values.export || !values.out)
  throw new Error('Usage: --export MATCH.json --out DIRECTORY [--run] [--model MODEL]');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const material = (id: string, source: string): AiKnowledgeMaterial => {
  const content = readFileSync(source, 'utf8');
  return {
    id,
    source,
    title: content.split('\n')[0]!.replace(/^#\s*/, ''),
    content,
    sha256: hash(content),
  };
};
const tutorial = material('tutorial', 'assets/ai-battle/tutorial.md');
const handbook = material(
  'blue-purple-nijigasaki-tempo',
  'assets/ai-battle/handbooks/blue-purple-nijigasaki-tempo.md'
);
const bundle = JSON.parse(readFileSync(values.export, 'utf8')) as AiTraceExport;
// The four reviewed windows have the normal three-card limit. This explicit offline derivation
// supplements old captured inputs; runtime inputs query the actual rule allowance instead.
if (bundle.matchId !== '8233fb6f-023e-4467-8e75-41997824aae6')
  throw new Error('This evaluation requires the reviewed 8233fb6f export');
const captured = prepareAiEvaluation(bundle, ['11', '12', '25', '26'], handbook);
const oldControl = captured.cases[0]!.comparisons.find((item) => item.variant === 'HANDBOOK_A')!
  .messages[0]!;
const oldSources = captured.cases[0]!.sources;
const frozenKnowledge: AiFrozenKnowledge = {
  rules: oldSources[0]!,
  tutorial: oldSources[1]!,
  handbook: oldSources[2]!,
  ownDeck: oldSources[3]!,
};
const newKnowledge: AiFrozenKnowledge = { ...frozenKnowledge, tutorial, handbook };
type Message = { role: 'system' | 'user'; content: string };
type Case = {
  id: string;
  scope: string;
  input: AiDecisionInput;
  expectedActionRefs: string[];
  variants: { name: 'OLD' | 'NEW'; messages: Message[]; sha256: string }[];
};
const variant = (name: 'OLD' | 'NEW', messages: Message[]): Case['variants'][number] => ({
  name,
  messages,
  sha256: hash(JSON.stringify(messages)),
});
const cases: Case[] = captured.cases.map((item) => {
  const oldWire = JSON.parse(item.inputJson) as Record<string, unknown>;
  const decoded = expandAiDecisionInput(oldWire);
  const zone = Object.values(decoded.state.table.zones).find(
    (entry) => entry.ownerSeat === decoded.state.selfSeat && entry.zone === 'LIVE_ZONE'
  )!;
  const setCount = zone.count;
  const input = {
    ...decoded,
    responseSchema: responseSchema(decoded.space),
    liveSet: {
      setCardObjectIds: [...(zone.objectIds ?? [])],
      setCount,
      setLimit: 3,
      remainingSetCount: 3 - setCount,
      drawCountOnConfirm: setCount,
    },
  };
  const hand = input.state.selfResources.handCards;
  const expectedActionRefs = input.space.candidates
    .filter((candidate) => {
      const member = hand.find((card) => card.objectId === candidate.objectId);
      // Cover redundant terminals, or undo the reviewed harmful set before rebuilding the set.
      return (
        (member?.printedCost ?? 0) >= 11 ||
        (candidate.objectId !== undefined &&
          input.liveSet.setCardObjectIds.includes(candidate.objectId))
      );
    })
    .map((candidate) => candidate.ref);
  return {
    id: item.id,
    scope:
      'Captured visible facts and candidate order; new allowance explicitly reconstructed as 3 from the reviewed window.',
    input,
    expectedActionRefs,
    variants: [
      variant('OLD', item.comparisons.find((entry) => entry.variant === 'HANDBOOK_A')!.messages),
      variant('NEW', buildAiBattleMessages(input, newKnowledge)),
    ],
  };
});
for (const kind of ['KEEP_BRIDGES', 'CHEER_POSSIBLE'] as const) {
  const f = createLiveSetFixture(kind);
  const query = buildAiBattleDecision(f.session.state!, 'ai', f.session.getPlayerViewState('ai')!);
  if (query.kind !== 'DECISION') throw new Error(`Missing counterexample decision ${kind}`);
  const input = query.decision.input;
  const knowledge = { ...newKnowledge, ownDeck: f.ownDeck };
  const newMessages = buildAiBattleMessages(input, knowledge);
  const oldMessages: Message[] = [
    oldControl,
    ...[frozenKnowledge.rules, frozenKnowledge.tutorial, frozenKnowledge.handbook, f.ownDeck].map(
      (source) => ({ role: 'user' as const, content: `${source.title}\n${source.content}` })
    ),
    // Both counterexample conditions receive identical current facts; only prompt materials differ.
    newMessages.at(-1)!,
  ];
  cases.push({
    id: kind,
    scope:
      'Synthetic visible-resource counterexample using frozen local card facts; not an original checkpoint.',
    input,
    expectedActionRefs: [
      input.space.candidates[kind === 'KEEP_BRIDGES' ? input.space.candidates.length - 1 : 0]!.ref,
    ],
    variants: [variant('OLD', oldMessages), variant('NEW', newMessages)],
  });
}
const samples = Array.from({ length: 3 }, (_, repeat) =>
  cases.flatMap((item) =>
    (repeat % 2 ? ['NEW', 'OLD'] : ['OLD', 'NEW']).map((name) => ({
      caseId: item.id,
      variant: name,
      repeat: repeat + 1,
    }))
  )
).flat();
mkdirSync(values.out, { recursive: true });
const plan = {
  format: 'loveca-ai-live-set-evaluation-v1',
  sourceMatchId: bundle.matchId,
  model: values.model,
  commandExecution: 'NONE',
  cases,
  samples,
};
const planText = JSON.stringify(plan, null, 2);
writeFileSync(path.join(values.out, 'plan.json'), planText, { flag: 'wx' });
console.log(
  JSON.stringify({
    prepared: cases.length,
    pendingSamples: samples.length,
    planSha256: hash(planText),
    requestsSent: 0,
  })
);
if (values.run) {
  const config = createAiModelConfig(
    { baseUrl: process.env.DASHSCOPE_BASE_URL ?? '', apiKey: process.env.DASHSCOPE_API_KEY ?? '' },
    values.model!,
    false,
    { AI_BATTLE_TEMPERATURE: '0.2', AI_BATTLE_MAX_TOKENS: '2048' }
  );
  // This explicit QA runner is scoped to the user-configured Aliyun upstream.
  if (new URL(config.endpoint).hostname !== 'dashscope.aliyuncs.com')
    throw new Error('Expected the configured DashScope endpoint');
  const resultPath = path.join(values.out, 'results.jsonl');
  const parameters = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    enable_thinking: false,
    stream: false,
    response_format: { type: 'json_object' },
  };
  writeFileSync(
    resultPath,
    JSON.stringify({
      planSha256: hash(planText),
      endpoint: config.endpoint,
      parameters,
      startedAt: Date.now(),
      commandExecution: 'NONE',
    }) + '\n',
    { flag: 'wx' }
  );
  const run = async (sample: (typeof samples)[number]) => {
    const item = cases.find((entry) => entry.id === sample.caseId)!;
    const comparison = item.variants.find((entry) => entry.name === sample.variant)!;
    if (hash(JSON.stringify(comparison.messages)) !== comparison.sha256)
      throw new Error('Message hash mismatch');
    const body = JSON.stringify({ ...parameters, messages: comparison.messages });
    if (Buffer.byteLength(body) > 512 * 1024 || redactAiText(body, [config.apiKey]).count)
      throw new Error('Unsafe QA request');
    const startedAt = Date.now();
    let raw: string | null = null;
    let httpStatus: number | null = null;
    let parsed: ReturnType<typeof parseAiBattleResponse> | null = null;
    let error: string | null = null;
    let status = 'SERVICE_ERROR';
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      httpStatus = response.status;
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 256 * 1024) {
          await reader.cancel();
          throw new Error('QA_RESPONSE_LIMIT');
        }
        chunks.push(next.value);
      }
      raw = redactAiText(Buffer.concat(chunks).toString('utf8'), [config.apiKey]).text;
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      status = 'INVALID_RESPONSE';
      const completion = JSON.parse(raw);
      if (completion.choices?.[0]?.finish_reason !== 'stop')
        throw new Error('Response did not finish normally');
      parsed = parseAiBattleResponse({ input: item.input }, completion.choices[0].message.content);
      status = 'VALID_SELECTION';
    } catch (caught) {
      error = redactAiText(caught instanceof Error ? caught.message : String(caught), [
        config.apiKey,
      ]).text;
    }
    const passed =
      parsed?.selection.kind === 'ACTION' &&
      item.expectedActionRefs.includes(parsed.selection.actionRef);
    const result = {
      ...sample,
      status,
      passed,
      elapsedMs: Date.now() - startedAt,
      body,
      bodySha256: hash(body),
      httpStatus,
      raw,
      parsed,
      error,
      commandExecution: 'NONE',
    };
    appendFileSync(resultPath, JSON.stringify(result) + '\n');
    console.log(JSON.stringify({ ...sample, status, passed, elapsedMs: result.elapsedMs, error }));
    return result;
  };
  // Small bounded concurrency; failures are recorded, not silently replaced by successful retries.
  const results = [];
  for (let index = 0; index < samples.length; index += 2) {
    const batch = await Promise.all(samples.slice(index, index + 2).map(run));
    results.push(...batch);
    if (index === 0 && batch.every((result) => result.httpStatus === null))
      throw new Error(
        'Upstream unavailable for both initial requests; remaining samples were not sent'
      );
  }
  const totals = ['OLD', 'NEW'].map((name) => ({
    variant: name,
    cases: cases.map((item) => {
      const selected = results.filter(
        (result) => result.variant === name && result.caseId === item.id
      );
      return {
        id: item.id,
        passed: selected.filter((result) => result.passed).length,
        valid: selected.filter((result) => result.status === 'VALID_SELECTION').length,
        samples: selected.length,
      };
    }),
  }));
  writeFileSync(path.join(values.out, 'summary.json'), JSON.stringify(totals, null, 2), {
    flag: 'wx',
  });
  console.log(JSON.stringify(totals));
}
