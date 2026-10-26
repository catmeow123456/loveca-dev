import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP8_018_LIVE_START_REVEAL_HIGH_COST_NIJIGASAKI_HAND_BOTTOM_WAIT_OPPONENT_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { gameWith, hand, member, P1, P2, stage } from '../helpers/modifier-workflow-fixtures';
import { getOctober26CardData } from '../helpers/october-26-card-effects';

function setup(options: { noTarget?: boolean; noCost?: boolean } = {}) {
  const source = createCardInstance(getOctober26CardData('PL!N-bp8-018-N'), P1, 'kanata');
  const cost = member('cost', 'cost', P1, { cost: 11 });
  const target = member('target', 'target', P2, { cost: 11 });
  let game = stage(gameWith([source, cost, target]), [source]);
  if (!options.noCost) game = hand(game, [cost]);
  if (!options.noTarget) game = stage(game, [target], P2);
  const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
  game = resolvePendingCardEffects(queued).gameState;
  return { game, queued, source, cost, target };
}

function select(game: GameState, id: string | null): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, id);
}

function afterReveal(game = setup().game): GameState {
  const revealed = select(game, 'cost');
  expect(revealed.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
  return confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
}

describe('PL!N-bp8-018 费用7「近江彼方」', () => {
  it('uses real printed fields, reveals only the selected cost, then bottoms and waits the opponent with one state event', () => {
    const { game, source } = setup();
    expect(source.data).toMatchObject({ cost: 7, blade: 2, bladeHearts: undefined });
    const hidden = member('hidden', 'hidden', P1);
    const withHidden = hand(registerCards(game, [hidden]), [hidden]);
    const revealed = select(withHidden, 'cost');
    expect(revealed.players[0].hand.cardIds).toContain('cost');
    expect(revealed.players[0].mainDeck.cardIds).toEqual([]);
    expect(revealed.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      revealed.actionHistory.filter((a) => a.type === 'PAY_COST' && a.payload.abilityId === ABILITY)
    ).toHaveLength(1);
    for (const viewer of [P1, P2]) {
      expect(projectPlayerViewState(revealed, viewer).activeEffect?.revealedObjectIds).toEqual([
        createPublicObjectId('cost'),
      ]);
    }
    const targeting = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    expect(targeting.players[0].mainDeck.cardIds).toEqual(['cost']);
    expect(targeting.players[0].hand.cardIds).toEqual(['hidden']);
    const done = select(targeting, 'target');
    expect(done.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(1);
    expect(
      done.eventLog.some(({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)
    ).toBe(false);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });

  it('uses authoritative timed reveal commands, rejects early and repeated advancement, and does not wait before the display ends', () => {
    let now = 1_000;
    const session = createGameSession({ now: () => now });
    session.createGame('kanata-clock', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = setup().game;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'cost')
      ).success
    ).toBe(true);
    const effect = session.state!.activeEffect!;
    const command = createAutoAdvancePublicRevealCommand(
      P2,
      effect.id,
      effect.publicRevealAutoAdvanceAt!,
      effect.publicRevealGeneration!
    );
    expect(session.executeCommand(command).success).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toContain('cost');
    now = effect.publicRevealAutoAdvanceAt!;
    expect(session.executeCommand(command).success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toContain('cost');
    expect(session.state!.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.executeCommand(command).success).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, 'target')).success
    ).toBe(true);
  });

  it('allows paying and moving the revealed card when the opponent has no target', () => {
    const done = afterReveal(setup({ noTarget: true }).game);
    expect(done.players[0].mainDeck.cardIds).toEqual(['cost']);
    expect(done.actionHistory.some((a) => a.type === 'PAY_COST')).toBe(true);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });

  it('allows declining and consumes a pending with no payable hand card', () => {
    const declined = select(setup().game, null);
    expect(declined.players[0].hand.cardIds).toEqual(['cost']);
    expect(declined.actionHistory.some((a) => a.type === 'PAY_COST')).toBe(false);
    expect(declined.activeEffect).toBeNull();
    const noCost = setup({ noCost: true });
    expect(noCost.game.activeEffect?.stepText).toContain('没有可公开');
    expect(noCost.game.activeEffect?.selectableCardIds).toBeUndefined();
    const done = confirmActiveEffectStep(noCost.game, P1, noCost.game.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    const second = createCardInstance(getOctober26CardData('PL!N-bp8-018-N'), P1, 'second-kanata');
    const both = stage(registerCards(noCost.queued, [second]), [noCost.source, second]);
    const order = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(both, [TriggerCondition.ON_LIVE_START])
    ).gameState;
    const ordered = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
  });

  it.each([
    ['cost below eleven', { cost: 10 }],
    ['other group', { groupNames: ['Aqours'] }],
    ['DRAW BLADE HEART', { bladeHearts: [{ effect: BladeHeartEffect.DRAW }] }],
    ['SCORE BLADE HEART', { bladeHearts: [{ effect: BladeHeartEffect.SCORE }] }],
  ] as const)('rejects a hand cost that becomes %s before payment', (_label, changes) => {
    const { game, cost } = setup();
    const invalid = registerCards(game, [{ ...cost, data: { ...cost.data, ...changes } }]);
    expect(select(invalid, 'cost')).toBe(invalid);
    expect(invalid.actionHistory.some((a) => a.type === 'PAY_COST')).toBe(false);
  });

  it('resolves independent actions after the source and the revealed hand card leave', () => {
    const { game, source } = setup();
    const revealed = select(game, 'cost');
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      revealed,
      P1,
      source.instanceId,
      enqueueTriggeredCardEffects
    )!.gameState;
    const costGone = updatePlayer(left, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const targeting = confirmActiveEffectStep(costGone, P1, costGone.activeEffect!.id);
    expect(targeting.activeEffect?.selectableCardIds).toEqual(['target']);
    const done = select(targeting, 'target');
    expect(done.players[0].mainDeck.cardIds).toEqual([]);
    expect(done.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.actionHistory.filter((a) => a.type === 'PAY_COST')).toHaveLength(1);
  });

  it('uses the target effective cost, rejects a now-too-expensive target, and preserves paid costs', () => {
    let game = afterReveal();
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: P2,
      memberCardId: 'target',
      countDelta: 1,
      sourceCardId: 'modifier',
    });
    const done = select(game, 'target');
    expect(done.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.players[0].mainDeck.cardIds).toEqual(['cost']);
    expect(done.activeEffect).toBeNull();
  });

  it('can wait an originally cost-twelve member whose current effective cost is eleven', () => {
    const { game } = setup();
    const target = member('target', 'target', P2, { cost: 12 });
    const reduced = addLiveModifier(registerCards(game, [target]), {
      kind: 'MEMBER_COST',
      playerId: P2,
      memberCardId: 'target',
      countDelta: -1,
      sourceCardId: 'cost-reduction',
    });
    const done = select(afterReveal(reduced), 'target');
    expect(done.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('pays the reveal even when all opponent targets have waiting protection', () => {
    const { game } = setup();
    const target = member('target', 'target', P2, { cost: 11, groupNames: ['Aqours'], blade: 3 });
    const protectedGame = addMemberWaitProtectionUntilLiveEnd(registerCards(game, [target]), {
      affectedPlayerId: P2,
      sourceCardId: 'protection',
      abilityId: 'protection',
    });
    const done = afterReveal(protectedGame);
    expect(done.players[0].mainDeck.cardIds).toEqual(['cost']);
    expect(done.players[1].memberSlots.cardStates.get('target')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.activeEffect).toBeNull();
  });

  it('finishes if the target leaves after the selection opens without undoing the paid cost', () => {
    const targeting = afterReveal();
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      targeting,
      P2,
      'target',
      enqueueTriggeredCardEffects
    )!.gameState;
    const done = select(left, 'target');
    expect(done.players[0].mainDeck.cardIds).toEqual(['cost']);
    expect(done.activeEffect).toBeNull();
    expect(
      done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toEqual([]);
  });
});
