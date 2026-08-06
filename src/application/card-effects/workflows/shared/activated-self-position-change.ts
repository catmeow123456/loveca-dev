import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface MandatoryActivatedSelfPositionChangeConfig {
  readonly abilityId: string;
  readonly baseCardCodes: readonly string[];
  readonly stepId: string;
}

export function createMandatoryActivatedSelfPositionChangeActiveEffect(config: {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly sourceSlot: SlotPosition;
  readonly metadata?: ActiveEffectState['metadata'];
}): ActiveEffectState {
  return {
    id: config.id,
    abilityId: config.abilityId,
    sourceCardId: config.sourceCardId,
    controllerId: config.controllerId,
    effectText: config.effectText,
    stepId: config.stepId,
    stepText: '请选择此成员要移动到的成员区。',
    awaitingPlayerId: config.controllerId,
    selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== config.sourceSlot),
    canSkipSelection: false,
    selectionLabel: '选择移动区域',
    confirmSelectionLabel: '站位变换',
    metadata: {
      ...config.metadata,
      sourceSlot: config.sourceSlot,
    },
  };
}

export function finishMandatoryActivatedSelfPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  config: MandatoryActivatedSelfPositionChangeConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.stepId ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const sourceStillEligible = isDirectOrRenGrantedActivatedAbilitySource(
    game,
    player.id,
    effect.sourceCardId,
    effect.abilityId,
    config.baseCardCodes
  );
  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceStillEligible || sourceSlot === null || sourceSlot === selectedSlot) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'POSITION_CHANGE_SOURCE_STALE_AFTER_COST',
        selectedSlot,
        paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
        returnedEnergyCardIds: effect.metadata?.returnedEnergyCardIds ?? [],
      }),
      false
    );
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    effect.sourceCardId,
    selectedSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'POSITION_CHANGE',
            fromSlot: result.fromSlot,
            toSlot: result.toSlot,
            swappedCardId: result.swappedCardId,
            paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
            returnedEnergyCardIds: effect.metadata?.returnedEnergyCardIds ?? [],
          }
        ),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(moveResult.gameState, false);
}
