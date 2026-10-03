import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { runAiSelfPlay, AiSelfPlayBudget } from '../../src/server/ai-battle/self-play';
import { deck } from '../helpers/ai-battle-fixture';
import { chooseAiTestSelection } from '../helpers/ai-battle-test-policy';
import type { AiFrozenKnowledge } from '../../src/server/ai-battle/presets';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';
import { parseEvidence } from '../../.agents/skills/loveca-ai-match-review/scripts/archive.mjs';

it('exports both complete seat archives after stopping, including final player projections and no writes after close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loveca-self-play-'));
  const controller = new AbortController();
  const knowledge = Object.fromEntries(
    ['rules', 'tutorial', 'handbook', 'ownDeck'].map((id) => [
      id,
      {
        id,
        title: id,
        source: 'test',
        content: 'frozen test material',
        sha256: createHash('sha256').update('frozen test material').digest('hex'),
      },
    ])
  ) as unknown as AiFrozenKnowledge;
  let count = 0;
  const seat = () => ({
    preset: {
      id: 'synthetic',
      name: 'synthetic',
      deck: deck(),
      yaml: knowledge.ownDeck,
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
    },
    knowledge,
    model: 'glm-5.3' as const,
    createModel: async () => ({
      decide: async (input: AiDecisionInput) => {
        if (++count === 3) {
          controller.abort();
          return { kind: 'ADAPTER_ERROR' as const, message: 'test stop' };
        }
        return {
          kind: 'RESPONSE' as const,
          text: JSON.stringify({ selection: chooseAiTestSelection(input) }),
        };
      },
    }),
  });
  try {
    const result = await runAiSelfPlay({
      FIRST: seat(),
      SECOND: seat(),
      directory,
      budget: new AiSelfPlayBudget('200', 100),
      signal: controller.signal,
      maxDurationMs: 5000,
    });
    expect(result.naturalEnd).toBe(false);
    expect(result.stopReason).toBeTruthy();
    for (const name of ['FIRST', 'SECOND'] as const) {
      const record = result.seats[name];
      expect(record.archiveStatus?.state).toBe('ENDED');
      expect(record.archiveStatus?.droppedRecords).toBe(0);
      const text = await readFile(record.exportPath!, 'utf8');
      expect(JSON.parse(text.split('\n')[0]).payload.completeThroughExport).toBe(true);
      const data = parseEvidence(text);
      expect(data.captureFailures).toBe(0);
      expect(
        data.decisions.some(
          (decision: { id: string; seat: string }) => decision.id === `${name}:final`
        )
      ).toBe(true);
      expect(
        data.decisions.every((decision: { id: string; seat: string }) => decision.seat === name)
      ).toBe(true);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
