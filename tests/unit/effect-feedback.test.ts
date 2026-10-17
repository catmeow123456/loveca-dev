import { isEffectFeedbackTargetCurrent } from '../../client/src/lib/effectFeedbackPresentation';
import { describe, expect, it } from 'vitest';
import { formatPublicBattleLogEvents } from '../../client/src/lib/publicBattleLogFormatter';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import { buildEffectFeedbackEvents } from '../../src/online/effect-feedback';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';
import {
  consumeEffectFeedback,
  type EffectFeedbackCursor,
} from '../../client/src/lib/effectFeedback';
import { projectPlayerViewState } from '../../src/online/projector';
import type { EffectFeedbackPublicEvent } from '../../src/online';

const member: MemberCardData = {
  cardCode: 'fixture',
  name: '成员',
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 1,
  hearts: [{ color: HeartColor.PINK, count: 1 }],
};
function fixture() {
  let game = registerCards(createGameState('feedback', 'p1', 'A', 'p2', 'B'), [
    createCardInstance(member, 'p1', 'source'),
    createCardInstance(member, 'p1', 'target'),
    createCardInstance(member, 'p2', 'opponent'),
    createCardInstance(
      {
        cardCode: 'live',
        name: 'LIVE',
        cardType: CardType.LIVE,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }, 3),
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
    liveZone: {
      ...p.liveZone,
      cardIds: ['live'],
      cardStates: new Map([
        ['live', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  return updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'opponent'),
  }));
}
function isPublicCard(game: GameState, id: string) {
  return game.players.some(
    (p) =>
      Object.values(p.memberSlots.slots).includes(id) ||
      p.waitingRoom.cardIds.includes(id) ||
      (p.liveZone.cardIds.includes(id) && p.liveZone.cardStates.get(id)?.face === FaceState.FACE_UP)
  );
}
const options = { source: 'SYSTEM' as const, isPublicCard };
function blade(game: GameState, delta = 1, target = 'target', source = 'source') {
  return addLiveModifier(game, {
    kind: 'BLADE',
    target: 'TARGET_MEMBER',
    playerId: 'p1',
    targetMemberCardId: target,
    sourceCardId: source,
    abilityId: 'gain',
    countDelta: delta,
  });
}

describe('authority effect feedback', () => {
  it('keeps source and multiple targets together and reports clamped effective deltas', () => {
    const before = fixture();
    const after = blade(blade(before, -5), 2, 'source');
    expect(buildEffectFeedbackEvents(before, after, options)).toMatchObject([
      {
        mode: 'APPLIED',
        sourceObjectId: 'obj_source',
        targets: [
          { objectId: 'obj_target', changes: [{ kind: 'BLADE', delta: -1 }] },
          { objectId: 'obj_source', changes: [{ kind: 'BLADE', delta: 2 }] },
        ],
      },
    ]);
  });
  it('reports repeated identical grants and never merges different sources', () => {
    const before = fixture();
    const once = blade(before);
    expect(buildEffectFeedbackEvents(once, blade(once), options)[0]?.targets[0]?.changes).toEqual([
      { kind: 'BLADE', delta: 1 },
    ]);
    const result = buildEffectFeedbackEvents(
      before,
      blade(blade(before), 1, 'target', 'target'),
      options
    );
    expect(result.map((event) => event.sourceObjectId)).toEqual(['obj_source', 'obj_target']);
  });
  it('expires quietly and ignores unchanged states and departed targets', () => {
    const base = fixture(),
      buffed = blade(base);
    expect(buildEffectFeedbackEvents(buffed, base, options)).toMatchObject([
      { mode: 'UPDATE', targets: [{ changes: [{ delta: -1 }] }] },
    ]);
    expect(buildEffectFeedbackEvents(buffed, buffed, options)).toEqual([]);
    const departed = updatePlayer(base, 'p1', (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { ...p.memberSlots.slots, LEFT: null } },
    }));
    expect(buildEffectFeedbackEvents(buffed, departed, options)).toEqual([]);
  });
  it('does not expand member feedback into LIVE requirement changes', () => {
    const before = fixture();
    const after = addLiveModifier(before, {
      kind: 'REQUIREMENT',
      liveCardId: 'live',
      sourceCardId: 'source',
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -6 }],
    });
    expect(buildEffectFeedbackEvents(before, after, options)).toEqual([]);
  });
  it('only publishes modifiers visible to both seats and never includes hidden source identity', () => {
    let before = fixture();
    before = updatePlayer(before, 'p1', (p) => ({
      ...p,
      liveZone: {
        ...p.liveZone,
        cardStates: new Map([
          ['live', { face: FaceState.FACE_DOWN, orientation: OrientationState.ACTIVE }],
        ]),
      },
    }));
    const after = addLiveModifier(before, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: 'p1',
      sourceCardId: 'live',
      targetMemberCardId: 'target',
      hearts: [{ color: HeartColor.YELLOW, count: 2 }],
      visibilityDependency: { kind: 'PLAYER_LIVE_ZONE_CONTENTS', playerId: 'p1' },
    });
    expect(buildEffectFeedbackEvents(before, after, options)).toEqual([]);
    const revealed = updatePlayer(after, 'p1', (p) => ({
      ...p,
      liveZone: {
        ...p.liveZone,
        cardStates: new Map([
          ['live', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
        ]),
      },
    }));
    expect(buildEffectFeedbackEvents(after, revealed, options)).toEqual([]);
    expect(buildEffectFeedbackEvents(revealed, after, options)).toEqual([]);
    const publicGain = blade(before, 1, 'target', 'live');
    const event = buildEffectFeedbackEvents(before, publicGain, options)[0]!;
    expect(event.targets).toHaveLength(1);
    expect(event.sourceObjectId).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('obj_live');
  });
  it('does not replay gain feedback for orientation changes', () => {
    const before = fixture();
    const cause = { kind: 'CARD_EFFECT' as const, playerId: 'p1', sourceCardId: 'source' };
    const after = setMemberOrientation(
      before,
      'p2',
      'opponent',
      OrientationState.WAITING,
      cause
    )!.gameState;
    expect(buildEffectFeedbackEvents(before, after, options)).toEqual([]);
    const same = setMemberOrientation(
      after,
      'p2',
      'opponent',
      OrientationState.WAITING,
      cause
    )!.gameState;
    expect(buildEffectFeedbackEvents(after, same, options)).toEqual([]);
  });
  it('reports member hearts without including LIVE score or conflating source and target', () => {
    const before = fixture();
    let after = addLiveModifier(before, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: 'p1',
      sourceCardId: 'source',
      targetMemberCardId: 'target',
      hearts: [{ color: HeartColor.YELLOW, count: 2 }],
    });
    after = addLiveModifier(after, {
      kind: 'SCORE',
      playerId: 'p1',
      liveCardId: 'live',
      sourceCardId: 'source',
      countDelta: 1,
    });
    expect(buildEffectFeedbackEvents(before, after, options)[0]?.targets).toEqual([
      {
        objectId: 'obj_target',
        zoneKey: 'FIRST_MEMBER_LEFT',
        changes: [{ kind: 'HEART', color: HeartColor.YELLOW, delta: 2 }],
      },
    ]);
  });
});

