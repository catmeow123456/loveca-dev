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
import { PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

const BASE_CARD_CODE = 'PL!-bp4-007';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp4007NozomiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePlBp4007NozomiOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolvePlBp4007NozomiOnEnter(
  game: GameState,
  ability: PendingAbilityState,
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
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
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

  const successfulLiveCardCount = countSuccessfulLiveCards(game, player.id);
  const successfulLiveScore = sumSuccessfulLiveScore(game, player.id);
  const conditionMet = successfulLiveCardCount >= 1 && successfulLiveScore <= 1;
  if (!conditionMet) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'SUCCESS_LIVE_CONDITION_NOT_MET',
        sourceSlot,
        successfulLiveCardCount,
        successfulLiveScore,
        conditionMet: false,
        modifierApplied: false,
        resultText: `成功LIVE卡区有${successfulLiveCardCount}张卡片，有效分数合计为${successfulLiveScore}，条件未满足。`,
      },
      continuePendingCardEffects
    );
  }

  const modifierResult = addPlayerScoreLiveModifierForTargetMember(game, {
    playerId: player.id,
    targetMemberCardId: source.instanceId,
    sourceCardId: source.instanceId,
    abilityId: ability.abilityId,
    countDelta: 1,
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
        successfulLiveCardCount,
        successfulLiveScore,
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
      step: 'GAIN_TARGET_BOUND_PLAYER_SCORE',
      sourceSlot,
      successfulLiveCardCount,
      successfulLiveScore,
      conditionMet: true,
      modifierApplied: true,
      countDelta: 1,
      targetMemberCardId: source.instanceId,
      resultText: `成功LIVE卡区有${successfulLiveCardCount}张卡片，有效分数合计为${successfulLiveScore}，此成员获得LIVE合计分数+1。`,
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
