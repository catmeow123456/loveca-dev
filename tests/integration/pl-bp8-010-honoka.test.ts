import { describe, expect, it } from 'vitest';
import { activateCardAbility } from '../../src/application/card-effect-runner';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { updatePlayer } from '../../src/domain/entities/game';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { GamePhase, OrientationState, TriggerCondition } from '../../src/shared/types/enums';
import {
  P1,
  P2,
  setup,
  activate,
  select,
  advance,
  payActions,
  uses,
  events,
  bottomEvents,
  reenter,
} from '../helpers/october-26-activated-fixture';
import {
  PL_BP8_010_ACTIVATED_WAIT_SELF_BOTTOM_UP_TO_TWO_WAITING_CARDS_ABILITY_ID as HONOKA,
  HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID as KAHO,
} from '../../src/application/card-effects/ability-ids';

describe('PL!-bp8-010 费用4「高坂穂乃果」', () => {
  it('pays wait and one use before selecting arbitrary card types, preserves order and completes before the generated AUTO', () => {
    let game = activate(setup(HONOKA, { watcher: true }), HONOKA);
    expect(game.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(payActions(game, HONOKA)).toHaveLength(1);
    expect(uses(game, HONOKA)).toHaveLength(1);
    expect(events(game, TriggerCondition.ON_MEMBER_STATE_CHANGED)).toHaveLength(1);
    expect(game.activeEffect?.selectableCardIds).toContain('muse-live');
    game = select(game, ['muse-live', 'member-1']);
    expect(game.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck-tail']);
    expect(payActions(game, HONOKA)).toHaveLength(1);
    game = advance(game);
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck-tail', 'muse-live', 'member-1']);
    expect(bottomEvents(game)).toHaveLength(1);
    expect(game.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(game, P1, 'watcher')).toBe(4);
    expect(
      game.actionHistory.findIndex(
        (action) =>
          action.payload.abilityId === HONOKA &&
          action.payload.step === 'BOTTOM_UP_TO_TWO_WAITING_CARDS'
      )
    ).toBeLessThan(
      game.actionHistory.findIndex(
        (action) =>
          action.payload.abilityId === KAHO &&
          action.payload.step === 'WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE'
      )
    );
    expect(payActions(game, HONOKA)).toHaveLength(1);
    expect(uses(game, HONOKA)).toHaveLength(1);
  });

  it.each([{ selected: [] }, { selected: ['member-1'] }])(
    'allows zero or one move ($selected), consuming the wait cost and turn limit',
    ({ selected }) => {
      const started = activate(setup(HONOKA), HONOKA);
      let game = select(started, selected);
      if (selected.length) game = advance(game);
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].mainDeck.cardIds).toEqual(['deck-tail', ...selected]);
      expect(bottomEvents(game)).toHaveLength(selected.length ? 1 : 0);
      expect(uses(game, HONOKA)).toHaveLength(1);
      const activeAgain = setMemberOrientation(
        game,
        P1,
        'source',
        OrientationState.ACTIVE
      )!.gameState;
      expect(activate(activeAgain, HONOKA)).toBe(activeAgain);
    }
  );

  it('pays and completes with an empty waiting room; refuses an already waiting source', () => {
    const game = activate(setup(HONOKA, { waiting: [] }), HONOKA);
    expect(game.activeEffect).toBeNull();
    expect(payActions(game, HONOKA)).toHaveLength(1);
    expect(uses(game, HONOKA)).toHaveLength(1);
    expect(bottomEvents(game)).toHaveLength(0);
    const waiting = setMemberOrientation(
      setup(HONOKA),
      P1,
      'source',
      OrientationState.WAITING
    )!.gameState;
    expect(activate(waiting, HONOKA)).toBe(waiting);
  });

  it('rejects duplicate/excess/foreign choices and revalidates the entire displayed batch without refunding wait or use', () => {
    const started = activate(setup(HONOKA), HONOKA);
    for (const ids of [
      ['member-1', 'member-1'],
      ['member-1', 'member-2', 'muse-live'],
      ['opponent-member'],
    ])
      expect(select(started, ids)).toBe(started);
    let game = select(started, ['member-1', 'member-2']);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'member-2'),
      },
    }));
    game = advance(game);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck-tail']);
    expect(game.players[0].waitingRoom.cardIds).toContain('member-1');
    expect(game.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(payActions(game, HONOKA)).toHaveLength(1);
    expect(uses(game, HONOKA)).toHaveLength(1);
    expect(bottomEvents(game)).toHaveLength(0);
  });

  it('continues the independent move after source reentry, keeping use bound to the paid source object', () => {
    const started = activate(setup(HONOKA), HONOKA);
    const oldLifecycle = started.activeEffect!.sourceLifecycleId;
    let game = reenter(select(started, ['member-1']));
    game = advance(game);
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck-tail', 'member-1']);
    expect(uses(game, HONOKA)[0].payload.sourceLifecycleId).toBe(oldLifecycle);
    expect(getAbilitySourceLifecycleId(game, HONOKA, 'source')).not.toBe(oldLifecycle);
    expect(activate(game, HONOKA).activeEffect?.abilityId).toBe(HONOKA);
  });
});

describe('source timing and ownership', () => {
  it('rejects non-main, non-active-player and wrong-owner sources', () => {
    const game = setup(HONOKA);
    const wrongPhase = { ...game, currentPhase: GamePhase.PERFORMANCE_PHASE };
    expect(activate(wrongPhase, HONOKA)).toBe(wrongPhase);
    const wrongTurn = { ...game, activePlayerIndex: 1 };
    expect(activate(wrongTurn, HONOKA)).toBe(wrongTurn);
    expect(activateCardAbility(game, P2, 'source', HONOKA)).toBe(game);
    expect(activateCardAbility(game, P1, 'opponent-member', HONOKA)).toBe(game);
  });
});
