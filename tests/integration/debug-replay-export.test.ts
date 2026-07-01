import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Request, Response } from 'express';
import type { DeckConfig } from '../../src/application/game-service';
import { createMulliganCommand } from '../../src/application/game-commands';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { CardType, GamePhase, HeartColor } from '../../src/shared/types/enums';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import type { DebugReplayBundle } from '../../src/online/replay-types';
import { onlineRouter } from '../../src/server/routes/online';
import {
  OnlineMatchService,
  onlineMatchService,
} from '../../src/server/services/online-match-service';
import {
  DebugReplayService,
  createDebugReplayBundle,
  debugReplayService,
} from '../../src/server/services/debug-replay-service';
import {
  compressLegacyReplayPayloadEnvelopeForMigration,
  rehydrateAuthorityGameState,
} from '../../src/server/services/replay-payload-serialization';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

const HISTORY_REPLAY_EXPORT_FIXTURE =
  'data/20260628-cst_history-replay-export/loveca-match-SOL-9ae2482c-e7b7-4e54-95dd-6aa7b1c3ea1e-0d341246-0044-4e39-b5cc-73bdf28f12f8.replay.json.gz';

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createRuntimeDeck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let index = 0; index < 48; index += 1) {
    mainDeck.push(createTestMemberCard(`${prefix}-MEM-${index}`, `${prefix} 成员 ${index}`));
  }

  for (let index = 0; index < 12; index += 1) {
    mainDeck.push(createTestLiveCard(`${prefix}-LIVE-${index}`, `${prefix} Live ${index}`));
    energyDeck.push(createTestEnergyCard(`${prefix}-ENE-${index}`));
  }

  return { mainDeck, energyDeck };
}

async function createOnlineMatch() {
  const matchService = new OnlineMatchService({ recorder: null });
  return matchService.createMatch({
    roomCode: 'REPLAY1',
    startedAt: 1_000,
    first: {
      userId: 'u1',
      displayName: 'Alpha',
      deckId: 'deck-a',
      deckName: 'Alpha Deck',
      lockedAt: 900,
      deck: createRuntimeDeck('A'),
    },
    second: {
      userId: 'u2',
      displayName: 'Beta',
      deckId: 'deck-b',
      deckName: 'Beta Deck',
      lockedAt: 950,
      deck: createRuntimeDeck('B'),
    },
  });
}

function createMockResponse() {
  const response = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return response as Response & {
    statusCode: number;
    body: {
      data: unknown;
      error: { code: string; message: string } | null;
    } | null;
  };
}

function findRouteLayer(path: string, method: 'get' | 'post') {
  const layer = onlineRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route;
}

