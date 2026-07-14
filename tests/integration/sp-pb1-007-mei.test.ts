import { describe, expect, it } from 'vitest';
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
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_PB1_007_LIVE_START_ACTIVATE_TWO_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function pending(sourceCardId: string, id: string): PendingAbilityState {
  return {
    id,
    abilityId: SP_PB1_007_LIVE_START_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(waitingCount: number, pendingCount = 1, markedIndex?: number) {
  const sources = Array.from({ length: pendingCount }, (_, index) =>
    createCardInstance(
      {
        cardCode: index === 0 ? 'PL!SP-pb1-007-R' : 'PL!SP-pb1-007-P＋',
        name: '米女メイ',
        groupNames: ['Liella!'],
        cardType: CardType.MEMBER,
        cost: 4,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      },
      P1,
      `mei-${index}`
    )
  );
  const energies = Array.from({ length: waitingCount }, (_, index) =>
    createCardInstance(
      { cardCode: `ENE-${index}`, name: `ENE-${index}`, cardType: CardType.ENERGY },
      P1,
      `energy-${index}`
    )
  );
  let game = registerCards(createGameState('sp-pb1-007', P1, 'P1', P2, 'P2'), [
    ...sources,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    energyZone: energies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sources[0]!.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    pendingAbilities: sources.map((source, index) => pending(source.instanceId, `pending-007-${index}`)),
    energyActivePhaseSkips:
      markedIndex === undefined
        ? game.energyActivePhaseSkips
        : [{ playerId: P1, energyCardId: energies[markedIndex]!.instanceId, sourceCardId: 'marker', abilityId: 'marker' }],
  };
  return { game, sources, energies };
}

function command(game: GameState, options: { cardId?: string; cardIds?: readonly string[]; inOrder?: boolean } = {}) {
  const session = createGameSession();
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      game.activeEffect!.id,
      options.cardId,
      undefined,
      options.inOrder,
      undefined,
      options.cardIds
    )
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result.gameState;
}

function tryCommand(game: GameState, cardIds: readonly string[]) {
  const session = createGameSession();
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session.executeCommand(
    createConfirmEffectStepCommand(P1, game.activeEffect!.id, undefined, undefined, undefined, undefined, cardIds)
  );
}

function orientations(game: GameState, ids: readonly string[]) {
  return ids.map((id) => game.players[0].energyZone.cardStates.get(id)?.orientation);
}

describe('PL!SP-pb1-007 Mei', () => {
  it.each([[2], [1], [0]] as const)('confirms before activating up to two from %i waiting energy', (count) => {
    const scenario = setup(count);
    let game = resolvePendingCardEffects(scenario.game).gameState;
    expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(game.activeEffect?.stepText).toBe('确认后结算此效果。');
    expect(orientations(game, scenario.energies.map((card) => card.instanceId))).toEqual(
      Array(count).fill(OrientationState.WAITING)
    );
    game = command(game);
    expect(orientations(game, scenario.energies.map((card) => card.instanceId))).toEqual(
      Array(count).fill(OrientationState.ACTIVE)
    );
    expect(game.pendingAbilities).toEqual([]);
    expect(game.actionHistory.at(-1)?.payload.activatedEnergyCardIds).toHaveLength(Math.min(2, count));
  });

  it('resolves multiple pending abilities in order without confirm-only windows', () => {
    const scenario = setup(4, 2);
    let game = resolvePendingCardEffects(scenario.game).gameState;
    expect(game.activeEffect?.canResolveInOrder).toBe(true);
    game = command(game, { inOrder: true });
    expect(game.activeEffect).toBeNull();
    expect(orientations(game, scenario.energies.map((card) => card.instanceId))).toEqual(
      Array(4).fill(OrientationState.ACTIVE)
    );
  });

  it('shows confirm-only when manually selecting this effect from multiple pending abilities', () => {
    const scenario = setup(4, 2);
    let game = resolvePendingCardEffects(scenario.game).gameState;
    game = command(game, { cardId: scenario.sources[0]!.instanceId });
    expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(orientations(game, scenario.energies.map((card) => card.instanceId))).toEqual(
      Array(4).fill(OrientationState.WAITING)
    );
    game = command(game);
    expect(orientations(game, scenario.energies.map((card) => card.instanceId)).filter((value) => value === OrientationState.ACTIVE)).toHaveLength(2);
    expect(game.pendingAbilities).toHaveLength(1);
  });

  it('opens the common exact-two selection for marked energy and rejects duplicate, illegal, and stale ids', () => {
    const scenario = setup(3, 1, 2);
    let game = command(resolvePendingCardEffects(scenario.game).gameState);
    expect(game.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择要变为活跃状态的待机能量。',
      selectionLabel: '选择要变为活跃的能量',
      confirmSelectionLabel: '变为活跃',
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    const before = game;
    expect(
      tryCommand(before, [scenario.energies[0]!.instanceId, scenario.energies[0]!.instanceId])
        .success
    ).toBe(false);
    expect(tryCommand(before, [scenario.energies[0]!.instanceId, 'illegal']).success).toBe(false);
    const staleId = scenario.energies[0]!.instanceId;
    const staleState = updatePlayer(before, P1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, staleId),
    }));
    const staleResult = tryCommand(staleState, [staleId, scenario.energies[2]!.instanceId]);
    expect(staleResult.gameState.pendingAbilities).toHaveLength(1);
    expect(staleResult.gameState.actionHistory).toEqual(staleState.actionHistory);
    const selected = [scenario.energies[0]!.instanceId, scenario.energies[2]!.instanceId];
    game = command(before, { cardIds: selected });
    expect(orientations(game, selected)).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(game.players[0].energyZone.cardStates.get(scenario.energies[1]!.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(game.activeEffect).toBeNull();
  });
});
