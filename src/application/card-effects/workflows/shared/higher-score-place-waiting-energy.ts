import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import {
  HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface HigherScorePlaceWaitingEnergyConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCode: string;
  readonly requiredStageGroupAlias?: '蓮ノ空';
  readonly requiredStageGroupDisplayName?: '莲之空';
  readonly actionStep: string;
}

const CONFIGS: readonly HigherScorePlaceWaitingEnergyConfig[] = [
  {
    abilityId: HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
    expectedBaseCardCode: 'PL!HS-bp1-023',
    requiredStageGroupAlias: '蓮ノ空',
    requiredStageGroupDisplayName: '莲之空',
    actionStep: 'PLACE_WAITING_ENERGY_IF_HIGHER_SCORE_HASUNOSORA_MEMBER',
  },
  {
    abilityId: SP_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
    expectedBaseCardCode: 'PL!SP-bp1-023',
    actionStep: 'PLACE_WAITING_ENERGY_IF_HIGHER_SCORE',
  },
];

export function registerHigherScorePlaceWaitingEnergyWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getConfirmationEffectText(game, ability, config),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveHigherScorePlaceWaitingEnergy(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    });
  }
}

function getConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState,
  config: HigherScorePlaceWaitingEnergyConfig
): string {
  const facts = readResolutionFacts(game, ability, config);
  const groupText = config.requiredStageGroupDisplayName
    ? `，舞台${facts.stageGroupConditionMet ? '有' : '无'}${config.requiredStageGroupDisplayName}成员`
    : '';
  const conditionText =
    facts.scoreConditionMet && facts.stageGroupConditionMet ? '满足条件' : '未满足条件';
  const energyText = facts.hasEnergyDeckCard ? '能量卡组有牌' : '能量卡组无牌';
  const resultText =
    facts.conditionMet && facts.hasEnergyDeckCard ? '实际放置1张待机能量' : '实际不放置能量';
  return `${getAbilityEffectText(ability.abilityId)}（自己分数 ${facts.ownScore}，对方分数 ${facts.opponentScore}${groupText}，${conditionText}，${energyText}，${resultText}。）`;
}

function resolveHigherScorePlaceWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  config: HigherScorePlaceWaitingEnergyConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return continuePendingCardEffects(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      orderedResolution
    );
  }

  const facts = readResolutionFacts(game, ability, config);
  const energyPlacement = facts.conditionMet
    ? placeEnergyFromDeckToZoneByCardEffect(game, player.id, 1, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      })
    : null;
  const stateAfterPlacement = energyPlacement?.gameState ?? game;
  const state = {
    ...stateAfterPlacement,
    pendingAbilities: stateAfterPlacement.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      ownScore: facts.ownScore,
      opponentScore: facts.opponentScore,
      sourceValid: facts.sourceValid,
      scoreConditionMet: facts.scoreConditionMet,
      stageGroupConditionMet: facts.stageGroupConditionMet,
      hasHasunosoraStageMember: config.requiredStageGroupAlias
        ? facts.stageGroupConditionMet
        : undefined,
      conditionMet: facts.conditionMet,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}

function readResolutionFacts(
  game: GameState,
  ability: PendingAbilityState,
  config: HigherScorePlaceWaitingEnergyConfig
): {
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly sourceValid: boolean;
  readonly scoreConditionMet: boolean;
  readonly stageGroupConditionMet: boolean;
  readonly conditionMet: boolean;
  readonly hasEnergyDeckCard: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId);
  const source = getCardById(game, ability.sourceCardId);
  const ownScore = player ? (game.liveResolution.playerScores.get(player.id) ?? 0) : 0;
  const opponentScore = opponent ? (game.liveResolution.playerScores.get(opponent.id) ?? 0) : 0;
  const sourceValid = Boolean(
    player &&
    source &&
    source.ownerId === player.id &&
    isLiveCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, config.expectedBaseCardCode) &&
    player.liveZone.cardIds.includes(source.instanceId)
  );
  const scoreConditionMet = ownScore > opponentScore;
  const stageGroupConditionMet = config.requiredStageGroupAlias
    ? Boolean(
        player &&
        hasStageMemberMatching(game, player.id, groupAliasIs(config.requiredStageGroupAlias))
      )
    : true;
  return {
    ownScore,
    opponentScore,
    sourceValid,
    scoreConditionMet,
    stageGroupConditionMet,
    conditionMet: sourceValid && scoreConditionMet && stageGroupConditionMet,
    hasEnergyDeckCard: (player?.energyDeck.cardIds.length ?? 0) > 0,
  };
}
