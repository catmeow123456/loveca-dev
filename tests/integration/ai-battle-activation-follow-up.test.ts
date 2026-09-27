import { describe, expect, it } from 'vitest';
import { GameCommandType } from '../../src/application/game-commands';
import { createPublicObjectId } from '../../src/online/projector';
import { CardType, SlotPosition } from '../../src/shared/types/enums';
import { buildAiBattleDecision } from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { readFrozenLikeATreasureDeck } from '../helpers/ai-curated-decks';
import {
  P1,
  P2,
  decision,
  member,
  replaceHand,
  setup,
  stage,
  submit,
} from '../helpers/ai-battle-fixture';

function fixture(code = 'PL!N-sd1-011-SD') {
  const f = setup();
  const live = readFrozenLikeATreasureDeck().deck.mainDeck.find(
    (card) => card.cardType === CardType.LIVE
  )!;
  // Two physical copies keep distinct current-window references.
  const targets = replaceHand(f.session, [live, live]);
  Object.assign(f.session.state!.players[0].waitingRoom, { cardIds: targets });
  Object.assign(f.session.state!.players[0].hand, { cardIds: [] });
  const source = stage(f.session, member(code, 2), SlotPosition.LEFT);
  return { ...f, targets, source };
}

function choose(f: ReturnType<typeof fixture>) {
  const current = decision(f.session);
  const candidate = current.input.space.candidates.find(
    (c) => c.followUpTargetObjectId === createPublicObjectId(f.targets[1]!)
  )!;
  expect(candidate).toBeDefined();
  const plan = current.activationFollowUps!.get(candidate.ref)!;
  submit(f.session, current, { kind: 'ACTION', actionRef: candidate.ref });
  return (view = f.session.getPlayerViewState(P1)!) => plan.resolve(f.session.state!, view, 1000);
}

describe('AI activation with an already-known target', () => {
  it.each(['PL!N-sd1-011-SD', 'PL!-sd1-005-SD'])(
    'reuses the shared single recovery shape for %s, retaining authoritative display and costs',
    (code) => {
      const f = fixture(code);
      const before = structuredClone(f.session.state);
      const random = f.randomCalls();
      const current = decision(f.session);
      expect(f.session.state).toEqual(before);
      expect(f.randomCalls()).toBe(random);
      const combined = current.input.space.candidates.filter((c) => c.followUpTargetObjectId);
      expect(combined.map((c) => c.followUpTargetObjectId)).toEqual(
        f.targets.map(createPublicObjectId)
      );
      expect(
        current.input.space.candidates.some((c) => c.activation && !c.followUpTargetObjectId)
      ).toBe(true);
      expect(JSON.stringify(current.input)).not.toContain('immediateSelection');
      const resolve = choose(f);
      expect(f.session.state!.players[0].memberSlots.slots.LEFT).toBeNull();
      expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(f.source);
      const actual = decision(f.session);
      expect(actual.input.space).toMatchObject({ kind: 'CARDS', canSkip: false });
      expect(getAiMechanicalSelection(actual)).toBeNull();
      const result = resolve();
      expect(result.kind).toBe('READY');
      if (result.kind !== 'READY') throw Error(result.reason);
      expect(result.command).toMatchObject({
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        selectedCardId: f.targets[1],
      });
      expect(f.session.executeCommand(result.command).success).toBe(true);
      expect(resolve().kind).toBe('REQUERY');
      expect(f.session.state!.players[0].hand.cardIds).not.toContain(f.targets[1]);
      expect(
        buildAiBattleDecision(f.session.state!, P1, f.session.getPlayerViewState(P1)!)
      ).toMatchObject({ kind: 'WAITING_FOR_TIME' });
      f.advanceTime(10_000);
      const display = decision(f.session);
      submit(f.session, display, getAiMechanicalSelection(display)!);
      expect(f.session.state!.players[0].hand.cardIds).toContain(f.targets[1]);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(f.targets[0]);
    }
  );

  it('retains the ordinary activation without an attached target choice', () => {
    const f = fixture('PL!-sd1-002-SD');
    const current = decision(f.session);
    const ordinary = current.input.space.candidates.find(
      (c) => c.activation && !c.followUpTargetObjectId
    )!;
    expect(current.activationFollowUps?.get(ordinary.ref)).toBeUndefined();
    submit(f.session, current, { kind: 'ACTION', actionRef: ordinary.ref });
    const next = decision(f.session);
    expect(next.input.space.candidates).toHaveLength(1);
    // This particular recovery is mandatory; other optional one-card windows are tested separately.
    expect(getAiMechanicalSelection(next)).toEqual({
      kind: 'CARDS',
      cardRefs: [next.input.space.candidates[0]!.ref],
    });
    expect(f.session.state!.activeEffect?.selectableCardIds).toEqual([f.source]);
  });

  it.each(['target', 'constraint', 'step', 'trigger', 'draw', 'seat', 'display'] as const)(
    'discards the preselection after a %s change without executing another command',
    (change) => {
      const f = fixture();
      const resolve = choose(f);
      const game = f.session.state!;
      if (change === 'target')
        Object.assign(game.activeEffect!, { selectableCardIds: [f.targets[0]] });
      if (change === 'constraint') Object.assign(game.activeEffect!, { canSkipSelection: true });
      if (change === 'step') Object.assign(game.activeEffect!, { stepId: 'different-step' });
      if (change === 'trigger') Object.assign(game, { pendingAbilities: [{ id: 'new-trigger' }] });
      if (change === 'draw') {
        const player = game.players[0];
        Object.assign(player.hand, { cardIds: [player.mainDeck.cardIds[0]] });
        Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
      }
      const before = structuredClone(game);
      const seq = f.session.getRuntimeStats().currentCommandSeq;
      const own = f.session.getPlayerViewState(P1)!;
      if (change === 'seat') {
        // The actual plan cannot be applied to the other seat's projection.
        Object.assign(own.match, { viewerSeat: 'SECOND' });
      }
      if (change === 'display')
        Object.assign(own.activeEffect!, { publicCardSelectionAutoAdvanceAt: 5000 });
      expect(resolve(own).kind).toBe('REQUERY');
      expect(f.session.state).toEqual(before);
      expect(f.session.getRuntimeStats().currentCommandSeq).toBe(seq);
    }
  );

  it('does not preselect unknown targets or inspect/draw activations', () => {
    const f = fixture();
    const view = f.session.getPlayerViewState(P1)!;
    const target = createPublicObjectId(f.targets[0]!);
    Object.assign(view.objects[target]!, { surface: 'BACK', frontInfo: undefined });
    const query = buildAiBattleDecision(f.session.state!, P1, view);
    expect(query.kind).toBe('DECISION');
    if (query.kind !== 'DECISION') throw Error('Expected decision');
    expect(query.decision.activationFollowUps).toBeUndefined();
    const inspect = setup();
    stage(inspect.session, member('PL!N-bp7-006-R', 17), SlotPosition.LEFT);
    expect(decision(inspect.session).activationFollowUps).toBeUndefined();
    expect(buildAiBattleDecision(f.session.state!, P2).kind).toBe('WAITING_FOR_PLAYER');
  });
});
