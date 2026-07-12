import {
  BladeHeartEffect,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../shared/types/enums.js';
import {
  isLiveCardData,
  isMemberCardData,
  type BladeHeartItem,
  type HeartIcon,
} from '../entities/card.js';
import type {
  GameState,
  LiveModifierState,
  LiveModifierVisibilityDependency,
  LiveRequirementModifierState,
  LiveResolutionState,
} from '../entities/game.js';
import { getCardById, getOpponent, getPlayerById } from '../entities/game.js';
import { findMemberSlot } from '../entities/player.js';
import { getAllMemberCardIds } from '../entities/zone.js';
import { getBaseCardCode, normalizeCardCode } from '../../shared/utils/card-code.js';
import {
  cardBelongsToGroup,
  cardBelongsToUnit,
  cardNameMatchesAnyAlias,
  hasAtLeastDifferentNamedCards,
} from '../../shared/utils/card-identity.js';
import { toPlayerLocalSlotForControllerPerspective } from '../../shared/utils/slot-perspective.js';
import { hasMemberPositionMovedThisTurn } from './member-turn-state.js';
import { getMemberEffectiveCost } from './member-effective-cost.js';
import { applyHeartRequirementModifiers } from './live-requirement-modifiers.js';
import { sumSuccessfulLiveScore, successLiveScoreAtLeast } from './success-live-score.js';

type ScoreModifierState = Extract<LiveModifierState, { readonly kind: 'SCORE' }>;
type HeartModifierState = Extract<LiveModifierState, { readonly kind: 'HEART' }>;
type MemberOriginalHeartReplacementModifierState = Extract<
  LiveModifierState,
  { readonly kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT' }
>;
type MemberOriginalBladeReplacementModifierState = Extract<
  LiveModifierState,
  { readonly kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT' }
>;
type CheerCardHeartColorReplacementModifierState = Extract<
  LiveModifierState,
  { readonly kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT' }
>;
type BladeModifierState = Extract<LiveModifierState, { readonly kind: 'BLADE' }>;
type CheerCountModifierState = Extract<LiveModifierState, { readonly kind: 'CHEER_COUNT' }>;
type MemberCostModifierState = Extract<LiveModifierState, { readonly kind: 'MEMBER_COST' }>;
type MemberCostSetModifierState = Extract<
  LiveModifierState,
  { readonly kind: 'MEMBER_COST_SET' }
>;
type RequirementModifierState = Extract<LiveModifierState, { readonly kind: 'REQUIREMENT' }>;

type LiveModifierCompatibilityProjection = Pick<
  LiveResolutionState,
  | 'playerScoreBonuses'
  | 'playerHeartBonuses'
  | 'liveRequirementReductions'
  | 'liveRequirementModifiers'
>;

export interface LiveModifierMatch {
  readonly kind?: LiveModifierState['kind'];
  readonly playerId?: string;
  readonly liveCardId?: string;
  readonly sourceCardId?: string;
  readonly targetMemberCardId?: string;
  readonly abilityId?: string;
}

interface ContinuousLiveModifierContext {
  readonly game: GameState;
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly successLiveCount: number;
}

interface ContinuousLiveModifierDefinition {
  readonly cardCodes?: readonly string[];
  readonly baseCardCodes?: readonly string[];
  readonly collect: (context: ContinuousLiveModifierContext) => readonly LiveModifierState[];
}

interface SideSlotBladeContinuousDefinition {
  readonly baseCardCode: string;
  readonly requiredSlot: SlotPosition;
  readonly abilityId: string;
}

interface EnergyThresholdHeartContinuousDefinition {
  readonly baseCardCode: string;
  readonly heartColor: HeartColor;
  readonly abilityId: string;
}

interface ActiveEnergyHeartContinuousDefinition {
  readonly baseCardCode: string;
  readonly heartColor: HeartColor;
  readonly count: number;
  readonly abilityId: string;
}

interface SuccessZoneUnitHeartContinuousDefinition {
  readonly baseCardCode: string;
  readonly unitName: string;
  readonly heartColor: HeartColor;
  readonly abilityId: string;
}

interface StageHeartOpponentLiveRequirementContinuousDefinition {
  readonly baseCardCode: string;
  readonly heartColor: HeartColor;
  readonly abilityId: string;
}

interface SuccessZoneContinuousLiveModifierDefinition extends ContinuousLiveModifierDefinition {
  readonly nonStackingAbilityId?: string;
}

const SP_PB2_023_CONTINUOUS_ENERGY_SIX_EIGHT_GAIN_RED_HEART_ABILITY_ID =
  'PL!SP-pb2-023:continuous-energy-six-eight-gain-red-heart';
const SP_PB2_026_CONTINUOUS_ACTIVE_ENERGY_GAIN_TWO_RED_HEART_ABILITY_ID =
  'PL!SP-pb2-026:continuous-active-energy-gain-two-red-heart';
const SP_PB2_027_CONTINUOUS_ENERGY_SIX_EIGHT_GAIN_YELLOW_HEART_ABILITY_ID =
  'PL!SP-pb2-027:continuous-energy-six-eight-gain-yellow-heart';
const SP_PB2_032_CONTINUOUS_ENERGY_SIX_EIGHT_GAIN_PURPLE_HEART_ABILITY_ID =
  'PL!SP-pb2-032:continuous-energy-six-eight-gain-purple-heart';
const SP_PB2_035_CONTINUOUS_LEFT_SIDE_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!SP-pb2-035:continuous-left-side-gain-two-blade';
const SP_PB2_041_CONTINUOUS_RIGHT_SIDE_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!SP-pb2-041:continuous-right-side-gain-two-blade';
const SP_PR_022_CONTINUOUS_TOTAL_STAGE_SIX_GAIN_RED_YELLOW_HEART_ABILITY_ID =
  'PL!SP-PR-022-PR:continuous-total-stage-six-gain-red-yellow-heart';
const SP_PR_025_CONTINUOUS_ENERGY_EXACT_SEVEN_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!SP-PR-025-PR:continuous-energy-exact-seven-gain-two-blade';
const SP_SD2_004_CONTINUOUS_CENTER_GAIN_FOUR_BLADE_ABILITY_ID =
  'PL!SP-sd2-004:continuous-center-gain-four-blade';
const SP_SD2_008_CONTINUOUS_HIGH_COST_STAGE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID =
  'PL!SP-sd2-008:continuous-high-cost-stage-member-gain-yellow-heart';
const SP_BP2_004_CONTINUOUS_CENTER_HIGHEST_STAGE_COST_GAIN_YELLOW_HEART_ABILITY_ID =
  'PL!SP-bp2-004:continuous-center-highest-stage-cost-gain-yellow-heart';
const BP6_012_CONTINUOUS_SUCCESS_ZONE_PRINTEMPS_CARD_YELLOW_HEART_ABILITY_ID =
  'PL!-bp6-012:continuous-success-zone-printemps-card-yellow-heart';
const BP6_014_CONTINUOUS_SUCCESS_ZONE_LILYWHITE_CARD_PINK_HEART_ABILITY_ID =
  'PL!-bp6-014:continuous-success-zone-lilywhite-card-pink-heart';
const BP6_015_CONTINUOUS_SUCCESS_ZONE_BIBI_CARD_PURPLE_HEART_ABILITY_ID =
  'PL!-bp6-015:continuous-success-zone-bibi-card-purple-heart';
const BP6_009_CONTINUOUS_CENTER_SIDE_PRINTED_BLADE_TWO_SCORE_ABILITY_ID =
  'PL!-bp6-009:continuous-center-side-printed-blade-two-score';
const BP4_005_CONTINUOUS_CENTER_SCORE_ABILITY_ID = 'PL!-bp4-005:continuous-center-score-plus-one';
const BP4_018_CONTINUOUS_SUCCESS_SCORE_LEAD_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!-bp4-018:continuous-success-score-lead-gain-two-blade';
const PL_N_BP4_007_CONTINUOUS_TOTAL_ENERGY_FIFTEEN_GAIN_TWO_RED_HEART_ABILITY_ID =
  'PL!N-bp4-007:continuous-total-energy-fifteen-gain-two-red-heart';
const PL_N_BP4_012_CONTINUOUS_OPPONENT_SUCCESS_SCORE_SIX_LIVE_SCORE_ABILITY_ID =
  'PL!N-bp4-012:continuous-opponent-success-score-six-live-score';
const PL_PB1_002_CONTINUOUS_OPPONENT_WAITING_GAIN_PURPLE_HEART_ABILITY_ID =
  'PL!-pb1-002:continuous-opponent-waiting-gain-purple-heart';
const PL_BP3_002_CONTINUOUS_OPPONENT_WAITING_GAIN_BLADE_ABILITY_ID =
  'PL!-bp3-002:continuous-opponent-waiting-gain-blade';
const PL_N_BP1_012_CONTINUOUS_LIVE_ZONE_THREE_NIJIGASAKI_LIVE_GAIN_ALL_HEART_BLADE_ABILITY_ID =
  'PL!N-bp1-012:continuous-live-zone-three-nijigasaki-live-gain-all-heart-blade';
const PL_N_PB1_007_CONTINUOUS_LIVE_REQUIREMENT_SIX_COLORS_GAIN_ALL_HEART_ABILITY_ID =
  'PL!N-pb1-007:continuous-live-requirement-six-colors-gain-all-heart';
const PL_N_PB1_011_CONTINUOUS_ENERGY_BELOW_GAIN_BLADE_ABILITY_ID =
  'PL!N-pb1-011:continuous-energy-below-gain-blade';
const PL_S_PB1_005_CONTINUOUS_OPPONENT_ENERGY_MORE_GAIN_THREE_BLADE_ABILITY_ID =
  'PL!S-pb1-005:continuous-opponent-energy-more-gain-three-blade';
const PL_S_PB1_009_CONTINUOUS_TOTAL_SUCCESS_LIVE_THREE_GAIN_THREE_BLADE_ABILITY_ID =
  'PL!S-pb1-009:continuous-total-success-live-three-gain-three-blade';
const HS_PB1_022_CONTINUOUS_RURINO_GAIN_TWO_PINK_HEART_ABILITY_ID =
  'PL!HS-pb1-022:continuous-rurino-stage-gain-two-pink-heart';
const HS_PB1_022_CONTINUOUS_MEGU_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!HS-pb1-022:continuous-megu-stage-gain-two-blade';
const SP_BP4_005_CONTINUOUS_ENERGY_TEN_GAIN_THREE_BLADE_ABILITY_ID =
  'PL!SP-bp4-005:continuous-energy-ten-gain-three-blade';
const SP_BP4_003_CONTINUOUS_CENTER_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!SP-bp4-003:continuous-center-gain-two-blade';
const SP_BP4_009_CONTINUOUS_LOWER_STAGE_COST_GAIN_THREE_BLADE_ABILITY_ID =
  'PL!SP-bp4-009:continuous-lower-stage-cost-gain-three-blade';
const SP_BP4_021_CONTINUOUS_MORE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID =
  'PL!SP-bp4-021:continuous-more-energy-gain-purple-heart';
const PL_S_BP5_010_CONTINUOUS_RED_HEART_FIVE_OPPONENT_LIVE_REQUIREMENT_PLUS_ONE_ABILITY_ID =
  'PL!S-bp5-010:continuous-red-heart-five-opponent-live-requirement-plus-one';
const PL_S_BP5_011_CONTINUOUS_BLUE_HEART_FIVE_OPPONENT_LIVE_REQUIREMENT_PLUS_ONE_ABILITY_ID =
  'PL!S-bp5-011:continuous-blue-heart-five-opponent-live-requirement-plus-one';
const SP_BP2_010_CONTINUOUS_OPPONENT_LIVE_REQUIREMENT_PLUS_ONE_ABILITY_ID =
  'PL!SP-bp2-010:continuous-opponent-live-requirement-plus-one';

export interface HeartLiveModifierForMemberOptions {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly hearts: readonly HeartIcon[];
}

export interface AddHeartLiveModifierForMemberResult {
  readonly gameState: GameState;
  readonly modifier: HeartModifierState;
  readonly heartBonus: readonly HeartIcon[];
}

export interface MemberCostLiveModifierForMemberOptions {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly countDelta: number;
}

export interface MemberCostSetLiveModifierForMemberOptions {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly setTo: number;
}

export interface AddMemberCostLiveModifierForMemberResult {
  readonly gameState: GameState;
  readonly modifier: MemberCostModifierState;
  readonly costDelta: number;
}

export interface AddMemberCostSetLiveModifierForMemberResult {
  readonly gameState: GameState;
  readonly modifier: MemberCostSetModifierState;
  readonly setTo: number;
}

export interface SuppressLiveAbilityOptions {
  readonly sourceCardId: string;
  readonly suppressedAbilityId: string;
  readonly abilityId: string;
}

const CONTINUOUS_LIVE_MODIFIER_DEFINITIONS: readonly ContinuousLiveModifierDefinition[] = [
  {
    baseCardCodes: ['PL!SP-bp2-004'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        !isCenterStageMemberAtHighestEffectiveCost(game, playerId)
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_BP2_004_CONTINUOUS_CENTER_HIGHEST_STAGE_COST_GAIN_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!-sd1-001'],
    collect: ({ playerId, sourceCardId, successLiveCount }) =>
      successLiveCount > 0
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: successLiveCount,
              sourceCardId,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!-bp5-008'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!successLiveScoreAtLeast(game, playerId, 6)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: BP5_008_CONTINUOUS_SUCCESS_SCORE_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 2 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!-bp5-111'],
    collect: ({ game, playerId, sourceCardId }) => {
      const otherAriseMemberCount = countOtherStageMembersBelongingToGroup(
        game,
        playerId,
        sourceCardId,
        'A-RISE'
      );
      if (otherAriseMemberCount <= 0) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: PL_BP5_111_CONTINUOUS_OTHER_ARISE_BLUE_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.BLUE, count: otherAriseMemberCount }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!-bp5-333'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!sourceStageMemberHasOrientation(game, playerId, sourceCardId, OrientationState.WAITING)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: PL_BP5_333_CONTINUOUS_WAITING_BLUE_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.BLUE, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!-bp4-002'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!hasLiveWithoutLiveStartOrSuccessAbility(game, playerId)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: BP4_002_CONTINUOUS_LIVE_WITHOUT_TIMING_PURPLE_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.PURPLE, count: 2 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!-bp4-018'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasSuccessfulLiveScoreLead(game, playerId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: BP4_018_CONTINUOUS_SUCCESS_SCORE_LEAD_GAIN_TWO_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!N-bp4-007'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        getTotalEnergyZoneCount(game, playerId) < 15
      ) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId:
          PL_N_BP4_007_CONTINUOUS_TOTAL_ENERGY_FIFTEEN_GAIN_TWO_RED_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.RED, count: 2 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!N-bp4-012'],
    collect: ({ game, playerId, sourceCardId }) =>
      opponentSuccessLiveScoreAtLeast(game, playerId, 6)
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: PL_N_BP4_012_CONTINUOUS_OPPONENT_SUCCESS_SCORE_SIX_LIVE_SCORE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!-bp5-003'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!hasAtLeastDifferentNamedStageMembers(game, playerId, 3)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: BP5_003_CONTINUOUS_THREE_DIFFERENT_NAMES_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!N-bp1-012'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!hasLiveZoneThreeIncludingNijigasakiLive(game, playerId)) {
        return [];
      }
      const visibilityDependency = playerLiveZoneContentsVisibilityDependency(playerId);
      const heartModifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId:
          PL_N_BP1_012_CONTINUOUS_LIVE_ZONE_THREE_NIJIGASAKI_LIVE_GAIN_ALL_HEART_BLADE_ABILITY_ID,
        hearts: [{ color: HeartColor.RAINBOW, count: 2 }],
      });
      if (!heartModifier) {
        return [];
      }
      return [
        { ...heartModifier, visibilityDependency },
        {
          kind: 'BLADE',
          playerId,
          countDelta: 2,
          sourceCardId,
          abilityId:
            PL_N_BP1_012_CONTINUOUS_LIVE_ZONE_THREE_NIJIGASAKI_LIVE_GAIN_ALL_HEART_BLADE_ABILITY_ID,
          visibilityDependency,
        },
      ];
    },
  },
  {
    baseCardCodes: ['PL!N-pb1-007'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        !hasOwnLiveCardWithEffectiveRequirementAllSixOrdinaryColors(game, playerId)
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: PL_N_PB1_007_CONTINUOUS_LIVE_REQUIREMENT_SIX_COLORS_GAIN_ALL_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!N-bp5-002'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      sourceHasStrictlyMostEffectiveHeartsOnStage(game, playerId, sourceCardId)
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: N_BP5_002_CONTINUOUS_STAGE_MOST_HEARTS_LIVE_SCORE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!SP-bp5-012'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!hasLiellaLiveWithRequirementTotalAtLeast(game, playerId, 8)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_BP5_012_CONTINUOUS_LIELLA_LIVE_REQUIREMENT_EIGHT_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!SP-bp5-011'],
    collect: ({ game, playerId, sourceCardId }) => {
      const slot = getSourceMainStageSlot(game, playerId, sourceCardId);
      const heartColor =
        slot === SlotPosition.LEFT
          ? HeartColor.RED
          : slot === SlotPosition.CENTER
            ? HeartColor.YELLOW
            : slot === SlotPosition.RIGHT
              ? HeartColor.BLUE
              : null;
      if (!heartColor) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_BP5_011_CONTINUOUS_SLOT_HEARTS_ABILITY_ID,
        hearts: [{ color: heartColor, count: 3 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!SP-bp5-016'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        countPlayerEnergyCards(game, playerId) < 10
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_BP5_016_CONTINUOUS_ENERGY_TEN_GAIN_TWO_PURPLE_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.PURPLE, count: 2 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!SP-bp5-111'],
    collect: ({ game, playerId, sourceCardId }) =>
      collectExactEightEnergyScoreModifier(
        game,
        playerId,
        sourceCardId,
        SP_BP5_111_CONTINUOUS_ENERGY_EXACT_EIGHT_LIVE_SCORE_ABILITY_ID
      ),
  },
  {
    baseCardCodes: ['PL!SP-bp5-222'],
    collect: ({ game, playerId, sourceCardId }) =>
      collectExactEightEnergyScoreModifier(
        game,
        playerId,
        sourceCardId,
        SP_BP5_222_CONTINUOUS_ENERGY_EXACT_EIGHT_LIVE_SCORE_ABILITY_ID
      ),
  },
  {
    baseCardCodes: ['PL!SP-pb1-002'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      countPlayerEnergyCards(game, playerId) >= 12
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: SP_PB1_002_CONTINUOUS_ENERGY_TWELVE_LIVE_SCORE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-bp1-003'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasThreeDifferentHasunosoraMembersOnStage(game, playerId)
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: HS_BP1_003_CONTINUOUS_SCORE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-bp5-002'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasAtLeastDifferentEffectiveCostStageMembers(game, playerId, 3)
        ? collectHsBp5002SayakaContinuousModifiers(game, playerId, sourceCardId)
        : [],
  },
  {
    baseCardCodes: ['PL!HS-bp5-004'],
    collect: ({ game, playerId, sourceCardId }) => {
      const highCostNonCeriseMemberCount = countHighCostNonCeriseBouquetStageMembers(
        game,
        playerId
      );
      return highCostNonCeriseMemberCount > 0
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: highCostNonCeriseMemberCount * 2,
              sourceCardId,
              abilityId:
                HS_BP5_004_CONTINUOUS_NON_CERISE_HIGH_COST_STAGE_MEMBER_GAIN_BLADE_ABILITY_ID,
            },
          ]
        : [];
    },
  },
  {
    baseCardCodes: ['PL!HS-bp2-002'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasOtherHigherEffectiveCostStageMember(game, playerId, sourceCardId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 3,
              sourceCardId,
              abilityId: HS_BP2_002_CONTINUOUS_OTHER_HIGHER_COST_GAIN_THREE_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-bp5-007'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasOtherEdelNoteStageMember(game, playerId, sourceCardId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: HS_BP5_007_CONTINUOUS_OTHER_EDELNOTE_MEMBER_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-bp2-006'],
    collect: ({ game, playerId, sourceCardId }) => {
      const otherMiracraMemberCount = countOtherMiracraParkStageMembers(
        game,
        playerId,
        sourceCardId
      );
      return otherMiracraMemberCount > 0
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: otherMiracraMemberCount,
              sourceCardId,
              abilityId: HS_BP2_006_CONTINUOUS_OTHER_MIRACRA_STAGE_MEMBER_BLADE_ABILITY_ID,
            },
          ]
        : [];
    },
  },
  {
    baseCardCodes: ['PL!HS-bp6-002'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasNoOtherStageMembers(game, playerId, sourceCardId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: HS_BP6_002_CONTINUOUS_ALONE_GAIN_TWO_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-pb1-015'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasNoOtherStageMembers(game, playerId, sourceCardId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: -3,
              sourceCardId,
              abilityId: HS_PB1_015_CONTINUOUS_ALONE_LOSE_THREE_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!S-bp5-008'],
    collect: ({ game, playerId, sourceCardId }) => {
      const opponent = game.players.find((candidate) => candidate.id !== playerId);
      return opponent && getRemainingHeartTotalCount(game, opponent.id) >= 2
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: PL_S_BP5_008_CONTINUOUS_OPPONENT_REMAINING_HEART_SCORE_ABILITY_ID,
            },
          ]
        : [];
    },
  },
  {
    baseCardCodes: ['PL!-pb1-002'],
    collect: ({ game, playerId, sourceCardId }) =>
      collectPlPb1002OpponentWaitingPurpleHeartModifiers(game, playerId, sourceCardId),
  },
  {
    baseCardCodes: ['PL!-bp3-002'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!isSourceMainStageMember(game, playerId, sourceCardId)) {
        return [];
      }
      const opponent = game.players.find((candidate) => candidate.id !== playerId);
      const opponentWaitingMemberCount = opponent
        ? countStageMembersByOrientation(game, opponent.id, OrientationState.WAITING)
        : 0;
      return opponentWaitingMemberCount > 0
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: opponentWaitingMemberCount,
              sourceCardId,
              abilityId: PL_BP3_002_CONTINUOUS_OPPONENT_WAITING_GAIN_BLADE_ABILITY_ID,
            },
          ]
        : [];
    },
  },
  {
    cardCodes: ['PL!HS-bp5-016-N'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasOpponentWaitingStageMembers(game, playerId, 2)
        ? collectHsBp5016IzumiPurpleHeartModifier(game, playerId, sourceCardId)
        : [],
  },
  {
    baseCardCodes: ['PL!HS-sd1-004'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasNamedStageMember(game, playerId, [
        '日野下花帆',
        '徒町小鈴',
        '徒町小铃',
        '安養寺姫芽',
        '安养寺姬芽',
      ])
        ? collectHsSd1004GinkoGreenHeartModifier(game, playerId, sourceCardId)
        : [],
  },
  {
    baseCardCodes: ['PL!HS-sd1-005'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasNamedStageMember(game, playerId, [
        '村野さやか',
        '村野沙耶香',
        '百生吟子',
        '安養寺姫芽',
        '安养寺姬芽',
      ])
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: HS_SD1_005_CONTINUOUS_STAGE_SAYAKA_GINKO_HIME_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-pb1-014'],
    collect: ({ game, playerId, sourceCardId }) =>
      collectPb1014FrontHighCostHeartModifier(game, playerId, sourceCardId),
  },
  {
    baseCardCodes: ['PL!S-bp6-009'],
    collect: ({ game, playerId, sourceCardId }) => {
      const player = game.players.find((candidate) => candidate.id === playerId);
      const opponent = game.players.find((candidate) => candidate.id !== playerId);
      const successLiveDifference =
        (opponent?.successZone.cardIds.length ?? 0) - (player?.successZone.cardIds.length ?? 0);
      return player && opponent && successLiveDifference > 0
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: successLiveDifference,
              sourceCardId,
              abilityId: S_BP6_009_CONTINUOUS_SUCCESS_LIVE_DIFFERENCE_GAIN_BLADE_ABILITY_ID,
            },
          ]
        : [];
    },
  },
  {
    baseCardCodes: ['PL!S-bp2-001'],
    collect: ({ game, playerId, sourceCardId }) => {
      const player = game.players.find((candidate) => candidate.id === playerId);
      const opponent = game.players.find((candidate) => candidate.id !== playerId);
      return player &&
        opponent &&
        isSourceMainStageMember(game, playerId, sourceCardId) &&
        player.successZone.cardIds.length === 0 &&
        opponent.successZone.cardIds.length >= 1
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 3,
              sourceCardId,
              abilityId:
                S_BP2_001_CONTINUOUS_OWN_NO_SUCCESS_OPPONENT_HAS_SUCCESS_GAIN_THREE_BLADE_ABILITY_ID,
            },
          ]
        : [];
    },
  },
  {
    baseCardCodes: ['PL!-bp6-009'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasCenterNicoWithSideOriginalBladeTwoMembers(game, playerId, sourceCardId)
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: BP6_009_CONTINUOUS_CENTER_SIDE_PRINTED_BLADE_TWO_SCORE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!-bp4-005'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceCenterStageMember(game, playerId, sourceCardId)
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: BP4_005_CONTINUOUS_CENTER_SCORE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-pb1-007'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasExactOwnTwoOpponentThreeStageMembers(game, playerId)
        ? collectHsPb1007SerasPurpleHeartModifier(game, playerId, sourceCardId)
        : [],
  },
  {
    baseCardCodes: ['PL!N-pb1-004'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasMemberPositionMovedThisTurn(game, playerId, sourceCardId)
        ? []
        : [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: KARIN_CONTINUOUS_NOT_MOVED_BLADE_ABILITY_ID,
            },
          ],
  },
  {
    baseCardCodes: ['PL!N-pb1-011'],
    collect: ({ game, playerId, sourceCardId }) => {
      const energyBelowCount = countEnergyBelowSourceMember(game, playerId, sourceCardId);
      return energyBelowCount > 0
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: energyBelowCount,
              sourceCardId,
              abilityId: PL_N_PB1_011_CONTINUOUS_ENERGY_BELOW_GAIN_BLADE_ABILITY_ID,
            },
          ]
        : [];
    },
  },
  {
    baseCardCodes: ['PL!S-pb1-005'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      countOpponentEnergyCards(game, playerId) > countPlayerEnergyCards(game, playerId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 3,
              sourceCardId,
              abilityId: PL_S_PB1_005_CONTINUOUS_OPPONENT_ENERGY_MORE_GAIN_THREE_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!S-pb1-009'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      countTotalSuccessLiveCards(game, playerId) >= 3
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 3,
              sourceCardId,
              abilityId:
                PL_S_PB1_009_CONTINUOUS_TOTAL_SUCCESS_LIVE_THREE_GAIN_THREE_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-pb1-022'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        !hasStageMemberNamedAny(game, playerId, ['大沢瑠璃乃', '大泽瑠璃乃', '大泽琉璃乃'])
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: HS_PB1_022_CONTINUOUS_RURINO_GAIN_TWO_PINK_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.PINK, count: 2 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!HS-pb1-022'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      hasStageMemberNamedAny(game, playerId, ['藤島慈', '藤岛慈'])
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: HS_PB1_022_CONTINUOUS_MEGU_GAIN_TWO_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!SP-bp4-003'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceCenterStageMember(game, playerId, sourceCardId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: SP_BP4_003_CONTINUOUS_CENTER_GAIN_TWO_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!SP-bp4-005'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      countPlayerEnergyCards(game, playerId) >= 10
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 3,
              sourceCardId,
              abilityId: SP_BP4_005_CONTINUOUS_ENERGY_TEN_GAIN_THREE_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!SP-bp4-009'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      sumStageMemberEffectiveCost(game, playerId) < sumOpponentStageMemberEffectiveCost(game, playerId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 3,
              sourceCardId,
              abilityId: SP_BP4_009_CONTINUOUS_LOWER_STAGE_COST_GAIN_THREE_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!SP-bp4-021'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        countPlayerEnergyCards(game, playerId) <= countOpponentEnergyCards(game, playerId)
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_BP4_021_CONTINUOUS_MORE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    cardCodes: ['PL!SP-PR-025-PR'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      countPlayerEnergyCards(game, playerId) === 7
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: SP_PR_025_CONTINUOUS_ENERGY_EXACT_SEVEN_GAIN_TWO_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!SP-sd2-004'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceCenterStageMember(game, playerId, sourceCardId)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 4,
              sourceCardId,
              abilityId: SP_SD2_004_CONTINUOUS_CENTER_GAIN_FOUR_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!SP-sd2-008'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        !hasOwnStageMemberWithEffectiveCostAtLeast(game, playerId, 13)
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_SD2_008_CONTINUOUS_HIGH_COST_STAGE_MEMBER_GAIN_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!SP-bp2-010'],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId)
        ? collectOpponentLiveRequirementPlusOneModifiers(game, playerId, sourceCardId)
        : [],
  },
  ...createStageHeartOpponentLiveRequirementContinuousDefinitions([
    {
      baseCardCode: 'PL!S-bp5-010',
      heartColor: HeartColor.RED,
      abilityId:
        PL_S_BP5_010_CONTINUOUS_RED_HEART_FIVE_OPPONENT_LIVE_REQUIREMENT_PLUS_ONE_ABILITY_ID,
    },
    {
      baseCardCode: 'PL!S-bp5-011',
      heartColor: HeartColor.BLUE,
      abilityId:
        PL_S_BP5_011_CONTINUOUS_BLUE_HEART_FIVE_OPPONENT_LIVE_REQUIREMENT_PLUS_ONE_ABILITY_ID,
    },
  ]),
  {
    baseCardCodes: ['PL!N-PR-024', 'PL!S-PR-039'],
    collect: ({ game, playerId, sourceCardId }) =>
      countTotalSuccessLiveCards(game, playerId) >= 4
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: N_PR_024_CONTINUOUS_SUCCESS_LIVE_TOTAL_FOUR_GAIN_TWO_BLADE_ABILITY_ID,
            },
          ]
        : [],
  },
  ...createSideSlotBladeContinuousDefinitions([
    {
      baseCardCode: 'PL!SP-pb2-035',
      requiredSlot: SlotPosition.LEFT,
      abilityId: SP_PB2_035_CONTINUOUS_LEFT_SIDE_GAIN_TWO_BLADE_ABILITY_ID,
    },
    {
      baseCardCode: 'PL!SP-pb2-041',
      requiredSlot: SlotPosition.RIGHT,
      abilityId: SP_PB2_041_CONTINUOUS_RIGHT_SIDE_GAIN_TWO_BLADE_ABILITY_ID,
    },
  ]),
  ...createEnergyThresholdHeartContinuousDefinitions([
    {
      baseCardCode: 'PL!SP-pb2-023',
      heartColor: HeartColor.RED,
      abilityId: SP_PB2_023_CONTINUOUS_ENERGY_SIX_EIGHT_GAIN_RED_HEART_ABILITY_ID,
    },
    {
      baseCardCode: 'PL!SP-pb2-027',
      heartColor: HeartColor.YELLOW,
      abilityId: SP_PB2_027_CONTINUOUS_ENERGY_SIX_EIGHT_GAIN_YELLOW_HEART_ABILITY_ID,
    },
    {
      baseCardCode: 'PL!SP-pb2-032',
      heartColor: HeartColor.PURPLE,
      abilityId: SP_PB2_032_CONTINUOUS_ENERGY_SIX_EIGHT_GAIN_PURPLE_HEART_ABILITY_ID,
    },
  ]),
  {
    baseCardCodes: ['PL!SP-PR-022'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        countTotalStageMembers(game) !== 6
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_PR_022_CONTINUOUS_TOTAL_STAGE_SIX_GAIN_RED_YELLOW_HEART_ABILITY_ID,
        hearts: [
          { color: HeartColor.RED, count: 1 },
          { color: HeartColor.YELLOW, count: 1 },
        ],
      });
      return modifier ? [modifier] : [];
    },
  },
  ...createActiveEnergyHeartContinuousDefinitions([
    {
      baseCardCode: 'PL!SP-pb2-026',
      heartColor: HeartColor.RED,
      count: 2,
      abilityId: SP_PB2_026_CONTINUOUS_ACTIVE_ENERGY_GAIN_TWO_RED_HEART_ABILITY_ID,
    },
  ]),
  ...createSuccessZoneUnitHeartContinuousDefinitions([
    {
      baseCardCode: 'PL!-bp6-012',
      unitName: 'Printemps',
      heartColor: HeartColor.YELLOW,
      abilityId: BP6_012_CONTINUOUS_SUCCESS_ZONE_PRINTEMPS_CARD_YELLOW_HEART_ABILITY_ID,
    },
    {
      baseCardCode: 'PL!-bp6-014',
      unitName: 'lilywhite',
      heartColor: HeartColor.PINK,
      abilityId: BP6_014_CONTINUOUS_SUCCESS_ZONE_LILYWHITE_CARD_PINK_HEART_ABILITY_ID,
    },
    {
      baseCardCode: 'PL!-bp6-015',
      unitName: 'BiBi',
      heartColor: HeartColor.PURPLE,
      abilityId: BP6_015_CONTINUOUS_SUCCESS_ZONE_BIBI_CARD_PURPLE_HEART_ABILITY_ID,
    },
  ]),
];

