import type { SlotPosition, TriggerCondition, ZoneType } from '../../shared/types/enums.js';

export enum CardAbilityCategory {
  CONTINUOUS = 'CONTINUOUS',
  ON_ENTER = 'ON_ENTER',
  ACTIVATED = 'ACTIVATED',
  LIVE_START = 'LIVE_START',
  LIVE_SUCCESS = 'LIVE_SUCCESS',
  AUTO = 'AUTO',
}

export enum CardAbilitySourceZone {
  PLAYED_MEMBER = 'PLAYED_MEMBER',
  STAGE_MEMBER = 'STAGE_MEMBER',
  HAND = 'HAND',
  WAITING_ROOM = 'WAITING_ROOM',
  LIVE_CARD = 'LIVE_CARD',
  SUCCESS_LIVE_CARD = 'SUCCESS_LIVE_CARD',
}

export interface ActivatedAbilityUiConfig {
  readonly abilityId: string;
  readonly text: string;
  readonly title: string;
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
  readonly perTurnLimit?: number;
  readonly observerOnly?: boolean;
  readonly skipQueueWhenTurnLimitReached?: boolean;
  readonly activatedUi?: ActivatedAbilityUiConfig;
  readonly notes?: string;
}
