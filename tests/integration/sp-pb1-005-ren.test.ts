import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(cardCode: string, id: string) {
  return createCardInstance(
    {
      cardCode,
      name: id,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 13,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    P1,
    id
  );
}

function setup(options: { energyDeckCount: number; listener?: boolean; followup?: boolean }) {
  const ren = member('PL!SP-pb1-005-R', 'ren-005');
  const listener = member('PL!SP-bp4-016-N', 'ren-listener');
  const energies = Array.from({ length: options.energyDeckCount }, (_, index) =>
    createCardInstance(
      { cardCode: `ENE-${index}`, name: `ENE-${index}`, cardType: CardType.ENERGY },
      P1,
      `energy-${index}`
    )
  );
  let game = registerCards(createGameState('sp-pb1-005', P1, 'P1', P2, 'P2'), [
    ren,
    listener,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    energyDeck: { ...player.energyDeck, cardIds: energies.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(
      options.listener
        ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, listener.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          })
        : player.memberSlots,
      SlotPosition.CENTER,
      ren.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  const pending: PendingAbilityState = {
    id: 'pending-005',
    abilityId: SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId: ren.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-005'],
    sourceSlot: SlotPosition.CENTER,
  };
  if (options.followup) {
    game = {
      ...game,
      pendingAbilities: [
        pending,
        { ...pending, id: 'pending-005-followup', sourceCardId: listener.instanceId },
      ],
    };
  } else {
    game = { ...game, pendingAbilities: [pending] };
  }
  return { game, ren, listener, energies };
}

describe('PL!SP-pb1-005 Ren', () => {
  it('places one WAITING energy, emits the complete event cause, and records resolution payload', () => {
    const scenario = setup({ energyDeckCount: 1 });
    const result = resolvePendingCardEffects(scenario.game).gameState;
    const energyId = scenario.energies[0]!.instanceId;
    expect(result.players[0].energyZone.cardIds).toEqual([energyId]);
    expect(result.players[0].energyZone.cardStates.get(energyId)?.orientation).toBe(
      OrientationState.WAITING
    );
    const event = result.eventLog.find(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
    )?.event;
    expect(event).toMatchObject({
      targetPlayerId: P1,
      placedEnergyCardIds: [energyId],
      orientation: OrientationState.WAITING,
      cause: {
        playerId: P1,
        sourceCardId: scenario.ren.instanceId,
        abilityId: SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
        pendingAbilityId: 'pending-005',
      },
    });
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
      )?.payload.placedEnergyCardIds
    ).toEqual([energyId]);
  });

  it('consumes an empty-deck pending without emitting an empty placement event', () => {
    const result = resolvePendingCardEffects(setup({ energyDeckCount: 0 }).game).gameState;
    expect(result.pendingAbilities).toEqual([]);
    expect(
      result.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toBe(false);
    expect(result.actionHistory.at(-1)?.payload.placedEnergyCardIds).toEqual([]);
  });

  it('continues the next pending after resolving', () => {
    let result = resolvePendingCardEffects(setup({ energyDeckCount: 2, followup: true }).game).gameState;
    expect(result.activeEffect?.canResolveInOrder).toBe(true);
    const session = createGameSession();
    (session as unknown as { authorityState: GameState }).authorityState = result;
    const commandResult = session.executeCommand(
      createConfirmEffectStepCommand(P1, result.activeEffect!.id, undefined, undefined, true)
    );
    expect(commandResult.success).toBe(true);
    result = commandResult.gameState;
    expect(result.players[0].energyZone.cardIds).toHaveLength(2);
    expect(result.pendingAbilities).toEqual([]);
  });

  it('lets the existing energy-placement listener enqueue and resolve in continuation', () => {
    const scenario = setup({ energyDeckCount: 1, listener: true });
    const result = resolvePendingCardEffects(scenario.game).gameState;
    expect(
      result.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID
      )
    ).toBe(true);
  });
});
