import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { selectDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { SP_PB1_023_LIVE_START_CATCHU_ACTIVATE_ENERGY_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];
const MAX_ENERGY_ACTIVATION_COUNT = 6;

export function registerSpPb1023DistortionWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_PB1_023_LIVE_START_CATCHU_ACTIVATE_ENERGY_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb1023DistortionLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSpPb1023ConfirmationConfig
  );
}

function getSpPb1023ConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getSpPb1023Context(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前不同名『CatChu!』成员${context.differentNamedCatchuMemberIds.length}名，${
      context.catchuConditionMet
        ? `满足能量活跃条件，当前待机能量${context.waitingEnergyCount}张，本次将活跃${context.activationCount}张`
        : `未满足能量活跃条件，当前待机能量${context.waitingEnergyCount}张，本次不活跃能量`
    }；结算后${context.waitingEnergyCountAfterActivation === 0 ? '没有待机能量' : `仍有${context.waitingEnergyCountAfterActivation}张待机能量`}，${
      context.willGainScore ? '实际[スコア]+1' : '实际不增加分数'
    }。）`,
  };
}

function resolveSpPb1023DistortionLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const beforeActivation = getSpPb1023Context(game, ability);
  const activationResult = activateWaitingEnergyCardsForPlayer(
    game,
    player.id,
    beforeActivation.activationCount
  );
  if (!activationResult) return game;

  const stateWithoutPending: GameState = {
    ...activationResult.gameState,
    pendingAbilities: activationResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  const waitingEnergyCountAfterActivation = getEnergyCardIdsByOrientation(
    stateWithoutPending,
    player.id,
    OrientationState.WAITING
  ).length;
  // 规则口径：“全部为 ACTIVE”按当前 WAITING 数为 0 判断，因此空能量区也满足。
  const allEnergyActive = waitingEnergyCountAfterActivation === 0;
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const sourceCard = getCardById(stateWithoutPending, ability.sourceCardId);
  const scoreBonus =
    allEnergyActive && sourceInLiveZone && sourceCard && isLiveCardData(sourceCard.data) ? 1 : 0;
  const stateAfterScore =
    scoreBonus > 0
      ? refreshPlayerScoreDraft(
          addLiveModifier(stateWithoutPending, {
            kind: 'SCORE',
            playerId: player.id,
            countDelta: scoreBonus,
            liveCardId: ability.sourceCardId,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
          }),
          player.id,
          scoreBonus
        )
      : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CATCHU_ACTIVATE_ENERGY_THEN_SCORE',
      differentNamedCatchuMemberIds: beforeActivation.differentNamedCatchuMemberIds,
      catchuConditionMet: beforeActivation.catchuConditionMet,
      waitingEnergyCountBeforeActivation: beforeActivation.waitingEnergyCount,
      requestedActivationCount: beforeActivation.activationCount,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      waitingEnergyCountAfterActivation,
      allEnergyActive,
      sourceInLiveZone,
      scoreBonus,
    }),
    orderedResolution
  );
}

function getSpPb1023Context(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly differentNamedCatchuMemberIds: readonly string[];
  readonly catchuConditionMet: boolean;
  readonly waitingEnergyCount: number;
  readonly activationCount: number;
  readonly waitingEnergyCountAfterActivation: number;
  readonly willGainScore: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      differentNamedCatchuMemberIds: [],
      catchuConditionMet: false,
      waitingEnergyCount: 0,
      activationCount: 0,
      waitingEnergyCountAfterActivation: 0,
      willGainScore: false,
    };
  }
  const differentNamedCatchuMemberIds = getDifferentNamedCatchuStageMemberIds(game, player.id);
  const catchuConditionMet = differentNamedCatchuMemberIds.length >= 2;
  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = catchuConditionMet
    ? Math.min(MAX_ENERGY_ACTIVATION_COUNT, waitingEnergyCount)
    : 0;
  const waitingEnergyCountAfterActivation = waitingEnergyCount - activationCount;
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  return {
    differentNamedCatchuMemberIds,
    catchuConditionMet,
    waitingEnergyCount,
    activationCount,
    waitingEnergyCountAfterActivation,
    willGainScore:
      waitingEnergyCountAfterActivation === 0 &&
      sourceInLiveZone &&
      sourceCard !== null &&
      isLiveCardData(sourceCard.data),
  };
}

function getDifferentNamedCatchuStageMemberIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  const isCatchu = unitAliasIs('CatChu!');
  return selectDifferentNamedCards(
    STAGE_SLOTS.flatMap((slot) => {
      const cardId = player.memberSlots.slots[slot];
      return cardId === null ? [] : [cardId];
    }),
    (cardId) => {
      const card = getCardById(game, cardId);
      return card &&
        card.ownerId === playerId &&
        isMemberCardData(card.data) &&
        isCatchu(card)
        ? card.data
        : null;
    },
    { minCount: 1 }
  ).map((match) => match.item);
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: { ...game.liveResolution, playerScores },
  };
}
