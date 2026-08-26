import { describe, expect, it } from 'vitest';
import {
  BATTLE_UI_ANCHORS,
  getBattleDeckAnchor,
  getBattleEnergyZoneAnchor,
  getBattleHandAnchor,
  getBattleLiveZoneAnchor,
  getBattlePlayerAreaAnchor,
  getBattleStageAnchor,
  getBattleSuccessLiveZoneAnchor,
  getBattleWaitingRoomAnchor,
} from '../../client/src/lib/battleUiAnchors';
import {
  expandTutorialTargetRect,
  intersectTutorialRects,
  placeTutorialCallout,
  translateTutorialRect,
} from '../../client/src/lib/tutorialGuidance';
import {
  canConfirmTutorialMulliganSelection,
  getTutorialScriptAdvanceDelayMs,
  isTutorialEntryBlockedByExistingBattle,
  normalizeTutorialMulliganSelection,
  resolveTutorialMulliganTargetOverride,
  resolveTutorialMulliganUiPolicy,
  shouldPauseTutorialScript,
} from '../../client/src/lib/tutorialBattleUi';
import { resolveTutorialHistoryTransition } from '../../client/src/lib/tutorialNavigation';
import {
  BASIC_LIVE_TUTORIAL,
  BASIC_LIVE_TUTORIAL_CHECKPOINTS,
  BASIC_LIVE_TUTORIAL_OBJECT_ROLES,
} from '../../client/src/tutorial/basicLiveTutorial';
import { GamePhase, SubPhase, ZoneType } from '../../src/shared/types/enums';

describe('battle UI semantic anchors', () => {
  it('keeps every public anchor id unique', () => {
    const anchorIds = Object.values(BATTLE_UI_ANCHORS);
    expect(new Set(anchorIds).size).toBe(anchorIds.length);
  });

  it('maps player-relative tutorial concepts without depending on DOM structure', () => {
    expect(getBattlePlayerAreaAnchor('self')).toBe(BATTLE_UI_ANCHORS.SELF_AREA);
    expect(getBattleHandAnchor('opponent')).toBe(BATTLE_UI_ANCHORS.OPPONENT_HAND);
    expect(getBattleDeckAnchor('self', 'main')).toBe(BATTLE_UI_ANCHORS.SELF_MAIN_DECK);
    expect(getBattleDeckAnchor('opponent', 'energy')).toBe(BATTLE_UI_ANCHORS.OPPONENT_ENERGY_DECK);
    expect(getBattleEnergyZoneAnchor('self')).toBe(BATTLE_UI_ANCHORS.SELF_ENERGY_ZONE);
    expect(getBattleWaitingRoomAnchor('opponent')).toBe(BATTLE_UI_ANCHORS.OPPONENT_WAITING_ROOM);
    expect(getBattleStageAnchor('self', 'center')).toBe(BATTLE_UI_ANCHORS.SELF_STAGE_CENTER);
    expect(getBattleLiveZoneAnchor('opponent')).toBe(BATTLE_UI_ANCHORS.OPPONENT_LIVE_ZONE);
    expect(getBattleSuccessLiveZoneAnchor('self')).toBe(BATTLE_UI_ANCHORS.SELF_SUCCESS_LIVE_ZONE);
  });
});

describe('tutorial battle occupancy', () => {
  it('blocks existing local and remote battles without blocking a tutorial session', () => {
    expect(isTutorialEntryBlockedByExistingBattle(null, false)).toBe(false);
    expect(isTutorialEntryBlockedByExistingBattle(null, true)).toBe(true);
    expect(isTutorialEntryBlockedByExistingBattle('ONLINE', true)).toBe(true);
    expect(isTutorialEntryBlockedByExistingBattle('SOLITAIRE', false)).toBe(true);
    expect(isTutorialEntryBlockedByExistingBattle('TUTORIAL', true)).toBe(false);
  });
});