const SUCCESS_ZONE_CONTINUOUS_LIVE_MODIFIER_DEFINITIONS: readonly SuccessZoneContinuousLiveModifierDefinition[] =
  [
    {
      baseCardCodes: ['PL!-bp6-022'],
      nonStackingAbilityId: 'PL!-bp6-022:continuous-success-zone-muse-live-requirement',
      collect: ({ game, playerId, sourceCardId }) =>
        collectDreaminGoGoRequirementModifiers(game, playerId, sourceCardId),
    },
  ];

const MEMBER_SLOT_ORDER: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];
const HS_BP1_003_CONTINUOUS_SCORE_ABILITY_ID =
  'PL!HS-bp1-003-SEC:continuous-three-different-hasunosora-score';
const BP5_008_CONTINUOUS_SUCCESS_SCORE_YELLOW_HEART_ABILITY_ID =
  'PL!-bp5-008:continuous-success-score-yellow-heart';
const PL_BP5_111_CONTINUOUS_OTHER_ARISE_BLUE_HEART_ABILITY_ID =
  'PL!-bp5-111:continuous-other-arise-blue-heart';
const PL_BP5_333_CONTINUOUS_WAITING_BLUE_HEART_ABILITY_ID =
  'PL!-bp5-333:continuous-waiting-blue-heart';
