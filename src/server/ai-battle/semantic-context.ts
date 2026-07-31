import type { AiDecisionSelection } from '../../application/ai-decisions/index.js';
import type { Seat } from '../../online/index.js';
import type { SlotPosition } from '../../shared/types/enums.js';
import type {
  AiObservedAction,
  AiObservedCandidate,
  AiObservedCard,
  AiObservedDecisionInput,
  AiObservedSeat,
  AiObservedZone,
  AiObservation,
} from './ai-observation.js';
import type { AiSelectedHistoryItem } from './strategy-history.js';

export const AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION =
  'ai-battle.semantic-decision-context/v1' as const;

const STAGE_SLOTS = ['LEFT', 'CENTER', 'RIGHT'] as const;

export interface AiSemanticFact {
  readonly factId: string;
  readonly kind: 'STATE' | 'CARD' | 'DECISION' | 'CONSEQUENCE' | 'HISTORY';
  readonly text: string;
}

export interface AiSemanticChoice {
  readonly referenceType: 'ACTION' | 'CANDIDATE' | 'OPTION' | 'SLOT' | 'SELECTION';
  readonly referenceId: string;
  readonly title: string;
  readonly facts: readonly AiSemanticFact[];
  /**
   * A model selecting this choice must cite these facts. The authority still
   * validates the structured selection separately.
   */
  readonly requiredFactIds: readonly string[];
}

export interface AiSemanticHistoryEntry {
  readonly historyId: string;
  readonly turnCount: number;
  readonly facts: readonly AiSemanticFact[];
}

export interface AiSemanticDecisionContext {
  readonly schemaVersion: typeof AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION;
  readonly language: 'zh-CN';
  readonly currentState: {
    readonly summary: string;
    readonly facts: readonly AiSemanticFact[];
  };
  readonly currentDecision: {
    readonly kind: AiObservation['decision']['kind'];
    readonly instruction: string;
    readonly requiredFactIds: readonly string[];
    readonly facts: readonly AiSemanticFact[];
    readonly choices: readonly AiSemanticChoice[];
  };
  readonly battleHistory: readonly AiSemanticHistoryEntry[];
}

/**
 * Converts the already-redacted Phase 2 observation and selected history into
 * an LLM-oriented semantic context. This module cannot read GameState,
 * PlayerViewState, authority events, chat, or authority object identifiers.
 */
export function buildAiSemanticDecisionContext(input: {
  readonly observation: AiObservation;
  readonly selectedHistory: readonly AiSelectedHistoryItem[];
}): AiSemanticDecisionContext {
  const { observation } = input;
  const currentStateFacts = buildCurrentStateFacts(observation);
  const currentDecision = buildCurrentDecision(observation);
  return {
    schemaVersion: AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION,
    language: 'zh-CN',
    currentState: {
      summary: `第 ${String(observation.turn.count)} 回合，${phaseLabel(observation.turn.phase)} / ${subPhaseLabel(observation.turn.subPhase)}。`,
      facts: currentStateFacts,
    },
    currentDecision,
    battleHistory: input.selectedHistory.map((item) => ({
      historyId: item.historyId,
      turnCount: item.turnCount,
      facts: [
        fact(
          `history.${item.historyId}.event`,
          'HISTORY',
          `第 ${String(item.turnCount)} 回合的权威已接受记录：${item.summary}`
        ),
        ...(item.cards.length > 0
          ? [
              fact(
                `history.${item.historyId}.cards`,
                'HISTORY',
                `涉及卡牌：${item.cards.map(formatHistoryCard).join('；')}。`
              ),
            ]
          : []),
      ],
    })),
  };
}

export function collectAiSemanticFactIds(context: AiSemanticDecisionContext): ReadonlySet<string> {
  return new Set([
    ...context.currentState.facts.map((item) => item.factId),
    ...context.currentDecision.facts.map((item) => item.factId),
    ...context.currentDecision.choices.flatMap((choice) => choice.facts.map((item) => item.factId)),
    ...context.battleHistory.flatMap((entry) => entry.facts.map((item) => item.factId)),
  ]);
}

