import type { AiDecisionSelection } from '../../application/ai-decisions/index.js';
import type { Seat } from '../../online/index.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import { getBaseCardCode } from '../../shared/utils/card-code.js';
import { summarizeAiDecisionSelection, summarizeAiModelInvocation } from './debug-trace.js';
import type { AiModelInvocationAudit } from './model-governance.js';
import { buildAiSemanticDecisionContext } from './semantic-context.js';
import type { AuditableAiDecisionResult } from './strategy-decision-audit.js';
import type { AiStrategyContext } from './strategy-context.js';
import type { AiSystemParticipantBinding } from './system-participant.js';

export const AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.audit.reflectionHistory;
export const AI_BATTLE_REFLECTION_DOCUMENT_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.audit.reflectionDocument;
export const AI_BATTLE_REFLECTION_DOCUMENT_DOWNLOAD_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.audit.reflectionDocumentDownload;

/**
 * A normal match should stay well below this boundary. The bound prevents an
 * abnormal decision loop from growing the process indefinitely and is always
 * disclosed in the exported document if reached.
 */
export const AI_BATTLE_REFLECTION_HISTORY_MAX_ENTRIES = 1_024;

export type AiBattleReflectionDecisionSource = 'RULE' | 'MODEL' | 'CONSERVATIVE_FALLBACK';
export type AiBattleReflectionExecutionStatus = 'ACCEPTED' | 'REJECTED' | 'STALE';

export interface AiBattleReflectionChoice {
  readonly choiceKind: string;
  readonly choiceId: string;
  readonly description: string;
  readonly details: readonly string[];
}

export interface AiBattleReflectionReviewSnapshot {
  readonly selfHandLiveCount: number;
  readonly selfLiveZoneCount: number;
  readonly selfSuccessLiveCount: number;
  readonly selfStageMemberCount: number;
  readonly selfActiveEnergyCount: number;
  readonly selectedActionKind: string | null;
  readonly selectedEnergyCost: number | null;
  readonly minimumComparableEnergyCost: number | null;
  readonly selectedStageMemberDelta: number | null;
  readonly visibleMulliganLiveCount: number;
  readonly selectedMulliganLiveCount: number;
  readonly availableEffectCandidateCount: number;
  readonly selectedEffectCandidateCount: number;
}

export interface AiBattleReflectionHistoryEntry {
  readonly seq: number;
  readonly createdAt: number;
  readonly turnCount: number;
  readonly phase: string;
  readonly subPhase: string;
  readonly decisionKind: string;
  readonly authorityRevisionBefore: number;
  readonly authorityRevisionAfter: number;
  readonly source: AiBattleReflectionDecisionSource;
  readonly tier: string;
  readonly reasonCode: string;
  readonly currentState: {
    readonly summary: string;
    readonly facts: readonly string[];
  };
  readonly currentDecision: {
    readonly instruction: string;
    readonly facts: readonly string[];
    readonly choices: readonly AiBattleReflectionChoice[];
  };
  readonly strategicObjectives: readonly {
    readonly objectiveId: string;
    readonly priority: 'HIGH' | 'MEDIUM';
    readonly summary: string;
    readonly evidence: readonly string[];
  }[];
  readonly reviewSnapshot: AiBattleReflectionReviewSnapshot;
  readonly decisionSummary: string;
  /** Explicit short explanation supplied by the policy/model, never private chain-of-thought. */
  readonly tradeoff: string | null;
  /** Explicit next-step intent supplied by the policy/model. */
  readonly nextPlan: string | null;
  readonly selectionSummary: string;
  readonly selectedChoices: readonly AiBattleReflectionChoice[];
  readonly model: ReturnType<typeof summarizeAiModelInvocation>;
  readonly executionStatus: AiBattleReflectionExecutionStatus;
}

export interface AiBattleReflectionHistoryRuntime {
  readonly schemaVersion: typeof AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION;
  nextSeq: number;
  droppedEntryCount: number;
  readonly entries: AiBattleReflectionHistoryEntry[];
}