const BP4_002_CONTINUOUS_LIVE_WITHOUT_TIMING_PURPLE_HEART_ABILITY_ID =
  'PL!-bp4-002:continuous-live-without-timing-purple-heart';
const BP5_003_CONTINUOUS_THREE_DIFFERENT_NAMES_YELLOW_HEART_ABILITY_ID =
  'PL!-bp5-003:continuous-three-different-names-yellow-heart';
const N_BP5_002_CONTINUOUS_STAGE_MOST_HEARTS_LIVE_SCORE_ABILITY_ID =
  'PL!N-bp5-002:continuous-stage-most-hearts-live-score';
const SP_BP5_012_CONTINUOUS_LIELLA_LIVE_REQUIREMENT_EIGHT_YELLOW_HEART_ABILITY_ID =
  'PL!SP-bp5-012:continuous-liella-live-requirement-eight-yellow-heart';
const SP_BP5_011_CONTINUOUS_SLOT_HEARTS_ABILITY_ID = 'PL!SP-bp5-011:continuous-slot-hearts';
const SP_BP5_016_CONTINUOUS_ENERGY_TEN_GAIN_TWO_PURPLE_HEART_ABILITY_ID =
  'PL!SP-bp5-016:continuous-energy-ten-gain-two-purple-heart';
