import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_N_BP4_009_LIVE_START_DRAW_TWO_HAND_TO_DECK_TOP_LOW_STAGE_COST_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer, moveHandCardToDeckTopForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_CARD_TO_DECK_TOP_STEP_ID = 'PL_N_BP4_009_SELECT_HAND_CARD_TO_DECK_TOP';
const DRAW_COUNT = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4009RinaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_009_LIVE_START_DRAW_TWO_HAND_TO_DECK_TOP_LOW_STAGE_COST_ABILITY_ID,
    (game, ability, options, context) =>
      startRinaDrawTwoReturnHandToDeckTop(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_009_LIVE_START_DRAW_TWO_HAND_TO_DECK_TOP_LOW_STAGE_COST_ABILITY_ID,
    SELECT_HAND_CARD_TO_DECK_TOP_STEP_ID,
    (game, input, context) =>
      finishRinaHandToDeckTopSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startRinaDrawTwoReturnHandToDeckTop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getStageCostComparisonContext(game, ability);
  if (!context.conditionMet) {
    const stateWithoutPending = removePendingAbility(game, ability.id);
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: context.sourceSlot,
        step: context.noOpStep,
        sourceOnStage: context.sourceOnStage,
        ownStageCostTotal: context.ownStageCostTotal,
        opponentStageCostTotal: context.opponentStageCostTotal,
        conditionMet: false,
      }),
      orderedResolution
    );
  }

  const drawResult = drawCardsForPlayer(game, player.id, DRAW_COUNT);
  if (!drawResult) {
    return game;
  }

  const stateWithoutPending = removePendingAbility(drawResult.gameState, ability.id);
  const currentPlayer = getPlayerById(stateWithoutPending, player.id);
  const selectableCardIds = currentPlayer?.hand.cardIds ?? [];

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: context.sourceSlot,
        step: 'DRAW_TWO_NO_HAND_CARD_TO_RETURN',
        sourceOnStage: context.sourceOnStage,
        ownStageCostTotal: context.ownStageCostTotal,
        opponentStageCostTotal: context.opponentStageCostTotal,
        conditionMet: true,
        drawnCardIds: drawResult.drawnCardIds,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_HAND_CARD_TO_DECK_TOP_STEP_ID,
        stepText: '已抽2张卡。请选择1张手牌放置于卡组顶。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择放置到卡组顶的手牌',
        confirmSelectionLabel: '放置到卡组顶',
        metadata: {
          orderedResolution,
          sourceZone: ZoneType.HAND,
          destination: ZoneType.MAIN_DECK,
          sourceSlot: context.sourceSlot,
          ownStageCostTotal: context.ownStageCostTotal,
          opponentStageCostTotal: context.opponentStageCostTotal,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: 'DRAW_TWO_SELECT_HAND_CARD_TO_DECK_TOP',
      ownStageCostTotal: context.ownStageCostTotal,
      opponentStageCostTotal: context.opponentStageCostTotal,
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    }
  );
}

function finishRinaHandToDeckTopSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_009_LIVE_START_DRAW_TWO_HAND_TO_DECK_TOP_LOW_STAGE_COST_ABILITY_ID ||
    effect.stepId !== SELECT_HAND_CARD_TO_DECK_TOP_STEP_ID ||
    selectedCardId === null
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const moveResult = moveHandCardToDeckTopForPlayer(game, player.id, selectedCardId, {
    candidateCardIds: effect.selectableCardIds,
  });
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'HAND_CARD_TO_DECK_TOP',
      selectedCardId,
      movedCardId: moveResult.movedCardId,
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
      ownStageCostTotal: getNumberMetadata(effect.metadata?.ownStageCostTotal),
      opponentStageCostTotal: getNumberMetadata(effect.metadata?.opponentStageCostTotal),
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStageCostComparisonContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceSlot: ReturnType<typeof getSourceMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly ownStageCostTotal: number;
  readonly opponentStageCostTotal: number;
  readonly conditionMet: boolean;
  readonly noOpStep: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  const sourceOnStage = sourceSlot !== null;
  const ownStageCostTotal = player ? getStageCostTotal(game, player.id) : 0;
  const opponentStageCostTotal = opponent ? getStageCostTotal(game, opponent.id) : 0;
  const lowerStageCost = ownStageCostTotal < opponentStageCostTotal;
  const conditionMet = sourceOnStage && lowerStageCost;
  const noOpStep = !sourceOnStage ? 'SOURCE_NOT_ON_STAGE' : 'STAGE_COST_NOT_LOWER_THAN_OPPONENT';

  return {
    sourceSlot,
    sourceOnStage,
    ownStageCostTotal,
    opponentStageCostTotal,
    conditionMet,
    noOpStep,
  };
}

function getStageCostTotal(game: GameState, playerId: string): number {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).reduce(
    (total, cardId) => total + getMemberEffectiveCost(game, playerId, cardId),
    0
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function getNumberMetadata(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
