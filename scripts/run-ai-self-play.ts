/** Explicit local API experiment. Validates the environment before importing database services. */
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, dirname, basename, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { API_AI_BATTLE_MODELS } from '../src/online/ai-battle-model-registry.js';
import { readLocalAiEnvironment } from '../src/server/ai-battle/local-ai-environment.js';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    out: { type: 'string' },
    previous: { type: 'string' },
    'reserve-unknown-cny': { type: 'string' },
    help: { type: 'boolean' },
  },
  strict: true,
});
if (values.help) {
  console.log(
    'Usage: pnpm exec tsx scripts/run-ai-self-play.ts --config CONFIG.json --out /outside/repo/round-N [--previous /round-N-1/result.json]'
  );
  process.exit(0);
}
if (!values.config || !values.out) throw new Error('--config and --out are required');
readLocalAiEnvironment(
  process.env,
  () => new Error('Self-play requires development, loopback API_HOST, local database and frontend')
);
const seatSchema = z
  .object({
    presetId: z.string().min(1),
    handbookId: z.string().min(1),
    model: z.enum(API_AI_BATTLE_MODELS),
    enableThinking: z.boolean().default(false),
    apiReasoningEffort: z.enum(['low', 'high', 'max']).optional(),
    // Only this trusted local file can select an experimental handbook; it never enters HTTP.
    handbookPath: z.string().optional(),
  })
  .strict();
const configText = await readFile(values.config, 'utf8');
const config = z
  .object({
    upstreamSource: z.enum(['platform', 'local-env']).default('platform'),
    FIRST: seatSchema,
    SECOND: seatSchema,
    maxCny: z.string().regex(/^\d+(\.\d{1,8})?$/),
    maxRequests: z.number().int().positive(),
    maxOutputTokens: z.number().int().min(128).max(16384).default(4096),
    maxDurationMs: z
      .number()
      .int()
      .positive()
      .default(30 * 60_000),
    maxCommands: z.number().int().positive().default(2000),
    seed: z.number().int().min(0).max(0xffffffff),
  })
  .strict()
  .parse(JSON.parse(configText));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let previous;
let previousResult: { path: string; sha256: string } | null = null;
if (values.previous) {
  const text = await readFile(values.previous, 'utf8');
  const result = z
    .object({
      format: z.literal('loveca-ai-self-play-v1'),
      budget: z.object({
        maxCny: z.literal(config.maxCny),
        // Additional rounds may extend the request cap without resetting cumulative usage.
        // The monetary ceiling remains fixed across the entire experiment.
        maxRequests: z.number().int().positive().max(config.maxRequests),
        estimatedCny: z.string(),
        attempts: z.number().int().nonnegative(),
        unreportedAttempts: z.number().int().nonnegative(),
        admittedRequests: z.number().int().nonnegative(),
        reservedUnknownCny: z.string().optional(),
        reservedUnknownAttempts: z.number().int().nonnegative().optional(),
      }),
    })
    .parse(JSON.parse(text));
  const unreserved =
    result.budget.unreportedAttempts - (result.budget.reservedUnknownAttempts ?? 0);
  if (unreserved > 0 && !values['reserve-unknown-cny'])
    throw new Error(
      'Previous usage is unknown; inspect its evidence and explicitly reserve its maximum possible CNY before continuing'
    );
  if (values['reserve-unknown-cny']) {
    const amount = Number(values['reserve-unknown-cny']);
    if (
      unreserved <= 0 ||
      !/^\d+(\.\d{1,8})?$/.test(values['reserve-unknown-cny']) ||
      !(amount > 0)
    )
      throw new Error(
        'Unknown usage reservation requires a positive CNY amount and unreserved failed requests'
      );
    result.budget.estimatedCny = (Number(result.budget.estimatedCny) + amount).toFixed(8);
    result.budget.reservedUnknownCny = (
      Number(result.budget.reservedUnknownCny ?? '0') + amount
    ).toFixed(8);
    result.budget.reservedUnknownAttempts = result.budget.unreportedAttempts;
  }
  previous = result.budget;
  previousResult = { path: resolve(values.previous), sha256: hash(text) };
}
if (values['reserve-unknown-cny'] && !values.previous)
  throw new Error('--reserve-unknown-cny requires --previous');