function event(seq: number): EffectFeedbackPublicEvent {
  return {
    type: 'EffectFeedback',
    eventId: `feedback:${seq}`,
    seq,
    matchId: 'feedback',
    timestamp: 1,
    source: 'SYSTEM',
    mode: 'APPLIED',
    sourceObjectId: 'obj_source',
    targets: [
      {
        objectId: 'obj_target',
        zoneKey: 'FIRST_MEMBER_LEFT',
        changes: [{ kind: 'BLADE', delta: 1 }],
      },
    ],
  };
}
describe('client feedback cursor and layout', () => {
  it('does not display cosmetic events as log entries', () => {
    expect(
      formatPublicBattleLogEvents([event(1)], {
        viewerSeat: 'FIRST',
        getCardData: () => undefined,
        getSeatLabel: (seat) => seat,
      })
    ).toEqual([]);
  });
  it('uses the attached view floor before the initial log response arrives', () => {
    const initial = consumeEffectFeedback(null, { context: 'match:first', seq: 20, events: [] });
    const backfill = consumeEffectFeedback(initial.cursor, {
      context: 'match:first',
      seq: 20,
      events: [event(10), event(20)],
    });
    expect(backfill.events).toEqual([]);
    expect(
      consumeEffectFeedback(backfill.cursor, {
        context: 'match:first',
        seq: 21,
        events: [event(21)],
      }).events
    ).toHaveLength(1);
  });
  it('ignores history, accepts late log delivery once and resets on recovery, rollback and seat changes', () => {
    let result = consumeEffectFeedback(null, { context: 'first:0', seq: 10, events: [event(9)] });
    expect(result.events).toEqual([]);
    result = consumeEffectFeedback(result.cursor, { context: 'first:0', seq: 12, events: [] });
    result = consumeEffectFeedback(result.cursor, {
      context: 'first:0',
      seq: 12,
      events: [event(11)],
    });
    expect(result.events).toHaveLength(1);
    expect(
      consumeEffectFeedback(result.cursor, { context: 'first:0', seq: 12, events: [event(11)] })
        .events
    ).toEqual([]);
    for (const input of [
      { context: 'first:1', seq: 12 },
      { context: 'second:0', seq: 12 },
      { context: 'first:0', seq: 8 },
    ]) {
      expect(
        consumeEffectFeedback(result.cursor, { ...input, events: [event(11)] }).events
      ).toEqual([]);
    }
  });
  it('does not resurrect old effects when bounded event identities are pruned', () => {
    let cursor: EffectFeedbackCursor | null = consumeEffectFeedback(null, {
      context: 'a',
      seq: 0,
      events: [],
    }).cursor;
    const history = Array.from({ length: 300 }, (_, i) => event(i + 1));
    for (let seq = 1; seq <= 300; seq++)
      cursor = consumeEffectFeedback(cursor, {
        context: 'a',
        seq,
        events: history.slice(0, seq),
      }).cursor;
    expect(
      consumeEffectFeedback(cursor, { context: 'a', seq: 300, events: history }).events
    ).toEqual([]);
  });
  it('does not animate a departed target at an occupied replacement slot', () => {
    const view = projectPlayerViewState(fixture(), 'p1');
    expect(isEffectFeedbackTargetCurrent(event(1).targets[0]!, view)).toBe(true);
    const departed = {
      ...view,
      table: {
        zones: {
          ...view.table.zones,
          FIRST_MEMBER_LEFT: {
            ...view.table.zones.FIRST_MEMBER_LEFT,
            slotMap: { LEFT: 'obj_replacement' },
            objectIds: [],
          },
        },
      },
    };
    expect(isEffectFeedbackTargetCurrent(event(1).targets[0]!, departed)).toBe(false);
  });
});
