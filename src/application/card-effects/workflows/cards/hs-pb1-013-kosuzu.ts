import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface HigherCostStageMemberResult {
  readonly sourceOnStage: boolean;
  readonly sourceEffectiveCost: number | null;
  readonly higherCostMemberIds: readonly string[];
}

export function registerHsPb1013KosuzuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1013KosuzuLiveSuccess(
        game,
        ability,
        {
          orderedResolution: options.orderedResolution === true,
          manualConfirmation: options.manualConfirmation === true,
          confirmBeforeResolution: options.confirmBeforeResolution === true,
          skipManualConfirmation: options.skipManualConfirmation === true,
        },
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1013KosuzuLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly manualConfirmation: boolean;
    readonly confirmBeforeResolution: boolean;
    readonly skipManualConfirmation: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (
    (options.manualConfirmation || options.confirmBeforeResolution) &&
    !options.skipManualConfirmation
  ) {
    const result = getHigherCostStageMemberResult(game, player.id, ability.sourceCardId);
    const conditionMet = result.higherCostMemberIds.length > 0;
    return (
      maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getHsPb1013KosuzuConfirmationEffectText(game, ability),
        stepText: result.sourceOnStage
          ? conditionMet
            ? `自己的舞台存在 ${result.higherCostMemberIds.length} 名费用高于此成员的成员，条件满足。确认后抽 1 张卡。`
            : '自己的舞台不存在费用高于此成员的成员，条件不满足。确认后不抽牌。'
          : '来源成员不在自己的舞台，确认后不抽牌。',
      }) ?? game
    );
  }

  return resolveHsPb1013KosuzuLiveSuccess(
    game,
    ability,
    options.orderedResolution,
    continuePendingCardEffects
  );
}

function resolveHsPb1013KosuzuLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const result = getHigherCostStageMemberResult(game, player.id, ability.sourceCardId);
  const conditionMet = result.higherCostMemberIds.length > 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = conditionMet ? drawCardsForPlayer(stateWithoutPending, player.id, 1) : null;
  const state = drawResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW',
      sourceOnStage: result.sourceOnStage,
      sourceEffectiveCost: result.sourceEffectiveCost,
      higherCostMemberIds: result.higherCostMemberIds,
      conditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function getHsPb1013KosuzuConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const result = getHigherCostStageMemberResult(game, ability.controllerId, ability.sourceCardId);
  const conditionMet = result.higherCostMemberIds.length > 0;
  const sourceCostText =
    result.sourceEffectiveCost === null ? '来源不在舞台' : `此成员有效费用 ${result.sourceEffectiveCost}`;
  return `${getAbilityEffectText(ability.abilityId)}（${sourceCostText}，更高费用成员 ${result.higherCostMemberIds.length}名，${conditionMet ? '满足条件，抽1张' : '未满足条件，不抽牌'}）`;
}

function getHigherCostStageMemberResult(
  game: GameState,
  playerId: string,
  sourceCardId: string
): HigherCostStageMemberResult {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (!player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return { sourceOnStage: false, sourceEffectiveCost: null, higherCostMemberIds: [] };
  }

  const stageMemberIds = Object.values(player.memberSlots.slots).filter(
    (cardId): cardId is string => typeof cardId === 'string'
  );
  if (!stageMemberIds.includes(sourceCardId)) {
    return { sourceOnStage: false, sourceEffectiveCost: null, higherCostMemberIds: [] };
  }

  const sourceEffectiveCost = getMemberEffectiveCost(game, playerId, sourceCardId);
  const higherCostMemberIds = stageMemberIds.filter((cardId) => {
    if (cardId === sourceCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      getMemberEffectiveCost(game, playerId, cardId) > sourceEffectiveCost
    );
  });

  return { sourceOnStage: true, sourceEffectiveCost, higherCostMemberIds };
}
