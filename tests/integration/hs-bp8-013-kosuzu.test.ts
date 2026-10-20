import { describe, expect, it } from 'vitest';
import { HS_BP8_013_LIVE_START_DOLLCHESTRA_LIVE_GAIN_THREE_BLADE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { updatePlayer } from '../../src/domain/entities/game';
import {
  P1,
  member,
  live,
  gameWith,
  stage,
  liveZone,
  start,
  sessionFor,
  confirm,
  setState,
} from '../helpers/modifier-workflow-fixtures';

describe('PL!HS-bp8-013 费用9「徒町小铃」 conditional source BLADE', () => {
  it.each(['DOLLCHESTRA', undefined])('confirms before granting with LIVE unit %s', (unit) => {
    const source = member('PL!HS-bp8-013-N');
    const song = live('TEST-LIVE', 'song', { unitName: unit });
    const session = sessionFor(
      start(liveZone(stage(gameWith([source, song]), [source]), song), source, ABILITY)
    );
    expect(session.state!.activeEffect!.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(getMemberEffectiveBladeCount(session.state!, P1, source.instanceId)).toBe(1);
    expect(confirm(session, P1).success).toBe(true);
    expect(getMemberEffectiveBladeCount(session.state!, P1, source.instanceId)).toBe(unit ? 4 : 1);
  });
  it('honors the structured all-zone triple-unit identity and rechecks the current LIVE zone', () => {
    const source = member('PL!HS-bp8-013-SEC');
    const song = live('PL!HS-bp2-020-L');
    const session = sessionFor(
      start(liveZone(stage(gameWith([source, song]), [source]), song), source, ABILITY)
    );
    expect(session.state!.activeEffect!.effectText).toContain('条件满足');
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        liveZone: { ...player.liveZone, cardIds: [] },
      }))
    );
    expect(confirm(session, P1).success).toBe(true);
    expect(getMemberEffectiveBladeCount(session.state!, P1, source.instanceId)).toBe(1);
  });
});
