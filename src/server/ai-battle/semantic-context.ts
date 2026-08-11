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
  'ai-battle.semantic-decision-context/v4' as const;

const STAGE_SLOTS = ['LEFT', 'CENTER', 'RIGHT'] as const;

export interface AiSemanticFact {
  readonly factId: string;
  readonly kind: 'STATE' | 'CARD' | 'DECISION' | 'CONSEQUENCE' | 'HISTORY';
  readonly text: string;
}

export interface AiSemanticChoice {
  readonly referenceType: 'ACTION' | 'CANDIDATE' | 'OPTION' | 'SLOT' | 'PLACEMENT' | 'SELECTION';
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
  readonly source: AiSelectedHistoryItem['source'];
  readonly category: AiSelectedHistoryItem['category'];
  readonly subject: 'SELF' | 'OPPONENT';
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
      summary: `第 ${String(observation.turn.count)} 回合，${phaseLabel(observation.turn.phase)} / ${subPhaseLabel(observation.turn.subPhase)}；当前决定是${decisionKindLabel(observation.decision.kind)}。`,
      facts: currentStateFacts,
    },
    currentDecision,
    battleHistory: input.selectedHistory.map((item) =>
      buildSemanticHistoryEntry(observation, item)
    ),
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
      if (selection.candidateIds.length === 0) {
        addChoice(
          'SELECTION',
          selection.kind === 'MULLIGAN' ? 'MULLIGAN_KEEP_ALL' : 'SKIP_EFFECT_CARDS'
        );
      }
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
      if (selection.optionIds.length === 0) {
        addChoice('SELECTION', 'SKIP_EFFECT_OPTIONS');
      }
      break;
    case 'SELECT_EFFECT_SLOT':
      addChoice('SLOT', selection.slot);
      break;
    case 'SET_STAGE_FORMATION':
      for (const placement of selection.placements) {
        addChoice('PLACEMENT', stagePlacementReferenceId(placement.candidateId, placement.toSlot));
      }
      break;
    case 'SELECT_EFFECT_NUMBER':
      addChoice('SELECTION', 'SELECT_EFFECT_NUMBER');
      break;
    case 'CONFIRM_JUDGMENT':
    case 'CONFIRM_SCORE':
    case 'CONFIRM_PHASE':
    case 'CANCEL_SPECIAL_MEMBER_PLAY':
      addChoice('SELECTION', selection.kind);
      break;
    case 'CONFIRM_EFFECT':
      if (context.currentDecision.kind === 'ACTIVE_EFFECT') {
        addChoice('SELECTION', 'CONFIRM_EFFECT');
      }
      break;
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
    fact(
      'state.freshness',
      'STATE',
      '先看当前局面，再参考历史。历史只说明过去发生过什么，不能证明一张卡现在仍在原处，也不能用来猜测没有公开的原因。'
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

  if (
    observation.turn.phase === 'MAIN_PHASE' &&
    observation.turn.activeSeat === observation.viewerSeat
  ) {
    const self = observation.seats[observation.viewerSeat];
    const memberCount = countStageMembers(self);
    const handCount = findZone(self, 'HAND')?.count ?? 0;
    const waitingRoomCount = findZone(self, 'WAITING_ROOM')?.count ?? 0;
    const activeEnergyCount = countCardsByOrientation(findZone(self, 'ENERGY_ZONE'), 'ACTIVE');
    const stageStrength = summarizeStageStrength(readStage(self));
    facts.push(
      fact(
        'state.self.main_phase_goal',
        'STATE',
        `我方现在场上有 ${String(memberCount)} 名成员、手牌 ${String(handCount)} 张、活跃能量 ${String(activeEnergyCount)} 张、休息室 ${String(waitingRoomCount)} 张；当前公开场面强度为${formatStageStrength(stageStrength)}。当前 choices 是本窗口的完整合法动作；执行一个动作后，如果主要阶段继续，系统会按新局面重新列出下一次 choices。`
      )
    );
  }

  if (observation.window) {
    facts.push(
      fact(
        'state.window',
        'STATE',
        `当前处理的是${windowTypeLabel(observation.window.type)}，状态为${windowStatusLabel(observation.window.status)}；现在轮到${seatLabel(observation, observation.window.actingSeat)}操作。`
      )
    );
  }
  if (observation.liveResult) {
    const selfSeat = observation.viewerSeat;
    const opponentSeat = otherSeat(selfSeat);
    facts.push(
      fact(
        'state.live_result',
        'STATE',
        `当前 LIVE 总分：我方 ${String(observation.liveResult.scores[selfSeat])}（分数修正 ${formatSignedNumber(observation.liveResult.scoreModifiers[selfSeat])}），对方 ${String(observation.liveResult.scores[opponentSeat])}（分数修正 ${formatSignedNumber(observation.liveResult.scoreModifiers[opponentSeat])}）；领先方：${observation.liveResult.winnerSeats.map((seat) => seatLabel(observation, seat)).join('、') || '暂无'}；已经确认分数：${observation.liveResult.confirmedSeats.map((seat) => seatLabel(observation, seat)).join('、') || '双方均未确认'}。`
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
  for (const zone of observation.sharedZones) {
    facts.push(
      fact(
        `state.shared.zone.${zone.zoneKey.toLowerCase()}`,
        zone.visibleCards.length > 0 ? 'CARD' : 'STATE',
        zone.visibleCards.length > 0
          ? `共享${zoneLabel(zone.zoneKey)}有 ${String(zone.count)} 张；当前可见卡牌：${zone.visibleCards.map((card) => formatCard(card, true)).join('；')}。`
          : `共享${zoneLabel(zone.zoneKey)}有 ${String(zone.count)} 张，当前看不到这些卡的身份。`
      )
    );
  }
  return facts;
}

function buildSemanticHistoryEntry(
  observation: AiObservation,
  item: AiSelectedHistoryItem
): AiSemanticHistoryEntry {
  const subjectSeat = item.category === 'VISIBLE_STATE_CHANGE' ? item.affectedSeat : item.actorSeat;
  const subject = subjectSeat === observation.viewerSeat ? 'SELF' : 'OPPONENT';
  const sideLabel = subject === 'SELF' ? '我方' : '对方';
  const isAccepted = item.category !== 'VISIBLE_STATE_CHANGE';
  return {
    historyId: item.historyId,
    turnCount: item.turnCount,
    source: item.source,
    category: item.category,
    subject,
    facts: [
      fact(
        `history.${item.historyId}.provenance`,
        'HISTORY',
        isAccepted
          ? `这是第 ${String(item.turnCount)} 回合${sideLabel}已经完成的${historyCategoryLabel(item.category)}。`
          : `这是第 ${String(item.turnCount)} 回合${sideLabel}区域中新看到的变化；只知道卡牌变得可见，不知道是谁让它移动，也不知道具体原因。`
      ),
      fact(
        `history.${item.historyId}.event`,
        'HISTORY',
        isAccepted
          ? `${sideLabel}${normalizeAcceptedHistorySummary(item.summary)}`
          : `${sideLabel}${visibleHistorySummary(item.reasonCode, item.cards.length)}。`
      ),
      ...(item.cards.length > 0
        ? [
            fact(
              `history.${item.historyId}.cards`,
              'HISTORY',
              `这条记录中能看到的卡牌：${item.cards.map(formatHistoryCard).join('；')}。`
            ),
          ]
        : []),
      fact(
        `history.${item.historyId}.freshness`,
        'HISTORY',
        '这只是过去的记录。判断卡牌现在在哪里、还剩多少资源以及能做什么时，以当前局面和当前选择为准。'
      ),
    ],
  };
}

function buildSeatZoneFacts(
  side: 'self' | 'opponent',
  sideLabel: string,
  seat: AiObservedSeat
): readonly AiSemanticFact[] {
  const facts: AiSemanticFact[] = [];
  const stage = readStage(seat);
  const stageMembers = STAGE_SLOTS.flatMap((slot) => {
    const card = stage[slot];
    return card ? [`${slotLabel(slot)}=${formatCard(card)}`] : [];
  });
  facts.push(
    fact(
      `state.${side}.stage.summary`,
      'STATE',
      `${sideLabel}场上共有 ${String(stageMembers.length)} 名成员${stageMembers.length > 0 ? `：${stageMembers.join('，')}；当前公开场面强度为${formatStageStrength(summarizeStageStrength(stage))}` : '，舞台为空'}。`
    )
  );
  for (const slot of STAGE_SLOTS) {
    const card = stage[slot];
    const stageZone = findZone(seat, `MEMBER_${slot}`);
    const energyBelow =
      stageZone?.visibleCards.filter((candidate) => candidate.role === 'ENERGY_BELOW') ?? [];
    const membersBelow =
      stageZone?.visibleCards.filter((candidate) => candidate.role === 'MEMBER_BELOW') ?? [];
    const attachmentText = card
      ? `；其下方有 ${String(energyBelow.length)} 张能量、${String(membersBelow.length)} 张成员卡${membersBelow.length > 0 ? `（${membersBelow.map((candidate) => formatCard(candidate)).join('；')}）` : ''}`
      : '';
    facts.push(
      fact(
        `state.${side}.stage.${slot.toLowerCase()}`,
        'STATE',
        card
          ? `${sideLabel}${slotLabel(slot)}成员区是${formatCard(card, true)}，状态${orientationLabel(card.orientation)}${attachmentText}。`
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
  const mainPhaseActionBoundary =
    decision.kind === 'MAIN_PHASE' ? '手牌里没有对应 actionId 的成员现在不能登场。' : '';
  const baseFact = fact(
    'decision.base',
    'DECISION',
    `现在只需要处理${decisionKindLabel(decision.kind)}；${decision.mandatory ? '必须完成这次选择' : '规则允许跳过时可以不做'}。下面是这个窗口的完整合法选择，只能使用其中列出的编号。${mainPhaseActionBoundary}处理完成后，等待系统根据新局面给出下一次选择。`
  );
  const facts: AiSemanticFact[] = [baseFact];
  const requiredFactIds = ['decision.base'];
  if (decision.effectSource) {
    facts.push(fact('decision.source', 'CARD', describeEffectSource(observation)));
    requiredFactIds.push('decision.source');
  }
  if (decision.effectText || decision.stepText) {
    facts.push(
      fact(
        'decision.effect',
        'DECISION',
        `当前效果卡文：${singleLine(decision.effectText ?? '未提供')}；当前步骤：${singleLine(decision.stepText ?? '未提供')}。`
      )
    );
    requiredFactIds.push('decision.effect');
  }
  if (decision.input) {
    facts.push(fact('decision.constraints', 'DECISION', describeDecisionInput(decision.input)));
    requiredFactIds.push('decision.constraints');
    if (decision.input.kind === 'CARD_SELECTION' && decision.input.groups?.length) {
      const groupFacts = buildGroupConstraintFacts(decision.input.groups);
      facts.push(...groupFacts);
      requiredFactIds.push(...groupFacts.map((item) => item.factId));
    }
  }
  if (decision.authorityScore !== undefined) {
    facts.push(
      fact(
        'decision.authority_score',
        'DECISION',
        `游戏已经算出的待确认分数是 ${String(decision.authorityScore)}。`
      )
    );
  }
  if (decision.setCount !== undefined && decision.setLimit !== undefined) {
    facts.push(
      fact(
        'decision.live_set_limit',
        'DECISION',
        `当前已放置 ${String(decision.setCount)} 张 LIVE，这次最多可以放置 ${String(decision.setLimit)} 张。`
      )
    );
  }

  const choices: AiSemanticChoice[] = [
    ...decision.candidates.map((candidate, index) =>
      buildCandidateChoice(observation, candidate, index)
    ),
    ...decision.options.map((option, index) => buildOptionChoice(observation, option, index)),
    ...buildSlotChoices(decision.input?.slots ?? []),
    ...buildStageFormationPlacementChoices(observation),
    ...decision.actions.map((action, index) => buildActionChoice(observation, action, index)),
    ...buildOptionalSkipChoices(observation),
    ...buildSyntheticSelectionChoices(observation),
  ];

  return {
    kind: decision.kind,
    instruction: decisionInstruction(decision.kind),
    requiredFactIds,
    facts,
    choices,
  };
}

function buildCandidateChoice(
  observation: AiObservation,
  candidate: AiObservedCandidate,
  index: number
): AiSemanticChoice {
  const description = candidate.card
    ? formatCard(candidate.card, true)
    : '身份尚未公开的卡；不能猜测它的卡名、编号、类型或卡文';
  const location = candidate.location
    ? `，当前位于${formatLocation(observation, candidate.location)}`
    : '';
  const prefix = `decision.candidate.${String(index + 1)}`;
  const facts = [
    fact(
      `${prefix}.identity`,
      'CARD',
      `卡牌选项 ${candidate.candidateId} 是${description}${location}。`
    ),
  ];
  if (observation.decision.kind === 'ACTIVE_EFFECT') {
    const groups = observation.decision.input?.groups?.filter((group) =>
      group.candidateIds.includes(candidate.candidateId)
    );
    const groupMembership = groups?.length
      ? `，并同时计入${groups.map((group) => `${group.groupId} 的 ${String(group.minCount)}～${String(group.maxCount)} 项限制`).join('、')}`
      : '';
    const submissionConstraint = groups?.length ? '总数与每组限制' : '当前步骤的选择数量限制';
    facts.push(
      fact(
        `${prefix}.role`,
        'CONSEQUENCE',
        `选择 ${candidate.candidateId} 表示让${sourceShortLabel(observation)}的当前效果处理这张卡，当前步骤是「${singleLine(observation.decision.stepText ?? '未提供')}」${groupMembership}。一次选择必须满足${submissionConstraint}，处理完成后卡牌区域或状态才会改变。`
      )
    );
  }
  if (observation.decision.kind === 'SUCCESS_LIVE_SELECTION') {
    const liveRuntime = describeLiveRuntime(candidate.card);
    facts.push(
      fact(
        `${prefix}.live_result`,
        'DECISION',
        `卡牌 ${candidate.candidateId} 当前判定为${candidate.card?.judgmentResult === true ? '成功' : candidate.card?.judgmentResult === false ? '失败' : '未提供'}；${liveRuntime ? `本张卡的修正为${liveRuntime}；` : ''}本回合总分仍以 state.live_result 显示的总分为准。`
      ),
      fact(
        `${prefix}.role`,
        'CONSEQUENCE',
        `选择 ${candidate.candidateId} 会把这张卡从我方 LIVE 区放入成功 LIVE 区；本轮其余 LIVE 不会一起成功，回合结束处理时会进入休息室。`
      )
    );
  }
  return choice(
    'CANDIDATE',
    candidate.candidateId,
    `卡牌 ${candidate.candidateId}：${description}${location}`,
    facts
  );
}

function buildOptionChoice(
  observation: AiObservation,
  option: AiObservation['decision']['options'][number],
  index: number
): AiSemanticChoice {
  const label = singleLine(option.label);
  const prefix = `decision.option.${String(index + 1)}`;
  const facts = [
    fact(`${prefix}.meaning`, 'DECISION', `选项 ${option.optionId} 表示「${label}」。`),
  ];
  if (observation.decision.kind === 'ACTIVE_EFFECT') {
    facts.push(
      fact(
        `${prefix}.consequence`,
        'CONSEQUENCE',
        `选择此项会为${sourceShortLabel(observation)}执行「${label}」；若文字包含支付或放置，这是当前能力自己的费用或处理，不是目标卡的能力。完成后再看新局面。`
      )
    );
  }
  return choice('OPTION', option.optionId, `选择选项「${label}」`, facts);
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

function buildStageFormationPlacementChoices(
  observation: AiObservation
): readonly AiSemanticChoice[] {
  const input = observation.decision.input;
  if (observation.decision.kind !== 'ACTIVE_EFFECT' || input?.kind !== 'STAGE_FORMATION') {
    return [];
  }
  const members = input.members ?? [];
  const slots = input.slots ?? [];
  return members.flatMap((member, memberIndex) => {
    const candidate = observation.decision.candidates.find(
      (item) => item.candidateId === member.candidateId
    );
    const card = candidate?.card;
    const stageZone = findZone(
      observation.seats[observation.viewerSeat],
      `MEMBER_${member.originalSlot}`
    );
    const energyBelowCount =
      stageZone?.visibleCards.filter((item) => item.role === 'ENERGY_BELOW').length ?? 0;
    const memberBelowCount =
      stageZone?.visibleCards.filter((item) => item.role === 'MEMBER_BELOW').length ?? 0;
    const source = card ? formatCard(card) : `卡牌 ${member.candidateId}`;
    return slots.map((toSlot) => {
      const prefix = `decision.placement.${String(memberIndex + 1)}.${toSlot.toLowerCase()}`;
      const stays = member.originalSlot === toSlot;
      const title = `${source}：${slotLabel(member.originalSlot)}→${slotLabel(toSlot)}`;
      return choice('PLACEMENT', stagePlacementReferenceId(member.candidateId, toSlot), title, [
        fact(
          `${prefix}.meaning`,
          'DECISION',
          `${member.candidateId} 是当前${slotLabel(member.originalSlot)}的${source}；这项配对表示${stays ? `保留在${slotLabel(toSlot)}` : `移动到${slotLabel(toSlot)}`}。`
        ),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          `一次站位选择要为每名场上成员指定不同的目标成员区；选择完成后，${source}${stays ? '保持原位' : `会与其他成员一起从${slotLabel(member.originalSlot)}调整到${slotLabel(toSlot)}`}，其下方 ${String(energyBelowCount)} 张能量与 ${String(memberBelowCount)} 张成员卡也会跟着移动。`
        ),
      ]);
    });
  });
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
      const stageStrengthBefore = summarizeStageStrength(stageBefore);
      const stageStrengthAfter = summarizeStageStrength(stageAfter);
      title = `将${sourceCard ? formatCard(sourceCard) : `卡牌 ${action.candidateId ?? '未知'}`}登场到${slotLabel(targetSlot)}成员区`;
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
            ? `实际登场的是${formatCard(sourceCard)}，它自己的卡文是「${singleLine(sourceCard.text)}」。被换手成员的能力不会转给这张新登场的卡。`
            : `本次登场的卡是${sourceCard ? formatCard(sourceCard) : '未识别的卡牌'}；当前公开卡文没有能力文本。能力只属于实际登场的卡，不能把被换手成员的能力转给它。`
        ),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          `完成这个动作后：${replacedCards.length > 0 ? `换手替换${replacedCards.map(({ slot, card }) => `${slotLabel(slot)}的${formatCard(card)}`).join('、')}并将其放入休息室` : '不替换舞台成员'}；场上成员从 ${String(countStageMembers(selfSeat))} 名变为 ${String(countStageMembersFromMap(stageAfter))} 名，登场后舞台为${formatStage(stageAfter)}；按当前可见数值估算，场面强度从${formatStageStrength(stageStrengthBefore)}变为${formatStageStrength(stageStrengthAfter)}，新成员的登场效果和登场后才出现的持续修正尚未计入。若这些有效费用之后不变，下回合可作为换手减免基础的成员为${formatRelayBases(stageAfter)}。活跃能量从 ${String(activeEnergy)} 变为 ${String(Math.max(0, activeEnergy - energyCost))}，待机能量增加 ${String(energyCost)}；手牌从 ${String(handCount)} 变为 ${String(Math.max(0, handCount - 1))}，休息室从 ${String(waitingCount)} 变为 ${String(waitingCount + replacedCards.length)}。本回合新登场所在的${slotLabel(targetSlot)}成员区不能再次用于普通成员登场；若触发登场效果，先处理效果，之后系统才会重新列出主要阶段动作。`
        )
      );
      return choice('ACTION', action.actionId, title, facts, [
        `${prefix}.choice`,
        `${prefix}.source_boundary`,
        `${prefix}.consequence`,
      ]);
    }
    case 'ACTIVATE_ABILITY':
      title = `发动${sourceCard ? formatCard(sourceCard) : `卡牌 ${action.candidateId ?? '未知'}`}的起动能力`;
      {
        const abilityText = singleLine(action.label ?? sourceCard?.text ?? '未提供');
        facts.push(
          fact(`${prefix}.choice`, 'DECISION', `${title}；完整能力文本是「${abilityText}」。`),
          fact(
            `${prefix}.consequence`,
            'CONSEQUENCE',
            describeActivatedAbilityConsequence(observation, source, sourceCard, abilityText)
          )
        );
      }
      break;
    case 'BEGIN_SPECIAL_MEMBER_PLAY':
      title = `开始${sourceCard ? formatCard(sourceCard) : `卡牌 ${action.candidateId ?? '未知'}`}的特殊登场流程`;
      facts.push(
        fact(
          `${prefix}.choice`,
          'DECISION',
          `${title}，目标是${slotLabel(action.targetSlot ?? 'CENTER')}成员区；流程标签为「${singleLine(action.label ?? '未提供')}」。`
        ),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          '选择后会进入特殊登场的确认步骤；到时再从新列表中选择卡牌和支付费用。'
        )
      );
      break;
    case 'END_MAIN_PHASE':
      {
        const self = observation.seats[observation.viewerSeat];
        const handCount = findZone(self, 'HAND')?.count ?? 0;
        const activeEnergyCount = countCardsByOrientation(findZone(self, 'ENERGY_ZONE'), 'ACTIVE');
        title = '结束主要阶段';
        facts.push(
          fact(
            `${prefix}.choice`,
            'DECISION',
            '结束主要阶段，不再进行本阶段的成员登场或起动能力。'
          ),
          fact(
            `${prefix}.consequence`,
            'CONSEQUENCE',
            `结束后将进入后续阶段；我方会以当前 ${String(countStageMembers(self))} 名场上成员、${String(handCount)} 张手牌和 ${String(activeEnergyCount)} 张活跃能量继续本回合。结束后这些能量不能再用于本回合的成员登场或起动能力；只有后续效果明确出现支付窗口时才能继续使用，下个自己的活跃阶段仍会按规则恢复能量。`
          )
        );
      }
      break;
    case 'SET_LIVE': {
      const setCount = observation.decision.setCount ?? 0;
      const handCount = findZone(observation.seats[observation.viewerSeat], 'HAND')?.count ?? 0;
      title = `盖放${sourceCard ? formatCard(sourceCard) : `卡牌 ${action.candidateId ?? '未知'}`}到 LIVE 区`;
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', `${title}。`),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          `完成后，LIVE 区盖放数从 ${String(setCount)} 变为 ${String(setCount + 1)}，手牌从 ${String(handCount)} 变为 ${String(Math.max(0, handCount - 1))}；卡牌保持背面，不会因此向对手公开身份。`
        )
      );
      break;
    }
    case 'UNSET_LIVE': {
      const setCount = observation.decision.setCount ?? 0;
      const handCount = findZone(observation.seats[observation.viewerSeat], 'HAND')?.count ?? 0;
      title = `将${sourceCard ? formatCard(sourceCard) : `卡牌 ${action.candidateId ?? '未知'}`}从 LIVE 区收回手牌`;
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', `${title}。`),
        fact(
          `${prefix}.consequence`,
          'CONSEQUENCE',
          `完成后，LIVE 区盖放数从 ${String(setCount)} 变为 ${String(Math.max(0, setCount - 1))}，手牌从 ${String(handCount)} 变为 ${String(handCount + 1)}。`
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
          '确认后结束当前玩家的 LIVE 放置，进入下一处理步骤。'
        )
      );
      break;
    default:
      title = action.label ? singleLine(action.label) : `选择动作 ${action.kind}`;
      facts.push(
        fact(`${prefix}.choice`, 'DECISION', `${title}。`),
        fact(`${prefix}.consequence`, 'CONSEQUENCE', '这个动作完成后，先看新的局面，再决定下一步。')
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
      ? [{ id: 'CONFIRM_JUDGMENT', text: '确认当前 LIVE 判定结果' }]
      : decision.kind === 'SCORE_CONFIRMATION'
        ? [{ id: 'CONFIRM_SCORE', text: '确认当前 LIVE 总分' }]
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
        `${text}${describeSyntheticSelectionConsequence(observation, id)}；处理完成后再根据新局面决定下一步。`
      ),
    ])
  );
}