/**
 * Resolves the minimum semantic facts that must ground a selected decision.
 * This is intentionally independent of command materialization.
 */
export function getRequiredAiSemanticFactIdsForSelection(
  context: AiSemanticDecisionContext,
  selection: AiDecisionSelection
): readonly string[] {
  const required = new Set(context.currentDecision.requiredFactIds);
  const addChoice = (
    referenceType: AiSemanticChoice['referenceType'],
    referenceId: string
  ): void => {
    const choice = context.currentDecision.choices.find(
      (candidate) =>
        candidate.referenceType === referenceType && candidate.referenceId === referenceId
    );
    for (const factId of choice?.requiredFactIds ?? []) required.add(factId);
  };

  switch (selection.kind) {
    case 'MULLIGAN':
    case 'PAY_COST':
    case 'CONFIRM_SPECIAL_MEMBER_PLAY':
    case 'SELECT_EFFECT_CARDS':
      selection.candidateIds.forEach((candidateId) => addChoice('CANDIDATE', candidateId));
      break;
    case 'SELECT_SUCCESS_LIVE':
      addChoice('CANDIDATE', selection.candidateId);
      break;
    case 'SELECT_MAIN_PHASE_ACTION':
    case 'SELECT_LIVE_SET_ACTION':
      addChoice('ACTION', selection.actionId);
      break;
    case 'SELECT_EFFECT_OPTIONS':
      selection.optionIds.forEach((optionId) => addChoice('OPTION', optionId));
      break;
    case 'SELECT_EFFECT_SLOT':
      addChoice('SLOT', selection.slot);
      break;
    case 'SET_STAGE_FORMATION':
      for (const placement of selection.placements) {
        addChoice('CANDIDATE', placement.candidateId);
        addChoice('SLOT', placement.toSlot);
      }
      break;
    case 'SELECT_EFFECT_NUMBER':
      addChoice('SELECTION', 'SELECT_EFFECT_NUMBER');
      break;
    case 'CONFIRM_JUDGMENT':
    case 'CONFIRM_SCORE':
    case 'CONFIRM_PHASE':
    case 'CANCEL_SPECIAL_MEMBER_PLAY':
    case 'CONFIRM_EFFECT':
    case 'RESOLVE_ABILITIES_IN_ORDER':
    case 'CONFIRM_DEADLINE':
      addChoice('SELECTION', selection.kind);
      break;
  }

  return [...required];
}

function buildCurrentStateFacts(observation: AiObservation): readonly AiSemanticFact[] {
  const facts: AiSemanticFact[] = [
    fact(
      'state.turn',
      'STATE',
      `当前是第 ${String(observation.turn.count)} 回合，阶段为${phaseLabel(observation.turn.phase)}，子阶段为${subPhaseLabel(observation.turn.subPhase)}；先攻是${seatLabel(observation, observation.turn.firstSeat)}，行动方是${seatLabel(observation, observation.turn.activeSeat)}，优先权方是${seatLabel(observation, observation.turn.prioritySeat)}。`
    ),
  ];

  for (const seat of ['FIRST', 'SECOND'] as const) {
    const side = seat === observation.viewerSeat ? 'self' : 'opponent';
    const sideLabel = side === 'self' ? '我方' : '对方';
    const observedSeat = observation.seats[seat];
    facts.push(
      fact(
        `state.${side}.progress`,
        'STATE',
        `${sideLabel}成功 LIVE 区有 ${String(observedSeat.successLiveCount)} 张，公开分数合计 ${String(observedSeat.successLiveScore)}。`
      ),
      ...buildSeatZoneFacts(side, sideLabel, observedSeat)
    );
  }

  if (observation.window) {
    facts.push(
      fact(
        'state.window',
        'STATE',
        `当前窗口为 ${observation.window.type}（${observation.window.status}），应行动方是${seatLabel(observation, observation.window.actingSeat)}。`
      )
    );
  }
  if (observation.liveResult) {
    facts.push(
      fact(
        'state.live_result',
        'STATE',
        `当前 LIVE 权威分数：我方 ${String(observation.liveResult.scores[observation.viewerSeat])}，对方 ${String(observation.liveResult.scores[otherSeat(observation.viewerSeat)])}；领先方：${observation.liveResult.winnerSeats.map((seat) => seatLabel(observation, seat)).join('、') || '暂无'}。`
      )
    );
  }
  if (observation.endInfo) {
    facts.push(
      fact(
        'state.end',
        'STATE',
        `对局已结束，原因 ${observation.endInfo.reason}，胜者为${seatLabel(observation, observation.endInfo.winnerSeat)}。`
      )
    );
  }
  return facts;
}

