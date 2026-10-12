import { describe, expect, it } from 'vitest';
import { prepareRecoveryScenario } from '../helpers/recovery-animation-fixture';
import { createGameSession } from '../../src/application/game-session';
import { createBattleAnimationHistory } from '../../client/src/lib/battleAnimationHistory';
import {
  createBattleAnimationEventsFromViewDiff,
  type BattleAnimationAnchorMaps,
} from '../../client/src/lib/battleAnimationEvents';
import { isRecoveryCardMove } from '../../client/src/lib/battleAnimationSequencing';
const anchors: BattleAnimationAnchorMaps = {
  cards: new Map(),
  zones: new Map([
    ['seat-FIRST::waiting-room', { left: 700, top: 400, width: 45, height: 63 }],
    ['seat-FIRST::hand', { left: 300, top: 600, width: 500, height: 138 }],
  ]),
};
function setup(scenario: 'single' | 'multiple' | 'no-target' = 'single') {
  let now = 10_000;
  const f = prepareRecoveryScenario(scenario, createGameSession({ now: () => now }));
  const history = createBattleAnimationHistory();
  let previous = f.session.getPlayerViewState('p1')!;
  const sync = () => {
    const next = f.session.getPlayerViewState('p1')!;
    const reset = history.sync({
      matchId: next.match.matchId,
      viewerSeat: next.match.viewerSeat,
      seq: next.match.seq,
    });
    const events = reset
      ? []
      : history.accept(
          createBattleAnimationEventsFromViewDiff({
            previousViewState: previous,
            nextViewState: next,
            previousAnchors: anchors,
            nextAnchors: anchors,
          })
        );
    previous = next;
    return events.filter(isRecoveryCardMove);
  };
  sync();
  const step = (illegal = false) => {
    const deadline = f.session.state!.activeEffect?.publicCardSelectionAutoAdvanceAt;
    if (deadline) now = deadline;
    const result = f.session.executeCommand(f.nextCommand(illegal));
    return { result, events: sync() };
  };
  return { ...f, sync, step };
}

describe('real recovery commands feed the shared animation path', () => {
  it('recovers A, undoes, and recovers that exact A again with a fresh presentation', () => {
    const f = setup();
    const all = [];
    for (let i = 0; i < 6; i++) {
      const { result, events } = f.step();
      expect(result.success, result.error).toBe(true);
      all.push(...events);
      if (!f.session.state!.activeEffect) break;
    }
    expect(all).toHaveLength(1);
    expect(f.session.state!.players[0].hand.cardIds).toContain('recover-a');
    expect(f.session.undoLastStep().success).toBe(true);
    expect(f.sync()).toEqual([]);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toContain('recover-a');
    const replay = [];
    for (let i = 0; i < 4; i++) {
      const { result, events } = f.step();
      expect(result.success, result.error).toBe(true);
      replay.push(...events);
      if (!f.session.state!.activeEffect) break;
    }
    expect(replay).toHaveLength(1);
    expect(replay[0].id).not.toBe(all[0].id);
    expect(f.session.state!.players[0].hand.cardIds).toContain('recover-a');
  });
  it('a grouped real effect produces both recovered cards only after public display has finished', () => {
    const f = setup('multiple');
    const all = [];
    for (let i = 0; i < 6; i++) {
      const { result, events } = f.step();
      expect(result.success, result.error).toBe(true);
      all.push(...events);
      if (f.session.state!.activeEffect?.publicCardSelectionAutoAdvanceAt)
        expect(events).toEqual([]);
      if (!f.session.state!.activeEffect) break;
    }
    expect(all).toHaveLength(2);
    expect(f.session.state!.players[0].hand.cardIds).toEqual(
      expect.arrayContaining(['recover-a', 'recover-b'])
    );
  });
  it('invalid selection and no available targets do not produce successful recoveries', () => {
    const f = setup();
    expect(f.step().result.success).toBe(true);
    const rejected = f.step(true);
    expect(rejected.result.success).toBe(false);
    expect(rejected.events).toEqual([]);
    const noTarget = setup('no-target');
    const all = [];
    for (let i = 0; i < 6; i++) {
      const { result, events } = noTarget.step();
      expect(result.success, result.error).toBe(true);
      all.push(...events);
      if (!noTarget.session.state!.activeEffect) break;
    }
    expect(all).toEqual([]);
    expect(noTarget.session.state!.activeEffect).toBeNull();
  });
  it('opponent projection never carries the recovered hidden face or its hand identity', () => {
    const f = setup();
    for (let i = 0; i < 6; i++) {
      const previous = f.session.getPlayerViewState('p2')!;
      const { result } = f.step();
      expect(result.success, result.error).toBe(true);
      const next = f.session.getPlayerViewState('p2')!;
      const events = createBattleAnimationEventsFromViewDiff({
        previousViewState: previous,
        nextViewState: next,
        previousAnchors: anchors,
        nextAnchors: anchors,
      });
      const hiddenMoves = events.filter(isRecoveryCardMove);
      expect(
        hiddenMoves.every(
          (e) =>
            e.kind === 'CARD_MOVE' &&
            e.render.surface === 'BACK' &&
            !e.render.cardCode &&
            !e.render.imageSrc
        )
      ).toBe(true);
      if (!f.session.state!.activeEffect) {
        expect(next.table.zones.FIRST_HAND?.objectIds ?? []).not.toContain('obj_recover-a');
        expect(next.objects['obj_recover-a']?.frontInfo).toBeUndefined();
        break;
      }
    }
  });
});
