import { SlotPosition, SubPhase, ZoneType } from '../shared/types/enums.js';

export enum GameCommandType {
  MULLIGAN = 'MULLIGAN',
  SET_LIVE_CARD = 'SET_LIVE_CARD',
  TAP_MEMBER = 'TAP_MEMBER',
  TAP_ENERGY = 'TAP_ENERGY',
  END_PHASE = 'END_PHASE',
  OPEN_INSPECTION = 'OPEN_INSPECTION',
  REVEAL_CHEER_CARD = 'REVEAL_CHEER_CARD',
  REVEAL_INSPECTED_CARD = 'REVEAL_INSPECTED_CARD',
  MOVE_INSPECTED_CARD_TO_TOP = 'MOVE_INSPECTED_CARD_TO_TOP',
  MOVE_INSPECTED_CARD_TO_BOTTOM = 'MOVE_INSPECTED_CARD_TO_BOTTOM',
  MOVE_INSPECTED_CARD_TO_ZONE = 'MOVE_INSPECTED_CARD_TO_ZONE',
  MOVE_CARD_TO_INSPECTION = 'MOVE_CARD_TO_INSPECTION',
  REORDER_INSPECTED_CARD = 'REORDER_INSPECTED_CARD',
  MOVE_RESOLUTION_CARD_TO_ZONE = 'MOVE_RESOLUTION_CARD_TO_ZONE',
  MOVE_TABLE_CARD = 'MOVE_TABLE_CARD',
  MOVE_MEMBER_TO_SLOT = 'MOVE_MEMBER_TO_SLOT',
  ATTACH_ENERGY_TO_MEMBER = 'ATTACH_ENERGY_TO_MEMBER',
  PLAY_MEMBER_TO_SLOT = 'PLAY_MEMBER_TO_SLOT',
  MOVE_PUBLIC_CARD_TO_WAITING_ROOM = 'MOVE_PUBLIC_CARD_TO_WAITING_ROOM',
  MOVE_PUBLIC_CARD_TO_HAND = 'MOVE_PUBLIC_CARD_TO_HAND',
  MOVE_PUBLIC_CARD_TO_ENERGY_DECK = 'MOVE_PUBLIC_CARD_TO_ENERGY_DECK',
  MOVE_OWNED_CARD_TO_ZONE = 'MOVE_OWNED_CARD_TO_ZONE',
  FINISH_INSPECTION = 'FINISH_INSPECTION',
  CONFIRM_STEP = 'CONFIRM_STEP',
  CONFIRM_PERFORMANCE_OUTCOME = 'CONFIRM_PERFORMANCE_OUTCOME',
  SUBMIT_JUDGMENT = 'SUBMIT_JUDGMENT',
  SUBMIT_SCORE = 'SUBMIT_SCORE',
  SELECT_SUCCESS_LIVE = 'SELECT_SUCCESS_LIVE',
  DRAW_CARD_TO_HAND = 'DRAW_CARD_TO_HAND',
  DRAW_ENERGY_TO_ZONE = 'DRAW_ENERGY_TO_ZONE',
  RETURN_HAND_CARD_TO_TOP = 'RETURN_HAND_CARD_TO_TOP',
}

export interface BaseGameCommand {
  readonly type: GameCommandType;
  readonly playerId: string;
  readonly timestamp: number;
  readonly idempotencyKey?: string;
}

export interface MulliganCommand extends BaseGameCommand {
  readonly type: GameCommandType.MULLIGAN;
  readonly cardIdsToMulligan: readonly string[];
}

export interface SetLiveCardCommand extends BaseGameCommand {
  readonly type: GameCommandType.SET_LIVE_CARD;
  readonly cardId: string;
  readonly faceDown: boolean;
}

export interface TapMemberCommand extends BaseGameCommand {
  readonly type: GameCommandType.TAP_MEMBER;
  readonly cardId: string;
  readonly slot: SlotPosition;
}

export interface TapEnergyCommand extends BaseGameCommand {
  readonly type: GameCommandType.TAP_ENERGY;
  readonly cardId: string;
}

export interface EndPhaseCommand extends BaseGameCommand {
  readonly type: GameCommandType.END_PHASE;
}