export interface AiBattleReflectionDocumentMetadata {
  readonly matchId: string;
  readonly startedAt: number;
  readonly generatedAt: number;
  readonly status: 'IN_PROGRESS' | 'COMPLETED';
  readonly currentTurnCount: number;
  readonly aiSeat: Seat;
  readonly humanSeat: Seat;
  readonly aiDeckKey: string;
  readonly humanDeckKey: string;
  readonly endReason: string | null;
  readonly winnerSeat: Seat | null;
  readonly systemBinding: AiSystemParticipantBinding;
}

export interface AiBattleReflectionDocumentDownload {
  readonly schemaVersion: typeof AI_BATTLE_REFLECTION_DOCUMENT_DOWNLOAD_SCHEMA_VERSION;
  readonly filename: string;
  readonly mediaType: 'text/markdown;charset=utf-8';
  readonly generatedAt: number;
  readonly decisionCount: number;
  readonly content: string;
}

export function createAiBattleReflectionHistoryRuntime(): AiBattleReflectionHistoryRuntime {
  return {
    schemaVersion: AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION,
    nextSeq: 1,
    droppedEntryCount: 0,
    entries: [],
  };
}

export function appendAiBattleReflectionHistoryEntry(
  runtime: AiBattleReflectionHistoryRuntime,
  input: {
    readonly createdAt: number;
    readonly context: AiStrategyContext;
    readonly result: AuditableAiDecisionResult;
    readonly modelInvocation: AiModelInvocationAudit | null;
    readonly source: AiBattleReflectionDecisionSource;
    readonly authorityRevisionAfter: number;
    readonly executionStatus: AiBattleReflectionExecutionStatus;
  }
): AiBattleReflectionHistoryEntry {
  const semanticContext = buildAiSemanticDecisionContext({
    observation: input.context.observation,
    strategicObjectives: input.context.strategicObjectives,
    selectedHistory: input.context.selectedHistory,
  });
  const selectionSummary = summarizeAiDecisionSelection(input.result.selection);
  const entry: AiBattleReflectionHistoryEntry = {
    seq: runtime.nextSeq,
    createdAt: input.createdAt,
    turnCount: input.context.observation.turn.count,
    phase: input.context.observation.turn.phase,
    subPhase: input.context.observation.turn.subPhase,
    decisionKind: input.context.observation.decision.kind,
    authorityRevisionBefore: input.context.observation.authorityRevision,
    authorityRevisionAfter: input.authorityRevisionAfter,
    source: input.source,
    tier: input.result.tier,
    reasonCode: input.result.reasonCode,
    currentState: {
      summary: semanticContext.currentState.summary,
      facts: semanticContext.currentState.facts.map((fact) => fact.text),
    },
    currentDecision: {
      instruction: semanticContext.currentDecision.instruction,
      facts: semanticContext.currentDecision.facts.map((fact) => fact.text),
      choices: semanticContext.currentDecision.choices.map(toReflectionChoice),
    },
    strategicObjectives: semanticContext.strategicObjectives.map((objective) => ({
      objectiveId: objective.objectiveId,
      priority: objective.priority,
      summary: objective.summary,
      evidence: objective.facts.map((fact) => fact.text),
    })),
    reviewSnapshot: buildReflectionReviewSnapshot(input.context, input.result.selection),
    decisionSummary: input.result.summary,
    tradeoff: input.result.tradeoff ?? null,
    nextPlan: input.result.nextPlan ?? null,
    selectionSummary: selectionSummary.label,
    selectedChoices: resolveSelectedChoices(
      semanticContext.currentDecision.choices.map(toReflectionChoice),
      input.result.selection
    ),
    model: summarizeAiModelInvocation(input.modelInvocation),
    executionStatus: input.executionStatus,
  };
  runtime.nextSeq += 1;
  runtime.entries.push(entry);
  if (runtime.entries.length > AI_BATTLE_REFLECTION_HISTORY_MAX_ENTRIES) {
    const overflow = runtime.entries.length - AI_BATTLE_REFLECTION_HISTORY_MAX_ENTRIES;
    runtime.entries.splice(0, overflow);
    runtime.droppedEntryCount += overflow;
  }
  return cloneEntry(entry);
}