function buildSeatZoneFacts(
  side: 'self' | 'opponent',
  sideLabel: string,
  seat: AiObservedSeat
): readonly AiSemanticFact[] {
  const facts: AiSemanticFact[] = [];
  const stage = readStage(seat);
  for (const slot of STAGE_SLOTS) {
    const card = stage[slot];
    facts.push(
      fact(
        `state.${side}.stage.${slot.toLowerCase()}`,
        'STATE',
        card
          ? `${sideLabel}${slotLabel(slot)}成员区是${formatCard(card, true)}，状态${orientationLabel(card.orientation)}。`
          : `${sideLabel}${slotLabel(slot)}成员区为空。`
      )
    );
  }

  const hand = findZone(seat, 'HAND');
  const mainDeck = findZone(seat, 'MAIN_DECK');
  const energyDeck = findZone(seat, 'ENERGY_DECK');
  const energy = findZone(seat, 'ENERGY_ZONE');
  const live = findZone(seat, 'LIVE_ZONE');
  const waiting = findZone(seat, 'WAITING_ROOM');
  const exile = findZone(seat, 'EXILE_ZONE');
  const activeEnergy = countCardsByOrientation(energy, 'ACTIVE');
  const waitingEnergy = Math.max(0, (energy?.count ?? 0) - activeEnergy);
  facts.push(
    fact(
      `state.${side}.resources`,
      'STATE',
      `${sideLabel}手牌 ${String(hand?.count ?? 0)} 张，主卡组 ${String(mainDeck?.count ?? 0)} 张，能量卡组 ${String(energyDeck?.count ?? 0)} 张；能量区共 ${String(energy?.count ?? 0)} 张，其中活跃 ${String(activeEnergy)} 张、待机 ${String(waitingEnergy)} 张。`
    ),
    fact(
      `state.${side}.zones`,
      'STATE',
      `${sideLabel}LIVE 区 ${String(live?.count ?? 0)} 张，休息室 ${String(waiting?.count ?? 0)} 张，除外区 ${String(exile?.count ?? 0)} 张。`
    )
  );

  for (const zone of seat.zones) {
    if (zone.visibleCards.length === 0 || zone.zoneKey.startsWith('MEMBER_')) continue;
    facts.push(
      fact(
        `state.${side}.zone.${zone.zoneKey.toLowerCase()}.cards`,
        'CARD',
        `${sideLabel}${zoneLabel(zone.zoneKey)}当前可见卡牌：${zone.visibleCards.map((card) => formatCard(card, true)).join('；')}。`
      )
    );
  }
  return facts;
}