export interface OpenInspectionCommand extends BaseGameCommand {
  readonly type: GameCommandType.OPEN_INSPECTION;
  readonly sourceZone: ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK;
  readonly count: number;
}

export interface RevealCheerCardCommand extends BaseGameCommand {
  readonly type: GameCommandType.REVEAL_CHEER_CARD;
}

export interface RevealInspectedCardCommand extends BaseGameCommand {
  readonly type: GameCommandType.REVEAL_INSPECTED_CARD;
  readonly cardId: string;
}

export interface MoveInspectedCardToTopCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_INSPECTED_CARD_TO_TOP;
  readonly cardId: string;
}

export interface MoveInspectedCardToBottomCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM;
  readonly cardId: string;
}

export interface MoveInspectedCardToZoneCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE;
  readonly cardId: string;
  readonly toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.EXILE_ZONE;
}

export interface MoveCardToInspectionCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_CARD_TO_INSPECTION;
  readonly cardId: string;
  readonly fromZone: ZoneType.HAND | ZoneType.WAITING_ROOM;
}

export interface ReorderInspectedCardCommand extends BaseGameCommand {
  readonly type: GameCommandType.REORDER_INSPECTED_CARD;
  readonly cardId: string;
  readonly toIndex: number;
}

export interface MoveResolutionCardToZoneCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE;
  readonly cardId: string;
  readonly toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.MAIN_DECK | ZoneType.EXILE_ZONE;
  readonly position?: 'TOP' | 'BOTTOM';
}

export interface MoveTableCardCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_TABLE_CARD;
  readonly cardId: string;
  readonly fromZone: ZoneType;
  readonly toZone: ZoneType;
  readonly targetSlot?: SlotPosition;
  readonly sourceSlot?: SlotPosition;
  readonly position?: 'TOP' | 'BOTTOM';
}

export interface MoveMemberToSlotCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_MEMBER_TO_SLOT;
  readonly cardId: string;
  readonly sourceSlot: SlotPosition;
  readonly targetSlot: SlotPosition;
}

export interface AttachEnergyToMemberCommand extends BaseGameCommand {
  readonly type: GameCommandType.ATTACH_ENERGY_TO_MEMBER;
  readonly cardId: string;
  readonly fromZone: ZoneType.MEMBER_SLOT | ZoneType.ENERGY_ZONE | ZoneType.ENERGY_DECK;
  readonly targetSlot: SlotPosition;
  readonly sourceSlot?: SlotPosition;
}

export interface PlayMemberToSlotCommand extends BaseGameCommand {
  readonly type: GameCommandType.PLAY_MEMBER_TO_SLOT;
  readonly cardId: string;
  readonly targetSlot: SlotPosition;
}

export interface MovePublicCardToWaitingRoomCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM;
  readonly cardId: string;
  readonly fromZone: ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE;
  readonly sourceSlot?: SlotPosition;
}

export interface MovePublicCardToHandCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_PUBLIC_CARD_TO_HAND;
  readonly cardId: string;
  readonly fromZone:
    | ZoneType.MEMBER_SLOT
    | ZoneType.LIVE_ZONE
    | ZoneType.SUCCESS_ZONE
    | ZoneType.WAITING_ROOM;
  readonly sourceSlot?: SlotPosition;
}

export interface MovePublicCardToEnergyDeckCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK;
  readonly cardId: string;
  readonly fromZone: ZoneType.ENERGY_ZONE;
}

export interface MoveOwnedCardToZoneCommand extends BaseGameCommand {
  readonly type: GameCommandType.MOVE_OWNED_CARD_TO_ZONE;
  readonly cardId: string;
  readonly fromZone: ZoneType.HAND | ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK;
  readonly toZone:
    | ZoneType.HAND
    | ZoneType.MAIN_DECK
    | ZoneType.ENERGY_DECK
    | ZoneType.MEMBER_SLOT
    | ZoneType.ENERGY_ZONE
    | ZoneType.LIVE_ZONE
    | ZoneType.SUCCESS_ZONE
    | ZoneType.WAITING_ROOM
    | ZoneType.EXILE_ZONE;
  readonly targetSlot?: SlotPosition;
  readonly position?: 'TOP' | 'BOTTOM';
}

