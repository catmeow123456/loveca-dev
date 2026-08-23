export type DeckClassifierDisplayMode = 'HIDDEN' | 'PLAYER_EQUAL' | 'MATCH_EQUAL' | 'BOTH';
export type DeckEnvironmentSection = 'USAGE' | 'WINNER' | 'TOP_RANKED';

export interface DeckArchetypeEnvironmentSampleView {
  readonly settledMatchCount: number;
  readonly analyzedMatchCount: number;
  readonly deckObservationCount: number;
  readonly assignedDeckObservationCount: number;
  readonly recognizedDeckObservationCount: number;
  readonly playerCount: number;
  readonly winningPlayerCount: number;
  /** 当前排行榜前 N 中实际满足排行榜门槛的人数。 */
  readonly topRankedEligiblePlayerCount: number;
  /** 上述玩家中至少有一个可分析卡组席位的人数。 */
  readonly topRankedAnalyzedPlayerCount: number;
  /** 同时具备两席长期卡组观察的对局 / 已结算对局。 */
  readonly observationCoverageRate: number;
  /** 已产生分类结果且未被排除的席位 / 已观察席位。 */
  readonly classificationCoverageRate: number;
}

export interface DeckArchetypeEnvironmentEntryView {
  readonly archetypeId: string;
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly color: string;
  readonly representativeCardCode: string | null;
  readonly representativeImageFilename: string | null;
  readonly sortOrder: number;
  readonly classificationStatus: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS';
  readonly appearanceCount: number;
  readonly winnerCount: number;
  readonly playerCount: number;
  /** 每名玩家先归一化自己的出场分布，再对玩家等权平均。 */
  readonly playerEqualUsageRate: number;
  /** 每个有效席位权重相同。 */
  readonly matchEqualUsageRate: number;
  /** 每名至少获胜一次的玩家先归一化胜方卡组分布，再对玩家等权平均。 */
  readonly playerEqualWinnerRate: number;
  /** 每场有唯一胜者的有效对局权重相同。 */
  readonly matchEqualWinnerRate: number;
  /** winnerCount / appearanceCount；镜像对局自然贡献一胜一负。 */
  readonly winRate: number | null;
  readonly nonMirrorAppearanceCount: number;
  readonly nonMirrorWinRate: number | null;
  readonly mirrorAppearanceCount: number;
  /** 当前排行榜前 N 玩家先各自归一化赛季使用分布，再对玩家等权。 */
  readonly topRankedPlayerEqualUsageRate: number;
}

export interface DeckArchetypeEnvironmentView {
  readonly available: boolean;
  readonly seasonId: string;
  readonly displayMode: DeckClassifierDisplayMode;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
  readonly release: {
    readonly id: string;
    readonly version: number;
    readonly publishedAt: number;
  } | null;
  readonly sample: DeckArchetypeEnvironmentSampleView;
  readonly archetypes: readonly DeckArchetypeEnvironmentEntryView[];
}

