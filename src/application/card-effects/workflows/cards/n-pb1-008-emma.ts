import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsByOrientation } from '../../../effects/stage-targets.js';

export const EMMA_SELECT_TARGET_TYPE_STEP_ID = 'EMMA_SELECT_ACTIVATE_TARGET_TYPE';
export const EMMA_SELECT_MEMBER_STEP_ID = 'EMMA_SELECT_MEMBER_TO_ACTIVATE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerEmmaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
    (game, ability, options) =>
      startEmmaOnEnterActivateMemberOrEnergy(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
    EMMA_SELECT_TARGET_TYPE_STEP_ID,
    (game, input, context) =>
      startEmmaTargetSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
    EMMA_SELECT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishEmmaActivateMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startEmmaOnEnterActivateMemberOrEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingMemberCardIds = getStageMemberCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const selectableOptions = [
    ...(waitingMemberCardIds.length > 0 ? [{ id: 'member', label: '选择1名成员' }] : []),
    ...(waitingEnergyCardIds.length > 0 ? [{ id: 'energy', label: '将能量变活跃' }] : []),
  ];

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID),
      stepId: EMMA_SELECT_TARGET_TYPE_STEP_ID,
      stepText:
        selectableOptions.length > 0
          ? '请选择要变为活跃状态的目标类型。'
          : '当前没有待机状态的舞台成员或能量。确认后继续。',
      awaitingPlayerId: player.id,
      selectableOptions,
      canSkipSelection: selectableOptions.length === 0,
      skipSelectionLabel: selectableOptions.length === 0 ? '确认' : undefined,
      metadata: {
        orderedResolution,
        waitingMemberCardIds,
        waitingEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TARGET_TYPE',
      waitingMemberCardIds,
      waitingEnergyCardIds,
    },
  });
}

function startEmmaTargetSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingMemberCardIds = getStageMemberCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );

  if (selectedOptionId === 'member' && waitingMemberCardIds.length > 0) {
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: EMMA_SELECT_MEMBER_STEP_ID,
          stepText: '请选择1名要变为活跃状态的舞台成员。',
          selectableCardIds: waitingMemberCardIds,
          selectableCardMode: 'SINGLE',
          minSelectableCards: undefined,
          maxSelectableCards: undefined,
          selectableOptions: undefined,
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          selectionLabel: '选择要变为活跃的成员',
          confirmSelectionLabel: '变为活跃',
          metadata: {
            ...effect.metadata,
            waitingMemberCardIds,
            waitingEnergyCardIds,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_MEMBER_TARGET',
        waitingMemberCardIds,
      }
    );
  }

  if (selectedOptionId === 'energy' && waitingEnergyCardIds.length > 0) {
    return finishEmmaActivateEnergy(game, continuePendingCardEffects);
  }

  if (waitingMemberCardIds.length > 0 || waitingEnergyCardIds.length > 0) {
    return game;
  }

  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_NO_TARGETS',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishEmmaActivateMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || selectedCardId === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getStageMemberCardIdsByOrientation(game, player.id, OrientationState.WAITING).includes(
      selectedCardId
    )
  ) {
    return game;
  }

  const orientationChange = setMembersOrientation(
    game,
    player.id,
    [selectedCardId],
    OrientationState.ACTIVE
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
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
            step: 'ACTIVATE_MEMBER',
            activatedMemberCardIds: result.updatedMemberCardIds,
            previousOrientations: result.previousOrientations,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishEmmaActivateEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(2, waitingEnergyCount);
  const orientationChange = activateWaitingEnergyCardsForPlayer(
    game,
    player.id,
    activationCount
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_ENERGY',
      activatedEnergyCardIds: orientationChange.activatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    effect.metadata?.orderedResolution === true
  );
}
