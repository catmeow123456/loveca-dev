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
import { HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createSerasData(): MemberCardData {
  return {
    cardCode: 'PL!HS-bp5-007-R',
    name: 'セラス 柳田 リリエンフェルト',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'EdelNote',
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 3,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createMember(cardCode: string, unitName = 'EdelNote'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLive(cardCode: string, unitName = 'EdelNote'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.LIVE,
    score: 1,
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
  const source = createCardInstance(createSerasData(), PLAYER1, 'seras-source');
  let game = createGameState('hs-bp5-007-seras', PLAYER1, 'P1', PLAYER2, 'P2');
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
  session.createGame('hs-bp5-007-seras-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = resolveResult.gameState;
  return { session, source };
}

function confirmDiscard(session: GameSession, selectedCardIds: readonly string[]): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      activeEffect.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
  expect(result.success).toBe(true);
}

function confirmCard(session: GameSession, cardId: string | null): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, cardId)
  );
  expect(result.success).toBe(true);
}

describe('PL!HS-bp5-007 Seras workflow', () => {
  it('discards two hand cards then recovers an EdelNote LIVE from the waiting room', () => {
    const discardOne = createCardInstance(createMember('PL!HS-test-discard-a'), PLAYER1, 'discard-a');
    const discardTwo = createCardInstance(createMember('PL!HS-test-discard-b'), PLAYER1, 'discard-b');
    const target = createCardInstance(createLive('PL!HS-test-edelnote-live'), PLAYER1, 'target-live');
    const { session } = startOnEnter({
      handCards: [discardOne, discardTwo],
      waitingCards: [target],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID,
      selectableCardIds: [discardOne.instanceId, discardTwo.instanceId],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: true,
    });

    confirmDiscard(session, [discardOne.instanceId, discardTwo.instanceId]);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      canSkipSelection: false,
    });

    confirmCard(session, target.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardOne.instanceId,
      discardTwo.instanceId,
    ]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(discardOne.instanceId) &&
          entry.event.cardInstanceIds?.includes(discardTwo.instanceId)
      )
    ).toBe(true);
  });

  it('allows recovering the EdelNote LIVE discarded as the cost', () => {
    const discardedLive = createCardInstance(
      createLive('PL!HS-test-discarded-edelnote-live'),
      PLAYER1,
      'discarded-live'
    );
    const discardFodder = createCardInstance(
      createMember('PL!HS-test-discard-fodder', 'スリーズブーケ'),
      PLAYER1,
      'discard-fodder'
    );
    const { session } = startOnEnter({
      handCards: [discardedLive, discardFodder],
      waitingCards: [],
    });

    confirmDiscard(session, [discardedLive.instanceId, discardFodder.instanceId]);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardedLive.instanceId]);
    confirmCard(session, discardedLive.instanceId);

    expect(session.state?.players[0].hand.cardIds).toEqual([discardedLive.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardFodder.instanceId]);
  });

  it('skips without discarding or recovering', () => {
    const discardOne = createCardInstance(createMember('PL!HS-test-skip-a'), PLAYER1, 'skip-a');
    const discardTwo = createCardInstance(createMember('PL!HS-test-skip-b'), PLAYER1, 'skip-b');
    const target = createCardInstance(createLive('PL!HS-test-skip-live'), PLAYER1, 'skip-live');
    const { session } = startOnEnter({
      handCards: [discardOne, discardTwo],
      waitingCards: [target],
    });

    confirmCard(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      discardOne.instanceId,
      discardTwo.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID &&
          action.payload.step === 'SKIP_DISCARD_COST'
      )
    ).toBe(true);
  });

  it('does not allow non-EdelNote LIVE, EdelNote members, or non-LIVE targets', () => {
    const discardOne = createCardInstance(createMember('PL!HS-test-filter-a'), PLAYER1, 'filter-a');
    const discardTwo = createCardInstance(createMember('PL!HS-test-filter-b'), PLAYER1, 'filter-b');
    const validLive = createCardInstance(createLive('PL!HS-test-valid-edelnote-live'), PLAYER1, 'valid-live');
    const nonEdelNoteLive = createCardInstance(
      createLive('PL!HS-test-non-edelnote-live', 'スリーズブーケ'),
      PLAYER1,
      'non-edelnote-live'
    );
    const edelNoteMember = createCardInstance(
      createMember('PL!HS-test-edelnote-member'),
      PLAYER1,
      'edelnote-member'
    );
    const { session } = startOnEnter({
      handCards: [discardOne, discardTwo],
      waitingCards: [validLive, nonEdelNoteLive, edelNoteMember],
    });

    confirmDiscard(session, [discardOne.instanceId, discardTwo.instanceId]);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validLive.instanceId]);
    const handBeforeInvalidSelection = session.state?.players[0].hand.cardIds;
    const waitingBeforeInvalidSelection = session.state?.players[0].waitingRoom.cardIds;

    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, nonEdelNoteLive.instanceId)
    );

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validLive.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual(handBeforeInvalidSelection);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(waitingBeforeInvalidSelection);
  });

  it('consumes the pending ability without opening a window when hand has fewer than two cards', () => {
    const onlyHandCard = createCardInstance(
      createMember('PL!HS-test-only-hand'),
      PLAYER1,
      'only-hand'
    );
    const target = createCardInstance(createLive('PL!HS-test-no-window-live'), PLAYER1, 'no-window-live');
    const { session } = startOnEnter({ handCards: [onlyHandCard], waitingCards: [target] });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([onlyHandCard.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID &&
          action.payload.step === 'NOT_ENOUGH_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });
});