function buildCurrentDecision(
  observation: AiObservation
): AiSemanticDecisionContext['currentDecision'] {
  const decision = observation.decision;
  const baseFact = fact(
    'decision.base',
    'DECISION',
    `当前必须只处理 ${decisionKindLabel(decision.kind)}；${decision.mandatory ? '这是强制决定' : '这是可选决定'}，只能使用本决定列出的本地引用，执行后必须重新观察。`
  );
  const facts: AiSemanticFact[] = [baseFact];
  if (decision.effectText || decision.stepText) {
    facts.push(
      fact(
        'decision.effect',
        'DECISION',
        `当前效果卡文：${singleLine(decision.effectText ?? '未提供')}；当前步骤：${singleLine(decision.stepText ?? '未提供')}。`
      )
    );
  }
  if (decision.input) {
    facts.push(fact('decision.constraints', 'DECISION', describeDecisionInput(decision.input)));
  }
  if (decision.authorityScore !== undefined) {
    facts.push(
      fact(
        'decision.authority_score',
        'DECISION',
        `权威计算的待确认分数是 ${String(decision.authorityScore)}。`
      )
    );
  }
  if (decision.setCount !== undefined && decision.setLimit !== undefined) {
    facts.push(
      fact(
        'decision.live_set_limit',
        'DECISION',
        `当前已放置 ${String(decision.setCount)} 张 LIVE，本窗口上限 ${String(decision.setLimit)} 张。`
      )
    );
  }

  const choices: AiSemanticChoice[] = [
    ...decision.candidates.map((candidate, index) => buildCandidateChoice(candidate, index)),
    ...decision.options.map((option, index) =>
      choice('OPTION', option.optionId, `选择选项「${singleLine(option.label)}」`, [
        fact(
          `decision.option.${String(index + 1)}.meaning`,
          'DECISION',
          `选项 ${option.optionId} 的显示含义是「${singleLine(option.label)}」。`
        ),
      ])
    ),
    ...buildSlotChoices(decision.input?.slots ?? []),
    ...decision.actions.map((action, index) => buildActionChoice(observation, action, index)),
    ...buildSyntheticSelectionChoices(observation),
  ];

  return {
    kind: decision.kind,
    instruction: decisionInstruction(decision.kind),
    requiredFactIds: ['decision.base'],
    facts,
    choices,
  };
}

function buildCandidateChoice(candidate: AiObservedCandidate, index: number): AiSemanticChoice {
  const description = candidate.card
    ? formatCard(candidate.card, true)
    : '身份不可见的候选；不得推断其卡名、编号、类型或卡文';
  return choice(
    'CANDIDATE',
    candidate.candidateId,
    `候选 ${candidate.candidateId}：${description}`,
    [
      fact(
        `decision.candidate.${String(index + 1)}.identity`,
        'CARD',
        `候选 ${candidate.candidateId} 是${description}。`
      ),
    ]
  );
}

function buildSlotChoices(slots: readonly SlotPosition[]): readonly AiSemanticChoice[] {
  return slots.map((slot) =>
    choice('SLOT', slot, `选择${slotLabel(slot)}成员区`, [
      fact(
        `decision.slot.${slot.toLowerCase()}.meaning`,
        'DECISION',
        `${slot} 表示${slotLabel(slot)}成员区。`
      ),
    ])
  );
}

