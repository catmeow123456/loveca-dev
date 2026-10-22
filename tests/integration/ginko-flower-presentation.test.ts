import { describe, expect, it, vi } from 'vitest';
import { prepareGinkoScenario } from '../helpers/ginko-entrance-fixture';
import {
  getAbilityTransferSource,
  getKahoRelaySource,
} from '../../client/src/lib/ginkoFlowerTransfer';
import {
  ENTRANCE_WAIT_LIMIT_MS,
  KAHO_RELAY_ENTRANCE_EXTRA_MS,
} from '../../src/shared/card-entrance';
import {
  GameCommandType,
  createEndPhaseCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { getCurrentTemporaryOnEnterAbilityGrants } from '../../src/application/card-effects/runtime/temporary-on-enter-ability-grants';
import * as lookup from '../../src/application/card-effects/definitions/lookup';
import { emitGameEvent, type GameState } from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { SlotPosition, ZoneType } from '../../src/shared/types/enums';

function entered(options: Parameters<typeof prepareGinkoScenario>[0] = {}) {
  const f = prepareGinkoScenario(options);
  expect(f.play().success).toBe(true);
  expect(f.ack().success).toBe(true);
  if (options.mode !== 'LOCAL') expect(f.ack('p2').success).toBe(true);
  return f;
}

describe('费用17「百生吟子」花光传承', () => {
  it.each(['kaho', 'other', 'none', 'cover'] as const)(
    '%s entry uses actual relay facts, then draws once',
    (relay) => {
      const f = prepareGinkoScenario({ relay, now: () => 1000 });
      expect(f.play().success).toBe(true);
      const wait = f.session.state!.entranceRuntime!.pending!;
      expect(wait.cardIds).toEqual(['ginko']);
      expect(!!wait.kahoRelays?.length).toBe(relay === 'kaho');
      expect(wait.deadlineAt).toBe(
        1000 + ENTRANCE_WAIT_LIMIT_MS + (relay === 'kaho' ? KAHO_RELAY_ENTRANCE_EXTRA_MS : 0)
      );
      expect(f.session.state!.players[0].hand.cardIds).toEqual(['source']);
      const first = f.session.getPlayerViewState('p1')!,
        second = f.session.getPlayerViewState('p2')!;
      expect(first.match.entrance).toEqual(second.match.entrance);
      expect(!!getKahoRelaySource(first, 'obj_ginko', (c) => c)).toBe(relay === 'kaho');
      if (relay === 'kaho') {
        expect(getKahoRelaySource(second, 'obj_ginko', (c) => c)?.side).toBe('opponent');
        expect(
          getKahoRelaySource(
            {
              ...first,
              objects: {
                ...first.objects,
                obj_relay: { ...first.objects.obj_relay!, surface: 'BACK', frontInfo: undefined },
              },
            },
            'obj_ginko',
            (c) => c
          )
        ).toBeUndefined();
      }
      expect(f.ack().success).toBe(true);
      expect(f.session.state!.players[0].hand.cardIds).toEqual(['source']);
      expect(f.ack('p2').success).toBe(true);
      expect(f.session.state!.players[0].hand.cardIds).toHaveLength(relay === 'kaho' ? 3 : 2);
      expect(f.ack('p2', wait.id).success).toBe(false);
    }
  );
  it('commits the discard and grant, waits for both seats, invokes exactly once without paying the child cost', () => {
    const f = entered();
    expect(f.activate().success).toBe(true);
    expect(f.discard().success).toBe(true);
    const state = f.session.state!,
      wait = state.entranceRuntime!.pending!;
    expect(wait.abilityTransfer).toMatchObject({
      hostCardId: 'ginko',
      sourceCardId: 'source',
      afterDiscard: true,
    });
    expect(state.players[0].waitingRoom.cardIds).toContain('source');
    expect(getCurrentTemporaryOnEnterAbilityGrants(state, 'p1', 'ginko')).toHaveLength(1);
    expect(state.activeEffect).toBeNull();
    expect(state.inspectionZone.cardIds).toEqual([]);
    expect(f.session.executeCommand(createEndPhaseCommand('p1')).success).toBe(false);
    expect(f.session.undoLastStep().success).toBe(false);
    for (const playerId of ['p1', 'p2']) {
      const view = f.session.getPlayerViewState(playerId)!;
      expect(getAbilityTransferSource(view, (c) => c)?.sourceObjectId).toBe('obj_source');
      expect(JSON.stringify(view.match.entrance)).not.toContain('continuation');
      expect(JSON.stringify(view.match.entrance)).not.toContain('grantId');
      expect(JSON.stringify(view)).not.toContain('definitionSourceCardCode');
    }
    expect(f.ack('intruder').success).toBe(false);
    expect(f.ack().success).toBe(true);
    expect(f.session.state!.inspectionZone.cardIds).toEqual([]);
    expect(f.ack('p2').success).toBe(true);
    expect(f.session.state!.inspectionZone.cardIds).toHaveLength(3);
    expect(f.session.state!.activeEffect?.sourceCardId).toBe('ginko');
    expect(f.session.state!.activeEffect?.onEnterInvocation?.waiveActivationCosts).toBe(true);
    expect(f.session.state!.entranceRuntime!.continuation).toBeUndefined();
    expect(f.ack('p2', wait.id).success).toBe(false);
    expect(f.session.state!.players[0].hand.cardIds).toHaveLength(2);
  });
  it.each([
    { cost: 14 },
    {
      cardCode: 'SYNTHETIC-AQOURS',
      groupNames: ['Aqours'],
      unitName: undefined,
      name: '合成水团成员',
      nameCn: '合成水团成员',
      nameJp: '合成水团成员',
    },
  ])('ineligible discard %j has no special presentation', (sourceOverrides) => {
    const f = entered({ sourceOverrides });
    expect(f.activate().success).toBe(true);
    expect(f.discard().success).toBe(true);
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(getCurrentTemporaryOnEnterAbilityGrants(f.session.state!, 'p1', 'ginko')).toEqual([]);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toContain('source');
  });
  it('a member without an entrance ability does not animate', () => {
    const f = entered({ sourceCode: 'PL!HS-bp8-013-N' });
    f.activate();
    f.discard();
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
  });
  it('a LIVE discard has no transfer', () => {
    const f = entered({ sourceIsLive: true });
    f.activate();
    f.discard();
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.session.state!.players[0].waitingRoom.cardIds).toContain('source');
  });
  it('cost thirteen is included; timeout survives a serialized checkpoint and does not repeat', () => {
    let now = 1000;
    const f = entered({ sourceOverrides: { cost: 13 }, now: () => now });
    f.activate();
    f.discard();
    const wait = f.session.state!.entranceRuntime!.pending!;
    const authorityState = rehydrateAuthorityGameState(
      serializeReplayPayload(f.session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    const restored = createGameSession({ cardEntrance: 'REMOTE', now: () => now });
    restored.restoreRuntimeState({
      authorityState,
      currentPublicSeq: f.session.getCurrentPublicEventSeq(),
    });
    now = wait.deadlineAt;
    expect(restored.expireCardEntrance()).toBe(true);
    expect(restored.state!.inspectionZone.cardIds).toHaveLength(3);
    expect(restored.expireCardEntrance()).toBe(false);
    expect(
      restored.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: 'p1',
        entranceId: wait.id,
        timestamp: now,
      }).success
    ).toBe(false);
    restored.restoreRuntimeState({
      authorityState: restored.state!,
      currentPublicSeq: restored.getCurrentPublicEventSeq(),
    });
    expect(restored.getPlayerViewState('p1')!.match.entrance).toBeUndefined();
  });
  it('successful acquisition still animates when the copied effect has no valid target', () => {
    const f = entered({ sourceCode: 'PL!HS-bp2-007-P', mode: 'LOCAL' });
    f.activate();
    f.discard();
    expect(f.session.state!.entranceRuntime!.pending?.abilityTransfer).toBeDefined();
    expect(f.ack().success).toBe(true);
    expect(getCurrentTemporaryOnEnterAbilityGrants(f.session.state!, 'p1', 'ginko')).toHaveLength(
      1
    );
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
  });
  it('a multiple-entrance template waits for the selected ability before showing the transfer', () => {
    // Current export has no multi-entrance eligible member. Compose two real definitions
    // only in this fixture to exercise the existing explicit-choice branch.
    const original = lookup.getCardAbilityDefinitionsForCardCode;
    const first = original('PL!HS-PR-001-PR');
    const second = original('PL!HS-bp2-007-P').filter(
      (d) => d.triggerCondition === 'ON_ENTER_STAGE'
    );
    const spy = vi
      .spyOn(lookup, 'getCardAbilityDefinitionsForCardCode')
      .mockImplementation((code) =>
        code === 'PL!HS-PR-001-PR' ? [...first, ...second] : original(code)
      );
    try {
      const f = entered({ mode: 'LOCAL' });
      f.activate();
      f.discard();
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      const effect = f.session.state!.activeEffect!;
      expect(effect.selectableOptions).toHaveLength(2);
      const choose = (id: string) =>
        f.session.executeCommand(
          createConfirmEffectStepCommand('p1', effect.id, undefined, undefined, false, id)
        );
      expect(choose('INVALID').success).toBe(false);
      const selected = effect.selectableOptions![0]!.id;
      const result = choose(selected);
      expect(result.success, result.error).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending!.abilityTransfer).toMatchObject({
        abilityId: selected,
        afterDiscard: false,
      });
      expect(f.session.state!.inspectionZone.cardIds).toEqual([]);
      f.ack();
      expect(f.session.state!.inspectionZone.cardIds).toHaveLength(3);
      expect(getCurrentTemporaryOnEnterAbilityGrants(f.session.state!, 'p1', 'ginko')).toHaveLength(
        1
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('does not invoke a queued transfer on a different incarnation of the host', () => {
    const f = entered({ mode: 'LOCAL' });
    f.activate();
    f.discard();
    const state = emitGameEvent(
      f.session.state!,
      createEnterStageEvent('ginko', ZoneType.HAND, SlotPosition.CENTER, 'p1', 'p1')
    );
    // Simulates an authority lifecycle invalidation while a client holds an old presentation.
    (f.session as unknown as { authorityState: GameState }).authorityState = {
      ...state,
      entranceRuntime: { ...state.entranceRuntime!, seenSequence: state.eventSequence },
    };
    f.ack();
    expect(f.session.state!.inspectionZone.cardIds).toEqual([]);
    expect(f.session.state!.entranceRuntime!.continuation).toBeUndefined();
    expect(f.session.state!.players[0].waitingRoom.cardIds).toContain('source');
  });
});
