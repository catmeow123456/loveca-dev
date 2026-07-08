import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import { returnSelectedEnergyBelowMemberToEnergyDeck } from '../../../effects/energy-below.js';
import { PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_MEMBER_STEP_ID = 'PL_N_BP3_025_SELECT_ENERGY_BELOW_MEMBER';
const SELECT_ENERGY_STEP_ID = 'PL_N_BP3_025_SELECT_ENERGY_BELOW_CARDS';
const RED_HEARTS_PER_ENERGY = 3;
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3025AwakeningPromiseWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startReturnEnergyBelowGainRedHeart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID,
    SELECT_MEMBER_STEP_ID,
    (game, input, context) =>
      continueToSelectEnergyBelow(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID,
    SELECT_ENERGY_STEP_ID,
    (game, input, context) =>
      finishReturnEnergyBelowGainRedHeart(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startReturnEnergyBelowGainRedHeart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const targetMemberCardIds = getOwnStageMemberIdsWithEnergyBelow(game, player.id);
  if (targetMemberCardIds.length === 0) {
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_ENERGY_BELOW_TARGET'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_MEMBER_STEP_ID,
      stepText: '可以选择自己舞台上1名下方有能量卡的成员。',
      awaitingPlayerId: player.id,
      selectableCardIds: targetMemberCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择下方有能量的成员',
      confirmSelectionLabel: '选择成员',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_ENERGY_BELOW_MEMBER',
      selectableCardIds: targetMemberCardIds,
    },
  });
}

function continueToSelectEnergyBelow(
  game: GameState,
  selectedMemberCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game, SELECT_MEMBER_STEP_ID);
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedMemberCardId === null) {
    return consumeActiveEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'DECLINE_RETURN_ENERGY_BELOW'
    );
  }
  if (effect.selectableCardIds?.includes(selectedMemberCardId) !== true) {
    return game;
  }

  const targetSlot = findStageSlotForMember(game, player.id, selectedMemberCardId);
  if (targetSlot === null) {
    return consumeActiveEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'TARGET_MEMBER_NOT_ON_STAGE'
    );
  }
  const selectableEnergyCardIds = player.memberSlots.energyBelow[targetSlot] ?? [];
  if (selectableEnergyCardIds.length === 0) {
    return consumeActiveEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'TARGET_MEMBER_HAS_NO_ENERGY_BELOW'
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_ENERGY_STEP_ID,
        stepText: '请选择该成员下方要放回能量卡组的能量卡。',
        selectableCardIds: selectableEnergyCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 1,
        maxSelectableCards: selectableEnergyCardIds.length,
        selectionLabel: '选择要放回能量卡组的能量',
        confirmSelectionLabel: '放回能量卡组',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          targetMemberCardId: selectedMemberCardId,
          targetSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_ENERGY_BELOW_CARDS',
      targetMemberCardId: selectedMemberCardId,
      targetSlot,
      selectableCardIds: selectableEnergyCardIds,
    }
  );
}

function finishReturnEnergyBelowGainRedHeart(
  game: GameState,
  selectedEnergyCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game, SELECT_ENERGY_STEP_ID);
  if (!effect || selectedEnergyCardIds.length === 0) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetMemberCardId = getStringMetadata(effect, 'targetMemberCardId');
  const targetSlot = getSlotPositionMetadata(effect, 'targetSlot');
  if (!player || !targetMemberCardId || targetSlot === null) {
    return game;
  }
  if (findStageSlotForMember(game, player.id, targetMemberCardId) !== targetSlot) {
    return consumeActiveEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'TARGET_MEMBER_NOT_ON_STAGE'
    );
  }

  const returnResult = returnSelectedEnergyBelowMemberToEnergyDeck(
    game,
    player.id,
    targetSlot,
    selectedEnergyCardIds
  );
  if (!returnResult) {
    return game;
  }
  const heartCount = returnResult.returnedEnergyCardIds.length * RED_HEARTS_PER_ENERGY;
  const heartResult = addHeartLiveModifierForMember(returnResult.gameState, {
    playerId: player.id,
    memberCardId: targetMemberCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: HeartColor.RED, count: heartCount }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RETURN_ENERGY_BELOW_GAIN_RED_HEART',
      targetMemberCardId,
      targetSlot,
      returnedEnergyCardIds: returnResult.returnedEnergyCardIds,
      redHeartCount: heartCount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getOwnStageMemberIdsWithEnergyBelow(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const memberCardId = player.memberSlots.slots[slot];
    return memberCardId && (player.memberSlots.energyBelow[slot] ?? []).length > 0
      ? [memberCardId]
      : [];
  });
}

function findStageSlotForMember(
  game: GameState,
  playerId: string,
  memberCardId: string
): SlotPosition | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }
  return (
    MEMBER_SLOT_ORDER.find((slot) => player.memberSlots.slots[slot] === memberCardId) ?? null
  );
}

function getActiveEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP3_025_LIVE_START_RETURN_ENERGY_BELOW_GAIN_RED_HEART_ABILITY_ID ||
    effect.stepId !== stepId
  ) {
    return null;
  }
  return effect;
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
      }
    ),
    orderedResolution
  );
}

function consumeActiveEffectNoMove(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      movedCardIds: [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStringMetadata(
  effect: ActiveEffectState,
  key: string
): string | null {
  const value = effect.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function getSlotPositionMetadata(
  effect: ActiveEffectState,
  key: string
): SlotPosition | null {
  const value = effect.metadata?.[key];
  return Object.values(SlotPosition).includes(value as SlotPosition)
    ? (value as SlotPosition)
    : null;
}
