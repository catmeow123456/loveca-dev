import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type LiveModifierState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import { GameService } from '../../src/application/game-service';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_012_CONTINUOUS_OPPONENT_SUCCESS_SCORE_SIX_LIVE_SCORE_ABILITY_ID,
  PL_N_BP4_031_LIVE_START_NIJIGASAKI_STAGE_COST_DRAW_THREE_HAND_TO_TOP_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 7,
    blade: 1,
    hearts: [],
  };
}

function live(cardCode: string, score: number, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function scoreModifiers(game: GameState): readonly Extract<LiveModifierState, { kind: 'SCORE' }>[] {
  return collectLiveModifiers(game).filter(
    (modifier): modifier is Extract<LiveModifierState, { kind: 'SCORE' }> =>
      modifier.kind === 'SCORE'
  );
}

function placeMember(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setupLanzhuContinuous(options: {
  readonly sourceCode: 'PL!N-bp4-012-R' | 'PL!N-bp4-012-P';
  readonly opponentSuccessScore: number;
  readonly sourceOnStage?: boolean;
}): GameState {
  const source = createCardInstance(
    member(options.sourceCode, { name: '鐘 嵐珠', cost: 13 }),
    PLAYER1,
    'lanzhu-source'
  );
  const successLive = createCardInstance(
    live('opponent-success-live', options.opponentSuccessScore, 'Opponent Success'),
    PLAYER2,
    'opponent-success-live'
  );

  let game = createGameState('n-bp4-012-continuous', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, successLive]);
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    successZone: addCardToStatefulZone(player.successZone, successLive.instanceId),
  }));
  if (options.sourceOnStage !== false) {
    game = placeMember(game, PLAYER1, SlotPosition.CENTER, source.instanceId);
  } else {
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [source.instanceId] },
    }));
  }
  return game;
}

function setupNeoSky(options: {
  readonly sourceInLiveZone?: boolean;
  readonly stageMembers: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly mainDeckCards?: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  const source = createCardInstance(
    live('PL!N-bp4-031-L', 8, 'NEO SKY, NEO MAP!'),
    PLAYER1,
    'neo-sky-source'
  );
  const handCards = options.handCards ?? [];
  const mainDeckCards = options.mainDeckCards ?? [];
  let game = createGameState('n-bp4-031-neo-sky', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...options.stageMembers.map((entry) => entry.card),
    ...handCards,
    ...mainDeckCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of options.stageMembers) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      liveZone:
        options.sourceInLiveZone === false
          ? player.liveZone
          : addCardToStatefulZone(player.liveZone, source.instanceId),
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      mainDeck: {
        ...player.mainDeck,
        cardIds: mainDeckCards.map((card) => card.instanceId),
      },
    };
  });
  return game;
}

function nijigasakiStageMembers(costs: readonly [number, number, number]) {
  return [
    {
      card: createCardInstance(member('niji-left', { cost: costs[0] }), PLAYER1, 'niji-left'),
      slot: SlotPosition.LEFT,
    },
    {
      card: createCardInstance(member('niji-center', { cost: costs[1] }), PLAYER1, 'niji-center'),
      slot: SlotPosition.CENTER,
    },
    {
      card: createCardInstance(member('niji-right', { cost: costs[2] }), PLAYER1, 'niji-right'),
      slot: SlotPosition.RIGHT,
    },
  ] as const;
}

function runLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function confirmSelectedCards(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

describe('PL!N-bp4-012 Lanzhu continuous live score modifier', () => {
  it('applies for both R/P base cards when opponent successful LIVE score total is at least 6', () => {
    for (const sourceCode of ['PL!N-bp4-012-R', 'PL!N-bp4-012-P'] as const) {
      const game = setupLanzhuContinuous({
        sourceCode,
        opponentSuccessScore: 6,
      });

      expect(scoreModifiers(game)).toContainEqual({
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: 'lanzhu-source',
        abilityId: PL_N_BP4_012_CONTINUOUS_OPPONENT_SUCCESS_SCORE_SIX_LIVE_SCORE_ABILITY_ID,
      });
    }
  });

  it('does not apply below the opponent success score threshold or after source leaves stage', () => {
    expect(
      scoreModifiers(
        setupLanzhuContinuous({
          sourceCode: 'PL!N-bp4-012-R',
          opponentSuccessScore: 5,
        })
      )
    ).toEqual([]);
    expect(
      scoreModifiers(
        setupLanzhuContinuous({
          sourceCode: 'PL!N-bp4-012-R',
          opponentSuccessScore: 6,
          sourceOnStage: false,
        })
      )
    ).toEqual([]);
  });
});

describe('PL!N-bp4-031 NEO SKY, NEO MAP!', () => {
  it('draws three, then returns exactly three hand cards to deck top in selected order', () => {
    const existingHand = createCardInstance(member('existing-hand'), PLAYER1, 'existing-hand');
    const drawnOne = createCardInstance(member('drawn-one'), PLAYER1, 'drawn-one');
    const drawnTwo = createCardInstance(member('drawn-two'), PLAYER1, 'drawn-two');
    const drawnThree = createCardInstance(member('drawn-three'), PLAYER1, 'drawn-three');
    const deckRest = createCardInstance(member('deck-rest'), PLAYER1, 'deck-rest');
    const started = runLiveStart(
      setupNeoSky({
        stageMembers: nijigasakiStageMembers([7, 7, 6]),
        handCards: [existingHand],
        mainDeckCards: [drawnOne, drawnTwo, drawnThree, deckRest],
      })
    );

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_031_LIVE_START_NIJIGASAKI_STAGE_COST_DRAW_THREE_HAND_TO_TOP_ABILITY_ID,
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 3,
      maxSelectableCards: 3,
    });
    expect(started.players[0]!.hand.cardIds).toEqual([
      existingHand.instanceId,
      drawnOne.instanceId,
      drawnTwo.instanceId,
      drawnThree.instanceId,
    ]);
    expect(started.players[0]!.mainDeck.cardIds).toEqual([deckRest.instanceId]);

    const selectedOrder = [drawnTwo.instanceId, existingHand.instanceId, drawnOne.instanceId];
    const resolved = confirmSelectedCards(started, selectedOrder);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0]!.hand.cardIds).toEqual([drawnThree.instanceId]);
    expect(resolved.players[0]!.mainDeck.cardIds).toEqual([
      ...selectedOrder,
      deckRest.instanceId,
    ]);
  });

  it('no-ops when the stage is not full of Nijigasaki members or effective cost total is below 20', () => {
    const deckTop = createCardInstance(member('deck-top'), PLAYER1, 'deck-top');
    const notNijigasaki = createCardInstance(
      member('not-niji', { cost: 10, groupNames: ['Liella!'] }),
      PLAYER1,
      'not-niji'
    );
    const scenarios = [
      {
        name: 'missing member area',
        stageMembers: nijigasakiStageMembers([10, 10, 10]).slice(0, 2),
      },
      {
        name: 'non-Nijigasaki member',
        stageMembers: [
          nijigasakiStageMembers([10, 10, 10])[0]!,
          {
            card: notNijigasaki,
            slot: SlotPosition.CENTER,
          },
          nijigasakiStageMembers([10, 10, 10])[2]!,
        ],
      },
      {
        name: 'insufficient effective cost',
        stageMembers: nijigasakiStageMembers([6, 6, 7]),
      },
    ];

    for (const scenario of scenarios) {
      const started = runLiveStart(
        setupNeoSky({
          stageMembers: scenario.stageMembers,
          mainDeckCards: [deckTop],
        })
      );
      expect(started.activeEffect, scenario.name).toBeNull();
      expect(started.players[0]!.mainDeck.cardIds, scenario.name).toEqual([deckTop.instanceId]);
      expect(started.players[0]!.hand.cardIds, scenario.name).toEqual([]);
    }
  });

  it('no-ops when the source LIVE is no longer in the LIVE zone', () => {
    const deckTop = createCardInstance(member('deck-top'), PLAYER1, 'deck-top');
    const started = runLiveStart(
      setupNeoSky({
        sourceInLiveZone: false,
        stageMembers: nijigasakiStageMembers([7, 7, 6]),
        mainDeckCards: [deckTop],
      })
    );

    expect(started.activeEffect).toBeNull();
    expect(started.players[0]!.mainDeck.cardIds).toEqual([deckTop.instanceId]);
    expect(started.players[0]!.hand.cardIds).toEqual([]);
  });

  it('draws but does not open an impossible selection when hand has fewer than three cards after draw', () => {
    const onlyDeckCard = createCardInstance(member('only-deck-card'), PLAYER1, 'only-deck-card');
    const started = runLiveStart(
      setupNeoSky({
        stageMembers: nijigasakiStageMembers([7, 7, 6]),
        mainDeckCards: [onlyDeckCard],
      })
    );

    expect(started.activeEffect).toBeNull();
    expect(started.players[0]!.hand.cardIds).toEqual([onlyDeckCard.instanceId]);
    expect(started.players[0]!.mainDeck.cardIds).toEqual([]);
  });

  it('does not advance on stale or illegal ordered hand selections', () => {
    const handOne = createCardInstance(member('hand-one'), PLAYER1, 'hand-one');
    const drawnOne = createCardInstance(member('drawn-one'), PLAYER1, 'drawn-one');
    const drawnTwo = createCardInstance(member('drawn-two'), PLAYER1, 'drawn-two');
    const drawnThree = createCardInstance(member('drawn-three'), PLAYER1, 'drawn-three');
    const started = runLiveStart(
      setupNeoSky({
        stageMembers: nijigasakiStageMembers([7, 7, 6]),
        handCards: [handOne],
        mainDeckCards: [drawnOne, drawnTwo, drawnThree],
      })
    );
    const staleState = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== drawnTwo.instanceId),
      },
      waitingRoom: addCardToStatefulZone(player.waitingRoom, drawnTwo.instanceId),
    }));

    const afterStaleSelection = confirmSelectedCards(staleState, [
      handOne.instanceId,
      drawnOne.instanceId,
      drawnTwo.instanceId,
    ]);
    expect(afterStaleSelection.activeEffect).toEqual(staleState.activeEffect);
    expect(afterStaleSelection.players[0]!.mainDeck.cardIds).toEqual([]);

    const afterDuplicateSelection = confirmSelectedCards(started, [
      handOne.instanceId,
      handOne.instanceId,
      drawnOne.instanceId,
    ]);
    expect(afterDuplicateSelection.activeEffect).toEqual(started.activeEffect);
    expect(afterDuplicateSelection.players[0]!.mainDeck.cardIds).toEqual([]);
  });
});
