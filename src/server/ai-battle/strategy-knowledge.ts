import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from './phase-zero-baseline.js';

export const AI_COMPACT_RULES_VERSION = 'ai-battle.compact-rules/v1' as const;
export const AI_MUSE_STARTER_PLAYBOOK_VERSION = 'ai-battle.playbook.muse-starter/v1' as const;
export const AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION =
  'ai-battle.playbook.green-hasunosora-b6/v1' as const;

export interface AiStrategyDirective {
  readonly directiveId: string;
  readonly text: string;
}

export interface AiCompactRules {
  readonly version: typeof AI_COMPACT_RULES_VERSION;
  readonly authorityBoundary: readonly AiStrategyDirective[];
  readonly turnFlow: readonly AiStrategyDirective[];
  readonly decisionRules: readonly AiStrategyDirective[];
  readonly victoryRules: readonly AiStrategyDirective[];
}

export interface AiPlaybookCardRole {
  readonly cardCode: string;
  readonly label: string;
  readonly roles: readonly string[];
}

export interface AiDeckPlaybook {
  readonly version:
    typeof AI_MUSE_STARTER_PLAYBOOK_VERSION | typeof AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION;
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly certifiedContentHash: string;
  readonly archetype: string;
  readonly primaryPlan: readonly AiStrategyDirective[];
  readonly mulliganPlan: readonly AiStrategyDirective[];
  readonly mainPhasePlan: readonly AiStrategyDirective[];
  readonly livePlan: readonly AiStrategyDirective[];
  readonly optionalEffectPlan: readonly AiStrategyDirective[];
  readonly recoveryPlan: readonly AiStrategyDirective[];
  readonly cardRoles: readonly AiPlaybookCardRole[];
}

export const AI_COMPACT_RULES: AiCompactRules = {
  version: AI_COMPACT_RULES_VERSION,
  authorityBoundary: [
    directive(
      'AUTHORITY_ONLY',
      'The authority session decides legality, costs, effects, scores, movement, and victory.'
    ),
    directive(
      'CONTRACT_ONLY',
      'Choose only candidate, action, option, slot, number, or ordering identifiers present in the current decision.'
    ),
    directive(
      'NO_RAW_COMMANDS',
      'Never invent a GameCommand, card object identifier, zone movement, cost result, or rule ruling.'
    ),
    directive(
      'LATEST_OBSERVATION',
      'Treat the latest observation and current decision as truth; strategy knowledge never overrides them.'
    ),
  ],
  turnFlow: [
    directive(
      'PENDING_FIRST',
      'Resolve the current pending ability, active effect, payment, or confirmation before considering later phase plans.'
    ),
    directive(
      'ACTIVE_PHASE',
      'At the active phase, the rules restore eligible members and energy; do not spend resources before the main phase exists.'
    ),
    directive(
      'MAIN_PHASE',
      'During the main phase, play affordable members, use legal activated abilities when their value exceeds their costs, then end the phase.'
    ),
    directive(
      'LIVE_SET',
      'During LIVE set, place only legal cards offered by the contract, up to the current limit, and confirm when the intended set is complete.'
    ),
    directive(
      'PERFORMANCE',
      'LIVE reveal, LIVE-start abilities, cheer, judgment, success abilities, score confirmation, and settlement occur in authority order.'
    ),
  ],
  decisionRules: [
    directive(
      'ENERGY',
      'Active energy pays costs; waiting energy cannot pay until an effect or active phase restores it.'
    ),
    directive(
      'STAGE',
      'The stage has left, center, and right member slots. Preserve strategically important center and source-slot abilities.'
    ),
    directive(
      'HEARTS',
      'A LIVE succeeds only when authority judgment satisfies its required colored and total Hearts after modifiers.'
    ),
    directive(
      'OPTIONAL_COSTS',
      'Decline optional costs when the promised gain is unavailable or would consume a more important hand or energy resource.'
    ),
    directive(
      'HIDDEN_INFORMATION',
      'Do not infer the identity or order of hidden cards; anonymous candidates are strategically indistinguishable unless public constraints differ.'
    ),
    directive(
      'ONE_DECISION',
      'Return exactly one legal structured selection for the current decision and reassess after authority execution.'
    ),
  ],
  victoryRules: [
    directive(
      'LIVE_ROUND_WINNER',
      'Authority compares the current LIVE totals and determines which player may place a successful LIVE into the success zone.'
    ),
    directive(
      'THREE_SUCCESS_LIVES',
      'The primary victory objective is to reach three cards in the success LIVE zone before the opponent.'
    ),
  ],
};