function buildOptionalSkipChoices(observation: AiObservation): readonly AiSemanticChoice[] {
  const decision = observation.decision;
  if (decision.kind === 'MULLIGAN') {
    return [
      choice('SELECTION', 'MULLIGAN_KEEP_ALL', '不换牌并保留全部当前手牌', [
        fact(
          'decision.selection.mulligan_keep_all.consequence',
          'CONSEQUENCE',
          '不填写卡牌编号表示不换牌；当前手牌全部保留，也不会支付资源。'
        ),
      ]),
    ];
  }
  if (decision.kind !== 'ACTIVE_EFFECT' || decision.input?.canSkip !== true) return [];
  const source = sourceShortLabel(observation);
  const step = singleLine(decision.stepText ?? '当前效果步骤');
  switch (decision.input.kind) {
    case 'CARD_SELECTION':
      return [
        choice('SELECTION', 'SKIP_EFFECT_CARDS', '不选择卡牌并跳过当前可选处理', [
          fact(
            'decision.selection.skip_effect_cards.consequence',
            'CONSEQUENCE',
            `不填写卡牌编号表示${source}跳过步骤「${step}」；之前已经支付的费用和已经发生的变化不会撤销。`
          ),
        ]),
      ];
    case 'OPTION_SELECTION':
      return [
        choice('SELECTION', 'SKIP_EFFECT_OPTIONS', '不选择选项并不发动当前可选处理', [
          fact(
            'decision.selection.skip_effect_options.consequence',
            'CONSEQUENCE',
            `不填写选项编号表示${source}不执行步骤「${step}」中的可选内容，也不会支付这个选项写明的费用。`
          ),
        ]),
      ];
    case 'STAGE_FORMATION':
      return [
        choice('SELECTION', 'CONFIRM_EFFECT', '不进行本次可选站位变换', [
          fact(
            'decision.selection.skip_stage_formation.consequence',
            'CONSEQUENCE',
            `选择 CONFIRM_EFFECT 表示${source}保持当前站位；如果选择 SET_STAGE_FORMATION，就必须写出每名场上成员的新位置，不能遗漏成员。`
          ),
        ]),
      ];
    case 'SLOT_SELECTION':
      return [
        choice('SELECTION', 'CONFIRM_EFFECT', '不选择成员区并跳过当前可选处理', [
          fact(
            'decision.selection.skip_effect_slot.consequence',
            'CONSEQUENCE',
            `选择 CONFIRM_EFFECT 表示${source}在步骤「${step}」中不选择成员区。`
          ),
        ]),
      ];
    default:
      return [];
  }
}

