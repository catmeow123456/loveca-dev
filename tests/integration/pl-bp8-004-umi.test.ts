import { describe, expect, it } from 'vitest';
import { activateCardAbility } from '../../src/application/card-effect-runner';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { updatePlayer } from '../../src/domain/entities/game';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import {
  GamePhase,
  OrientationState,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';
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
  sessionFor,
  reenter,
} from '../helpers/october-26-activated-fixture';
import {
  PL_BP8_004_ACTIVATED_BOTTOM_TWO_NO_BLADE_HEART_MUSE_GAIN_COST_ABILITY_ID as UMI,
  HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID as KAHO,
} from '../../src/application/card-effects/ability-ids';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { SlotPosition } from '../../src/shared/types/enums';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';

describe('PL!-bp8-004 费用7「园田海未」', () => {
  it('pays exactly two ordered no-BLADE-HEART Muse members only after public selection, then gives cost +2 before AUTO continuation', () => {
    let game = setup(UMI, {
      watcher: true,
      waiting: [
        'member-1',
        'member-2',
        'blade-heart-member',
        'other-group-member',
        'muse-live',
        'opponent-member',
      ],
    });
    game = activate(game, UMI);
    expect(game.activeEffect?.selectableCardIds).toEqual(['member-1', 'member-2']);
    expect(game.activeEffect?.confirmSelectionLabel).toBe('按此顺序放置于卡组底');
    game = select(game, ['member-2', 'member-1']);
    expect(game.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(game.players[0].waitingRoom.cardIds).toContain('member-2');
    expect(payActions(game, UMI)).toHaveLength(0);
    expect(uses(game, UMI)).toHaveLength(0);
    expect(getMemberEffectiveCost(game, P1, 'source')).toBe(7);
    game = advance(game);
    expect(game.players[0].mainDeck.cardIds).toEqual(['deck-tail', 'member-2', 'member-1']);
    expect(payActions(game, UMI)).toHaveLength(1);
    expect(uses(game, UMI)).toHaveLength(1);
    expect(getMemberEffectiveCost(game, P1, 'source')).toBe(9);
    expect(bottomEvents(game)).toHaveLength(1);
    expect(bottomEvents(game)[0]).toMatchObject({
      movedCardIds: ['member-2', 'member-1'],
      cause: { sourceCardId: 'source', abilityId: UMI },
    });
    expect(game.activeEffect).toBeNull();
    const ownFinish = game.actionHistory.findIndex(
      (action) =>
        action.payload.abilityId === UMI && action.payload.step === 'BOTTOM_TWO_MEMBERS_GAIN_COST'
    );
    expect(ownFinish).toBeGreaterThan(
      game.actionHistory.findIndex(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === KAHO
      )
    );
    expect(ownFinish).toBeLessThan(
      game.actionHistory.findIndex(
        (action) =>
          action.payload.abilityId === KAHO &&
          action.payload.step === 'WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE'
      )
    );
    expect(game.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(game, P1, 'watcher')).toBe(4);
  });

  it('rejects insufficient/invalid/duplicate/stale payments without partial moves or use, and allows cancelling before payment', () => {
    const insufficient = setup(UMI, { waiting: ['member-1', 'blade-heart-member'] });
    expect(activate(insufficient, UMI)).toBe(insufficient);
    const started = activate(setup(UMI), UMI);
    for (const ids of [['member-1'], ['member-1', 'member-1'], ['member-1', 'muse-live']])
      expect(select(started, ids)).toBe(started);
    let stale = select(started, ['member-1', 'member-2']);
    stale = updatePlayer(stale, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'member-2'),
      },
    }));
    stale = advance(stale);
    expect(stale.activeEffect).toBeNull();
    expect(stale.players[0].mainDeck.cardIds).toEqual(['deck-tail']);
    expect(stale.players[0].waitingRoom.cardIds).toContain('member-1');
    expect(payActions(stale, UMI)).toHaveLength(0);
    expect(uses(stale, UMI)).toHaveLength(0);
    const cancelled = confirmActiveEffectStep(started, P1, started.activeEffect!.id, null);
    expect(cancelled.activeEffect).toBeNull();
    expect(uses(cancelled, UMI)).toHaveLength(0);
  });

  it('binds the turn limit and self reward to the original source lifecycle, while keeping independent payment legal', () => {
    const started = activate(setup(UMI), UMI);
    const oldLifecycle = started.activeEffect!.sourceLifecycleId;
    const paymentWindow = select(started, ['member-1', 'member-2']);
    const reentered = reenter(paymentWindow);
    expect(getAbilitySourceLifecycleId(reentered, UMI, 'source')).not.toBe(oldLifecycle);
    const paid = advance(reentered);
    expect(paid.players[0].mainDeck.cardIds).toEqual(['deck-tail', 'member-1', 'member-2']);
    expect(payActions(paid, UMI)).toHaveLength(1);
    expect(uses(paid, UMI)).toHaveLength(1);
    expect(uses(paid, UMI)[0].payload.sourceLifecycleId).toBe(oldLifecycle);
    expect(getMemberEffectiveCost(paid, P1, 'source')).toBe(7);
    const withTargets = updatePlayer(paid, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: ['member-1', 'member-2'] },
      mainDeck: { ...player.mainDeck, cardIds: ['deck-tail'] },
    }));
    expect(activate(withTargets, UMI).activeEffect?.abilityId).toBe(UMI);
  });

  it('keeps +2 through orientation changes, rejects a second use, clears it on leave/reentry and at LIVE end', () => {
    const paid = advance(select(activate(setup(UMI), UMI), ['member-1', 'member-2']));
    const waited = setMemberOrientation(paid, P1, 'source', OrientationState.WAITING)!.gameState;
    expect(getMemberEffectiveCost(waited, P1, 'source')).toBe(9);
    const restoredTargets = updatePlayer(waited, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: ['member-1', 'member-2'] },
      mainDeck: { ...player.mainDeck, cardIds: ['deck-tail'] },
    }));
    expect(activate(restoredTargets, UMI)).toBe(restoredTargets);
    const reentered = reenter(paid);
    expect(getMemberEffectiveCost(reentered, P1, 'source')).toBe(7);
    const end = new GameService().finalizeLiveResult({
      ...paid,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(end.success, end.error).toBe(true);
    expect(getMemberEffectiveCost(end.gameState, P1, 'source')).toBe(7);
  });

  it.each([
    { energies: 6, sufficient: true },
    { energies: 5, sufficient: false },
  ])(
    'uses effective cost 9 for a real RULES relay of cost 15 with $energies energy',
    ({ energies, sufficient }) => {
      const paid = advance(
        select(activate(setup(UMI, { energies }), UMI), ['member-1', 'member-2'])
      );
      const ready = updatePlayer(paid, P1, (player) => ({
        ...player,
        mainDeck: {
          ...player.mainDeck,
          cardIds: player.mainDeck.cardIds.filter((id) => id !== 'member-2'),
        },
        hand: { ...player.hand, cardIds: ['member-2'] },
      }));
      const session = sessionFor({
        ...ready,
        manualOperationMode: 'RULES',
        currentSubPhase: SubPhase.NONE,
        waitingForInput: false,
        waitingPlayerId: null,
      });
      expect(session.manualOperationMode).toBe('RULES');
      expect(getMemberEffectiveCost(session.state!, P1, 'source')).toBe(9);
      const before = session.state!;
      const played = session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'member-2', SlotPosition.CENTER, { relayMode: 'SINGLE' })
      );
      expect(played.success, played.error).toBe(sufficient);
      if (!sufficient) {
        expect(session.state!.players).toEqual(before.players);
        expect(session.state!.eventLog).toEqual(before.eventLog);
        expect(session.state!.actionHistory).toEqual(before.actionHistory);
        return;
      }
      const entrance = session.state!.entranceRuntime?.pending;
      if (entrance) {
        const ack = session.executeCommand({
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId: P1,
          entranceId: entrance.id,
          timestamp: Date.now(),
        });
        expect(ack.success, ack.error).toBe(true);
      }
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('member-2');
      expect(session.state!.players[0].waitingRoom.cardIds).toContain('source');
      expect(
        [...session.state!.players[0].energyZone.cardStates.values()].filter(
          ({ orientation }) => orientation === OrientationState.WAITING
        )
      ).toHaveLength(6);
      expect(events(session.state!, TriggerCondition.ON_ENTER_STAGE)).toContainEqual(
        expect.objectContaining({
          cardInstanceId: 'member-2',
          replacedMemberCardId: 'source',
          replacedMemberEffectiveCost: 9,
        })
      );
      expect(
        session.state!.liveResolution.liveModifiers.some((modifier) => modifier.abilityId === UMI)
      ).toBe(false);
    }
  );
});

describe('source timing and ownership', () => {
  it('rejects non-main, non-active-player and wrong-owner sources', () => {
    const game = setup(UMI);
    const wrongPhase = { ...game, currentPhase: GamePhase.PERFORMANCE_PHASE };
    expect(activate(wrongPhase, UMI)).toBe(wrongPhase);
    const wrongTurn = { ...game, activePlayerIndex: 1 };
    expect(activate(wrongTurn, UMI)).toBe(wrongTurn);
    expect(activateCardAbility(game, P2, 'source', UMI)).toBe(game);
    expect(activateCardAbility(game, P1, 'opponent-member', UMI)).toBe(game);
  });
});