export function createAiBattleReflectionDocumentDownload(
  runtime: AiBattleReflectionHistoryRuntime,
  metadata: AiBattleReflectionDocumentMetadata
): AiBattleReflectionDocumentDownload {
  const generatedDate = new Date(metadata.generatedAt);
  const datePart = Number.isNaN(generatedDate.getTime())
    ? String(metadata.generatedAt)
    : generatedDate.toISOString().replace(/[:.]/gu, '-');
  return {
    schemaVersion: AI_BATTLE_REFLECTION_DOCUMENT_DOWNLOAD_SCHEMA_VERSION,
    filename: `loveca-ai-battle-${sanitizeFilenameSegment(metadata.matchId)}-${datePart}.md`,
    mediaType: 'text/markdown;charset=utf-8',
    generatedAt: metadata.generatedAt,
    decisionCount: runtime.entries.length,
    content: renderAiBattleReflectionMarkdown(runtime, metadata),
  };
}

export function renderAiBattleReflectionMarkdown(
  runtime: AiBattleReflectionHistoryRuntime,
  metadata: AiBattleReflectionDocumentMetadata
): string {
  const lines: string[] = [
    '# Loveca AI 对战反思历史',
    '',
    '> 本文档记录 AI 的可审计决策摘要，不包含模型私有思维链、完整提示词、原始供应商响应、聊天内容或凭据。',
    '',
    `- 文档版本：${AI_BATTLE_REFLECTION_DOCUMENT_SCHEMA_VERSION}`,
    `- 对局内部标识：${inline(metadata.matchId)}`,
    `- 开始时间：${formatTimestamp(metadata.startedAt)}`,
    `- 导出时间：${formatTimestamp(metadata.generatedAt)}`,
    `- 导出时状态：${metadata.status === 'COMPLETED' ? '已结束' : '进行中（中途快照）'}`,
    `- 当前回合：${String(metadata.currentTurnCount)}`,
    `- AI 席位 / 卡组：${seatLabel(metadata.aiSeat)} / ${inline(metadata.aiDeckKey)}`,
    `- 真人席位 / 卡组：${seatLabel(metadata.humanSeat)} / ${inline(metadata.humanDeckKey)}`,
    `- 模型：${inline(metadata.systemBinding.modelId)}`,
    `- 策略 / Prompt / 规则版本：${inline(metadata.systemBinding.policyVersion)} / ${inline(metadata.systemBinding.modelSystemPromptVersion)} / ${inline(metadata.systemBinding.compactRulesVersion)}`,
    `- 已记录 AI 决策：${String(runtime.entries.length)} 次`,
  ];

  if (metadata.status === 'COMPLETED') {
    lines.push(
      `- 结束原因：${escapeMarkdown(metadata.endReason ?? '未知')}`,
      `- 获胜席位：${metadata.winnerSeat ? seatLabel(metadata.winnerSeat) : '无 / 平局'}`
    );
  }
  if (runtime.droppedEntryCount > 0) {
    lines.push(`- 截断提示：异常长对局已丢弃最早 ${String(runtime.droppedEntryCount)} 条决策记录`);
  }

  lines.push('', '## 自动复盘摘要', '');
  appendAutomaticReviewSummary(lines, runtime.entries);

  if (runtime.entries.length > 0) {
    lines.push('', '## 决策速览', '');
    lines.push(
      '| 决策 | 回合 / 阶段 | 来源 | 最终选择 | 结果 |',
      '| --- | --- | --- | --- | --- |'
    );
    for (const entry of runtime.entries) {
      lines.push(
        `| ${String(entry.seq)} | ${String(entry.turnCount)} / ${escapeTableCell(decisionKindLabel(entry.decisionKind))} | ${escapeTableCell(sourceLabel(entry.source))} | ${escapeTableCell(formatSelectedChoices(entry))} | ${escapeTableCell(executionStatusLabel(entry.executionStatus))} |`
      );
    }
  }

  lines.push('', '## 使用说明', '');
  lines.push(
    '- “自动复盘摘要”只使用当时 AI 可见局面、结构化合法选择和权威执行结果生成；它是调试信号，不替代规则裁定或人工复盘。',
    '- “结构化战略目标”由服务端从可见局面派生并跨决策窗口保留，不采信模型自由文本中的计划。',
    '- “取舍说明”和“后续计划”是模型或确定性策略显式交付的短摘要，可供 agent 复盘；它们不是隐藏思维过程。',
    '- “当前合法选择”来自当时 AI 席位可见的脱敏投影视图；文档不会补回隐藏卡牌或权威内部对象 ID。',
    '- `REJECTED` / `STALE` 条目表示提交未成为权威结果，保留它们是为了定位无效选择或并发窗口变化。'
  );

  if (runtime.entries.length === 0) {
    lines.push('', '## 决策记录', '', '导出时 AI 尚未完成任何决策。', '');
    return lines.join('\n');
  }

  lines.push('', '## 完整审计附录', '');
  let activeTurn: number | null = null;
  for (const entry of runtime.entries) {
    if (entry.turnCount !== activeTurn) {
      activeTurn = entry.turnCount;
      lines.push('', `## 第 ${String(entry.turnCount)} 回合`, '');
    }
    lines.push(
      `### 决策 ${String(entry.seq)} · ${escapeMarkdown(decisionKindLabel(entry.decisionKind))}`,
      '',
      `- 时间：${formatTimestamp(entry.createdAt)}`,
      `- 阶段：${inline(entry.phase)} / ${inline(entry.subPhase)}`,
      `- 决策来源：${sourceLabel(entry.source)}（${inline(entry.tier)} / ${inline(entry.reasonCode)}）`,
      `- 权威版本：${String(entry.authorityRevisionBefore)} → ${String(entry.authorityRevisionAfter)}`,
      `- 执行结果：${executionStatusLabel(entry.executionStatus)}`,
      '',
      '#### 当前局面',
      '',
      escapeMarkdown(entry.currentState.summary),
      ''
    );
    appendBulletList(lines, entry.currentState.facts);
    lines.push('', '#### 当前合法决定', '', escapeMarkdown(entry.currentDecision.instruction), '');
    appendBulletList(lines, entry.currentDecision.facts);
    lines.push('', '合法选择：', '');
    if (entry.currentDecision.choices.length === 0) {
      lines.push('- 无可枚举选择');
    } else {
      for (const choice of entry.currentDecision.choices) {
        const selected = entry.selectedChoices.some(
          (candidate) =>
            candidate.choiceKind === choice.choiceKind && candidate.choiceId === choice.choiceId
        );
        lines.push(`- ${selected ? '**[最终选择]** ' : ''}${escapeMarkdown(choice.description)}`);
        for (const detail of choice.details) lines.push(`  - ${escapeMarkdown(detail)}`);
      }
    }
    lines.push(
      '',
      '#### AI 可审计思考与计划',
      '',
      `- 决策摘要：${escapeMarkdown(entry.decisionSummary)}`,
      `- 结构化战略目标：${escapeMarkdown(formatStrategicObjectives(entry))}`,
      `- 取舍说明：${escapeMarkdown(formatTradeoff(entry))}`,
      `- 后续计划：${escapeMarkdown(formatNextPlan(entry))}`,
      `- 最终选择：${escapeMarkdown(formatSelectedChoices(entry))}`
    );
    if (entry.model) {
      lines.push(
        `- 模型调用：${inline(entry.model.modelId)}；${String(entry.model.attemptCount)} 次尝试；输入 ${String(entry.model.inputTokens)} / 输出 ${String(entry.model.outputTokens)} tokens；耗时 ${String(entry.model.totalLatencyMs)} ms`
      );
    } else {
      lines.push('- 模型调用：无（由规则或确定性策略直接完成）');
    }
  }
  lines.push('');
  return lines.join('\n');
}

