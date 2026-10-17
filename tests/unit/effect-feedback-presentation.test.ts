import { describe, it, expect } from 'vitest';
import {
  groupEffectFeedbackChanges,
  replaceFeedbackPresentations,
  isEffectFeedbackTargetCurrent,
  type FeedbackPresentation,
} from '../../client/src/lib/effectFeedbackPresentation';
import { HeartColor, FaceState } from '../../src/shared/types/enums';
import type { EffectFeedbackChange } from '../../src/online/types';
import { prepareEffectFeedbackScenario } from '../helpers/effect-feedback-fixture';

describe('effect feedback presentation', () => {
  it('preserves mixed colors, HEART/BLADE and opposite signs within one event', () => {
    expect(
      groupEffectFeedbackChanges([
        { kind: 'HEART', color: HeartColor.GREEN, delta: 1 },
        { kind: 'HEART', color: HeartColor.GREEN, delta: 2 },
        { kind: 'HEART', color: HeartColor.YELLOW, delta: 1 },
        { kind: 'BLADE', delta: 2 },
        { kind: 'HEART', color: HeartColor.GREEN, delta: -1 },
        { kind: 'BLADE', delta: 0 },
      ])
    ).toEqual([
      { kind: 'HEART', color: HeartColor.GREEN, delta: 3 },
      { kind: 'HEART', color: HeartColor.YELLOW, delta: 1 },
      { kind: 'BLADE', delta: 2 },
      { kind: 'HEART', color: HeartColor.GREEN, delta: -1 },
    ]);
  });
  it.each([
    { label: 'BLADE first', order: [0, 1, 2, 3, 4, 5] },
    { label: 'HEART first', order: [1, 2, 0, 4, 3, 5] },
    { label: 'reversed', order: [5, 4, 3, 2, 1, 0] },
  ])('preserves every mixed result regardless of input order: $label', ({ order }) => {
    const changes: EffectFeedbackChange[] = [
      { kind: 'BLADE', delta: 2 },
      { kind: 'HEART', color: HeartColor.GREEN, delta: 1 },
      { kind: 'HEART', color: HeartColor.BLUE, delta: 4 },
      { kind: 'HEART', color: HeartColor.YELLOW, delta: 2 },
      { kind: 'HEART', color: HeartColor.GREEN, delta: 2 },
      { kind: 'BLADE', delta: 1 },
    ];
    const result = groupEffectFeedbackChanges(order.map((index) => changes[index]!));
    expect(result).toHaveLength(4);
    expect(result).toEqual(
      expect.arrayContaining([
        { kind: 'BLADE', delta: 3 },
        { kind: 'HEART', color: HeartColor.GREEN, delta: 3 },
        { kind: 'HEART', color: HeartColor.BLUE, delta: 4 },
        { kind: 'HEART', color: HeartColor.YELLOW, delta: 2 },
      ])
    );
  });
  it('replaces only the same target immediately, retaining the new deadline and delta', () => {
    const item = (id: string, key: string, endsAt: number, changes: EffectFeedbackChange[]) =>
      ({
        id,
        key,
        endsAt,
        target: { changes },
      }) as FeedbackPresentation;
    const old = item('first', 'card:a', 1000, [
        { kind: 'BLADE', delta: 2 },
        { kind: 'HEART', color: HeartColor.GREEN, delta: 4 },
      ]),
      other = item('other', 'card:b', 1500, [{ kind: 'BLADE', delta: 1 }]),
      next = item('next', 'card:a', 1900, [
        { kind: 'BLADE', delta: 3 },
        { kind: 'HEART', color: HeartColor.GREEN, delta: 1 },
        { kind: 'HEART', color: HeartColor.YELLOW, delta: -1 },
      ]);
    const result = replaceFeedbackPresentations([old, other], [next]);
    expect(result).toEqual([next, other]);
    expect(result[0]!.target.changes).toEqual([
      { kind: 'BLADE', delta: 3 },
      { kind: 'HEART', color: HeartColor.GREEN, delta: 1 },
      { kind: 'HEART', color: HeartColor.YELLOW, delta: -1 },
    ]);
    expect(result.filter((p) => p.endsAt > 1100)).toHaveLength(2);

    const latest = item('latest', 'card:a', 2200, [
      { kind: 'HEART', color: HeartColor.GREEN, delta: -2 },
    ]);
    const batched = replaceFeedbackPresentations([old, other], [next, latest]);
    expect(batched).toEqual([latest, other]);
    expect(batched[0]!.target.changes).toEqual([
      { kind: 'HEART', color: HeartColor.GREEN, delta: -2 },
    ]);
    expect(batched[0]!.endsAt).toBe(2200);
  });
  it('ends on loss of public face or departure from the original zone, never following a hand card', () => {
    const fixture = prepareEffectFeedbackScenario('heart');
    const view = fixture.session.getPlayerViewState('p1')!;
    const [zoneKey, zone] = Object.entries(view.table.zones).find(([key]) =>
      key.includes('MEMBER_CENTER')
    )!;
    const objectId = Object.values(zone.slotMap ?? {})[0]!;
    const target = { zoneKey: zoneKey as 'FIRST_MEMBER_CENTER', objectId, changes: [] };
    expect(isEffectFeedbackTargetCurrent(target, view)).toBe(true);
    expect(
      isEffectFeedbackTargetCurrent(target, {
        ...view,
        objects: {
          ...view.objects,
          [objectId]: { ...view.objects[objectId]!, faceState: FaceState.FACE_DOWN },
        },
      })
    ).toBe(false);
    expect(
      isEffectFeedbackTargetCurrent(target, {
        ...view,
        table: {
          zones: { ...view.table.zones, [zoneKey]: { ...zone, slotMap: {}, objectIds: [] } },
        },
      })
    ).toBe(false);
  });
});
