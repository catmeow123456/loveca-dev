import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { HS_BP6_028_LIVE_SUCCESS_REMAINING_HEART_LOOK_TOP_TWO_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLive(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function startBlueMoment(
  selectedCardIndexes: readonly number[],
  remainingHearts: readonly { readonly color: HeartColor; readonly count: number }[] = [
    { color: HeartColor.RED, count: 1 },
  ]
): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly deckCardIds: readonly string[];
  readonly selectedCardIds: readonly string[];
  readonly remainingHearts: readonly { readonly color: HeartColor; readonly count: number }[];
} {
  const sourceLive = createCardInstance(
    createLive('PL!HS-bp6-028-L', 'ブルウモーメント'),
    PLAYER1,
    `blue-moment-${selectedCardIndexes.join('-') || 'none'}`
  );
  const deckCards = [0, 1].map((index) =>
    createCardInstance(createMember(`PL!HS-bp6-028-deck-${index}`), PLAYER1, `deck-${index}`)
  );
  let game = createGameState('hs-bp6-028-blue-moment', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    liveZone: { ...player.liveZone, cardIds: [sourceLive.instanceId] },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      liveResults: new Map([[sourceLive.instanceId, true]]),
      playerRemainingHearts: new Map([[PLAYER1, remainingHearts]]),
    },
    pendingAbilities: [
      {
        id: `hs-bp6-028-pending-${selectedCardIndexes.join('-') || 'none'}`,
        abilityId: HS_BP6_028_LIVE_SUCCESS_REMAINING_HEART_LOOK_TOP_TWO_ABILITY_ID,
        sourceCardId: sourceLive.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ['manual-live-success'],
      },
    ],
  };

  const session = createGameSession();
  session.createGame('hs-bp6-028-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState =
    resolvePendingCardEffects(game).gameState;

  const deckCardIds = deckCards.map((card) => card.instanceId);
  return {
    session,
    deckCardIds,
    selectedCardIds: selectedCardIndexes.map((index) => deckCardIds[index]!),
    remainingHearts,
  };
}

function confirmSelectedCards(
  session: ReturnType<typeof createGameSession>,
  selectedCardIds: readonly string[]
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
}

describe('PL!HS-bp6-028 Blue Moment workflow', () => {
  it('opens confirm-only and no-ops when there is no remaining Heart', () => {
    const { session, deckCardIds } = startBlueMoment([], []);

    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(session.state?.activeEffect?.effectText).toContain('当前没有余剩Heart');
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it.each([
    { name: 'selects none', selectedIndexes: [], expectedTopIndexes: [], expectedWaitIndexes: [0, 1] },
    { name: 'selects one', selectedIndexes: [1], expectedTopIndexes: [1], expectedWaitIndexes: [0] },
    {
      name: 'selects two in chosen order',
      selectedIndexes: [1, 0],
      expectedTopIndexes: [1, 0],
      expectedWaitIndexes: [],
    },
  ])('$name while preserving order and remaining Heart', ({ selectedIndexes, expectedTopIndexes, expectedWaitIndexes }) => {
    const { session, deckCardIds, selectedCardIds, remainingHearts } =
      startBlueMoment(selectedIndexes);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_028_LIVE_SUCCESS_REMAINING_HEART_LOOK_TOP_TWO_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(deckCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual(deckCardIds);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_028_LIVE_SUCCESS_REMAINING_HEART_LOOK_TOP_TWO_ABILITY_ID &&
          action.payload.step === 'START_INSPECTION'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'STARTED',
      sourceActionLabel: 'LIVE成功',
      requestedInspectCount: 2,
      actualInspectedCount: 2,
    });
    expect(confirmSelectedCards(session, selectedCardIds).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds.slice(0, expectedTopIndexes.length)).toEqual(
      expectedTopIndexes.map((index) => deckCardIds[index]!)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expectedWaitIndexes.map((index) => deckCardIds[index]!)
    );
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_028_LIVE_SUCCESS_REMAINING_HEART_LOOK_TOP_TWO_ABILITY_ID &&
          action.payload.step === 'FINISH'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'COMPLETED',
      sourceActionLabel: 'LIVE成功',
      actualInspectedCount: 2,
      selectedCardIds: expectedTopIndexes.map((index) => deckCardIds[index]!),
      waitingRoomCardIds: expectedWaitIndexes.map((index) => deckCardIds[index]!),
    });
    expect(session.state?.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(
      remainingHearts
    );
  });
});
