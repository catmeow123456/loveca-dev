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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupScenario(options: {
  readonly successCount: number;
  readonly handCount?: number;
}): {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly discardCardIds: readonly string[];
} {
  const source = createCardInstance(createMember('PL!-bp3-006-P', '西木野真姫'), PLAYER1, 'maki');
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(createMember(`PL!-test-discard-${index}`, `discard-${index}`), PLAYER1, `discard-${index}`)
  );
  const successLives = Array.from({ length: options.successCount }, (_, index) =>
    createCardInstance(createLive(`PL!-test-success-${index}-L`), PLAYER1, `success-${index}`)
  );

  let game = createGameState('pl-bp3-006-maki', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCards, ...successLives]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    hand: {
      ...player.hand,
      cardIds: handCards.map((card) => card.instanceId),
    },
    successZone: successLives.reduce(
      (zone, live) => addCardToZone(zone, live.instanceId),
      player.successZone
    ),
  }));

  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPendingAbility(source.instanceId)],
  }).gameState;

  const session = createGameSession();
  session.createGame('pl-bp3-006-maki-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;

  return {
    session,
    sourceCardId: source.instanceId,
    discardCardIds: handCards.map((card) => card.instanceId),
  };
}

function selectDiscard(session: GameSession, discardCardId: string | null): ReturnType<GameSession['executeCommand']> {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
  );
}

describe('PL!-bp3-006 Maki LIVE start discard gain BLADE by success count', () => {
  it('discards one hand card and gives source member BLADE +4 with two own success LIVE cards', () => {
    const { session, sourceCardId, discardCardIds } = setupScenario({ successCount: 2 });
    const discardCardId = discardCardIds[0];

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID,
      selectableCardIds: [discardCardId],
      canSkipSelection: true,
    });

    expect(selectDiscard(session, discardCardId).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).not.toContain(discardCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 4,
      sourceCardId,
      abilityId: BP3_006_LIVE_START_DISCARD_GAIN_BLADE_BY_SUCCESS_COUNT_ABILITY_ID,
    });
  });

  it('can discard and resolve with zero own success LIVE cards without writing BLADE', () => {
    const { session, discardCardIds } = setupScenario({ successCount: 0 });
    const discardCardId = discardCardIds[0];

    expect(selectDiscard(session, discardCardId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'DISCARD_HAND_CARD_NO_SUCCESS_LIVE' &&
          action.payload.successLiveCount === 0 &&
          action.payload.bladeBonus === 0
      )
    ).toBe(true);
  });

  it('declines without discarding or adding BLADE', () => {
    const { session, discardCardIds } = setupScenario({ successCount: 2 });
    const discardCardId = discardCardIds[0];

    expect(selectDiscard(session, null).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(discardCardId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('consumes pending without opening a discard choice when hand is empty', () => {
    const { session } = setupScenario({ successCount: 2, handCount: 0 });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'NO_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });
});
