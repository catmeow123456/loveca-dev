import { describe, expect, it } from 'vitest';
import { updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addMemberBelowMember, removeCardFromSlot } from '../../src/domain/entities/zone';
import { projectPlayerViewState } from '../../src/online/projector';
import { OrientationState, SlotPosition } from '../../src/shared/types/enums';
import { P1, P2, syntheticMember, gameWith, stage } from '../helpers/edelnote-effect-fixture';

function setup(rarity = 'SEC') {
  let game = gameWith([
    syntheticMember('kotori', { cardCode: `PL!-bp8-003-${rarity}`, groupNames: ['μ’s'] }),
    syntheticMember('muse', { groupNames: ["μ's"] }),
    syntheticMember('other', { groupNames: ['Aqours'] }),
    syntheticMember('second', { cardCode: 'PL!-bp8-003-R', groupNames: ['μ’s'] }),
    syntheticMember('hand', { groupNames: ['μ’s'] }),
    syntheticMember('enemy', { groupNames: ['μ’s'] }, P2),
  ]);
  game = stage(game, 'kotori');
  game = stage(game, 'muse', SlotPosition.LEFT, P1, OrientationState.WAITING);
  game = stage(game, 'other', SlotPosition.RIGHT, P1, OrientationState.WAITING);
  game = stage(game, 'enemy', SlotPosition.CENTER, P2, OrientationState.WAITING);
  return updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['hand', 'second'] },
  }));
}
function marked(game: GameState, viewer = P1) {
  return Object.values(projectPlayerViewState(game, viewer).objects)
    .filter((o) => o.kotoriMuseRelayBonus)
    .map((o) => o.publicObjectId)
    .sort();
}
const leave = (game: GameState, slot = SlotPosition.CENTER, id = 'kotori') =>
  updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: removeCardFromSlot(p.memberSlots, slot),
    waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, id] },
  }));

describe('Kotori conditional relay heart public projection', () => {
  it.each(['SEC', 'R', 'UNSEEN'])(
    'marks only own waiting μ’s members in both views (%s)',
    (rarity) => {
      const game = setup(rarity);
      for (const viewer of [P1, P2]) expect(marked(game, viewer)).toEqual(['obj_muse']);
      expect(projectPlayerViewState(game, P2).objects.obj_hand).toBeUndefined();
      expect(game.activeEffect).toBeNull();
      expect(game.entranceRuntime?.pending).toBeFalsy();
    }
  );
  it('adds the source when waiting and removes the mark as soon as a member readies', () => {
    const game = stage(setup(), 'kotori', SlotPosition.CENTER, P1, OrientationState.WAITING);
    expect(marked(game)).toEqual(['obj_kotori', 'obj_muse']);
    expect(marked(stage(game, 'muse', SlotPosition.LEFT))).toEqual(['obj_kotori']);
  });
  it('keeps a single boolean per recipient with two sources and removes only after the last source leaves', () => {
    let game = updatePlayer(setup(), P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: ['hand'] } }));
    game = stage(game, 'second', SlotPosition.RIGHT);
    for (const viewer of [P1, P2]) {
      expect(marked(game, viewer)).toEqual(['obj_muse']);
      expect(projectPlayerViewState(game, viewer).objects.obj_muse.kotoriMuseRelayBonus).toBe(true);
    }
    game = leave(game);
    expect(marked(game)).toEqual(['obj_muse']);
    expect(marked(leave(game, SlotPosition.RIGHT, 'second'))).toEqual([]);
  });
  it('does not retain the mark on a departed or underlaid recipient', () => {
    const game = leave(setup(), SlotPosition.LEFT, 'muse');
    expect(marked(game)).toEqual([]);
    const below = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      memberSlots: addMemberBelowMember(p.memberSlots, SlotPosition.CENTER, 'muse'),
    }));
    expect(marked(below)).toEqual([]);
  });
  it('does not grant from an underlaid source or an ended game', () => {
    const game = leave(setup());
    const below = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      memberSlots: addMemberBelowMember(p.memberSlots, SlotPosition.LEFT, 'kotori'),
    }));
    expect(marked(below)).toEqual([]);
    expect(marked({ ...setup(), isEnded: true })).toEqual([]);
  });
});