function buildActionChoice(
  observation: AiObservation,
  action: AiObservedAction,
  index: number
): AiSemanticChoice {
  const prefix = `decision.action.${String(index + 1)}`;
  const source = action.candidateId
    ? observation.decision.candidates.find(
        (candidate) => candidate.candidateId === action.candidateId
      )
    : undefined;
  const sourceCard = source?.card;
  const facts: AiSemanticFact[] = [];
  let title: string;

  switch (action.kind) {
    case 'PLAY_MEMBER': {
      const targetSlot = action.targetSlot ?? 'CENTER';
      const selfSeat = observation.seats[observation.viewerSeat];
      const stageBefore = readStage(selfSeat);
      const replacementSlots = getRelayReplacementSlots(action, stageBefore);
      const replacedCards = replacementSlots.flatMap((slot) => {
        const card = stageBefore[slot];
        return card ? [{ slot, card }] : [];
      });
      const stageAfter = { ...stageBefore };
      for (const slot of replacementSlots) stageAfter[slot] = undefined;
      stageAfter[targetSlot] = sourceCard;
      const energy = findZone(selfSeat, 'ENERGY_ZONE');
      const activeEnergy = countCardsByOrientation(energy, 'ACTIVE');
      const energyCost = action.paymentPreview?.energyCost ?? 0;
      const handCount = findZone(selfSeat, 'HAND')?.count ?? 0;
      const waitingCount = findZone(selfSeat, 'WAITING_ROOM')?.count ?? 0;
      title = `将${sourceCard ? formatCard(sourceCard) : `候选 ${action.candidateId ?? '未知'}`}登场到${slotLabel(targetSlot)}成员区`;
      facts.push(
        fact(
          `${prefix}.choice`,
          'DECISION',
          `${title}。费用修正后为 ${String(action.paymentPreview?.modifiedCost ?? sourceCard?.cost ?? 0)}，支付 ${String(energyCost)} 张活跃能量，换手减免 ${String(action.paymentPreview?.relayDiscount ?? 0)}。`
        ),
        fact(
          `${prefix}.source_boundary`,
          'CARD',
          hasMeaningfulAbilityText(sourceCard?.text)
            ? `本次登场来源卡是${formatCard(sourceCard)}，其自身卡文为「${singleLine(sourceCard.text)}」。能力只属于来源卡；被接力替换成员的能力不会转移给它。`
            : `本次登场来源卡是${sourceCard ? formatCard(sourceCard) : '未识别候选'}；当前公开卡文没有能力文本。能力只属于来源卡，不得把被换手替换成员的能力当作它的能力。`
        ),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          `若权威接受此动作：${replacedCards.length > 0 ? `换手替换${replacedCards.map(({ slot, card }) => `${slotLabel(slot)}的${formatCard(card)}`).join('、')}并将其放入休息室` : '不替换舞台成员'}；登场后舞台为${formatStage(stageAfter)}；活跃能量从 ${String(activeEnergy)} 变为 ${String(Math.max(0, activeEnergy - energyCost))}，待机能量增加 ${String(energyCost)}；手牌从 ${String(handCount)} 变为 ${String(Math.max(0, handCount - 1))}，休息室从 ${String(waitingCount)} 变为 ${String(waitingCount + replacedCards.length)}。`
        )
      );
      return choice('ACTION', action.actionId, title, facts, [
        `${prefix}.choice`,
        `${prefix}.source_boundary`,
        `${prefix}.consequence`,
      ]);
    }
    case 'ACTIVATE_ABILITY':
      title = `发动${sourceCard ? formatCard(sourceCard) : `候选 ${action.candidateId ?? '未知'}`}的起动能力`;
      facts.push(
        fact(
          `${prefix}.choice`,
          'DECISION',
          `${title}；合法动作提供的能力文本是「${singleLine(action.label ?? sourceCard?.text ?? '未提供')}」。`
        ),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          '选择后只会开始该权威已判定合法的能力；后续费用、对象和步骤必须等待新的决定，不能在本次输出中预先执行。'
        )
      );
      break;
    case 'BEGIN_SPECIAL_MEMBER_PLAY':
      title = `开始${sourceCard ? formatCard(sourceCard) : `候选 ${action.candidateId ?? '未知'}`}的特殊登场流程`;
      facts.push(
        fact(
          `${prefix}.choice`,
          'DECISION',
          `${title}，目标是${slotLabel(action.targetSlot ?? 'CENTER')}成员区；流程标签为「${singleLine(action.label ?? '未提供')}」。`
        ),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          '选择后进入特殊登场确认流程；具体选择和支付要等待权威给出下一份决定。'
        )
      );
      break;
    case 'END_MAIN_PHASE':
      title = '结束主要阶段';
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', '结束主要阶段，不再进行本阶段的成员登场或起动能力。'),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          '权威将推进到后续阶段；推进后的状态必须重新观察。'
        )
      );
      break;
    case 'SET_LIVE': {
      const setCount = observation.decision.setCount ?? 0;
      const handCount = findZone(observation.seats[observation.viewerSeat], 'HAND')?.count ?? 0;
      title = `盖放${sourceCard ? formatCard(sourceCard) : `候选 ${action.candidateId ?? '未知'}`}到 LIVE 区`;
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', `${title}。`),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          `若接受，LIVE 区盖放数从 ${String(setCount)} 变为 ${String(setCount + 1)}，手牌从 ${String(handCount)} 变为 ${String(Math.max(0, handCount - 1))}；卡牌保持背面，身份不会因此向对手公开。`
        )
      );
      break;
    }
    case 'UNSET_LIVE': {
      const setCount = observation.decision.setCount ?? 0;
      const handCount = findZone(observation.seats[observation.viewerSeat], 'HAND')?.count ?? 0;
      title = `将${sourceCard ? formatCard(sourceCard) : `候选 ${action.candidateId ?? '未知'}`}从 LIVE 区收回手牌`;
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', `${title}。`),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          `若接受，LIVE 区盖放数从 ${String(setCount)} 变为 ${String(Math.max(0, setCount - 1))}，手牌从 ${String(handCount)} 变为 ${String(handCount + 1)}。`
        )
      );
      break;
    }
    case 'CONFIRM_LIVE_SET':
      title = '确认本次 LIVE 放置';
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', title),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          '确认后结束当前玩家的 LIVE 放置选择；权威决定下一窗口。'
        )
      );
      break;
    default:
      title = action.label ? singleLine(action.label) : `选择动作 ${action.kind}`;
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', `${title}。`),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          '该动作的具体执行结果由权威状态机决定，执行后必须重新观察。'
        )
      );
  }

  return choice('ACTION', action.actionId, title, facts, [
    `${prefix}.choice`,
    `${prefix}.consequence`,
  ]);
}

