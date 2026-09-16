/** Offline preparation: never reads credentials, sends requests or touches a game. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AiTraceExport } from '../src/online/ai-battle-observation-types';
import { prepareAiEvaluation } from '../tests/helpers/ai-battle-evaluation';

const { values } = parseArgs({
  options: {
    export: { type: 'string' },
    decisions: { type: 'string' },
    'alternate-handbook': { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});
if (!values.export || !values.decisions || !values['alternate-handbook'] || !values.out)
  throw Error('Required: --export PATH --decisions ID,ID --alternate-handbook PATH --out PATH');
const bundle = JSON.parse(await readFile(values.export, 'utf8')) as AiTraceExport;
const handbookPath = values['alternate-handbook'];
const content = await readFile(handbookPath, 'utf8');
const plan = prepareAiEvaluation(bundle, values.decisions.split(','), {
  id: 'evaluation-handbook-b',
  title: content.split('\n')[0]!.replace(/^#\s*/u, ''),
  source: handbookPath,
  sha256: createHash('sha256').update(content).digest('hex'),
  content,
});
await mkdir(path.dirname(values.out), { recursive: true });
// Refuse accidental replacement of a reviewed plan or a file containing completed results.
await writeFile(values.out, JSON.stringify(plan, null, 2), { flag: 'wx' });
console.log(
  JSON.stringify({
    output: values.out,
    cases: plan.cases.map(({ id, purpose, candidateCount, inputSha256 }) => ({
      id,
      purpose,
      candidateCount,
      inputSha256,
    })),
    pendingSamples: plan.samples.length,
    requestsSent: 0,
  })
);