const SP_BP5_111_CONTINUOUS_ENERGY_EXACT_EIGHT_LIVE_SCORE_ABILITY_ID =
  'PL!SP-bp5-111:continuous-energy-exact-eight-live-score';
const SP_BP5_222_CONTINUOUS_ENERGY_EXACT_EIGHT_LIVE_SCORE_ABILITY_ID =
  'PL!SP-bp5-222:continuous-energy-exact-eight-live-score';
const SP_PB1_002_CONTINUOUS_ENERGY_TWELVE_LIVE_SCORE_ABILITY_ID =
  'PL!SP-pb1-002:continuous-energy-twelve-live-score';
const BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID =
  'PL!-bp6-022:continuous-success-zone-muse-live-requirement';
const KARIN_CONTINUOUS_NOT_MOVED_BLADE_ABILITY_ID =
  'PL!N-pb1-004:continuous-not-position-moved-gain-two-blade';
const N_PR_024_CONTINUOUS_SUCCESS_LIVE_TOTAL_FOUR_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!N-PR-024-PR:continuous-success-live-total-four-gain-two-blade';
const HS_PB1_014_CONTINUOUS_FRONT_HIGH_COST_PINK_HEART_ABILITY_ID =
  'PL!HS-pb1-014-R:continuous-front-high-cost-pink-heart';
const S_BP6_009_CONTINUOUS_SUCCESS_LIVE_DIFFERENCE_GAIN_BLADE_ABILITY_ID =
  'PL!S-bp6-009:continuous-success-live-difference-gain-blade';
const S_BP2_001_CONTINUOUS_OWN_NO_SUCCESS_OPPONENT_HAS_SUCCESS_GAIN_THREE_BLADE_ABILITY_ID =
  'PL!S-bp2-001:continuous-own-no-success-opponent-has-success-gain-three-blade';
const PL_S_BP5_008_CONTINUOUS_OPPONENT_REMAINING_HEART_SCORE_ABILITY_ID =
  'PL!S-bp5-008:continuous-opponent-remaining-heart-score';
const HS_PB1_007_CONTINUOUS_EXACT_TWO_OWN_OPPONENT_THREE_PURPLE_HEART_ABILITY_ID =
  'PL!HS-pb1-007:continuous-exact-two-own-opponent-three-purple-heart';
const HS_BP5_002_CONTINUOUS_THREE_DIFFERENT_STAGE_MEMBER_COSTS_BLUE_HEART_BLADE_ABILITY_ID =
  'PL!HS-bp5-002:continuous-three-different-stage-member-costs-blue-heart-blade';
const HS_BP5_004_CONTINUOUS_NON_CERISE_HIGH_COST_STAGE_MEMBER_GAIN_BLADE_ABILITY_ID =
  'PL!HS-bp5-004:continuous-non-cerise-high-cost-stage-members-gain-blade';
const HS_BP2_002_CONTINUOUS_OTHER_HIGHER_COST_GAIN_THREE_BLADE_ABILITY_ID =
  'PL!HS-bp2-002:continuous-other-higher-cost-gain-three-blade';
const HS_BP5_007_CONTINUOUS_OTHER_EDELNOTE_MEMBER_BLADE_ABILITY_ID =
  'PL!HS-bp5-007:continuous-other-edelnote-member-blade';
const HS_BP2_006_CONTINUOUS_OTHER_MIRACRA_STAGE_MEMBER_BLADE_ABILITY_ID =
  'PL!HS-bp2-006:continuous-other-miracra-stage-member-blade';
const HS_BP6_002_CONTINUOUS_ALONE_GAIN_TWO_BLADE_ABILITY_ID =
  'PL!HS-bp6-002:continuous-alone-gain-two-blade';
const HS_PB1_015_CONTINUOUS_ALONE_LOSE_THREE_BLADE_ABILITY_ID =
  'PL!HS-pb1-015-R:continuous-alone-lose-three-blade';
const HS_BP5_016_CONTINUOUS_OPPONENT_TWO_WAITING_PURPLE_HEART_ABILITY_ID =
  'PL!HS-bp5-016-N:continuous-opponent-two-waiting-purple-heart';
const HS_SD1_004_CONTINUOUS_STAGE_KAHO_KOSUZU_HIME_GREEN_HEART_ABILITY_ID =
  'PL!HS-sd1-004-SD:continuous-stage-kaho-kosuzu-hime-green-heart';
const HS_SD1_005_CONTINUOUS_STAGE_SAYAKA_GINKO_HIME_BLADE_ABILITY_ID =
  'PL!HS-sd1-005-SD:continuous-stage-sayaka-ginko-hime-blade';

function getScoreModifiers(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): ScoreModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is ScoreModifierState =>
      modifier.kind === 'SCORE' && modifier.playerId === playerId
  );
}

function getRemainingHeartTotalCount(game: GameState, playerId: string): number {
  return (game.liveResolution.playerRemainingHearts.get(playerId) ?? []).reduce(
    (total, heart) => total + heart.count,
    0
  );
}

function getHeartModifiers(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): HeartModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is HeartModifierState =>
      modifier.kind === 'HEART' &&
      getHeartModifierTarget(modifier) === 'PLAYER' &&
      modifier.playerId === playerId
  );
}

function getBladeModifiers(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): BladeModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is BladeModifierState =>
      modifier.kind === 'BLADE' && modifier.playerId === playerId
  );
}

function getCheerCountModifiers(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): CheerCountModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is CheerCountModifierState =>
      modifier.kind === 'CHEER_COUNT' && modifier.playerId === playerId
  );
}

function getRequirementModifiers(
  liveCardId: string,
  liveModifiers: readonly LiveModifierState[]
): RequirementModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is RequirementModifierState =>
      modifier.kind === 'REQUIREMENT' && modifier.liveCardId === liveCardId
  );
}

export function collectLiveModifiers(game: GameState): readonly LiveModifierState[] {
  return [...game.liveResolution.liveModifiers, ...collectContinuousLiveModifiers(game)];
}