function toReflectionChoice(
  choice: ReturnType<typeof buildAiSemanticDecisionContext>['currentDecision']['choices'][number]
): AiBattleReflectionChoice {
  return {
    choiceKind: choice.referenceType,
    choiceId: choice.referenceId,
    description: choice.title,
    details: choice.facts.map((fact) => fact.text),
  };
}

function resolveSelectedChoices(
  choices: readonly AiBattleReflectionChoice[],
  selection: AiDecisionSelection
): readonly AiBattleReflectionChoice[] {
  const references: readonly [string, string][] = (() => {
    switch (selection.kind) {
      case 'MULLIGAN':
      case 'PAY_COST':
      case 'CONFIRM_SPECIAL_MEMBER_PLAY':
      case 'SELECT_EFFECT_CARDS':
        return selection.candidateIds.length > 0
          ? selection.candidateIds.map((id) => ['CANDIDATE', id])
          : [
              [
                'SELECTION',
                selection.kind === 'MULLIGAN' ? 'MULLIGAN_KEEP_ALL' : 'SKIP_EFFECT_CARDS',
              ],
            ];
      case 'SELECT_SUCCESS_LIVE':
        return [['CANDIDATE', selection.candidateId]];
      case 'SELECT_MAIN_PHASE_ACTION':
      case 'SELECT_LIVE_SET_ACTION':
        return [['ACTION', selection.actionId]];
      case 'SELECT_EFFECT_OPTIONS':
        return selection.optionIds.length > 0
          ? selection.optionIds.map((id) => ['OPTION', id])
          : [['SELECTION', 'SKIP_EFFECT_OPTIONS']];
      case 'SELECT_EFFECT_SLOT':
        return [['SLOT', selection.slot]];
      case 'SET_STAGE_FORMATION':
        return selection.placements.map((placement) => [
          'PLACEMENT',
          `${placement.candidateId}@${placement.toSlot}`,
        ]);
      case 'SELECT_EFFECT_NUMBER':
        return [['SELECTION', 'SELECT_EFFECT_NUMBER']];
      default:
        return [['SELECTION', selection.kind]];
    }
  })();
  return references.flatMap(([choiceKind, choiceId]) => {
    const found = choices.find(
      (choice) => choice.choiceKind === choiceKind && choice.choiceId === choiceId
    );
    return found ? [found] : [];
  });
}

