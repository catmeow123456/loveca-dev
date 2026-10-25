import { describe, expect, it } from 'vitest';
import {
  BOKUHIKA_CAST,
  bokuhikaContributionFromNames,
  bokuhikaSuccessCueKey,
} from '../../client/src/components/game/song-animation/bokuhikaCast';
import { PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID as SUCCESS } from '../../src/application/card-effects/ability-ids';

describe('Bokuhika evaluated score presentation', () => {
  it('lights the evaluated identities, accepting existing name aliases', () => {
    expect(
      bokuhikaContributionFromNames(['南琴梨（南小鸟）', '矢澤にこ', '高坂穗乃果'], 3)
    ).toEqual({ members: ['kotori', 'nico', 'honoka'], scoreBonus: 3 });
  });
  it('supports zero and nine contributors', () => {
    expect(bokuhikaContributionFromNames([], 0)).toEqual({ members: [], scoreBonus: 0 });
    expect(
      bokuhikaContributionFromNames(
        BOKUHIKA_CAST.map((m) => m.name),
        9
      )?.members
    ).toHaveLength(9);
  });
  it('rejects duplicated, unknown or inconsistent identities/counts', () => {
    expect(bokuhikaContributionFromNames(['高坂穂乃果', '高坂穗乃果'], 2)).toBeNull();
    expect(bokuhikaContributionFromNames(['高海千歌'], 1)).toBeNull();
    expect(bokuhikaContributionFromNames(['高坂穂乃果'], 9)).toBeNull();
    expect(bokuhikaContributionFromNames([], 0.5)).toBeNull();
  });
});

describe('Bokuhika selected confirmation cue', () => {
  const effect = {
    id: 'pending-1',
    abilityId: SUCCESS,
    stepId: 'CONFIRM_ONLY_EFFECT',
    sourceObjectId: 'obj_song',
  };
  it('does not start in the order picker or while another song is selected', () => {
    expect(bokuhikaSuccessCueKey(null)).toBeNull();
    expect(bokuhikaSuccessCueKey({ ...effect, abilityId: 'ORDER_PENDING_ABILITIES' })).toBeNull();
    expect(bokuhikaSuccessCueKey({ ...effect, abilityId: 'PL!-sd1-019:live-success' })).toBeNull();
    expect(bokuhikaSuccessCueKey({ ...effect, stepId: 'RESOLVED' })).toBeNull();
  });
  it('keeps the cue stable for panel updates, but distinguishes subsequent invocations and sources', () => {
    const key = bokuhikaSuccessCueKey(effect);
    expect(key).not.toBeNull();
    expect(bokuhikaSuccessCueKey({ ...effect })).toBe(key);
    expect(bokuhikaSuccessCueKey({ ...effect, id: 'pending-2' })).not.toBe(key);
    expect(bokuhikaSuccessCueKey({ ...effect, sourceObjectId: 'obj_song-2' })).not.toBe(key);
  });
});
