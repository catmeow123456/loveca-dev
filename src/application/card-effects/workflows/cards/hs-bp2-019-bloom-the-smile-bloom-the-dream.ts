import {
  isLiveCardData,
  type HeartRequirement,
  type LiveCardInstance,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type LiveRequirementModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  getLiveCardRequirementModifiers,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { applyHeartRequirementModifiers } from '../../../../domain/rules/live-requirement-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_REQUIREMENT_PATTERN_STEP_ID = 'HS_BP2_019_SELECT_REQUIREMENT_PATTERN';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface RequirementPattern {
  readonly id: string;
  readonly color: HeartColor;
  readonly label: string;
}

const REQUIREMENT_PATTERNS: readonly RequirementPattern[] = [
  { id: 'pink', color: HeartColor.PINK, label: '[桃ハート][桃ハート][無ハート]' },
  { id: 'green', color: HeartColor.GREEN, label: '[緑ハート][緑ハート][無ハート]' },
  { id: 'blue', color: HeartColor.BLUE, label: '[青ハート][青ハート][無ハート]' },
];

const ORDINARY_HEART_COLORS: readonly HeartColor[] = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
];

export function registerHsBp2019BloomTheSmileBloomTheDreamWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID,
    (game, ability, options, context) =>
      startRequirementPatternChoice(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID,
    SELECT_REQUIREMENT_PATTERN_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId
        ? finishRequirementPatternChoice(
            game,
            input.selectedOptionId,
            context.continuePendingCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startRequirementPatternChoice(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const context = getRequirementPatternContext(game, ability.controllerId, ability.sourceCardId);
  if (!context.conditionMet) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      context
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_REQUIREMENT_PATTERN_STEP_ID,
      stepText: '可以选择此LIVE成功所需的必要Heart组合。',
      awaitingPlayerId: ability.controllerId,
      effectChoice: {
        mode: 'SINGLE',
        options: REQUIREMENT_PATTERNS.map((pattern) => ({
          id: pattern.id,
          text: `此LIVE成功所需的必要Heart变为${pattern.label}。`,
        })),
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择必要Heart组合',
      confirmSelectionLabel: '变更必要Heart',
      canSkipSelection: true,
      skipSelectionLabel: '不改变必要Heart',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_REQUIREMENT_PATTERN',
      hasunosoraMemberCardIds: context.hasunosoraMemberCardIds,
      hasunosoraMemberCount: context.hasunosoraMemberCardIds.length,
    },
  });
}

function finishRequirementPatternChoice(
  game: GameState,
  selectedOptionId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getRequirementPatternEffect(game);
  const pattern = REQUIREMENT_PATTERNS.find((candidate) => candidate.id === selectedOptionId);
  if (!effect || !pattern) {
    return game;
  }

  const context = getRequirementPatternContext(game, effect.controllerId, effect.sourceCardId);
  if (!context.conditionMet || !context.sourceLive) {
    return finishActiveEffectNoOp(game, effect, context, continuePendingCardEffects);
  }

  const requirementModifiers = createRequirementPatternModifiers(
    context.sourceLive.data.requirements,
    pattern.color
  );
  const stateAfterModifier = replaceLiveModifier(
    { ...game, activeEffect: null },
    {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      modifiers: requirementModifiers,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  const adjustedRequirement = applyHeartRequirementModifiers(
    context.sourceLive.data.requirements,
    getLiveCardRequirementModifiers(stateAfterModifier.liveResolution, effect.sourceCardId)
  );

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_CHOSEN_REQUIREMENT_PATTERN',
      chosenPattern: pattern.id,
      chosenColor: pattern.color,
      requirementModifiers,
      adjustedTotalRequired: adjustedRequirement.totalRequired,
      adjustedColorRequirements: Object.fromEntries(adjustedRequirement.colorRequirements),
      hasunosoraMemberCardIds: context.hasunosoraMemberCardIds,
      hasunosoraMemberCount: context.hasunosoraMemberCardIds.length,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getRequirementPatternContext(
  game: GameState,
  playerId: string,
  sourceCardId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly sourceLive: LiveCardInstance | null;
  readonly hasunosoraMemberCardIds: readonly string[];
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  const sourceLive =
    sourceCard && isLiveCardData(sourceCard.data) ? (sourceCard as LiveCardInstance) : null;
  const sourceInLiveZone = player?.liveZone.cardIds.includes(sourceCardId) === true;
  const hasunosoraMemberCardIds = getStageMemberCardIdsMatching(
    game,
    playerId,
    groupAliasIs('蓮ノ空')
  );
  return {
    sourceInLiveZone,
    sourceLive,
    hasunosoraMemberCardIds,
    conditionMet: sourceInLiveZone && sourceLive !== null && hasunosoraMemberCardIds.length > 0,
  };
}

function createRequirementPatternModifiers(
  printedRequirement: HeartRequirement,
  selectedColor: HeartColor
): readonly LiveRequirementModifierState[] {
  const modifiers = ORDINARY_HEART_COLORS.flatMap((color): LiveRequirementModifierState[] => {
    const current = printedRequirement.colorRequirements.get(color) ?? 0;
    const desired = color === selectedColor ? 2 : 0;
    return desired === current ? [] : [{ color, countDelta: desired - current }];
  });
  const currentGeneric = getGenericRequirementCount(printedRequirement);
  return currentGeneric === 1
    ? modifiers
    : [...modifiers, { color: HeartColor.RAINBOW, countDelta: 1 - currentGeneric }];
}

function getGenericRequirementCount(requirement: HeartRequirement): number {
  const explicitGeneric = requirement.colorRequirements.get(HeartColor.RAINBOW) ?? 0;
  const specificTotal = [...requirement.colorRequirements.entries()]
    .filter(([color]) => color !== HeartColor.RAINBOW)
    .reduce((sum, [, count]) => sum + count, 0);
  return Math.max(explicitGeneric, requirement.totalRequired - specificTotal, 0);
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  context: ReturnType<typeof getRequirementPatternContext>
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
      step: 'REQUIREMENT_PATTERN_CONDITION_NOT_MET',
      sourceInLiveZone: context.sourceInLiveZone,
      hasunosoraMemberCardIds: context.hasunosoraMemberCardIds,
      hasunosoraMemberCount: context.hasunosoraMemberCardIds.length,
    }),
    orderedResolution
  );
}

function finishActiveEffectNoOp(
  game: GameState,
  effect: ActiveEffectState,
  context: ReturnType<typeof getRequirementPatternContext>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REQUIREMENT_PATTERN_CONDITION_LOST',
      sourceInLiveZone: context.sourceInLiveZone,
      hasunosoraMemberCardIds: context.hasunosoraMemberCardIds,
      hasunosoraMemberCount: context.hasunosoraMemberCardIds.length,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getRequirementPatternEffect(game: GameState): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID &&
    effect.stepId === SELECT_REQUIREMENT_PATTERN_STEP_ID
    ? effect
    : null;
}
