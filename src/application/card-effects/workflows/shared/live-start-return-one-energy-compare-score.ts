import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
  SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnergyReturn } from '../../runtime/energy-return.js';
import {
  createOptionalEnergyReturnWindow,
  resolveOptionalEnergyReturn,
} from '../../runtime/optional-energy-return.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const RETURN_ONE_ENERGY_STEP_ID = 'LIVE_START_RETURN_ONE_ENERGY_COMPARE_SCORE';

type EnergyScoreComparison =
  | {
      readonly kind: 'OPPONENT_AHEAD_TIERED';
      readonly oneAheadBonus: number;
      readonly twoOrMoreAheadBonus: number;
    }
  | {
      readonly kind: 'CONTROLLER_AHEAD';
      readonly bonus: number;
    };

interface LiveStartReturnOneEnergyCompareScoreConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly stageGate?: {
    readonly groupAlias: string;
    readonly minCount: number;
  };
  readonly comparison: EnergyScoreComparison;
}

const CONFIGS: readonly LiveStartReturnOneEnergyCompareScoreConfig[] = [
  {
    abilityId: S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
    baseCardCode: 'PL!S-bp7-023',
    stageGate: { groupAlias: 'Aqours', minCount: 2 },
    comparison: {
      kind: 'OPPONENT_AHEAD_TIERED',
      oneAheadBonus: 1,
      twoOrMoreAheadBonus: 2,
    },
  },
  {
    abilityId: SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
    baseCardCode: 'PL!SP-bp7-027',
    comparison: { kind: 'CONTROLLER_AHEAD', bonus: 1 },
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLiveStartReturnOneEnergyCompareScoreWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnergyReturn;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startWorkflow(game, ability, config, options, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      RETURN_ONE_ENERGY_STEP_ID,
      (game, input, context) =>
        finishEnergyReturn(
          game,
          input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
          input.selectedOptionId ?? null,
          config,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }
}

function startWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveStartReturnOneEnergyCompareScoreConfig,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const orderedResolution = options.orderedResolution === true;
  if (
    !player ||
    !isValidSource(game, ability.controllerId, ability.sourceCardId, config.baseCardCode)
  ) {
    return finishWorkflow(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_VALID_SOURCE',
      scoreBonus: 0,
    });
  }
  const stageGate = getStageGateSnapshot(game, player.id, config);
  if (!stageGate.passed || player.energyZone.cardIds.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      ...(stageGate.required
        ? {
            effectText: `${getAbilityEffectText(ability.abilityId)}
（当前自己舞台『${stageGate.groupAlias}』成员${stageGate.actualCount}名，${
              stageGate.passed ? '满足条件；当前没有可以放回的能量，无法发动' : '未满足条件'
            }，实际[スコア]+0。）`,
          }
        : {
            effectText: `${getAbilityEffectText(ability.abilityId)}
（当前没有可以放回的能量，无法发动，实际[スコア]+0。）`,
          }),
      stepText: '确认后结算此效果。',
    });
    if (confirmation) {
      return confirmation;
    }
  }
  if (!stageGate.passed || player.energyZone.cardIds.length === 0) {
    return finishWorkflow(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_VALID_SOURCE_GATE_OR_ENERGY',
      scoreBonus: 0,
    });
  }

  const energyReturnWindow = createOptionalEnergyReturnWindow(game, {
    ability,
    requiredCount: 1,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: RETURN_ONE_ENERGY_STEP_ID,
    stepText: '可以将1张能量放回能量卡组并发动此效果。',
    orderedResolution,
  });
  return (
    energyReturnWindow ??
    finishWorkflow(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_VALID_ENERGY_RETURN_SELECTION',
      scoreBonus: 0,
    })
  );
}

