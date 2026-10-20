import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { emitGameEvent } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { getPlayerLiveScoreModifier } from '../../src/domain/rules/live-modifiers';
import { BladeHeartEffect, HeartColor, TriggerCondition } from '../../src/shared/types/enums';
import {
  N_BP8_010_LIVE_SUCCESS_THREE_NO_BLADE_HEART_NIJIGASAKI_CHEER_SCORE_ABILITY_ID as SHIORIKO,
  SP_PR_035_LIVE_SUCCESS_OPPONENT_TWELVE_CHEER_SCORE_ABILITY_ID as TOMARI,
} from '../../src/application/card-effects/ability-ids';
import {
  P1,
  P2,
  member,
  gameWith,
  stage,
  start,
  sessionFor,
  confirm,
} from '../helpers/modifier-workflow-fixtures';

const IMPORT_DIAGNOSTICS: readonly MemberCardData['sourceFlags'][] = [
  undefined,
  { parseWarnings: ['row 1765 blade_hearts: unsupported blade heart value'] },
  { missingRuleFields: ['bladeHearts'] },
  {
    parseWarnings: ['row 1765 blade_hearts: unsupported blade heart value'],
    missingRuleFields: ['bladeHearts'],
  },
];

function setup(ability: string, count: number, overrides: Partial<MemberCardData> = {}) {
  const source = member(ability === SHIORIKO ? 'PL!N-bp8-010-P' : 'PL!SP-PR-035-PR', 'source');
  const owner = ability === SHIORIKO ? P1 : P2;
  const cards = Array.from({ length: count }, (_, index) =>
    member(`CHEER-${index}`, `cheer-${index}`, owner, overrides)
  );
  let game = stage(gameWith([source, ...cards]), [source]);
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      ...(owner === P1
        ? { firstPlayerCheerCardIds: cards.map((c) => c.instanceId) }
        : { secondPlayerCheerCardIds: cards.map((c) => c.instanceId) }),
    },
  };
  game = emitGameEvent(
    game,
    createCheerEvent(
      owner,
      cards.map((c) => c.instanceId),
      count,
      { automated: true }
    )
  );
  return {
    game,
    source,
    cards,
    session: sessionFor(start(game, source, ability, TriggerCondition.ON_LIVE_SUCCESS)),
  };
}

describe('LIVE-success revealed-cheer threshold total SCORE shared family', () => {
  it.each([
    [SHIORIKO, 2, 0],
    [SHIORIKO, 3, 1],
    [TOMARI, 11, 0],
    [TOMARI, 12, 1],
  ])('checks the correct threshold for %s / %i', (ability, count, score) => {
    const { session } = setup(ability as string, count as number);
    expect(session.state!.activeEffect!.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(0);
    expect(confirm(session, P1).success).toBe(true);
    expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(score);
    expect(session.state!.liveResolution.playerScores.get(P1) ?? 0).toBe(score);
    if (score)
      expect(session.state!.liveResolution.liveModifiers[0]).not.toHaveProperty('liveCardId');
    expect(session.state!.activeEffect).toBeNull();
  });
  it.each([BladeHeartEffect.HEART, BladeHeartEffect.DRAW, BladeHeartEffect.SCORE])(
    'excludes real %s Blade Hearts with or without import diagnostics',
    (effect) => {
      let confirmationText: string | undefined;
      for (const sourceFlags of IMPORT_DIAGNOSTICS) {
        const { session } = setup(SHIORIKO, 3, {
          bladeHearts: [
            effect === BladeHeartEffect.HEART ? { effect, heartColor: HeartColor.RED } : { effect },
          ],
          sourceFlags,
        });
        const effectText = session.state!.activeEffect!.effectText;
        confirmationText ??= effectText;
        expect(effectText).toBe(confirmationText);
        expect(effectText).toContain('成员0张');
        expect(effectText).toContain('实际LIVE合计分数＋0');
        expect(confirm(session, P1).success).toBe(true);
        expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(0);
        expect(session.state!.liveResolution.playerScores.get(P1) ?? 0).toBe(0);
        expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({
          matchingCardIds: [],
          conditionMet: false,
          scoreBonus: 0,
        });
      }
    }
  );
  it.each([
    { bladeHearts: [], count: 2, score: 0 },
    { bladeHearts: undefined, count: 2, score: 0 },
    { bladeHearts: [], count: 3, score: 1 },
    { bladeHearts: undefined, count: 3, score: 1 },
  ])(
    'counts $count empty Blade Heart lists ($bladeHearts) equally with or without import diagnostics',
    ({ bladeHearts, count, score }) => {
      let confirmationText: string | undefined;
      for (const sourceFlags of IMPORT_DIAGNOSTICS) {
        const { session, cards } = setup(SHIORIKO, count, { bladeHearts, sourceFlags });
        const effectText = session.state!.activeEffect!.effectText;
        confirmationText ??= effectText;
        expect(effectText).toBe(confirmationText);
        expect(effectText).toContain(`成员${count}张`);
        expect(effectText).toContain(`实际LIVE合计分数＋${score}`);
        expect(confirm(session, P1).success).toBe(true);
        expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(score);
        expect(session.state!.liveResolution.playerScores.get(P1) ?? 0).toBe(score);
        expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({
          matchingCardIds: cards.map((card) => card.instanceId),
          conditionMet: score === 1,
          scoreBonus: score,
        });
      }
    }
  );
  it('does not treat explicit null as an empty Blade Heart list regardless of diagnostics', () => {
    for (const sourceFlags of IMPORT_DIAGNOSTICS) {
      const { session } = setup(SHIORIKO, 3, {
        bladeHearts: null as unknown as MemberCardData['bladeHearts'],
        sourceFlags,
      });
      expect(session.state!.activeEffect!.effectText).toContain('成员0张');
      expect(session.state!.activeEffect!.effectText).toContain('实际LIVE合计分数＋0');
      expect(confirm(session, P1).success).toBe(true);
      expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(0);
      expect(session.state!.liveResolution.playerScores.get(P1) ?? 0).toBe(0);
    }
  });
  it('does not include an old cheer event after its cards stop belonging to this LIVE', () => {
    const { game, source } = setup(SHIORIKO, 3);
    const session = sessionFor(
      start(
        { ...game, liveResolution: { ...game.liveResolution, firstPlayerCheerCardIds: [] } },
        source,
        SHIORIKO,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );
    expect(confirm(session, P1).success).toBe(true);
    expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(0);
  });
  it('uses historical revealed cards already moved out of resolutionZone, but excludes prior LIVE IDs and unrelated groups', () => {
    const wrong = setup(SHIORIKO, 3, { groupNames: ['Liella!'] });
    expect(confirm(wrong.session, P1).success).toBe(true);
    expect(getPlayerLiveScoreModifier(wrong.session.state!.liveResolution, P1)).toBe(0);
    const { session } = setup(SHIORIKO, 3);
    expect(session.state!.resolutionZone.cardIds).toEqual([]);
    expect(confirm(session, P1).success).toBe(true);
    expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(1);
  });
  it('does not substitute the controller cheer count for the opponent count', () => {
    const { game, source, cards } = setup(TOMARI, 12);
    const onlyOwn = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: cards.map((c) => c.instanceId),
        secondPlayerCheerCardIds: [],
      },
    };
    const session = sessionFor(start(onlyOwn, source, TOMARI, TriggerCondition.ON_LIVE_SUCCESS));
    expect(confirm(session, P1).success).toBe(true);
    expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(0);
  });
});
