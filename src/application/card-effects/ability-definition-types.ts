import type { CardType, SlotPosition, TriggerCondition, ZoneType } from '../../shared/types/enums.js';

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
  readonly text: string;
  readonly title: string;
}

export interface OnEnterStageTriggerFilter {
  readonly enteredController?: 'SELF' | 'OPPONENT' | 'ANY';
  readonly excludeEnteredCardAsSource?: boolean;
  readonly enteredCardType?: CardType;
  readonly enteredGroupAliases?: readonly string[];
  readonly enteredUnitAliases?: readonly string[];
  readonly enteredOrdinalThisTurn?: number;
}

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
  readonly triggerFromZones?: readonly ZoneType[];
  readonly triggerToZones?: readonly ZoneType[];
  readonly onEnterStageTriggerFilter?: OnEnterStageTriggerFilter;
  readonly energyPlacementCause?: 'ANY_CARD_EFFECT' | 'OWN_CARD_EFFECT';
  readonly perTurnLimit?: number;
  readonly countPendingAsTurnUse?: boolean;
  readonly observerOnly?: boolean;
  readonly skipQueueWhenTurnLimitReached?: boolean;
  readonly activatedUi?: ActivatedAbilityUiConfig;
  /** Explicit opt-in for resolving this ON_ENTER ability with its member still in the waiting room. */
  readonly delegatedOnEnterFromWaitingRoomPolicy?: 'ALLOW';
  readonly notes?: string;
}