function collectContinuousLiveModifiers(game: GameState): readonly LiveModifierState[] {
  const modifiers: LiveModifierState[] = [];

  for (const player of game.players) {
    const successLiveCount = player.successZone.cardIds.length;

    for (const cardId of getAllMemberCardIds(player.memberSlots)) {
      const card = getCardById(game, cardId);
      if (!card) {
        continue;
      }

      for (const definition of CONTINUOUS_LIVE_MODIFIER_DEFINITIONS) {
        if (!doesContinuousDefinitionMatchCardCode(definition, card.data.cardCode)) {
          continue;
        }

        modifiers.push(
          ...definition.collect({
            game,
            playerId: player.id,
            sourceCardId: cardId,
            successLiveCount,
          })
        );
      }
    }

    const appliedNonStackingAbilityIds = new Set<string>();
    for (const cardId of player.successZone.cardIds) {
      const card = getCardById(game, cardId);
      if (!card || !isLiveCardData(card.data)) {
        continue;
      }

      for (const definition of SUCCESS_ZONE_CONTINUOUS_LIVE_MODIFIER_DEFINITIONS) {
        if (!doesContinuousDefinitionMatchCardCode(definition, card.data.cardCode)) {
          continue;
        }
        if (
          definition.nonStackingAbilityId !== undefined &&
          appliedNonStackingAbilityIds.has(definition.nonStackingAbilityId)
        ) {
          continue;
        }

        modifiers.push(
          ...definition.collect({
            game,
            playerId: player.id,
            sourceCardId: cardId,
            successLiveCount,
          })
        );

        if (definition.nonStackingAbilityId !== undefined) {
          appliedNonStackingAbilityIds.add(definition.nonStackingAbilityId);
        }
      }
    }
  }

  return modifiers;
}

function playerLiveZoneContentsVisibilityDependency(
  playerId: string
): LiveModifierVisibilityDependency {
  return { kind: 'PLAYER_LIVE_ZONE_CONTENTS', playerId };
}

function collectDreaminGoGoRequirementModifiers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return [];
  }

  return player.liveZone.cardIds.flatMap((liveCardId) => {
    const card = getCardById(game, liveCardId);
    if (
      !card ||
      !isLiveCardData(card.data) ||
      card.data.score < 5 ||
      !cardBelongsToGroup(card.data, "μ's")
    ) {
      return [];
    }

    return [
      {
        kind: 'REQUIREMENT' as const,
        liveCardId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
        sourceCardId,
        abilityId: BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID,
      },
    ];
  });
}

function collectOpponentLiveRequirementPlusOneModifiers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!opponent) {
    return [];
  }

  return opponent.liveZone.cardIds.flatMap((liveCardId) => {
    const liveCard = getCardById(game, liveCardId);
    return liveCard && isLiveCardData(liveCard.data)
      ? [
          {
            kind: 'REQUIREMENT' as const,
            liveCardId,
            modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
            sourceCardId,
            abilityId: SP_BP2_010_CONTINUOUS_OPPONENT_LIVE_REQUIREMENT_PLUS_ONE_ABILITY_ID,
          },
        ]
      : [];
  });
}

function collectSingleOpponentLiveRequirementPlusOneModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string
): readonly LiveModifierState[] {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  const liveCardId = opponent?.liveZone.cardIds.find((candidateLiveCardId) => {
    const liveCard = getCardById(game, candidateLiveCardId);
    return liveCard !== null && isLiveCardData(liveCard.data);
  });
  return liveCardId
    ? [
        {
          kind: 'REQUIREMENT' as const,
          liveCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
          sourceCardId,
          abilityId,
        },
      ]
    : [];
}

function hasLiveWithoutLiveStartOrSuccessAbility(game: GameState, playerId: string): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  return player.liveZone.cardIds.some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    return (
      card !== null &&
      isLiveCardData(card.data) &&
      !liveHasLiveStartOrSuccessAbility(card.data.cardText)
    );
  });
}

function hasSuccessfulLiveScoreLead(game: GameState, playerId: string): boolean {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!opponent) {
    return false;
  }
  return sumSuccessfulLiveScore(game, playerId) > sumSuccessfulLiveScore(game, opponent.id);
}

function opponentSuccessLiveScoreAtLeast(
  game: GameState,
  playerId: string,
  threshold: number
): boolean {
  const player = getPlayerById(game, playerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  return opponent ? successLiveScoreAtLeast(game, opponent.id, threshold) : false;
}

function getTotalEnergyZoneCount(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  return (player?.energyZone.cardIds.length ?? 0) + (opponent?.energyZone.cardIds.length ?? 0);
}

function countTotalSuccessLiveCards(game: GameState, playerId: string): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  return (player?.successZone.cardIds.length ?? 0) + (opponent?.successZone.cardIds.length ?? 0);
}

function hasLiellaLiveWithRequirementTotalAtLeast(
  game: GameState,
  playerId: string,
  minRequirementTotal: number
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  return player.liveZone.cardIds.some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    return (
      card !== null &&
      isLiveCardData(card.data) &&
      cardBelongsToGroup(card.data, 'Liella!') &&
      card.data.requirements.totalRequired >= minRequirementTotal
    );
  });
}

function hasLiveZoneThreeIncludingNijigasakiLive(game: GameState, playerId: string): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || player.liveZone.cardIds.length < 3) {
    return false;
  }

  return player.liveZone.cardIds.some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    return card !== null && isLiveCardData(card.data) && cardBelongsToGroup(card.data, '虹ヶ咲');
  });
}

function liveHasLiveStartOrSuccessAbility(cardText: string | undefined): boolean {
  if (!cardText) {
    return false;
  }

  return (
    cardText.includes('【LIVE开始时】') ||
    cardText.includes('【LIVE開始時】') ||
    cardText.includes('【LIVE成功时】') ||
    cardText.includes('【LIVE成功時】') ||
    cardText.includes('{{live_start.png|ライブ開始時}}') ||
    cardText.includes('{{live_success.png|ライブ成功時}}') ||
    cardText.includes('ライブ開始時') ||
    cardText.includes('ライブ成功時')
  );
}

function doesContinuousDefinitionMatchCardCode(
  definition: ContinuousLiveModifierDefinition,
  cardCode: string
): boolean {
  const normalizedCardCode = normalizeCardCode(cardCode);
  const baseCardCode = getBaseCardCode(normalizedCardCode);
  return (
    definition.cardCodes?.map(normalizeCardCode).includes(normalizedCardCode) === true ||
    definition.baseCardCodes?.map(normalizeCardCode).includes(baseCardCode) === true
  );
}

function createSideSlotBladeContinuousDefinitions(
  definitions: readonly SideSlotBladeContinuousDefinition[]
): readonly ContinuousLiveModifierDefinition[] {
  return definitions.map((definition) => ({
    baseCardCodes: [definition.baseCardCode],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceStageMemberInSlot(game, playerId, sourceCardId, definition.requiredSlot)
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: definition.abilityId,
            },
          ]
        : [],
  }));
}

function createEnergyThresholdHeartContinuousDefinitions(
  definitions: readonly EnergyThresholdHeartContinuousDefinition[]
): readonly ContinuousLiveModifierDefinition[] {
  return definitions.map((definition) => ({
    baseCardCodes: [definition.baseCardCode],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!isSourceMainStageMember(game, playerId, sourceCardId)) {
        return [];
      }

      const energyCount = countPlayerEnergyCards(game, playerId);
      const heartCount = energyCount >= 8 ? 2 : energyCount >= 6 ? 1 : 0;
      if (heartCount === 0) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: definition.abilityId,
        hearts: [{ color: definition.heartColor, count: heartCount }],
      });
      return modifier ? [modifier] : [];
    },
  }));
}

function createActiveEnergyHeartContinuousDefinitions(
  definitions: readonly ActiveEnergyHeartContinuousDefinition[]
): readonly ContinuousLiveModifierDefinition[] {
  return definitions.map((definition) => ({
    baseCardCodes: [definition.baseCardCode],
    collect: ({ game, playerId, sourceCardId }) => {
      if (
        !isSourceMainStageMember(game, playerId, sourceCardId) ||
        !hasNonWaitingEnergy(game, playerId)
      ) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: definition.abilityId,
        hearts: [{ color: definition.heartColor, count: definition.count }],
      });
      return modifier ? [modifier] : [];
    },
  }));
}

function createSuccessZoneUnitHeartContinuousDefinitions(
  definitions: readonly SuccessZoneUnitHeartContinuousDefinition[]
): readonly ContinuousLiveModifierDefinition[] {
  return definitions.map((definition) => ({
    baseCardCodes: [definition.baseCardCode],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!successZoneHasUnitCard(game, playerId, definition.unitName)) {
        return [];
      }

      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: definition.abilityId,
        hearts: [{ color: definition.heartColor, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  }));
}

function createStageHeartOpponentLiveRequirementContinuousDefinitions(
  definitions: readonly StageHeartOpponentLiveRequirementContinuousDefinition[]
): readonly ContinuousLiveModifierDefinition[] {
  return definitions.map((definition) => ({
    baseCardCodes: [definition.baseCardCode],
    collect: ({ game, playerId, sourceCardId }) =>
      isSourceMainStageMember(game, playerId, sourceCardId) &&
      countEffectiveStageHeartColor(game, playerId, definition.heartColor) >= 5
        ? collectSingleOpponentLiveRequirementPlusOneModifier(
            game,
            playerId,
            sourceCardId,
            definition.abilityId
          )
        : [],
  }));
}

function isSourceStageMemberInSlot(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  requiredSlot: SlotPosition
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return player?.memberSlots.slots[requiredSlot] === sourceCardId;
}

function isSourceMainStageMember(game: GameState, playerId: string, sourceCardId: string): boolean {
  return getSourceMainStageSlot(game, playerId, sourceCardId) !== null;
}

function isCenterStageMemberAtHighestEffectiveCost(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  const centerCardId = player?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  if (!player || !centerCardId) {
    return false;
  }

  const stageMemberCardIds = MEMBER_SLOT_ORDER.map((slot) => player.memberSlots.slots[slot]).filter(
    (cardId): cardId is string => cardId !== null
  );
  const centerEffectiveCost = getMemberEffectiveCost(game, playerId, centerCardId);
  return stageMemberCardIds.every(
    (cardId) => getMemberEffectiveCost(game, playerId, cardId) <= centerEffectiveCost
  );
}

function getSourceMainStageSlot(
  game: GameState,
  playerId: string,
  sourceCardId: string
): SlotPosition | null {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return MEMBER_SLOT_ORDER.find((slot) => player?.memberSlots.slots[slot] === sourceCardId) ?? null;
}

function sourceHasStrictlyMostEffectiveHeartsOnStage(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const liveModifiers = game.liveResolution.liveModifiers;
  const sourceHeartCount = countEffectiveMemberHearts(game, playerId, sourceCardId, liveModifiers);
  const otherStageMemberHeartCounts = game.players.flatMap((player) =>
    getAllMemberCardIds(player.memberSlots)
      .filter((cardId) => cardId !== sourceCardId)
      .map((cardId) => countEffectiveMemberHearts(game, player.id, cardId, liveModifiers))
  );
  return otherStageMemberHeartCounts.every((heartCount) => sourceHeartCount > heartCount);
}

function countEffectiveMemberHearts(
  game: GameState,
  playerId: string,
  memberCardId: string,
  liveModifiers: readonly LiveModifierState[]
): number {
  return getMemberEffectiveHeartIcons(game, playerId, memberCardId, liveModifiers).reduce(
    (total, heart) => total + heart.count,
    0
  );
}

function countEffectiveStageHeartColor(
  game: GameState,
  playerId: string,
  heartColor: HeartColor
): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return 0;
  }

  const liveModifiers = game.liveResolution.liveModifiers;
  return getAllMemberCardIds(player.memberSlots).reduce(
    (total, memberCardId) =>
      total +
      getMemberEffectiveHeartIcons(game, playerId, memberCardId, liveModifiers)
        .filter((heart) => heart.color === heartColor)
        .reduce((memberTotal, heart) => memberTotal + heart.count, 0),
    0
  );
}

