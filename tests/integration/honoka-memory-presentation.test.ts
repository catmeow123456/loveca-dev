import { describe, expect, it } from 'vitest';
import { prepareHonokaMemory } from '../helpers/honoka-memory-fixture';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { getHonokaMemoryPresentation } from '../../client/src/lib/honokaMemoryPresentation';
import {
  createEndPhaseCommand,
  createConfirmEffectStepCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  serializeReplayPayload,
  rehydrateAuthorityGameState,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { ENTRANCE_WAIT_LIMIT_MS } from '../../src/shared/card-entrance';
import { getCardEntranceProfile } from '../../client/src/lib/cardEntranceProfiles';
import { updatePlayer } from '../../src/domain/entities/game';

const rewards = (f: ReturnType<typeof prepareHonokaMemory>) =>
  f.session.state!.liveResolution.liveModifiers.filter(
    (m) => m.kind === 'SCORE' || m.kind === 'HEART'
  );

describe('22-cost Honoka public LIVE presentation', () => {
  it.each(['PL!-pb2-001-R', 'PL!-pb2-001-PP', 'PL!-pb2-001'])(
    'preserves entrance and synchronizes actual grants for %s',
    (print) => {
      const f = prepareHonokaMemory({ print });
      f.start();
      expect(getCardEntranceProfile(print)?.id).toBe('honoka');
      const wait = f.session.state!.entranceRuntime!.pending!;
      expect(wait.honokaMemory).toMatchObject({
        part: 'rewards',
        scoreGranted: true,
        heartGranted: true,
        recoveryReady: false,
      });
      expect(wait.deadlineAt).toBe(f.now() + ENTRANCE_WAIT_LIMIT_MS);
      expect(rewards(f)).toHaveLength(2);
      expect(f.session.state!.liveResolution.playerScores.get('p1')).toBe(1);
      const views = ['p1', 'p2'].map((p) => f.session.getPlayerViewState(p)!);
      expect(views[0].match.entrance).toEqual(views[1].match.entrance);
      expect(views.map((v) => getHonokaMemoryPresentation(v, (c) => c)?.side)).toEqual([
        'self',
        'opponent',
      ]);
      expect(f.session.executeCommand(createEndPhaseCommand('p1')).success).toBe(false);
      expect(f.session.undoLastStep().success).toBe(false);
      expect(f.ack('intruder').success).toBe(false);
      expect(f.ack().success).toBe(true);
      expect(f.ack().success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
      expect(f.ack('p2').success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(rewards(f)).toHaveLength(2);
      expect(f.ack('p1', wait.id).success).toBe(false);
    }
  );
  it.each(['recovery-member', 'recovery-live'])(
    'keeps selection public and only presents the successfully recovered %s',
    (selected) => {
      const f = prepareHonokaMemory({ draw: true });
      f.start();
      const rewardsId = f.session.state!.entranceRuntime!.pending!.id;
      expect(f.session.state!.activeEffect?.publicCardSelectionAutoAdvanceAt).toBeUndefined();
      expect(f.confirm(selected).success).toBe(false);
      f.ack();
      f.ack('p2');
      expect(f.confirm('secret').success).toBe(false);
      expect(f.confirm(selected).success).toBe(true);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(selected);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      confirmPublicSelectionIfNeeded(f.session);
      expect(f.session.state!.players[0].hand.cardIds.filter((id) => id === selected)).toHaveLength(
        1
      );
      const wait = f.session.state!.entranceRuntime!.pending!;
      expect(wait.id).not.toBe(rewardsId);
      expect(wait.honokaMemory).toMatchObject({
        part: 'recovery',
        scoreGranted: false,
        heartGranted: false,
        recovered: { cardId: selected },
      });
      expect(f.ack('p2', rewardsId).success).toBe(false);
      const opponent = f.session.getPlayerViewState('p2')!;
      expect(opponent.objects[`obj_${selected}`]?.frontInfo).toBeUndefined();
      expect(JSON.stringify(opponent)).not.toContain('PRIVATE-HAND-CODE');
      const cue = getHonokaMemoryPresentation(opponent, (c) => c)!.cue;
      expect(cue.recovered?.code).toBe(selected);
      expect(cue.recovered?.landscape).toBe(selected === 'recovery-live');
      expect(cue.memories).toEqual([]);
      f.ack();
      f.ack('p2');
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(rewards(f)).toHaveLength(2);
      expect(f.session.getPlayerViewState('p2')!.match.entrance).toBeUndefined();
    }
  );
  it.each([
    { score: true, heart: false, draw: false, expected: [true, false, false] },
    { score: false, heart: true, draw: false, expected: [false, true, false] },
    { score: false, heart: false, draw: true, expected: [false, false, true] },
    { score: true, heart: false, draw: true, emptyWaiting: true, expected: [true, false, false] },
  ])('presents independent actual branches %j', ({ expected, ...options }) => {
    const f = prepareHonokaMemory(options);
    f.start();
    const m = f.session.state!.entranceRuntime!.pending!.honokaMemory!;
    expect([m.scoreGranted, m.heartGranted, m.recoveryReady]).toEqual(expected);
  });
  it.each([
    { score: false, heart: false },
    { foreignSuccess: true },
    { score: false, heart: false, draw: true, emptyWaiting: true },
    { mode: 'OFF' as const },
  ])('has no presentation without a resolved visible result or enabled runtime: %j', (options) => {
    const f = prepareHonokaMemory(options);
    f.start();
    expect(f.session.state!.entranceRuntime?.pending ?? null).toBeNull();
    expect(f.session.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
  });
  it('resumes a serialized timeout once, retaining its public snapshot but not replaying completed windows', () => {
    const f = prepareHonokaMemory({ draw: true });
    f.start();
    f.ack();
    f.ack('p2');
    f.confirm('recovery-live');
    confirmPublicSelectionIfNeeded(f.session);
    const wait = f.session.state!.entranceRuntime!.pending!;
    const restored = createGameSession({ cardEntrance: 'REMOTE', now: f.now });
    const state = rehydrateAuthorityGameState(
      serializeReplayPayload(f.session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    restored.restoreRuntimeState({
      authorityState: state,
      currentPublicSeq: f.session.getCurrentPublicEventSeq(),
    });
    expect(
      restored.getPlayerViewState('p2')!.match.entrance?.honokaMemory?.recovered?.cardCode
    ).toBe('recovery-live');
    f.advance(ENTRANCE_WAIT_LIMIT_MS - 1);
    expect(restored.expireCardEntrance()).toBe(false);
    f.advance(1);
    expect(restored.expireCardEntrance()).toBe(true);
    expect(restored.expireCardEntrance()).toBe(false);
    expect(
      restored.state!.players[0].hand.cardIds.filter((id) => id === 'recovery-live')
    ).toHaveLength(1);
    expect(
      restored.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: 'p1',
        entranceId: wait.id,
        timestamp: f.now(),
      }).success
    ).toBe(false);
    restored.restoreRuntimeState({
      authorityState: restored.state!,
      currentPublicSeq: restored.getCurrentPublicEventSeq(),
    });
    expect(restored.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
  });
  it('preserves ordered resolution across two Honoka windows without a second confirmation', () => {
    const f = prepareHonokaMemory({ secondHonoka: true });
    f.start();
    const effect = f.session.state!.activeEffect!;
    expect(effect.selectableCardIds).toHaveLength(2);
    const result = f.session.executeCommand(
      createConfirmEffectStepCommand('p1', effect.id, undefined, undefined, true)
    );
    expect(result.success, result.error).toBe(true);
    const firstId = f.session.state!.entranceRuntime!.pending!.id;
    expect(rewards(f)).toHaveLength(2);
    f.ack();
    f.ack('p2');
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.entranceRuntime!.pending!.id).not.toBe(firstId);
    expect(rewards(f)).toHaveLength(4);
    expect(f.ack('p1', firstId).success).toBe(false);
    f.ack();
    f.ack('p2');
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.session.state!.entranceRuntime!.resumePendingEffects).toBeUndefined();
    expect(f.session.state!.liveResolution.playerScores.get('p1')).toBe(2);
  });
  it('LOCAL completion releases both seats and a missing target never borrows another member', () => {
    const f = prepareHonokaMemory({ mode: 'LOCAL' });
    f.start();
    const moved = updatePlayer(f.session.state!, 'p1', (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { ...p.memberSlots.slots, CENTER: null } },
    }));
    f.commit(moved);
    expect(
      getHonokaMemoryPresentation(f.session.getPlayerViewState('p1')!, (c) => c)
    ).toBeUndefined();
    f.ack();
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
  });
});
