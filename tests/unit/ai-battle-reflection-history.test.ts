import { describe, expect, it } from 'vitest';
import {
  AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION,
  createAiBattleReflectionDocumentDownload,
  createAiBattleReflectionHistoryRuntime,
  type AiBattleReflectionHistoryEntry,
  type AiBattleReflectionHistoryRuntime,
} from '../../src/server/ai-battle/reflection-history';
import { createAiSystemParticipantBinding } from '../../src/server/ai-battle/system-participant';

describe('AI battle reflection history', () => {
  it('creates a versioned runtime for every AI match', () => {
    expect(createAiBattleReflectionHistoryRuntime()).toEqual({
      schemaVersion: AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION,
      nextSeq: 1,
      droppedEntryCount: 0,
      entries: [],
    });
  });

  it('renders an in-progress Markdown snapshot with selected choices and safe fallback plans', () => {
    const selectedChoice = {
      choiceKind: 'ACTION',
      choiceId: 'action-1',
      description: '结束主要阶段',
      details: ['结束后进入 LIVE 设置阶段。'],
    } as const;
    const runtime: AiBattleReflectionHistoryRuntime = {
      schemaVersion: AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION,
      nextSeq: 2,
      droppedEntryCount: 0,
      entries: [
        {
          seq: 1,
          createdAt: 20_000,
          turnCount: 2,
          phase: 'MAIN_PHASE',
          subPhase: 'FREE_ACTION',
          decisionKind: 'MAIN_PHASE',
          authorityRevisionBefore: 8,
          authorityRevisionAfter: 9,
          source: 'RULE',
          tier: 'RULE_FORCED',
          reasonCode: 'CONFIRM_PHASE_PROGRESS',
          currentState: {
            summary: '第 2 回合，主要阶段。',
            facts: ['我方有 3 张活跃能量。'],
          },
          currentDecision: {
            instruction: '选择当前合法行动。',
            facts: ['只处理当前窗口。'],
            choices: [selectedChoice],
          },
          strategicObjectives: [
            {
              objectiveId: 'objective-maintain-live-access',
              priority: 'HIGH',
              summary: '保留至少一张 LIVE 卡。',
              evidence: ['当前手牌有 1 张 LIVE 卡。'],
            },
          ],
          reviewSnapshot: {
            selfHandLiveCount: 1,
            selfLiveZoneCount: 0,
            selfSuccessLiveCount: 0,
            selfStageMemberCount: 1,
            selfActiveEnergyCount: 3,
            selectedActionKind: 'END_MAIN_PHASE',
            selectedEnergyCost: null,
            minimumComparableEnergyCost: null,
            selectedStageMemberDelta: null,
            visibleMulliganLiveCount: 0,
            selectedMulliganLiveCount: 0,
            availableEffectCandidateCount: 0,
            selectedEffectCandidateCount: 0,
          },
          decisionSummary: '确认当前阶段结束。',
          tradeoff: null,
          nextPlan: null,
          selectionSummary: '选择主要阶段行动',
          selectedChoices: [selectedChoice],
          model: null,
          executionStatus: 'ACCEPTED',
        },
      ],
    };

    const download = createAiBattleReflectionDocumentDownload(runtime, {
      matchId: 'match/../../unsafe',
      startedAt: 10_000,
      generatedAt: 30_000,
      status: 'IN_PROGRESS',
      currentTurnCount: 2,
      aiSeat: 'SECOND',
      humanSeat: 'FIRST',
      aiDeckKey: 'MUSE_STARTER',
      humanDeckKey: 'GREEN_HASUNOSORA_B6',
      endReason: null,
      winnerSeat: null,
      systemBinding: createAiSystemParticipantBinding('MUSE_STARTER'),
    });

    expect(download).toMatchObject({
      schemaVersion: 'ai-battle.reflection-document-download/v2',
      mediaType: 'text/markdown;charset=utf-8',
      decisionCount: 1,
    });
    expect(download.filename).not.toContain('/');
    expect(download.content).toContain('## 第 2 回合');
    expect(download.content).toContain('## 自动复盘摘要');
    expect(download.content).toContain('## 决策速览');
    expect(download.content).toContain('**[最终选择]** 结束主要阶段');
    expect(download.content).toContain('结构化战略目标：高：保留至少一张 LIVE 卡。');
    expect(download.content).toContain('当前窗口是规则强制步骤，不存在额外战术取舍。');
    expect(download.content).toContain('权威执行后重新观察下一决策窗口，并按新局面制定后续计划。');
    expect(download.content).toContain('进行中（中途快照）');
  });

  it('summarizes all-LIVE mulligans, unsupported plans, and consecutive empty LIVE turns', () => {
    const reviewSnapshot = {
      selfHandLiveCount: 0,
      selfLiveZoneCount: 0,
      selfSuccessLiveCount: 0,
      selfStageMemberCount: 1,
      selfActiveEnergyCount: 1,
      selectedActionKind: 'CONFIRM_LIVE_SET',
      selectedEnergyCost: null,
      minimumComparableEnergyCost: null,
      selectedStageMemberDelta: null,
      visibleMulliganLiveCount: 0,
      selectedMulliganLiveCount: 0,
      availableEffectCandidateCount: 0,
      selectedEffectCandidateCount: 0,
    } as const;
    const baseEntry: AiBattleReflectionHistoryEntry = {
      seq: 1,
      createdAt: 20_000,
      turnCount: 1,
      phase: 'MULLIGAN_PHASE',
      subPhase: 'MULLIGAN_FIRST_PLAYER',
      decisionKind: 'MULLIGAN',
      authorityRevisionBefore: 1,
      authorityRevisionAfter: 2,
      source: 'MODEL',
      tier: 'HEURISTIC',
      reasonCode: 'MODEL_STRUCTURED_SELECTION',
      currentState: { summary: '第 1 回合。', facts: [] },
      currentDecision: { instruction: '选择换牌。', facts: [], choices: [] },
      strategicObjectives: [],
      reviewSnapshot: {
        ...reviewSnapshot,
        selfHandLiveCount: 2,
        selectedActionKind: null,
        visibleMulliganLiveCount: 2,
        selectedMulliganLiveCount: 2,
      },
      decisionSummary: '换掉两张 LIVE。',
      tradeoff: null,
      nextPlan: null,
      selectionSummary: '换牌 2 张',
      selectedChoices: [],
      model: null,
      executionStatus: 'ACCEPTED',
    };
    const entries: AiBattleReflectionHistoryEntry[] = [
      baseEntry,
      {
        ...baseEntry,
        seq: 2,
        createdAt: 21_000,
        phase: 'LIVE_SET_PHASE',
        subPhase: 'LIVE_SET_FIRST_PLAYER',
        decisionKind: 'LIVE_SET',
        authorityRevisionBefore: 2,
        authorityRevisionAfter: 3,
        source: 'RULE',
        tier: 'DETERMINISTIC',
        reasonCode: 'CONFIRM_LIVE_SET',
        reviewSnapshot,
        decisionSummary: '确认 LIVE 设置。',
        nextPlan: '下一回合继续尝试 LIVE 演出。',
        selectionSummary: '确认本次 LIVE 放置',
      },
      {
        ...baseEntry,
        seq: 3,
        createdAt: 22_000,
        turnCount: 2,
        phase: 'LIVE_SET_PHASE',
        subPhase: 'LIVE_SET_FIRST_PLAYER',
        decisionKind: 'LIVE_SET',
        authorityRevisionBefore: 3,
        authorityRevisionAfter: 4,
        source: 'RULE',
        tier: 'DETERMINISTIC',
        reasonCode: 'CONFIRM_LIVE_SET',
        reviewSnapshot,
        decisionSummary: '再次确认 LIVE 设置。',
        selectionSummary: '确认本次 LIVE 放置',
      },
    ];
    const runtime: AiBattleReflectionHistoryRuntime = {
      schemaVersion: AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION,
      nextSeq: 4,
      droppedEntryCount: 0,
      entries,
    };

    const content = createAiBattleReflectionDocumentDownload(runtime, {
      matchId: 'review-signals',
      startedAt: 10_000,
      generatedAt: 30_000,
      status: 'IN_PROGRESS',
      currentTurnCount: 2,
      aiSeat: 'FIRST',
      humanSeat: 'SECOND',
      aiDeckKey: 'MUSE_STARTER',
      humanDeckKey: 'GREEN_HASUNOSORA_B6',
      endReason: null,
      winnerSeat: null,
      systemBinding: createAiSystemParticipantBinding('MUSE_STARTER'),
    }).content;

    expect(content).toContain('高 · 关键失误');
    expect(content).toContain('可见的全部 LIVE 卡换回卡组');
    expect(content).toContain('高 · 连续无 LIVE');
    expect(content).toContain('第 1、2 回合连续');
    expect(content).toContain('中 · 无效计划');
  });
});
