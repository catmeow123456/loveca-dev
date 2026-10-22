import { describe, expect, it } from 'vitest';
import { prepareHonokaMemory } from '../helpers/honoka-memory-fixture';
import { live, member } from '../helpers/card-effect-zone-fixture';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { FaceState, SlotPosition } from '../../src/shared/types/enums';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';

describe('Rina and Honoka sharing the LIVE presentation barrier', () => {
  it.each(['rina', 'honoka'])(
    'resolves %s first, then the other card exactly once after both clients finish',
    (first) => {
      const f = prepareHonokaMemory({ draw: true });
      const session = f.session;
      const nijigasaki = { groupNames: ['虹ヶ咲'] };
      let state = registerCards(session.state!, [
        member('rina', { ...nijigasaki, cardCode: 'PL!N-bp8-009-SEC', cost: 15 }),
        live('live', { ...nijigasaki, score: 2 }),
        live('bottom', nijigasaki),
      ]);
      state = updatePlayer(state, 'p1', (p) => ({
        ...p,
        mainDeck: { ...p.mainDeck, cardIds: [...p.mainDeck.cardIds, 'bottom'] },
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'rina', {
          face: FaceState.FACE_UP,
        }),
      }));
      f.commit(state);
      f.start();
      expect(session.state!.activeEffect?.selectableCardIds).toEqual(
        expect.arrayContaining(['rina', 'honoka'])
      );
      expect(f.confirm(first).success).toBe(true);
      const waits: string[] = [];
      const finishPresentation = (kind: 'RETURN' | 'PLACE' | 'rewards' | 'recovery') => {
        const wait = session.state!.entranceRuntime!.pending!;
        expect(wait.rinaLiveSwap?.phase ?? wait.honokaMemory?.part).toBe(kind);
        expect(waits).not.toContain(wait.id);
        waits.push(wait.id);
        expect(f.ack().success).toBe(true);
        expect(session.state!.entranceRuntime!.pending!.id).toBe(wait.id);
        expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual(['p2']);
        expect(f.ack('p2').success).toBe(true);
        expect(f.ack('p1', wait.id).success).toBe(false);
      };
      const advanceSelection = () => {
        const effect = session.state!.activeEffect!;
        f.advance(effect.publicCardSelectionAutoAdvanceAt! - f.now());
        expect(
          session.executeCommand(
            createAutoAdvancePublicCardSelectionCommand('p2', effect.id, f.now())
          ).success
        ).toBe(true);
      };
      const rina = () => {
        expect(
          session.executeCommand(
            createConfirmEffectStepCommand(
              'p1',
              session.state!.activeEffect!.id,
              undefined,
              undefined,
              undefined,
              'PLACE_BOTTOM_CARD_IN_WAITING_ROOM'
            )
          ).success
        ).toBe(true);
        const reveal = session.state!.activeEffect!;
        f.advance(reveal.publicRevealAutoAdvanceAt! - f.now());
        expect(
          session.executeCommand(
            createAutoAdvancePublicRevealCommand(
              'p2',
              reveal.id,
              f.now(),
              reveal.publicRevealGeneration!
            )
          ).success
        ).toBe(true);
        expect(f.confirm('live').success).toBe(true);
        finishPresentation('RETURN');
        expect(f.confirm('bottom').success).toBe(true);
        advanceSelection();
        finishPresentation('PLACE');
      };
      const honoka = () => {
        finishPresentation('rewards');
        expect(f.confirm('recovery-member').success).toBe(true);
        advanceSelection();
        finishPresentation('recovery');
      };
      for (const run of first === 'rina' ? [rina, honoka] : [honoka, rina]) run();
      expect(waits).toHaveLength(4);
      expect(session.state!.entranceRuntime!.pending).toBeNull();
      expect(session.state!.entranceRuntime!.resumePendingEffects).toBeUndefined();
      expect(session.state!.pendingAbilities).toEqual([]);
      expect(session.state!.players[0].liveZone.cardIds).toEqual(['bottom']);
      expect(session.state!.players[0].mainDeck.cardIds[0]).toBe('live');
      expect(
        session.state!.players[0].hand.cardIds.filter((id) => id === 'recovery-member')
      ).toHaveLength(1);
      expect(session.state!.liveResolution.playerScores.get('p1')).toBe(1);
      expect(
        session.state!.liveResolution.liveModifiers.filter(
          (m) => m.kind === 'SCORE' || m.kind === 'HEART'
        )
      ).toHaveLength(2);
      expect(session.state!.actionHistory.filter((a) => a.type === 'PAY_COST')).toHaveLength(1);
    }
  );
});
