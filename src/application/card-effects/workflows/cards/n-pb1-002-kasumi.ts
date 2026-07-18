import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { stackEnergyFromEnergyZoneBelowMember } from '../../../effects/energy-below.js';
import { PL_N_PB1_002_ON_ENTER_STACK_TWO_ENERGY_BELOW_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'PL_N_PB1_002_STACK_TWO_ENERGY_BELOW';
const STACK_OPTION_ID = 'stack-two-energy';
const REQUIRED_ENERGY_COUNT = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPb1002KasumiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_PB1_002_ON_ENTER_STACK_TWO_ENERGY_BELOW_ABILITY_ID,
    (game, ability, options, context) =>
      startKasumiStackTwoEnergyBelow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_PB1_002_ON_ENTER_STACK_TWO_ENERGY_BELOW_ABILITY_ID,
    STEP_ID,
    (game, input, context) => {
      if (input.selectedOptionId === STACK_OPTION_ID) {
        return finishKasumiStackTwoEnergyBelow(game, context.continuePendingCardEffects);
      }
      if (input.selectedOptionId !== undefined && input.selectedOptionId !== null) {
        return game;
      }
      return finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
        step: 'DECLINE_STACK_TWO_ENERGY_BELOW',
      });
    }
  );
}

function startKasumiStackTwoEnergyBelow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const sourceSlot = getValidSourceSlot(game, ability.controllerId, ability.sourceCardId);
  const player = getPlayerById(game, ability.controllerId);
  if (!player || sourceSlot === null || player.energyZone.cardIds.length < REQUIRED_ENERGY_COUNT) {
    return consumePendingWithoutStacking(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      sourceSlot === null ? 'SOURCE_NOT_ON_STAGE' : 'INSUFFICIENT_ENERGY'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: STEP_ID,
      stepText: '可以将2张存在于自己的能量区的能量放置于此成员下方。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: STACK_OPTION_ID, label: '将2张能量放置于此成员下方' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_STACK_TWO_ENERGY_BELOW_OPTION',
    },
  });
}

function finishKasumiStackTwoEnergyBelow(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_PB1_002_ON_ENTER_STACK_TWO_ENERGY_BELOW_ABILITY_ID ||
    effect.stepId !== STEP_ID
  ) {
    return game;
  }

  const sourceSlot = getValidSourceSlot(game, effect.controllerId, effect.sourceCardId);
  const player = getPlayerById(game, effect.controllerId);
  if (!player || sourceSlot === null || player.energyZone.cardIds.length < REQUIRED_ENERGY_COUNT) {
    return finishInvalidStacking(
      game,
      continuePendingCardEffects,
      sourceSlot === null ? 'SOURCE_NOT_ON_STAGE' : 'INSUFFICIENT_ENERGY'
    );
  }

  const stacked = stackEnergyFromEnergyZoneBelowMember(
    game,
    player.id,
    sourceSlot,
    REQUIRED_ENERGY_COUNT
  );
  if (!stacked) {
    return finishInvalidStacking(game, continuePendingCardEffects, 'STACK_FAILED');
  }

  return continuePendingCardEffects(
    addAction({ ...stacked.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot,
      step: 'STACK_TWO_ENERGY_BELOW',
      stackedEnergyCardIds: stacked.stackedEnergyCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getValidSourceSlot(game: GameState, playerId: string, sourceCardId: string) {
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-pb1-002')
  ) {
    return null;
  }
  return getSourceMemberSlot(game, playerId, sourceCardId);
}

function finishInvalidStacking(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const effect = game.activeEffect!;
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      stackedEnergyCardIds: [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingWithoutStacking(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      stackedEnergyCardIds: [],
    }),
    orderedResolution
  );
}
