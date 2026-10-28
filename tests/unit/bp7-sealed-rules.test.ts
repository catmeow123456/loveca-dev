import { describe, expect, it } from 'vitest';
import {
  createGameState,
  registerCards,
  updatePlayer,
  checkVictoryCondition,
} from '../../src/domain/entities/game';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import { baseLiveRequirement } from '../../src/domain/rules/battle-ruleset';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import {
  CardType,
  HeartColor,
  GamePhase,
  SubPhase,
  SlotPosition,
} from '../../src/shared/types/enums';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { projectPlayerViewState } from '../../src/online/projector';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import {
  serializeReplayPayload,
  rehydrateAuthorityGameState,
  migrateBattleRulesetCheckpoint,
} from '../../src/server/services/replay-payload-serialization';

const create = () => createGameState('sealed', 'p1', 'A', 'p2', 'B', 'SEALED_HALF_GRAY_V1');
describe('sealed half deck rules', () => {
  it.each([
    ['STANDARD', 3, 0, 0, false],
    ['SEALED_HALF_GRAY_V1', 3, 0, 0, true],
    ['SEALED_HALF_GRAY_V1', 4, 1, 0, false],
    ['SEALED_HALF_GRAY_V1', 2, 0, -1, true],
  ] as const)(
    'settles actual live judgment with rules %s, hearts %i and effect changes %i/%i',
    (rulesetId, hearts, addedYellow, grayChange, success) => {
      const member = createCardInstance(
        {
          cardCode: 'TEST-M',
          name: 'Member',
          cardType: CardType.MEMBER,
          cost: 1,
          blade: 0,
          hearts: [{ color: HeartColor.RED, count: hearts }],
        },
        'p1',
        'member'
      );
      const live = createCardInstance(
        {
          cardCode: 'TEST-L',
          name: 'Song',
          cardType: CardType.LIVE,
          score: 3,
          requirements: createHeartRequirement({ [HeartColor.BLUE]: 3 }),
        },
        'p1',
        'song'
      );
      let game = registerCards({ ...create(), rulesetId }, [member, live]);
      game = updatePlayer(game, 'p1', (p) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'member'),
        liveZone: addCardToStatefulZone(p.liveZone, 'song'),
      }));
      game = {
        ...game,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        activePlayerIndex: 0,
        liveResolution: {
          ...game.liveResolution,
          liveRequirementModifiers: new Map([
            [
              'song',
              [
                { color: HeartColor.YELLOW, countDelta: addedYellow },
                { color: HeartColor.GRAY, countDelta: grayChange },
              ],
            ],
          ]),
        },
      };
      const result = new GameService().processAction(
        rehydrateAuthorityGameState(
          serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
        ),
        {
          type: 'CONFIRM_JUDGMENT',
          playerId: 'p1',
          timestamp: Date.now(),
          judgmentResults: new Map(),
        }
      );
      expect(result.success).toBe(true);
      expect(result.gameState.liveResolution.liveResults.get('song')).toBe(success);
      expect(result.gameState.liveResolution.playerScores.get('p1')).toBe(success ? 3 : 0);
    }
  );
  it('converts printed colors before applying colored effects without mutating the catalog', () => {
    const printed = createHeartRequirement({ [HeartColor.PINK]: 2, [HeartColor.BLUE]: 3 });
    const base = baseLiveRequirement(create(), printed);
    expect(base.colorRequirements).toEqual(new Map([[HeartColor.GRAY, 5]]));
    const modified = applyHeartRequirementModifiers(base, [
      { color: HeartColor.YELLOW, countDelta: 2 },
      { color: HeartColor.GRAY, countDelta: -1 },
    ]);
    expect(modified.colorRequirements.get(HeartColor.YELLOW)).toBe(2);
    expect(modified.totalRequired).toBe(6);
    expect(printed.colorRequirements.get(HeartColor.PINK)).toBe(2);
    expect(baseLiveRequirement({ rulesetId: 'STANDARD' }, printed)).toBe(printed);
  });
  it('requires two successes only in sealed games', () => {
    const game = updatePlayer(create(), 'p1', (p) => ({
      ...p,
      successZone: { ...p.successZone, cardIds: ['a', 'b'] },
    }));
    expect(checkVictoryCondition(game)).toBe('p1');
    expect(checkVictoryCondition({ ...game, rulesetId: 'STANDARD' })).toBeNull();
    expect(new GameService().finalizeLiveResult(game).gameState.endInfo?.winnerId).toBe('p1');
    expect(
      new GameService().finalizeLiveResult({ ...game, rulesetId: 'STANDARD' }).gameState.endInfo
    ).toBeNull();
  });
  it('prevents tied players with one success from taking their second song', () => {
    let game = create();
    for (const id of ['p1', 'p2'])
      game = updatePlayer(game, id, (p) => ({
        ...p,
        successZone: { ...p.successZone, cardIds: [`${id}-won`] },
      }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        scoreConfirmedBy: ['p1', 'p2'],
        playerScores: new Map([
          ['p1', 5],
          ['p2', 5],
        ]),
      },
    };
    // A positive confirmed score establishes a successfully resolved live in this service.
    const service = new GameService();
    expect(service.resolveLiveWinner(game).gameState.liveResolution.liveWinnerIds).toEqual([]);
    expect(
      service.resolveLiveWinner({ ...game, rulesetId: 'STANDARD' }).gameState.liveResolution
        .liveWinnerIds
    ).toEqual(['p1', 'p2']);
  });
  it('projects gray base requirements and records the ruleset in snapshots', () => {
    let game = create();
    const live = createCardInstance(
      {
        cardCode: 'TEST-L',
        name: 'Song',
        cardType: CardType.LIVE,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 3 }),
      },
      'p1',
      'song'
    );
    game = registerCards(game, [live]);
    game = updatePlayer(game, 'p1', (p) => ({ ...p, hand: { ...p.hand, cardIds: ['song'] } }));
    const view = projectPlayerViewState(game, 'p1');
    expect(view.match.rulesetId).toBe('SEALED_HALF_GRAY_V1');
    expect(view.objects.obj_song.frontInfo?.requiredHearts?.colorRequirements).toEqual({ GRAY: 3 });
    const saved = serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION);
    expect(rehydrateAuthorityGameState(saved).rulesetId).toBe('SEALED_HALF_GRAY_V1');
  });
  it('does not guess rules for unknown or damaged current view checkpoints', () => {
    for (const version of ['PLAYER_VIEW_STATE_V2', 'PLAYER_VIEW_STATE_V99']) {
      const view = serializeReplayPayload(
        { match: { matchId: 'bad' } },
        'PLAYER_VIEW_STATE',
        version
      );
      expect(() => migrateBattleRulesetCheckpoint(view)).toThrow();
    }
  });
  it('requires explicit migration of old checkpoints and recalculates hashes', () => {
    const { rulesetId: _, ...old } = createGameState('old', 'p1', 'A', 'p2', 'B');
    const envelope = serializeReplayPayload(old, 'AUTHORITY_GAME_STATE', 'GAME_STATE_V2');
    expect(() => rehydrateAuthorityGameState(envelope)).toThrow();
    const migrated = migrateBattleRulesetCheckpoint(envelope);
    expect(migrated.payloadHash).not.toBe(envelope.payloadHash);
    expect(rehydrateAuthorityGameState(migrated).rulesetId).toBe('STANDARD');
    expect(migrateBattleRulesetCheckpoint(migrated)).toBe(migrated);
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(old, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
      )
    ).toThrow('rulesetId');
  });
});
