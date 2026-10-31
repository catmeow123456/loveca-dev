import { describe, expect, it } from 'vitest';
import { prepareSixEntranceScenario, sixEntranceCards } from '../helpers/six-entrance-fixture';
import { getCardEntranceProfile } from '../../client/src/lib/cardEntranceProfiles';
import { collectEntranceAssetIds, isEntranceCard } from '../../src/shared/card-entrance';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { S_BP6_008_ACTIVATED_PLAY_AQOURS_MEMBER_TO_SOURCE_SLOT_ABILITY_ID as MARI } from '../../src/application/card-effects/ability-ids';
import { OrientationState, SlotPosition } from '../../src/shared/types/enums';
import type { GameSession } from '../../src/application/game-session';

function ack(session: GameSession, playerId: string, entranceId: string) {
  return session.executeCommand({
    type: GameCommandType.ACK_CARD_ENTRANCE,
    playerId,
    entranceId,
    timestamp: 1000,
  });
}
function finish(session: GameSession) {
  const id = session.state!.entranceRuntime!.pending!.id;
  for (const player of [...session.state!.entranceRuntime!.pending!.waitingPlayerIds])
    expect(ack(session, player, id).success).toBe(true);
  return id;
}
function spent(session: GameSession, owner: string) {
  const p = session.state!.players.find((p) => p.id === owner)!;
  return p.energyZone.cardIds.filter(
    (id) => p.energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
  ).length;
}

