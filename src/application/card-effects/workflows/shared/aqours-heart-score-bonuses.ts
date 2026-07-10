import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier, collectLiveModifiers, getMemberEffectiveHeartIcons } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
  PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface AqoursHeartScoreBonusConfig {
  readonly abilityId: string;
  readonly triggerCondition: TriggerCondition.ON_LIVE_START | TriggerCondition.ON_LIVE_SUCCESS;
  readonly heartColor: HeartColor;
  readonly heartToken: string;
  readonly threshold: number;
  readonly scoreBonus: number;
  readonly requiresOpponentNoSurplusSuccessfulLiveThisTurn?: boolean;
}

interface AqoursHeartScoreBonusContext {
  readonly sourceInLiveZone: boolean;
  readonly aqoursMemberCardIds: readonly string[];
  readonly heartTotal: number;
  readonly heartThresholdMet: boolean;
  readonly opponentNoSurplusSuccessfulLiveThisTurn: boolean | null;
  readonly scoreBonus: number;
}

const AQOURS = 'Aqours';
const CONFIGS: readonly AqoursHeartScoreBonusConfig[] = [
  {
    abilityId: PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    heartColor: HeartColor.GREEN,
    heartToken: '[緑ハート]',
    threshold: 10,
    scoreBonus: 2,
  },
  {
    abilityId:
      PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    heartColor: HeartColor.BLUE,
    heartToken: '[青ハート]',
    threshold: 4,
    scoreBonus: 2,
    requiresOpponentNoSurplusSuccessfulLiveThisTurn: true,
  },
];

export function registerAqoursHeartScoreBonusesWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveAqoursHeartScoreBonus(
          game,
          ability,
          config,
          options.orderedResolution === true,
          context.continuePendingCardEffects
        ),
      (game, ability) => {
        const effectText = getConfirmationEffectText(game, ability, config);
        return { effectText, stepText: effectText };
      }
    );
  }
}

function getConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState,
  config: AqoursHeartScoreBonusConfig
): string {
  return `${getAbilityEffectText(ability.abilityId)}${formatDynamicText(
    getAqoursHeartScoreBonusContext(game, ability, config),
    config
  )}`;
}

function resolveAqoursHeartScoreBonus(
  game: GameState,
  ability: PendingAbilityState,
  config: AqoursHeartScoreBonusConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const context = getAqoursHeartScoreBonusContext(game, ability, config);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (context.scoreBonus > 0) {
    state = addScoreModifierAndRefresh(
      state,
      ability.controllerId,
      ability.sourceCardId,
      ability.abilityId,
      context.scoreBonus
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        context.scoreBonus > 0
          ? 'AQOURS_HEART_SCORE_BONUS'
          : context.sourceInLiveZone
            ? 'CONDITION_NOT_MET'
            : 'SOURCE_NOT_IN_LIVE_ZONE',
      sourceInLiveZone: context.sourceInLiveZone,
      aqoursMemberCardIds: context.aqoursMemberCardIds,
      aqoursMemberCount: context.aqoursMemberCardIds.length,
      heartColor: config.heartColor,
      heartTotal: context.heartTotal,
      heartThreshold: config.threshold,
      heartThresholdMet: context.heartThresholdMet,
      opponentNoSurplusSuccessfulLiveThisTurn:
        context.opponentNoSurplusSuccessfulLiveThisTurn,
      scoreBonus: context.scoreBonus,
    }),
    orderedResolution
  );
}

function getAqoursHeartScoreBonusContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>,
  config: AqoursHeartScoreBonusConfig
): AqoursHeartScoreBonusContext {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const opponentNoSurplusSuccessfulLiveThisTurn =
    config.requiresOpponentNoSurplusSuccessfulLiveThisTurn === true
      ? hasOpponentNoSurplusSuccessfulLiveThisTurn(game, ability.controllerId)
      : null;

  if (!player || !sourceInLiveZone) {
    return {
      sourceInLiveZone,
      aqoursMemberCardIds: [],
      heartTotal: 0,
      heartThresholdMet: false,
      opponentNoSurplusSuccessfulLiveThisTurn,
      scoreBonus: 0,
    };
  }

  const liveModifiers = collectLiveModifiers(game);
  const aqoursMemberCardIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    and(typeIs(CardType.MEMBER), groupAliasIs(AQOURS))
  );
  const heartTotal = aqoursMemberCardIds.reduce((total, memberCardId) => {
    const matchingHearts = getMemberEffectiveHeartIcons(
      game,
      player.id,
      memberCardId,
      liveModifiers
    ).filter((heart) => heart.color === config.heartColor);
    return total + matchingHearts.reduce((heartTotal, heart) => heartTotal + heart.count, 0);
  }, 0);
  const heartThresholdMet = heartTotal >= config.threshold;
  const extraConditionMet =
    opponentNoSurplusSuccessfulLiveThisTurn === null || opponentNoSurplusSuccessfulLiveThisTurn;
  const scoreBonus = heartThresholdMet && extraConditionMet ? config.scoreBonus : 0;

  return {
    sourceInLiveZone,
    aqoursMemberCardIds,
    heartTotal,
    heartThresholdMet,
    opponentNoSurplusSuccessfulLiveThisTurn,
    scoreBonus,
  };
}

function hasOpponentNoSurplusSuccessfulLiveThisTurn(game: GameState, playerId: string): boolean {
  const opponent = getOpponent(game, playerId);
  if (!opponent) {
    return false;
  }
  const successfulOpponentLiveCardIds = [...game.liveResolution.liveResults.entries()]
    .filter(([liveCardId, succeeded]) => {
      if (succeeded !== true) {
        return false;
      }
      const card = getCardById(game, liveCardId);
      return card?.ownerId === opponent.id;
    })
    .map(([liveCardId]) => liveCardId);
  if (successfulOpponentLiveCardIds.length === 0) {
    return false;
  }

  return getRemainingHeartTotalCount(game, opponent.id) === 0;
}

function formatDynamicText(
  context: AqoursHeartScoreBonusContext,
  config: AqoursHeartScoreBonusConfig
): string {
  const sourceText = context.sourceInLiveZone ? '' : '来源LIVE不在LIVE区，';
  const opponentText =
    context.opponentNoSurplusSuccessfulLiveThisTurn === null
      ? ''
      : `对方当前无余Heart且本回合有成功LIVE：${
          context.opponentNoSurplusSuccessfulLiveThisTurn ? '是' : '否'
        }，`;
  return `（${sourceText}Aqours成员 ${context.aqoursMemberCardIds.length}名，${config.heartToken}合计${context.heartTotal}个，${opponentText}${
    context.scoreBonus > 0 ? `此LIVE分数+${context.scoreBonus}` : '实际不加分'
  }。）`;
}

function addScoreModifierAndRefresh(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string,
  scoreBonus: number
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId,
    countDelta: scoreBonus,
    sourceCardId,
    abilityId,
    liveCardId: sourceCardId,
  };
  const stateAfterModifier = addLiveModifier(game, modifier);
  const playerScores = new Map(stateAfterModifier.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...stateAfterModifier,
    liveResolution: {
      ...stateAfterModifier.liveResolution,
      playerScores,
    },
  };
}
