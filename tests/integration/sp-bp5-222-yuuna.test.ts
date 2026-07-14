import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP5_222_LIVE_START_PAY_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function member(): MemberCardData {
  return {
    cardCode: 'PL!SP-bp5-222-R',
    name: '聖澤悠奈',
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 8,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-222-live-start',
    abilityId: SP_BP5_222_LIVE_START_PAY_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
  };
}

function setup(options: {
  readonly activeEnergyCount: number;
  readonly energyDeckCount: number;
  readonly sourceOnStage?: boolean;
}) {
  const source = createCardInstance(member(), PLAYER1, 'yuuna-source');
  const energyZoneCards = Array.from({ length: Math.max(options.activeEnergyCount, 1) }, (_, index) =>
    createCardInstance(energy(`PL!EZ-${index}`), PLAYER1, `energy-zone-${index}`)
  );
  const energyDeckCards = Array.from({ length: options.energyDeckCount }, (_, index) =>
    createCardInstance(energy(`PL!ED-${index}`), PLAYER1, `energy-deck-${index}`)
  );
  let game = createGameState('sp-bp5-222-yuuna', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyZoneCards, ...energyDeckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    energyZone: energyZoneCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < options.activeEnergyCount ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    energyDeck: energyDeckCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyDeck
    ),
  }));
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    sourceId: source.instanceId,
    energyZoneIds: energyZoneCards.map((card) => card.instanceId),
    energyDeckIds: energyDeckCards.map((card) => card.instanceId),
  };
}

describe('PL!SP-bp5-222 Yuuna live-start workflow', () => {
  it('pays one active energy and places one waiting energy from the energy deck', () => {
    const scenario = setup({ activeEnergyCount: 1, energyDeckCount: 1 });
    const started = resolvePendingCardEffects(scenario.game).gameState;
    expect(started.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付[E]' },
    ]);
    expect(started.activeEffect?.canSkipSelection).toBe(true);
    expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].energyZone.cardStates.get(scenario.energyZoneIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[0].energyZone.cardIds).toContain(scenario.energyDeckIds[0]);
    expect(resolved.players[0].energyZone.cardStates.get(scenario.energyDeckIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('decline or missing source/resource safely consumes pending without placement', () => {
    const payable = setup({ activeEnergyCount: 1, energyDeckCount: 1 });
    const started = resolvePendingCardEffects(payable.game).gameState;
    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(declined.players[0].energyDeck.cardIds).toEqual(payable.energyDeckIds);
    expect(declined.players[0].energyZone.cardIds).not.toContain(payable.energyDeckIds[0]);

    const noActiveEnergy = resolvePendingCardEffects(
      setup({ activeEnergyCount: 0, energyDeckCount: 1 }).game
    ).gameState;
    expect(noActiveEnergy.activeEffect).toBeNull();
    expect(noActiveEnergy.pendingAbilities).toEqual([]);

    const noEnergyDeck = resolvePendingCardEffects(
      setup({ activeEnergyCount: 1, energyDeckCount: 0 }).game
    ).gameState;
    expect(noEnergyDeck.activeEffect).toBeNull();
    expect(noEnergyDeck.pendingAbilities).toEqual([]);

    const sourceGone = resolvePendingCardEffects(
      setup({ activeEnergyCount: 1, energyDeckCount: 1, sourceOnStage: false }).game
    ).gameState;
    expect(sourceGone.activeEffect).toBeNull();
    expect(sourceGone.pendingAbilities).toEqual([]);
  });

  it('does not roll back paid energy when the energy deck candidate disappears after prompt opens', () => {
    const scenario = setup({ activeEnergyCount: 1, energyDeckCount: 1 });
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const candidateGone: GameState = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      energyDeck: removeCardFromZone(player.energyDeck, scenario.energyDeckIds[0]),
    }));

    const resolved = confirmActiveEffectStep(
      candidateGone,
      PLAYER1,
      candidateGone.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].energyZone.cardStates.get(scenario.energyZoneIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[0].energyZone.cardIds).not.toContain(scenario.energyDeckIds[0]);
  });
});
