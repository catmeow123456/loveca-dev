import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  buildAiBattleDecision,
  materializeAiDecisionCommands,
} from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { AiBattleRuntime } from '../../src/server/ai-battle/runtime';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import { validateAiUpstream } from '../../src/server/ai-battle/configuration';
import {
  DashScopeAiBattleClient,
  type AiModelConfig,
} from '../../src/server/ai-battle/model-client';
import type { AiFrozenKnowledge } from '../../src/server/ai-battle/presets';
import { chooseAiTestSelection } from './ai-battle-test-policy';

/** Two isolated natural games. The opponent uses only its own visible decision input. */
export async function evaluatePlanningFullGames(
  out: string,
  config: AiModelConfig,
  knowledge: AiFrozenKnowledge,
  deck: DeckConfig
): Promise<void> {
  const resultsFile = path.join(out, 'results.jsonl');
  for (const aiSeat of ['FIRST', 'SECOND'] as const) {
    const matchId = `full-${aiSeat}`;
    let now = 1000,
      seed = aiSeat === 'FIRST' ? 0x12345678 : 0x87654321;
    const session = createGameSession({
      now: () => now,
      randomInt: (max) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % max;
      },
    });
    const players = aiSeat === 'FIRST' ? ['ai', 'human'] : ['human', 'ai'];
    session.createGame(matchId, players[0]!, 'First', players[1]!, 'Second');
    if (!session.initializeGame(deck, deck).success) throw new Error('Initialization failed');
    const archive = path.join(out, `${matchId}-events.jsonl`);
    writeFileSync(archive, '', { flag: 'wx' });
    class Archive extends AiBattleTraceStore {
      override append(...args: Parameters<AiBattleTraceStore['append']>): void {
        super.append(...args);
        const [, decisionId, stage, payload] = args;
        appendFileSync(archive, JSON.stringify({ decisionId, stage, payload }) + '\n');
      }
    }
    const traces = new Archive();
    const model = new DashScopeAiBattleClient(
      config,
      knowledge,
      traces,
      globalThis.fetch,
      Date.now,
      undefined,
      validateAiUpstream
    );
    traces.open(matchId, [
      knowledge.rules,
      knowledge.tutorial,
      knowledge.handbook,
      knowledge.ownDeck,
      model.configurationMaterial,
    ]);
    const runtime = new AiBattleRuntime(aiSeat, () => {}, traces.bind(matchId));
    const observation = () => {
      const slice = session.getPublicEventsSliceSince(runtime.observedPublicSeq, 256);
      return {
        events: slice.publicEvents,
        throughPublicSeq: session.getCurrentPublicEventSeq(),
        droppedEventCount: slice.droppedEventCount,
      };
    };
    let calls = 0,
      accepted = 0,
      mechanical = 0,
      status = 'STEP_LIMIT';
    for (let step = 0; step < 1800 && calls < 180; step++) {
      if (session.state!.isEnded) {
        status = 'NATURAL_END';
        break;
      }
      const view = session.getPlayerViewState('ai')!;
      const q = buildAiBattleDecision(session.state!, 'ai', view);
      const result = runtime.observe(
        step,
        `${session.state!.turnCount}:${q.kind}:${session.state!.activeEffect?.id}`,
        q,
        view,
        observation()
      );
      if (result?.kind === 'MODEL') {
        const outcome = await model.decide(result.task.input, AbortSignal.timeout(30_000), {
          matchId,
          ...result.task,
        });
        runtime.record('MODEL_OUTCOME', outcome);
        const resolution = runtime.resolve(outcome);
        calls++;
        const selected = runtime.current?.prepared;
        const row = {
          matchId,
          step,
          call: calls,
          turn: session.state!.turnCount,
          purpose: result.task.input.purpose,
          outcome,
          selected,
        };
        appendFileSync(resultsFile, JSON.stringify(row) + '\n');
        console.log(JSON.stringify(row));
        if (resolution || selected?.source !== 'MODEL') {
          status = 'MODEL_FAILURE';
          break;
        }
      } else if (result?.kind === 'STOPPED') {
        status = result.reason;
        break;
      }
      if (runtime.current?.prepared) {
        if (runtime.current.prepared.source === 'MECHANICAL') mechanical++;
        for (const command of runtime.commands(now)) {
          const result = session.executeCommand(command);
          runtime.record('AUTHORITY_RESULT', { success: result.success, error: result.error });
          if (!result.success) throw new Error(result.error);
        }
        runtime.accepted(session.getPlayerViewState('ai')!, observation());
        accepted++;
        now += 10;
        continue;
      }
      const human = buildAiBattleDecision(
        session.state!,
        'human',
        session.getPlayerViewState('human')!
      );
      if (human.kind === 'DECISION') {
        const selection =
          getAiMechanicalSelection(human.decision) ?? chooseAiTestSelection(human.decision.input);
        for (const command of materializeAiDecisionCommands(human.decision, selection, now)) {
          const result = session.executeCommand(command);
          if (!result.success) throw new Error(result.error);
        }
        now += 10;
      } else if (q.kind === 'WAITING_FOR_TIME' || human.kind === 'WAITING_FOR_TIME') {
        now =
          Math.max(
            now,
            q.kind === 'WAITING_FOR_TIME' ? q.deadlineAt : 0,
            human.kind === 'WAITING_FOR_TIME' ? human.deadlineAt : 0
          ) + 1;
      } else {
        status = `NO_PROGRESS:${q.kind}:${human.kind}`;
        break;
      }
    }
    runtime.end();
    const result = {
      matchId,
      status,
      calls,
      accepted,
      mechanical,
      turn: session.state!.turnCount,
      endInfo: session.state!.endInfo,
      note: 'Normal GameSession/AI runtime/client; deterministic visible-input opponent and local fixture card facts. No OnlineMatchService/recorder/DB or human strength claim.',
    };
    appendFileSync(resultsFile, JSON.stringify(result) + '\n');
    writeFileSync(path.join(out, `${matchId}-result.json`), JSON.stringify(result, null, 2), {
      flag: 'wx',
    });
    writeFileSync(path.join(out, `${matchId}-trace.json`), JSON.stringify(traces.export(matchId)), {
      flag: 'wx',
    });
    console.log(JSON.stringify(result));
  }
}