export interface DeckClassifierArchetypeView {
  readonly id: string;
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly description: string;
  readonly color: string;
  readonly representativeCardCode: string | null;
  readonly sortOrder: number;
  readonly lifecycle: 'ACTIVE' | 'ARCHIVED';
  readonly templateCount: number;
  readonly ruleCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DeckClassifierTemplateCardView {
  readonly baseCardCode: string;
  readonly cardType: 'MEMBER' | 'LIVE';
  readonly count: number;
}

export interface DeckClassifierTemplateView {
  readonly id: string;
  readonly archetypeId: string;
  readonly name: string;
  readonly deckFingerprint: string;
  readonly cards: readonly DeckClassifierTemplateCardView[];
  readonly sourceKind: 'MATCH_OBSERVATION' | 'SEED_PACKAGE' | 'MANUAL';
  readonly sourceMatchId: string | null;
  readonly sourceSeat: 'FIRST' | 'SECOND' | null;
  readonly sourceNote: string;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DeckClassifierRuleCardConstraintView {
  readonly baseCardCode: string;
  readonly cardType?: 'MEMBER' | 'LIVE';
  readonly minCount?: number;
  readonly maxCount?: number;
}

export interface DeckClassifierRuleCountSumView {
  readonly baseCardCodes: readonly string[];
  readonly cardType?: 'MEMBER' | 'LIVE';
  readonly minCount?: number;
  readonly maxCount?: number;
}

export interface DeckClassifierRuleDefinitionView {
  readonly includeAll?: readonly DeckClassifierRuleCardConstraintView[];
  readonly includeAny?: readonly DeckClassifierRuleCardConstraintView[];
  readonly forbidAny?: readonly DeckClassifierRuleCardConstraintView[];
  readonly countSums?: readonly DeckClassifierRuleCountSumView[];
}

export interface DeckClassifierRuleView {
  readonly id: string;
  readonly archetypeId: string;
  readonly name: string;
  readonly priority: number;
  readonly definition: DeckClassifierRuleDefinitionView;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DeckClassifierReleaseView {
  readonly id: string;
  readonly version: number;
  readonly status: 'BUILDING' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED';
  readonly configHash: string;
  readonly reason: string;
  readonly publishedAt: number;
  readonly activatedAt: number | null;
}

export interface DeckClassificationRunView {
  readonly id: string;
  readonly releaseId: string;
  readonly releaseVersion: number;
  readonly status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly trigger:
    'RELEASE_PUBLISHED' | 'MANUAL_RECLASSIFY' | 'MANUAL_OVERRIDE' | 'AUTO_NEW_OBSERVATIONS';
  readonly scopeSeasonId: string | null;
  readonly reason: string;
  readonly totalCount: number;
  readonly processedCount: number;
  readonly classifiedCount: number;
  readonly unknownCount: number;
  readonly ambiguousCount: number;
  readonly invalidCount: number;
  readonly excludedCount: number;
  readonly changedCount: number;
  readonly errorMessage: string | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

export interface DeckClassifierReviewItemView {
  readonly deckFingerprint: string;
  readonly status: 'UNKNOWN' | 'AMBIGUOUS';
  readonly occurrenceCount: number;
  readonly playerCount: number;
  readonly seasonCount: number;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly cards: readonly DeckClassifierTemplateCardView[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface DeckClassifierOverrideView {
  readonly id: string;
  readonly deckFingerprint: string;
  readonly archetypeId: string | null;
  readonly targetStatus: 'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED';
  readonly reason: string;
  readonly appliesToFutureReleases: boolean;
  readonly releaseId: string | null;
  readonly cards: readonly DeckClassifierTemplateCardView[];
  readonly createdAt: number;
}

export interface DeckClassifierOverviewView {
  readonly displayMode: DeckClassifierDisplayMode;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
  readonly draftRevision: number;
  readonly activeRelease: DeckClassifierReleaseView | null;
  readonly archetypes: readonly DeckClassifierArchetypeView[];
  readonly templates: readonly DeckClassifierTemplateView[];
  readonly rules: readonly DeckClassifierRuleView[];
  readonly releases: readonly DeckClassifierReleaseView[];
  readonly runs: readonly DeckClassificationRunView[];
  readonly reviewQueue: readonly DeckClassifierReviewItemView[];
  readonly overrides: readonly DeckClassifierOverrideView[];
}

export interface DeckClassifierPreviewView {
  readonly uniqueFingerprintCount: number;
  readonly observationCount: number;
  readonly classifiedCount: number;
  readonly unknownCount: number;
  readonly ambiguousCount: number;
  readonly invalidCount: number;
  readonly excludedCount: number;
  readonly changedCount: number;
  readonly coverageRate: number;
  readonly archetypeCounts: readonly {
    readonly archetypeId: string;
    readonly name: string;
    readonly count: number;
  }[];
}