// Fail if the output already exists, before credentials or models are loaded.
const directory = resolve(values.out);
const repository = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const physicalOutput = join(await realpath(dirname(directory)), basename(directory));
const relation = relative(repository, physicalOutput);
if (
  relation === '' ||
  (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
)
  throw new Error('Self-play output must be outside this repository');
await mkdir(directory, { recursive: false, mode: 0o700 });
const { AiBattlePresetLoader } = await import('../src/server/ai-battle/presets.js');
const { readAiModelConfig, validateAiUpstream } =
  await import('../src/server/ai-battle/configuration.js');
const { DashScopeAiBattleClient, createAiModelConfig } =
  await import('../src/server/ai-battle/model-client.js');
const { AiSelfPlayBudget, runAiSelfPlay } = await import('../src/server/ai-battle/self-play.js');
const { OnlineMatchService } = await import('../src/server/services/online-match-service.js');
const { DecisionTapeRandomSource } = await import('../src/shared/random-source.js');
const { pool } = await import('../src/server/db/pool.js');
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
try {
  const budget = new AiSelfPlayBudget(config.maxCny, config.maxRequests, previous);
  const loader = new AiBattlePresetLoader();
  const load = async (seat: 'FIRST' | 'SECOND') => {
    const input = config[seat];
    if (input.apiReasoningEffort && input.model !== 'glm-5.3')
      throw new Error('This experiment currently supports API reasoning effort only for GLM-5.3');
    const setup = await loader.loadAi(input);
    let knowledge = setup.knowledge;
    if (input.handbookPath) {
      const content = await readFile(input.handbookPath, 'utf8');
      if (!content.trim()) throw new Error('Experimental handbook is empty');
      knowledge = {
        ...knowledge,
        handbook: {
          ...setup.knowledge.handbook,
          content,
          source: resolve(input.handbookPath),
          sha256: hash(content),
        },
      };
    }
    const sourceConfig =
      config.upstreamSource === 'local-env'
        ? {
            ...createAiModelConfig(
              {
                baseUrl: process.env.AI_BATTLE_BASE_URL ?? '',
                apiKey: process.env.AI_BATTLE_API_KEY ?? '',
              },
              input.model,
              input.enableThinking
            ),
            configurationSource: 'LOCAL_EXPERIMENT_ENV' as const,
          }
        : await readAiModelConfig(input.model, input.enableThinking);
    // This ledger uses Beijing DashScope list prices, so an arbitrary compatible provider
    // cannot silently receive the same budget estimate in a trusted local experiment.
    if (new URL(sourceConfig.endpoint).hostname !== 'dashscope.aliyuncs.com')
      throw new Error('Self-play CNY pricing requires the Beijing DashScope endpoint');
    const modelConfig = {
      ...sourceConfig,
      ...(input.apiReasoningEffort ? { apiReasoningEffort: input.apiReasoningEffort } : {}),
      maxTokens: config.maxOutputTokens,
    };
    await validateAiUpstream(modelConfig.endpoint);
    return {
      preset: setup.ai,
      knowledge,
      model: input.model,
      createModel: async (
        traces: import('../src/server/ai-battle/trace-store.js').AiBattleTraceStore,
        billing: import('../src/server/ai-battle/billing.js').AiBattleBilling
      ) =>
        new DashScopeAiBattleClient(
          modelConfig,
          knowledge,
          traces,
          globalThis.fetch,
          Date.now,
          billing,
          validateAiUpstream,
          (body) => budget.admit(body, billing, config.maxOutputTokens)
        ),
    };
  };
  const FIRST = await load('FIRST');
  const SECOND = await load('SECOND');
  let seed = config.seed;
  const tape = new DecisionTapeRandomSource(
    `self-play-v1:${seed}`,
    Array.from({ length: 100_000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    })
  );
  await writeFile(join(directory, 'config.json'), configText, { flag: 'wx', mode: 0o600 });
  const result = await runAiSelfPlay({
    FIRST,
    SECOND,
    directory,
    budget,
    signal: controller.signal,
    maxDurationMs: config.maxDurationMs,
    maxCommands: config.maxCommands,
    matches: new OnlineMatchService({ recorder: null, randomInt: tape.nextInt }),
    progress: (value) => console.log(JSON.stringify({ event: 'progress', ...value })),
  });
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify(
      { ...result, configSha256: hash(configText), previousResult, randomTape: tape.snapshot() },
      null,
      2
    ),
    { flag: 'wx', mode: 0o600 }
  );
  console.log(JSON.stringify({ event: 'finished', ...result }));
  if (!result.naturalEnd || result.stopReason) process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
  await pool.end();
}
