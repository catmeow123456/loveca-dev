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
import {
  S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
  SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type LeadingPlayer = 'SELF' | 'OPPONENT';

interface EnergyDifferenceScoreConfig {
  readonly abilityId: string;
  readonly cardCodes?: readonly string[];
  readonly baseCardCodes?: readonly string[];
  readonly leadingPlayer: LeadingPlayer;
  readonly minDifference: number;
  readonly conditionMetStep: string;
  readonly conditionNotMetStep: string;
}

const SCORE_BONUS = 1;

const CONFIGS: readonly EnergyDifferenceScoreConfig[] = [
  {
    abilityId: S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
    cardCodes: ['PL!S-bp6-022-L'],
    leadingPlayer: 'OPPONENT',
    minDifference: 1,
    conditionMetStep: 'OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE',
    conditionNotMetStep: 'NO_OPPONENT_ENERGY_MORE',
  },
  {
    abilityId: SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp7-024'],
    leadingPlayer: 'SELF',
    minDifference: 2,
    conditionMetStep: 'OWN_ENERGY_TWO_MORE_THIS_LIVE_SCORE',
    conditionNotMetStep: 'OWN_ENERGY_LEAD_BELOW_TWO',
  },
];

export function registerLiveSuccessEnergyDifferenceScoreWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveLiveSuccessEnergyDifferenceScore(
          game,
          ability,
          config,
          options.orderedResolution === true,
          context.continuePendingCardEffects
        ),
      (game, ability) => ({
        effectText: getConfirmationEffectText(game, ability, config),
        stepText: '确认后结算此效果。',
      })
    );
  }
}

function getConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState,
  config: EnergyDifferenceScoreConfig
): string {
  const comparison = getEnergyComparison(game, ability.controllerId, config);
  return `${getAbilityEffectText(ability.abilityId)}（当前自己能量${
    comparison.ownEnergyCount
  }张，对方能量${
    comparison.opponentEnergyCount
  }张，${comparison.conditionMet ? '满足条件' : '未满足条件'}，实际[スコア]+${
    comparison.conditionMet ? SCORE_BONUS : 0
  }。）`;
}

function resolveLiveSuccessEnergyDifferenceScore(
  game: GameState,
  ability: PendingAbilityState,
  config: EnergyDifferenceScoreConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const comparison = getEnergyComparison(game, ability.controllerId, config);
  const sourceLiveValid =
    player !== null && isValidSourceLive(game, player.id, ability.sourceCardId, config);
  const scoreBonus = sourceLiveValid && comparison.conditionMet ? SCORE_BONUS : 0;
  const previousScoreBonus = getExistingScoreBonus(game, ability);
  const replacement: LiveModifierState | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: ability.controllerId,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null;

  let state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: ability.controllerId,
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    replacement
  );
  state = refreshPlayerScoreDraft(state, ability.controllerId, scoreBonus - previousScoreBonus);
  state = addAction(
    {
      ...state,
      pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: !sourceLiveValid
        ? 'SOURCE_LIVE_NOT_IN_OWN_LIVE_ZONE'
        : comparison.conditionMet
          ? config.conditionMetStep
          : config.conditionNotMetStep,
      ownEnergyCount: comparison.ownEnergyCount,
      opponentEnergyCount: comparison.opponentEnergyCount,
      leadingPlayer: config.leadingPlayer,
      minDifference: config.minDifference,
      energyDifference: comparison.energyDifference,
      conditionMet: sourceLiveValid && comparison.conditionMet,
      scoreBonus,
      scoreDelta: scoreBonus - previousScoreBonus,
    }
  );
  return continuePendingCardEffects(state, orderedResolution);
}

function getEnergyComparison(
  game: GameState,
  playerId: string,
  config: EnergyDifferenceScoreConfig
) {
  const player = getPlayerById(game, playerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const ownEnergyCount = player?.energyZone.cardIds.length ?? 0;
  const opponentEnergyCount = opponent?.energyZone.cardIds.length ?? 0;
  const energyDifference =
    config.leadingPlayer === 'SELF'
      ? ownEnergyCount - opponentEnergyCount
      : opponentEnergyCount - ownEnergyCount;
  return {
    ownEnergyCount,
    opponentEnergyCount,
    energyDifference,
    conditionMet: player !== null && opponent !== null && energyDifference >= config.minDifference,
  } as const;
}

function isValidSourceLive(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  config: EnergyDifferenceScoreConfig
): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (
    player === null ||
    source === null ||
    source.ownerId !== playerId ||
    !isLiveCardData(source.data) ||
    !player.liveZone.cardIds.includes(sourceCardId)
  ) {
    return false;
  }
  return (
    config.cardCodes?.includes(source.data.cardCode) === true ||
    config.baseCardCodes?.some((baseCardCode) =>
      cardCodeMatchesBase(source.data.cardCode, baseCardCode)
    ) === true
  );
}

function getExistingScoreBonus(game: GameState, ability: PendingAbilityState): number {
  return game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.playerId === ability.controllerId &&
        modifier.liveCardId === ability.sourceCardId &&
        modifier.sourceCardId === ability.sourceCardId &&
        modifier.abilityId === ability.abilityId
    )
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreDelta: number): GameState {
  if (scoreDelta === 0) {
    return game;
  }
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreDelta);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}