describe('tutorial browser history', () => {
  it('enters and exits the tutorial when browser history changes the routed page', () => {
    expect(resolveTutorialHistoryTransition('home', 'tutorial')).toBe('ENTER');
    expect(resolveTutorialHistoryTransition('tutorial', 'home')).toBe('EXIT');
    expect(resolveTutorialHistoryTransition('tutorial', 'tutorial')).toBeNull();
    expect(resolveTutorialHistoryTransition('home', 'deck-manager')).toBeNull();
  });
});

describe('tutorial player-facing rules copy', () => {
  it('presents four cumulative chapter starting points with cumulative duration estimates', () => {
    expect(
      BASIC_LIVE_TUTORIAL_CHECKPOINTS.map(({ title, summary, durationLabel }) => ({
        title,
        summary,
        durationLabel,
      }))
    ).toEqual([
      {
        title: '基础规则与首轮 LIVE',
        summary: '从开局准备练到三回合终局',
        durationLabel: '约 10 分钟',
      },
      {
        title: '换手与触发能力',
        summary: '从换手减费与登场能力练到终局',
        durationLabel: '约 8 分钟',
      },
      {
        title: '起动能力与资源循环',
        summary: '从起动回收与剩余能量练到终局',
        durationLabel: '约 6 分钟',
      },
      {
        title: '场攻估算与 LIVE 配置',
        summary: '估算场攻、评估风险并配置制胜 LIVE',
        durationLabel: '约 4 分钟',
      },
    ]);
  });

  it('teaches the formal opening, settlement ties, and next-round first player', () => {
    const opening = BASIC_LIVE_TUTORIAL.steps.find((step) => step.id === 'mulligan-explain');
    const settlement = BASIC_LIVE_TUTORIAL.steps.find((step) => step.id === 'confirm-settlement');

    expect(opening?.body).toContain('6 张起始手牌');
    expect(opening?.body).toContain('3 张初始能量');
    expect(opening?.body).toContain('猜拳的胜者选择先攻或后攻');
    expect(opening?.body).toContain('固定由你先攻');
    expect(settlement?.body).toContain('分数平分');
    expect(settlement?.body).toContain('整局平局');
    expect(settlement?.body).toContain('该方成为下回合先攻');
    expect(settlement?.body).toContain('先攻不变');
  });

  it('uses current terminology and distinguishes estimates from guaranteed Heart', () => {
    const playerFacingCopy = BASIC_LIVE_TUTORIAL.steps
      .flatMap((step) => [step.chapter, step.title, step.body, step.statusText ?? ''])
      .join('\n');
    const phases = BASIC_LIVE_TUTORIAL.steps.find((step) => step.id === 'turn-phases');
    const reveal = BASIC_LIVE_TUTORIAL.steps.find((step) => step.id === 'confirm-effect-live-set');
    const remainingEnergy = BASIC_LIVE_TUTORIAL.steps.find(
      (step) => step.id === 'recovery-energy-window'
    );
    const finalEstimate = BASIC_LIVE_TUTORIAL.steps.find(
      (step) => step.id === 'count-final-stage-hearts'
    );

    expect(playerFacingCopy).not.toContain('声援');
    expect(playerFacingCopy).not.toContain('等待状态');
    expect(playerFacingCopy).not.toContain('自动能力');
    expect(playerFacingCopy).toContain('应援');
    expect(playerFacingCopy).toContain('待机状态');
    expect(playerFacingCopy).toContain('登场能力');
    expect(phases?.title).toContain('通常阶段');
    expect(reveal?.body).toContain('先公开并表演先攻的 LIVE');
    expect(remainingEnergy?.title).toContain('剩余能量可以继续');
    expect(finalEstimate?.title).toContain('只是场攻估算');
    expect(finalEstimate?.body).toContain('不保证每张都有 Heart');
  });
});

