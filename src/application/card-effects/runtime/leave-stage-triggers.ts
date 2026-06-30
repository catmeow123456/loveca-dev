import type { GameState } from '../../../domain/entities/game.js';
import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  updatePlayer,
} from '../../../domain/entities/game.js';
import type {
  EnterWaitingRoomEvent,
  LeaveStageEvent,
} from '../../../domain/events/game-events.js';
import {
  createEnterWaitingRoomEvent,
  createLeaveStageEvent,
} from '../../../domain/events/game-events.js';
import {
  addCardToZone,
  addCardsToZone,
  popMemberBelowMember,
  removeCardFromSlot,
} from '../../../domain/entities/zone.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import {
  payImmediateEffectCosts,
  type EffectCostDefinition,
  type EffectCostPaymentResult,
} from '../../effects/effect-costs.js';
import { returnEnergyBelowMemberToEnergyDeckForPlayer } from '../../effects/energy-below.js';
import { getNewLeaveStageEvents } from './events.js';

type EnergyCostBeforeSourceMemberToWaitingRoom = Extract<
  EffectCostDefinition,
  { readonly kind: 'TAP_ACTIVE_ENERGY' }
>;

export type EnqueueTriggeredCardEffectsForLeaveStage = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

export interface PaySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggersOptions {
  readonly additionalCostsBeforeSourceMemberToWaitingRoom?: readonly EnergyCostBeforeSourceMemberToWaitingRoom[];
}

export interface PaySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggersResult
  extends EffectCostPaymentResult {
  readonly leaveStageEvents: readonly LeaveStageEvent[];
}

export interface SendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggersResult {
  readonly gameState: GameState;
  readonly movedToWaitingRoomCardIds: readonly string[];
  readonly sourceSlot: NonNullable<ReturnType<typeof findMemberSlot>>;
  readonly enterWaitingRoomEvent: EnterWaitingRoomEvent;
  readonly leaveStageEvents: readonly LeaveStageEvent[];
}

export function paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForLeaveStage,
  options: PaySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggersOptions = {}
): PaySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggersResult | null {
  const costPayment = payImmediateEffectCosts(game, playerId, sourceCardId, [
    ...(options.additionalCostsBeforeSourceMemberToWaitingRoom ?? []),
    { kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM' },
  ]);
  if (!costPayment) {
    return null;
  }

  const leaveStageEvents = getNewLeaveStageEvents(game, costPayment.gameState);
  const gameState =
    leaveStageEvents.length > 0
      ? enqueueTriggeredCardEffects(costPayment.gameState, [TriggerCondition.ON_LEAVE_STAGE], {
          leaveStageEvents,
        })
      : costPayment.gameState;

  return {
    ...costPayment,
    gameState,
    leaveStageEvents,
  };
}

export function sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
  game: GameState,
  playerId: string,
  memberCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForLeaveStage
): SendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggersResult | null {
  const player = getPlayerById(game, playerId);
  const memberCard = getCardById(game, memberCardId);
  const sourceSlot = player ? findMemberSlot(player, memberCardId) : null;
  if (!player || !memberCard || sourceSlot === null) {
    return null;
  }

  let movedToWaitingRoomCardIds: readonly string[] = [memberCardId];
  let state = updatePlayer(game, player.id, (currentPlayer) => {
    const energyReturnResult = returnEnergyBelowMemberToEnergyDeckForPlayer(
      currentPlayer,
      sourceSlot
    );
    const playerWithReturnedEnergy = energyReturnResult.playerState;
    const [slotsWithoutMemberBelow, memberBelowCardIds] = popMemberBelowMember(
      playerWithReturnedEnergy.memberSlots,
      sourceSlot
    );
    movedToWaitingRoomCardIds = [memberCardId, ...memberBelowCardIds];
    return {
      ...playerWithReturnedEnergy,
      memberSlots: removeCardFromSlot(slotsWithoutMemberBelow, sourceSlot),
      waitingRoom: addCardsToZone(
        addCardToZone(playerWithReturnedEnergy.waitingRoom, memberCardId),
        memberBelowCardIds
      ),
    };
  });

  state = emitGameEvent(
    state,
    createLeaveStageEvent(
      memberCardId,
      sourceSlot,
      ZoneType.WAITING_ROOM,
      memberCard.ownerId,
      player.id
    )
  );
  const enterWaitingRoomEvent = createEnterWaitingRoomEvent(
    movedToWaitingRoomCardIds,
    ZoneType.MEMBER_SLOT,
    memberCard.ownerId,
    player.id
  );
  state = emitGameEvent(state, enterWaitingRoomEvent);

  const leaveStageEvents = getNewLeaveStageEvents(game, state);
  const gameState =
    leaveStageEvents.length > 0
      ? enqueueTriggeredCardEffects(
          state,
          [TriggerCondition.ON_LEAVE_STAGE, TriggerCondition.ON_ENTER_WAITING_ROOM],
          {
            enterWaitingRoomEvents: [enterWaitingRoomEvent],
            leaveStageEvents,
          }
        )
      : state;

  return {
    gameState,
    movedToWaitingRoomCardIds,
    sourceSlot,
    enterWaitingRoomEvent,
    leaveStageEvents,
  };
}