function countEnergyBelowSourceMember(
  game: GameState,
  playerId: string,
  sourceCardId: string
): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (!player || sourceCard?.ownerId !== playerId || !isMemberCardData(sourceCard.data)) {
    return 0;
  }
  const sourceSlot = MEMBER_SLOT_ORDER.find(
    (slot) => player.memberSlots.slots[slot] === sourceCardId
  );
  return sourceSlot ? (player.memberSlots.energyBelow[sourceSlot]?.length ?? 0) : 0;
}

function countPlayerEnergyCards(game: GameState, playerId: string): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return player?.energyZone.cardIds.length ?? 0;
}

function countOpponentEnergyCards(game: GameState, playerId: string): number {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  return opponent?.energyZone.cardIds.length ?? 0;
}

function sumStageMemberEffectiveCost(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return getAllMemberCardIds(player.memberSlots).reduce(
    (total, cardId) => total + getMemberEffectiveCost(game, playerId, cardId),
    0
  );
}

function sumOpponentStageMemberEffectiveCost(game: GameState, playerId: string): number {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  return opponent ? sumStageMemberEffectiveCost(game, opponent.id) : 0;
}

const ORDINARY_HEART_COLORS: readonly HeartColor[] = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
];

function hasOwnLiveCardWithEffectiveRequirementAllSixOrdinaryColors(
  game: GameState,
  playerId: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  return player.liveZone.cardIds.some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    if (!card || !isLiveCardData(card.data)) {
      return false;
    }

    const effectiveRequirement = applyHeartRequirementModifiers(
      card.data.requirements,
      getLiveCardRequirementModifiers(
        game.liveResolution,
        liveCardId,
        game.liveResolution.liveModifiers
      )
    );

    return ORDINARY_HEART_COLORS.every(
      (color) => (effectiveRequirement.colorRequirements.get(color) ?? 0) >= 1
    );
  });
}

function countTotalStageMembers(game: GameState): number {
  return game.players.reduce(
    (total, player) => total + getAllMemberCardIds(player.memberSlots).length,
    0
  );
}

function hasNonWaitingEnergy(game: GameState, playerId: string): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return (
    player?.energyZone.cardIds.some((cardId) => {
      const cardState = player.energyZone.cardStates.get(cardId);
      return cardState !== undefined && cardState.orientation !== OrientationState.WAITING;
    }) === true
  );
}

function successZoneHasUnitCard(game: GameState, playerId: string, unitName: string): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  const normalizedUnitName = normalizeContinuousUnitName(unitName);
  return player.successZone.cardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && cardMatchesNormalizedUnit(card.data, normalizedUnitName);
  });
}

function cardMatchesNormalizedUnit(
  card: { readonly unitName?: string; readonly cardText?: string },
  normalizedUnitName: string
): boolean {
  return (
    normalizeContinuousUnitName(card.unitName).includes(normalizedUnitName) ||
    normalizeContinuousUnitName(card.cardText).includes(normalizedUnitName)
  );
}

function hasThreeDifferentHasunosoraMembersOnStage(game: GameState, playerId: string): boolean {
  return hasAtLeastDifferentNamedStageMembers(
    game,
    playerId,
    3,
    isHasunosoraMemberCard,
    '蓮ノ空'
  );
}

function collectPb1014FrontHighCostHeartModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!player || !opponent) {
    return [];
  }

  const sourceSlot = MEMBER_SLOT_ORDER.find(
    (slot) => player.memberSlots.slots[slot] === sourceCardId
  );
  if (!sourceSlot) {
    return [];
  }

  const sourceCard = getCardById(game, sourceCardId);
  const opponentSlot = toPlayerLocalSlotForControllerPerspective(sourceSlot, playerId, opponent.id);
  const opponentCardId = opponent.memberSlots.slots[opponentSlot];
  const opponentCard = opponentCardId ? getCardById(game, opponentCardId) : null;
  if (
    !sourceCard ||
    !opponentCard ||
    !isMemberCardData(sourceCard.data) ||
    !isMemberCardData(opponentCard.data) ||
    opponentCard.data.cost <= sourceCard.data.cost
  ) {
    return [];
  }

  const modifier = createHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId: HS_PB1_014_CONTINUOUS_FRONT_HIGH_COST_PINK_HEART_ABILITY_ID,
    hearts: [{ color: HeartColor.PINK, count: 1 }],
  });
  return modifier ? [modifier] : [];
}

function collectHsPb1007SerasPurpleHeartModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const modifier = createHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId: HS_PB1_007_CONTINUOUS_EXACT_TWO_OWN_OPPONENT_THREE_PURPLE_HEART_ABILITY_ID,
    hearts: [{ color: HeartColor.PURPLE, count: 1 }],
  });
  return modifier ? [modifier] : [];
}

function collectHsBp5002SayakaContinuousModifiers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const heartModifier = createHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId: HS_BP5_002_CONTINUOUS_THREE_DIFFERENT_STAGE_MEMBER_COSTS_BLUE_HEART_BLADE_ABILITY_ID,
    hearts: [{ color: HeartColor.BLUE, count: 1 }],
  });
  if (!heartModifier) {
    return [];
  }

  return [
    heartModifier,
    {
      kind: 'BLADE',
      playerId,
      countDelta: 1,
      sourceCardId,
      abilityId:
        HS_BP5_002_CONTINUOUS_THREE_DIFFERENT_STAGE_MEMBER_COSTS_BLUE_HEART_BLADE_ABILITY_ID,
    },
  ];
}

function countHighCostNonCeriseBouquetStageMembers(game: GameState, playerId: string): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return 0;
  }

  return MEMBER_SLOT_ORDER.filter((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return (
      cardId !== null &&
      card !== null &&
      isMemberCardData(card.data) &&
      getMemberEffectiveCost(game, playerId, cardId) >= 4 &&
      !cardBelongsToUnit(card.data, 'Cerise Bouquet')
    );
  }).length;
}

function collectExactEightEnergyScoreModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string
): readonly LiveModifierState[] {
  return isSourceMainStageMember(game, playerId, sourceCardId) &&
    countPlayerEnergyCards(game, playerId) === 8
    ? [
        {
          kind: 'SCORE',
          playerId,
          countDelta: 1,
          sourceCardId,
          abilityId,
        },
      ]
    : [];
}

function collectHsSd1004GinkoGreenHeartModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const modifier = createHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId: HS_SD1_004_CONTINUOUS_STAGE_KAHO_KOSUZU_HIME_GREEN_HEART_ABILITY_ID,
    hearts: [{ color: HeartColor.GREEN, count: 1 }],
  });
  return modifier ? [modifier] : [];
}

function hasNamedStageMember(game: GameState, playerId: string, names: readonly string[]): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }
  return MEMBER_SLOT_ORDER.some((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return card !== null && isMemberCardData(card.data) && cardNameMatchesAnyAlias(card.data, names);
  });
}

function hasCenterNicoWithSideOriginalBladeTwoMembers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || findMemberSlot(player, sourceCardId) !== SlotPosition.CENTER) {
    return false;
  }

  const sideCardIds = [
    player.memberSlots.slots[SlotPosition.LEFT],
    player.memberSlots.slots[SlotPosition.RIGHT],
  ];
  if (sideCardIds.some((cardId) => cardId === null)) {
    return false;
  }

  return sideCardIds.every(
    (cardId) =>
      cardId !== null &&
      getMemberOriginalBladeCount(game, playerId, cardId, game.liveResolution.liveModifiers) === 2
  );
}

function isSourceCenterStageMember(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return player ? findMemberSlot(player, sourceCardId) === SlotPosition.CENTER : false;
}

function sourceStageMemberHasOrientation(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  orientation: OrientationState
): boolean {
  const player = getPlayerById(game, playerId);
  return player?.memberSlots.cardStates.get(sourceCardId)?.orientation === orientation;
}

function hasStageMemberNamedAny(game: GameState, playerId: string, names: readonly string[]): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }
  return MEMBER_SLOT_ORDER.some((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return card !== null && isMemberCardData(card.data) && cardNameMatchesAnyAlias(card.data, names);
  });
}

function countOtherStageMembersBelongingToGroup(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  groupName: string
): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return MEMBER_SLOT_ORDER.reduce((count, slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId || cardId === sourceCardId) {
      return count;
    }
    const card = getCardById(game, cardId);
    return card && isMemberCard(card) && cardBelongsToGroup(card.data, groupName)
      ? count + 1
      : count;
  }, 0);
}

function hasAtLeastDifferentNamedStageMembers(
  game: GameState,
  playerId: string,
  minCount: number,
  predicate: (card: NonNullable<ReturnType<typeof getCardById>>) => boolean = isMemberCard,
  groupName?: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  const cards = MEMBER_SLOT_ORDER.map((slot) => player.memberSlots.slots[slot])
    .map((cardId) => (cardId ? getCardById(game, cardId) : null))
    .filter(
      (card): card is NonNullable<ReturnType<typeof getCardById>> =>
        card !== null && isMemberCard(card) && predicate(card)
    );

  return hasAtLeastDifferentNamedCards(cards, minCount, (card) => card.data, { groupName });
}

