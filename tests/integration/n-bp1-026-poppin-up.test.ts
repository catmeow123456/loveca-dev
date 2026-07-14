import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  updateResolutionZone,
  type GameState,
} from '../../src/domain/entities/game';
import { GameService } from '../../src/application/game-service';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLive(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1, [HeartColor.RAINBOW]: 2 }),
  };
}

function createMember(
  cardCode: string,
  groupName = 'ラブライブ！虹ヶ咲学園スクールアイドル同好会'
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function prepareScenario(options: {
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly includeOpponentLive?: boolean;
  readonly cheerCards?: readonly CardInstance[];
  readonly revealedCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly firstPlayerCheerCardIds?: readonly string[];
}) {
  const sourceLive = createCardInstance(
    createLive('PL!N-bp1-026-L', "Poppin' Up!"),
    PLAYER1,
    'source-live'
  );
  const opponentLive = createCardInstance(
    createLive('PL!TEST-opponent-L'),
    PLAYER2,
    'opponent-live'
  );
  const cheerCards = options.cheerCards ?? [
    createCardInstance(createMember('PL!N-test-cheer-R'), PLAYER1, 'nijigasaki-cheer'),
  ];
  let game = createGameState('n-bp1-026-poppin-up', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, opponentLive, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: { ...player.liveZone, cardIds: [sourceLive.instanceId] },
    hand: { ...player.hand, cardIds: [] },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: options.includeOpponentLive === false ? [] : [opponentLive.instanceId],
    },
    hand: { ...player.hand, cardIds: [] },
  }));
  game = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: [...(options.resolutionCardIds ?? cheerCards.map((card) => card.instanceId))],
    revealedCardIds: [...(options.revealedCardIds ?? cheerCards.map((card) => card.instanceId))],
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[sourceLive.instanceId, true]]),
      playerScores: new Map([
        [PLAYER1, options.ownScore],
        [PLAYER2, options.opponentScore],
      ]),
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: [
        ...(options.firstPlayerCheerCardIds ?? cheerCards.map((card) => card.instanceId)),
      ],
      secondPlayerCheerCardIds: [],
    },
  };

  return { game, sourceLive, opponentLive, cheerCards };
}

function startLiveSuccessSelection(game: GameState): GameSession {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  const session = createGameSession();
  session.createGame('n-bp1-026-poppin-up-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  return session;
}

function resolveLiveSuccess(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function confirmSelection(session: GameSession, cardId: string) {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effect.id, cardId));
  if (result.success) confirmPublicSelectionIfNeeded(session);
  return result;
}

function latestResolveAction(state: GameState, step: string) {
  return [...state.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID &&
        action.payload.step === step
    );
}

