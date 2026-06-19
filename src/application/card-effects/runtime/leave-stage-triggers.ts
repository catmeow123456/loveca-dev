import type { GameState } from '../../../domain/entities/game.js';
import type { LeaveStageEvent } from '../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../shared/types/enums.js';
import {
  payImmediateEffectCosts,
  type EffectCostDefinition,
  type EffectCostPaymentResult,
} from '../../effects/effect-costs.js';
import { getNewLeaveStageEvents } from './events.js';

type EnergyCostBeforeSourceMemberToWaitingRoom = Extract<
  EffectCostDefinition,
  { readonly kind: 'TAP_ACTIVE_ENERGY' }
>;

export type EnqueueTriggeredCardEffectsForLeaveStage = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
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
