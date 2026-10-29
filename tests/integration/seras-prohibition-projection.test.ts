import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addMemberBelowMember, removeCardFromSlot } from '../../src/domain/entities/zone';
import { isStageMemberActivatedAbilityProhibited } from '../../src/domain/rules/member-activated-ability-prohibitions';
import { addMemberCostLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { projectPlayerViewState } from '../../src/online/projector';
import { OrientationState, SlotPosition } from '../../src/shared/types/enums';
import { createOctober29DraftCard } from '../helpers/october-29-draft-effects';
import { P1, P2, syntheticMember, gameWith, stage } from '../helpers/edelnote-effect-fixture';

function setup(rare = 'SEC') {
  const source = createOctober29DraftCard('PL!HS-bp8-007', P1, 'seras');
  let game = gameWith([
    createCardInstance({ ...source.data, cardCode: `PL!HS-bp8-007-${rare}` }, P1, 'seras'),
    // A different Izumi print: the condition is character identity, not bp8 alone.
    syntheticMember('izumi', { name: '桂城泉', cardCode: 'PL!HS-cl1-008-CL', cost: 4 }),
    syntheticMember('own', { cardCode: 'PL!-pb1-019-N', cost: 2 }),
    syntheticMember('enemy', { cardCode: 'PL!-pb1-019-N', cost: 4 }, P2),
    syntheticMember('high', { cardCode: 'PL!-pb1-019-N', cost: 5 }, P2),
    syntheticMember('private', { cardCode: 'PL!-pb1-019-N', cost: 2 }, P2),
  ]);
  game = stage(stage(stage(game, 'seras'), 'izumi', SlotPosition.LEFT), 'own', SlotPosition.RIGHT);
  game = stage(stage(game, 'enemy', SlotPosition.LEFT, P2), 'high', SlotPosition.RIGHT, P2);
  return updatePlayer(game, P2, (p) => ({ ...p, hand: { ...p.hand, cardIds: ['private'] } }));
}

function lockedIds(game: GameState, viewer = P1) {
  return Object.values(projectPlayerViewState(game, viewer).objects)
    .filter((o) => o.activatedAbilityProhibition === 'SERAS_LOW_COST')
    .map((o) => o.publicObjectId)
    .sort();
}

describe('Seras continuous seal public projection', () => {
  it('omits vanilla and non-activated members without changing the underlying prohibition', () => {
    let game = registerCards(setup(), [syntheticMember('vanilla', { cost: 2 }, P2)]);
    game = stage(game, 'vanilla', SlotPosition.RIGHT, P2);
    // Seras mentions ACTIVATED in her continuous text but possesses no activated ability.
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P1,
      memberCardId: 'seras',
      sourceCardId: 'seras',
      abilityId: 'test-cost',
      countDelta: -9,
    })!.gameState;
    for (const viewer of [P1, P2]) {
      expect(lockedIds(game, viewer)).toEqual(['obj_enemy', 'obj_izumi', 'obj_own']);
    }
    expect(isStageMemberActivatedAbilityProhibited(game, P2, 'vanilla')).toBe(true);
    expect(isStageMemberActivatedAbilityProhibited(game, P1, 'seras')).toBe(true);
  });

  it('shows a low-cost host only while it possesses a granted activated ability', () => {
    let game = registerCards(setup(), [
      syntheticMember('host', { cardCode: 'LL-bp8-001-R', cost: 15 }, P2),
      syntheticMember('below', { cardCode: 'PL!-pb2-027-N', name: '矢澤にこ', cost: 2 }, P2),
    ]);
    game = stage(game, 'host', SlotPosition.RIGHT, P2);
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P2,
      memberCardId: 'host',
      sourceCardId: 'seras',
      abilityId: 'test-cost',
      countDelta: -11,
    })!.gameState;
    expect(lockedIds(game)).not.toContain('obj_host');
    game = updatePlayer(game, P2, (p) => ({
      ...p,
      memberSlots: addMemberBelowMember(p.memberSlots, SlotPosition.RIGHT, 'below'),
    }));
    expect(lockedIds(game, P1)).toContain('obj_host');
    expect(lockedIds(game, P2)).toContain('obj_host');
    // Waiting does not remove a possessed ability.
    game = stage(game, 'host', SlotPosition.RIGHT, P2, OrientationState.WAITING);
    expect(lockedIds(game)).toContain('obj_host');
    game = updatePlayer(game, P2, (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, memberBelow: { ...p.memberSlots.memberBelow, RIGHT: [] } },
      waitingRoom: { ...p.waitingRoom, cardIds: ['below'] },
    }));
    expect(lockedIds(game)).not.toContain('obj_host');
  });
  it.each(['SEC', 'R', 'P'])(
    'projects the same public prohibition for both seats, %s print',
    (rare) => {
      const game = setup(rare);
      for (const viewer of [P1, P2]) {
        expect(lockedIds(game, viewer)).toEqual(['obj_enemy', 'obj_izumi', 'obj_own']);
        const view = projectPlayerViewState(game, viewer);
        expect(view.objects.obj_private?.activatedAbilityProhibition).toBeUndefined();
        expect(view.objects.obj_own.activatedAbilityUiConfigs).toEqual([]);
      }
      expect(projectPlayerViewState(game, P1).objects.obj_private).toBeUndefined();
      expect(projectPlayerViewState(game, P2).objects.obj_private.surface).toBe('FRONT');
      expect(game.activeEffect).toBeNull();
      expect(game.entranceRuntime?.pending).toBeFalsy();
    }
  );

  it('tracks current effective cost across the 4/5 boundary and new arrivals', () => {
    let game = setup();
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P2,
      memberCardId: 'high',
      sourceCardId: 'seras',
      abilityId: 'test-cost',
      countDelta: -1,
    })!.gameState;
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P2,
      memberCardId: 'enemy',
      sourceCardId: 'seras',
      abilityId: 'test-cost',
      countDelta: 1,
    })!.gameState;
    expect(lockedIds(game)).toEqual(['obj_high', 'obj_izumi', 'obj_own']);
    game = updatePlayer(game, P2, (p) => ({ ...p, hand: { ...p.hand, cardIds: [] } }));
    game = stage(game, 'private', SlotPosition.CENTER, P2);
    expect(lockedIds(game)).toContain('obj_private');
  });

  it('clears immediately on Izumi waiting, Seras leaving, and the match ending', () => {
    const game = setup();
    const waiting = stage(game, 'izumi', SlotPosition.LEFT, P1, OrientationState.WAITING);
    expect(lockedIds(waiting)).toEqual([]);
    expect(
      projectPlayerViewState(waiting, P1).objects.obj_own.activatedAbilityUiConfigs?.length
    ).toBeGreaterThan(0);
    const left = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...p.waitingRoom, cardIds: ['seras'] },
    }));
    expect(lockedIds(left)).toEqual([]);
    expect(lockedIds({ ...game, isEnded: true })).toEqual([]);
    // Seras's own orientation is not a condition.
    expect(
      lockedIds(stage(game, 'seras', SlotPosition.CENTER, P1, OrientationState.WAITING))
    ).toEqual(lockedIds(game));
  });

  it('retains a seal while another controller still has an active Seras/Izumi pair', () => {
    let game = registerCards(setup(), [
      createOctober29DraftCard('PL!HS-bp8-007', P2, 'other-seras'),
      createOctober29DraftCard('PL!HS-bp8-008', P2, 'other-izumi'),
    ]);
    game = stage(
      stage(game, 'other-seras', SlotPosition.CENTER, P2),
      'other-izumi',
      SlotPosition.RIGHT,
      P2
    );
    game = stage(game, 'izumi', SlotPosition.LEFT, P1, OrientationState.WAITING);
    expect(lockedIds(game)).toEqual(['obj_enemy', 'obj_izumi', 'obj_own']);
    game = stage(game, 'other-izumi', SlotPosition.RIGHT, P2, OrientationState.WAITING);
    expect(lockedIds(game)).toEqual([]);
  });
});
