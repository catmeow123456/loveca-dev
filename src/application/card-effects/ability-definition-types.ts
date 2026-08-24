import type {
  CardType,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../shared/types/enums.js';

export enum CardAbilityCategory {
  CONTINUOUS = 'CONTINUOUS',
  ON_ENTER = 'ON_ENTER',
  ACTIVATED = 'ACTIVATED',
  LIVE_START = 'LIVE_START',
  LIVE_SUCCESS = 'LIVE_SUCCESS',
  AUTO = 'AUTO',
}

export enum CardAbilitySourceZone {
  ANYWHERE = 'ANYWHERE',
  PLAYED_MEMBER = 'PLAYED_MEMBER',
  STAGE_MEMBER = 'STAGE_MEMBER',
  HAND = 'HAND',
  WAITING_ROOM = 'WAITING_ROOM',
  LIVE_CARD = 'LIVE_CARD',
  SUCCESS_LIVE_CARD = 'SUCCESS_LIVE_CARD',
  /** A card still revealed in its controller's current Live cheer set. */
  REVEALED_CHEER_CARD = 'REVEALED_CHEER_CARD',
}

export interface ActivatedAbilityUiConfig {
  readonly abilityId: string;
  /**
   * One concrete runtime copy of an activated ability.
   *
   * Direct abilities omit this field. PL!SP-pb2-005 granted abilities use it
   * to distinguish otherwise identical abilities granted by different cards
   * below the same host member.
   */
  readonly abilityInstanceId?: string;
  readonly text: string;
  readonly title: string;
  readonly displayOrder?: number;
  /** Source orientation required to expose this activated ability as currently usable. */
  readonly requiredSourceOrientation?: OrientationState;
}

export interface OnEnterStageTriggerFilter {
  readonly enteredController?: 'SELF' | 'OPPONENT' | 'ANY';
  readonly excludeEnteredCardAsSource?: boolean;
  readonly enteredCardType?: CardType;
  readonly enteredPrintedCost?: number;
  readonly enteredViaRelay?: boolean;
  readonly enteredGroupAliases?: readonly string[];
  readonly enteredUnitAliases?: readonly string[];
  readonly enteredOrdinalThisTurn?: number;
}

export interface PlayedMemberOnEnterTriggerFilter {
  readonly enteredViaRelay?: boolean;
  readonly replacedMemberGroupAliases?: readonly string[];
}

export interface MemberStateChangedTriggerFilter {
  readonly changedController?: 'SELF' | 'OPPONENT' | 'ANY';
  readonly previousOrientation?: OrientationState;
  readonly nextOrientation?: OrientationState;
}

export interface OnLeaveStageTriggerFilter {
  /**
   * Require the member that replaced this source through relay to match this
   * structured identity and printed-cost boundary.
   */
  readonly relayReplacementMember?: {
    readonly groupAliases: readonly string[];
    readonly minPrintedCost: number;
  };
}

export interface RemainingHeartAllocationPreferenceDefinition {
  readonly color: HeartColor;
  readonly minCount: number;
  readonly requiredStageGroupAlias?: string;
}

export type WaitingRoomOnEnterDelegationPolicy =
  | {
      readonly decision: 'ALLOW';
      readonly reason:
        | 'SOURCE_INDEPENDENT'
        | 'PLAYER_RESOURCE_COST'
        | 'OTHER_STAGE_MEMBER_COST'
        | 'SOURCE_SLOT_ABSENT_NO_EFFECT';
    }
  | {
      readonly decision: 'DENY';
      readonly reason:
        'SOURCE_MEMBER_COST_UNPAYABLE' | 'SOURCE_MEMBER_POSITION_CHANGE' | 'SOURCE_SLOT_REQUIRED';
    };

export interface CardAbilityDefinition {
  readonly abilityId: string;
  readonly cardCodes?: readonly string[];
  readonly baseCardCodes?: readonly string[];
  readonly category: CardAbilityCategory;
  readonly sourceZone: CardAbilitySourceZone;
  readonly triggerCondition?: TriggerCondition;
  readonly queued: boolean;
  readonly implemented: boolean;
  readonly effectText: string;
  readonly requiredSourceSlots?: readonly SlotPosition[];
  readonly requiredSourceOrientation?: OrientationState;
  readonly requiredSourceOrientationAtTrigger?: OrientationState;
  readonly triggerFromZones?: readonly ZoneType[];
  readonly triggerToZones?: readonly ZoneType[];
  readonly enterWaitingRoomCause?: 'OWN_LIVE_SUCCESS_ABILITY';
  readonly playedMemberOnEnterTriggerFilter?: PlayedMemberOnEnterTriggerFilter;
  readonly onEnterStageTriggerFilter?: OnEnterStageTriggerFilter;
  readonly memberStateChangedTriggerFilter?: MemberStateChangedTriggerFilter;
  readonly onLeaveStageTriggerFilter?: OnLeaveStageTriggerFilter;
  readonly energyPlacementCause?: 'ANY_CARD_EFFECT' | 'OWN_CARD_EFFECT';
  readonly perTurnLimit?: number;
  readonly countPendingAsTurnUse?: boolean;
  readonly observerOnly?: boolean;
  readonly skipQueueWhenTurnLimitReached?: boolean;
  readonly activatedUi?: ActivatedAbilityUiConfig;
  /** Preference used by automatic LIVE Heart allocation before this LIVE_SUCCESS ability resolves. */
  readonly remainingHeartAllocationPreference?: RemainingHeartAllocationPreferenceDefinition;
  /** Explicit compatibility decision for resolving this ON_ENTER ability with its source still in the waiting room. */
  readonly delegatedOnEnterFromWaitingRoomPolicy?: WaitingRoomOnEnterDelegationPolicy;
  readonly notes?: string;
}
