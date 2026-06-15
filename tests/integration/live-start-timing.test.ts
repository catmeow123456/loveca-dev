import { describe, expect, it } from 'vitest';
import {
  CardType,
  EffectWindowType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';
import { GameService } from '../../src/application/game-service';
import {
  createGameState,
  getPlayerById,
  registerCards,
  updatePlayer,
} from '../../src/domain/entities/game';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';

function createLiveCard(instanceId: string, ownerId: string, score = 1) {
  return createCardInstance(
    {
      cardCode: `${instanceId}-CODE`,
      name: instanceId,
      cardType: CardType.LIVE as const,
      score,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    },
    ownerId,
    instanceId
  );
}

function createMemberCard(
  instanceId: string,
  ownerId: string,
  overrides: Partial<MemberCardData> = {}
) {
  return createCardInstance(
    {
      cardCode: `${instanceId}-CODE`,
      name: instanceId,
      cardType: CardType.MEMBER as const,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      ...overrides,
    },
    ownerId,
    instanceId
  );
}

function createStateReadyToEnterPerformance(cardIds: readonly string[]) {
  const service = new GameService();
  const cards = [
    createLiveCard('p1-live', 'p1'),
    createMemberCard('p1-member', 'p1'),
    createMemberCard('p1-member-2', 'p1'),
    createMemberCard('p1-member-3', 'p1'),
    createMemberCard('p1-kotori', 'p1', {
      cardCode: 'PL!-sd1-003-SD',
      name: '南ことり',
    }),
    createMemberCard('p1-discard', 'p1'),
    createMemberCard('p1-main-deck-filler', 'p1'),
  ];

  let game = createGameState('g-live-start-timing', 'p1', 'P1', 'p2', 'P2');
  game = registerCards(game, cards);
  game = updatePlayer(game, 'p1', (player) => {
    let liveZone = player.liveZone;
    for (const cardId of cardIds) {
      liveZone = addCardToStatefulZone(liveZone, cardId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_DOWN,
      });
    }
    return {
      ...player,
      liveZone,
      mainDeck: addCardToZone(player.mainDeck, 'p1-main-deck-filler'),
    };
  });

  game = {
    ...game,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
    currentTurnType: TurnType.LIVE_PHASE,
    activePlayerIndex: 0,
    liveSetCompletedPlayers: ['p1', 'p2'],
  };

  return { service, game };
}

describe('LIVE_START 时点流程', () => {
  it('正常翻出 Live 后，应在判定前进入 LIVE_START 效果窗口', () => {
    const { service, game } = createStateReadyToEnterPerformance(['p1-live']);

    const result = service.advancePhase(game);

    expect(result.success).toBe(true);
    expect(result.gameState.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    expect(result.gameState.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
    expect(result.gameState.effectWindowType).toBe(EffectWindowType.LIVE_START);
    expect(result.gameState.liveResolution.performingPlayerId).toBe('p1');
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual([]);

    const player = getPlayerById(result.gameState, 'p1')!;
    expect(player.liveZone.cardIds).toEqual(['p1-live']);
    expect(player.liveZone.cardStates.get('p1-live')?.face).toBe(FaceState.FACE_UP);
  });

  it('LIVE 区只有非 Live 卡时，应在 LIVE_START 前移入休息室且不进入 LIVE_START', () => {
    const { service, game } = createStateReadyToEnterPerformance(['p1-member']);

    const result = service.advancePhase(game);

    expect(result.success).toBe(true);
    const player = getPlayerById(result.gameState, 'p1')!;
    expect(player.liveZone.cardIds).not.toContain('p1-member');
    expect(player.waitingRoom.cardIds).toContain('p1-member');
    expect(result.gameState.currentSubPhase).not.toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
    expect(result.gameState.effectWindowType).not.toBe(EffectWindowType.LIVE_START);
  });

  it('LIVE 区只有多张非 Live 卡时，不应触发舞台成员的 LIVE_START 效果', () => {
    const { service, game } = createStateReadyToEnterPerformance([
      'p1-member',
      'p1-member-2',
      'p1-member-3',
    ]);
    const gameWithLiveStartSource = updatePlayer(game, 'p1', (player) => ({
      ...player,
      hand: addCardToZone(player.hand, 'p1-discard'),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'p1-kotori'),
    }));

    const result = service.advancePhase(gameWithLiveStartSource);

    expect(result.success).toBe(true);
    const player = getPlayerById(result.gameState, 'p1')!;
    expect(player.liveZone.cardIds).toEqual([]);
    expect(player.waitingRoom.cardIds).toEqual(
      expect.arrayContaining(['p1-member', 'p1-member-2', 'p1-member-3'])
    );
    expect(
      result.gameState.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_LIVE_START
      )
    ).toBe(false);
    expect(result.gameState.activeEffect).toBeNull();
    expect(result.gameState.currentSubPhase).not.toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
    expect(result.gameState.effectWindowType).not.toBe(EffectWindowType.LIVE_START);
  });

  it('LIVE 区同时翻出 Live 和非 Live 时，非 Live 应先离开，再进入 LIVE_START', () => {
    const { service, game } = createStateReadyToEnterPerformance(['p1-live', 'p1-member']);

    const result = service.advancePhase(game);

    expect(result.success).toBe(true);
    expect(result.gameState.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    expect(result.gameState.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);

    const player = getPlayerById(result.gameState, 'p1')!;
    expect(player.liveZone.cardIds).toEqual(['p1-live']);
    expect(player.waitingRoom.cardIds).toContain('p1-member');
  });
});
