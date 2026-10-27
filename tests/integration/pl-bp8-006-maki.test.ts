import { describe, expect, it } from 'vitest';
import { activateCardAbility } from '../../src/application/card-effect-runner';

import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';

import { updatePlayer } from '../../src/domain/entities/game';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { GamePhase, OrientationState } from '../../src/shared/types/enums';
import {
  P1,
  P2,
  setup,
  activate,
  select,
  advance,
  payActions,
  uses,
  bottomEvents,
  sessionFor,
} from '../helpers/october-26-activated-fixture';
import {
  PL_BP8_006_ACTIVATED_WAITING_ROOM_PAY_TWO_BOTTOM_SELF_RECOVER_MUSE_LIVE_ABILITY_ID as MAKI,
  HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID as KAHO,
} from '../../src/application/card-effects/ability-ids';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { ENERGY_OPERATION_SELECTION_STEP_ID } from '../../src/application/card-effects/runtime/energy-operation-selection';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

describe('PL!-bp8-006 费用15「西木野真姬」', () => {
  it('starts from the official command in waiting room, pays both costs before selecting a Muse LIVE, and finishes before the generated AUTO', () => {
    const session = sessionFor(
      setup(MAKI, { watcher: true, waiting: ['muse-live', 'other-live', 'member-1'] })
    );
    const result = session.executeCommand(createActivateAbilityCommand(P1, 'source', MAKI));
    expect(result.success, result.error).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck-tail', 'source']);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: MAKI,
      selectableCardIds: ['muse-live'],
      canSkipSelection: false,
    });
    expect(session.state!.activeEffect!.stepId).not.toBe(
      PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID
    );
    expect(payActions(session.state!, MAKI)).toHaveLength(1);
    expect(uses(session.state!, MAKI)).toHaveLength(1);
    expect(session.state!.pendingAbilities.some((ability) => ability.abilityId === KAHO)).toBe(
      true
    );
    const choose = session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'muse-live')
    );
    expect(choose.success, choose.error).toBe(true);
    expect(session.state!.activeEffect!.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(session.state!.players[0].hand.cardIds).not.toContain('muse-live');
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toContain('muse-live');
    expect(session.state!.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(session.state!, P1, 'watcher')).toBe(4);
    expect(
      session.state!.actionHistory.findIndex(
        (action) => action.payload.abilityId === MAKI && action.payload.step === 'FINISH'
      )
    ).toBeLessThan(
      session.state!.actionHistory.findIndex(
        (action) =>
          action.payload.abilityId === KAHO &&
          action.payload.step === 'WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE'
      )
    );
    expect(bottomEvents(session.state!)).toHaveLength(1);
    expect(payActions(session.state!, MAKI)[0].payload.energyCardIds).toEqual([
      'energy-0',
      'energy-1',
    ]);
    expect(payActions(session.state!, MAKI)).toHaveLength(1);
    expect(uses(session.state!, MAKI)).toHaveLength(1);
  });

  it('still pays and consumes exactly one use when there is no recovery target', () => {
    const game = activate(setup(MAKI, { waiting: ['member-1', 'other-live'] }), MAKI);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck-tail', 'source']);
    expect(game.players[0].waitingRoom.cardIds).toEqual(['member-1', 'other-live']);
    expect(payActions(game, MAKI)).toHaveLength(1);
    expect(uses(game, MAKI)).toHaveLength(1);
    expect(
      game.players[0].energyZone.cardIds.every(
        (id) =>
          game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
      )
    ).toBe(true);
    const withoutSource = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: ['deck-tail'] },
      waitingRoom: { ...player.waitingRoom, cardIds: [...player.waitingRoom.cardIds, 'source'] },
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(
          [...player.energyZone.cardStates].map(([id, state]) => [
            id,
            { ...state, orientation: OrientationState.ACTIVE },
          ])
        ),
      },
    }));
    const twice = activate(withoutSource, MAKI);
    expect(payActions(twice, MAKI)).toHaveLength(2);
    expect(uses(twice, MAKI)).toHaveLength(2);
  });

  it('handles insufficient, exact, ordinary-surplus and special-surplus energy with atomic stale/invalid rejection', () => {
    for (const count of [0, 1]) {
      const game = setup(MAKI, { energies: count });
      expect(activate(game, MAKI)).toBe(game);
    }
    const normal = activate(setup(MAKI, { energies: 3 }), MAKI);
    expect(payActions(normal, MAKI)[0].payload.energyCardIds).toEqual(['energy-0', 'energy-1']);
    expect(normal.players[0].energyZone.cardStates.get('energy-2')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    const selecting = activate(setup(MAKI, { energies: 3, marked: true }), MAKI);
    expect(selecting.activeEffect?.stepId).toBe(ENERGY_OPERATION_SELECTION_STEP_ID);
    expect(payActions(selecting, MAKI)).toHaveLength(0);
    expect(select(selecting, ['energy-2', 'energy-2'])).toBe(selecting);
    expect(select(selecting, ['energy-2', 'member-1'])).toBe(selecting);
    const paid = select(selecting, ['energy-2', 'energy-0']);
    expect(payActions(paid, MAKI)[0].payload.energyCardIds).toEqual(['energy-2', 'energy-0']);
    expect(paid.players[0].energyZone.cardStates.get('energy-1')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(paid.players[0].mainDeck.cardIds).toContain('source');
    const staleSource = updatePlayer(selecting, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'source'),
      },
      hand: { ...player.hand, cardIds: ['source'] },
    }));
    const rejected = select(staleSource, ['energy-0', 'energy-2']);
    expect(payActions(rejected, MAKI)).toHaveLength(0);
    expect(
      rejected.players[0].energyZone.cardIds.every(
        (id) =>
          rejected.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toBe(true);
    expect(rejected.players[0].hand.cardIds).toEqual(['source']);
    const staleEnergy = updatePlayer(selecting, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(
          [...player.energyZone.cardStates].map(([id, state]) => [
            id,
            id === 'energy-2' ? { ...state, orientation: OrientationState.WAITING } : state,
          ])
        ),
      },
    }));
    expect(select(staleEnergy, ['energy-0', 'energy-2'])).toBe(staleEnergy);
    expect(payActions(staleEnergy, MAKI)).toHaveLength(0);
  });

  it('revalidates the recovery after public display, retaining paid costs and continuing on stale target', () => {
    const started = activate(setup(MAKI, { watcher: true }), MAKI);
    expect(confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'member-1')).toBe(
      started
    );
    let game = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'muse-live');
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'muse-live'),
      },
    }));
    game = advance(game);
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(game.players[0].mainDeck.cardIds).toContain('source');
    expect(payActions(game, MAKI)).toHaveLength(1);
    expect(uses(game, MAKI)).toHaveLength(1);
    expect(game.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(game, P1, 'watcher')).toBe(4);
  });
});

describe('source timing and ownership', () => {
  it('rejects non-main, non-active-player and wrong-owner sources', () => {
    const game = setup(MAKI);
    const wrongPhase = { ...game, currentPhase: GamePhase.PERFORMANCE_PHASE };
    expect(activate(wrongPhase, MAKI)).toBe(wrongPhase);
    const wrongTurn = { ...game, activePlayerIndex: 1 };
    expect(activate(wrongTurn, MAKI)).toBe(wrongTurn);
    expect(activateCardAbility(game, P2, 'source', MAKI)).toBe(game);
    expect(activateCardAbility(game, P1, 'opponent-member', MAKI)).toBe(game);
  });
});
