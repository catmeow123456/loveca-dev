import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import {
  getEffectFeedbackPresentationChanges,
  groupEffectFeedbackChanges,
  replaceFeedbackPresentations,
  isEffectFeedbackTargetCurrent,
  type FeedbackPresentation,
} from '../../client/src/lib/effectFeedbackPresentation';
import {
  hasEffectFeedbackGlow,
  hasEffectFeedbackSourceGlow,
  isEffectFeedbackGain,
} from '../../client/src/lib/effectFeedback';
import { EffectResultArt } from '../../client/src/components/game/EffectResultArt';
import { HeartColor, FaceState } from '../../src/shared/types/enums';
import type { EffectFeedbackChange } from '../../src/online/types';
import { prepareEffectFeedbackScenario } from '../helpers/effect-feedback-fixture';

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react');
const { renderToStaticMarkup } = requireFromClient('react-dom/server');

function statChange(kind: 'HEART' | 'BLADE' | 'COST', delta: number): EffectFeedbackChange {
  return kind === 'HEART' ? { kind, color: HeartColor.GREEN, delta } : { kind, delta };
}

function presentation(
  mode: FeedbackPresentation['event']['mode'],
  changes: EffectFeedbackChange[],
  objectId = 'obj_target'
): FeedbackPresentation {
  const target = {
    objectId,
    zoneKey: 'FIRST_MEMBER_CENTER' as const,
    changes: getEffectFeedbackPresentationChanges(mode, changes),
  };
  return {
    id: `feedback:${objectId}`,
    key: `card:${objectId}`,
    event: {
      type: 'EffectFeedback',
      eventId: 'feedback',
      matchId: 'match',
      seq: 1,
      timestamp: 0,
      source: 'SYSTEM',
      mode,
      targets: [target],
    },
    target,
    source: false,
    startedAt: 0,
    endsAt: 1250,
  };
}

function renderArt(mode: FeedbackPresentation['event']['mode'], changes: EffectFeedbackChange[]) {
  return renderToStaticMarkup(
    createElement(EffectResultArt, { item: presentation(mode, changes), colorFor: () => '#d7c8ff' })
  ) as string;
}