describe('2026-10-28 six entrances use the shared authority and assets', () => {
  for (const row of sixEntranceCards) {
    it.each(['p1', 'p2'] as const)(
      `${row.cardCode}: paid entry from %s, both projections and one continuation`,
      (owner) => {
        const { session, opponent } = prepareSixEntranceScenario({ code: row.cardCode, owner });
        const before = session.state!.players.find((p) => p.id === owner)!.mainDeck.cardIds.length;
        const result = session.executeCommand(
          createPlayMemberToSlotCommand(owner, 'source', SlotPosition.CENTER)
        );
        expect(result.success, result.error).toBe(true);
        const pending = session.state!.entranceRuntime!.pending!;
        expect(pending.cardIds).toEqual(['source']);
        expect(spent(session, owner)).toBe(row.cost);
        const views = [owner, opponent].map((p) => session.getPlayerViewState(p)!);
        expect(views[0]!.match.entrance).toEqual(views[1]!.match.entrance);
        for (const view of views) {
          expect(view.objects.obj_source?.frontInfo?.cardCode).toBe(row.cardCode);
          expect(view.match.entranceAssetIds).toContain(getCardEntranceProfile(row.cardCode)!.id);
        }
        expect(session.state!.activeEffect).toBeNull();
        expect(session.state!.players.find((p) => p.id === owner)!.mainDeck.cardIds).toHaveLength(
          before
        );
        expect(ack(session, owner, pending.id).success).toBe(true);
        expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual([opponent]);
        expect(session.state!.activeEffect).toBeNull();
        expect(ack(session, opponent, pending.id).success).toBe(true);
        expect(session.state!.entranceRuntime!.pending).toBeNull();
        const after = session.state;
        expect(ack(session, opponent, pending.id).success).toBe(false);
        expect(session.state).toBe(after);
        session.restoreRuntimeState({
          authorityState: session.state!,
          currentPublicSeq: session.getCurrentPublicEventSeq(),
        });
        expect(session.getPlayerViewState(owner)!.match.entrance).toBeUndefined();
      }
    );
    it(`${row.cardCode}: failed payment has no event; legal single relay pays the reduced cost`, () => {
      const failed = prepareSixEntranceScenario({ code: row.cardCode, energyCount: row.cost - 1 });
      expect(
        failed.session.executeCommand(
          createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER)
        ).success
      ).toBe(false);
      expect(failed.session.state!.entranceRuntime!.pending).toBeNull();
      const { session } = prepareSixEntranceScenario({ code: row.cardCode, relay: true });
      const result = session.executeCommand(
        createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER, {
          relayMode: 'SINGLE',
          relayReplacementSlots: [SlotPosition.CENTER],
        })
      );
      expect(result.success, result.error).toBe(true);
      expect(spent(session, 'p1')).toBe(row.cost - 5);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain('relay');
      expect(session.state!.entranceRuntime!.pending!.cardIds).toEqual(['source']);
      finish(session);
      expect(session.state!.players[0].memberSlots.cardStates.get('source')?.orientation).toBe(
        OrientationState.ACTIVE
      );
    });
  }

  it('covers future prints, separates both Maki bases and preloads each new identity once', () => {
    const bases = [
      ...new Set(sixEntranceCards.map((c) => c.cardCode.slice(0, c.cardCode.lastIndexOf('-')))),
    ];
    for (const base of bases) {
      expect(isEntranceCard(`${base}-SEC`)).toBe(true);
      expect(isEntranceCard(`${base}-PP`)).toBe(true);
      expect(getCardEntranceProfile(`${base}-FUTURE`)?.baseCode).toBe(base);
      expect(isEntranceCard(`${base}-P-EXTRA`)).toBe(false);
    }
    expect(getCardEntranceProfile('PL!-bp6-006-SEC')?.id).toBe('maki');
    expect(getCardEntranceProfile('PL!-bp8-006-P')?.id).toBe('maki-bp8');
    expect(collectEntranceAssetIds(sixEntranceCards.map((c) => c.cardCode))).toHaveLength(6);
  });

  it.each(['ACK', 'timeout'] as const)(
    'Yoshiko draws exactly two after %s and no bonus from hand',
    (mode) => {
      let now = 1000;
      const { session } = prepareSixEntranceScenario({ now: () => now });
      session.executeCommand(createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER));
      const pending = session.state!.entranceRuntime!.pending!;
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      if (mode === 'ACK') finish(session);
      else {
        now = pending.deadlineAt;
        expect(session.expireCardEntrance()).toBe(true);
      }
      expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
      expect(
        session.state!.liveResolution.liveModifiers.filter((m) => m.sourceCardId === 'source')
      ).toHaveLength(0);
      expect(ack(session, 'p1', pending.id).success).toBe(false);
      expect(session.expireCardEntrance()).toBe(false);
      expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
    }
  );

  it('Mari replacement enters Yoshiko in the real source slot, then draws two and grants blade once', () => {
    const { session } = prepareSixEntranceScenario({ mariReplacement: true });
    const start = session.executeCommand(createActivateAbilityCommand('p1', 'mari-source', MARI));
    expect(start.success, start.error).toBe(true);
    expect(spent(session, 'p1')).toBe(2);
    const choose = session.executeCommand(
      createConfirmEffectStepCommand('p1', session.state!.activeEffect!.id, 'source')
    );
    expect(choose.success, choose.error).toBe(true);
    expect(session.state!.players[0].memberSlots.slots.CENTER).toBe('source');
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('mari-source');
    // This replacement and its immediate trigger finish in one atomic workflow
    // step before capture. The barrier must not replay the already-paid draw.
    expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
    const id = finish(session);
    expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
    expect(
      session.state!.liveResolution.liveModifiers.filter((m) => m.sourceCardId === 'source')
    ).toEqual([expect.objectContaining({ kind: 'BLADE', countDelta: 3 })]);
    expect(ack(session, 'p2', id).success).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
  });

  it('trio inspection remains private and selects two only after the barrier', () => {
    const { session } = prepareSixEntranceScenario({ code: 'LL-bp6-001-R+' });
    session.executeCommand(createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER));
    expect(session.state!.activeEffect).toBeNull();
    finish(session);
    const effect = session.state!.activeEffect!;
    expect(effect.inspectionCardIds).toHaveLength(6);
    const other = session.getPlayerViewState('p2')!;
    for (const id of effect.inspectionCardIds!) {
      expect(other.objects[`obj_${id}`]?.surface).toBe('BACK');
      expect(other.objects[`obj_${id}`]?.frontInfo).toBeUndefined();
    }
    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        'p1',
        effect.id,
        undefined,
        undefined,
        undefined,
        undefined,
        effect.inspectionCardIds!.slice(0, 2)
      )
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toHaveLength(2);
    expect(session.state!.players[0].waitingRoom.cardIds).toHaveLength(4);
  });

  it('Kosuzu exposes the legal target only after the barrier and waits it once', () => {
    const { session } = prepareSixEntranceScenario({ code: 'PL!HS-bp6-013-R' });
    session.executeCommand(createPlayMemberToSlotCommand('p1', 'source', SlotPosition.CENTER));
    expect(
      session.state!.players[1].memberSlots.cardStates.get('opponent-target')?.orientation
    ).toBe(OrientationState.ACTIVE);
    finish(session);
    const effect = session.state!.activeEffect!;
    expect(effect.selectableCardIds).toEqual(['opponent-target']);
    const result = session.executeCommand(
      createConfirmEffectStepCommand('p1', effect.id, 'opponent-target')
    );
    expect(result.success, result.error).toBe(true);
    expect(
      session.state!.players[1].memberSlots.cardStates.get('opponent-target')?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.executeCommand(createConfirmEffectStepCommand('p1', effect.id, 'opponent-target'))
        .success
    ).toBe(false);
  });
});