export const AI_DECK_PLAYBOOKS: Readonly<Record<AiBattlePhaseZeroDeckKey, AiDeckPlaybook>> = {
  MUSE_STARTER: {
    version: AI_MUSE_STARTER_PLAYBOOK_VERSION,
    deckKey: 'MUSE_STARTER',
    certifiedContentHash: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.contentHash,
    archetype:
      'Balanced μ’s starter deck with low-cost setup, top-deck selection, recovery, and a success-zone payoff.',
    primaryPlan: [
      directive(
        'MUSE_BUILD_STAGE',
        'Establish affordable members first, then upgrade into higher-blade members without exhausting every card in hand.'
      ),
      directive(
        'MUSE_FIND_LIVES',
        'Use look-top and waiting-room recovery to maintain at least one LIVE option for upcoming LIVE-set windows.'
      ),
      directive(
        'MUSE_SCALE_SUCCESS',
        'After gaining successful LIVE cards, prioritize the Honoka and late LIVE payoffs that scale with the success zone.'
      ),
      directive(
        'MUSE_FILL_WAITING',
        'Treat controlled milling and discarded low-value cards as setup for recovery and the late waiting-room threshold.'
      ),
    ],
    mulliganPlan: [
      directive(
        'MUSE_KEEP_EARLY_MEMBER',
        'Keep at least one cost-2 or cost-4 member so the first main phases can develop the stage.'
      ),
      directive(
        'MUSE_KEEP_LIVE',
        'Keep one realistically achievable LIVE; avoid keeping several high-requirement LIVE cards without early members.'
      ),
      directive(
        'MUSE_RETURN_REDUNDANT_TOP_END',
        'Return redundant cost-11-or-higher members and duplicate late LIVE cards before returning the only early play.'
      ),
    ],
    mainPhasePlan: [
      directive(
        'MUSE_OCCUPY_EMPTY_SLOTS',
        'Prefer filling empty stage slots with affordable members before replacing a useful active member.'
      ),
      directive(
        'MUSE_LOOK_TOP_VALUE',
        'Use Umi and the cost-4 look-top members when hand quality is weak or a LIVE/member search materially improves the next window.'
      ),
      directive(
        'MUSE_RECOVERY_VALUE',
        'Use the cost-2 Eri or Hanayo self-send abilities only when the waiting room contains a target worth more than the member being spent.'
      ),
      directive(
        'MUSE_LATE_NICO',
        'Value the cost-15 Nico after the waiting room reaches the 25-card condition; before then, prefer cheaper stage development.'
      ),
    ],
    livePlan: [
      directive(
        'MUSE_EARLY_LIVE',
        'Prefer an achievable lower-requirement LIVE early instead of exposing an ambitious LIVE that current Hearts cannot support.'
      ),
      directive(
        'MUSE_START_DASH',
        'Use START:DASH!! as an early low-score success attempt when it is the most achievable option and value its top-deck arrangement on success.'
      ),
      directive(
        'MUSE_LATE_BOKURA',
        'Prefer 僕らは今のなかで later, when existing success LIVE cards reduce its generic Heart requirement enough to compete safely.'
      ),
      directive(
        'MUSE_MULTI_SET',
        'When several LIVE cards can legally be set, preserve at least one achievable line and avoid committing every future LIVE without benefit.'
      ),
    ],
    optionalEffectPlan: [
      directive(
        'MUSE_DISCARD_FOR_SELECTION',
        'Pay an optional hand discard for look-top selection when the remaining hand still supports the next member play and LIVE set.'
      ),
      directive(
        'MUSE_HEART_COLOR',
        'For Kotori’s LIVE-start Heart choice, choose a color currently missing from the most important revealed LIVE requirement.'
      ),
      directive(
        'MUSE_SUCCESS_SWAP',
        'Use Maki’s LIVE swap only when the revealed hand LIVE is at least as useful in the success zone as the card being returned.'
      ),
    ],
    recoveryPlan: [
      directive(
        'MUSE_NO_LIVE',
        'If no LIVE is in hand, prioritize Umi, Eri/Hanayo recovery, or another legal search before spending resources on a marginal replacement.'
      ),
      directive(
        'MUSE_LOW_HAND',
        'At low hand size, decline optional discards unless they immediately recover or select a needed card.'
      ),
    ],
    cardRoles: [
      cardRole('PL!-sd1-002-SD', 'cost 2 絢瀬 絵里', ['early member', 'member recovery']),
      cardRole('PL!-sd1-004-SD', 'cost 11 園田海未', ['LIVE search', 'midgame blade']),
      cardRole('PL!-sd1-005-SD', 'cost 2 星空 凛', ['early member', 'LIVE recovery']),
      cardRole('PL!-sd1-009-SD', 'cost 15 矢澤 にこ', [
        'late waiting-room payoff',
        'LIVE score modifier',
      ]),
      cardRole('PL!-sd1-001-SD', 'cost 11 高坂 穂乃果', ['success-zone payoff', 'high blade']),
      cardRole('PL!-sd1-019-SD', 'score 1 START:DASH!!', [
        'early achievable LIVE',
        'top-deck setup',
      ]),
      cardRole('PL!-sd1-022-SD', 'score 4 僕らは今のなかで', [
        'late high-score LIVE',
        'success-zone scaling requirement',
      ]),
    ],
  },
  GREEN_HASUNOSORA_B6: {
    version: AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION,
    deckKey: 'GREEN_HASUNOSORA_B6',
    certifiedContentHash: AI_BATTLE_PHASE_ZERO_DECKS.GREEN_HASUNOSORA_B6.contentHash,
    archetype:
      'Green Hasunosora graveyard and relay deck that converts repeated member entries into recovery, blade, and high-scoring LIVE turns.',
    primaryPlan: [
      directive(
        'GREEN_FILL_WAITING',
        'Develop the waiting room deliberately so member/LIVE recovery and conditional LIVE effects become reliable.'
      ),
      directive(
        'GREEN_REPEAT_ENTRIES',
        'Use relay, self-send, recovery, and effect-based play to create additional Hasunosora member entries without losing stage continuity.'
      ),
      directive(
        'GREEN_CENTER_KAHO',
        'When affordable, establish the cost-15 Kaho in center and trigger up to two blade gains through later Hasunosora entries.'
      ),
      directive(
        'GREEN_DISTINCT_STAGE',
        'Build three differently named Hasunosora members when possible to enable Kozue’s total LIVE score bonus.'
      ),
    ],
    mulliganPlan: [
      directive(
        'GREEN_KEEP_LOW_COST',
        'Keep at least one cost-2 or cost-4 member; prioritize cards that seed or select the waiting room.'
      ),
      directive(
        'GREEN_KEEP_LIVE',
        'Keep one achievable LIVE, especially 水彩世界 or アオクハルカ when its condition can be reached.'
      ),
      directive(
        'GREEN_RETURN_TOP_END',
        'Return redundant cost-11-to-15 members unless an early curve and enough future energy are already present.'
      ),
    ],
    mainPhasePlan: [
      directive(
        'GREEN_SEED_WITH_LOW_COST',
        'Use low-cost Kaho, Ginko, and Izumi cards to occupy slots and seed the waiting room before committing expensive payoffs.'
      ),
      directive(
        'GREEN_RELAY_SD1_KAHO',
        'Relay the cost-9 Kaho into a cost-10-or-higher Hasunosora member when restoring two energy enables another meaningful action.'
      ),
      directive(
        'GREEN_RECOVER_SELECTIVELY',
        'Use self-send and recovery abilities only when the waiting room contains a member or LIVE that advances the current plan.'
      ),
      directive(
        'GREEN_CENTER_AND_NAMES',
        'Prefer center for the cost-15 Kaho and preserve three different member names when pursuing Kozue’s score bonus.'
      ),
    ],
    livePlan: [
      directive(
        'GREEN_HANAMUSUBI',
        'Prefer ハナムスビ when other Hasunosora cards already occupy the LIVE zone and its green Heart reduction makes score 6 achievable.'
      ),
      directive(
        'GREEN_AOKUHARUKA',
        'Prefer アオクハルカ after at least three Cerise Bouquet LIVE cards are in the waiting room so it receives score +1.'
      ),
      directive(
        'GREEN_TSUKIYOMI',
        'Use 月夜見海月 when the stage can supply its Hearts and additional cheer can improve judgment without discarding valuable blade-heart cards.'
      ),
      directive(
        'GREEN_SUISAII',
        'Use 水彩世界 as an easy early success attempt and value its successful-cheer recovery of a cost-4-to-9 Hasunosora member.'
      ),
    ],
    optionalEffectPlan: [
      directive(
        'GREEN_DISCARD_AS_RESOURCE',
        'Accept optional hand discard costs when they seed a useful waiting-room target and leave enough cards for the next LIVE set.'
      ),
      directive(
        'GREEN_HIME_ENERGY',
        'Pay Hime’s LIVE-start energy only when blade +2 materially improves the current judgment and does not block a higher-value action.'
      ),
      directive(
        'GREEN_CHEER_SELECTION',
        'Move cheer cards only according to the current LIVE plan; avoid discarding blade-heart cards needed for immediate judgment.'
      ),
    ],
    recoveryPlan: [
      directive(
        'GREEN_NO_ENGINE',
        'Without a waiting-room engine, prioritize Izumi or low-cost milling before expensive recovery cards.'
      ),
      directive(
        'GREEN_LOW_HAND',
        'At low hand size, decline two-card discard recovery unless both recovered groups contain useful legal targets.'
      ),
      directive(
        'GREEN_BROKEN_STAGE',
        'If the distinct-name or center plan breaks, preserve affordable members and pursue the most achievable LIVE rather than forcing the combo.'
      ),
    ],
    cardRoles: [
      cardRole('PL!HS-sd1-001-SD', 'cost 9 日野下花帆', [
        'relay energy recovery',
        'mid-cost bridge',
      ]),
      cardRole('PL!HS-bp6-001-R+', 'cost 4 日野下花帆', ['top-deck selection', 'cheer-card reuse']),
      cardRole('PL!HS-bp5-008-R', 'cost 4 桂城 泉', [
        'high-cost member search',
        'waiting-room setup',
      ]),
      cardRole('PL!HS-pb1-009-R', 'cost 15 日野下花帆', [
        'center payoff',
        'member-entry blade engine',
      ]),
      cardRole('PL!HS-bp1-003-SEC', 'cost 13 乙宗 梢', [
        'distinct-name stage payoff',
        'low-cost recovery',
      ]),
      cardRole('PL!HS-bp5-019-L', 'score 6 ハナムスビ', [
        'primary high-score LIVE',
        'multi-LIVE requirement reduction',
      ]),
      cardRole('PL!HS-bp2-022-L+', 'score 2 アオクハルカ', [
        'waiting-room condition LIVE',
        'score modifier',
      ]),
      cardRole('PL!HS-cl1-009-CL', 'score 1 水彩世界', ['early achievable LIVE', 'cheer recovery']),
    ],
  },
};

export function getAiDeckPlaybook(deckKey: AiBattlePhaseZeroDeckKey): AiDeckPlaybook {
  return AI_DECK_PLAYBOOKS[deckKey];
}

function directive(directiveId: string, text: string): AiStrategyDirective {
  return { directiveId, text };
}

function cardRole(cardCode: string, label: string, roles: readonly string[]): AiPlaybookCardRole {
  return { cardCode, label, roles };
}
