import { GameCommandType } from '@game/application/game-commands';
import { SlotPosition, ZoneType } from '@game/shared/types/enums';
import type { BattleActionCommandPayload } from './battleActionIntent';

type CommandResult = { readonly success?: boolean; readonly pending?: boolean } | void;

export interface BattleActionExecutionHandlers {
  readonly playMemberToSlot?: (cardId: string, targetSlot: SlotPosition) => CommandResult;
  readonly moveMemberToSlot?: (
    cardId: string,
    sourceSlot: SlotPosition,
    targetSlot: SlotPosition
  ) => CommandResult;
  readonly attachEnergyToMember?: (
    cardId: string,
    fromZone: ZoneType.MEMBER_SLOT | ZoneType.ENERGY_ZONE | ZoneType.ENERGY_DECK,
    targetSlot: SlotPosition,
    sourceSlot?: SlotPosition
  ) => CommandResult;
  readonly setLiveCard?: (cardId: string, faceDown: boolean) => CommandResult;
  readonly movePublicCardToHand?: (
    cardId: string,
    fromZone:
      | ZoneType.MEMBER_SLOT
      | ZoneType.LIVE_ZONE
      | ZoneType.SUCCESS_ZONE
      | ZoneType.WAITING_ROOM,
    sourceSlot?: SlotPosition
  ) => CommandResult;
  readonly movePublicCardToWaitingRoom?: (
    cardId: string,
    fromZone: ZoneType.MEMBER_SLOT | ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE,
    sourceSlot?: SlotPosition
  ) => CommandResult;
  readonly movePublicCardToEnergyDeck?: (
    cardId: string,
    fromZone: ZoneType.ENERGY_ZONE
  ) => CommandResult;
  readonly moveInspectedCardToZone?: (
    cardId: string,
    toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.EXILE_ZONE
  ) => CommandResult;
  readonly moveInspectedCardToTop?: (cardId: string) => CommandResult;
  readonly moveInspectedCardToBottom?: (cardId: string) => CommandResult;
  readonly moveResolutionCardToZone?: (
    cardId: string,
    toZone: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.MAIN_DECK | ZoneType.EXILE_ZONE,
    options?: { readonly position?: 'TOP' | 'BOTTOM' }
  ) => CommandResult;
  readonly confirmEffectStep?: (
    effectId: string,
    selectedCardId?: string | null,
    selectedSlot?: SlotPosition | null
  ) => CommandResult;
}

export function executeBattleActionPayload(
  payload: BattleActionCommandPayload,
  handlers: BattleActionExecutionHandlers
): boolean {
  switch (payload.type) {
    case GameCommandType.PLAY_MEMBER_TO_SLOT:
      if (!handlers.playMemberToSlot) return false;
      handlers.playMemberToSlot(payload.cardId, payload.targetSlot);
      return true;
    case GameCommandType.MOVE_MEMBER_TO_SLOT:
      if (!handlers.moveMemberToSlot) return false;
      handlers.moveMemberToSlot(payload.cardId, payload.sourceSlot, payload.targetSlot);
      return true;
    case GameCommandType.ATTACH_ENERGY_TO_MEMBER:
      if (!handlers.attachEnergyToMember) return false;
      handlers.attachEnergyToMember(
        payload.cardId,
        payload.fromZone,
        payload.targetSlot,
        payload.sourceSlot
      );
      return true;
    case GameCommandType.SET_LIVE_CARD:
      if (!handlers.setLiveCard) return false;
      handlers.setLiveCard(payload.cardId, payload.faceDown);
      return true;
    case GameCommandType.MOVE_PUBLIC_CARD_TO_HAND:
      if (!handlers.movePublicCardToHand) return false;
      handlers.movePublicCardToHand(payload.cardId, payload.fromZone, payload.sourceSlot);
      return true;
    case GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM:
      if (!handlers.movePublicCardToWaitingRoom) return false;
      handlers.movePublicCardToWaitingRoom(payload.cardId, payload.fromZone, payload.sourceSlot);
      return true;
    case GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK:
      if (!handlers.movePublicCardToEnergyDeck) return false;
      handlers.movePublicCardToEnergyDeck(payload.cardId, payload.fromZone);
      return true;
    case GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE:
      if (!handlers.moveInspectedCardToZone) return false;
      handlers.moveInspectedCardToZone(payload.cardId, payload.toZone);
      return true;
    case GameCommandType.MOVE_INSPECTED_CARD_TO_TOP:
      if (!handlers.moveInspectedCardToTop) return false;
      handlers.moveInspectedCardToTop(payload.cardId);
      return true;
    case GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM:
      if (!handlers.moveInspectedCardToBottom) return false;
      handlers.moveInspectedCardToBottom(payload.cardId);
      return true;
    case GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE:
      if (!handlers.moveResolutionCardToZone) return false;
      handlers.moveResolutionCardToZone(payload.cardId, payload.toZone, {
        position: payload.position,
      });
      return true;
    case GameCommandType.CONFIRM_EFFECT_STEP:
      if (!handlers.confirmEffectStep) return false;
      handlers.confirmEffectStep(payload.effectId, payload.selectedCardId, payload.selectedSlot);
      return true;
    default:
      return false;
  }
}