describe('tutorial spotlight geometry', () => {
  it('uses only the portion of a target that survives viewport and scroll clipping', () => {
    expect(
      intersectTutorialRects(
        { left: 24, top: 580, width: 120, height: 100 },
        { left: 0, top: 0, width: 390, height: 640 }
      )
    ).toEqual({ left: 24, top: 580, width: 120, height: 60 });
    expect(
      intersectTutorialRects(
        { left: 24, top: 680, width: 120, height: 100 },
        { left: 0, top: 0, width: 390, height: 640 }
      )
    ).toBeNull();
  });

  it('normalizes layout-viewport target coordinates into the visual viewport', () => {
    expect(translateTutorialRect({ left: 72, top: 144, width: 100, height: 80 }, 20, 44)).toEqual({
      left: 52,
      top: 100,
      width: 100,
      height: 80,
    });
  });

  it('expands a target while keeping the spotlight inside the viewport', () => {
    expect(
      expandTutorialTargetRect({ left: 4, top: 6, width: 50, height: 70 }, 12, {
        width: 320,
        height: 640,
      })
    ).toEqual({ left: 0, top: 0, width: 66, height: 88 });
  });

  it('uses the preferred bottom placement when it fits', () => {
    const layout = placeTutorialCallout(
      { left: 400, top: 160, width: 120, height: 80 },
      { width: 320, height: 180 },
      { width: 1280, height: 720 },
      'BOTTOM'
    );

    expect(layout).toEqual({ left: 300, top: 256, placement: 'BOTTOM' });
  });

  it('falls back above a bottom-edge target instead of covering the target', () => {
    const layout = placeTutorialCallout(
      { left: 100, top: 600, width: 100, height: 60 },
      { width: 280, height: 160 },
      { width: 800, height: 700 },
      'BOTTOM'
    );

    expect(layout.placement).toBe('TOP');
    expect(layout.top).toBe(424);
  });

  it('docks targetless information steps above the safe viewport margin', () => {
    const layout = placeTutorialCallout(
      null,
      { width: 360, height: 220 },
      { width: 390, height: 844 }
    );

    expect(layout).toEqual({ left: 15, top: 612, placement: 'BOTTOM' });
  });

  it('clamps an oversized callout on a narrow viewport', () => {
    const layout = placeTutorialCallout(
      { left: 170, top: 300, width: 50, height: 60 },
      { width: 500, height: 180 },
      { width: 390, height: 844 },
      'RIGHT'
    );

    expect(layout.left).toBe(12);
    expect(layout.top).toBeGreaterThanOrEqual(12);
    expect(layout.top).toBeLessThanOrEqual(652);
  });

  it('keeps a secondary mobile target visible when choosing the callout side', () => {
    const sourceCard = { left: 120, top: 660, width: 80, height: 150 };
    const stageTarget = { left: 140, top: 500, width: 110, height: 60 };
    const layout = placeTutorialCallout(
      stageTarget,
      { width: 360, height: 180 },
      { width: 390, height: 844 },
      'BOTTOM',
      [stageTarget, sourceCard]
    );

    expect(layout.placement).toBe('TOP');
    expect(layout.top + 180).toBeLessThan(sourceCard.top);
  });

  it('never sacrifices the actionable primary target to protect a large secondary region', () => {
    const confirmTarget = { left: 1049, top: 620, width: 112, height: 56 };
    const selectionRegion = { left: 279, top: 398, width: 882, height: 223 };
    const handCard = { left: 814, top: 765, width: 103, height: 125 };
    const layout = placeTutorialCallout(
      confirmTarget,
      { width: 360, height: 232 },
      { width: 1440, height: 900 },
      'TOP',
      [confirmTarget, selectionRegion, handCard]
    );

    const overlapWidth = Math.max(
      0,
      Math.min(layout.left + 360, confirmTarget.left + confirmTarget.width) -
        Math.max(layout.left, confirmTarget.left)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(layout.top + 232, confirmTarget.top + confirmTarget.height) -
        Math.max(layout.top, confirmTarget.top)
    );

    expect(overlapWidth * overlapHeight).toBe(0);
  });
});

