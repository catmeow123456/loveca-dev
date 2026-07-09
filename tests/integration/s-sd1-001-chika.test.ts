import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function member(cardCode: string, groupNames: readonly string[] = ['Aqours']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 17,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, ownerGroup: readonly string[] = ['Aqours']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ownerGroup,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function placeSourceOnStage(game: GameState, sourceCardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sourceCardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function pending(sourceCardId: string, eventId: string): PendingAbilityState {
  return {
    id: `${S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID}:${sourceCardId}:${eventId}`,
    abilityId: S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_CHEER,
    eventIds: [eventId],
    sourceSlot: SlotPosition.CENTER,
  };
}

function resolveChika(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

describe('PL!S-sd1-001 高海千歌 ON_CHEER red Heart', () => {
  it.each([
    { liveCount: 0, expectedHeartCount: 0 },
    { liveCount: 1, expectedHeartCount: 1 },
    { liveCount: 4, expectedHeartCount: 3 },
  ])('counts this cheer event own LIVE cards with cap 3: $liveCount', ({ liveCount, expectedHeartCount }) => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-001');
    const revealedLives = Array.from({ length: liveCount }, (_, index) =>
      createCardInstance(live(`PL!S-test-live-${index}`), PLAYER1, `revealed-live-${index}`)
    );
    let game = registerCards(createGameState(`s-sd1-001-${liveCount}`, PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      ...revealedLives,
    ]);
    game = placeSourceOnStage(game, source.instanceId);
    const cheerEvent = createCheerEvent(
      PLAYER1,
      revealedLives.map((card) => card.instanceId),
      liveCount
    );
    game = emitGameEvent(game, cheerEvent);
    game = { ...game, pendingAbilities: [pending(source.instanceId, cheerEvent.eventId)] };

    const resolved = resolveChika(game);

    const modifier = resolved.liveResolution.liveModifiers.find(
      (candidate) =>
        candidate.kind === 'HEART' &&
        candidate.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID
    );
    if (expectedHeartCount === 0) {
      expect(modifier).toBeUndefined();
    } else {
      expect(modifier).toMatchObject({
        kind: 'HEART',
        playerId: PLAYER1,
        sourceCardId: source.instanceId,
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.RED, count: expectedHeartCount }],
      });
    }
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
  });

  it('uses CheerEvent revealedCardIds facts and ignores member cards, opponent cards, and other events', () => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-facts');
    const currentLive = createCardInstance(live('PL!S-current-live'), PLAYER1, 'current-live');
    const currentMember = createCardInstance(member('PL!S-current-member'), PLAYER1, 'current-member');
    const opponentLive = createCardInstance(live('PL!S-opponent-live'), PLAYER2, 'opponent-live');
    const historicalLive = createCardInstance(live('PL!S-historical-live'), PLAYER1, 'historical-live');
    let game = registerCards(createGameState('s-sd1-001-facts', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      currentLive,
      currentMember,
      opponentLive,
      historicalLive,
    ]);
    game = placeSourceOnStage(game, source.instanceId);
    game = emitGameEvent(game, createCheerEvent(PLAYER1, [historicalLive.instanceId], 1));
    const currentEvent = createCheerEvent(
      PLAYER1,
      [currentLive.instanceId, currentMember.instanceId, opponentLive.instanceId],
      3
    );
    game = emitGameEvent(game, currentEvent);
    game = { ...game, pendingAbilities: [pending(source.instanceId, currentEvent.eventId)] };

    const resolved = resolveChika(game);

    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.RED, count: 1 }],
    });
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID &&
          action.payload.step === 'COUNT_OWN_CHEER_LIVE_CARDS_GAIN_RED_HEART'
      )?.payload.matchingLiveCardIds
    ).toEqual([currentLive.instanceId]);
  });

  it('safely consumes the pending ability when the source member left the stage', () => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-left');
    const revealedLive = createCardInstance(live('PL!S-revealed-live'), PLAYER1, 'left-live');
    let game = registerCards(createGameState('s-sd1-001-left', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      revealedLive,
    ]);
    const cheerEvent = createCheerEvent(PLAYER1, [revealedLive.instanceId], 1);
    game = emitGameEvent(game, cheerEvent);
    game = { ...game, pendingAbilities: [pending(source.instanceId, cheerEvent.eventId)] };

    const resolved = resolveChika(game);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('records turn1 use so a second own normal cheer does not enqueue again, and additional cheer is ignored', () => {
    const source = createCardInstance(member('PL!S-sd1-001-SD'), PLAYER1, 'chika-turn1');
    const firstLive = createCardInstance(live('PL!S-first-live'), PLAYER1, 'first-live');
    const secondLive = createCardInstance(live('PL!S-second-live'), PLAYER1, 'second-live');
    let game = registerCards(createGameState('s-sd1-001-turn1', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      firstLive,
      secondLive,
    ]);
    game = placeSourceOnStage(game, source.instanceId);

    const firstEvent = createCheerEvent(PLAYER1, [firstLive.instanceId], 1);
    game = emitGameEvent(game, firstEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [firstEvent],
    });
    expect(game.pendingAbilities).toHaveLength(1);
    game = resolveChika(game);

    const additionalEvent = createCheerEvent(PLAYER1, [secondLive.instanceId], 1, {
      additional: true,
    });
    game = emitGameEvent(game, additionalEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [additionalEvent],
    });
    expect(game.pendingAbilities).toEqual([]);

    const secondEvent = createCheerEvent(PLAYER1, [secondLive.instanceId], 1);
    game = emitGameEvent(game, secondEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
      cheerEvents: [secondEvent],
    });

    expect(game.pendingAbilities).toEqual([]);
    expect(
      game.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId === S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID
      )
    ).toHaveLength(1);
  });
});
