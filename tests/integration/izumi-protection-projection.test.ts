import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addMemberBelowMember, removeCardFromSlot } from '../../src/domain/entities/zone';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import { projectPlayerViewState } from '../../src/online/projector';
import { OrientationState, SlotPosition } from '../../src/shared/types/enums';
import { createOctober29DraftCard } from '../helpers/october-29-draft-effects';
import { P1, P2, syntheticMember, gameWith, stage } from '../helpers/edelnote-effect-fixture';

function setup(rare = 'SEC') {
  const izumi = createOctober29DraftCard('PL!HS-bp8-008', P1, 'izumi');
  let game = gameWith([
    createCardInstance({ ...izumi.data, cardCode: `PL!HS-bp8-008-${rare}` }, P1, 'izumi'),
    // The partner is character identity, not just the 13-cost print.
    createOctober29DraftCard('PL!HS-bp8-015', P1, 'seras'),
    createOctober29DraftCard('PL!HS-bp8-008', P2, 'enemy-izumi'),
    createOctober29DraftCard('PL!HS-bp8-008', P1, 'hand-izumi'),
    syntheticMember('other-izumi', { name: '桂城泉', cardCode: 'PL!HS-cl1-008-CL' }),
  ]);
  game = stage(
    stage(stage(game, 'izumi'), 'seras', SlotPosition.LEFT),
    'other-izumi',
    SlotPosition.RIGHT
  );
  game = stage(game, 'enemy-izumi', SlotPosition.CENTER, P2);
  return updatePlayer(game, P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: ['hand-izumi'] } }));
}

function marked(game: GameState, viewer = P1) {
  return Object.values(projectPlayerViewState(game, viewer).objects)
    .filter((o) => o.opponentWaitProtection === 'IZUMI_EDELNOTE')
    .map((o) => o.publicObjectId)
    .sort();
}

describe('Izumi continuous self-protection public projection', () => {
  it.each(['SEC', 'R', 'P'])(
    'projects only the protected stage Izumi to both seats (%s)',
    (rare) => {
      const game = setup(rare);
      for (const viewer of [P1, P2]) {
        expect(marked(game, viewer)).toEqual(['obj_izumi']);
        expect(
          projectPlayerViewState(game, viewer).objects['obj_hand-izumi']?.opponentWaitProtection
        ).toBeUndefined();
      }
      expect(projectPlayerViewState(game, P2).objects['obj_hand-izumi']).toBeUndefined();
      expect(game.activeEffect).toBeNull();
      expect(game.entranceRuntime?.pending).toBeFalsy();
    }
  );

  it('keeps protection with either or both members waiting, with the same narrow rule scope', () => {
    let game = stage(setup(), 'seras', SlotPosition.LEFT, P1, OrientationState.WAITING);
    expect(marked(game)).toEqual(['obj_izumi']);
    const opponentCause = {
      kind: 'CARD_EFFECT' as const,
      playerId: P2,
      sourceCardId: 'enemy-izumi',
      abilityId: 'test-wait',
    };
    expect(
      setMemberOrientation(game, P1, 'izumi', OrientationState.WAITING, opponentCause)
        ?.blockedByWaitingProtection
    ).toBe(true);
    expect(
      setMemberOrientation(game, P1, 'izumi', OrientationState.WAITING, {
        ...opponentCause,
        playerId: P1,
      })?.changed
    ).toBe(true);
    expect(setMemberOrientation(game, P1, 'izumi', OrientationState.WAITING)?.changed).toBe(true);
    game = stage(game, 'izumi', SlotPosition.CENTER, P1, OrientationState.WAITING);
    expect(marked(game)).toEqual(['obj_izumi']);
  });

  it('clears immediately when the partner leaves, is underlaid, or the game ends', () => {
    const game = setup();
    const left = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT),
      waitingRoom: { ...p.waitingRoom, cardIds: ['seras'] },
    }));
    expect(marked(left)).toEqual([]);
    const below = updatePlayer(left, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      memberSlots: addMemberBelowMember(p.memberSlots, SlotPosition.CENTER, 'seras'),
    }));
    expect(marked(below)).toEqual([]);
    expect(marked({ ...game, isEnded: true })).toEqual([]);
  });

  it('protects a new arrival, but not the same card once it leaves the stage or becomes underlaid', () => {
    let game = updatePlayer(setup(), P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: [] } }));
    game = stage(game, 'hand-izumi', SlotPosition.RIGHT);
    expect(marked(game)).toEqual(['obj_hand-izumi', 'obj_izumi']);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.RIGHT),
      waitingRoom: { ...p.waitingRoom, cardIds: ['hand-izumi'] },
    }));
    expect(marked(game)).toEqual(['obj_izumi']);
    expect(projectPlayerViewState(game, P2).objects['obj_hand-izumi'].surface).toBe('FRONT');
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      memberSlots: addMemberBelowMember(p.memberSlots, SlotPosition.CENTER, 'hand-izumi'),
    }));
    expect(marked(game)).toEqual(['obj_izumi']);
  });

  it('does not label a different protection source as Izumi or borrow the opponent partner', () => {
    let game = registerCards(setup(), [
      syntheticMember('aqours', { groupNames: ['Aqours'], blade: 1 }, P2),
    ]);
    game = stage(game, 'aqours', SlotPosition.LEFT, P2);
    game = addMemberWaitProtectionUntilLiveEnd(game, {
      affectedPlayerId: P2,
      sourceCardId: 'aqours',
      abilityId: 'test-other-protection',
    });
    expect(marked(game)).toEqual(['obj_izumi']);
    const cause = {
      kind: 'CARD_EFFECT' as const,
      playerId: P1,
      sourceCardId: 'seras',
      abilityId: 'test-wait',
    };
    expect(
      setMemberOrientation(game, P2, 'aqours', OrientationState.WAITING, cause)
        ?.blockedByWaitingProtection
    ).toBe(true);
    expect(
      setMemberOrientation(game, P2, 'enemy-izumi', OrientationState.WAITING, cause)?.changed
    ).toBe(true);
  });
});
