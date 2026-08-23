import { createHash } from 'node:crypto';
import { getBaseCardCode } from '../../shared/utils/card-code.js';

export const DECK_FINGERPRINT_VERSION = 'loveca-deck-v1';
export const DEFAULT_MEMBER_DISTANCE_WEIGHT = 1;
export const DEFAULT_LIVE_DISTANCE_WEIGHT = 3;
export const DEFAULT_MAX_DECK_DISTANCE = 42;
export const DEFAULT_MIN_DECK_MARGIN = 3;

export type DeckCardType = 'MEMBER' | 'LIVE';

export interface DeckCardInput {
  readonly baseCardCode?: string;
  readonly cardCode?: string;
  readonly cardType: DeckCardType;
  readonly count: number;
}

export interface NormalizedDeckEntry {
  readonly baseCardCode: string;
  readonly count: number;
}

export interface NormalizedDeck {
  readonly members: readonly NormalizedDeckEntry[];
  readonly lives: readonly NormalizedDeckEntry[];
  readonly memberTotal: number;
  readonly liveTotal: number;
  readonly deckTotal: number;
}

export type DeckValidationIssueCode =
  | 'EMPTY_CARD_CODE'
  | 'CARD_CODE_MISMATCH'
  | 'INVALID_CARD_TYPE'
  | 'INVALID_CARD_COUNT'
  | 'CARD_TYPE_CONFLICT'
  | 'CARD_COUNT_EXCEEDED'
  | 'INVALID_MEMBER_TOTAL'
  | 'INVALID_LIVE_TOTAL'
  | 'INVALID_DECK_TOTAL';

export interface DeckValidationIssue {
  readonly code: DeckValidationIssueCode;
  readonly message: string;
  readonly cardIndex?: number;
  readonly baseCardCode?: string;
}

export type DeckNormalizationResult =
  | { readonly valid: true; readonly deck: NormalizedDeck }
  | { readonly valid: false; readonly issues: readonly DeckValidationIssue[] };

export interface DeckFingerprintMapping {
  readonly mappingId: string;
  readonly deckFingerprint: string;
  readonly archetypeId: string;
}

export interface DeckArchetypeTemplate {
  readonly templateId: string;
  readonly archetypeId: string;
  readonly cards: readonly DeckCardInput[];
  readonly active?: boolean;
}

export interface DeckRuleCardConstraint {
  readonly baseCardCode: string;
  readonly cardType?: DeckCardType;
  readonly minCount?: number;
  readonly maxCount?: number;
}

export interface DeckRuleCountSumConstraint {
  readonly baseCardCodes: readonly string[];
  readonly cardType?: DeckCardType;
  readonly minCount?: number;
  readonly maxCount?: number;
}

/**
 * Rules deliberately use a small data-only vocabulary. There are no callbacks
 * or arbitrary expressions, so a published classifier snapshot is serializable
 * and can be replayed later.
 */
export interface DeckArchetypeRuleConditions {
  readonly includeAll?: readonly DeckRuleCardConstraint[];
  readonly includeAny?: readonly DeckRuleCardConstraint[];
  readonly forbidAny?: readonly DeckRuleCardConstraint[];
  readonly countSums?: readonly DeckRuleCountSumConstraint[];
}

export interface DeckArchetypeRule {
  readonly ruleId: string;
  readonly archetypeId: string;
  /** 数字越小优先级越高；只在同一最高优先级命中集内判断冲突。 */
  readonly priority?: number;
  readonly enabled?: boolean;
  readonly conditions: DeckArchetypeRuleConditions;
}

export interface DeckClassifierSnapshot {
  readonly classifierVersion: string;
  readonly manualMappings?: readonly DeckFingerprintMapping[];
  readonly exactMappings?: readonly DeckFingerprintMapping[];
  readonly rules?: readonly DeckArchetypeRule[];
  readonly templates?: readonly DeckArchetypeTemplate[];
  readonly memberDistanceWeight?: number;
  readonly liveDistanceWeight?: number;
  readonly maxDistance?: number;
  readonly minMargin?: number;
}

export type DeckClassificationMethod =
  'MANUAL' | 'EXACT' | 'RULE' | 'SIMILARITY' | 'UNKNOWN' | 'AMBIGUOUS' | 'INVALID';

export type DeckClassificationDecision = 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS' | 'INVALID';

