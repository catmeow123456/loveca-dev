import { describe, expect, it } from 'vitest';
import {
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers,
} from '../../src/application/card-effects/runtime/energy-below-placement-triggers';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(cardCode: string, instanceId: string) {
  return createCardInstance(
    {
      cardCode,
      name: instanceId,
      groupNames: ['虹ヶ咲'],
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    P1,
    instanceId
  );
}

function energy(instanceId: string) {
  return createCardInstance(
    { cardCode: `ENERGY-${instanceId}`, name: instanceId, cardType: CardType.ENERGY },
    P1,
    instanceId
  );
}

function setup(): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly hostId: string;
  readonly zoneEnergyIds: readonly string[];
  readonly deckEnergyIds: readonly string[];
} {
  const source = member('PL!N-bp7-001-P', 'ayumu-bp7-001');
  const host = member('HOST', 'host');
  const zoneEnergies = [energy('zone-energy-1'), energy('zone-energy-2')];
  const deckEnergies = [energy('deck-energy-1'), energy('deck-energy-2')];
  let game = registerCards(
    createGameState('n-bp7-001-energy-below-trigger', P1, 'P1', P2, 'P2'),
    [source, host, ...zoneEnergies, ...deckEnergies]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.CENTER,
      host.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    energyZone: {
      ...player.energyZone,
      cardIds: zoneEnergies.map((card) => card.instanceId),
      cardStates: new Map(
        zoneEnergies.map((card) => [
          card.instanceId,
          { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
        ])
      ),
    },
    energyDeck: {
      ...player.energyDeck,
      cardIds: deckEnergies.map((card) => card.instanceId),
    },
  }));
  return {
    game,
    sourceId: source.instanceId,
    hostId: host.instanceId,
    zoneEnergyIds: zoneEnergies.map((card) => card.instanceId),
    deckEnergyIds: deckEnergies.map((card) => card.instanceId),
  };
}

describe('PL!N-bp7-001-P energy-below event trigger', () => {
  it('emits one exact movement event, dispatches it once, and resolves one WAITING energy', () => {
    const scenario = setup();
    const moved = stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
      scenario.game,
      P1,
      SlotPosition.CENTER,
      1,
      {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.hostId,
        abilityId: 'test-stack-energy',
      }
    );

    expect(moved).not.toBeNull();
    expect(moved?.stackedEnergyCardIds).toEqual([scenario.zoneEnergyIds[0]]);
    expect(moved?.energyPlacedBelowMemberEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER,
      playerId: P1,
      energyCardIds: [scenario.zoneEnergyIds[0]],
      targetMemberCardId: scenario.hostId,
      targetSlot: SlotPosition.CENTER,
      fromZone: ZoneType.ENERGY_ZONE,
      toZone: ZoneType.MEMBER_SLOT,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.hostId,
        abilityId: 'test-stack-energy',
      },
    });
    expect(
      moved?.gameState.pendingAbilities.filter(
        (ability) =>
          ability.abilityId ===
          N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      moved?.gameState.actionHistory.filter(
        (action) =>
          action.type === 'DISPATCH_TRIGGER_EVENT' &&
          action.payload.eventId === moved.energyPlacedBelowMemberEvent.eventId
      )
    ).toHaveLength(1);

    const done = resolvePendingCardEffects(moved!.gameState).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toContain(scenario.deckEnergyIds[0]);
    expect(done.players[0].energyZone.cardStates.get(scenario.deckEnergyIds[0])).toMatchObject({
      orientation: OrientationState.WAITING,
    });
  });

  it('marks a turn-limit miss as dispatched so it cannot revive on a later turn', () => {
    const scenario = setup();
    const first = stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
      scenario.game,
      P1,
      SlotPosition.CENTER,
      1,
      {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.hostId,
        abilityId: 'first-stack',
      }
    )!;
    const afterFirst = resolvePendingCardEffects(first.gameState).gameState;

    const second = stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
      afterFirst,
      P1,
      SlotPosition.CENTER,
      1,
      {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.hostId,
        abilityId: 'second-stack',
      }
    )!;
    expect(second.gameState.pendingAbilities).toEqual([]);
    expect(
      second.gameState.actionHistory.filter(
        (action) =>
          action.type === 'DISPATCH_TRIGGER_EVENT' &&
          action.payload.eventId === second.energyPlacedBelowMemberEvent.eventId
      )
    ).toHaveLength(1);

    const nextTurn = resolvePendingCardEffects({
      ...second.gameState,
      turnCount: second.gameState.turnCount + 1,
    }).gameState;
    expect(nextTurn.pendingAbilities).toEqual([]);
    expect(nextTurn.activeEffect).toBeNull();
  });

  it('does not emit or dispatch when the move cannot happen', () => {
    const scenario = setup();
    const noEnergy = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      energyZone: { ...player.energyZone, cardIds: [], cardStates: new Map() },
    }));
    expect(
      stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
        noEnergy,
        P1,
        SlotPosition.CENTER,
        1,
        {
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: scenario.hostId,
          abilityId: 'failed-stack',
        }
      )
    ).toBeNull();
    expect(noEnergy.eventLog).toEqual([]);
    expect(noEnergy.actionHistory).toEqual([]);
  });
});
