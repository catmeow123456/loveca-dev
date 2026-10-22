import { describe, expect, it } from 'vitest';
import { N_BP8_019_LIVE_START_CHOOSE_ABSENT_NIJIGASAKI_HEART_COLOR_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import type { MemberCardData } from '../../src/domain/entities/card';
import { updatePlayer } from '../../src/domain/entities/game';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  addHeartLiveModifierForSourceMember,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { HeartColor as H, SlotPosition } from '../../src/shared/types/enums';
import {
  P1,
  member,
  gameWith,
  stage,
  start,
  sessionFor,
  choose,
  setState,
} from '../helpers/modifier-workflow-fixtures';

function setup(count = 3) {
  const source = member('PL!N-bp8-019-N', 'source', P1, { hearts: [], sourceFlags: undefined });
  const others = [member('OTHER-1', 'other-1'), member('OTHER-2', 'other-2')];
  return {
    source,
    session: sessionFor(
      start(
        stage(gameWith([source, ...others]), [source, ...others].slice(0, count)),
        source,
        ABILITY
      )
    ),
  };
}

function setupScreenshot() {
  const source = member('PL!N-bp8-019-N', 'source', P1, {
    hearts: [],
    sourceFlags: {
      missingRuleFields: ['hearts'],
      parseWarnings: ['PL!N-bp8-019-N hearts: old import warning'],
    },
  });
  const others = ['karin-1', 'karin-2'].map((id) =>
    member('PL!N-bp8-004-SEC', id, P1, {
      name: '朝香果林',
      cost: 9,
      hearts: [
        { color: H.GREEN, count: 1 },
        { color: H.BLUE, count: 1 },
        { color: H.PURPLE, count: 1 },
      ],
      sourceFlags: {
        parseWarnings: ['PL!N-bp8-004-SEC blade_hearts: unsupported blade heart value'],
      },
    })
  );
  return {
    source,
    others,
    session: sessionFor(
      start(stage(gameWith([source, ...others]), [source, ...others]), source, ABILITY)
    ),
  };
}

describe('PL!N-bp8-019 费用4「优木雪菜」 missing-color rule', () => {
  it.each([H.PINK, H.RED, H.YELLOW])(
    'grants absent %s for the screenshot stage despite import diagnostics',
    (color) => {
      const { source, session } = setupScreenshot();
      expect(source.data.hearts).toEqual([]);
      expect(source.data.sourceFlags?.missingRuleFields).toContain('hearts');
      expect(source.data.sourceFlags?.parseWarnings).not.toHaveLength(0);
      expect(choose(session, color).success).toBe(true);
      expect(getMemberEffectiveHeartIcons(session.state!, P1, source.instanceId)).toEqual([
        { color, count: 1 },
      ]);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.pendingAbilities).toEqual([]);
    }
  );
  it.each([H.GREEN, H.BLUE, H.PURPLE])(
    'does not grant existing %s on the screenshot stage',
    (color) => {
      const { source, session } = setupScreenshot();
      expect(choose(session, color).success).toBe(true);
      expect(getMemberEffectiveHeartIcons(session.state!, P1, source.instanceId)).toEqual([]);
    }
  );
  it('offers all six ordinary colors even when one already exists and grants an absent color', () => {
    const { source, session } = setup();
    expect(session.state!.activeEffect!.effectChoice!.options.map((option) => option.id)).toEqual([
      H.PINK,
      H.RED,
      H.YELLOW,
      H.GREEN,
      H.BLUE,
      H.PURPLE,
    ]);
    expect(choose(session, H.PURPLE).success).toBe(true);
    expect(getMemberEffectiveHeartIcons(session.state!, P1, source.instanceId)).toEqual([
      { color: H.PURPLE, count: 1 },
    ]);
  });
  it.each([H.RED, H.GRAY, H.RAINBOW, H.ORANGE])(
    'does not grant an existing or invalid selected color %s',
    (color) => {
      const { source, session } = setup();
      const result = choose(session, color);
      expect(result.success).toBe(color === H.RED);
      expect(getMemberEffectiveHeartIcons(session.state!, P1, source.instanceId)).toEqual([]);
    }
  );
  it('still chooses but grants nothing with fewer than three Nijigasaki members', () => {
    const { source, session } = setup(2);
    expect(choose(session, H.PURPLE).success).toBe(true);
    expect(getMemberEffectiveHeartIcons(session.state!, P1, source.instanceId)).toEqual([]);
  });
  it('rechecks effective stage Hearts after the color was presented', () => {
    const { source, others, session } = setupScreenshot();
    const result = addHeartLiveModifierForSourceMember(session.state!, {
      abilityId: 'synthetic-heart-gain',
      playerId: P1,
      sourceCardId: others[0]!.instanceId,
      hearts: [{ color: H.PINK, count: 1 }],
    });
    setState(session, result!.gameState);
    expect(choose(session, H.PINK).success).toBe(true);
    expect(getMemberEffectiveHeartIcons(session.state!, P1, source.instanceId)).toEqual([]);
  });
  it('rechecks the current Nijigasaki member count after the color was presented', () => {
    const { source, session } = setupScreenshot();
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
      }))
    );
    expect(choose(session, H.PINK).success).toBe(true);
    expect(getMemberEffectiveHeartIcons(session.state!, P1, source.instanceId)).toEqual([]);
  });
  it('does not treat a real invalid Heart list as an empty list', () => {
    const source = member('PL!N-bp8-019-N', 'source', P1, {
      hearts: null as unknown as MemberCardData['hearts'],
    });
    const others = [member('OTHER-1'), member('OTHER-2')];
    const session = sessionFor(
      start(stage(gameWith([source, ...others]), [source, ...others]), source, ABILITY)
    );
    expect(choose(session, H.PURPLE).success).toBe(true);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });
});
