import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addPlayerScoreLiveModifierForTargetMember } from '../../../../domain/rules/live-modifiers.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  countSuccessfulLiveCards,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import {
  PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID,
  SP_SD1_004_ON_ENTER_GAIN_LIVE_TOTAL_SCORE_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type LiveTotalScoreConditionKind = 'SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE' | 'ALWAYS';

interface OnEnterGainLiveTotalScoreConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly countDelta: number;
  readonly conditionKind: LiveTotalScoreConditionKind;
  readonly actionStep: string;
  readonly noOpStep: string;
}

const ON_ENTER_GAIN_LIVE_TOTAL_SCORE_CONFIGS: readonly OnEnterGainLiveTotalScoreConfig[] = [
  {
    abilityId: PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-bp4-007'],
    countDelta: 1,
    conditionKind: 'SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE',
    actionStep: 'GAIN_TARGET_BOUND_PLAYER_SCORE',
    noOpStep: 'SUCCESS_LIVE_CONDITION_NOT_MET',
  },
  {
    abilityId: SP_SD1_004_ON_ENTER_GAIN_LIVE_TOTAL_SCORE_ONE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!SP-sd1-004'],
    countDelta: 1,
    conditionKind: 'ALWAYS',
    actionStep: 'GAIN_TARGET_BOUND_PLAYER_SCORE',
    noOpStep: 'SOURCE_NOT_VALID_ON_STAGE',
  },
];

export function registerOnEnterGainLiveTotalScoreWorkflowHandlers(): void {
  for (const config of ON_ENTER_GAIN_LIVE_TOTAL_SCORE_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOnEnterGainLiveTotalScore(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnEnterGainLiveTotalScore(
  game: GameState,
  ability: PendingAbilityState,
  config: OnEnterGainLiveTotalScoreConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const source = getCardById(game, ability.sourceCardId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  const sourceIsValid =
    player !== null &&
    source !== null &&
    source.ownerId === player.id &&
    isMemberCardData(source.data) &&
    config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(source.data.cardCode, baseCardCode)
    ) &&
    sourceSlot !== null;

  if (!player || !sourceIsValid) {
    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      {
        step: 'SOURCE_NOT_VALID_ON_STAGE',
        sourceSlot,
        conditionMet: false,
        modifierApplied: false,
        resultText: '来源成员不在自己的舞台，本能力没有效果。',
      },
      continuePendingCardEffects
    );
  }

  const successfulLiveCardCount =
    config.conditionKind === 'SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE'
      ? countSuccessfulLiveCards(game, player.id)
      : undefined;
  const successfulLiveScore =
    config.conditionKind === 'SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE'
      ? sumSuccessfulLiveScore(game, player.id)
      : undefined;
  const conditionMet =
    config.conditionKind === 'ALWAYS' ||
    ((successfulLiveCardCount ?? 0) >= 1 && (successfulLiveScore ?? 0) <= 1);
  const conditionPayload =
    config.conditionKind === 'SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE'
      ? { successfulLiveCardCount, successfulLiveScore }
      : {};
  if (!conditionMet) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: config.noOpStep,
        sourceSlot,
        ...conditionPayload,
        conditionMet: false,
        modifierApplied: false,
        resultText: `成功LIVE卡区有${successfulLiveCardCount}张卡片，有效分数合计为${successfulLiveScore}，条件未满足。`,
      },
      continuePendingCardEffects
    );
  }

  const existingModifier = game.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.playerId === player.id &&
      modifier.sourceCardId === source.instanceId &&
      modifier.targetMemberCardId === source.instanceId &&
      modifier.abilityId === ability.abilityId
  );
  if (existingModifier) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: config.actionStep,
        sourceSlot,
        ...conditionPayload,
        conditionMet: true,
        modifierApplied: false,
        modifierAlreadyPresent: true,
        countDelta: config.countDelta,
        targetMemberCardId: source.instanceId,
      },
      continuePendingCardEffects
    );
  }

  const modifierResult = addPlayerScoreLiveModifierForTargetMember(game, {
    playerId: player.id,
    targetMemberCardId: source.instanceId,
    sourceCardId: source.instanceId,
    abilityId: ability.abilityId,
    countDelta: config.countDelta,
  });
  if (!modifierResult) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'SOURCE_NOT_VALID_FOR_SCORE_MODIFIER',
        sourceSlot,
        ...conditionPayload,
        conditionMet: true,
        modifierApplied: false,
        resultText: '来源成员无法获得能力，本能力没有效果。',
      },
      continuePendingCardEffects
    );
  }

  return finishPendingAbility(
    modifierResult.gameState,
    ability,
    player.id,
    orderedResolution,
    {
      step: config.actionStep,
      sourceSlot,
      ...conditionPayload,
      conditionMet: true,
      modifierApplied: true,
      countDelta: config.countDelta,
      targetMemberCardId: source.instanceId,
      resultText:
        config.conditionKind === 'ALWAYS'
          ? `此成员获得LIVE合计分数+${config.countDelta}。`
          : `成功LIVE卡区有${successfulLiveCardCount}张卡片，有效分数合计为${successfulLiveScore}，此成员获得LIVE合计分数+${config.countDelta}。`,
    },
    continuePendingCardEffects
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
