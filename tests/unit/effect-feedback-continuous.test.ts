import { describe, expect, it } from 'vitest';
import { getEffectFeedbackPresentationChanges } from '../../client/src/lib/effectFeedbackPresentation';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type LiveModifierState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { buildEffectFeedbackEvents } from '../../src/online/effect-feedback';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getOctober31MemberData } from '../helpers/october-31-draft-effects';

const H = HeartColor;
const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
const member: MemberCardData = {
  cardCode: 'fixture',
  name: '测试成员',
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 1,
  hearts: [{ color: H.PINK, count: 1 }],
};

// Printed identity/stats from the specified October 31 export. Each test uses
// the actual continuous registry, rather than manufacturing feedback modifiers.
const rurino: MemberCardData = {
  ...member,
  cardCode: 'PL!HS-bp8-003-P',
  name: '大泽瑠璃乃',
  cost: 10,
  hearts: [
    { color: H.PINK, count: 3 },
    { color: H.GREEN, count: 1 },
    { color: H.BLUE, count: 1 },
  ],
};
const honoka: MemberCardData = {
  ...member,
  cardCode: 'PL!-sd1-001-SD',
  name: '高坂穗乃果',
  cost: 11,
  blade: 3,
  hearts: [
    { color: H.PINK, count: 1 },
    { color: H.YELLOW, count: 2 },
    { color: H.PURPLE, count: 1 },
  ],
};
const ren: MemberCardData = {
  ...member,
  cardCode: 'PL!SP-bp4-005-P',
  name: '叶月恋',
  cost: 15,
  blade: 4,
  hearts: [
    { color: H.RED, count: 1 },
    { color: H.YELLOW, count: 2 },
    { color: H.PURPLE, count: 3 },
  ],
};
const natsumi: MemberCardData = {
  ...member,
  cardCode: 'PL!SP-bp7-009-P',
  name: '鬼冢夏美',
  cost: 13,
  blade: 3,
  hearts: [
    { color: H.RED, count: 2 },
    { color: H.YELLOW, count: 2 },
    { color: H.PURPLE, count: 2 },
  ],
};
const ai: MemberCardData = {
  ...member,
  cardCode: 'PL!N-bp8-005-SEC',
  name: '宫下爱',
  cost: 10,
  blade: 6,
  groupNames: ['虹ヶ咲'],
  hearts: [
    { color: H.PINK, count: 1 },
    { color: H.RED, count: 2 },
    { color: H.BLUE, count: 2 },
  ],
};

function fixture(source = member, target = member): GameState {
  let game = registerCards(createGameState('continuous-feedback', 'p1', 'A', 'p2', 'B'), [
    createCardInstance(source, 'p1', 'source'),
    createCardInstance(target, 'p1', 'target'),
    createCardInstance(member, 'p2', 'opponent'),
    ...Array.from({ length: 5 }, (_, i) =>
      createCardInstance({ ...member, cost: i + 1 }, 'p1', `below-${i + 1}`)
    ),
    createCardInstance({ ...member, cost: 4 }, 'p1', 'duplicate-4'),
    createCardInstance(
      {
        cardCode: 'fixture-live',
        name: '测试LIVE',
        cardType: CardType.LIVE,
        score: 3,
        requirements: createHeartRequirement({ [H.PINK]: 1 }),
      },
      'p1',
      'live'
    ),
  ]);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(
      placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
      SlotPosition.LEFT,
      'target'
    ),
  }));
  return updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'opponent'),
  }));
}
const options = {
  source: 'SYSTEM' as const,
  isPublicCard: (game: GameState, id: string) =>
    game.players.some(
      (p) =>
        Object.values(p.memberSlots.slots).includes(id) ||
        Object.values(p.memberSlots.memberBelow).some((ids) => ids.includes(id)) ||
        (p.liveZone.cardIds.includes(id) &&
          p.liveZone.cardStates.get(id)?.face === FaceState.FACE_UP)
    ),
};
const feedback = (before: GameState, after: GameState) =>
  buildEffectFeedbackEvents(before, after, options);
