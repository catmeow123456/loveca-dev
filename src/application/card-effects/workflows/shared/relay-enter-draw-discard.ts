import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardNameAliasIs } from '../../../effects/card-selectors.js';
import {
  PL_N_PB1_014_ON_ENTER_RELAY_FROM_KASUMI_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  PL_N_PB1_019_ON_ENTER_RELAY_FROM_SETSUNA_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  PL_N_PB1_020_ON_ENTER_RELAY_FROM_EMMA_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  PL_N_PB1_022_ON_ENTER_RELAY_FROM_SHIORIKO_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from './draw-then-discard.js';

const RELAY_ENTER_DRAW_DISCARD_STEP_ID = 'RELAY_ENTER_SELECT_DISCARD_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type RelayEnterDrawDiscardCondition =
  | {
      readonly kind: 'REPLACED_MEMBER_NAME';
      readonly requiredReplacedMemberName: string;
    }
  | {
      readonly kind: 'REPLACED_MEMBER_EFFECTIVE_COST';
      readonly requiredReplacedMemberEffectiveCost: number;
    };

interface RelayEnterDrawDiscardWorkflowConfig {
  readonly abilityId: string;
  readonly condition: RelayEnterDrawDiscardCondition;
  readonly drawCount: number;
  readonly discardCount: number;
}

const RELAY_ENTER_DRAW_DISCARD_WORKFLOWS: readonly RelayEnterDrawDiscardWorkflowConfig[] = [
  {
    abilityId: PL_N_PB1_014_ON_ENTER_RELAY_FROM_KASUMI_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    condition: {
      kind: 'REPLACED_MEMBER_NAME',
      requiredReplacedMemberName: '中須かすみ',
    },
    drawCount: 2,
    discardCount: 1,
  },
  {
    abilityId: PL_N_PB1_022_ON_ENTER_RELAY_FROM_SHIORIKO_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    condition: {
      kind: 'REPLACED_MEMBER_NAME',
      requiredReplacedMemberName: '三船栞子',
    },
    drawCount: 2,
    discardCount: 1,
  },
  {
    abilityId: PL_N_PB1_019_ON_ENTER_RELAY_FROM_SETSUNA_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    condition: {
      kind: 'REPLACED_MEMBER_NAME',
      requiredReplacedMemberName: '優木せつ菜',
    },
    drawCount: 2,
    discardCount: 2,
  },
  {
    abilityId: PL_N_PB1_020_ON_ENTER_RELAY_FROM_EMMA_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    condition: {
      kind: 'REPLACED_MEMBER_NAME',
      requiredReplacedMemberName: 'エマ・ヴェルデ',
    },
    drawCount: 2,
    discardCount: 2,
  },
  {
    abilityId: S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    condition: {
      kind: 'REPLACED_MEMBER_EFFECTIVE_COST',
      requiredReplacedMemberEffectiveCost: 7,
    },
    drawCount: 2,
    discardCount: 1,
  },
];

export function registerRelayEnterDrawDiscardWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of RELAY_ENTER_DRAW_DISCARD_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startRelayEnterDrawDiscardWorkflow(
        game,
        ability,
        config,
        options,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      RELAY_ENTER_DRAW_DISCARD_STEP_ID,
      (game, input, context) =>
        finishDrawThenDiscardCardsWorkflow(
          game,
          input.selectedCardId ?? null,
          input.selectedCardIds,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }
}

function startRelayEnterDrawDiscardWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: RelayEnterDrawDiscardWorkflowConfig,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const condition = getRelayReplacementCondition(game, ability, config.condition);
  if (!condition.conditionMet) {
    return finishWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        condition: config.condition,
        reason: condition.reason,
        relayReplacementCardIds: condition.relayReplacementCardIds,
        relayReplacementEffectiveCosts: condition.relayReplacementEffectiveCosts,
      }
    );
  }

  return startDrawThenDiscardCardsWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(config.abilityId),
    drawCount: config.drawCount,
    discardCount: config.discardCount,
    stepId: RELAY_ENTER_DRAW_DISCARD_STEP_ID,
    orderedResolution: options.orderedResolution === true,
  });
}

function finishWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: {
    readonly condition: RelayEnterDrawDiscardCondition;
    readonly reason: string;
    readonly relayReplacementCardIds: readonly string[];
    readonly relayReplacementEffectiveCosts: readonly (number | null)[];
  }
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
      step:
        payload.condition.kind === 'REPLACED_MEMBER_NAME'
          ? 'CHECK_RELAY_REPLACEMENT_NAME'
          : 'CHECK_RELAY_REPLACEMENT_EFFECTIVE_COST',
      sourceSlot: ability.sourceSlot,
      conditionMet: false,
      ...(payload.condition.kind === 'REPLACED_MEMBER_NAME'
        ? { requiredReplacedMemberName: payload.condition.requiredReplacedMemberName }
        : {
            requiredReplacedMemberEffectiveCost:
              payload.condition.requiredReplacedMemberEffectiveCost,
            relayReplacementEffectiveCosts: payload.relayReplacementEffectiveCosts,
          }),
      reason: payload.reason,
      relayReplacementCardIds: payload.relayReplacementCardIds,
    }),
    orderedResolution
  );
}

function getRelayReplacementCondition(
  game: GameState,
  ability: PendingAbilityState,
  condition: RelayEnterDrawDiscardCondition
):
  | {
      readonly conditionMet: true;
      readonly relayReplacementCardIds: readonly string[];
      readonly relayReplacementEffectiveCosts: readonly (number | null)[];
    }
  | {
      readonly conditionMet: false;
      readonly reason: string;
      readonly relayReplacementCardIds: readonly string[];
      readonly relayReplacementEffectiveCosts: readonly (number | null)[];
    } {
  const relayReplacements = getRelayReplacements(ability.metadata?.relayReplacements);
  const relayReplacementCardIds = relayReplacements.map((replacement) => replacement.cardId);
  const relayReplacementEffectiveCosts = relayReplacements.map(
    (replacement) => replacement.effectiveCost ?? null
  );
  if (relayReplacements.length === 0) {
    return {
      conditionMet: false,
      reason: 'NOT_RELAY_ENTER',
      relayReplacementCardIds,
      relayReplacementEffectiveCosts,
    };
  }

  if (condition.kind === 'REPLACED_MEMBER_EFFECTIVE_COST') {
    const replacementMatchesEffectiveCost = relayReplacements.some(
      (replacement) => replacement.effectiveCost === condition.requiredReplacedMemberEffectiveCost
    );
    if (!replacementMatchesEffectiveCost) {
      return {
        conditionMet: false,
        reason: 'REPLACEMENT_EFFECTIVE_COST_MISMATCH',
        relayReplacementCardIds,
        relayReplacementEffectiveCosts,
      };
    }
    return {
      conditionMet: true,
      relayReplacementCardIds,
      relayReplacementEffectiveCosts,
    };
  }

  const replacementMatchesName = relayReplacementCardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      cardNameAliasIs(condition.requiredReplacedMemberName)(card)
    );
  });
  if (!replacementMatchesName) {
    return {
      conditionMet: false,
      reason: 'REPLACEMENT_NAME_MISMATCH',
      relayReplacementCardIds,
      relayReplacementEffectiveCosts,
    };
  }

  return {
    conditionMet: true,
    relayReplacementCardIds,
    relayReplacementEffectiveCosts,
  };
}

interface RelayReplacementSnapshot {
  readonly cardId: string;
  readonly effectiveCost?: number;
}

function getRelayReplacements(value: unknown): readonly RelayReplacementSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): RelayReplacementSnapshot[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    if (typeof cardId !== 'string') {
      return [];
    }
    const effectiveCost = (entry as { readonly effectiveCost?: unknown }).effectiveCost;
    return typeof effectiveCost === 'number' && Number.isFinite(effectiveCost)
      ? [{ cardId, effectiveCost }]
      : [{ cardId }];
  });
}