function hasAtLeastDifferentEffectiveCostStageMembers(
  game: GameState,
  playerId: string,
  minCount: number
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  const costs = MEMBER_SLOT_ORDER.map((slot) => player.memberSlots.slots[slot])
    .map((cardId) => (cardId ? getCardById(game, cardId) : null))
    .filter(
      (card): card is NonNullable<ReturnType<typeof getCardById>> =>
        card !== null && isMemberCard(card)
    )
    .map((card) => getMemberEffectiveCost(game, playerId, card.instanceId));

  return new Set(costs).size >= minCount;
}

function hasOwnStageMemberWithEffectiveCostAtLeast(
  game: GameState,
  playerId: string,
  minCost: number
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  return MEMBER_SLOT_ORDER.some((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      getMemberEffectiveCost(game, playerId, cardId) >= minCost
    );
  });
}

function hasOtherHigherEffectiveCostStageMember(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || !getAllMemberCardIds(player.memberSlots).includes(sourceCardId)) {
    return false;
  }

  const sourceEffectiveCost = getMemberEffectiveCost(game, playerId, sourceCardId);
  return MEMBER_SLOT_ORDER.some((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (cardId === null || cardId === sourceCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      getMemberEffectiveCost(game, playerId, cardId) > sourceEffectiveCost
    );
  });
}

function hasExactOwnTwoOpponentThreeStageMembers(game: GameState, playerId: string): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!player || !opponent) {
    return false;
  }

  return countStageMembers(game, player.id) === 2 && countStageMembers(game, opponent.id) >= 3;
}

function countStageMembers(game: GameState, playerId: string): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return 0;
  }

  return MEMBER_SLOT_ORDER.filter((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return card !== null && isMemberCardData(card.data);
  }).length;
}

function hasOpponentWaitingStageMembers(
  game: GameState,
  playerId: string,
  minCount: number
): boolean {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  return opponent
    ? countStageMembersByOrientation(game, opponent.id, OrientationState.WAITING) >= minCount
    : false;
}

function countStageMembersByOrientation(
  game: GameState,
  playerId: string,
  orientation: OrientationState
): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return 0;
  }

  return MEMBER_SLOT_ORDER.filter((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return (
      cardId !== null &&
      card !== null &&
      isMemberCardData(card.data) &&
      player.memberSlots.cardStates.get(cardId)?.orientation === orientation
    );
  }).length;
}

function collectHsBp5016IzumiPurpleHeartModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const modifier = createHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId: HS_BP5_016_CONTINUOUS_OPPONENT_TWO_WAITING_PURPLE_HEART_ABILITY_ID,
    hearts: [{ color: HeartColor.PURPLE, count: 1 }],
  });
  return modifier ? [modifier] : [];
}

function collectPlPb1002OpponentWaitingPurpleHeartModifiers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  if (!isSourceMainStageMember(game, playerId, sourceCardId)) {
    return [];
  }
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!opponent) {
    return [];
  }
  const opponentWaitingMemberCount = countStageMembersByOrientation(
    game,
    opponent.id,
    OrientationState.WAITING
  );
  if (opponentWaitingMemberCount === 0) {
    return [];
  }
  const modifier = createHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId: PL_PB1_002_CONTINUOUS_OPPONENT_WAITING_GAIN_PURPLE_HEART_ABILITY_ID,
    hearts: [{ color: HeartColor.PURPLE, count: opponentWaitingMemberCount }],
  });
  return modifier ? [modifier] : [];
}

function hasOtherEdelNoteStageMember(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  return MEMBER_SLOT_ORDER.some((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return (
      cardId !== null &&
      cardId !== sourceCardId &&
      card !== null &&
      isMemberCardData(card.data) &&
      isEdelNoteUnit(card.data.unitName)
    );
  });
}

function hasNoOtherStageMembers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  const stageMemberIds = MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId !== null && card !== null && isMemberCardData(card.data) ? [cardId] : [];
  });
  return stageMemberIds.includes(sourceCardId) && stageMemberIds.length === 1;
}

function countOtherMiracraParkStageMembers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): number {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return 0;
  }

  return MEMBER_SLOT_ORDER.filter((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return (
      cardId !== null &&
      cardId !== sourceCardId &&
      card !== null &&
      isMemberCardData(card.data) &&
      isMiracraParkUnit(card.data.unitName)
    );
  }).length;
}

function isEdelNoteUnit(unitName: string | undefined): boolean {
  return normalizeContinuousUnitName(unitName) === 'edelnote';
}

function isMiracraParkUnit(unitName: string | undefined): boolean {
  const normalizedUnitName = normalizeContinuousUnitName(unitName);
  return normalizedUnitName === 'みらくらぱーく!' || normalizedUnitName === 'mira-crapark!';
}

function isMemberCard(card: NonNullable<ReturnType<typeof getCardById>>): boolean {
  return isMemberCardData(card.data);
}

function isHasunosoraMemberCard(card: NonNullable<ReturnType<typeof getCardById>>): boolean {
  return isMemberCardData(card.data) && cardBelongsToGroup(card.data, '蓮ノ空');
}

function normalizeContinuousMemberName(name: string): string {
  return name.replace(/[\s　・･·]/g, '');
}

function normalizeContinuousUnitName(unitName: string | undefined): string {
  return (
    unitName
      ?.replace(/[『』「」'’\s　・･·]/g, '')
      .replace(/！/g, '!')
      .toLowerCase() ?? ''
  );
}

export function addLiveModifier(game: GameState, modifier: LiveModifierState): GameState {
  return setLiveModifiers(game, [...game.liveResolution.liveModifiers, modifier]);
}

export function suppressLiveAbility(
  game: GameState,
  options: SuppressLiveAbilityOptions
): GameState {
  return addLiveModifier(game, {
    kind: 'SUPPRESS_ABILITY',
    sourceCardId: options.sourceCardId,
    suppressedAbilityId: options.suppressedAbilityId,
    abilityId: options.abilityId,
  });
}

export function isLiveAbilitySuppressed(
  game: GameState,
  sourceCardId: string,
  abilityId: string
): boolean {
  return game.liveResolution.liveModifiers.some(
    (modifier) =>
      modifier.kind === 'SUPPRESS_ABILITY' &&
      modifier.sourceCardId === sourceCardId &&
      modifier.suppressedAbilityId === abilityId
  );
}

export function createHeartLiveModifierForMember(
  game: GameState,
  options: HeartLiveModifierForMemberOptions
): HeartModifierState | null {
  const memberCard = getCardById(game, options.memberCardId);
  if (
    !memberCard ||
    memberCard.ownerId !== options.playerId ||
    !isMemberCardData(memberCard.data) ||
    options.hearts.length === 0 ||
    options.hearts.some((heart) => !(heart.count > 0))
  ) {
    return null;
  }

  const baseModifier = {
    kind: 'HEART' as const,
    playerId: options.playerId,
    hearts: options.hearts,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };

  return options.memberCardId === options.sourceCardId
    ? {
        ...baseModifier,
        target: 'SOURCE_MEMBER',
      }
    : {
        ...baseModifier,
        target: 'TARGET_MEMBER',
        targetMemberCardId: options.memberCardId,
      };
}

export function addHeartLiveModifierForMember(
  game: GameState,
  options: HeartLiveModifierForMemberOptions
): AddHeartLiveModifierForMemberResult | null {
  const modifier = createHeartLiveModifierForMember(game, options);
  if (!modifier) {
    return null;
  }

  return {
    gameState: addLiveModifier(game, modifier),
    modifier,
    heartBonus: options.hearts,
  };
}

export function addMemberCostLiveModifierForMember(
  game: GameState,
  options: MemberCostLiveModifierForMemberOptions
): AddMemberCostLiveModifierForMemberResult | null {
  if (!Number.isInteger(options.countDelta) || options.countDelta === 0) {
    return null;
  }

  const memberCard = getCardById(game, options.memberCardId);
  if (
    !memberCard ||
    memberCard.ownerId !== options.playerId ||
    !isMemberCardData(memberCard.data)
  ) {
    return null;
  }

  const modifier: MemberCostModifierState = {
    kind: 'MEMBER_COST',
    playerId: options.playerId,
    memberCardId: options.memberCardId,
    countDelta: options.countDelta,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };

  return {
    gameState: addLiveModifier(game, modifier),
    modifier,
    costDelta: options.countDelta,
  };
}

export function addMemberCostSetLiveModifierForMember(
  game: GameState,
  options: MemberCostSetLiveModifierForMemberOptions
): AddMemberCostSetLiveModifierForMemberResult | null {
  if (!Number.isInteger(options.setTo) || options.setTo < 0) {
    return null;
  }

  const memberCard = getCardById(game, options.memberCardId);
  if (
    !memberCard ||
    memberCard.ownerId !== options.playerId ||
    !isMemberCardData(memberCard.data)
  ) {
    return null;
  }

  const modifier: MemberCostSetModifierState = {
    kind: 'MEMBER_COST_SET',
    playerId: options.playerId,
    memberCardId: options.memberCardId,
    setTo: options.setTo,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };

  return {
    gameState: addLiveModifier(game, modifier),
    modifier,
    setTo: options.setTo,
  };
}

export function replaceLiveModifier(
  game: GameState,
  match: LiveModifierMatch,
  replacement: LiveModifierState | null
): GameState {
  const liveModifiers = game.liveResolution.liveModifiers.filter(
    (modifier) => !matchesLiveModifier(modifier, match)
  );
  return setLiveModifiers(
    game,
    replacement === null ? liveModifiers : [...liveModifiers, replacement]
  );
}

function setLiveModifiers(game: GameState, liveModifiers: readonly LiveModifierState[]): GameState {
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      ...projectLiveModifierCompatibility(liveModifiers),
      liveModifiers,
    },
  };
}

export function projectLiveModifierCompatibility(
  liveModifiers: readonly LiveModifierState[]
): LiveModifierCompatibilityProjection {
  const playerScoreBonuses = new Map<string, number>();
  const playerHeartBonuses = new Map<string, HeartIcon[]>();
  const liveRequirementReductions = new Map<string, number>();
  const liveRequirementModifiers = new Map<string, LiveRequirementModifierState[]>();

  for (const modifier of liveModifiers) {
    if (modifier.kind === 'SCORE') {
      playerScoreBonuses.set(
        modifier.playerId,
        (playerScoreBonuses.get(modifier.playerId) ?? 0) + modifier.countDelta
      );
      continue;
    }

    if (modifier.kind === 'HEART' && getHeartModifierTarget(modifier) === 'PLAYER') {
      playerHeartBonuses.set(modifier.playerId, [
        ...(playerHeartBonuses.get(modifier.playerId) ?? []),
        ...modifier.hearts,
      ]);
      continue;
    }

    if (modifier.kind === 'REQUIREMENT') {
      liveRequirementModifiers.set(modifier.liveCardId, [
        ...(liveRequirementModifiers.get(modifier.liveCardId) ?? []),
        ...modifier.modifiers,
      ]);

      const genericReduction = modifier.modifiers
        .filter(
          (requirementModifier) =>
            requirementModifier.color === HeartColor.RAINBOW && requirementModifier.countDelta < 0
        )
        .reduce((total, requirementModifier) => total - requirementModifier.countDelta, 0);
      if (genericReduction > 0) {
        liveRequirementReductions.set(
          modifier.liveCardId,
          (liveRequirementReductions.get(modifier.liveCardId) ?? 0) + genericReduction
        );
      }
    }
  }

  return {
    playerScoreBonuses,
    playerHeartBonuses,
    liveRequirementReductions,
    liveRequirementModifiers,
  };
}

