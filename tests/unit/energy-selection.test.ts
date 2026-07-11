import { describe, expect, it } from 'vitest';
import { createGameState, updatePlayer } from '../../src/domain/entities/game';
import {
  EnergySelectionRequiredError,
  getEnergySelectionCandidates,
  resolveEnergySelectionForOperation,
  shouldSelectEnergyCards,
  shouldSelectEnergyForOperation,
  withEnergySelectionResolution,
  type EnergySelectionOperation,
} from '../../src/application/effects/energy-selection';
import { FaceState, OrientationState } from '../../src/shared/types/enums';
describe('energy selection policy', () => {
  it('opens selection whenever a selectable candidate has a skip marker', () => {
    const g = createGameState('g', 'p1', 'P1', 'p2', 'P2');
    const marked = {
      ...g,
      energyActivePhaseSkips: [
        { playerId: 'p1', energyCardId: 'special', sourceCardId: 's', abilityId: 'a' },
        { playerId: 'p1', energyCardId: 'special-2', sourceCardId: 's', abilityId: 'a' },
      ],
    };
    expect(shouldSelectEnergyCards(marked, ['normal', 'special'], 1)).toBe(true);
    expect(shouldSelectEnergyCards(marked, ['special', 'special-2'], 1)).toBe(true);
    expect(shouldSelectEnergyCards(marked, ['normal', 'special'], 2)).toBe(false);
    expect(shouldSelectEnergyCards(marked, ['a', 'b'], 1)).toBe(false);
  });

  it('filters candidates per payment, return, activation, and member-below operations', () => {
    let game = createGameState('ops', 'p1', 'P1', 'p2', 'P2');
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: ['active-normal', 'active-special', 'waiting-special'],
        cardStates: new Map([
          ['active-normal', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ['active-special', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ['waiting-special', { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    game = {
      ...game,
      energyActivePhaseSkips: [
        { playerId: 'p1', energyCardId: 'active-special', sourceCardId: 's', abilityId: 'a' },
        { playerId: 'p1', energyCardId: 'waiting-special', sourceCardId: 's', abilityId: 'a' },
      ],
    };
    expect(getEnergySelectionCandidates(game, 'p1', 'TAP_ACTIVE_ENERGY')).toEqual([
      'active-normal',
      'active-special',
    ]);
    expect(getEnergySelectionCandidates(game, 'p1', 'ACTIVATE_WAITING_ENERGY')).toEqual([
      'waiting-special',
    ]);
    expect(shouldSelectEnergyForOperation(game, 'p1', 'TAP_ACTIVE_ENERGY', 1)).toBe(true);
    expect(shouldSelectEnergyForOperation(game, 'p1', 'RETURN_TO_ENERGY_DECK', 1)).toBe(true);
    expect(shouldSelectEnergyForOperation(game, 'p1', 'ACTIVATE_WAITING_ENERGY', 1)).toBe(false);
    expect(shouldSelectEnergyForOperation(game, 'p1', 'STACK_BELOW_MEMBER', 3)).toBe(false);
  });

  it.each<EnergySelectionOperation>([
    'TAP_ACTIVE_ENERGY',
    'ACTIVATE_WAITING_ENERGY',
    'RETURN_TO_ENERGY_DECK',
    'STACK_BELOW_MEMBER',
  ])('applies the complete decision matrix for %s', (operation) => {
    let game = createGameState(`matrix-${operation}`, 'p1', 'P1', 'p2', 'P2');
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: ['active-normal', 'active-special', 'waiting-normal', 'waiting-special'],
        cardStates: new Map([
          ['active-normal', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ['active-special', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ['waiting-normal', { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
          ['waiting-special', { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    const candidates = getEnergySelectionCandidates(game, 'p1', operation);
    game = {
      ...game,
      energyActivePhaseSkips: candidates.map((energyCardId) => ({
        playerId: 'p1',
        energyCardId,
        sourceCardId: 'source',
        abilityId: 'ability',
      })),
    };
    expect(shouldSelectEnergyForOperation(game, 'p1', operation, candidates.length - 1)).toBe(
      true
    );
    expect(shouldSelectEnergyForOperation(game, 'p1', operation, candidates.length)).toBe(false);
    expect(shouldSelectEnergyForOperation(game, 'p1', operation, candidates.length + 1)).toBe(
      false
    );

    const mixed = {
      ...game,
      energyActivePhaseSkips: game.energyActivePhaseSkips.slice(0, 1),
    };
    expect(shouldSelectEnergyForOperation(mixed, 'p1', operation, 1)).toBe(
      candidates.length > 1
    );
    expect(
      shouldSelectEnergyForOperation({ ...game, energyActivePhaseSkips: [] }, 'p1', operation, 1)
    ).toBe(false);
    expect(resolveEnergySelectionForOperation(game, 'p1', operation, candidates.length + 1)).toBeNull();
  });

  it('uses the exact selected energy ids supplied by the common runtime boundary', () => {
    let game = createGameState('resolved-selection', 'p1', 'P1', 'p2', 'P2');
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: ['normal', 'special'],
        cardStates: new Map([
          ['normal', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ['special', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    game = {
      ...game,
      energyActivePhaseSkips: [
        { playerId: 'p1', energyCardId: 'special', sourceCardId: 's', abilityId: 'a' },
      ],
    };
    expect(() =>
      resolveEnergySelectionForOperation(game, 'p1', 'TAP_ACTIVE_ENERGY', 1)
    ).toThrow(EnergySelectionRequiredError);
    const result = withEnergySelectionResolution(
      {
        playerId: 'p1',
        operation: 'TAP_ACTIVE_ENERGY',
        requiredCount: 1,
        selectedEnergyCardIds: ['special'],
      },
      () => resolveEnergySelectionForOperation(game, 'p1', 'TAP_ACTIVE_ENERGY', 1)
    );
    expect(result?.selectedEnergyCardIds).toEqual(['special']);
  });
});