function below(game: GameState, ids: readonly string[]): GameState {
  return updatePlayer(game, 'p1', (p) => ({
    ...p,
    memberSlots: { ...p.memberSlots, memberBelow: { ...p.memberSlots.memberBelow, CENTER: ids } },
  }));
}
function count(game: GameState, zone: 'hand' | 'successZone' | 'energyZone', n: number): GameState {
  return updatePlayer(game, 'p1', (p) => ({
    ...p,
    [zone]: { ...p[zone], cardIds: Array.from({ length: n }, (_, i) => `${zone}-${i}`) },
  }));
}
function grant(game: GameState, modifier: LiveModifierState): GameState {
  return addLiveModifier(game, modifier);
}
function blade(delta: number, sourceCardId = 'target'): LiveModifierState {
  return {
    kind: 'BLADE',
    target: 'TARGET_MEMBER',
    playerId: 'p1',
    sourceCardId,
    targetMemberCardId: 'source',
    abilityId: 'explicit',
    countDelta: delta,
  };
}

describe('continuous effective stat feedback', () => {
  it('reports Nico distinct below-cost growth as one actual COST/BLADE/PINK delta', () => {
    const before = below(fixture(getOctober31MemberData('PL!-bp8-009')), [
      'below-1',
      'below-2',
      'below-3',
    ]);
    const after = below(before, ['below-1', 'below-2', 'below-3', 'below-4']);
    expect(getMemberEffectiveCost(before, 'p1', 'source')).toBe(17);
    expect(getMemberEffectiveCost(after, 'p1', 'source')).toBe(19);
    expect(feedback(before, after)).toEqual([
      {
        type: 'EffectFeedback',
        source: 'SYSTEM',
        mode: 'UPDATE',
        actorSeat: undefined,
        targets: [
          {
            objectId: 'obj_source',
            zoneKey: 'FIRST_MEMBER_CENTER',
            changes: [
              { kind: 'COST', delta: 2 },
              { kind: 'BLADE', delta: 1 },
              { kind: 'HEART', color: H.PINK, delta: 1 },
            ],
          },
        ],
      },
    ]);
    expect(
      feedback(after, below(after, ['below-1', 'below-2', 'below-3', 'below-4', 'duplicate-4']))
    ).toEqual([]);
    expect(feedback(after, before)[0]?.targets[0]?.changes).toEqual([
      { kind: 'COST', delta: -2 },
      { kind: 'BLADE', delta: -1 },
      { kind: 'HEART', color: H.PINK, delta: -1 },
    ]);
  });

  it.each([
    ['hand count', rurino, 'hand', 6, 5, 1],
    ['success count', honoka, 'successZone', 1, 2, 1],
    ['energy threshold', ren, 'energyZone', 9, 10, 3],
  ] as const)(
    'compares effective values for %s families and their loss',
    (_, source, zone, oldCount, newCount, delta) => {
      const before = count(fixture(source), zone, oldCount);
      const after = count(before, zone, newCount);
      expect(feedback(before, after)).toMatchObject([
        {
          mode: 'UPDATE',
          targets: [
            {
              objectId: 'obj_source',
              changes: [{ kind: 'BLADE', delta }],
            },
          ],
        },
      ]);
      expect(feedback(after, before)[0]?.targets[0]?.changes).toEqual([
        { kind: 'BLADE', delta: -delta },
      ]);
      expect(feedback(after, after)).toEqual([]);
    }
  );

  it('ignores dependency changes that leave the effective value unchanged', () => {
    const before = count(fixture(rurino), 'hand', 7);
    expect(feedback(before, count(before, 'hand', 8))).toEqual([]);
    const suppressed = grant(count(fixture(rurino), 'hand', 6), blade(-20));
    expect(feedback(suppressed, count(suppressed, 'hand', 5))).toEqual([]);
  });

  it('tracks the stage object across slots, including slot-sensitive conditions', () => {
    const before = updatePlayer(fixture(natsumi), 'p1', (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { CENTER: 'source', LEFT: null, RIGHT: null } },
    }));
    const side = updatePlayer(before, 'p1', (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { CENTER: null, LEFT: 'source', RIGHT: null } },
    }));
    expect(feedback(before, side)).toMatchObject([
      {
        mode: 'UPDATE',
        targets: [
          {
            objectId: 'obj_source',
            zoneKey: 'FIRST_MEMBER_LEFT',
            changes: [{ kind: 'HEART', color: H.RED, delta: 1 }],
          },
        ],
      },
    ]);
    const otherSide = updatePlayer(side, 'p1', (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { CENTER: null, LEFT: null, RIGHT: 'source' } },
    }));
    expect(feedback(side, otherSide)).toEqual([]);
  });

  it('does not turn entry, departure or a same-card reentry into a passive gain', () => {
    const entered = count(fixture(honoka), 'successZone', 2);
    const absent = updatePlayer(entered, 'p1', (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { ...p.memberSlots.slots, CENTER: null } },
    }));
    expect(feedback(absent, entered)).toEqual([]);
    expect(feedback(entered, absent)).toEqual([]);
    const reentered = emitGameEvent(
      count(entered, 'successZone', 3),
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, 'p1', 'p1')
    );
    expect(feedback(entered, reentered)).toEqual([]);
  });

  it('nets multiple continuous sources and publishes targets at both seats', () => {
    const after = fixture(ai, ai);
    const before = updatePlayer(after, 'p1', (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { ...p.memberSlots.slots, LEFT: null } },
    }));
    const events = feedback(before, after);
    expect(events).toHaveLength(1);
    expect(events[0]?.sourceObjectId).toBeUndefined();
    expect(events[0]?.targets).toEqual([
      {
        objectId: 'obj_source',
        zoneKey: 'FIRST_MEMBER_CENTER',
        changes: [{ kind: 'HEART', color: H.RED, delta: 1 }],
      },
      {
        objectId: 'obj_opponent',
        zoneKey: 'SECOND_MEMBER_CENTER',
        changes: [{ kind: 'HEART', color: H.RED, delta: 1 }],
      },
    ]);
  });

  it('uses effective COST rules for count and threshold changes, without payment feedback', () => {
    const hanamaru = { ...member, cardCode: 'PL!S-bp3-016-N', name: '国木田花丸' };
    const before = count(fixture(hanamaru), 'successZone', 1);
    expect(feedback(before, count(before, 'successZone', 2))[0]?.targets[0]?.changes).toEqual([
      { kind: 'COST', delta: 1 },
    ]);
    const margarete = { ...member, cardCode: 'PL!SP-pb1-010-P+', name: '薇恩·玛格丽特' };
    const energy9 = count(fixture(margarete), 'energyZone', 9);
    expect(feedback(energy9, count(energy9, 'energyZone', 10))[0]?.targets[0]?.changes).toEqual([
      { kind: 'COST', delta: 4 },
    ]);
    const ordinary = count(fixture(), 'energyZone', 10);
    expect(feedback(ordinary, count(ordinary, 'energyZone', 8))).toEqual([]);
  });

  it('reports explicit COST deltas and last cost-set override using the supplied snapshot', () => {
    const before = fixture();
    const plus = grant(before, {
      kind: 'MEMBER_COST',
      playerId: 'p1',
      memberCardId: 'source',
      sourceCardId: 'target',
      abilityId: 'cost',
      countDelta: 3,
    });
    expect(feedback(before, plus)[0]).toMatchObject({
      mode: 'APPLIED',
      sourceObjectId: 'obj_target',
      targets: [{ changes: [{ kind: 'COST', delta: 3 }] }],
    });
    const set = grant(plus, {
      kind: 'MEMBER_COST_SET',
      playerId: 'p1',
      memberCardId: 'source',
      sourceCardId: 'target',
      abilityId: 'set',
      setTo: 2,
    });
    expect(feedback(plus, set)[0]?.targets[0]?.changes).toEqual([{ kind: 'COST', delta: -5 }]);
    expect(getMemberEffectiveCost(set, 'p1', 'source', [])).toBe(4);
    expect(
      feedback(
        set,
        grant(set, { kind: 'MEMBER_COST', playerId: 'p1', memberCardId: 'source', countDelta: 5 })
      )
    ).toEqual([]);
    expect(feedback(set, before)[0]?.targets[0]?.changes).toEqual([{ kind: 'COST', delta: 2 }]);
  });

  it('preserves modifier order when an earlier cost set changes under a later override', () => {
    const early: LiveModifierState = {
      kind: 'MEMBER_COST_SET',
      playerId: 'p1',
      memberCardId: 'source',
      sourceCardId: 'target',
      setTo: 6,
    };
    const later: LiveModifierState = { ...early, sourceCardId: 'source', setTo: 8 };
    const before = grant(grant(fixture(), early), later);
    const after = {
      ...before,
      liveResolution: { ...before.liveResolution, liveModifiers: [{ ...early, setTo: 10 }, later] },
    };
    expect(getMemberEffectiveCost(after, 'p1', 'source')).toBe(8);
    expect(feedback(before, after)).toEqual([]);
  });

  it('excludes hidden dependencies before continuous cost queries and ignores reveal/conceal alone', () => {
    let before = below(fixture(getOctober31MemberData('PL!-bp8-009')), ['below-1', 'below-2']);
    before = updatePlayer(before, 'p1', (p) => ({
      ...p,
      liveZone: {
        ...p.liveZone,
        cardIds: ['live'],
        cardStates: new Map([['live', { ...active, face: FaceState.FACE_DOWN }]]),
      },
    }));
    const hidden = grant(before, {
      kind: 'MEMBER_COST_SET',
      playerId: 'p1',
      memberCardId: 'below-2',
      sourceCardId: 'live',
      setTo: 1,
      visibilityDependency: { kind: 'PLAYER_LIVE_ZONE_CONTENTS', playerId: 'p1' },
    });
    expect(feedback(before, hidden)).toEqual([]);
    const revealed = updatePlayer(hidden, 'p1', (p) => ({
      ...p,
      liveZone: { ...p.liveZone, cardStates: new Map([['live', active]]) },
    }));
    expect(feedback(hidden, revealed)).toEqual([]);
    expect(feedback(revealed, hidden)).toEqual([]);
  });

  it('withholds actual hidden-LIVE continuous feedback from both-seat public events', () => {
    const eli = { ...member, cardCode: 'PL!-bp4-002-P', name: '绚濑绘里', cost: 15, blade: 4 };
    const before = fixture(eli);
    const hidden = updatePlayer(before, 'p1', (p) => ({
      ...p,
      liveZone: {
        ...p.liveZone,
        cardIds: ['live'],
        cardStates: new Map([['live', { ...active, face: FaceState.FACE_DOWN }]]),
      },
    }));
    expect(feedback(before, hidden)).toEqual([]);
    const visible = updatePlayer(hidden, 'p1', (p) => ({
      ...p,
      liveZone: { ...p.liveZone, cardStates: new Map([['live', active]]) },
    }));
    expect(feedback(hidden, visible)).toEqual([]);
    const removed = updatePlayer(visible, 'p1', (p) => ({
      ...p,
      liveZone: { ...p.liveZone, cardIds: [], cardStates: new Map() },
    }));
    expect(feedback(visible, removed)[0]?.targets[0]?.changes).toEqual([
      { kind: 'HEART', color: H.PURPLE, delta: -2 },
    ]);
  });

  it('folds all passive kinds into the last explicit feedback for that target', () => {
    const before = below(fixture(getOctober31MemberData('PL!-bp8-009')), [
      'below-1',
      'below-2',
      'below-3',
    ]);
    const after = grant(below(before, ['below-1', 'below-2', 'below-3', 'below-4']), blade(2));
    const result = feedback(before, after);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mode: 'APPLIED',
      sourceObjectId: 'obj_target',
      targets: [
        {
          objectId: 'obj_source',
          changes: [
            { kind: 'COST', delta: 2 },
            { kind: 'BLADE', delta: 3 },
            { kind: 'HEART', color: H.PINK, delta: 1 },
          ],
        },
      ],
    });
  });

  it('preserves separate duplicate/source grants while folding passive changes only once', () => {
    const before = count(fixture(rurino), 'hand', 6);
    const after = grant(
      grant(grant(count(before, 'hand', 5), blade(1)), blade(1)),
      blade(2, 'source')
    );
    const result = feedback(before, after);
    expect(result.map((event) => event.sourceObjectId)).toEqual(['obj_target', 'obj_source']);
    expect(result.map((event) => event.targets[0]?.changes)).toEqual([
      [{ kind: 'BLADE', delta: 2 }],
      [{ kind: 'BLADE', delta: 3 }],
    ]);
    const cloned = {
      ...after,
      liveResolution: {
        ...after.liveResolution,
        liveModifiers: structuredClone(after.liveResolution.liveModifiers),
      },
    };
    expect(feedback(after, cloned)).toEqual([]);
  });

  it('removes a target delta when passive loss and explicit gain cancel', () => {
    const before = count(fixture(rurino), 'hand', 5);
    const after = grant(count(before, 'hand', 6), blade(1));
    expect(feedback(before, after).flatMap((event) => event.targets)).toEqual([]);
  });

  it('keeps mixed passive losses as signed UPDATE facts while showing only the net explicit gain', () => {
    const before = below(fixture(getOctober31MemberData('PL!-bp8-009')), [
      'below-1',
      'below-2',
      'below-3',
    ]);
    const result = feedback(before, grant(below(before, ['below-1', 'below-2']), blade(2)));
    expect(result).toMatchObject([
      {
        mode: 'UPDATE',
        targets: [
          {
            objectId: 'obj_source',
            changes: [
              { kind: 'COST', delta: -2 },
              { kind: 'HEART', color: H.PINK, delta: -1 },
            ],
          },
        ],
      },
      {
        mode: 'APPLIED',
        sourceObjectId: 'obj_target',
        targets: [{ objectId: 'obj_source', changes: [{ kind: 'BLADE', delta: 1 }] }],
      },
    ]);
    expect(
      result.flatMap((event) =>
        event.targets.flatMap((target) =>
          getEffectFeedbackPresentationChanges(event.mode, target.changes)
        )
      )
    ).toEqual([{ kind: 'BLADE', delta: 1 }]);
  });

  it('keeps a net passive loss out of APPLIED when it outweighs an explicit gain', () => {
    const before = count(fixture(rurino), 'hand', 4);
    const result = feedback(before, grant(count(before, 'hand', 6), blade(1)));
    expect(
      result.flatMap((event) =>
        event.targets.map((target) => ({ mode: event.mode, changes: target.changes }))
      )
    ).toEqual([{ mode: 'UPDATE', changes: [{ kind: 'BLADE', delta: -1 }] }]);
    expect(
      result.flatMap((event) =>
        event.targets.flatMap((target) =>
          getEffectFeedbackPresentationChanges(event.mode, target.changes)
        )
      )
    ).toEqual([]);
  });

  it('retains explicit negative feedback when a positive passive change offsets part of it', () => {
    const before = count(fixture(rurino), 'hand', 6);
    const result = feedback(before, grant(count(before, 'hand', 5), blade(-2)));
    expect(result).toMatchObject([
      {
        mode: 'APPLIED',
        sourceObjectId: 'obj_target',
        targets: [
          {
            changes: [{ kind: 'BLADE', delta: -1 }],
          },
        ],
      },
    ]);
    expect(
      result.flatMap((event) =>
        event.targets.flatMap((target) =>
          getEffectFeedbackPresentationChanges(event.mode, target.changes)
        )
      )
    ).toEqual([{ kind: 'BLADE', delta: -1 }]);
  });
});