export type DeckClassificationReason =
  | 'MANUAL_MAPPING_MATCH'
  | 'EXACT_FINGERPRINT_MATCH'
  | 'SPECIAL_RULE_MATCH'
  | 'SIMILARITY_ACCEPTED'
  | 'NO_ACTIVE_TEMPLATES'
  | 'DISTANCE_EXCEEDED'
  | 'MARGIN_TOO_SMALL'
  | 'RULE_CONFLICT'
  | 'MANUAL_MAPPING_CONFLICT'
  | 'EXACT_MAPPING_CONFLICT'
  | 'INVALID_DECK'
  | 'INVALID_TEMPLATE';

export interface MatchedRuleEvidence {
  readonly ruleId: string;
  readonly archetypeId: string;
}

export interface SimilarityCandidateEvidence {
  readonly archetypeId: string;
  readonly distance: number;
  readonly nearestTemplateId: string;
  readonly nearestTemplateFingerprint: string;
}

export interface SimilarityEvidence {
  readonly memberWeight: number;
  readonly liveWeight: number;
  readonly maxDistance: number;
  readonly minMargin: number;
  readonly candidates: readonly SimilarityCandidateEvidence[];
  readonly best: SimilarityCandidateEvidence | null;
  readonly secondBest: SimilarityCandidateEvidence | null;
  readonly margin: number | null;
}

export interface DeckClassificationEvidence {
  readonly precedence: readonly DeckClassificationMethod[];
  readonly matchedMappingIds: readonly string[];
  readonly matchedRules: readonly MatchedRuleEvidence[];
  readonly similarity: SimilarityEvidence | null;
  readonly validationIssues: readonly DeckValidationIssue[];
  readonly invalidTemplateIds: readonly string[];
}

export interface DeckClassificationResult {
  readonly decision: DeckClassificationDecision;
  readonly method: DeckClassificationMethod;
  readonly accepted: boolean;
  readonly archetypeId: string | null;
  readonly reason: DeckClassificationReason;
  readonly classifierVersion: string;
  readonly fingerprintVersion: typeof DECK_FINGERPRINT_VERSION;
  readonly deckFingerprint: string | null;
  readonly normalizedDeck: NormalizedDeck | null;
  readonly evidence: DeckClassificationEvidence;
}

interface PreparedTemplate {
  readonly templateId: string;
  readonly archetypeId: string;
  readonly deck: NormalizedDeck;
  readonly fingerprint: string;
}

const CLASSIFICATION_PRECEDENCE: readonly DeckClassificationMethod[] = [
  'MANUAL',
  'EXACT',
  'RULE',
  'SIMILARITY',
  'UNKNOWN',
  'AMBIGUOUS',
  'INVALID',
];

