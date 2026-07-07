import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import {
  S_BP5_222_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
  S_BP5_222_AUTO_ON_THIS_MEMBER_MOVED_ACTIVATE_TWO_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForMemberSlotMoved } from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';
import { registerPayEnergyPositionChangeToGroupMemberAreaWorkflowHandlers } from '../shared/pay-energy-position-change-to-group-member-area.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const POSITION_CHANGE_STEP_ID = 'S_BP5_222_SELECT_AQOURS_OR_SAINTSNOW_MEMBER_SLOT';
const ACTIVATE_ENERGY_COUNT = 2;

export function registerSBp5222RiaWorkflowHandlers(deps: {
  readonly enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPayEnergyPositionChangeToGroupMemberAreaWorkflowHandlers(
    {
      abilityId:
        S_BP5_222_ACTIVATED_PAY_ENERGY_POSITION_CHANGE_TO_AQOURS_OR_SAINTSNOW_MEMBER_ABILITY_ID,
      baseCardCode: 'PL!S-bp5-222',
      stepId: POSITION_CHANGE_STEP_ID,
      targetGroupAliases: ['Aqours', 'SaintSnow'],
      stepText: '请选择有『Aqours』或『SaintSnow』成员的其他区域进行站位变换。',
      selectionLabel: '选择移动区域',
      confirmSelectionLabel: '站位变换',
    },
    { enqueueMemberSlotMovedCardEffects: deps.enqueueMemberSlotMovedCardEffects }
  );
  registerPendingAbilityStarterHandler(
    S_BP5_222_AUTO_ON_THIS_MEMBER_MOVED_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveRiaMovedActivateEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveRiaMovedActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const moveEvent = getPendingMoveEvent(game, ability);
  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const movedThisMember =
    moveEvent?.controllerId === player.id && moveEvent.cardInstanceId === ability.sourceCardId;
  if (!movedThisMember || sourceSlot === null) {
    return finishPendingAbility(
      game,
      player.id,
      ability,
      orderedResolution,
      {
        step: sourceSlot === null ? 'SOURCE_NOT_ON_STAGE' : 'CONDITION_NOT_MET',
        conditionMet: false,
        sourceOnStage: sourceSlot !== null,
        moveEventId: moveEvent?.eventId ?? null,
        movedCardId: moveEvent?.cardInstanceId ?? null,
        fromSlot: moveEvent?.fromSlot ?? null,
        toSlot: moveEvent?.toSlot ?? null,
      },
      continuePendingCardEffects
    );
  }

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const activationCount = Math.min(ACTIVATE_ENERGY_COUNT, waitingEnergyCardIds.length);
  const activationResult = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activationResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...activationResult.gameState,
    pendingAbilities: activationResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  const stateWithUseRecord = recordAbilityUseForContext(stateWithoutPending, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  return continuePendingCardEffects(
    addAction(stateWithUseRecord, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ACTIVATE_TWO_ENERGY_AFTER_THIS_MEMBER_MOVED',
      conditionMet: true,
      sourceOnStage: true,
      sourceSlot,
      moveEventId: moveEvent.eventId,
      movedCardId: moveEvent.cardInstanceId,
      fromSlot: moveEvent.fromSlot,
      toSlot: moveEvent.toSlot,
      requestedActivationCount: ACTIVATE_ENERGY_COUNT,
      waitingEnergyCardIds,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }),
    orderedResolution
  );
}

function finishPendingAbility(
  game: GameState,
  playerId: string,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    activeEffect: null,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateWithUseRecord = recordAbilityUseForContext(stateWithoutPending, playerId, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  return continuePendingCardEffects(
    addAction(
      stateWithUseRecord,
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getPendingMoveEvent(
  game: GameState,
  ability: PendingAbilityState
): MemberSlotMovedEvent | null {
  const eventIds = new Set(ability.eventIds);
  for (const entry of game.eventLog) {
    const event = entry.event;
    if (
      event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
      'fromSlot' in event &&
      'toSlot' in event &&
      'cardInstanceId' in event &&
      eventIds.has(event.eventId)
    ) {
      return event as MemberSlotMovedEvent;
    }
  }
  return null;
}