function finishEnergyReturn(
  game: GameState,
  selectedCardIds: readonly string[],
  selectedOptionId: string | null,
  config: LiveStartReturnOneEnergyCompareScoreConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnergyReturn
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId) {
    return game;
  }
  const ability = activeEffectToPendingAbility(effect);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (
    !isValidSource(game, effect.controllerId, effect.sourceCardId, config.baseCardCode) ||
    !passesStageGate(game, effect.controllerId, config)
  ) {
    return finishWorkflow(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_OR_GATE_INVALID_BEFORE_RETURN',
      scoreBonus: 0,
    });
  }

  const energyReturn = resolveOptionalEnergyReturn(game, {
    selectedCardIds,
    selectedOptionId,
    enqueueTriggeredCardEffects,
  });
  if (!energyReturn) {
    return game;
  }
  if (energyReturn.declined) {
    return finishWorkflow(
      energyReturn.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'DECLINED', scoreBonus: 0 }
    );
  }
  if (
    energyReturn.movedEnergyCardIds.length !== 1 ||
    !isValidSource(
      energyReturn.gameState,
      effect.controllerId,
      effect.sourceCardId,
      config.baseCardCode
    )
  ) {
    return finishWorkflow(
      energyReturn.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'INVALID_RETURN_RESULT_OR_SOURCE',
        movedEnergyCardIds: energyReturn.movedEnergyCardIds,
        scoreBonus: 0,
      }
    );
  }

  const player = getPlayerById(energyReturn.gameState, effect.controllerId);
  const opponent = player ? getOpponent(energyReturn.gameState, player.id) : null;
  if (!player || !opponent) {
    return finishWorkflow(
      energyReturn.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OPPONENT_AFTER_RETURN',
        movedEnergyCardIds: energyReturn.movedEnergyCardIds,
        scoreBonus: 0,
      }
    );
  }

  const ownEnergyCount = player.energyZone.cardIds.length;
  const opponentEnergyCount = opponent.energyZone.cardIds.length;
  const scoreBonus = getScoreBonus(config.comparison, ownEnergyCount, opponentEnergyCount);
  const stateWithScore = replaceSourceScoreModifier(
    energyReturn.gameState,
    player.id,
    effect.sourceCardId,
    effect.abilityId,
    scoreBonus
  );
  return finishWorkflow(stateWithScore, ability, orderedResolution, continuePendingCardEffects, {
    step: 'RETURNED_AND_COMPARED_ENERGY',
    movedEnergyCardIds: energyReturn.movedEnergyCardIds,
    ownEnergyCount,
    opponentEnergyCount,
    scoreBonus,
  });
}

function passesStageGate(
  game: GameState,
  playerId: string,
  config: LiveStartReturnOneEnergyCompareScoreConfig
): boolean {
  if (!config.stageGate) {
    return true;
  }
  return (
    getStageMemberCardIdsMatching(game, playerId, groupAliasIs(config.stageGate.groupAlias))
      .length >= config.stageGate.minCount
  );
}

function getStageGateSnapshot(
  game: GameState,
  playerId: string,
  config: LiveStartReturnOneEnergyCompareScoreConfig
): {
  readonly required: boolean;
  readonly groupAlias: string;
  readonly actualCount: number;
  readonly passed: boolean;
} {
  if (!config.stageGate) {
    return { required: false, groupAlias: '', actualCount: 0, passed: true };
  }
  const actualCount = getStageMemberCardIdsMatching(
    game,
    playerId,
    groupAliasIs(config.stageGate.groupAlias)
  ).length;
  return {
    required: true,
    groupAlias: config.stageGate.groupAlias,
    actualCount,
    passed: actualCount >= config.stageGate.minCount,
  };
}

function getScoreBonus(
  comparison: EnergyScoreComparison,
  ownEnergyCount: number,
  opponentEnergyCount: number
): number {
  if (comparison.kind === 'CONTROLLER_AHEAD') {
    return ownEnergyCount > opponentEnergyCount ? comparison.bonus : 0;
  }
  const difference = opponentEnergyCount - ownEnergyCount;
  if (difference >= 2) {
    return comparison.twoOrMoreAheadBonus;
  }
  return difference === 1 ? comparison.oneAheadBonus : 0;
}

function replaceSourceScoreModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string,
  scoreBonus: number
): GameState {
  const previousBonus = game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.playerId === playerId &&
        modifier.liveCardId === sourceCardId &&
        modifier.sourceCardId === sourceCardId &&
        modifier.abilityId === abilityId
    )
    .reduce((sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId,
          countDelta: scoreBonus,
          liveCardId: sourceCardId,
          sourceCardId,
          abilityId,
        }
      : null;
  const stateWithModifier = replaceLiveModifier(
    game,
    { kind: 'SCORE', playerId, liveCardId: sourceCardId, sourceCardId, abilityId },
    replacement
  );
  const playerScores = new Map(stateWithModifier.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus - previousBonus);
  return {
    ...stateWithModifier,
    liveResolution: {
      ...stateWithModifier.liveResolution,
      playerScores,
    },
  };
}

function isValidSource(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  baseCardCode: string
): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, baseCardCode) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function activeEffectToPendingAbility(
  effect: NonNullable<GameState['activeEffect']>
): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: '',
    eventIds: [],
  };
}

function finishWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    activeEffect: null,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