describe("PL!N-bp1-026-L Poppin' Up!", () => {
  it('requires choosing one own revealed Nijigasaki cheer card when own score is higher', () => {
    const { game, sourceLive, cheerCards } = prepareScenario({
      ownScore: 4,
      opponentScore: 2,
    });
    const targetCardId = cheerCards[0]!.instanceId;
    const session = startLiveSuccessSelection(game);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId:
        PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID,
      sourceCardId: sourceLive.instanceId,
      selectableCardIds: [targetCardId],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
    });

    const result = confirmSelection(session, targetCardId);
    expect(result.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetCardId]);
    expect(session.state?.resolutionZone.cardIds).toEqual([]);
    expect(session.state?.resolutionZone.revealedCardIds).toEqual([]);
    expect(
      latestResolveAction(session.state!, 'MOVE_NIJIGASAKI_REVEALED_CHEER_TO_HAND')?.payload
    ).toMatchObject({
      movedCardIds: [targetCardId],
      ownScore: 4,
      opponentScore: 2,
      conditionMet: true,
    });
  });

  it('does not open selection or move cards when own score is tied or lower', () => {
    for (const [ownScore, opponentScore] of [
      [3, 3],
      [2, 3],
    ] as const) {
      const { game } = prepareScenario({ ownScore, opponentScore });
      const state = resolveLiveSuccess(game);

      expect(state.activeEffect).toBeNull();
      expect(state.players[0].hand.cardIds).toEqual([]);
      expect(latestResolveAction(state, 'CONDITION_NOT_MET')?.payload).toMatchObject({
        ownScore,
        opponentScore,
        conditionMet: false,
      });
    }
  });

  it('resolves as no-op when there is no Nijigasaki revealed cheer target', () => {
    const nonNijigasaki = createCardInstance(
      createMember('PL!SP-test-cheer-R', 'ラブライブ！スーパースター!!'),
      PLAYER1,
      'liella-cheer'
    );
    const { game } = prepareScenario({
      ownScore: 4,
      opponentScore: 2,
      cheerCards: [nonNijigasaki],
    });
    const state = resolveLiveSuccess(game);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.resolutionZone.cardIds).toEqual([nonNijigasaki.instanceId]);
    expect(
      latestResolveAction(state, 'NO_NIJIGASAKI_REVEALED_CHEER_TARGET')?.payload
    ).toMatchObject({
      ownScore: 4,
      opponentScore: 2,
      conditionMet: true,
    });
  });

  it('only allows own current revealed cheer Nijigasaki cards in resolution zone', () => {
    const valid = createCardInstance(createMember('PL!N-valid-R'), PLAYER1, 'valid');
    const nonNijigasaki = createCardInstance(
      createMember('PL!SP-non-niji-R', 'ラブライブ！スーパースター!!'),
      PLAYER1,
      'non-niji'
    );
    const opponentOwned = createCardInstance(createMember('PL!N-opponent-R'), PLAYER2, 'opponent');
    const notCheered = createCardInstance(
      createMember('PL!N-not-cheered-R'),
      PLAYER1,
      'not-cheered'
    );
    const notInResolution = createCardInstance(
      createMember('PL!N-not-resolution-R'),
      PLAYER1,
      'not-resolution'
    );
    const notRevealed = createCardInstance(
      createMember('PL!N-not-revealed-R'),
      PLAYER1,
      'not-revealed'
    );
    const cheerCards = [
      valid,
      nonNijigasaki,
      opponentOwned,
      notCheered,
      notInResolution,
      notRevealed,
    ];
    const { game } = prepareScenario({
      ownScore: 4,
      opponentScore: 2,
      cheerCards,
      firstPlayerCheerCardIds: [
        valid.instanceId,
        nonNijigasaki.instanceId,
        opponentOwned.instanceId,
        notInResolution.instanceId,
        notRevealed.instanceId,
      ],
      resolutionCardIds: [
        valid.instanceId,
        nonNijigasaki.instanceId,
        opponentOwned.instanceId,
        notCheered.instanceId,
        notRevealed.instanceId,
      ],
      revealedCardIds: [
        valid.instanceId,
        nonNijigasaki.instanceId,
        opponentOwned.instanceId,
        notCheered.instanceId,
        notInResolution.instanceId,
      ],
    });
    const session = startLiveSuccessSelection(game);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([valid.instanceId]);
    for (const invalid of [
      nonNijigasaki,
      opponentOwned,
      notCheered,
      notInResolution,
      notRevealed,
    ]) {
      expect(session.state?.activeEffect?.selectableCardIds).not.toContain(invalid.instanceId);
      expect(confirmSelection(session, invalid.instanceId).success).toBe(false);
      expect(session.state?.activeEffect).not.toBeNull();
    }

    expect(confirmSelection(session, valid.instanceId).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([valid.instanceId]);
  });

  it('treats own live zone having LIVE and opponent live zone having no LIVE as higher score', () => {
    const { game, cheerCards } = prepareScenario({
      ownScore: 0,
      opponentScore: 9,
      includeOpponentLive: false,
    });
    const targetCardId = cheerCards[0]!.instanceId;
    const session = startLiveSuccessSelection(game);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetCardId]);
    expect(confirmSelection(session, targetCardId).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([targetCardId]);
    expect(
      latestResolveAction(session.state!, 'MOVE_NIJIGASAKI_REVEALED_CHEER_TO_HAND')?.payload
    ).toMatchObject({
      ownScore: 0,
      opponentScore: 9,
      ownHasLive: true,
      opponentHasLive: false,
      conditionMet: true,
    });
  });
});