function buildReflectionReviewSnapshot(
  context: AiStrategyContext,
  selection: AiDecisionSelection
): AiBattleReflectionReviewSnapshot {
  const observation = context.observation;
  const self = observation.seats[observation.viewerSeat];
  const hand = self.zones.find((zone) => zone.zoneKey === 'HAND');
  const liveZone = self.zones.find((zone) => zone.zoneKey === 'LIVE');
  const energy = self.zones.find((zone) => zone.zoneKey === 'ENERGY');
  const selfStageMemberCount = self.zones
    .filter((zone) => zone.zoneKey.startsWith('MEMBER_'))
    .reduce((count, zone) => count + (zone.count > 0 ? 1 : 0), 0);
  const selectedActionId =
    selection.kind === 'SELECT_MAIN_PHASE_ACTION' || selection.kind === 'SELECT_LIVE_SET_ACTION'
      ? selection.actionId
      : null;
  const selectedAction = selectedActionId
    ? observation.decision.actions.find((action) => action.actionId === selectedActionId)
    : undefined;
  const selectedCandidate = selectedAction?.candidateId
    ? observation.decision.candidates.find(
        (candidate) => candidate.candidateId === selectedAction.candidateId
      )
    : undefined;
  const comparableEnergyCosts = selectedCandidate?.card
    ? observation.decision.actions.flatMap((action) => {
        if (action.kind !== 'PLAY_MEMBER' || !action.candidateId || !action.paymentPreview) {
          return [];
        }
        const candidate = observation.decision.candidates.find(
          (item) => item.candidateId === action.candidateId
        );
        return candidate?.card &&
          getBaseCardCode(candidate.card.cardCode) ===
            getBaseCardCode(selectedCandidate.card!.cardCode)
          ? [action.paymentPreview.energyCost]
          : [];
      })
    : [];
  const selectedMulliganIds = selection.kind === 'MULLIGAN' ? selection.candidateIds : [];

  return {
    selfHandLiveCount: hand?.visibleCards.filter((card) => card.cardType === 'LIVE').length ?? 0,
    selfLiveZoneCount: liveZone?.count ?? 0,
    selfSuccessLiveCount: self.successLiveCount,
    selfStageMemberCount,
    selfActiveEnergyCount:
      energy?.visibleCards.filter((card) => card.orientation === 'ACTIVE').length ?? 0,
    selectedActionKind: selectedAction?.kind ?? null,
    selectedEnergyCost: selectedAction?.paymentPreview?.energyCost ?? null,
    minimumComparableEnergyCost:
      comparableEnergyCosts.length > 0 ? Math.min(...comparableEnergyCosts) : null,
    selectedStageMemberDelta:
      selectedAction?.kind === 'PLAY_MEMBER'
        ? 1 - (selectedAction.paymentPreview?.replacementCount ?? 0)
        : null,
    visibleMulliganLiveCount: observation.decision.candidates.filter(
      (candidate) => candidate.card?.cardType === 'LIVE'
    ).length,
    selectedMulliganLiveCount: observation.decision.candidates.filter(
      (candidate) =>
        candidate.card?.cardType === 'LIVE' && selectedMulliganIds.includes(candidate.candidateId)
    ).length,
    availableEffectCandidateCount:
      observation.decision.kind === 'ACTIVE_EFFECT' ? observation.decision.candidates.length : 0,
    selectedEffectCandidateCount:
      selection.kind === 'SELECT_EFFECT_CARDS' ? selection.candidateIds.length : 0,
  };
}

