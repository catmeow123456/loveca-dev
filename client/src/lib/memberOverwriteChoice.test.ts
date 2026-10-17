import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViewCommandHint } from '@game/online';
import { GameCommandType } from '@game/application/game-commands';
import { SlotPosition } from '@game/shared/types/enums';
import {
  getMemberOverwriteOption,
  readAskMemberOverwrite,
  saveAskMemberOverwrite,
} from './memberOverwriteChoice';

const option = {
  sourceObjectId: 'obj_hand',
  targetObjectId: 'obj_stage',
  targetSlot: SlotPosition.LEFT,
  choices: [
    { relayMode: 'SINGLE', energyCost: 2 },
    { relayMode: 'NONE', energyCost: 8 },
  ],
};
const hint: ViewCommandHint = {
  command: GameCommandType.PLAY_MEMBER_TO_SLOT,
  enabled: true,
  params: { memberOverwriteOptions: [option] },
};

afterEach(() => vi.unstubAllGlobals());

describe('member overwrite choice from authority projection', () => {
  it('accepts only the selected hand card and occupied target slot', () => {
    expect(getMemberOverwriteOption(hint, 'obj_hand', SlotPosition.LEFT)).toEqual({
      targetObjectId: 'obj_stage',
      choices: option.choices,
    });
    expect(getMemberOverwriteOption(hint, 'obj_other', SlotPosition.LEFT)).toBeNull();
    expect(getMemberOverwriteOption(hint, 'obj_hand', SlotPosition.RIGHT)).toBeNull();
    expect(
      getMemberOverwriteOption({ ...hint, enabled: false }, 'obj_hand', SlotPosition.LEFT)
    ).toBeNull();
  });
  it.each([
    [],
    [option.choices[0]],
    [option.choices[0], option.choices[0]],
    [{ relayMode: 'DOUBLE', energyCost: 1 }, option.choices[1]],
    [{ relayMode: 'SINGLE', energyCost: -1 }, option.choices[1]],
    [{ relayMode: 'SINGLE', energyCost: 1.5 }, option.choices[1]],
  ])('rejects incomplete, duplicate or invalid alternatives (%j)', (...choices) => {
    const invalidHint = { ...hint, params: { memberOverwriteOptions: [{ ...option, choices }] } };
    expect(getMemberOverwriteOption(invalidHint, 'obj_hand', SlotPosition.LEFT)).toBeNull();
  });
  it('keeps both equal-cost choices, including a zero-energy relay', () => {
    for (const energyCost of [0, 8]) {
      const choices = [
        { relayMode: 'SINGLE', energyCost },
        { relayMode: 'NONE', energyCost },
      ];
      expect(
        getMemberOverwriteOption(
          { ...hint, params: { memberOverwriteOptions: [{ ...option, choices }] } },
          'obj_hand',
          SlotPosition.LEFT
        )?.choices
      ).toHaveLength(2);
    }
  });
});

describe('local preference', () => {
  it('defaults off and persists only explicit opt-in', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    expect(readAskMemberOverwrite()).toBe(false);
    saveAskMemberOverwrite(true);
    expect(readAskMemberOverwrite()).toBe(true);
    saveAskMemberOverwrite(false);
    expect(readAskMemberOverwrite()).toBe(false);
  });
  it('stays usable when local storage is unavailable', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('unavailable');
      },
    });
    expect(readAskMemberOverwrite()).toBe(false);
    expect(() => saveAskMemberOverwrite(true)).not.toThrow();
  });
});
