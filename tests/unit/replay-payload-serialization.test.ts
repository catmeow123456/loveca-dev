import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { CardType, GameMode, HeartColor } from '../../src/shared/types/enums';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

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

function createTestDeck(prefix: string): DeckConfig {
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

describe('replay payload serialization', () => {
  it('authority checkpoint 经 TRANSPORT_V1 JSON 往返后仍可复水并投影玩家视角', () => {
    const session = createGameSession();
    session.createGame('replay-serialize', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));

    const authoritySnapshot = session.getAuthoritySnapshotForRecord();
    expect(authoritySnapshot).not.toBeNull();

    const envelope = serializeReplayPayload(
      authoritySnapshot!,
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

    expect(envelope.serializer).toBe('TRANSPORT_V1');
    expect(envelope.payloadKind).toBe('AUTHORITY_GAME_STATE');
    expect(JSON.stringify(envelope.payload)).toContain('__transportType');
    expectContainsNoNativeMap(envelope.payload);

    const parsedEnvelope = JSON.parse(JSON.stringify(envelope)) as typeof envelope;
    const rehydrated = rehydrateAuthorityGameState(parsedEnvelope);

    expect(rehydrated.cardRegistry).toBeInstanceOf(Map);
    expect(rehydrated.liveResolution.liveResults).toBeInstanceOf(Map);
    expect(rehydrated.liveResolution.playerScores).toBeInstanceOf(Map);

    const playerView = projectPlayerViewState(rehydrated, PLAYER1, {
      seq: session.getCurrentPublicEventSeq(),
      gameMode: GameMode.DEBUG,
    });
    const opponentHiddenCardId = rehydrated.players[1].hand.cardIds[0];

    expect(playerView.match.viewerSeat).toBe('FIRST');
    expect(playerView.objects[createPublicObjectId(opponentHiddenCardId)]).toBeUndefined();
  });

  it('payload hash 被篡改时拒绝复水', () => {
    const session = createGameSession();
    session.createGame('replay-hash', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(createTestDeck('A'), createTestDeck('B'));

    const envelope = serializeReplayPayload(
      session.getAuthoritySnapshotForRecord(),
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

    expect(() =>
      rehydrateAuthorityGameState({
        ...envelope,
        payloadHash: 'sha256:bad',
      })
    ).toThrow('replay payload hash 校验失败');
  });
});

function expectContainsNoNativeMap(value: unknown, path = 'value'): void {
  if (value instanceof Map) {
    throw new Error(`payload contains native Map at ${path}`);
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