interface AutomaticReviewFinding {
  readonly severity: 'HIGH' | 'MEDIUM';
  readonly category: '关键失误' | '无效计划' | '资源效率' | '连续无 LIVE' | '执行异常';
  readonly detail: string;
}

function appendAutomaticReviewSummary(
  lines: string[],
  entries: readonly AiBattleReflectionHistoryEntry[]
): void {
  const acceptedCount = entries.filter((entry) => entry.executionStatus === 'ACCEPTED').length;
  const modelCount = entries.filter((entry) => entry.source === 'MODEL').length;
  const ruleCount = entries.filter((entry) => entry.source === 'RULE').length;
  const fallbackCount = entries.filter((entry) => entry.source === 'CONSERVATIVE_FALLBACK').length;
  lines.push(
    `- 决策概况：共 ${String(entries.length)} 次；权威接受 ${String(acceptedCount)} 次；模型 ${String(modelCount)} 次，规则/确定性策略 ${String(ruleCount)} 次，保守降级 ${String(fallbackCount)} 次。`
  );

  const findings = collectAutomaticReviewFindings(entries);
  if (findings.length === 0) {
    lines.push('- 当前快照未检测到高置信度的关键失误、计划冲突、资源回退或连续无 LIVE 信号。');
    return;
  }
  for (const finding of findings) {
    lines.push(
      `- **${finding.severity === 'HIGH' ? '高' : '中'} · ${finding.category}**：${escapeMarkdown(finding.detail)}`
    );
  }
}

