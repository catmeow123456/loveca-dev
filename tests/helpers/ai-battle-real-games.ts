/** Opt-in real-model sampling. Uses an isolated QA database and the normal service/recorder.
 * The USER seat is a fixed visible-input test policy, not a human playtester. Archive collection
 * is automatic; the policy never consumes AI observations, authority cards, or hidden deck order.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { DecisionTapeRandomSource } from '../../src/shared/random-source.js';
import { GameEndReason } from '../../src/shared/types/enums.js';
import { OnlineMatchService } from '../../src/server/services/online-match-service.js';
import { AiBattleService } from '../../src/server/services/ai-battle-service.js';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store.js';
import { DashScopeAiBattleClient } from '../../src/server/ai-battle/model-client.js';
import { readAiModelConfig, validateAiUpstream } from '../../src/server/ai-battle/configuration.js';
import { buildAiBattleDecision } from '../../src/server/ai-battle/decision.js';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy.js';
import { serializeAiEvidence, redactAiText } from '../../src/server/ai-battle/redaction.js';
import { pool } from '../../src/server/db/pool.js';
import { chooseAiTestSelection } from './ai-battle-test-policy.js';

const database = new URL(process.env.DATABASE_URL ?? 'about:blank');
if (
  process.env.AI_BATTLE_QA_MODEL_MODE !== 'REAL' ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !database.pathname.startsWith('/loveca_ai_qa_')
)
  throw new Error(
    'Real sampling requires explicit REAL mode and an isolated local loveca_ai_qa_* database'
  );

const args = process.argv.slice(2);
const argument = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1]!;
};
const start = Number(argument('--start', '0'));
const games = Number(argument('--games', '1'));
if (
  !Number.isInteger(start) ||
  start < 0 ||
  !Number.isInteger(games) ||
  games < 1 ||
  start + games > 6
)
  throw new Error('Expected a subset of six games: --start 0..5 --games 1..6');
const out = resolve(argument('--out', 'output/playwright/ai-battle/real-games'));
mkdirSync(out, { recursive: true });
const configuration = await readAiModelConfig();
const { rows: owners } = await pool.query<{ user_id: string }>(
  "SELECT id AS user_id FROM profiles WHERE username = 'test_admin' AND role = 'admin'"
);
const owner = owners[0]?.user_id;
if (!owner)
  throw new Error('The isolated QA database must contain test_admin with current admin role');
let interrupted = false;
process.on('SIGTERM', () => {
  interrupted = true;
});
process.on('SIGINT', () => {
  interrupted = true;
});

class SamplingTraceStore extends AiBattleTraceStore {
  readonly counts: Record<string, number> = {};
  readonly responseTimes: number[] = [];
  readonly acceptedSources: Record<string, number> = {};
  private readonly sources = new Map<string, string>();
  constructor(private readonly archive: string) {
    super();
    writeFileSync(archive, '', { flag: 'wx' });
  }
  override append(...args: Parameters<AiBattleTraceStore['append']>): void {
    super.append(...args);
    const [matchId, decisionId, stage, payload] = args;
    this.counts[stage] = (this.counts[stage] ?? 0) + 1;
    const data = payload as Record<string, unknown>;
    if (stage === 'REQUEST' && data.attempt === 1)
      this.counts.SERVICE_RETRY = (this.counts.SERVICE_RETRY ?? 0) + 1;
    if (
      stage === 'RESPONSE' &&
      typeof data.startedAt === 'number' &&
      typeof data.endedAt === 'number'
    )
      this.responseTimes.push(data.endedAt - data.startedAt);
    if (stage === 'SUBMIT') {
      const selection = data.selection as { source: string };
      this.sources.set(decisionId, selection.source);
    }
    if (stage === 'ACCEPTED') {
      const source = this.sources.get(decisionId) ?? 'UNKNOWN';
      this.acceptedSources[source] = (this.acceptedSources[source] ?? 0) + 1;
      this.sources.delete(decisionId);
    }
    // A QA artifact independent of bounded UI retention; never supplied to either decision policy.
    appendFileSync(
      this.archive,
      serializeAiEvidence({ matchId, decisionId, stage, at: Date.now(), payload }).text + '\n'
    );
  }
}

async function play(index: number): Promise<void> {
  const prefix = resolve(out, `game-${index + 1}`);
  writeFileSync(`${prefix}-started.json`, JSON.stringify({ index, at: Date.now() }), {
    flag: 'wx',
  });
  const humanSeat = index < 3 ? ('FIRST' as const) : ('SECOND' as const);
  let seed = 0x12345678;
  const tape = new DecisionTapeRandomSource(
    'ai-real-muse-v1-seed-12345678',
    Array.from({ length: 20_000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    })
  );
  const matches = new OnlineMatchService({ randomInt: tape.nextInt });
  const traces = new SamplingTraceStore(`${prefix}-events.jsonl`);
  const ai = new AiBattleService({
    matchService: matches,
    traces,
    createModel: (knowledge, store, model, billing, enableThinking) =>
      Promise.resolve(
        new DashScopeAiBattleClient(
          { ...configuration, model, enableThinking },
          knowledge,
          store,
          globalThis.fetch,
          Date.now,
          billing,
          validateAiUpstream
        )
      ),
  });
  const startedAt = Date.now();
  const { session } = await ai.create(owner!, {
    model: configuration.model,
    enableThinking: configuration.enableThinking,
    humanPresetId: 'muse-starter',
    aiPresetId: 'muse-starter',
    handbookId: 'muse-balanced',
    humanSeat,
  });
  const match = matches.getMatch(session.matchId)!;
  const playerId = match.participants[humanSeat].playerId;
  const initialTape = tape.snapshot();
  const initialCards = match.session.state!.players.map((player) =>
    [player.hand, player.mainDeck, player.energyDeck].map((zone) =>
      zone.cardIds.map((id) => match.session.state!.cardRegistry.get(id)!.data.cardCode)
    )
  );
  // Hash only; no authority contents are forwarded to the opponent policy or console.
  const initialCardsSha256 = createHash('sha256')
    .update(JSON.stringify(initialCards))
    .digest('hex');
  const commands: { type: string; purpose: string; turn: number; at: number }[] = [];
  const staleHumanConfirmations: {
    type: string;
    beforeRevision: number;
    afterRevision: number;
    error: string | undefined;
  }[] = [];
  let failure: string | null = null;
  let lastProgressAt = 0;
  console.log(
    JSON.stringify({
      event: 'game-started',
      index,
      humanSeat,
      matchId: session.matchId,
      model: configuration.model,
    })
  );
  try {
    while (!match.session.state!.isEnded) {
      if (interrupted) throw new Error('SAMPLING_INTERRUPTED');
      if (Date.now() - startedAt > 10 * 60_000 || commands.length >= 1500)
        throw new Error('QA_SAMPLING_TIMEOUT');
      const status = ai.getSession(owner!, session.matchId);
      if (status.stoppedReason) throw new Error(`AI_STOPPED:${status.stoppedReason}`);
      if (Date.now() - lastProgressAt > 15_000) {
        console.log(
          JSON.stringify({
            event: 'game-progress',
            index,
            turn: match.session.state!.turnCount,
            requests: traces.counts.REQUEST ?? 0,
            humanCommands: commands.length,
          })
        );
        lastProgressAt = Date.now();
      }
      const snapshot = await matches.getMatchSnapshot(session.matchId, owner!);
      if (!snapshot || snapshot.seq !== match.remoteRevision) continue;
      const query = buildAiBattleDecision(
        match.session.state!,
        playerId,
        match.session.getPlayerViewState(playerId)!
      );
      if (query.kind === 'UNSUPPORTED') throw new Error(`HUMAN_QUERY_UNSUPPORTED:${query.reason}`);
      if (query.kind === 'ENDED') break;
      if (query.kind !== 'DECISION') {
        await delay(100);
        continue;
      }
      const selection =
        getAiMechanicalSelection(query.decision) ?? chooseAiTestSelection(query.decision.input);
      if (selection.kind === 'ACTION') {
        const candidate = query.decision.input.space.candidates.find(
          (item) => item.ref === selection.actionRef
        )!;
        if (candidate.availableAt && candidate.availableAt > Date.now()) {
          await delay(Math.min(250, candidate.availableAt - Date.now()));
          continue;
        }
      }
      const command = query.decision.toCommand(selection, Date.now());
      const permission = snapshot.playerViewState.permissions.availableCommands.find(
        (hint) => hint.command === command.type
      );
      if (permission?.availability && permission.availability.availableAfterMs > 0) {
        await delay(Math.min(250, permission.availability.availableAfterMs));
        continue;
      }
      const turn = match.session.state!.turnCount;
      const result = await ai.command(owner!, session.matchId, command);
      if (
        !result?.success &&
        (query.decision.input.purpose === 'RULE_CONFIRM' ||
          query.decision.input.purpose === 'PUBLIC_DISPLAY') &&
        snapshot.seq !== match.remoteRevision
      ) {
        // Either participant may advance these shared windows. Re-sample only after proven
        // intervening authority progress; never retry a rejected choice against the same state.
        staleHumanConfirmations.push({
          type: command.type,
          beforeRevision: snapshot.seq,
          afterRevision: match.remoteRevision,
          error: result?.error,
        });
        continue;
      }
      if (!result?.success)
        throw new Error(`HUMAN_COMMAND_REJECTED:${command.type}:${result?.error}`);
      commands.push({
        type: command.type,
        purpose: query.decision.input.purpose,
        turn,
        at: Date.now(),
      });
    }
  } catch (error) {
    failure = redactAiText(error instanceof Error ? error.message : String(error)).text;
  } finally {
    const state = match.session.state!;
    const endInfo = state.endInfo;
    const natural =
      state.isEnded &&
      !!endInfo &&
      [GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW].includes(endInfo.reason);
    const turn = state.turnCount;
    const successCounts = state.players.map((player) => player.successZone.cardIds.length);
    const statusBeforeEnd = ai.getSession(owner!, session.matchId);
    await ai.end(owner!, session.matchId);
    const bundle = ai.exportDecisions(owner!, session.matchId);
    writeFileSync(`${prefix}-export.json`, JSON.stringify(bundle, null, 2), { flag: 'wx' });
    const { rows } = await pool.query<Record<string, unknown>>(
      'SELECT match_id, origin_kind, status, completeness, winner_seat, end_reason, turn_count, last_command_seq, sealed_at, partial_reason FROM match_records WHERE match_id = $1',
      [session.matchId]
    );
    const result = {
      format: 'loveca-ai-real-game-v1',
      index,
      matchId: session.matchId,
      humanSeat,
      opponent: 'SCRIPTED_VISIBLE_INPUT_POLICY',
      observationAccess: 'AUTOMATIC_QA_ARCHIVE_NOT_CONSUMED_BY_OPPONENT',
      model: configuration.model,
      initialCardsSha256,
      initialTape,
      finalTape: tape.snapshot(),
      startedAt,
      endedAt: Date.now(),
      natural,
      endInfo,
      turn,
      successCounts,
      failure,
      statusBeforeEnd,
      counts: traces.counts,
      responseTimesMs: traces.responseTimes,
      acceptedSources: traces.acceptedSources,
      humanCommands: commands,
      staleHumanConfirmations,
      record: rows[0],
      retention: {
        evictedDecisions: bundle.evictedDecisions,
        omittedDecisions: bundle.omittedDecisions,
        discardedLateUpdates: bundle.discardedLateUpdates,
        captureFailures: bundle.captureFailures,
      },
      incompleteMaterialIds: bundle.incompleteMaterialIds,
    };
    writeFileSync(`${prefix}-result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(
      JSON.stringify({
        event: 'game-ended',
        index,
        natural,
        failure,
        turn,
        counts: traces.counts,
        acceptedSources: traces.acceptedSources,
        record: rows[0],
      })
    );
  }
}

try {
  for (let index = start; index < start + games && !interrupted; index++) await play(index);
} finally {
  await pool.end();
}