describe('debug replay export', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    debugReplayService.clear();
  });

  it('从运行中 match 导出 E0a debug replay bundle，并可复水投影 authority checkpoint', async () => {
    const match = await createOnlineMatch();
    const bundle = createDebugReplayBundle(match, 2_000);

    expect(bundle.recordSchemaVersion).toBe(1);
    expect(bundle.bundleSchemaVersion).toBe(1);
    expect(bundle.serializer).toBe('TRANSPORT_V1');
    expect(bundle.capabilities).toContain('AUTHORITY_CHECKPOINT');
    expect(bundle.capabilities).toContain('GAME_EVENTS_SNAPSHOT');
    expect(bundle.limitations).toEqual(
      expect.arrayContaining([
        'SINGLE_CHECKPOINT_ONLY',
        'LIMITED_TIMELINE',
        'NO_DETERMINISTIC_REPLAY',
        'NOT_USER_HISTORY_RECORD',
      ])
    );
    expect(bundle.deckSnapshots[0].sourceDeckId).toBe('deck-a');
    expect(bundle.deckSnapshots[0].mainDeck).toHaveLength(60);
    expect(bundle.checkpoints).toHaveLength(1);

    const checkpoint = bundle.checkpoints[0];
    expect(checkpoint.checkpointSeq).toBe(1);
    expect(checkpoint.timelineSeq).toBe(bundle.recordFrames.at(-1)?.timelineSeq);
    expect(checkpoint.payloadEnvelope.payloadKind).toBe('AUTHORITY_GAME_STATE');
    expect(checkpoint.payloadEnvelope.compression).toBe('GZIP');
    expect(checkpoint.payloadEnvelope.encoding).toBe('BASE64_JSON');
    expect(typeof checkpoint.payloadEnvelope.payload).toBe('string');
    expectContainsNoNativeMap(bundle);

    const parsedBundle = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    const rehydrated = rehydrateAuthorityGameState(parsedBundle.checkpoints[0].payloadEnvelope);
    const playerView = projectPlayerViewState(rehydrated, match.participants.FIRST.playerId);
    const opponentHiddenCardId = rehydrated.players[1].hand.cardIds[0];

    expect(rehydrated.cardRegistry).toBeInstanceOf(Map);
    expect(playerView.objects[createPublicObjectId(opponentHiddenCardId)]).toBeUndefined();
  });

  it('管理员导出路由受 requireAdmin 保护，并返回 bundle', async () => {
    const route = findRouteLayer('/admin/matches/:matchId/debug-replay/export', 'post');
    const requireAdmin = route.stack.at(1)?.handle as (
      req: Request,
      res: Response,
      next: () => void
    ) => void;
    const handler = route.stack.at(-1)?.handle as (req: Request, res: Response) => void;
    const forbiddenResponse = createMockResponse();
    const next = vi.fn();

    requireAdmin({ user: { id: 'u1', role: 'user' } } as Request, forbiddenResponse, next);

    expect(forbiddenResponse.statusCode).toBe(403);
    expect(forbiddenResponse.body?.error?.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();

    const match = await createOnlineMatch();
    vi.spyOn(onlineMatchService, 'getMatch').mockReturnValue(match);

    const response = createMockResponse();
    await handler(
      {
        params: { matchId: match.matchId },
        user: { id: 'admin', role: 'admin' },
      } as Request,
      response
    );

    expect(response.statusCode).toBe(200);
    expect(response.body?.error).toBeNull();
    expect((response.body?.data as { checkpoints: unknown[] }).checkpoints).toHaveLength(1);
  });

  it('管理员导入路由受 requireAdmin 保护', () => {
    const route = findRouteLayer('/admin/debug-replay/import', 'post');
    const requireAdmin = route.stack.at(1)?.handle as (
      req: Request,
      res: Response,
      next: () => void
    ) => void;
    const forbiddenResponse = createMockResponse();
    const next = vi.fn();

    requireAdmin({ user: { id: 'u1', role: 'user' } } as Request, forbiddenResponse, next);

    expect(forbiddenResponse.statusCode).toBe(403);
    expect(forbiddenResponse.body?.error?.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('E0b 导入 bundle 后可只读读取 timeline 与指定座位 checkpoint 投影', async () => {
    const match = await createOnlineMatch();
    const bundle = JSON.parse(JSON.stringify(createDebugReplayBundle(match, 2_000)));
    const service = new DebugReplayService({ now: () => 3_000 });

    const imported = service.importBundle(bundle);
    expect(imported.checkpointCount).toBe(1);
    expect(imported.timelineFrameCount).toBe(bundle.recordFrames.length);
    expect(imported.limitations).toContain('NOT_USER_HISTORY_RECORD');

    const timeline = service.getTimeline(imported.bundleId);
    expect(timeline.recordFrames).toHaveLength(bundle.recordFrames.length);
    expect(JSON.stringify(timeline)).not.toContain('payloadEnvelope');

    const checkpointView = service.getCheckpointView(imported.bundleId, 1, 'FIRST');
    const rehydrated = rehydrateAuthorityGameState(bundle.checkpoints[0].payloadEnvelope);
    const opponentHiddenCardId = rehydrated.players[1].hand.cardIds[0];

    expect(checkpointView.viewerSeat).toBe('FIRST');
    expect(checkpointView.checkpointInfo.checkpointSeq).toBe(1);
    expect(checkpointView.playerViewState.match.viewerSeat).toBe('FIRST');
    expect(
      checkpointView.playerViewState.objects[createPublicObjectId(opponentHiddenCardId)]
    ).toBeUndefined();
    expect(JSON.stringify(checkpointView)).not.toContain('payloadEnvelope');
    expect(JSON.stringify(checkpointView)).not.toContain('__transportType');
  });

  it('旧归档历史 replay bundle 经迁移后可导入，并按双方座位读取只读投影', () => {
    const bundle = migrateLegacyFixtureBundleForTest(
      JSON.parse(gunzipSync(readFileSync(HISTORY_REPLAY_EXPORT_FIXTURE)).toString())
    );
    const service = new DebugReplayService({ now: () => 1_782_632_740_000 });

    const imported = service.importBundle(bundle);

    expect(imported.sourceMatch.exportedStatus).toBe('HISTORY_RECORD');
    expect(imported.sourceMatch.roomCode).toBe('SOL-9ae2482c-e7b7-4e54-95dd-6aa7b1c3ea1e');
    expect(imported.checkpointCount).toBe(23);
    expect(imported.timelineFrameCount).toBe(26);
    expect(imported.limitations).not.toContain('NOT_USER_HISTORY_RECORD');
    expect(imported.limitations).toContain('SOLITAIRE_AUTOMATION_COMPRESSED');

    const timeline = service.getTimeline(imported.bundleId);
    expect(timeline.recordFrames).toHaveLength(26);
    expect(JSON.stringify(timeline)).not.toContain('payloadEnvelope');

    const firstCheckpoint = service.getCheckpointView(imported.bundleId, 23, 'FIRST');
    const secondCheckpoint = service.getCheckpointView(imported.bundleId, 23, 'SECOND');

    expect(firstCheckpoint.playerViewState.match.viewerSeat).toBe('FIRST');
    expect(secondCheckpoint.playerViewState.match.viewerSeat).toBe('SECOND');
    expect(firstCheckpoint.checkpointInfo.visibilityScope).toBe('ADMIN');
    expect(secondCheckpoint.checkpointInfo.visibilityScope).toBe('ADMIN');
    expect(JSON.stringify(firstCheckpoint)).not.toContain('payloadEnvelope');
    expect(JSON.stringify(secondCheckpoint)).not.toContain('payloadEnvelope');
  });

  it('导入时校验 payload hash，篡改 bundle 会被拒绝', async () => {
    const match = await createOnlineMatch();
    const bundle = JSON.parse(JSON.stringify(createDebugReplayBundle(match, 2_000)));
    const service = new DebugReplayService({ now: () => 3_000 });
    bundle.checkpoints[0].payloadEnvelope.payloadHash = 'sha256:bad';

    expect(() => service.importBundle(bundle)).toThrow('replay payload hash 校验失败');
  });

  it('导入时校验规则版本与卡牌数据 hash，不把不兼容 bundle 作为可读回放载入', async () => {
    const match = await createOnlineMatch();
    const bundle = JSON.parse(JSON.stringify(createDebugReplayBundle(match, 2_000)));
    const service = new DebugReplayService({ now: () => 3_000 });

    expect(() =>
      service.importBundle({
        ...bundle,
        rulesVersion: 'OLD_RULES',
      })
    ).toThrow('调试回放规则版本不兼容');

    expect(() =>
      service.importBundle({
        ...bundle,
        cardDataHash: 'sha256:bad',
      })
    ).toThrow(/卡牌数据 hash/);
  });

  it('record frame 阶段元数据使用对应 publicSeq 快照，checkpoint frame 才使用导出时状态', async () => {
    const match = await createOnlineMatch();
    const firstMulligan = match.session.executeCommand(
      createMulliganCommand(match.participants.FIRST.playerId, [])
    );
    expect(firstMulligan.success).toBe(true);

    const secondMulligan = match.session.executeCommand(
      createMulliganCommand(match.participants.SECOND.playerId, [])
    );
    expect(secondMulligan.success).toBe(true);

    const bundle = createDebugReplayBundle(match, 2_000);
    const firstCommandFrame = bundle.recordFrames.find((frame) => frame.relatedCommandSeq === 1);
    const checkpointFrame = bundle.recordFrames.find((frame) => frame.relatedCheckpointSeq === 1);

    expect(firstCommandFrame?.phase).toBe(GamePhase.MULLIGAN_PHASE);
    expect(checkpointFrame?.phase).toBe(bundle.sourceMatch.phase);
    expect(firstCommandFrame?.phase).not.toBe(checkpointFrame?.phase);
  });

  it('管理员导入路由可读取 timeline 与 checkpoint 投影视图，不返回 authority payload', async () => {
    const match = await createOnlineMatch();
    const bundle = JSON.parse(JSON.stringify(createDebugReplayBundle(match, 2_000)));

    const importHandler = findRouteLayer('/admin/debug-replay/import', 'post').stack.at(-1)
      ?.handle as (req: Request, res: Response) => void;
    const importResponse = createMockResponse();
    await importHandler(
      {
        body: { bundle },
        user: { id: 'admin', role: 'admin' },
      } as Request,
      importResponse
    );

    expect(importResponse.statusCode).toBe(201);
    const bundleId = (importResponse.body?.data as { bundleId: string }).bundleId;

    const timelineHandler = findRouteLayer(
      '/admin/debug-replay/:bundleId/timeline',
      'get'
    ).stack.at(-1)?.handle as (req: Request, res: Response) => void;
    const timelineResponse = createMockResponse();
    await timelineHandler(
      {
        params: { bundleId },
        user: { id: 'admin', role: 'admin' },
      } as Request,
      timelineResponse
    );

    expect(timelineResponse.statusCode).toBe(200);
    expect(JSON.stringify(timelineResponse.body?.data)).not.toContain('payloadEnvelope');

    const checkpointHandler = findRouteLayer(
      '/admin/debug-replay/:bundleId/checkpoints/:checkpointSeq',
      'get'
    ).stack.at(-1)?.handle as (req: Request, res: Response) => void;
    const checkpointResponse = createMockResponse();
    await checkpointHandler(
      {
        params: { bundleId, checkpointSeq: '1' },
        query: { viewerSeat: 'FIRST' },
        user: { id: 'admin', role: 'admin' },
      } as Request,
      checkpointResponse
    );

    expect(checkpointResponse.statusCode).toBe(200);
    expect(
      (checkpointResponse.body?.data as { playerViewState: { match: { viewerSeat: string } } })
        .playerViewState.match.viewerSeat
    ).toBe('FIRST');
    expect(JSON.stringify(checkpointResponse.body?.data)).not.toContain('payloadEnvelope');
    expect(JSON.stringify(checkpointResponse.body?.data)).not.toContain('__transportType');
  });
});

function migrateLegacyFixtureBundleForTest(bundle: DebugReplayBundle): DebugReplayBundle {
  return {
    ...bundle,
    checkpoints: bundle.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      payloadEnvelope: compressLegacyReplayPayloadEnvelopeForMigration(
        checkpoint.payloadEnvelope,
        'AUTHORITY_GAME_STATE'
      ),
    })),
  };
}

function expectContainsNoNativeMap(value: unknown, path = 'value'): void {
  if (value instanceof Map) {
    throw new Error(`bundle contains native Map at ${path}`);
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => expectContainsNoNativeMap(entry, `${path}[${index}]`));
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    expectContainsNoNativeMap(entry, `${path}.${key}`);
  }
}