export function normalizeDeck(cards: readonly DeckCardInput[]): DeckNormalizationResult {
  const issues: DeckValidationIssue[] = [];
  const countsByType: Record<DeckCardType, Map<string, number>> = {
    MEMBER: new Map<string, number>(),
    LIVE: new Map<string, number>(),
  };
  const cardTypesByCode = new Map<string, DeckCardType>();

  cards.forEach((card, cardIndex) => {
    if (card.cardType !== 'MEMBER' && card.cardType !== 'LIVE') {
      issues.push({
        code: 'INVALID_CARD_TYPE',
        message: `卡组卡项 ${cardIndex} 的 cardType 无效`,
        cardIndex,
      });
      return;
    }
    if (!Number.isInteger(card.count) || card.count <= 0) {
      issues.push({
        code: 'INVALID_CARD_COUNT',
        message: `卡组卡项 ${cardIndex} 的 count 必须是正整数`,
        cardIndex,
      });
      return;
    }

    const suppliedBase = normalizeBaseCardCode(card.baseCardCode);
    const derivedBase = normalizeBaseCardCode(card.cardCode);
    const baseCardCode = suppliedBase ?? derivedBase;
    if (!baseCardCode) {
      issues.push({
        code: 'EMPTY_CARD_CODE',
        message: `卡组卡项 ${cardIndex} 缺少有效卡牌编号`,
        cardIndex,
      });
      return;
    }
    if (suppliedBase && derivedBase && suppliedBase !== derivedBase) {
      issues.push({
        code: 'CARD_CODE_MISMATCH',
        message: `卡组卡项 ${cardIndex} 的 baseCardCode 与 cardCode 不一致`,
        cardIndex,
        baseCardCode,
      });
      return;
    }

    const priorType = cardTypesByCode.get(baseCardCode);
    if (priorType && priorType !== card.cardType) {
      issues.push({
        code: 'CARD_TYPE_CONFLICT',
        message: `基础编号 ${baseCardCode} 同时被标记为 MEMBER 与 LIVE`,
        cardIndex,
        baseCardCode,
      });
      return;
    }
    cardTypesByCode.set(baseCardCode, card.cardType);
    const typeCounts = countsByType[card.cardType];
    typeCounts.set(baseCardCode, (typeCounts.get(baseCardCode) ?? 0) + card.count);
  });

  const members = toNormalizedEntries(countsByType.MEMBER);
  const lives = toNormalizedEntries(countsByType.LIVE);
  for (const card of [...members, ...lives]) {
    if (card.count > 4) {
      issues.push({
        code: 'CARD_COUNT_EXCEEDED',
        message: `基础编号 ${card.baseCardCode} 最多允许 4 张，实际为 ${card.count} 张`,
        baseCardCode: card.baseCardCode,
      });
    }
  }
  const memberTotal = sumCounts(members);
  const liveTotal = sumCounts(lives);
  const deckTotal = memberTotal + liveTotal;

  if (memberTotal !== 48) {
    issues.push({
      code: 'INVALID_MEMBER_TOTAL',
      message: `主卡组必须包含 48 张 MEMBER，实际为 ${memberTotal} 张`,
    });
  }
  if (liveTotal !== 12) {
    issues.push({
      code: 'INVALID_LIVE_TOTAL',
      message: `主卡组必须包含 12 张 LIVE，实际为 ${liveTotal} 张`,
    });
  }
  if (deckTotal !== 60) {
    issues.push({
      code: 'INVALID_DECK_TOTAL',
      message: `主卡组必须包含 60 张卡，实际为 ${deckTotal} 张`,
    });
  }

  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    deck: { members, lives, memberTotal, liveTotal, deckTotal },
  };
}

/**
 * Canonical UTF-8 payload used by ranked_deck_observations. MEMBER and LIVE
 * entries share one globally sorted list because the persisted v1 protocol
 * fingerprints only baseCardCode + count. The version travels beside the hash
 * in classifier results; the stored fingerprint remains sha256:<64hex> for
 * compatibility with existing observations and seed templates.
 */
export function serializeDeckFingerprintPayload(deck: NormalizedDeck): string {
  return JSON.stringify(
    [...deck.members, ...deck.lives]
      .sort((left, right) => compareStrings(left.baseCardCode, right.baseCardCode))
      .map(({ baseCardCode, count }) => ({ baseCardCode, count }))
  );
}