export interface FinishInspectionCommand extends BaseGameCommand {
  readonly type: GameCommandType.FINISH_INSPECTION;
}

export interface ConfirmStepCommand extends BaseGameCommand {
  readonly type: GameCommandType.CONFIRM_STEP;
  readonly subPhase: SubPhase;
}

export interface ConfirmPerformanceOutcomeCommand extends BaseGameCommand {
  readonly type: GameCommandType.CONFIRM_PERFORMANCE_OUTCOME;
  readonly success: boolean;
}

export interface SubmitJudgmentCommand extends BaseGameCommand {
  readonly type: GameCommandType.SUBMIT_JUDGMENT;
  readonly judgmentResults: ReadonlyMap<string, boolean>;
}

export interface SubmitScoreCommand extends BaseGameCommand {
  readonly type: GameCommandType.SUBMIT_SCORE;
  readonly adjustedScore?: number;
}

export interface SelectSuccessLiveCommand extends BaseGameCommand {
  readonly type: GameCommandType.SELECT_SUCCESS_LIVE;
  readonly cardId: string;
}

export interface DrawCardToHandCommand extends BaseGameCommand {
  readonly type: GameCommandType.DRAW_CARD_TO_HAND;
}

export interface DrawEnergyToZoneCommand extends BaseGameCommand {
  readonly type: GameCommandType.DRAW_ENERGY_TO_ZONE;
  readonly cardId: string;
}

export interface ReturnHandCardToTopCommand extends BaseGameCommand {
  readonly type: GameCommandType.RETURN_HAND_CARD_TO_TOP;
  readonly cardId: string;
}

export type GameCommand =
  | MulliganCommand
  | SetLiveCardCommand
  | TapMemberCommand
  | TapEnergyCommand
  | EndPhaseCommand
  | OpenInspectionCommand
  | RevealCheerCardCommand
  | RevealInspectedCardCommand
  | MoveInspectedCardToTopCommand
  | MoveInspectedCardToBottomCommand
  | MoveInspectedCardToZoneCommand
  | MoveCardToInspectionCommand
  | ReorderInspectedCardCommand
  | MoveResolutionCardToZoneCommand
  | MoveTableCardCommand
  | MoveMemberToSlotCommand
  | AttachEnergyToMemberCommand
  | PlayMemberToSlotCommand
  | MovePublicCardToWaitingRoomCommand
  | MovePublicCardToHandCommand
  | MovePublicCardToEnergyDeckCommand
  | MoveOwnedCardToZoneCommand
  | FinishInspectionCommand
  | ConfirmStepCommand
  | ConfirmPerformanceOutcomeCommand
  | SubmitJudgmentCommand
  | SubmitScoreCommand
  | SelectSuccessLiveCommand
  | DrawCardToHandCommand
  | DrawEnergyToZoneCommand
  | ReturnHandCardToTopCommand;

export function createMulliganCommand(
  playerId: string,
  cardIdsToMulligan: readonly string[]
): MulliganCommand {
  return {
    type: GameCommandType.MULLIGAN,
    playerId,
    cardIdsToMulligan,
    timestamp: Date.now(),
  };
}

export function createSetLiveCardCommand(
  playerId: string,
  cardId: string,
  faceDown = true
): SetLiveCardCommand {
  return {
    type: GameCommandType.SET_LIVE_CARD,
    playerId,
    cardId,
    faceDown,
    timestamp: Date.now(),
  };
}

export function createTapMemberCommand(
  playerId: string,
  cardId: string,
  slot: SlotPosition
): TapMemberCommand {
  return {
    type: GameCommandType.TAP_MEMBER,
    playerId,
    cardId,
    slot,
    timestamp: Date.now(),
  };
}

