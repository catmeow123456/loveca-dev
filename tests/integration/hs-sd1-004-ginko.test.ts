import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createHasunosoraMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createHasunosoraLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function startOnEnter(options: {
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards: readonly ReturnType<typeof createCardInstance>[];
}): {
  readonly session: GameSession;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(
    createHasunosoraMember('PL!HS-sd1-004-SD', '百生吟子'),
    PLAYER1,
    'ginko-source'
  );
  let game = createGameState('hs-sd1-004-ginko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...options.handCards, ...options.waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: options.handCards.map((card) => card.instanceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waitingCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const resolveResult = resolvePendingCardEffects(stateWithPending);
  const session = createGameSession();
  session.createGame('hs-sd1-004-ginko-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = resolveResult.gameState;
  return { session, source };
}

function confirmCard(session: GameSession, cardId: string | null): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, cardId)
  );
  expect(result.success).toBe(true);
}

describe('PL!HS-sd1-004-SD Ginko workflow', () => {
  it('discards a Hasunosora hand card as cost then recovers a waiting room member', () => {
    const discard = createCardInstance(
      createHasunosoraLive('PL!HS-test-live'),
      PLAYER1,
      'discard-live'
    );
    const target = createCardInstance(
      createHasunosoraMember('PL!HS-test-member', 'Recovery Target'),
      PLAYER1,
      'recover-member'
    );
    const { session } = startOnEnter({ handCards: [discard], waitingCards: [target] });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID,
      selectableCardIds: [discard.instanceId],
      canSkipSelection: true,
    });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID,
      selectableCardIds: [target.instanceId],
    });

    confirmCard(session, target.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(discard.instanceId)
      )
    ).toBe(true);
  });

  it('allows recovering the member discarded as the cost', () => {
    const discardMember = createCardInstance(
      createHasunosoraMember('PL!HS-test-discard-member', 'Discarded Member'),
      PLAYER1,
      'discard-member'
    );
    const { session } = startOnEnter({ handCards: [discardMember], waitingCards: [] });

    confirmCard(session, discardMember.instanceId);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardMember.instanceId]);
    confirmCard(session, discardMember.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([discardMember.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('keeps the paid discard cost and resolves empty when no member target exists', () => {
    const discardLive = createCardInstance(
      createHasunosoraLive('PL!HS-test-live-only'),
      PLAYER1,
      'discard-live'
    );
    const { session } = startOnEnter({ handCards: [discardLive], waitingCards: [] });

    confirmCard(session, discardLive.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardLive.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID &&
          action.payload.step === 'DISCARD_COST_NO_MEMBER_TARGET'
      )
    ).toBe(true);
  });
});
