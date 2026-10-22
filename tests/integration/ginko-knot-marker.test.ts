import { describe, expect, it } from 'vitest';
import { prepareGinkoScenario } from '../helpers/ginko-entrance-fixture';
import { projectPlayerViewState } from '../../src/online/projector';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { clearPreviousStageMemberInstanceState } from '../../src/application/effects/member-state';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import { SlotPosition, ZoneType } from '../../src/shared/types/enums';

function entered(options: Parameters<typeof prepareGinkoScenario>[0] = {}) {
  const f = prepareGinkoScenario({ mode: 'LOCAL', ...options });
  expect(f.play().success).toBe(true);
  expect(f.ack().success).toBe(true);
  return f;
}
const marker = (game: GameState, viewer = 'p1') =>
  projectPlayerViewState(game, viewer).objects.obj_ginko?.hasTemporaryOnEnterAbility;
const acquire = (f: ReturnType<typeof entered>) => {
  expect(f.activate().success).toBe(true);
  expect(f.discard().success).toBe(true);
};

describe('吟子公开授予能力角标', () => {
  it('is absent before acquisition, public to both seats after it, and survives invocation/restoration', () => {
    const f = entered();
    expect(marker(f.session.state!)).toBeUndefined();
    acquire(f);
    for (const viewer of ['p1', 'p2']) {
      const view = f.session.getPlayerViewState(viewer)!;
      expect(view.objects.obj_ginko?.hasTemporaryOnEnterAbility).toBe(true);
      expect(view.objects.obj_source?.hasTemporaryOnEnterAbility).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain('grantId');
      expect(JSON.stringify(view)).not.toContain('definitionSourceCardCode');
    }
    expect(f.ack().success).toBe(true);
    const choice = f.session.state!.activeEffect!;
    expect(
      f.session.executeCommand(
        createConfirmEffectStepCommand('p1', choice.id, choice.selectableCardIds![0]!)
      ).success
    ).toBe(true);
    expect(marker(f.session.state!)).toBe(true);
    const restored = createGameSession({ cardEntrance: 'LOCAL' });
    restored.restoreRuntimeState({ authorityState: f.session.state!, currentPublicSeq: 0 });
    expect(restored.getPlayerViewState('p2')!.objects.obj_ginko?.hasTemporaryOnEnterAbility).toBe(
      true
    );
    expect(restored.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
    const ended = new GameService().finalizeLiveResult(f.session.state!);
    expect(ended.success).toBe(true);
    expect(marker(ended.gameState)).toBeUndefined();
    expect(marker(ended.gameState, 'p2')).toBeUndefined();
  });
  it('does not survive departure, a new stage lifecycle, a hidden hand or game end', () => {
    const f = entered();
    acquire(f);
    const game = f.session.state!;
    expect(marker(clearPreviousStageMemberInstanceState(game, 'p1', 'ginko'))).toBeUndefined();
    const reentered = emitGameEvent(
      game,
      createEnterStageEvent('ginko', ZoneType.HAND, SlotPosition.CENTER, 'p1', 'p1')
    );
    expect(marker(reentered)).toBeUndefined();
    // Even a stale grant cannot disclose that a hidden hand card once held it.
    const returned = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      hand: { ...p.hand, cardIds: [...p.hand.cardIds, 'ginko'] },
    }));
    expect(marker(returned)).toBeUndefined();
    expect(marker(returned, 'p2')).toBeUndefined();
    expect(marker({ ...game, isEnded: true })).toBeUndefined();
  });
  it.each([
    { sourceCode: 'PL!HS-bp8-013-N' },
    { sourceIsLive: true },
    { sourceOverrides: { cost: 14 } },
  ])('has no marker for ineligible discard %j', (options) => {
    const f = entered(options);
    acquire(f);
    expect(marker(f.session.state!)).toBeUndefined();
    expect(marker(f.session.state!, 'p2')).toBeUndefined();
  });
  it('shows the acquired ability even if the immediate invocation has no legal target', () => {
    const f = entered({ sourceCode: 'PL!HS-bp2-007-P' });
    acquire(f);
    expect(f.ack().success).toBe(true);
    expect(marker(f.session.state!)).toBe(true);
  });
});