function syntheticActiveEffectSelections(
  inputKind: AiObservedDecisionInput['kind'] | undefined
): readonly { readonly id: string; readonly text: string }[] {
  switch (inputKind) {
    case 'CONFIRM':
      return [{ id: 'CONFIRM_EFFECT', text: '确认并继续处理当前效果' }];
    case 'NUMBER_INPUT':
      return [{ id: 'SELECT_EFFECT_NUMBER', text: '在当前允许范围内输入数值' }];
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

function describeActivatedAbilityConsequence(
  observation: AiObservation,
  source: AiObservedCandidate | undefined,
  sourceCard: AiObservedCard | undefined,
  abilityText: string
): string {
  const separatorIndex = abilityText.indexOf('：');
  const costText = separatorIndex >= 0 ? abilityText.slice(0, separatorIndex) : null;
  const effectText = separatorIndex >= 0 ? abilityText.slice(separatorIndex + 1) : abilityText;
  const sourceLocation = source?.location;
  const self = observation.seats[observation.viewerSeat];
  const sourceIsOwnStageMember =
    sourceLocation?.ownerSeat === observation.viewerSeat &&
    sourceLocation.role === 'PRIMARY' &&
    sourceLocation.zoneKey.startsWith('MEMBER_');
  const sendsSourceToWaitingRoom = /将此成员从舞台放置入休息室/u.test(abilityText);

  if (sourceIsOwnStageMember && sendsSourceToWaitingRoom) {
    const stageBefore = countStageMembers(self);
    const stageAfter = Math.max(0, stageBefore - 1);
    const waitingBefore = findZone(self, 'WAITING_ROOM')?.count ?? 0;
    const emptyStageWarning =
      stageAfter === 0
        ? '我方舞台会变为空，后续 LIVE 将失去这名成员提供的 HEART、BLADE 和卡效；后半段结果尚未发生。'
        : '我方场上成员会减少 1 名，并失去这名成员当前提供的 HEART、BLADE 和卡效；后半段结果尚未发生。';
    const recoveryClarification = /从自己的休息室.*加入手牌/u.test(effectText)
      ? '后半段是从休息室选择卡加入手牌，不是在手牌中检索；只有下一步列出的卡才是合法目标。来源成员进入休息室后可能成为目标，仍以下一步列表为准。'
      : '之后才处理冒号后的效果，具体目标以下一步列表为准。';
    return `这项能力会先支付冒号前的费用「${singleLine(costText ?? abilityText)}」：${sourceCard ? formatCard(sourceCard) : '这名来源成员'}会立即从${formatLocation(observation, sourceLocation)}进入我方休息室。场上成员从 ${String(stageBefore)} 名变为 ${String(stageAfter)} 名，休息室从 ${String(waitingBefore)} 张变为 ${String(waitingBefore + 1)} 张。${emptyStageWarning}${recoveryClarification}`;
  }

  return costText
    ? `发动后会先支付冒号前的费用「${singleLine(costText)}」，再处理冒号后的效果「${singleLine(effectText)}」。不要把下一步尚未选择的目标或收益当作已经得到；完成后再看新局面。`
    : '发动后会按完整卡文处理这项能力。若随后出现新的支付或选择步骤，只能使用下一步列出的选项；不要把尚未完成的收益当作已经得到。';
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

function countStageMembers(seat: AiObservedSeat): number {
  return countStageMembersFromMap(readStage(seat));
}

function countStageMembersFromMap(
  stage: Readonly<Record<(typeof STAGE_SLOTS)[number], AiObservedCard | undefined>>
): number {
  return STAGE_SLOTS.filter((slot) => stage[slot] !== undefined).length;
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
  const stats = card.cardType === 'LIVE' ? formatLiveStats(card) : formatMemberStats(card);
  const text = includeText && card.text ? `，卡文「${singleLine(card.text)}」` : '';
  const runtime = describeLiveRuntime(card);
  return `${card.cardCode}${stats}「${singleLine(card.name)}」${text}${runtime}`;
}

function formatMemberStats(card: AiObservedCard): string {
  if (card.cardType !== 'MEMBER') return '';
  const parts: string[] = [];
  if (card.cost !== undefined) parts.push(`费用 ${String(card.cost)}`);
  if (card.effectiveCost !== undefined && card.effectiveCost !== card.cost) {
    parts.push(`当前有效费用 ${String(card.effectiveCost)}`);
  }
  if (card.blade !== undefined) parts.push(`BLADE ${String(card.blade)}`);
  if (card.hearts?.length) parts.push(`HEART ${formatHeartIcons(card.hearts)}`);
  return parts.length > 0 ? ` ${parts.join('，')}` : '';
}

function formatLiveStats(card: AiObservedCard): string {
  const parts: string[] = [];
  if (card.score !== undefined) parts.push(`分数 ${String(card.score)}`);
  if (card.requiredHearts) {
    parts.push(
      `需要 HEART ${formatHeartRecord(card.requiredHearts.colorRequirements)}，总数 ${String(card.requiredHearts.totalRequired)}`
    );
  }
  return parts.length > 0 ? ` ${parts.join('，')}` : '';
}

interface StageStrength {
  readonly memberCount: number;
  readonly totalCost: number;
  readonly totalBlade: number;
  readonly hearts: Readonly<Record<string, number>>;
}

function summarizeStageStrength(
  stage: Record<(typeof STAGE_SLOTS)[number], AiObservedCard | undefined>
): StageStrength {
  const hearts: Record<string, number> = {};
  let memberCount = 0;
  let totalCost = 0;
  let totalBlade = 0;
  for (const slot of STAGE_SLOTS) {
    const card = stage[slot];
    if (!card || card.cardType !== 'MEMBER') continue;
    memberCount += 1;
    totalCost += card.effectiveCost ?? card.cost ?? 0;
    totalBlade += card.blade ?? 0;
    for (const heart of card.hearts ?? []) {
      hearts[String(heart.color)] = (hearts[String(heart.color)] ?? 0) + heart.count;
    }
  }
  return { memberCount, totalCost, totalBlade, hearts };
}

function formatStageStrength(strength: StageStrength): string {
  return `成员 ${String(strength.memberCount)} 名、有效费用合计 ${String(strength.totalCost)}、BLADE 合计 ${String(strength.totalBlade)}、HEART ${formatHeartRecord(strength.hearts)}`;
}

function formatRelayBases(
  stage: Record<(typeof STAGE_SLOTS)[number], AiObservedCard | undefined>
): string {
  const bases = STAGE_SLOTS.flatMap((slot) => {
    const card = stage[slot];
    return card
      ? [
          `${slotLabel(slot)}=${String(card.effectiveCost ?? card.cost ?? 0)} 费${card.enteredStageThisTurn ? '（本回合刚登场）' : ''}`,
        ]
      : [];
  });
  return bases.length > 0 ? bases.join('、') : '无';
}

function formatHeartIcons(
  hearts: readonly { readonly color: unknown; readonly count: number }[]
): string {
  return hearts
    .map((heart) => `${heartColorLabel(String(heart.color))}×${String(heart.count)}`)
    .join('、');
}

function formatHeartRecord(hearts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(hearts).filter(([, count]) => count !== 0);
  return entries.length > 0
    ? entries
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([color, count]) => `${heartColorLabel(color)}×${String(count)}`)
        .join('、')
    : '无';
}

function heartColorLabel(color: string): string {
  const labels: Readonly<Record<string, string>> = {
    PINK: '粉红',
    RED: '红',
    ORANGE: '橙',
    YELLOW: '黄',
    GREEN: '绿',
    BLUE: '蓝',
    PURPLE: '紫',
    GRAY: '灰/无色',
    RAINBOW: 'All',
  };
  return labels[color] ?? color;
}

function describeLiveRuntime(card: AiObservedCard | undefined): string {
  if (!card || card.cardType !== 'LIVE') return '';
  const facts: string[] = [];
  if (card.judgmentResult !== undefined) {
    facts.push(`当前判定${card.judgmentResult ? '成功' : '失败'}`);
  }
  if (card.liveScoreDelta !== undefined) {
    facts.push(`卡牌级分数修正 ${formatSignedNumber(card.liveScoreDelta)}`);
  }
  if (card.requirementDeltas?.length) {
    facts.push(
      `必要 HEART 修正 ${card.requirementDeltas
        .map((delta) => `${delta.color} ${formatSignedNumber(delta.countDelta)}`)
        .join('、')}`
    );
  }
  return facts.length > 0 ? `（${facts.join('，')}）` : '';
}

function describeSyntheticSelectionConsequence(observation: AiObservation, id: string): string {
  if (id === 'CONFIRM_JUDGMENT') {
    const liveCards = observation.seats[observation.viewerSeat].zones
      .filter((zone) => zone.zoneKey === 'LIVE_ZONE')
      .flatMap((zone) => zone.visibleCards)
      .filter((card) => card.cardType === 'LIVE');
    return `；规则模式只确认当前自动判定，不修改逐卡结果${liveCards.length ? `：${liveCards.map((card) => formatCard(card)).join('；')}` : ''}`;
  }
  if (id === 'CONFIRM_SCORE') {
    return `；规则模式只确认游戏已经算出的 ${String(observation.decision.authorityScore ?? observation.liveResult?.scores[observation.viewerSeat] ?? 0)} 分，不手动改分`;
  }
  return '';
}

function stagePlacementReferenceId(candidateId: string, slot: SlotPosition): string {
  return `${candidateId}@${slot}`;
}

function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
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

function describeEffectSource(observation: AiObservation): string {
  const source = observation.decision.effectSource;
  if (!source) return '当前没有显示这项效果来自哪张卡。';
  const identity = source.card
    ? formatCard(source.card)
    : source.publicDisplayCardCode
      ? `先前公开过的卡牌 ${source.publicDisplayCardCode}（现在看不到完整正面卡面）`
      : '当前身份没有公开的卡牌';
  const location = source.location
    ? `，现在位于${formatLocation(observation, source.location)}`
    : '；现在看不到它所在的区域或完整卡面';
  return `当前处理的效果来自${identity}，由${seatLabel(observation, source.controllerSeat)}控制${location}。显示的卡文只属于这张来源卡；效果开始处理后，即使来源卡随后离开原区域，效果也不会转给目标卡或自动取消。`;
}

function sourceShortLabel(observation: AiObservation): string {
  const source = observation.decision.effectSource;
  if (source?.card) return formatCard(source.card);
  if (source?.publicDisplayCardCode) return `来源 ${source.publicDisplayCardCode}`;
  return '当前效果来源';
}

function formatLocation(
  observation: AiObservation,
  location: NonNullable<AiObservedCandidate['location']>
): string {
  const owner = location.ownerSeat ? seatLabel(observation, location.ownerSeat) : '共享';
  const inferredSlot =
    location.slot ?? location.zoneKey.match(/^MEMBER_(LEFT|CENTER|RIGHT)$/u)?.[1];
  if (inferredSlot) {
    const slot = slotLabel(inferredSlot);
    if (location.role === 'ENERGY_BELOW') return `${owner}${slot}成员下方能量`;
    if (location.role === 'MEMBER_BELOW') return `${owner}${slot}成员下方成员卡`;
    return `${owner}${slot}成员区`;
  }
  return `${owner}${zoneLabel(location.zoneKey)}`;
}

function historyCategoryLabel(category: AiSelectedHistoryItem['category']): string {
  const labels: Readonly<Record<AiSelectedHistoryItem['category'], string>> = {
    MULLIGAN: '换牌',
    MEMBER_PLAY: '成员登场',
    ABILITY: '能力发动',
    LIVE_SET: 'LIVE 放置',
    SUCCESS_LIVE: '成功 LIVE 选择',
    RESOURCE_PAYMENT: '资源支付',
    EFFECT_SELECTION: '效果选择',
    FORMATION: '站位变换',
    VISIBLE_STATE_CHANGE: '可见状态变化',
  };
  return labels[category];
}

function normalizeAcceptedHistorySummary(summary: string): string {
  const normalized = singleLine(summary).replace(/^权威已接受/u, '已完成');
  return /[。！？]$/u.test(normalized) ? normalized : `${normalized}。`;
}

function visibleHistorySummary(reasonCode: string, cardCount: number): string {
  const zoneKey = reasonCode.match(/^VISIBLE_(.+)_ADDITION$/u)?.[1];
  const zone = zoneKey ? zoneLabel(zoneKey) : '公开区域';
  return `${zone}新看到 ${String(cardCount)} 张卡；这里只知道卡牌变得可见，不知道它们为什么移动`;
}

function describeSelectionGroups(groups: AiObservedDecisionInput['groups']): string {
  if (!groups || groups.length === 0) return '';
  return `；分组限制为${groups
    .map(
      (group) =>
        `${group.groupId}（从 ${group.candidateIds.join('、') || '空列表'} 中最少选 ${String(group.minCount)} 项、最多选 ${String(group.maxCount)} 项）`
    )
    .join('；')}`;
}

function buildGroupConstraintFacts(
  groups: NonNullable<AiObservedDecisionInput['groups']>
): readonly AiSemanticFact[] {
  return groups.map((group, index) =>
    fact(
      `decision.group.${String(index + 1)}.constraint`,
      'DECISION',
      `${group.groupId} 只能从 ${group.candidateIds.join('、') || '空列表'} 中选择：最少 ${String(group.minCount)} 项、最多 ${String(group.maxCount)} 项。一张卡如果同时出现在多组，会同时计入这些组。`
    )
  );
}

function describeDecisionInput(input: NonNullable<AiObservation['decision']['input']>): string {
  switch (input.kind) {
    case 'CARD_SELECTION':
    case 'OPTION_SELECTION':
      return `这一步最少选择 ${String(input.minSelections ?? input.requiredCount ?? 0)} 项，最多选择 ${String(input.maxSelections ?? input.requiredCount ?? 0)} 项，${input.canSkip ? '可以跳过' : '不能跳过'}${input.ordered ? '，先后顺序会影响处理' : ''}${describeSelectionGroups(input.groups)}${input.groups?.length ? '；一次选完并同时满足总数和每组数量，不能分几次选择' : ''}。`;
    case 'SLOT_SELECTION':
      return `本步骤可选成员区：${(input.slots ?? []).map(slotLabel).join('、')}；${input.canSkip ? '允许跳过' : '不允许跳过'}。`;
    case 'NUMBER_INPUT':
      return `本步骤输入数值，范围 ${String(input.min ?? '无下限')} 至 ${String(input.max ?? '无上限')}，${input.integerOnly ? '必须为整数' : '允许非整数'}。`;
    case 'STAGE_FORMATION':
      return `本步骤同时安排全部当前舞台成员的最终站位，可用成员区：${(input.slots ?? []).map(slotLabel).join('、')}；每名成员必须恰好出现一次，目标成员区不能重复；${input.canSkip ? '允许用 CONFIRM_EFFECT 整体跳过' : '不允许跳过'}。`;
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
      return '比较每个 actionId 已列出的支付、换手对象、场面强度变化、手牌变化和后续合法动作空间，然后选择一个当前 actionId；不要把尚未列出的未来动作当成已经可执行。';
    case 'LIVE_SET':
      return '选择一个盖放、收回或确认 LIVE 的 actionId。';
    case 'MULLIGAN':
      return '选择要换回卡组的 candidateId；未选中的手牌保留。';
    case 'COST_PAYMENT':
      return '按当前要求选择足够数量的可支付能量 candidateId。';
    case 'SUCCESS_LIVE_SELECTION':
      return '从判定成功的 LIVE 中选择一个 candidateId。';
    case 'ACTIVE_EFFECT':
      return '先确认当前效果来源、卡文、步骤和选择数量；只完成这一效果步骤，不把目标能力误归给其他卡牌，也不预先处理后续步骤。';
    case 'SPECIAL_MEMBER_PLAY':
      return '确认这次特殊登场选择，或取消特殊登场。';
    default:
      return '确认游戏已经算出的结果，或继续当前阶段。';
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
  const labels: Readonly<Record<string, string>> = {
    NONE: '无独立子阶段',
    MULLIGAN_FIRST_PLAYER: '先攻玩家换牌',
    MULLIGAN_SECOND_PLAYER: '后攻玩家换牌',
    LIVE_SET_FIRST_PLAYER: '先攻玩家放置 LIVE',
    LIVE_SET_FIRST_DRAW: '先攻玩家 LIVE 放置后抽卡',
    LIVE_SET_SECOND_PLAYER: '后攻玩家放置 LIVE',
    LIVE_SET_SECOND_DRAW: '后攻玩家 LIVE 放置后抽卡',
    PERFORMANCE_REVEAL: '翻开 LIVE',
    PERFORMANCE_LIVE_START_EFFECTS: '处理 LIVE 开始能力',
    PERFORMANCE_JUDGMENT: 'LIVE 判定',
    RESULT_FIRST_SUCCESS_EFFECTS: '处理先攻玩家的 LIVE 成功能力',
    RESULT_SECOND_SUCCESS_EFFECTS: '处理后攻玩家的 LIVE 成功能力',
    RESULT_SCORE_CONFIRM: '双方确认 LIVE 分数',
    RESULT_ANIMATION: '回合结果展示',
    RESULT_SETTLEMENT: '处理成功 LIVE',
    RESULT_TURN_END: '回合结束处理',
    CHECK_TIMING: '检查时机',
    EFFECT_WINDOW: '处理卡牌效果',
    FREE_ACTION: '自由行动时机',
  };
  return labels[subPhase] ?? subPhase.replaceAll('_', ' ');
}

function windowTypeLabel(windowType: string): string {
  const labels: Readonly<Record<string, string>> = {
    SERIAL_PRIORITY: '依次操作的步骤',
    INSPECTION: '查看卡牌的步骤',
    SIMULTANEOUS_COMMIT: '双方都要确认的步骤',
    RESULT_ANIMATION: '结果展示',
    SHARED_CONFIRM: '双方共同确认的步骤',
  };
  return labels[windowType] ?? '当前步骤';
}

function windowStatusLabel(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    OPENED: '刚开始',
    UPDATED: '等待继续处理',
    CLOSED: '已经结束',
  };
  return labels[status] ?? '进行中';
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
    MEMBER_LEFT: '左侧成员区',
    MEMBER_CENTER: '中央成员区',
    MEMBER_RIGHT: '右侧成员区',
    RESOLUTION_ZONE: '解决区',
    INSPECTION_ZONE: '检视区',
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