function buildSyntheticSelectionChoices(observation: AiObservation): readonly AiSemanticChoice[] {
  const decision = observation.decision;
  const selections: readonly { readonly id: string; readonly text: string }[] =
    decision.kind === 'JUDGMENT_CONFIRMATION'
      ? [{ id: 'CONFIRM_JUDGMENT', text: '确认权威判定结果' }]
      : decision.kind === 'SCORE_CONFIRMATION'
        ? [{ id: 'CONFIRM_SCORE', text: '确认权威分数' }]
        : decision.kind === 'PHASE_CONFIRMATION'
          ? [{ id: 'CONFIRM_PHASE', text: '确认推进当前阶段步骤' }]
          : decision.kind === 'SPECIAL_MEMBER_PLAY'
            ? [
                ...(decision.canConfirmSpecialMemberPlay
                  ? [{ id: 'CONFIRM_SPECIAL_MEMBER_PLAY', text: '确认特殊登场选择' }]
                  : []),
                ...(decision.canCancelSpecialMemberPlay
                  ? [{ id: 'CANCEL_SPECIAL_MEMBER_PLAY', text: '取消特殊登场' }]
                  : []),
              ]
            : decision.kind === 'ACTIVE_EFFECT'
              ? syntheticActiveEffectSelections(decision.input?.kind)
              : [];

  return selections.map(({ id, text }) =>
    choice('SELECTION', id, text, [
      fact(
        `decision.selection.${id.toLowerCase()}.meaning`,
        'DECISION',
        `${text}；权威执行后必须根据新状态重新决定。`
      ),
    ])
  );
}

function syntheticActiveEffectSelections(
  inputKind: AiObservedDecisionInput['kind'] | undefined
): readonly { readonly id: string; readonly text: string }[] {
  switch (inputKind) {
    case 'CONFIRM':
      return [{ id: 'CONFIRM_EFFECT', text: '确认并继续处理当前效果' }];
    case 'NUMBER_INPUT':
      return [{ id: 'SELECT_EFFECT_NUMBER', text: '在权威范围内输入数值' }];
    case 'ABILITY_ORDER':
      return [{ id: 'RESOLVE_ABILITIES_IN_ORDER', text: '按当前顺序依次处理能力' }];
    case 'DEADLINE_CONFIRMATION':
      return [{ id: 'CONFIRM_DEADLINE', text: '确认公开选择的截止步骤' }];
    default:
      return [];
  }
}

function choice(
  referenceType: AiSemanticChoice['referenceType'],
  referenceId: string,
  title: string,
  facts: readonly AiSemanticFact[],
  requiredFactIds = facts.map((item) => item.factId)
): AiSemanticChoice {
  return { referenceType, referenceId, title, facts, requiredFactIds };
}

function fact(factId: string, kind: AiSemanticFact['kind'], text: string): AiSemanticFact {
  return { factId, kind, text: singleLine(text) };
}