function collectAutomaticReviewFindings(
  entries: readonly AiBattleReflectionHistoryEntry[]
): readonly AutomaticReviewFinding[] {
  const findings: AutomaticReviewFinding[] = [];
  const returnedAllLive = entries.filter(
    (entry) =>
      entry.executionStatus === 'ACCEPTED' &&
      entry.decisionKind === 'MULLIGAN' &&
      entry.reviewSnapshot.visibleMulliganLiveCount > 0 &&
      entry.reviewSnapshot.selectedMulliganLiveCount ===
        entry.reviewSnapshot.visibleMulliganLiveCount
  );
  if (returnedAllLive.length > 0) {
    findings.push({
      severity: 'HIGH',
      category: '关键失误',
      detail: `决策 ${returnedAllLive.map((entry) => String(entry.seq)).join('、')} 将当时可见的全部 LIVE 卡换回卡组，直接增加后续无法进行 LIVE 的风险。`,
    });
  }

  const mechanicalMultiCandidate = entries.filter(
    (entry) =>
      entry.executionStatus === 'ACCEPTED' &&
      entry.source === 'RULE' &&
      entry.tier === 'RULE_FORCED' &&
      entry.decisionKind === 'ACTIVE_EFFECT' &&
      entry.reviewSnapshot.availableEffectCandidateCount >
        entry.reviewSnapshot.selectedEffectCandidateCount &&
      entry.reviewSnapshot.selectedEffectCandidateCount > 0
  );
  if (mechanicalMultiCandidate.length > 0) {
    findings.push({
      severity: 'HIGH',
      category: '关键失误',
      detail: `决策 ${mechanicalMultiCandidate.map((entry) => String(entry.seq)).join('、')} 在多候选强制选卡窗口由规则顺序代替战术比较；这些窗口应交给模型。`,
    });
  }

  const emptyLiveTurns = uniqueSortedNumbers(
    entries
      .filter(
        (entry) =>
          entry.executionStatus === 'ACCEPTED' &&
          entry.decisionKind === 'LIVE_SET' &&
          entry.reviewSnapshot.selectedActionKind === 'CONFIRM_LIVE_SET' &&
          entry.reviewSnapshot.selfHandLiveCount === 0 &&
          entry.reviewSnapshot.selfLiveZoneCount === 0
      )
      .map((entry) => entry.turnCount)
  );
  const consecutiveEmptyLiveTurns = longestConsecutiveRun(emptyLiveTurns);
  if (consecutiveEmptyLiveTurns.length >= 2) {
    findings.push({
      severity: 'HIGH',
      category: '连续无 LIVE',
      detail: `第 ${consecutiveEmptyLiveTurns.map((turn) => String(turn)).join('、')} 回合连续在手牌与 LIVE 区均无 LIVE 卡时确认放置，连续失去得分窗口。`,
    });
  }

  const planWithoutLive = entries.filter(
    (entry) =>
      entry.executionStatus === 'ACCEPTED' &&
      entry.nextPlan !== null &&
      /LIVE|演出/u.test(entry.nextPlan) &&
      entry.reviewSnapshot.selfHandLiveCount === 0 &&
      entry.reviewSnapshot.selfLiveZoneCount === 0
  );
  if (planWithoutLive.length > 0) {
    findings.push({
      severity: 'MEDIUM',
      category: '无效计划',
      detail: `决策 ${planWithoutLive.map((entry) => String(entry.seq)).join('、')} 的后续计划依赖 LIVE/演出，但当时手牌与 LIVE 区都没有可见 LIVE 卡；计划缺少先取得 LIVE 的前置步骤。`,
    });
  }

  for (const entry of entries) {
    const snapshot = entry.reviewSnapshot;
    if (
      entry.executionStatus !== 'ACCEPTED' ||
      (snapshot.selectedStageMemberDelta ?? 0) <= 0 ||
      snapshot.selectedEnergyCost === null ||
      snapshot.minimumComparableEnergyCost === null ||
      snapshot.selectedEnergyCost <= snapshot.minimumComparableEnergyCost
    ) {
      continue;
    }
    const laterRollback = entries.find(
      (candidate) =>
        candidate.executionStatus === 'ACCEPTED' &&
        candidate.turnCount === entry.turnCount &&
        candidate.seq > entry.seq &&
        candidate.reviewSnapshot.selfStageMemberCount <= snapshot.selfStageMemberCount
    );
    if (!laterRollback) continue;
    findings.push({
      severity: 'MEDIUM',
      category: '资源效率',
      detail: `决策 ${String(entry.seq)} 为扩场支付 ${String(snapshot.selectedEnergyCost)} 张能量，同卡当时最低路线为 ${String(snapshot.minimumComparableEnergyCost)} 张；到决策 ${String(laterRollback.seq)} 前舞台又回落到 ${String(laterRollback.reviewSnapshot.selfStageMemberCount)} 名，额外支付可能未形成持续收益。`,
    });
    break;
  }

  const failedEntries = entries.filter((entry) => entry.executionStatus !== 'ACCEPTED');
  if (failedEntries.length > 0) {
    findings.push({
      severity: 'HIGH',
      category: '执行异常',
      detail: `决策 ${failedEntries.map((entry) => String(entry.seq)).join('、')} 未成为权威结果，应检查非法选择、陈旧窗口或并发重验。`,
    });
  }
  return findings;
}

