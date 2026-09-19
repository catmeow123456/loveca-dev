/** Explicit real-model QA against visible local fixtures. Reads platform credentials; no business data is written. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createPlanningFixture } from './ai-battle-planning-fixture';
import { readFrozenGreenHasunosoraDeck } from './ai-curated-decks';
import {
  buildAiBattleDecision,
  type AiDecision,
  type AiSelection,
} from '../../src/server/ai-battle/decision';
import { AiBattleRuntime } from '../../src/server/ai-battle/runtime';
import { DashScopeAiBattleClient } from '../../src/server/ai-battle/model-client';
import { readAiModelConfig, validateAiUpstream } from '../../src/server/ai-battle/configuration';
import { pool } from '../../src/server/db/pool';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import type { AiFrozenKnowledge } from '../../src/server/ai-battle/presets';
import { toTransport } from '../../src/online/serde';
import { evaluatePlanningFullGames } from './ai-battle-planning-full';

if (process.env.AI_BATTLE_QA_MODEL_MODE !== 'REAL')
  throw new Error('Explicit REAL QA mode required');
const [out, mode = 'fixed'] = process.argv.slice(2);
if (!out || !['fixed', 'routes', 'full'].includes(mode))
  throw new Error('Usage: ai-battle-planning-evaluation.ts OUT_DIRECTORY [fixed|routes|full]');
mkdirSync(out, { recursive: true });
const resultsFile = path.join(out, 'results.jsonl');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const material = (
  id: string,
  title: string,
  source: string,
  content = readFileSync(source, 'utf8')
) => ({ id, title, source, content, sha256: hash(content) });
const deck = readFrozenGreenHasunosoraDeck().deck;
const counts = new Map<string, { card: (typeof deck.mainDeck)[number]; count: number }>();
for (const card of [...deck.mainDeck, ...deck.energyDeck])
  counts.set(card.cardCode, { card, count: (counts.get(card.cardCode)?.count ?? 0) + 1 });
const knowledge: AiFrozenKnowledge = {
  rules: material('rules', '规则说明', 'assets/ai-battle/rules.md'),
  tutorial: material('tutorial', '操作教程', 'assets/ai-battle/tutorial.md'),
  handbook: material(
    'green-handbook',
    '绿莲手册',
    'assets/ai-battle/handbooks/green-hasunosora-recovery.md'
  ),
  ownDeck: material(
    'deck:green-fixture',
    '本局卡牌参考',
    'FROZEN_LOCAL_TEST_CARD_FACTS',
    JSON.stringify(toTransport({ cards: [...counts.values()] }))
  ),
};
const config = await readAiModelConfig().finally(() => pool.end());
const knowledgeMaterials = [
  knowledge.rules,
  knowledge.tutorial,
  knowledge.handbook,
  knowledge.ownDeck,
];
writeFileSync(
  resultsFile,
  JSON.stringify({
    mode,
    model: config.model,
    startedAt: Date.now(),
    fixtureScope:
      mode === 'full'
        ? 'Two natural green mirror games with local frozen card facts and an opponent using only its own visible input; no original checkpoint.'
        : 'Logged visible own zones/public opponent board; local frozen card facts; no original checkpoint or hidden deck order. Known-top setup reexecutes captured choices as scripted preparation.',
    ...(mode === 'full'
      ? {}
      : {
          fixtureSha256: hash(readFileSync('tests/fixtures/ai-battle/f978-planning.json', 'utf8')),
        }),
    sources: knowledgeMaterials.map(({ id, sha256 }) => ({ id, sha256 })),
  }) + '\n',
  { flag: 'wx' }
);

type Fixture = ReturnType<typeof createPlanningFixture>;
function observation(f: Fixture, runtime: AiBattleRuntime) {
  const slice = f.session.getPublicEventsSliceSince(runtime.observedPublicSeq, 256);
  return {
    events: slice.publicEvents,
    throughPublicSeq: f.session.getCurrentPublicEventSeq(),
    droppedEventCount: slice.droppedEventCount,
  };
}
function decision(f: Fixture): AiDecision {
  for (let i = 0; i < 4; i++) {
    const q = buildAiBattleDecision(f.session.state!, 'ai', f.session.getPlayerViewState('ai')!);
    if (q.kind === 'WAITING_FOR_TIME') {
      f.advanceTime(q.deadlineAt + 1);
      continue;
    }
    if (q.kind !== 'DECISION') throw new Error(`Fixture ended unexpectedly: ${q.kind}`);
    return q.decision;
  }
  throw new Error('Display did not expire');
}
function observe(f: Fixture, runtime: AiBattleRuntime) {
  const d = decision(f);
  return runtime.observe(
    f.session.getCurrentPublicEventSeq(),
    `${d.input.purpose}:${f.session.state!.activeEffect?.id}`,
    { kind: 'DECISION', decision: d },
    f.session.getPlayerViewState('ai')!,
    observation(f, runtime)
  );
}
function submit(f: Fixture, runtime: AiBattleRuntime) {
  const commands = runtime.commands(f.now());
  for (const command of commands) {
    const result = f.session.executeCommand(command);
    runtime.record('AUTHORITY_RESULT', { success: result.success, error: result.error });
    if (!result.success) throw new Error(result.error);
  }
  runtime.accepted(f.session.getPlayerViewState('ai')!, observation(f, runtime));
  return commands.at(-1)!.type;
}
function scripted(f: Fixture, runtime: AiBattleRuntime, selection: AiSelection, tradeoff: string) {
  observe(f, runtime);
  runtime.resolve({ kind: 'RESPONSE', text: JSON.stringify({ selection, tradeoff }) });
  submit(f, runtime);
}

if (mode === 'full') {
  await evaluatePlanningFullGames(out, config, knowledge, deck);
  process.exit(0);
}
const cases = mode === 'fixed' ? ['111', '149', '151', '151-known-top'] : ['111', '149', '151'];
for (let repeat = 1; repeat <= (mode === 'fixed' ? 3 : 1); repeat++)
  for (const id of cases) {
    const f = createPlanningFixture(id === '151-known-top' ? '149' : id);
    const matchId = `${id}-${repeat}`;
    const traces = new AiBattleTraceStore();
    const model = new DashScopeAiBattleClient(
      config,
      knowledge,
      traces,
      globalThis.fetch,
      Date.now,
      undefined,
      validateAiUpstream
    );
    traces.open(matchId, [...knowledgeMaterials, model.configurationMaterial]);
    const runtime = new AiBattleRuntime('FIRST', () => {}, traces.bind(matchId));
    if (id === '151-known-top') {
      f.setTop(
        [
          'PL!HS-bp6-001-R+',
          'PL!HS-pb1-009-R',
          'PL!HS-pb1-020-N',
          'PL!HS-bp6-027-L',
          'PL!HS-bp5-001-SEC',
        ].map((code) => f.facts.get(code)!)
      );
      const d = decision(f);
      const candidate = d.input.space.candidates.find(
        (c) =>
          c.targetSlot === 'CENTER' &&
          c.objectId &&
          d.input.state.objects[c.objectId]?.frontInfo?.cardCode === 'PL!HS-bp6-001-R+'
      )!;
      scripted(
        f,
        runtime,
        { kind: 'ACTION', actionRef: candidate.ref },
        '支付2能量换中央花帆，检视整理顶牌，保留后续能力预算。'
      );
      const inspect = decision(f);
      const top = inspect.input.space.candidates.find(
        (c) =>
          c.objectId &&
          inspect.input.state.objects[c.objectId]?.frontInfo?.cardCode === 'PL!HS-bp6-027-L'
      )!;
      scripted(f, runtime, { kind: 'CARDS', cardRefs: [top.ref] }, '选择月夜见海月放回卡组顶。');
    }
    let calls = 0,
      status = 'STEP_LIMIT';
    for (let step = 0; step < 40; step++) {
      const result = observe(f, runtime);
      if (result?.kind === 'MODEL') {
        const start = Date.now();
        const outcome = await model.decide(result.task.input, AbortSignal.timeout(30_000), {
          matchId,
          ...result.task,
        });
        runtime.record('MODEL_OUTCOME', outcome);
        const resolved = runtime.resolve(outcome);
        const chosen = runtime.current?.prepared;
        const actionRef =
          chosen?.selection.kind === 'ACTION' ? chosen.selection.actionRef : undefined;
        const row = {
          id,
          repeat,
          step,
          elapsedMs: Date.now() - start,
          purpose: result.task.input.purpose,
          outcome,
          selected: chosen,
          knownTop: result.task.input.context?.knownDeckTop?.frontInfo.cardCode,
          resources: result.task.input.state.selfResources,
          candidate: actionRef
            ? result.task.input.space.candidates.find((c) => c.ref === actionRef)
            : undefined,
        };
        appendFileSync(resultsFile, JSON.stringify(row) + '\n');
        console.log(
          JSON.stringify({
            id,
            repeat,
            step,
            selection: chosen?.selection,
            tradeoff: chosen?.tradeoff,
          })
        );
        calls++;
        if (resolved || chosen?.source !== 'MODEL') {
          status = 'MODEL_FAILURE';
          break;
        }
      }
      const type = submit(f, runtime);
      if (mode === 'fixed') {
        status = 'FIRST_CHOICE_ACCEPTED';
        break;
      }
      if (type === 'END_PHASE') {
        status = 'MAIN_ENDED';
        break;
      }
    }
    runtime.end();
    writeFileSync(path.join(out, `${matchId}-trace.json`), JSON.stringify(traces.export(matchId)), {
      flag: 'wx',
    });
    appendFileSync(
      resultsFile,
      JSON.stringify({ id, repeat, status, calls, final: f.session.getPlayerViewState('ai') }) +
        '\n'
    );
  }
