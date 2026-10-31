import { describe, it, expect } from 'vitest';
import { projectPlayerViewState } from '../../src/online/projector';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { SlotPosition, FaceState, OrientationState } from '../../src/shared/types/enums';
import { setupAi, testMember, P1, P2, activateAi, chooseAi } from '../helpers/n-bp8-ai-effects';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { N_BP8_005_ACTIVATED_TAP_ENERGY_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID as ID } from '../../src/application/card-effects/ability-ids';
import { aiHeartLinks, withAiRecoveryPresentation } from '../../client/src/lib/aiEffects';
import { createBattleAnimationEventsFromViewDiff } from '../../client/src/lib/battleAnimationEvents';

const up = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
const rect = { left: 20, top: 10, width: 50, height: 70 };
const anchors = {
  cards: new Map([['obj_waiting-member', rect]]),
  zones: new Map([
    ['seat-FIRST::waiting-room', rect],
    ['seat-FIRST::hand', { ...rect, top: 500 }],
  ]),
};
describe('Ai cosmetic public projection and successful recovery', () => {
  it.each(['SEC', 'R', 'P+'])('uses actual public HEART recipients for both seats (%s)', (rare) => {
    let game = setupAi({ rarity: rare }).state!;
    game = registerCards(game, [
      testMember('own'),
      testMember('foreign', P1, '莲之空'),
      testMember('enemy', P2, 'Liella!'),
    ]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(
        placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'own', up),
        SlotPosition.RIGHT,
        'foreign',
        up
      ),
    }));
    game = updatePlayer(game, P2, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'enemy', up),
    }));
    for (const viewer of [P1, P2]) {
      const links = aiHeartLinks(projectPlayerViewState(game, viewer));
      expect(links.map((l) => l.targetId).sort()).toEqual(['obj_ai', 'obj_enemy', 'obj_own']);
      expect(links.every((l) => l.sourceId === 'obj_ai')).toBe(true);
      expect(
        projectPlayerViewState(game, viewer).objects['obj_waiting-member']?.aiHeartLinks
      ).toBeUndefined();
    }
    const left = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, 'ai'] },
    }));
    expect(aiHeartLinks(projectPlayerViewState(left, P1))).toEqual([]);
    expect(aiHeartLinks(projectPlayerViewState({ ...game, isEnded: true }, P1))).toEqual([]);
  });
  it.each([P1, P2])(
    'presents only a confirmed successful move, preserving hidden hand identity (%s)',
    (viewer) => {
      const session = setupAi();
      expect(activateAi(session, ID).success).toBe(true);
      expect(chooseAi(session, 'waiting-member').success).toBe(true);
      const previous = projectPlayerViewState(session.state!, viewer);
      expect(previous.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
      expect(withAiRecoveryPresentation(previous, previous, [], anchors)).toEqual([]);
      confirmPublicSelectionIfNeeded(session, P1);
      const projected = projectPlayerViewState(session.state!, viewer);
      const next = { ...projected, match: { ...projected.match, seq: previous.match.seq + 1 } };
      const ordinary = createBattleAnimationEventsFromViewDiff({
        previousViewState: previous,
        nextViewState: next,
        previousAnchors: anchors,
        nextAnchors: {
          ...anchors,
          cards: new Map([['obj_waiting-member', { ...rect, top: 500 }]]),
        },
      });
      const events = withAiRecoveryPresentation(previous, next, ordinary, anchors);
      const invitation = events.find((e) => e.kind === 'CARD_MOVE' && e.aiInvitation);
      expect(invitation).toBeDefined();
      if (invitation?.kind === 'CARD_MOVE') {
        expect(invitation.aiInvitation?.publicCardCode).toBe('TEST-waiting-member');
        expect(invitation.render.toSurface).toBe(viewer === P1 ? 'FRONT' : 'BACK');
      }
      if (viewer === P2) expect(next.objects['obj_waiting-member']).toBeUndefined();
      expect(
        withAiRecoveryPresentation(
          { ...previous, activeEffect: { ...previous.activeEffect!, abilityId: 'unrelated' } },
          next,
          ordinary,
          anchors
        )
      ).toEqual(ordinary);
      expect(session.state!.players[0].hand.cardIds).toEqual(['waiting-member']);
    }
  );
});
