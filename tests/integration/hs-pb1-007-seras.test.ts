import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    cardCode: 'PL!HS-pb1-007-R',
    name: 'セラス 柳田 リリエンフェルト',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'EdelNote',
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 4,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function createHasunosoraMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
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
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function createNonHasunosoraLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function startOnEnter(options: {
  readonly activeEnergyCount: number;
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards: readonly ReturnType<typeof createCardInstance>[];
}): {
  readonly session: GameSession;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly energyCards: readonly ReturnType<typeof createCardInstance>[];
} {
  const source = createCardInstance(createSerasData(), PLAYER1, 'seras-pb1-007-source');
  const energyCards = Array.from({ length: options.activeEnergyCount }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('hs-pb1-007-seras', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyCards, ...options.handCards, ...options.waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let energyZone = player.energyZone;
    for (const energy of energyCards) {
      energyZone = addCardToStatefulZone(energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    return {
      ...player,
      energyZone,
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
    };
  });
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const resolveResult = resolvePendingCardEffects(stateWithPending);
  const session = createGameSession();
  session.createGame('hs-pb1-007-seras-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = resolveResult.gameState;
  return { session, source, energyCards };
}

function confirmCard(session: GameSession, cardId: string | null): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, cardId)
  );
  expect(result.success).toBe(true);
  confirmPublicSelectionIfNeeded(session);
}

describe('PL!HS-pb1-007 Seras workflow', () => {
  it('pays two active energy, discards one hand card, then recovers a Hasunosora card', () => {
    const discard = createCardInstance(
      createNonHasunosoraLive('PL!SP-test-discard'),
      PLAYER1,
      'discard-card'
    );
    const target = createCardInstance(
      createHasunosoraMember('PL!HS-test-waiting-member'),
      PLAYER1,
      'waiting-member'
    );
    const { session, energyCards } = startOnEnter({
      activeEnergyCount: 2,
      handCards: [discard],
      waitingCards: [target],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
      selectableCardIds: [discard.instanceId],
      canSkipSelection: true,
    });

    confirmCard(session, discard.instanceId);

    for (const energy of energyCards) {
      expect(session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      canSkipSelection: false,
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

  it('allows recovering the Hasunosora card discarded as the cost', () => {
    const discardedTarget = createCardInstance(
      createHasunosoraLive('PL!HS-test-discarded-live'),
      PLAYER1,
      'discarded-live'
    );
    const { session } = startOnEnter({
      activeEnergyCount: 2,
      handCards: [discardedTarget],
      waitingCards: [],
    });

    confirmCard(session, discardedTarget.instanceId);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardedTarget.instanceId]);
    confirmCard(session, discardedTarget.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([discardedTarget.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('skips without paying energy, discarding, or recovering', () => {
    const discard = createCardInstance(
      createHasunosoraMember('PL!HS-test-skip-discard'),
      PLAYER1,
      'skip-discard'
    );
    const target = createCardInstance(
      createHasunosoraLive('PL!HS-test-skip-target'),
      PLAYER1,
      'skip-target'
    );
    const { session, energyCards } = startOnEnter({
      activeEnergyCount: 2,
      handCards: [discard],
      waitingCards: [target],
    });

    confirmCard(session, null);

    expect(session.state?.activeEffect).toBeNull();
    for (const energy of energyCards) {
      expect(session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
    expect(session.state?.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
  });

  it('does not pay costs and consumes pending when energy or hand is insufficient', () => {
    const handCard = createCardInstance(
      createHasunosoraMember('PL!HS-test-insufficient-hand-card'),
      PLAYER1,
      'insufficient-hand-card'
    );
    const energyShort = startOnEnter({
      activeEnergyCount: 1,
      handCards: [handCard],
      waitingCards: [],
    });

    expect(energyShort.session.state?.activeEffect).toBeNull();
    expect(energyShort.session.state?.pendingAbilities).toEqual([]);
    expect(
      energyShort.session.state?.players[0].energyZone.cardStates.get(
        energyShort.energyCards[0]!.instanceId
      )?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      energyShort.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID &&
          action.payload.step === 'NOT_ENOUGH_ACTIVE_ENERGY'
      )
    ).toBe(true);

    const handShort = startOnEnter({
      activeEnergyCount: 2,
      handCards: [],
      waitingCards: [],
    });
    expect(handShort.session.state?.activeEffect).toBeNull();
    expect(handShort.session.state?.pendingAbilities).toEqual([]);
    expect(
      handShort.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID &&
          action.payload.step === 'NOT_ENOUGH_HAND_TO_DISCARD'
      )
    ).toBe(true);
    for (const energy of handShort.energyCards) {
      expect(handShort.session.state?.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('filters targets to Hasunosora cards while allowing both members and LIVE cards', () => {
    const discard = createCardInstance(
      createNonHasunosoraLive('PL!SP-test-filter-discard'),
      PLAYER1,
      'filter-discard'
    );
    const hasunosoraMember = createCardInstance(
      createHasunosoraMember('PL!HS-test-filter-member'),
      PLAYER1,
      'hasunosora-member'
    );
    const hasunosoraLive = createCardInstance(
      createHasunosoraLive('PL!HS-test-filter-live'),
      PLAYER1,
      'hasunosora-live'
    );
    const nonHasunosoraLive = createCardInstance(
      createNonHasunosoraLive('PL!SP-test-filter-live'),
      PLAYER1,
      'non-hasunosora-live'
    );
    const { session } = startOnEnter({
      activeEnergyCount: 2,
      handCards: [discard],
      waitingCards: [hasunosoraMember, hasunosoraLive, nonHasunosoraLive],
    });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      hasunosoraMember.instanceId,
      hasunosoraLive.instanceId,
    ]);
    const handBeforeInvalidSelection = session.state?.players[0].hand.cardIds;
    const waitingBeforeInvalidSelection = session.state?.players[0].waitingRoom.cardIds;
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        nonHasunosoraLive.instanceId
      )
    );

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      hasunosoraMember.instanceId,
      hasunosoraLive.instanceId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual(handBeforeInvalidSelection);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(waitingBeforeInvalidSelection);
  });
});