function longestConsecutiveRun(values: readonly number[]): readonly number[] {
  let best: number[] = [];
  let current: number[] = [];
  for (const value of values) {
    if (current.length === 0 || value === current[current.length - 1]! + 1) current.push(value);
    else current = [value];
    if (current.length > best.length) best = [...current];
  }
  return best;
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function cloneEntry(entry: AiBattleReflectionHistoryEntry): AiBattleReflectionHistoryEntry {
  return {
    ...entry,
    currentState: { ...entry.currentState, facts: [...entry.currentState.facts] },
    currentDecision: {
      ...entry.currentDecision,
      facts: [...entry.currentDecision.facts],
      choices: entry.currentDecision.choices.map(cloneChoice),
    },
    strategicObjectives: entry.strategicObjectives.map((objective) => ({
      ...objective,
      evidence: [...objective.evidence],
    })),
    reviewSnapshot: { ...entry.reviewSnapshot },
    selectedChoices: entry.selectedChoices.map(cloneChoice),
    model: entry.model ? { ...entry.model, outcomes: [...entry.model.outcomes] } : null,
  };
}

function cloneChoice(choice: AiBattleReflectionChoice): AiBattleReflectionChoice {
  return { ...choice, details: [...choice.details] };
}

function formatSelectedChoices(entry: AiBattleReflectionHistoryEntry): string {
  const descriptions = entry.selectedChoices.map((choice) => choice.description);
  if (descriptions.length > 0) return `${entry.selectionSummary}：${descriptions.join('；')}`;
  return entry.selectionSummary;
}

function formatStrategicObjectives(entry: AiBattleReflectionHistoryEntry): string {
  if (entry.strategicObjectives.length === 0) return '当前无活跃的服务端结构化战略目标。';
  return entry.strategicObjectives
    .map((objective) => `${objective.priority === 'HIGH' ? '高' : '中'}：${objective.summary}`)
    .join('；');
}

function formatTradeoff(entry: AiBattleReflectionHistoryEntry): string {
  if (entry.tradeoff) return entry.tradeoff;
  if (entry.tier === 'RULE_FORCED') return '当前窗口是规则强制步骤，不存在额外战术取舍。';
  if (entry.source === 'RULE') return '当前选择由确定性策略根据本窗口合法候选直接作出。';
  return '模型未提供额外取舍说明；以结构化选择和权威执行结果作为本次复盘依据。';
}

function formatNextPlan(entry: AiBattleReflectionHistoryEntry): string {
  return entry.nextPlan ?? '权威执行后重新观察下一决策窗口，并按新局面制定后续计划。';
}

function appendBulletList(lines: string[], facts: readonly string[]): void {
  if (facts.length === 0) {
    lines.push('- 无额外事实');
    return;
  }
  for (const fact of facts) lines.push(`- ${escapeMarkdown(fact)}`);
}

function formatTimestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function sanitizeFilenameSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/gu, '-').slice(0, 80);
  return sanitized || 'match';
}

function inline(value: string): string {
  return `\`${value.replace(/`/gu, '\\`')}\``;
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/([*_[\]<>])/gu, '\\$1')
    .replace(/\r?\n/gu, ' ');
}

function escapeTableCell(value: string): string {
  return escapeMarkdown(value).replace(/\|/gu, '\\|');
}

function seatLabel(seat: Seat): string {
  return seat === 'FIRST' ? '先攻（FIRST）' : '后攻（SECOND）';
}

function sourceLabel(source: AiBattleReflectionDecisionSource): string {
  switch (source) {
    case 'MODEL':
      return '模型';
    case 'CONSERVATIVE_FALLBACK':
      return '保守降级策略';
    case 'RULE':
      return '规则 / 确定性策略';
  }
}

function executionStatusLabel(status: AiBattleReflectionExecutionStatus): string {
  switch (status) {
    case 'ACCEPTED':
      return '已被权威规则接受';
    case 'REJECTED':
      return '被权威规则拒绝';
    case 'STALE':
      return '决策窗口已变化，未执行';
  }
}

function decisionKindLabel(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    MULLIGAN: '换牌',
    COST_PAYMENT: '费用支付',
    JUDGMENT_CONFIRMATION: 'LIVE 判定确认',
    SCORE_CONFIRMATION: '分数确认',
    SUCCESS_LIVE_SELECTION: '成功 LIVE 选择',
    PHASE_CONFIRMATION: '阶段确认',
    MAIN_PHASE: '主要阶段行动',
    LIVE_SET: 'LIVE 设置',
    SPECIAL_MEMBER_PLAY: '特殊成员登场',
    ACTIVE_EFFECT: '卡牌效果处理',
  };
  return labels[kind] ?? kind;
}