export function createTapEnergyCommand(playerId: string, cardId: string): TapEnergyCommand {
  return {
    type: GameCommandType.TAP_ENERGY,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}

export function createEndPhaseCommand(playerId: string): EndPhaseCommand {
  return {
    type: GameCommandType.END_PHASE,
    playerId,
    timestamp: Date.now(),
  };
}

export function createOpenInspectionCommand(
  playerId: string,
  sourceZone: OpenInspectionCommand['sourceZone'],
  count: number
): OpenInspectionCommand {
  return {
    type: GameCommandType.OPEN_INSPECTION,
    playerId,
    sourceZone,
    count,
    timestamp: Date.now(),
  };
}

export function createRevealCheerCardCommand(playerId: string): RevealCheerCardCommand {
  return {
    type: GameCommandType.REVEAL_CHEER_CARD,
    playerId,
    timestamp: Date.now(),
  };
}

export function createRevealInspectedCardCommand(
  playerId: string,
  cardId: string
): RevealInspectedCardCommand {
  return {
    type: GameCommandType.REVEAL_INSPECTED_CARD,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}

export function createMoveInspectedCardToTopCommand(
  playerId: string,
  cardId: string
): MoveInspectedCardToTopCommand {
  return {
    type: GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}

export function createMoveInspectedCardToBottomCommand(
  playerId: string,
  cardId: string
): MoveInspectedCardToBottomCommand {
  return {
    type: GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}

export function createMoveInspectedCardToZoneCommand(
  playerId: string,
  cardId: string,
  toZone: MoveInspectedCardToZoneCommand['toZone']
): MoveInspectedCardToZoneCommand {
  return {
    type: GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
    playerId,
    cardId,
    toZone,
    timestamp: Date.now(),
  };
}

export function createMoveCardToInspectionCommand(
  playerId: string,
  cardId: string,
  fromZone: MoveCardToInspectionCommand['fromZone']
): MoveCardToInspectionCommand {
  return {
    type: GameCommandType.MOVE_CARD_TO_INSPECTION,
    playerId,
    cardId,
    fromZone,
    timestamp: Date.now(),
  };
}

export function createReorderInspectedCardCommand(
  playerId: string,
  cardId: string,
  toIndex: number
): ReorderInspectedCardCommand {
  return {
    type: GameCommandType.REORDER_INSPECTED_CARD,
    playerId,
    cardId,
    toIndex,
    timestamp: Date.now(),
  };
}

export function createMoveResolutionCardToZoneCommand(
  playerId: string,
  cardId: string,
  toZone: MoveResolutionCardToZoneCommand['toZone'],
  position?: 'TOP' | 'BOTTOM'
): MoveResolutionCardToZoneCommand {
  return {
    type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
    playerId,
    cardId,
    toZone,
    position,
    timestamp: Date.now(),
  };
}

export function createMoveTableCardCommand(
  playerId: string,
  cardId: string,
  fromZone: ZoneType,
  toZone: ZoneType,
  options?: {
    targetSlot?: SlotPosition;
    sourceSlot?: SlotPosition;
    position?: 'TOP' | 'BOTTOM';
  }
): MoveTableCardCommand {
  return {
    type: GameCommandType.MOVE_TABLE_CARD,
    playerId,
    cardId,
    fromZone,
    toZone,
    targetSlot: options?.targetSlot,
    sourceSlot: options?.sourceSlot,
    position: options?.position,
    timestamp: Date.now(),
  };
}

export function createMoveMemberToSlotCommand(
  playerId: string,
  cardId: string,
  sourceSlot: SlotPosition,
  targetSlot: SlotPosition
): MoveMemberToSlotCommand {
  return {
    type: GameCommandType.MOVE_MEMBER_TO_SLOT,
    playerId,
    cardId,
    sourceSlot,
    targetSlot,
    timestamp: Date.now(),
  };
}

export function createAttachEnergyToMemberCommand(
  playerId: string,
  cardId: string,
  fromZone: AttachEnergyToMemberCommand['fromZone'],
  targetSlot: SlotPosition,
  sourceSlot?: SlotPosition
): AttachEnergyToMemberCommand {
  return {
    type: GameCommandType.ATTACH_ENERGY_TO_MEMBER,
    playerId,
    cardId,
    fromZone,
    targetSlot,
    sourceSlot,
    timestamp: Date.now(),
  };
}

export function createPlayMemberToSlotCommand(
  playerId: string,
  cardId: string,
  targetSlot: SlotPosition
): PlayMemberToSlotCommand {
  return {
    type: GameCommandType.PLAY_MEMBER_TO_SLOT,
    playerId,
    cardId,
    targetSlot,
    timestamp: Date.now(),
  };
}

export function createMovePublicCardToWaitingRoomCommand(
  playerId: string,
  cardId: string,
  fromZone: MovePublicCardToWaitingRoomCommand['fromZone'],
  sourceSlot?: SlotPosition
): MovePublicCardToWaitingRoomCommand {
  return {
    type: GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM,
    playerId,
    cardId,
    fromZone,
    sourceSlot,
    timestamp: Date.now(),
  };
}

export function createMovePublicCardToHandCommand(
  playerId: string,
  cardId: string,
  fromZone: MovePublicCardToHandCommand['fromZone'],
  sourceSlot?: SlotPosition
): MovePublicCardToHandCommand {
  return {
    type: GameCommandType.MOVE_PUBLIC_CARD_TO_HAND,
    playerId,
    cardId,
    fromZone,
    sourceSlot,
    timestamp: Date.now(),
  };
}

export function createMovePublicCardToEnergyDeckCommand(
  playerId: string,
  cardId: string,
  fromZone: MovePublicCardToEnergyDeckCommand['fromZone']
): MovePublicCardToEnergyDeckCommand {
  return {
    type: GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK,
    playerId,
    cardId,
    fromZone,
    timestamp: Date.now(),
  };
}

export function createMoveOwnedCardToZoneCommand(
  playerId: string,
  cardId: string,
  fromZone: MoveOwnedCardToZoneCommand['fromZone'],
  toZone: MoveOwnedCardToZoneCommand['toZone'],
  options?: {
    targetSlot?: SlotPosition;
    position?: 'TOP' | 'BOTTOM';
  }
): MoveOwnedCardToZoneCommand {
  return {
    type: GameCommandType.MOVE_OWNED_CARD_TO_ZONE,
    playerId,
    cardId,
    fromZone,
    toZone,
    targetSlot: options?.targetSlot,
    position: options?.position,
    timestamp: Date.now(),
  };
}

export function createFinishInspectionCommand(playerId: string): FinishInspectionCommand {
  return {
    type: GameCommandType.FINISH_INSPECTION,
    playerId,
    timestamp: Date.now(),
  };
}

export function createConfirmStepCommand(playerId: string, subPhase: SubPhase): ConfirmStepCommand {
  return {
    type: GameCommandType.CONFIRM_STEP,
    playerId,
    subPhase,
    timestamp: Date.now(),
  };
}

export function createConfirmPerformanceOutcomeCommand(
  playerId: string,
  success: boolean
): ConfirmPerformanceOutcomeCommand {
  return {
    type: GameCommandType.CONFIRM_PERFORMANCE_OUTCOME,
    playerId,
    success,
    timestamp: Date.now(),
  };
}

export function createSubmitJudgmentCommand(
  playerId: string,
  judgmentResults: ReadonlyMap<string, boolean>
): SubmitJudgmentCommand {
  return {
    type: GameCommandType.SUBMIT_JUDGMENT,
    playerId,
    judgmentResults,
    timestamp: Date.now(),
  };
}

export function createSubmitScoreCommand(
  playerId: string,
  adjustedScore?: number
): SubmitScoreCommand {
  return {
    type: GameCommandType.SUBMIT_SCORE,
    playerId,
    adjustedScore,
    timestamp: Date.now(),
  };
}

export function createSelectSuccessLiveCommand(
  playerId: string,
  cardId: string
): SelectSuccessLiveCommand {
  return {
    type: GameCommandType.SELECT_SUCCESS_LIVE,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}

export function createDrawCardToHandCommand(playerId: string): DrawCardToHandCommand {
  return {
    type: GameCommandType.DRAW_CARD_TO_HAND,
    playerId,
    timestamp: Date.now(),
  };
}

export function createDrawEnergyToZoneCommand(
  playerId: string,
  cardId: string
): DrawEnergyToZoneCommand {
  return {
    type: GameCommandType.DRAW_ENERGY_TO_ZONE,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}

export function createReturnHandCardToTopCommand(
  playerId: string,
  cardId: string
): ReturnHandCardToTopCommand {
  return {
    type: GameCommandType.RETURN_HAND_CARD_TO_TOP,
    playerId,
    cardId,
    timestamp: Date.now(),
  };
}
