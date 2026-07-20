import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const CHOOSE_BRANCH_STEP_ID = 'PL_S_BP5_004_CHOOSE_BRANCH';
const SELECT_AQOURS_BLADE_TARGET_STEP_ID = 'PL_S_BP5_004_SELECT_AQOURS_BLADE_TARGET';
const SELECT_SAINTSNOW_POSITION_TARGET_STEP_ID =
  'PL_S_BP5_004_SELECT_SAINTSNOW_POSITION_TARGET';
const SELECT_SAINTSNOW_POSITION_SLOT_STEP_ID = 'PL_S_BP5_004_SELECT_SAINTSNOW_POSITION_SLOT';

const AQOURS_BLADE_OPTION_ID = 'aqours-blade';
const SAINTSNOW_POSITION_CHANGE_OPTION_ID = 'saintsnow-position-change';

const aqoursMember = groupAliasIs('Aqours');
const saintSnowMember = groupAliasIs('SaintSnow');

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5004DiaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options, context) =>
      startDiaChooseBranch(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
    CHOOSE_BRANCH_STEP_ID,
    (game, input, context) =>
      finishDiaChooseBranch(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
    SELECT_AQOURS_BLADE_TARGET_STEP_ID,
    (game, input, context) =>
      finishDiaAqoursBladeTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
    SELECT_SAINTSNOW_POSITION_TARGET_STEP_ID,
    (game, input, context) =>
      startDiaSaintSnowSlotSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
    SELECT_SAINTSNOW_POSITION_SLOT_STEP_ID,
    (game, input, context) =>
      finishDiaSaintSnowPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startDiaChooseBranch(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const branchOptions = getLegalBranchOptions(game, player.id, ability.sourceCardId);
  if (branchOptions.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_LEGAL_BRANCH',
        aqoursTargetCardIds: [],
        saintSnowTargetCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  const aqoursTargetCardIds = getLegalAqoursBladeTargetIds(game, player.id, ability.sourceCardId);
  const saintSnowTargetCardIds = getLegalSaintSnowPositionTargetIds(
    game,
    player.id,
    ability.sourceCardId
  );

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_BRANCH_STEP_ID,
      stepText: '请选择要处理的效果分支。',
      awaitingPlayerId: player.id,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: AQOURS_BLADE_OPTION_ID,
            text: '自己舞台上此成员以外的1名『Aqours』成员，LIVE结束时为止，获得[BLADE]。',
            selectable: branchOptions.some((option) => option.id === AQOURS_BLADE_OPTION_ID),
          },
          {
            id: SAINTSNOW_POSITION_CHANGE_OPTION_ID,
            text: '将自己舞台上1名『SaintSnow』成员进行站位变换。',
            selectable: branchOptions.some(
              (option) => option.id === SAINTSNOW_POSITION_CHANGE_OPTION_ID
            ),
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择效果分支',
      confirmSelectionLabel: '选择',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot: findMemberSlot(player, ability.sourceCardId),
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_BRANCH',
      aqoursTargetCardIds,
      saintSnowTargetCardIds,
      selectableOptionIds: branchOptions.map((option) => option.id),
    },
  });
}

function finishDiaChooseBranch(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getDiaActiveEffect(game, CHOOSE_BRANCH_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || selectedOptionId === null) {
    return game;
  }

  const currentBranchOptions = getLegalBranchOptions(game, player.id, effect.sourceCardId);
  if (!currentBranchOptions.some((option) => option.id === selectedOptionId)) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'SELECTED_BRANCH_NO_LONGER_LEGAL',
      selectedOptionId,
    });
  }

  if (selectedOptionId === AQOURS_BLADE_OPTION_ID) {
    const selectableCardIds = getLegalAqoursBladeTargetIds(game, player.id, effect.sourceCardId);
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: SELECT_AQOURS_BLADE_TARGET_STEP_ID,
          stepText: '请选择自己舞台上此成员以外的1名『Aqours』成员获得[BLADE]。',
          effectChoice: undefined,
          selectableCardIds,
          selectableCardVisibility: 'PUBLIC',
          selectableOptions: undefined,
          selectionLabel: '选择获得[BLADE]的Aqours成员',
          confirmSelectionLabel: '获得[BLADE]',
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          metadata: {
            ...effect.metadata,
            selectedBranch: selectedOptionId,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_AQOURS_BLADE_BRANCH',
        selectableCardIds,
      }
    );
  }

  if (selectedOptionId === SAINTSNOW_POSITION_CHANGE_OPTION_ID) {
    const selectableCardIds = getLegalSaintSnowPositionTargetIds(
      game,
      player.id,
      effect.sourceCardId
    );
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: SELECT_SAINTSNOW_POSITION_TARGET_STEP_ID,
          stepText: '请选择自己舞台上1名『SaintSnow』成员进行站位变换。',
          effectChoice: undefined,
          selectableCardIds,
          selectableCardVisibility: 'PUBLIC',
          selectableOptions: undefined,
          selectionLabel: '选择SaintSnow成员',
          confirmSelectionLabel: '选择',
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          metadata: {
            ...effect.metadata,
            selectedBranch: selectedOptionId,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_SAINTSNOW_POSITION_BRANCH',
        selectableCardIds,
      }
    );
  }

  return game;
}

function finishDiaAqoursBladeTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getDiaActiveEffect(game, SELECT_AQOURS_BLADE_TARGET_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || selectedCardId === null) {
    return game;
  }

  const currentTargetIds = getLegalAqoursBladeTargetIds(game, player.id, effect.sourceCardId);
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentTargetIds.includes(selectedCardId)
  ) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'AQOURS_BLADE_TARGET_UNAVAILABLE',
      targetMemberCardId: selectedCardId,
    });
  }

  const bladeResult = addBladeLiveModifierForSourceMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      sourceCardId: selectedCardId,
      abilityId: effect.abilityId,
      amount: 1,
    }
  );
  if (!bladeResult) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'AQOURS_BLADE_TARGET_UNAVAILABLE',
      targetMemberCardId: selectedCardId,
    });
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'GRANT_AQOURS_TARGET_BLADE',
      targetMemberCardId: selectedCardId,
      bladeModifierSourceCardId: selectedCardId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startDiaSaintSnowSlotSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getDiaActiveEffect(game, SELECT_SAINTSNOW_POSITION_TARGET_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || selectedCardId === null) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  const currentTargetIds = getLegalSaintSnowPositionTargetIds(game, player.id, effect.sourceCardId);
  const targetSlot = findMemberSlot(player, selectedCardId);
  if (
    sourceSlot === null ||
    targetSlot === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentTargetIds.includes(selectedCardId)
  ) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'SAINTSNOW_POSITION_TARGET_UNAVAILABLE',
      targetMemberCardId: selectedCardId,
    });
  }

  const selectableSlots = getOtherSlots(targetSlot);
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_SAINTSNOW_POSITION_SLOT_STEP_ID,
        stepText: '请选择此SaintSnow成员要移动到的其他成员区。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableSlots,
        selectionLabel: '选择移动区域',
        confirmSelectionLabel: '站位变换',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          targetMemberCardId: selectedCardId,
          targetFromSlot: targetSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_SAINTSNOW_POSITION_TARGET',
      targetMemberCardId: selectedCardId,
      fromSlot: targetSlot,
      selectableSlots,
    }
  );
}

function finishDiaSaintSnowPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = getDiaActiveEffect(game, SELECT_SAINTSNOW_POSITION_SLOT_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const targetMemberCardId =
    typeof effect?.metadata?.targetMemberCardId === 'string'
      ? effect.metadata.targetMemberCardId
      : null;
  if (!effect || !player || !targetMemberCardId || selectedSlot === null) {
    return game;
  }

  const targetSlot = findMemberSlot(player, targetMemberCardId);
  const currentTargetIds = getLegalSaintSnowPositionTargetIds(game, player.id, effect.sourceCardId);
  if (
    targetSlot === null ||
    targetSlot === selectedSlot ||
    effect.selectableSlots?.includes(selectedSlot) !== true ||
    !currentTargetIds.includes(targetMemberCardId)
  ) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'SAINTSNOW_POSITION_TARGET_UNAVAILABLE',
      targetMemberCardId,
      selectedSlot,
    });
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    targetMemberCardId,
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
            step: 'POSITION_CHANGE_SAINTSNOW_MEMBER',
            targetMemberCardId,
            fromSlot: result.fromSlot,
            toSlot: result.toSlot,
            swappedCardId: result.swappedCardId,
          }
        ),
    }
  );
  if (!moveResult) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'SAINTSNOW_POSITION_TARGET_UNAVAILABLE',
      targetMemberCardId,
      selectedSlot,
    });
  }

  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
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
        ...payload,
      }
    ),
    orderedResolution
  );
}

function finishActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function getLegalBranchOptions(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly { readonly id: string; readonly label: string }[] {
  const options: { readonly id: string; readonly label: string }[] = [];
  if (getLegalAqoursBladeTargetIds(game, playerId, sourceCardId).length > 0) {
    options.push({ id: AQOURS_BLADE_OPTION_ID, label: 'Aqours成员获得[BLADE]' });
  }
  if (getLegalSaintSnowPositionTargetIds(game, playerId, sourceCardId).length > 0) {
    options.push({ id: SAINTSNOW_POSITION_CHANGE_OPTION_ID, label: 'SaintSnow成员站位变换' });
  }
  return options;
}

function getLegalAqoursBladeTargetIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player || findMemberSlot(player, sourceCardId) === null) {
    return [];
  }

  return getStageMemberCardIdsMatching(game, playerId, aqoursMember).filter(
    (cardId) => cardId !== sourceCardId
  );
}

function getLegalSaintSnowPositionTargetIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player || findMemberSlot(player, sourceCardId) === null) {
    return [];
  }

  return getStageMemberCardIdsMatching(game, playerId, saintSnowMember).filter((cardId) => {
    const targetSlot = findMemberSlot(player, cardId);
    return targetSlot !== null && getOtherSlots(targetSlot).length > 0;
  });
}

function getOtherSlots(slot: SlotPosition): readonly SlotPosition[] {
  return (Object.values(SlotPosition) as SlotPosition[]).filter((candidate) => candidate !== slot);
}

function getDiaActiveEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== stepId
  ) {
    return null;
  }
  return effect;
}
