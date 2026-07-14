import { describe, expect, it } from 'vitest';
import {
  createGameState,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import type { EnergyMovedToDeckEvent } from '../../src/domain/events/game-events';
import { resolveEnergyReturnByCardEffect } from '../../src/application/card-effects/runtime/energy-return';
import { FaceState, OrientationState, TriggerCondition } from '../../src/shared/types/enums';

describe('card-effect energy return runtime', () => {
  it('moves energy, clears its marker, and enqueues the exact emitted batch event', () => {
    let game = createGameState('energy-return', 'p1', 'P1', 'p2', 'P2');
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: ['energy-1', 'energy-2'],
        cardStates: new Map([
          ['energy-1', { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
          ['energy-2', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: 'p1',
          energyCardId: 'energy-1',
          sourceCardId: 'source',
          abilityId: 'ability',
        },
      ],
    };
    let receivedTriggers: readonly TriggerCondition[] = [];
    let receivedEvents: readonly EnergyMovedToDeckEvent[] = [];

    const result = resolveEnergyReturnByCardEffect(game, {
      playerId: 'p1',
      selectedEnergyCardIds: ['energy-1'],
      cause: {
        kind: 'CARD_EFFECT',
        playerId: 'p1',
        sourceCardId: 'source',
        abilityId: 'ability',
      },
      exactCount: 1,
      enqueueTriggeredCardEffects: (state, triggers, options): GameState => {
        receivedTriggers = triggers;
        receivedEvents = options?.energyMovedToDeckEvents ?? [];
        return state;
      },
    });

    expect(result?.movedEnergyCardIds).toEqual(['energy-1']);
    expect(result?.gameState.players[0].energyZone.cardIds).toEqual(['energy-2']);
    expect(result?.gameState.players[0].energyDeck.cardIds).toEqual(['energy-1']);
    expect(result?.gameState.energyActivePhaseSkips).toEqual([]);
    expect(receivedTriggers).toEqual([TriggerCondition.ON_ENERGY_MOVED_TO_DECK]);
    expect(receivedEvents).toEqual([result?.energyMovedEvent]);
    expect(
      result?.gameState.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK
      )
    ).toHaveLength(1);
  });
});
