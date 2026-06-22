import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { S_BP2_024_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, GamePhase, HeartColor, SubPhase, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createKimikokoLive(cardCode = 'PL!S-bp2-024-SECL'): LiveCardData {
  return {
    cardCode,
    name: '君のこころは輝いてるかい？',
    groupName: 'Aqours',
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: 'Aqours',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupLiveSuccess(): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly handCard: ReturnType<typeof createCardInstance>;
  readonly deckCards: readonly ReturnType<typeof createCardInstance>[];
} {
  const live = createCardInstance(createKimikokoLive(), PLAYER1, 'kimikoko-live');
  const handCard = createCardInstance(createMember('HAND-DISCARD'), PLAYER1, 'hand-discard');
  const deckCards = [
    createCardInstance(createMember('DECK-DRAW-1'), PLAYER1, 'deck-draw-1'),
    createCardInstance(createMember('DECK-DRAW-2'), PLAYER1, 'deck-draw-2'),
  ];

  let game = createGameState('s-bp2-024-kimikoko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, handCard, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, handCard.instanceId),
    mainDeck: {
      ...player.mainDeck,
      cardIds: deckCards.map((card) => card.instanceId),
    },
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([[PLAYER1, 4]]),
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);

  const session = createGameSession();
  session.createGame('s-bp2-024-kimikoko-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  return { session, live, handCard, deckCards };
}

describe('PL!S-bp2-024 君のこころは輝いてるかい？', () => {
  it('LIVE_SUCCESS 抽2后弃1手牌进入休息室', () => {
    const { session, live, handCard, deckCards } = setupLiveSuccess();
    const opened = session.state;
    expect(opened?.activeEffect?.abilityId).toBe(
      S_BP2_024_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID
    );
    expect(opened?.activeEffect?.selectableCardIds).toEqual([
      handCard.instanceId,
      ...deckCards.map((card) => card.instanceId),
    ]);

    const result = session.executeCommand(
      createConfirmEffectStepCommand(opened!.activeEffect!.awaitingPlayerId!, opened!.activeEffect!.id, handCard.instanceId)
    );

    expect(result.success).toBe(true);
    expect(result.gameState.players[0].hand.cardIds).toEqual(deckCards.map((card) => card.instanceId));
    expect(result.gameState.players[0].waitingRoom.cardIds).toContain(handCard.instanceId);
    expect(
      result.gameState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP2_024_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.step === 'DISCARD_HAND_CARD'
      )
    ).toBe(true);
  });
});