function readStage(
  seat: AiObservedSeat
): Record<(typeof STAGE_SLOTS)[number], AiObservedCard | undefined> {
  return {
    LEFT: findPrimaryCard(findZone(seat, 'MEMBER_LEFT')),
    CENTER: findPrimaryCard(findZone(seat, 'MEMBER_CENTER')),
    RIGHT: findPrimaryCard(findZone(seat, 'MEMBER_RIGHT')),
  };
}

function findZone(seat: AiObservedSeat, zoneKey: string): AiObservedZone | undefined {
  return seat.zones.find((zone) => zone.zoneKey === zoneKey);
}

function findPrimaryCard(zone: AiObservedZone | undefined): AiObservedCard | undefined {
  return zone?.visibleCards.find((card) => card.role === 'PRIMARY') ?? zone?.visibleCards[0];
}

function countCardsByOrientation(zone: AiObservedZone | undefined, orientation: string): number {
  return zone?.visibleCards.filter((card) => card.orientation === orientation).length ?? 0;
}

function getRelayReplacementSlots(
  action: AiObservedAction,
  stage: Record<(typeof STAGE_SLOTS)[number], AiObservedCard | undefined>
): readonly SlotPosition[] {
  if ((action.paymentPreview?.replacementCount ?? 0) === 0) return [];
  if (action.relayReplacementSlots?.length) return action.relayReplacementSlots;
  return action.targetSlot && stage[action.targetSlot] ? [action.targetSlot] : [];
}

function formatStage(
  stage: Record<(typeof STAGE_SLOTS)[number], AiObservedCard | undefined>
): string {
  return STAGE_SLOTS.map(
    (slot) => `${slotLabel(slot)}=${stage[slot] ? formatCard(stage[slot]!) : '空'}`
  ).join('，');
}

function formatCard(card: AiObservedCard, includeText = false): string {
  const stats =
    card.cardType === 'LIVE'
      ? card.score === undefined
        ? ''
        : ` 分数 ${String(card.score)}`
      : card.cost === undefined
        ? ''
        : ` 费用 ${String(card.cost)}`;
  const text = includeText && card.text ? `，卡文「${singleLine(card.text)}」` : '';
  return `${card.cardCode}${stats}「${singleLine(card.name)}」${text}`;
}

function formatHistoryCard(card: {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: string;
  readonly cost?: number;
  readonly score?: number;
}): string {
  return formatCard(card);
}

function describeDecisionInput(input: NonNullable<AiObservation['decision']['input']>): string {
  switch (input.kind) {
    case 'CARD_SELECTION':
    case 'OPTION_SELECTION':
      return `本步骤最少选择 ${String(input.minSelections ?? input.requiredCount ?? 0)} 项，最多选择 ${String(input.maxSelections ?? input.requiredCount ?? 0)} 项，${input.canSkip ? '允许跳过' : '不允许跳过'}${input.ordered ? '，选择顺序有意义' : ''}。`;
    case 'SLOT_SELECTION':
      return `本步骤可选成员区：${(input.slots ?? []).map(slotLabel).join('、')}；${input.canSkip ? '允许跳过' : '不允许跳过'}。`;
    case 'NUMBER_INPUT':
      return `本步骤输入数值，范围 ${String(input.min ?? '无下限')} 至 ${String(input.max ?? '无上限')}，${input.integerOnly ? '必须为整数' : '允许非整数'}。`;
    case 'STAGE_FORMATION':
      return `本步骤安排舞台站位，可用成员区：${(input.slots ?? []).map(slotLabel).join('、')}；${input.canSkip ? '允许跳过' : '不允许跳过'}。`;
    case 'ABILITY_ORDER':
      return `本步骤决定能力处理顺序；${input.canResolveInOrder ? '允许按当前顺序依次处理' : '必须逐个选择'}。`;
    case 'DEADLINE_CONFIRMATION':
      return `本步骤确认公开选择截止，类型为 ${input.deadlineKind ?? '未提供'}。`;
    case 'CONFIRM':
      return '本步骤只需确认继续处理当前效果。';
  }
}

