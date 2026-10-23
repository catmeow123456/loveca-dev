import { describe, expect, it } from 'vitest';
import { prepareShizukuRole } from '../helpers/shizuku-role-fixture';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { clearPreviousStageMemberInstanceState } from '../../src/application/effects/member-state';
import { projectPlayerViewState } from '../../src/online/projector';
import { updatePlayer } from '../../src/domain/entities/game';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import { SlotPosition } from '../../src/shared/types/enums';

const acquire = (f: ReturnType<typeof prepareShizukuRole>) => {
  expect(f.activate().success).toBe(true);
  expect(f.session.state!.entranceRuntime?.pending).toBeFalsy();
  expect(f.reveal().success).toBe(true);
  expect(f.select().success).toBe(true);
};

describe('15费雫 SEC 的公开角色交接', () => {
  it('defers mill-triggered effects until both seats complete the role presentation', () => {
    const f = prepareShizukuRole({ queuedMia: true });
    acquire(f);
    expect(f.session.state!.pendingAbilities.some((a) => a.sourceCardId === 'mia')).toBe(true);
    expect(f.session.state!.activeEffect).toBeNull();
    const id = f.session.state!.entranceRuntime!.pending!.id;
    f.ack();
    expect(f.session.state!.activeEffect).toBeNull();
    f.ack('p2');
    expect(f.session.state!.activeEffect?.sourceCardId).toBe('mia');
    expect(f.ack('p1', id).success).toBe(false);
    expect(f.session.state!.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      'role',
    ]);
  });
  it('commits the whole stack/replacement before waiting, projects both seats, and resumes once', () => {
    const f = prepareShizukuRole();
    acquire(f);
    const state = f.session.state!,
      wait = state.entranceRuntime!.pending!;
    expect(wait.shizukuRole?.sourceCardId).toBe('role');
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual(['role']);
    expect(state.players[0].mainDeck.cardIds).toHaveLength(7);
    for (const viewer of ['p1', 'p2']) {
      const view = f.session.getPlayerViewState(viewer)!;
      expect(view.match.entrance?.shizukuRole).toMatchObject({
        hostObjectId: 'obj_shizuku',
        sourceObjectId: 'obj_role',
        hearts: wait.shizukuRole!.hearts,
      });
      expect(view.objects.obj_shizuku.hasTemporaryHeartRole).toBe(true);
      expect(view.objects.obj_role.surface).toBe('FRONT');
      expect(view.objects.obj_role.hasTemporaryHeartRole).toBeUndefined();
    }
    expect(JSON.stringify(f.session.getPlayerViewState('p1'))).not.toContain(
      'PRIVATE-OPPONENT-HAND'
    );
    expect(f.ack().success).toBe(true);
    expect(f.session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
    expect(f.ack('p2').success).toBe(true);
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.session.state!.entranceRuntime!.resumePendingEffects).toBeUndefined();
    expect(f.ack('p1', wait.id).success).toBe(false);
    expect(
      f.session.state!.liveResolution.liveModifiers.filter(
        (m) => m.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT'
      )
    ).toHaveLength(1);
  });
  it.each(['PL!N-bp7-003-P', 'PL!N-bp7-003-P+', 'PL!N-bp7-003-R+'])(
    'retains full rules without the SEC presentation for %s',
    (print) => {
      const f = prepareShizukuRole({ print });
      acquire(f);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.session.state!.liveResolution.liveModifiers).toHaveLength(1);
      expect(
        f.session.getPlayerViewState('p1')!.objects.obj_shizuku.hasTemporaryHeartRole
      ).toBeUndefined();
    }
  );
  it('works without an animation runtime and presents a successful zero-HEART role', () => {
    const off = prepareShizukuRole({ mode: 'OFF' });
    acquire(off);
    expect(off.session.state!.entranceRuntime).toBeUndefined();
    expect(off.session.state!.liveResolution.liveModifiers).toHaveLength(1);
    const zero = prepareShizukuRole({ emptyHearts: true });
    acquire(zero);
    expect(zero.session.state!.entranceRuntime!.pending!.shizukuRole!.hearts).toEqual([]);
    expect(zero.session.getPlayerViewState('p1')!.objects.obj_shizuku.hasTemporaryHeartRole).toBe(
      true
    );
  });
  it('timeout releases the shared barrier and restoration keeps the marker without replay', () => {
    const f = prepareShizukuRole();
    acquire(f);
    const restored = createGameSession({ cardEntrance: 'REMOTE' });
    restored.restoreRuntimeState({ authorityState: f.session.state!, currentPublicSeq: 0 });
    expect(restored.getPlayerViewState('p2')!.match.entrance?.id).toBe(
      f.session.state!.entranceRuntime!.pending!.id
    );
    expect(restored.getPlayerViewState('p2')!.objects.obj_shizuku.hasTemporaryHeartRole).toBe(true);
    f.advance(6001);
    expect(f.session.expireCardEntrance()).toBe(true);
    expect(f.session.expireCardEntrance()).toBe(false);
    expect(f.session.state!.entranceRuntime!.resumePendingEffects).toBeUndefined();
    restored.restoreRuntimeState({ authorityState: f.session.state!, currentPublicSeq: 0 });
    expect(restored.getPlayerViewState('p2')!.match.entrance).toBeUndefined();
  });
  it('does not present for no target or a stale source, retaining the paid mill cost', () => {
    const none = prepareShizukuRole({ noTarget: true });
    expect(none.activate().success).toBe(true);
    expect(none.reveal().success).toBe(true);
    expect(none.session.state!.entranceRuntime!.pending).toBeNull();
    const stale = prepareShizukuRole();
    stale.activate();
    stale.reveal();
    stale.commit(
      updatePlayer(stale.session.state!, 'p1', (p) => ({
        ...p,
        memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      }))
    );
    stale.select();
    expect(stale.session.state!.entranceRuntime!.pending).toBeNull();
    expect(stale.session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(stale.session.state!.players[0].mainDeck.cardIds).toHaveLength(7);
  });
  it('derives marker expiry from LIVE end, departure, hidden zones and game end', () => {
    const f = prepareShizukuRole({ mode: 'LOCAL' });
    acquire(f);
    f.ack();
    const game = f.session.state!;
    const ended = new GameService().finalizeLiveResult(game);
    expect(ended.success).toBe(true);
    const departed = clearPreviousStageMemberInstanceState(game, 'p1', 'shizuku');
    const hidden = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      hand: { ...p.hand, cardIds: ['shizuku'] },
    }));
    for (const state of [ended.gameState, departed, hidden, { ...game, isEnded: true }])
      for (const viewer of ['p1', 'p2'])
        expect(
          projectPlayerViewState(state, viewer).objects.obj_shizuku?.hasTemporaryHeartRole
        ).toBeUndefined();
  });
});