function matchesLiveModifier(modifier: LiveModifierState, match: LiveModifierMatch): boolean {
  if (match.kind !== undefined && modifier.kind !== match.kind) {
    return false;
  }

  if (match.playerId !== undefined) {
    if (!('playerId' in modifier) || modifier.playerId !== match.playerId) {
      return false;
    }
  }

  if (match.liveCardId !== undefined) {
    if (!('liveCardId' in modifier) || modifier.liveCardId !== match.liveCardId) {
      return false;
    }
  }

  if (match.sourceCardId !== undefined && modifier.sourceCardId !== match.sourceCardId) {
    return false;
  }

  if (match.targetMemberCardId !== undefined) {
    if (
      !('targetMemberCardId' in modifier) ||
      modifier.targetMemberCardId !== match.targetMemberCardId
    ) {
      return false;
    }
  }

  if (match.abilityId !== undefined && modifier.abilityId !== match.abilityId) {
    return false;
  }

  return true;
}

export function getPlayerLiveScoreModifier(
  liveResolution: LiveResolutionState,
  playerId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): number {
  const modifiers = getScoreModifiers(playerId, liveModifiers);
  if (modifiers.length > 0) {
    return modifiers
      .filter((modifier) => modifier.liveCardId === undefined)
      .reduce((total, modifier) => total + modifier.countDelta, 0);
  }
  return liveResolution.playerScoreBonuses.get(playerId) ?? 0;
}

export function getLiveCardScoreModifier(
  liveResolution: LiveResolutionState,
  liveCardId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): number {
  return liveModifiers
    .filter(
      (modifier): modifier is ScoreModifierState =>
        modifier.kind === 'SCORE' && modifier.liveCardId === liveCardId
    )
    .reduce((total, modifier) => total + modifier.countDelta, 0);
}

export function getPlayerLiveHeartModifiers(
  liveResolution: LiveResolutionState,
  playerId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): readonly HeartIcon[] {
  const modifiers = getHeartModifiers(playerId, liveModifiers);
  if (modifiers.length > 0) {
    return modifiers.flatMap((modifier) => modifier.hearts);
  }
  return liveResolution.playerHeartBonuses.get(playerId) ?? [];
}

export function getPlayerLiveBladeModifier(
  liveResolution: LiveResolutionState,
  playerId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): number {
  return getBladeModifiers(playerId, liveModifiers).reduce(
    (total, modifier) => total + modifier.countDelta,
    0
  );
}

export function getEffectivePerformanceCheerCount(
  game: GameState,
  playerId: string,
  baseCheerCount: number,
  liveModifiers: readonly LiveModifierState[] = collectLiveModifiers(game)
): number {
  const cheerCountDelta = getCheerCountModifiers(playerId, liveModifiers).reduce(
    (total, modifier) => total + modifier.countDelta,
    0
  );
  return Math.max(0, baseCheerCount + cheerCountDelta);
}

export function getMemberEffectiveBladeCount(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  liveModifiers: readonly LiveModifierState[] = collectLiveModifiers(game)
): number {
  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard || !isMemberCardData(sourceCard.data)) {
    return 0;
  }

  const modifierBladeCount = getBladeModifiers(playerId, liveModifiers)
    .filter((modifier) => modifier.sourceCardId === sourceCardId)
    .reduce((total, modifier) => total + modifier.countDelta, 0);

  const replacement = getLatestMemberOriginalBladeReplacementModifier(
    playerId,
    sourceCardId,
    liveModifiers
  );
  const originalBladeCount = replacement ? replacement.count : sourceCard.data.blade;

  return Math.max(0, originalBladeCount + modifierBladeCount);
}

export function getMemberOriginalBladeCount(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  liveModifiers: readonly LiveModifierState[] = game.liveResolution.liveModifiers
): number {
  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard || !isMemberCardData(sourceCard.data)) {
    return 0;
  }

  const replacement = getLatestMemberOriginalBladeReplacementModifier(
    playerId,
    sourceCardId,
    liveModifiers
  );
  return Math.max(0, replacement ? replacement.count : sourceCard.data.blade);
}

export function getMemberEffectiveHeartIcons(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  liveModifiers: readonly LiveModifierState[] = collectLiveModifiers(game)
): readonly HeartIcon[] {
  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard || !isMemberCardData(sourceCard.data)) {
    return [];
  }

  const replacement = getLatestMemberOriginalHeartReplacementModifier(
    playerId,
    sourceCardId,
    liveModifiers
  );
  const baseHearts = replacement
    ? replaceOriginalHeartColor(sourceCard.data.hearts, replacement.color)
    : sourceCard.data.hearts;
  const modifierHearts = liveModifiers
    .filter(
      (modifier): modifier is HeartModifierState =>
        modifier.kind === 'HEART' &&
        modifier.playerId === playerId &&
        ((getHeartModifierTarget(modifier) === 'SOURCE_MEMBER' &&
          modifier.sourceCardId === sourceCardId) ||
          (getHeartModifierTarget(modifier) === 'TARGET_MEMBER' &&
            getHeartModifierTargetMemberCardId(modifier) === sourceCardId))
    )
    .flatMap((modifier) => modifier.hearts);

  return [...baseHearts, ...modifierHearts];
}

export function memberHasMoreEffectiveHeartsThanPrinted(
  game: GameState,
  playerId: string,
  memberCardId: string,
  liveModifiers: readonly LiveModifierState[] = collectLiveModifiers(game)
): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, memberCardId);
  if (
    !player ||
    !card ||
    card.ownerId !== playerId ||
    !isMemberCardData(card.data) ||
    findMemberSlot(player, memberCardId) === null
  ) {
    return false;
  }

  const countHearts = (hearts: readonly HeartIcon[]): number =>
    hearts.reduce((total, heart) => total + heart.count, 0);
  return (
    countHearts(getMemberEffectiveHeartIcons(game, playerId, memberCardId, liveModifiers)) >
    countHearts(card.data.hearts)
  );
}

export function getCheerCardEffectiveBladeHearts(
  game: GameState,
  playerId: string,
  cardId: string,
  liveModifiers: readonly LiveModifierState[] = collectLiveModifiers(game)
): readonly BladeHeartItem[] {
  const card = getCardById(game, cardId);
  if (!card || card.ownerId !== playerId || !('bladeHearts' in card.data)) {
    return [];
  }

  const bladeHearts = (card.data as { readonly bladeHearts?: readonly BladeHeartItem[] })
    .bladeHearts;
  if (!bladeHearts || bladeHearts.length === 0) {
    return [];
  }

  const replacement = getLatestCheerCardHeartColorReplacementModifier(playerId, liveModifiers);
  if (!replacement) {
    return bladeHearts;
  }

  const fromColorSet = new Set(replacement.fromColors);
  return bladeHearts.map((item) =>
    item.effect === BladeHeartEffect.HEART &&
    item.heartColor !== undefined &&
    fromColorSet.has(item.heartColor)
      ? { ...item, heartColor: replacement.toColor }
      : item
  );
}

function getLatestMemberOriginalHeartReplacementModifier(
  playerId: string,
  memberCardId: string,
  liveModifiers: readonly LiveModifierState[]
): MemberOriginalHeartReplacementModifierState | null {
  let latest: MemberOriginalHeartReplacementModifierState | null = null;
  for (const modifier of liveModifiers) {
    if (
      modifier.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT' &&
      modifier.playerId === playerId &&
      modifier.memberCardId === memberCardId
    ) {
      latest = modifier;
    }
  }
  return latest;
}

function getLatestMemberOriginalBladeReplacementModifier(
  playerId: string,
  memberCardId: string,
  liveModifiers: readonly LiveModifierState[]
): MemberOriginalBladeReplacementModifierState | null {
  let latest: MemberOriginalBladeReplacementModifierState | null = null;
  for (const modifier of liveModifiers) {
    if (
      modifier.kind === 'MEMBER_ORIGINAL_BLADE_REPLACEMENT' &&
      modifier.playerId === playerId &&
      modifier.memberCardId === memberCardId
    ) {
      latest = modifier;
    }
  }
  return latest;
}

function getLatestCheerCardHeartColorReplacementModifier(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): CheerCardHeartColorReplacementModifierState | null {
  let latest: CheerCardHeartColorReplacementModifierState | null = null;
  for (const modifier of liveModifiers) {
    if (modifier.kind === 'CHEER_CARD_HEART_COLOR_REPLACEMENT' && modifier.playerId === playerId) {
      latest = modifier;
    }
  }
  return latest;
}

function replaceOriginalHeartColor(
  printedHearts: readonly HeartIcon[],
  color: HeartColor
): readonly HeartIcon[] {
  const total = printedHearts.reduce((sum, heart) => sum + heart.count, 0);
  return total > 0 ? [{ color, count: total }] : [];
}

function getHeartModifierTarget(modifier: HeartModifierState): HeartModifierState['target'] {
  return (modifier as { readonly target?: HeartModifierState['target'] }).target ?? 'PLAYER';
}

function getHeartModifierTargetMemberCardId(modifier: HeartModifierState): string | undefined {
  return (modifier as { readonly targetMemberCardId?: string }).targetMemberCardId;
}

export function getLiveCardRequirementModifiers(
  liveResolution: LiveResolutionState,
  liveCardId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): readonly LiveRequirementModifierState[] {
  const modifiers = getRequirementModifiers(liveCardId, liveModifiers);
  if (modifiers.length > 0) {
    return modifiers.flatMap((modifier) => modifier.modifiers);
  }

  const legacyModifiers = liveResolution.liveRequirementModifiers.get(liveCardId) ?? [];
  if (legacyModifiers.length > 0) {
    return legacyModifiers;
  }

  const legacyReduction = liveResolution.liveRequirementReductions.get(liveCardId) ?? 0;
  return legacyReduction > 0 ? [{ color: HeartColor.RAINBOW, countDelta: -legacyReduction }] : [];
}