describe('tutorial mulligan presentation', () => {
  const findStep = (stepId: string) =>
    BASIC_LIVE_TUTORIAL.steps.find((step) => step.id === stepId) ?? null;

  it('keeps the modal out of the introductory board tour', () => {
    expect(resolveTutorialMulliganUiPolicy(findStep('self-hand'), {})).toEqual({
      panelVisible: false,
      selectableCardIds: null,
    });
  });

  it('shows the modal for its explanation without enabling automatic submission', () => {
    expect(resolveTutorialMulliganUiPolicy(findStep('mulligan-explain'), {})).toEqual({
      panelVisible: true,
      selectableCardIds: [],
    });
  });

  it('restricts selection to the guided card while preserving formal confirmation', () => {
    expect(
      resolveTutorialMulliganUiPolicy(findStep('mulligan-card'), {
        'opening-mulligan-card': 'obj_card-mulligan',
      })
    ).toEqual({
      panelVisible: true,
      selectableCardIds: ['card-mulligan'],
    });
  });

  it('fails closed while the guided card binding is unavailable', () => {
    expect(resolveTutorialMulliganUiPolicy(findStep('mulligan-card'), {})).toEqual({
      panelVisible: true,
      selectableCardIds: [],
    });
  });

  it('moves the spotlight to formal confirmation after the guided card is selected', () => {
    const step = findStep('mulligan-card');
    expect(resolveTutorialMulliganTargetOverride(step, [])).toBeUndefined();
    expect(resolveTutorialMulliganTargetOverride(step, ['wrong', 'card-mulligan'])).toBeUndefined();
    expect(resolveTutorialMulliganTargetOverride(step, ['card-mulligan'])).toEqual({
      kind: 'ANCHOR',
      anchor: BATTLE_UI_ANCHORS.MULLIGAN_CONFIRM,
      placement: 'TOP',
    });
  });

  it('clears stale choices and confirms only the exact guided set', () => {
    expect(normalizeTutorialMulliganSelection(['old', 'guided'], ['guided'])).toEqual(['guided']);
    expect(canConfirmTutorialMulliganSelection([], [])).toBe(false);
    expect(canConfirmTutorialMulliganSelection(['old'], ['guided'])).toBe(false);
    expect(canConfirmTutorialMulliganSelection(['guided', 'extra'], ['guided'])).toBe(false);
    expect(canConfirmTutorialMulliganSelection(['guided'], ['guided'])).toBe(true);
    expect(canConfirmTutorialMulliganSelection(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('keeps ordinary mulligan confirmation independent from tutorial whitelists', () => {
    expect(canConfirmTutorialMulliganSelection([], null)).toBe(false);
    expect(canConfirmTutorialMulliganSelection(['any-card'], null)).toBe(true);
  });
});

describe('tutorial script pacing', () => {
  it('leaves a longer settle window between player and opponent mulligan', () => {
    expect(
      getTutorialScriptAdvanceDelayMs(
        {
          phase: GamePhase.MULLIGAN_PHASE,
          subPhase: SubPhase.MULLIGAN_SECOND_PLAYER,
        },
        false
      )
    ).toBe(1_500);
  });

  it('keeps reduced motion paced while shortening visual waits', () => {
    expect(
      getTutorialScriptAdvanceDelayMs(
        {
          phase: GamePhase.MULLIGAN_PHASE,
          subPhase: SubPhase.MULLIGAN_SECOND_PLAYER,
        },
        true
      )
    ).toBe(650);
    expect(
      getTutorialScriptAdvanceDelayMs(
        { phase: GamePhase.MAIN_PHASE, subPhase: SubPhase.NONE },
        true
      )
    ).toBe(300);
  });

  it('holds scripted actions while an authoritative observation dwell is readable', () => {
    const step = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'observe-opponent-second-performance'
    );

    expect(shouldPauseTutorialScript(step, undefined)).toBe(false);
    expect(shouldPauseTutorialScript(step, 20_000)).toBe(true);
  });
});

describe('tutorial judgment walkthrough', () => {
  it('keeps the relay destination primary and the fee-9 hand card secondary', () => {
    const step = BASIC_LIVE_TUTORIAL.steps.find((candidate) => candidate.id === 'relay-to-center');

    expect(step).toMatchObject({
      kind: 'ACTION',
      target: { kind: 'ANCHOR', anchor: BATTLE_UI_ANCHORS.SELF_STAGE_CENTER },
      secondaryTargets: [
        {
          kind: 'OBJECT_ROLE',
          role: BASIC_LIVE_TUTORIAL_OBJECT_ROLES.RELAY_MEMBER,
        },
      ],
    });
  });

  it('keeps relay-effect card selection primary while leaving confirmation visible', () => {
    const step = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'resolve-relay-discard'
    );

    expect(step).toMatchObject({
      kind: 'ACTION',
      target: { kind: 'ANCHOR', anchor: BATTLE_UI_ANCHORS.ACTIVE_EFFECT_SELECTION },
      secondaryTargets: [
        { kind: 'ANCHOR', anchor: BATTLE_UI_ANCHORS.ACTIVE_EFFECT_CONFIRM },
        {
          kind: 'OBJECT_ROLE',
          role: BASIC_LIVE_TUTORIAL_OBJECT_ROLES.EFFECT_LIVE_CARD,
        },
      ],
    });
  });

  it('targets the selection grid for the auto-submitted LIVE-start discard', () => {
    const step = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'resolve-live-start-discard'
    );

    expect(step).toMatchObject({
      kind: 'ACTION',
      target: { kind: 'ANCHOR', anchor: BATTLE_UI_ANCHORS.ACTIVE_EFFECT_SELECTION },
    });
  });

  it('keeps the LIVE-start continue action on an anchor that exists before judgment', () => {
    const step = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'live-start-effect-resolved'
    );

    expect(step).toMatchObject({
      kind: 'INFO',
      pauseScript: true,
      target: { kind: 'ANCHOR', anchor: BATTLE_UI_ANCHORS.PHASE_CONTROLS },
      completion: { kind: 'INFO_CONTINUE' },
    });
  });

  it('keeps the scripted opponent active in the second and third rounds', () => {
    const secondMember = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'opponent-second-turn'
    );
    const secondLive = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'opponent-second-live-set'
    );
    const secondPerformance = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'observe-opponent-second-performance'
    );
    const thirdMember = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'opponent-third-turn'
    );
    const finalLive = BASIC_LIVE_TUTORIAL.steps.find(
      (candidate) => candidate.id === 'opponent-final-live-set'
    );

    expect(secondMember).toMatchObject({
      kind: 'OBSERVE',
      completionDwellMs: 1_200,
      target: { anchor: BATTLE_UI_ANCHORS.OPPONENT_STAGE_LEFT },
    });
    expect(secondLive).toMatchObject({
      kind: 'OBSERVE',
      target: { anchor: BATTLE_UI_ANCHORS.OPPONENT_LIVE_ZONE },
    });
    expect(secondLive?.completion.kind).toBe('VIEW_STATE');
    if (secondLive?.completion.kind !== 'VIEW_STATE') throw new Error('missing second LIVE view');
    expect(secondLive.completion.condition.kind).toBe('ALL');
    if (secondLive.completion.condition.kind !== 'ALL')
      throw new Error('missing second LIVE count');
    expect(secondLive.completion.condition.conditions).toContainEqual({
      kind: 'ZONE_CARD_COUNT',
      seat: 'OPPONENT',
      zone: ZoneType.LIVE_ZONE,
      minimumCount: 1,
    });
    expect(secondPerformance).toMatchObject({
      kind: 'OBSERVE',
      completionDwellMs: 1_200,
      target: { anchor: BATTLE_UI_ANCHORS.OPPONENT_LIVE_ZONE },
    });
    expect(thirdMember).toMatchObject({
      kind: 'OBSERVE',
      completionDwellMs: 1_200,
      target: { anchor: BATTLE_UI_ANCHORS.OPPONENT_STAGE_RIGHT },
    });
    expect(finalLive).toMatchObject({
      kind: 'OBSERVE',
      completionDwellMs: 1_200,
      target: { anchor: BATTLE_UI_ANCHORS.OPPONENT_LIVE_ZONE },
    });
    expect(finalLive?.completion.kind).toBe('VIEW_STATE');
    if (finalLive?.completion.kind !== 'VIEW_STATE') throw new Error('missing final LIVE view');
    expect(finalLive.completion.condition.kind).toBe('ALL');
    if (finalLive.completion.condition.kind !== 'ALL') throw new Error('missing final LIVE count');
    expect(finalLive.completion.condition.conditions).toContainEqual({
      kind: 'ZONE_CARD_COUNT',
      seat: 'OPPONENT',
      zone: ZoneType.LIVE_ZONE,
      minimumCount: 1,
    });
  });

  it('teaches card origin and summary reading before the formal judgment action', () => {
    const sourceIndex = BASIC_LIVE_TUTORIAL.steps.findIndex(
      (step) => step.id === 'judgment-card-source'
    );
    const summaryIndex = BASIC_LIVE_TUTORIAL.steps.findIndex(
      (step) => step.id === 'read-judgment-summary'
    );
    const actionIndex = BASIC_LIVE_TUTORIAL.steps.findIndex(
      (step) => step.id === 'accept-automatic-judgment'
    );

    expect([sourceIndex, summaryIndex, actionIndex]).toEqual([
      actionIndex - 2,
      actionIndex - 1,
      actionIndex,
    ]);
    expect(BASIC_LIVE_TUTORIAL.steps[sourceIndex]).toMatchObject({
      kind: 'INFO',
      target: { anchor: BATTLE_UI_ANCHORS.JUDGMENT_CHEER_CARDS },
    });
    expect(BASIC_LIVE_TUTORIAL.steps[sourceIndex]?.body).toContain('主卡组顶');
    expect(BASIC_LIVE_TUTORIAL.steps[sourceIndex]?.body).toContain('BLADE HEART');
    expect(BASIC_LIVE_TUTORIAL.steps[summaryIndex]).toMatchObject({
      kind: 'INFO',
      target: { anchor: BATTLE_UI_ANCHORS.JUDGMENT_SUMMARY },
    });
    expect(BASIC_LIVE_TUTORIAL.steps[actionIndex]?.kind).toBe('ACTION');
  });

  it('pauses after the opponent reveals a member and teaches why its LIVE is skipped', () => {
    const judgmentIndex = BASIC_LIVE_TUTORIAL.steps.findIndex(
      (step) => step.id === 'accept-automatic-judgment'
    );
    const explanationIndex = BASIC_LIVE_TUTORIAL.steps.findIndex(
      (step) => step.id === 'opponent-member-skips-live'
    );
    const waitIndex = BASIC_LIVE_TUTORIAL.steps.findIndex((step) => step.id === 'wait-score');
    const scoreIndex = BASIC_LIVE_TUTORIAL.steps.findIndex((step) => step.id === 'confirm-score');

    expect([judgmentIndex, explanationIndex, waitIndex, scoreIndex]).toEqual([
      explanationIndex - 1,
      explanationIndex,
      explanationIndex + 1,
      explanationIndex + 2,
    ]);
    expect(BASIC_LIVE_TUTORIAL.steps[explanationIndex]).toMatchObject({
      kind: 'INFO',
      pauseScript: true,
      target: { anchor: BATTLE_UI_ANCHORS.PHASE_CONTROLS },
    });
    expect(BASIC_LIVE_TUTORIAL.steps[explanationIndex]?.body).toContain('放置入休息室');
    expect(BASIC_LIVE_TUTORIAL.steps[explanationIndex]?.body).toContain('跳过 LIVE');
  });
});