export function fingerprintNormalizedDeck(deck: NormalizedDeck): string {
  const digest = createHash('sha256')
    .update(serializeDeckFingerprintPayload(deck), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

export function calculateDeckDistance(
  left: NormalizedDeck,
  right: NormalizedDeck,
  memberWeight = DEFAULT_MEMBER_DISTANCE_WEIGHT,
  liveWeight = DEFAULT_LIVE_DISTANCE_WEIGHT
): number {
  return (
    memberWeight * replacementDistance(left.members, right.members) +
    liveWeight * replacementDistance(left.lives, right.lives)
  );
}

export function classifyDeck(
  cards: readonly DeckCardInput[],
  snapshot: DeckClassifierSnapshot
): DeckClassificationResult {
  const normalized = normalizeDeck(cards);
  if (!normalized.valid) {
    return resultFor({
      snapshot,
      decision: 'INVALID',
      method: 'INVALID',
      archetypeId: null,
      reason: 'INVALID_DECK',
      deckFingerprint: null,
      normalizedDeck: null,
      validationIssues: normalized.issues,
    });
  }

  const deck = normalized.deck;
  const deckFingerprint = fingerprintNormalizedDeck(deck);
  const preparedTemplates = prepareTemplates(snapshot.templates ?? []);
  if (preparedTemplates.invalidTemplateIds.length > 0) {
    return resultFor({
      snapshot,
      decision: 'INVALID',
      method: 'INVALID',
      archetypeId: null,
      reason: 'INVALID_TEMPLATE',
      deckFingerprint,
      normalizedDeck: deck,
      invalidTemplateIds: preparedTemplates.invalidTemplateIds,
    });
  }

  const manualMatches = matchingMappings(snapshot.manualMappings ?? [], deckFingerprint);
  const manualDecision = resolveExactEvidence(
    manualMatches,
    'MANUAL',
    'MANUAL_MAPPING_MATCH',
    'MANUAL_MAPPING_CONFLICT'
  );
  if (manualDecision) {
    return resultFor({
      snapshot,
      ...manualDecision,
      deckFingerprint,
      normalizedDeck: deck,
      matchedMappingIds: manualMatches.map((mapping) => mapping.mappingId),
    });
  }

  const templateExactMappings: DeckFingerprintMapping[] = preparedTemplates.templates
    .filter((template) => template.fingerprint === deckFingerprint)
    .map((template) => ({
      mappingId: `template:${template.templateId}`,
      deckFingerprint: template.fingerprint,
      archetypeId: template.archetypeId,
    }));
  const exactMatches = [
    ...matchingMappings(snapshot.exactMappings ?? [], deckFingerprint),
    ...templateExactMappings,
  ];
  const exactDecision = resolveExactEvidence(
    exactMatches,
    'EXACT',
    'EXACT_FINGERPRINT_MATCH',
    'EXACT_MAPPING_CONFLICT'
  );
  if (exactDecision) {
    return resultFor({
      snapshot,
      ...exactDecision,
      deckFingerprint,
      normalizedDeck: deck,
      matchedMappingIds: exactMatches.map((mapping) => mapping.mappingId),
    });
  }

  const allMatchedRules = (snapshot.rules ?? [])
    .filter((rule) => rule.enabled !== false && matchesRule(deck, rule.conditions))
    .map((rule) => ({
      ruleId: rule.ruleId,
      archetypeId: rule.archetypeId,
      priority: Number.isSafeInteger(rule.priority) ? (rule.priority as number) : 100,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        compareStrings(left.archetypeId, right.archetypeId) ||
        compareStrings(left.ruleId, right.ruleId)
    );
  const winningPriority = allMatchedRules[0]?.priority;
  const matchedRules = allMatchedRules
    .filter((rule) => rule.priority === winningPriority)
    .map(({ ruleId, archetypeId }) => ({ ruleId, archetypeId }));
  if (matchedRules.length > 0) {
    const ruleArchetypes = unique(matchedRules.map((rule) => rule.archetypeId));
    if (ruleArchetypes.length > 1) {
      return resultFor({
        snapshot,
        decision: 'AMBIGUOUS',
        method: 'AMBIGUOUS',
        archetypeId: null,
        reason: 'RULE_CONFLICT',
        deckFingerprint,
        normalizedDeck: deck,
        matchedRules,
      });
    }
    return resultFor({
      snapshot,
      decision: 'CLASSIFIED',
      method: 'RULE',
      archetypeId: ruleArchetypes[0] ?? null,
      reason: 'SPECIAL_RULE_MATCH',
      deckFingerprint,
      normalizedDeck: deck,
      matchedRules,
    });
  }

  const similarity = buildSimilarityEvidence(deck, preparedTemplates.templates, snapshot);
  if (!similarity.best) {
    return resultFor({
      snapshot,
      decision: 'UNKNOWN',
      method: 'UNKNOWN',
      archetypeId: null,
      reason: 'NO_ACTIVE_TEMPLATES',
      deckFingerprint,
      normalizedDeck: deck,
      similarity,
    });
  }
  if (similarity.best.distance > similarity.maxDistance) {
    return resultFor({
      snapshot,
      decision: 'UNKNOWN',
      method: 'UNKNOWN',
      archetypeId: null,
      reason: 'DISTANCE_EXCEEDED',
      deckFingerprint,
      normalizedDeck: deck,
      similarity,
    });
  }
  if (similarity.margin !== null && similarity.margin < similarity.minMargin) {
    return resultFor({
      snapshot,
      decision: 'AMBIGUOUS',
      method: 'AMBIGUOUS',
      archetypeId: null,
      reason: 'MARGIN_TOO_SMALL',
      deckFingerprint,
      normalizedDeck: deck,
      similarity,
    });
  }
  return resultFor({
    snapshot,
    decision: 'CLASSIFIED',
    method: 'SIMILARITY',
    archetypeId: similarity.best.archetypeId,
    reason: 'SIMILARITY_ACCEPTED',
    deckFingerprint,
    normalizedDeck: deck,
    similarity,
  });
}

function normalizeBaseCardCode(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? getBaseCardCode(trimmed) : null;
}

function toNormalizedEntries(counts: ReadonlyMap<string, number>): readonly NormalizedDeckEntry[] {
  return [...counts.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([baseCardCode, count]) => ({ baseCardCode, count }));
}

function sumCounts(entries: readonly NormalizedDeckEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

function replacementDistance(
  left: readonly NormalizedDeckEntry[],
  right: readonly NormalizedDeckEntry[]
): number {
  const leftCounts = new Map(left.map((entry) => [entry.baseCardCode, entry.count]));
  const rightCounts = new Map(right.map((entry) => [entry.baseCardCode, entry.count]));
  const cardCodes = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  let absoluteDifference = 0;
  for (const cardCode of cardCodes) {
    absoluteDifference += Math.abs(
      (leftCounts.get(cardCode) ?? 0) - (rightCounts.get(cardCode) ?? 0)
    );
  }
  return absoluteDifference / 2;
}

function prepareTemplates(templates: readonly DeckArchetypeTemplate[]): {
  readonly templates: readonly PreparedTemplate[];
  readonly invalidTemplateIds: readonly string[];
} {
  const prepared: PreparedTemplate[] = [];
  const invalidTemplateIds: string[] = [];
  for (const template of templates) {
    if (template.active === false) continue;
    const normalized = normalizeDeck(template.cards);
    if (!normalized.valid) {
      invalidTemplateIds.push(template.templateId);
      continue;
    }
    prepared.push({
      templateId: template.templateId,
      archetypeId: template.archetypeId,
      deck: normalized.deck,
      fingerprint: fingerprintNormalizedDeck(normalized.deck),
    });
  }
  return {
    templates: prepared.sort((left, right) => compareStrings(left.templateId, right.templateId)),
    invalidTemplateIds: invalidTemplateIds.sort(compareStrings),
  };
}

function matchingMappings(
  mappings: readonly DeckFingerprintMapping[],
  deckFingerprint: string
): readonly DeckFingerprintMapping[] {
  return mappings
    .filter((mapping) => mapping.deckFingerprint === deckFingerprint)
    .sort((left, right) => compareStrings(left.mappingId, right.mappingId));
}

function resolveExactEvidence(
  matches: readonly DeckFingerprintMapping[],
  successMethod: 'MANUAL' | 'EXACT',
  successReason: 'MANUAL_MAPPING_MATCH' | 'EXACT_FINGERPRINT_MATCH',
  conflictReason: 'MANUAL_MAPPING_CONFLICT' | 'EXACT_MAPPING_CONFLICT'
): Pick<
  DeckClassificationResult,
  'decision' | 'method' | 'accepted' | 'archetypeId' | 'reason'
> | null {
  if (matches.length === 0) return null;
  const archetypeIds = unique(matches.map((mapping) => mapping.archetypeId));
  if (archetypeIds.length > 1) {
    return {
      decision: 'AMBIGUOUS',
      method: 'AMBIGUOUS',
      accepted: false,
      archetypeId: null,
      reason: conflictReason,
    };
  }
  return {
    decision: 'CLASSIFIED',
    method: successMethod,
    accepted: true,
    archetypeId: archetypeIds[0] ?? null,
    reason: successReason,
  };
}

function matchesRule(deck: NormalizedDeck, conditions: DeckArchetypeRuleConditions): boolean {
  if (conditions.includeAll?.some((constraint) => !matchesCardConstraint(deck, constraint))) {
    return false;
  }
  if (
    conditions.includeAny &&
    conditions.includeAny.length > 0 &&
    !conditions.includeAny.some((constraint) => matchesCardConstraint(deck, constraint))
  ) {
    return false;
  }
  if (conditions.forbidAny?.some((constraint) => matchesCardConstraint(deck, constraint))) {
    return false;
  }
  if (conditions.countSums?.some((constraint) => !matchesCountSum(deck, constraint))) {
    return false;
  }
  return true;
}

function matchesCardConstraint(deck: NormalizedDeck, constraint: DeckRuleCardConstraint): boolean {
  const baseCardCode = normalizeBaseCardCode(constraint.baseCardCode);
  if (!baseCardCode) return false;
  const count = cardCount(deck, baseCardCode, constraint.cardType);
  const minCount = constraint.minCount ?? 1;
  return count >= minCount && (constraint.maxCount === undefined || count <= constraint.maxCount);
}

function matchesCountSum(deck: NormalizedDeck, constraint: DeckRuleCountSumConstraint): boolean {
  const count = constraint.baseCardCodes.reduce((sum, cardCode) => {
    const baseCardCode = normalizeBaseCardCode(cardCode);
    return sum + (baseCardCode ? cardCount(deck, baseCardCode, constraint.cardType) : 0);
  }, 0);
  const minCount = constraint.minCount ?? 0;
  return count >= minCount && (constraint.maxCount === undefined || count <= constraint.maxCount);
}

function cardCount(
  deck: NormalizedDeck,
  baseCardCode: string,
  cardType: DeckCardType | undefined
): number {
  const memberCount =
    cardType === 'LIVE'
      ? 0
      : (deck.members.find((entry) => entry.baseCardCode === baseCardCode)?.count ?? 0);
  const liveCount =
    cardType === 'MEMBER'
      ? 0
      : (deck.lives.find((entry) => entry.baseCardCode === baseCardCode)?.count ?? 0);
  return memberCount + liveCount;
}

function buildSimilarityEvidence(
  deck: NormalizedDeck,
  templates: readonly PreparedTemplate[],
  snapshot: DeckClassifierSnapshot
): SimilarityEvidence {
  const memberWeight = snapshot.memberDistanceWeight ?? DEFAULT_MEMBER_DISTANCE_WEIGHT;
  const liveWeight = snapshot.liveDistanceWeight ?? DEFAULT_LIVE_DISTANCE_WEIGHT;
  const maxDistance = snapshot.maxDistance ?? DEFAULT_MAX_DECK_DISTANCE;
  const minMargin = snapshot.minMargin ?? DEFAULT_MIN_DECK_MARGIN;
  const nearestByArchetype = new Map<string, SimilarityCandidateEvidence>();

  for (const template of templates) {
    const candidate: SimilarityCandidateEvidence = {
      archetypeId: template.archetypeId,
      distance: calculateDeckDistance(deck, template.deck, memberWeight, liveWeight),
      nearestTemplateId: template.templateId,
      nearestTemplateFingerprint: template.fingerprint,
    };
    const prior = nearestByArchetype.get(template.archetypeId);
    if (!prior || compareSimilarityCandidates(candidate, prior) < 0) {
      nearestByArchetype.set(template.archetypeId, candidate);
    }
  }

  const candidates = [...nearestByArchetype.values()].sort(compareSimilarityCandidates);
  const best = candidates[0] ?? null;
  const secondBest = candidates[1] ?? null;
  return {
    memberWeight,
    liveWeight,
    maxDistance,
    minMargin,
    candidates,
    best,
    secondBest,
    margin: best && secondBest ? secondBest.distance - best.distance : null,
  };
}

function compareSimilarityCandidates(
  left: SimilarityCandidateEvidence,
  right: SimilarityCandidateEvidence
): number {
  return (
    left.distance - right.distance ||
    compareStrings(left.archetypeId, right.archetypeId) ||
    compareStrings(left.nearestTemplateId, right.nearestTemplateId)
  );
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resultFor(
  input: Pick<
    DeckClassificationResult,
    'decision' | 'method' | 'archetypeId' | 'reason' | 'deckFingerprint' | 'normalizedDeck'
  > & {
    readonly snapshot: DeckClassifierSnapshot;
    readonly matchedMappingIds?: readonly string[];
    readonly matchedRules?: readonly MatchedRuleEvidence[];
    readonly similarity?: SimilarityEvidence | null;
    readonly validationIssues?: readonly DeckValidationIssue[];
    readonly invalidTemplateIds?: readonly string[];
  }
): DeckClassificationResult {
  return {
    decision: input.decision,
    method: input.method,
    accepted: input.decision === 'CLASSIFIED',
    archetypeId: input.archetypeId,
    reason: input.reason,
    classifierVersion: input.snapshot.classifierVersion,
    fingerprintVersion: DECK_FINGERPRINT_VERSION,
    deckFingerprint: input.deckFingerprint,
    normalizedDeck: input.normalizedDeck,
    evidence: {
      precedence: CLASSIFICATION_PRECEDENCE,
      matchedMappingIds: input.matchedMappingIds ?? [],
      matchedRules: input.matchedRules ?? [],
      similarity: input.similarity ?? null,
      validationIssues: input.validationIssues ?? [],
      invalidTemplateIds: input.invalidTemplateIds ?? [],
    },
  };
}
