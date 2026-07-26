import { describe, expect, it } from 'vitest';
import { isJudgmentPanelAvailable } from '../../client/src/lib/judgmentPanelAvailability';
import { GamePhase, SubPhase } from '../../src/shared/types/enums';

describe('judgment panel availability', () => {
  it.each([
    [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_LIVE_START_EFFECTS],
    [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_JUDGMENT],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SCORE_CONFIRM],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_ANIMATION],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SETTLEMENT],
  ])('在 %s / %s 中允许查看本次 Live 判定区', (phase, subPhase) => {
    expect(isJudgmentPanelAvailable(phase, subPhase)).toBe(true);
  });

  it.each([
    [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_REVEAL],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_TURN_END],
    [GamePhase.MAIN_PHASE, SubPhase.NONE],
  ])('在 %s / %s 中不保留本次 Live 判定区', (phase, subPhase) => {
    expect(isJudgmentPanelAvailable(phase, subPhase)).toBe(false);
  });

  it('视图尚未初始化阶段时不显示判定区', () => {
    expect(isJudgmentPanelAvailable(null, SubPhase.NONE)).toBe(false);
  });
});
