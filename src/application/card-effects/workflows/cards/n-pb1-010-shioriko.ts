import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  createWaitingRoomLiveToDeckTopEffect,
  finishWaitingRoomLiveToDeckTopSelection,
  selectWaitingRoomLiveToDeckTopCandidates,
  type WaitingRoomLiveToDeckTopConfig,
} from '../shared/waiting-room-live-to-deck-top.js';

export const N_PB1_010_SELECT_OPTION_STEP_ID = 'N_PB1_010_SELECT_OPTION';
export const N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID =
  'N_PB1_010_SELECT_NIJIGASAKI_LIVE_TO_DECK_TOP';
export const N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID = 'activate-one-energy';
export const N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID = 'stack-nijigasaki-live-to-deck-top';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const liveToDeckTopConfig: WaitingRoomLiveToDeckTopConfig = {
  abilityId:
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID,
  groupAlias: '虹ヶ咲',
  maxCount: 2,
  stepId: N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID,
  stepText: '请从自己休息室中选择至多2张『虹咲』LIVE卡，按选择顺序放置于卡组顶。',
  skipStep: 'SKIP_STACK_NIJIGASAKI_LIVE',
  moveStep: 'STACK_NIJIGASAKI_LIVE_TO_DECK_TOP',
  actionPayload: { selectedOptionId: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID },
};

export function registerNPb1010ShiorikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID,
    (game, ability, options) =>
      startShiorikoOnEnterChoice(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID,
    N_PB1_010_SELECT_OPTION_STEP_ID,
    (game, input, context) =>
      resolveShiorikoOption(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID,
    N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomLiveToDeckTopSelection(
        game,
        input.selectedCardIds ?? [],
        liveToDeckTopConfig,
        context.continuePendingCardEffects
      )
  );
}

function startShiorikoOnEnterChoice(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: N_PB1_010_SELECT_OPTION_STEP_ID,
      stepText: '请选择要执行的效果。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        {
          id: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
          label: '将1张能量变为活跃状态',
        },
        {
          id: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
          label: '将至多2张虹咲LIVE卡放置于卡组顶',
        },
      ],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
            text: '将1张能量变为活跃状态。',
          },
          {
            id: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
            text: '从自己的休息室将至多2张『虹ヶ咲』LIVE卡按任意顺序放置于卡组顶。',
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_OPTION',
      optionIds: [
        N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
        N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
      ],
    },
  });
}

function resolveShiorikoOption(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getExpectedEffect(game, N_PB1_010_SELECT_OPTION_STEP_ID);
  if (!effect || !effect.selectableOptions?.some((option) => option.id === selectedOptionId)) {
    return game;
  }
  if (selectedOptionId === N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID) {
    return resolveActivateOneEnergy(game, effect, continuePendingCardEffects);
  }
  if (selectedOptionId !== N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID) return game;

  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const selectableCardIds = selectWaitingRoomLiveToDeckTopCandidates(
    game,
    player.id,
    liveToDeckTopConfig.groupAlias
  );
  if (selectableCardIds.length === 0) {
    return finishAndContinue(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'SKIP_STACK_NIJIGASAKI_LIVE',
      {
        selectedOptionId,
        candidateCardIds: [],
        selectedCardIds: [],
        movedCardIds: [],
      }
    );
  }

  const nextEffect = createWaitingRoomLiveToDeckTopEffect(
    effect,
    selectableCardIds,
    liveToDeckTopConfig
  );
  return addAction({ ...game, activeEffect: nextEffect }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'SELECT_NIJIGASAKI_LIVE_TO_DECK_TOP',
    selectedOptionId,
    candidateCardIds: selectableCardIds,
    maxSelectableCards: nextEffect.maxSelectableCards,
  });
}

function resolveActivateOneEnergy(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const candidateEnergyCardIds = getEnergySelectionCandidates(
    game,
    player.id,
    'ACTIVATE_WAITING_ENERGY'
  );
  const activation = activateWaitingEnergyCardsForPlayer(
    game,
    player.id,
    Math.min(1, candidateEnergyCardIds.length)
  );
  if (!activation) return game;

  const step =
    activation.activatedEnergyCardIds.length === 0
      ? 'NO_OP_NO_WAITING_ENERGY'
      : 'ACTIVATE_ONE_ENERGY';
  return finishAndContinue(
    activation.gameState,
    effect,
    player.id,
    continuePendingCardEffects,
    step,
    {
      selectedOptionId: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
      candidateEnergyCardIds,
      activatedEnergyCardIds: activation.activatedEnergyCardIds,
      previousOrientations: activation.previousOrientations,
      nextOrientation: activation.nextOrientation,
    }
  );
}

function getExpectedEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function finishAndContinue(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      orderedResolution: effect.metadata?.orderedResolution === true,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
