import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, groupName = 'Liella!'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, groupName = 'Liella!'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function setupState(): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly liellaLiveId: string;
  readonly nonLiellaLiveId: string;
  readonly liellaMemberId: string;
  readonly additionalDeckIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-020-R'),
    PLAYER1,
    'sp-pb2-020-source'
  );
  const liellaLive = createCardInstance(
    createLive('PL!SP-test-liella-live'),
    PLAYER1,
    'sp-pb2-020-liella-live'
  );
  const nonLiellaLive = createCardInstance(
    createLive('PL!S-test-aqours-live', 'Aqours'),
    PLAYER1,
    'sp-pb2-020-aqours-live'
  );
  const liellaMember = createCardInstance(
    createMember('PL!SP-test-liella-member'),
    PLAYER1,
    'sp-pb2-020-liella-member'
  );
  const revealedCheer = createCardInstance(
    createMember('PL!SP-test-initial-cheer'),
    PLAYER1,
    'sp-pb2-020-initial-cheer'
  );
  const additionalCards = [0, 1, 2].map((index) =>
    createCardInstance(
      createMember(`PL!SP-test-additional-${index}`),
      PLAYER1,
      `sp-pb2-020-additional-${index}`
    )
  );

  let game = createGameState('sp-pb2-020-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    liellaLive,
    nonLiellaLive,
    liellaMember,
    revealedCheer,
    ...additionalCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    hand: {
      ...player.hand,
      cardIds: [liellaLive.instanceId, nonLiellaLive.instanceId, liellaMember.instanceId],
    },
    mainDeck: {
      ...player.mainDeck,
      cardIds: additionalCards.map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: [revealedCheer.instanceId],
    },
  };

  return {
    game,
    sourceId: source.instanceId,
    liellaLiveId: liellaLive.instanceId,
    nonLiellaLiveId: nonLiellaLive.instanceId,
    liellaMemberId: liellaMember.instanceId,
    additionalDeckIds: additionalCards.map((card) => card.instanceId),
  };
}

function enqueueCheer(game: GameState, revealedCardIds: readonly string[] = []): GameState {
  const event = createCheerEvent(PLAYER1, revealedCardIds, revealedCardIds.length, {
    automated: true,
  });
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_CHEER], {
    cheerEvents: [event],
  });
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-pb2-020 Natsumi on-cheer additional cheer workflow', () => {
  it('discards one Liella! live from hand and performs two additional cheer', () => {
    const scenario = setupState();
    let state = resolvePendingCardEffects(enqueueCheer(scenario.game)).gameState;

    expect(state.activeEffect?.abilityId).toBe(
      SP_PB2_020_AUTO_ON_CHEER_DISCARD_LIELLA_LIVE_ADDITIONAL_CHEER_ABILITY_ID
    );
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.liellaLiveId]);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      scenario.liellaLiveId
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).not.toContain(scenario.liellaLiveId);
    expect(state.players[0].waitingRoom.cardIds).toContain(scenario.liellaLiveId);
    expect(state.resolutionZone.revealedCardIds).toEqual(
      expect.arrayContaining([scenario.additionalDeckIds[0], scenario.additionalDeckIds[1]])
    );
    expect(
      state.eventLog
        .map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_CHEER && event.additional === true)
    ).toHaveLength(1);
    expect(abilityUseCount(state)).toBe(1);
  });

  it('decline does not discard, additional cheer, or record per-turn use', () => {
    const scenario = setupState();
    let state = resolvePendingCardEffects(enqueueCheer(scenario.game)).gameState;

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toContain(scenario.liellaLiveId);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(scenario.liellaLiveId);
    expect(
      state.eventLog
        .map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_CHEER && event.additional === true)
    ).toHaveLength(0);
    expect(abilityUseCount(state)).toBe(0);
  });

  it('does not open a window when there is no Liella! live in hand', () => {
    const scenario = setupState();
    const game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: [scenario.nonLiellaLiveId, scenario.liellaMemberId],
      },
    }));
    const state = resolvePendingCardEffects(enqueueCheer(game)).gameState;

    expect(state.activeEffect).toBeNull();
    expect(abilityUseCount(state)).toBe(0);
  });

  it('successful use prevents a second same-turn pending from being enqueued', () => {
    const scenario = setupState();
    let state = resolvePendingCardEffects(enqueueCheer(scenario.game)).gameState;
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.liellaLiveId);

    const queuedAgain = enqueueCheer(state);

    expect(queuedAgain.pendingAbilities).toEqual([]);
    expect(abilityUseCount(queuedAgain)).toBe(1);
  });
});