function decisionInstruction(kind: AiObservation['decision']['kind']): string {
  switch (kind) {
    case 'MAIN_PHASE':
      return '比较每个合法动作的资源、舞台和后续窗口后果，只选择一个 actionId。';
    case 'LIVE_SET':
      return '选择一个盖放、收回或确认 LIVE 的 actionId。';
    case 'MULLIGAN':
      return '选择要换回卡组的 candidateId；未选中的手牌保留。';
    case 'COST_PAYMENT':
      return '选择权威要求数量的可支付能量 candidateId。';
    case 'SUCCESS_LIVE_SELECTION':
      return '从成功的 LIVE 候选中选择一个 candidateId。';
    case 'ACTIVE_EFFECT':
      return '只完成当前效果步骤，不预先处理后续步骤。';
    case 'SPECIAL_MEMBER_PLAY':
      return '在当前特殊登场流程中确认候选或取消。';
    default:
      return '确认当前权威结果或阶段步骤。';
  }
}

function decisionKindLabel(kind: AiObservation['decision']['kind']): string {
  const labels: Readonly<Record<AiObservation['decision']['kind'], string>> = {
    MULLIGAN: '换牌决定',
    COST_PAYMENT: '费用支付决定',
    JUDGMENT_CONFIRMATION: 'LIVE 判定确认',
    SCORE_CONFIRMATION: '分数确认',
    SUCCESS_LIVE_SELECTION: '成功 LIVE 选择',
    PHASE_CONFIRMATION: '阶段推进确认',
    MAIN_PHASE: '主要阶段动作',
    LIVE_SET: 'LIVE 放置动作',
    SPECIAL_MEMBER_PLAY: '特殊成员登场',
    ACTIVE_EFFECT: '效果步骤',
  };
  return labels[kind];
}

function phaseLabel(phase: string): string {
  const labels: Readonly<Record<string, string>> = {
    SETUP: '游戏准备阶段',
    MULLIGAN_PHASE: '换牌阶段',
    ACTIVE_PHASE: '活跃阶段',
    ENERGY_PHASE: '能量阶段',
    DRAW_PHASE: '抽卡阶段',
    MAIN_PHASE: '主要阶段',
    LIVE_SET_PHASE: 'LIVE 放置阶段',
    PERFORMANCE_PHASE: '表演阶段',
    LIVE_RESULT_PHASE: 'LIVE 结果阶段',
    GAME_END: '游戏结束',
  };
  return labels[phase] ?? phase;
}

function subPhaseLabel(subPhase: string): string {
  return subPhase.replaceAll('_', ' ');
}

function zoneLabel(zoneKey: string): string {
  const labels: Readonly<Record<string, string>> = {
    HAND: '手牌',
    MAIN_DECK: '主卡组',
    ENERGY_DECK: '能量卡组',
    ENERGY_ZONE: '能量区',
    LIVE_ZONE: 'LIVE 区',
    SUCCESS_ZONE: '成功 LIVE 区',
    WAITING_ROOM: '休息室',
    EXILE_ZONE: '除外区',
  };
  return labels[zoneKey] ?? zoneKey;
}

function slotLabel(slot: string): string {
  return slot === 'LEFT' ? '左侧' : slot === 'RIGHT' ? '右侧' : '中央';
}

function orientationLabel(orientation: string | undefined): string {
  return orientation === 'ACTIVE' ? '活跃' : orientation === 'WAITING' ? '待机' : '未标明';
}

function seatLabel(observation: AiObservation, seat: Seat | null): string {
  if (!seat) return '无';
  return seat === observation.viewerSeat ? '我方' : '对方';
}

function otherSeat(seat: Seat): Seat {
  return seat === 'FIRST' ? 'SECOND' : 'FIRST';
}

function singleLine(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasMeaningfulAbilityText(value: string | undefined): value is string {
  if (!value) return false;
  return !['-', '－', '—', '―', '无', 'なし'].includes(singleLine(value));
}