describe('effect feedback presentation', () => {
  it.each(['HEART', 'BLADE', 'COST'] as const)(
    'uses the existing target gain for positive %s in either mode, with source light only for APPLIED',
    (kind) => {
      const change = statChange(kind, 2);
      expect(isEffectFeedbackGain(change)).toBe(true);
      for (const mode of ['APPLIED', 'UPDATE'] as const) {
        expect(getEffectFeedbackPresentationChanges(mode, [change])).toEqual([change]);
        expect(hasEffectFeedbackGlow(mode, [change])).toBe(true);
        expect(hasEffectFeedbackSourceGlow(mode, [change])).toBe(mode === 'APPLIED');
        expect(renderArt(mode, [change])).toContain(
          `data-effect-gain-radiance="${kind.toLowerCase()}"`
        );
      }
      expect(renderArt('UPDATE', [change])).toBe(renderArt('APPLIED', [change]));
    }
  );

  it.each(['HEART', 'BLADE', 'COST'] as const)(
    'does not mount gain art or values for non-positive passive %s changes',
    (kind) => {
      for (const delta of [-3, 0]) {
        const change = statChange(kind, delta);
        expect(isEffectFeedbackGain(change)).toBe(false);
        expect(getEffectFeedbackPresentationChanges('UPDATE', [change])).toEqual([]);
        expect(hasEffectFeedbackGlow('UPDATE', [change])).toBe(false);
        expect(hasEffectFeedbackSourceGlow('UPDATE', [change])).toBe(false);
        expect(renderArt('UPDATE', [change])).toBe('');
      }
    }
  );

  it('keeps an empty or negative-only passive target empty, without a source pulse', () => {
    const changes: EffectFeedbackChange[] = [
      { kind: 'HEART', color: HeartColor.BLUE, delta: -1 },
      { kind: 'BLADE', delta: -2 },
      { kind: 'COST', delta: -3 },
      { kind: 'HEART', color: HeartColor.GREEN, delta: 0 },
    ];
    for (const input of [[], changes]) {
      const presented = getEffectFeedbackPresentationChanges('UPDATE', input);
      expect(presented).toEqual([]);
      expect(hasEffectFeedbackGlow('UPDATE', presented)).toBe(false);
      expect(hasEffectFeedbackSourceGlow('UPDATE', presented)).toBe(false);
      expect(renderArt('UPDATE', input)).toBe('');
    }
  });

  it('preserves every positive continuous gain, suppressing losses only for the new passive stats', () => {
    const changes: EffectFeedbackChange[] = [
      { kind: 'HEART', color: HeartColor.GREEN, delta: 1 },
      { kind: 'HEART', color: HeartColor.GREEN, delta: 2 },
      { kind: 'HEART', color: HeartColor.BLUE, delta: 1 },
      { kind: 'BLADE', delta: 2 },
      { kind: 'COST', delta: 3 },
      { kind: 'HEART', color: HeartColor.GREEN, delta: -2 },
      { kind: 'BLADE', delta: -1 },
      { kind: 'COST', delta: -1 },
      { kind: 'SCORE', delta: -1 },
    ];
    expect(getEffectFeedbackPresentationChanges('UPDATE', changes)).toEqual([
      { kind: 'HEART', color: HeartColor.GREEN, delta: 3 },
      { kind: 'HEART', color: HeartColor.BLUE, delta: 1 },
      { kind: 'BLADE', delta: 2 },
      { kind: 'COST', delta: 3 },
      { kind: 'SCORE', delta: -1 },
    ]);
    const art = renderArt('UPDATE', changes);
    expect(art.match(/data-effect-gain-radiance="heart"/g)).toHaveLength(2);
    expect(art.match(/data-effect-gain-radiance="blade"/g)).toHaveLength(1);
    expect(art.match(/data-effect-gain-radiance="cost"/g)).toHaveLength(1);
    expect(art).not.toContain('<svg');
  });

  it('preserves explicit negative HEART/BLADE/SCORE/REQUIREMENT feedback and excludes non-positive COST', () => {
    const original: EffectFeedbackChange[] = [
      { kind: 'HEART', color: HeartColor.BLUE, delta: -1 },
      { kind: 'BLADE', delta: -2 },
      { kind: 'SCORE', delta: -1 },
      { kind: 'REQUIREMENT', color: HeartColor.RAINBOW, delta: -2 },
    ];
    expect(
      getEffectFeedbackPresentationChanges('APPLIED', [
        ...original,
        { kind: 'COST', delta: -1 },
        { kind: 'COST', delta: 0 },
      ])
    ).toEqual(original);
    for (const change of original) {
      expect(hasEffectFeedbackGlow('APPLIED', [change])).toBe(true);
      expect(hasEffectFeedbackSourceGlow('APPLIED', [change])).toBe(true);
      expect(renderArt('APPLIED', [change])).toContain('data-effect-result-art');
      expect(renderArt('APPLIED', [change])).not.toContain('data-effect-gain-radiance');
    }
    for (const delta of [-1, 0]) {
      const changes: EffectFeedbackChange[] = [{ kind: 'COST', delta }];
      expect(hasEffectFeedbackGlow('APPLIED', changes)).toBe(false);
      expect(hasEffectFeedbackSourceGlow('APPLIED', changes)).toBe(false);
      expect(renderArt('APPLIED', changes)).toBe('');
    }
  });

  it('keeps SCORE/REQUIREMENT UPDATE values in both directions without target or source glow', () => {
    for (const delta of [-2, 0, 3]) {
      const changes: EffectFeedbackChange[] = [
        { kind: 'SCORE', delta },
        { kind: 'REQUIREMENT', color: HeartColor.RAINBOW, delta },
      ];
      expect(getEffectFeedbackPresentationChanges('UPDATE', changes)).toEqual(delta ? changes : []);
      expect(hasEffectFeedbackGlow('UPDATE', changes)).toBe(false);
      expect(hasEffectFeedbackSourceGlow('UPDATE', changes)).toBe(false);
      expect(renderArt('UPDATE', changes)).toBe('');
    }
  });

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
  it.each(['HEART', 'BLADE', 'COST'] as const)(
    'immediately clears a prior positive %s UPDATE when a later update becomes quiet',
    (kind) => {
      const gain = presentation('UPDATE', [statChange(kind, 2)]);
      const other = presentation('UPDATE', [{ kind: 'BLADE', delta: 3 }], 'other');
      for (const delta of [-1, 0]) {
        const quiet = presentation('UPDATE', [statChange(kind, delta)]);
        expect(quiet.target.changes).toEqual([]);
        const removal = { key: quiet.key, remove: true } as const;

        const firstBatch = replaceFeedbackPresentations([], [gain, other]);
        expect(replaceFeedbackPresentations(firstBatch, [removal])).toEqual([other]);
        expect(replaceFeedbackPresentations([other], [gain, removal])).toEqual([other]);
        expect(replaceFeedbackPresentations([other], [removal, gain])).toEqual([other, gain]);
      }
    }
  );
  it('clears and replaces different targets in one batch without disturbing a parallel target', () => {
    const gain = presentation('UPDATE', [{ kind: 'BLADE', delta: 2 }]);
    const other = presentation('UPDATE', [{ kind: 'COST', delta: 1 }], 'other');
    const retained = presentation('APPLIED', [{ kind: 'BLADE', delta: -1 }], 'retained');
    const replacement = presentation('UPDATE', [{ kind: 'COST', delta: 4 }], 'other');
    expect(
      replaceFeedbackPresentations(
        [gain, other, retained],
        [{ key: gain.key, remove: true }, replacement]
      )
    ).toEqual([replacement, retained]);
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
        objects: {
          ...view.objects,
          [objectId]: { ...view.objects[objectId]!, surface: 'BACK' },
        },
      })
    ).toBe(false);
    const remainingObjects = { ...view.objects };
    delete remainingObjects[objectId];
    expect(isEffectFeedbackTargetCurrent(target, { ...view, objects: remainingObjects })).toBe(
      false
    );
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
