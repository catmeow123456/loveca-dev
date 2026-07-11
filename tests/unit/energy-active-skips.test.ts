import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import {
  addEnergyActivePhaseSkips,
  consumeEnergyActivePhaseSkipsForPlayer,
} from '../../src/domain/rules/energy-active-skips';
import { GameService } from '../../src/application/game-service';
import { projectPlayerViewState } from '../../src/online/projector';
import { removeCardFromPlayerZone } from '../../src/application/action-handlers/zone-operations';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
const energy = (id: string) =>
  createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, P1, id);
describe('energy active phase skips', () => {
  it('consumes only the owning player markers and tolerates legacy missing state', () => {
    const g = createGameState('g', P1, 'P1', P2, 'P2');
    expect(
      consumeEnergyActivePhaseSkipsForPlayer({ ...g, energyActivePhaseSkips: undefined }, P1)
        .skippedEnergyCardIds
    ).toEqual([]);
    const m = addEnergyActivePhaseSkips(g, [
      { playerId: P1, energyCardId: 'e', sourceCardId: 's', abilityId: 'a' },
    ]);
    expect(
      consumeEnergyActivePhaseSkipsForPlayer(m, P2).gameState.energyActivePhaseSkips
    ).toHaveLength(1);
    expect(consumeEnergyActivePhaseSkipsForPlayer(m, P1).gameState.energyActivePhaseSkips).toEqual(
      []
    );
  });
  it('keeps marked waiting energy waiting once while ordinary energy becomes active', () => {
    const e1 = energy('e1'),
      e2 = energy('e2');
    let g = registerCards(createGameState('g', P1, 'P1', P2, 'P2'), [e1, e2]);
    g = updatePlayer(g, P1, (p) => ({
      ...p,
      energyZone: addCardToStatefulZone(
        addCardToStatefulZone(p.energyZone, e1.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
        e2.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
    }));
    g = addEnergyActivePhaseSkips(g, [
      { playerId: P1, energyCardId: e1.instanceId, sourceCardId: 's', abilityId: 'a' },
    ]);
    const result = new GameService().advancePhase({
      ...g,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(result.success).toBe(true);
    expect(result.gameState.players[0].energyZone.cardStates.get('e1')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(result.gameState.players[0].energyZone.cardStates.get('e2')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(result.gameState.energyActivePhaseSkips).toEqual([]);
  });

  it('projects the public marker to both players without exposing the energy deck', () => {
    const e1 = energy('public-marker');
    let game = registerCards(createGameState('projection', P1, 'P1', P2, 'P2'), [e1]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    game = addEnergyActivePhaseSkips(game, [
      { playerId: P1, energyCardId: e1.instanceId, sourceCardId: 's', abilityId: 'a' },
    ]);
    game = {
      ...game,
      activeEffect: {
        id: 'energy-selection',
        abilityId: 'ability',
        sourceCardId: 'source',
        controllerId: P1,
        effectText: '选择能量',
        stepId: 'select',
        stepText: '请选择能量。',
        awaitingPlayerId: P1,
        selectableCardIds: [e1.instanceId],
        minSelectableCards: 1,
        maxSelectableCards: 1,
      },
    };
    expect(
      projectPlayerViewState(game, P1).objects['obj_public-marker']?.skipsNextActivePhase
    ).toBe(true);
    expect(
      projectPlayerViewState(game, P2).objects['obj_public-marker']?.skipsNextActivePhase
    ).toBe(true);
  });

  it('does not consume player 1 marker during player 2 active phase', () => {
    const e1 = energy('p1-opponent-phase-marker');
    let game = registerCards(createGameState('opponent-phase', P1, 'P1', P2, 'P2'), [e1]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    game = addEnergyActivePhaseSkips(game, [
      { playerId: P1, energyCardId: e1.instanceId, sourceCardId: 's', abilityId: 'a' },
    ]);
    const result = new GameService().advancePhase({
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
      firstPlayerIndex: 1,
    });
    expect(result.success).toBe(true);
    expect(result.gameState.energyActivePhaseSkips).toHaveLength(1);
    expect(result.gameState.players[0].energyZone.cardStates.get(e1.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('clears the marker on a manual/debug removal from the energy zone', () => {
    const e1 = energy('manual-leave');
    let game = registerCards(createGameState('manual-leave', P1, 'P1', P2, 'P2'), [e1]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    game = addEnergyActivePhaseSkips(game, [
      { playerId: P1, energyCardId: e1.instanceId, sourceCardId: 's', abilityId: 'a' },
    ]);
    expect(
      removeCardFromPlayerZone(game, P1, e1.instanceId, ZoneType.ENERGY_ZONE).energyActivePhaseSkips
    ).toEqual([]);
  });
});
