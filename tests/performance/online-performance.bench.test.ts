import { describe, expect, it } from 'vitest';
import { createMulliganCommand } from '../../src/application/game-commands';
import { projectPlayerViewState } from '../../src/online/projector';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { serializeReplayPayload } from '../../src/server/services/replay-payload-serialization';
import type { OnlineMatchSnapshot } from '../../src/online';
import {
  RUN_PERF,
  SAMPLE_COUNT,
  WARMUP_COUNT,
  byteLength,
  createRuntimeDeck,
  measure,
  measureAsync,
} from './performance-bench-helpers';

const describePerf = RUN_PERF ? describe : describe.skip;

async function createOnlineMatch(): Promise<{
  matchService: OnlineMatchService;
  matchId: string;
}> {
  const matchService = new OnlineMatchService({ recorder: null });
  const match = await matchService.createMatch({
    roomCode: 'PERF01',
    first: {
      userId: 'u1',
      displayName: 'Alpha',
      deck: createRuntimeDeck('A'),
    },
    second: {
      userId: 'u2',
      displayName: 'Beta',
      deck: createRuntimeDeck('B'),
    },
  });

  return { matchService, matchId: match.matchId };
}

describePerf('online match performance benchmark', () => {
  it('measures formal online JSON-native snapshot and command response hot paths', async () => {
    const { matchService, matchId } = await createOnlineMatch();
    const match = matchService.getMatch(matchId);
    expect(match?.session.state).toBeTruthy();
    const firstSnapshot = (await matchService.getMatchSnapshot(
      matchId,
      'u1'
    )) as OnlineMatchSnapshot;
    expect(firstSnapshot.playerViewState.objects).toBeTruthy();
    const playerId = match!.participants.FIRST.playerId;
    const authorityState = match!.session.state!;
    const authorityClone = match!.session.getAuthoritySnapshotForRecord();
    expect(authorityClone).toBeTruthy();
    const checkpointEnvelope = serializeReplayPayload(
      authorityClone,
      'AUTHORITY_GAME_STATE',
      GAME_STATE_SCHEMA_VERSION
    );

    const snapshotEnvelope = { data: firstSnapshot, error: null };
    const snapshotJson = JSON.stringify(snapshotEnvelope);
    const snapshotBytes = Buffer.byteLength(snapshotJson, 'utf8');
    const objectCount = Object.keys(firstSnapshot.playerViewState.objects).length;
    const zoneCount = Object.keys(firstSnapshot.playerViewState.table.zones).length;

    const commandResult = await matchService.executeCommand(
      matchId,
      'u1',
      createMulliganCommand('client-player-id-is-ignored', [])
    );
    expect(commandResult?.success).toBe(true);
    expect(commandResult?.snapshot).toBeTruthy();

    const afterCommandSeq = commandResult?.snapshot?.seq ?? firstSnapshot.seq;
    const unchangedStats = await measureAsync('snapshot unchanged short-circuit', async () => {
      const response = await matchService.getMatchSnapshot(matchId, 'u1', {
        sinceSeq: afterCommandSeq,
      });
      if (!response || !('modified' in response)) {
        throw new Error('Expected unchanged snapshot response');
      }
    });

    const fullSnapshotStats = await measureAsync('snapshot full projection', async () => {
      const response = (await matchService.getMatchSnapshot(matchId, 'u1')) as OnlineMatchSnapshot;
      if (!response.playerViewState) {
        throw new Error('Expected full snapshot response');
      }
    });

    const snapshotResponseRoundTripStats = measure('snapshot response JSON round-trip', () => {
      JSON.parse(JSON.stringify(snapshotEnvelope)) as unknown;
    });

    const commandResponseEnvelope = { data: commandResult, error: null };
    const commandResponseBytes = byteLength(commandResponseEnvelope);
    const commandResponseRoundTripStats = measure('command response JSON round-trip', () => {
      JSON.parse(JSON.stringify(commandResponseEnvelope)) as unknown;
    });
    const directProjectionStats = measure('projectPlayerViewState(direct authority)', () => {
      projectPlayerViewState(authorityState, playerId, {
        seq: match!.remoteRevision,
        gameMode: match!.session.gameMode,
      });
    });
    const authorityCloneStats = measure('getAuthoritySnapshotForRecord clone', () => {
      match!.session.getAuthoritySnapshotForRecord();
    });
    const cloneThenProjectStats = measure('clone + projectPlayerViewState', () => {
      const cloned = match!.session.getAuthoritySnapshotForRecord();
      if (!cloned) {
        throw new Error('Expected authority state clone');
      }
      projectPlayerViewState(cloned, playerId, {
        seq: match!.remoteRevision,
        gameMode: match!.session.gameMode,
      });
    });
    const checkpointSerializationStats = measure(
      'serializeReplayPayload(authority checkpoint)',
      () => {
        serializeReplayPayload(authorityClone, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION);
      }
    );

    console.log('\nOnline performance benchmark');
    console.table({
      config: {
        samples: SAMPLE_COUNT,
        warmup: WARMUP_COUNT,
        objects: objectCount,
        zones: zoneCount,
        snapshotBytes,
        commandResponseBytes,
        authorityCheckpointBytes: byteLength(checkpointEnvelope),
      },
    });
    console.table([
      unchangedStats,
      fullSnapshotStats,
      snapshotResponseRoundTripStats,
      commandResponseRoundTripStats,
      directProjectionStats,
      authorityCloneStats,
      cloneThenProjectStats,
      checkpointSerializationStats,
    ]);
  });
});
