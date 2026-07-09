import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { S_SD1_020_LIVE_SUCCESS_DRAW_AQOURS_STAGE_COUNT_DISCARD_DRAWN_COUNT_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

const ABILITY_ID = S_SD1_020_LIVE_SUCCESS_DRAW_AQOURS_STAGE_COUNT_DISCARD_DRAWN_COUNT_ABILITY_ID;
const SELECT_DISCARD_STEP_ID = 'S_SD1_020_SELECT_DISCARD_DRAWN_COUNT';
const AQOURS = 'Aqours';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSSd1020JimoAiDashWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startSSd1020JimoAiDashLiveSuccess(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_DISCARD_STEP_ID, (game, input, context) =>
    finishSSd1020JimoAiDashDiscardSelection(
      game,
      getSelectedCardIdsFromStepInput(input),
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
}

function startSSd1020JimoAiDashLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (!isSourceOwnLive(game, player.id, ability.sourceCardId)) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_IN_LIVE_ZONE',
    });
  }

  const aqoursStageMemberCardIds = getOwnStageAqoursMemberCardIds(game, player.id);
  if (aqoursStageMemberCardIds.length === 0) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_AQOURS_STAGE_MEMBERS',
      aqoursStageMemberCardIds,
      expectedDrawCount: 0,
      drawnCardIds: [],
    });
  }

  const drawResult = drawCardsForPlayer(game, player.id, aqoursStageMemberCardIds.length);
  if (!drawResult) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'DRAW_FAILED',
      aqoursStageMemberCardIds,
      expectedDrawCount: aqoursStageMemberCardIds.length,
      drawnCardIds: [],
    });
  }

  const stateWithoutPending = removePendingAbility(drawResult.gameState, ability.id);
  const playerAfterDraw = getPlayerById(stateWithoutPending, player.id);
  const actualDrawCount = drawResult.drawnCardIds.length;
  const selectableCardIds = playerAfterDraw?.hand.cardIds ?? [];
  if (actualDrawCount === 0 || selectableCardIds.length < actualDrawCount) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: actualDrawCount === 0 ? 'DRAW_ZERO_NO_DISCARD' : 'HAND_LESS_THAN_DRAWN_COUNT',
        aqoursStageMemberCardIds,
        expectedDrawCount: aqoursStageMemberCardIds.length,
        drawnCardIds: drawResult.drawnCardIds,
        actualDrawCount,
        selectableCardIds,
      }),
      orderedResolution
    );
  }

  const discardCountText = actualDrawCount === 1 ? '1张' : `${actualDrawCount}张`;
  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: `已实际抽${actualDrawCount}张卡。请选择${discardCountText}手牌放置入休息室。`,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: actualDrawCount > 1 ? 'ORDERED_MULTI' : 'SINGLE',
        minSelectableCards: actualDrawCount > 1 ? actualDrawCount : undefined,
        maxSelectableCards: actualDrawCount > 1 ? actualDrawCount : undefined,
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        metadata: {
          orderedResolution,
          aqoursStageMemberCardIds,
          expectedDrawCount: aqoursStageMemberCardIds.length,
          actualDrawCount,
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
      step: 'DRAW_CARDS_SELECT_DISCARD',
      aqoursStageMemberCardIds,
      expectedDrawCount: aqoursStageMemberCardIds.length,
      drawnCardIds: drawResult.drawnCardIds,
      actualDrawCount,
      selectableCardIds,
    }
  );
}

function finishSSd1020JimoAiDashDiscardSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_DISCARD_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const actualDrawCount = getPositiveIntegerMetadata(effect.metadata?.actualDrawCount);
  const currentSelectableCardIds = player.hand.cardIds.filter(
    (cardId) => effect.selectableCardIds?.includes(cardId) === true
  );
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !isSourceOwnLive(game, player.id, effect.sourceCardId) ||
    actualDrawCount === null ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    selectedCardIds.length !== actualDrawCount ||
    selectedCardIds.some((cardId) => !currentSelectableCardIds.includes(cardId))
  ) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'STALE_OR_INVALID_DISCARD_SELECTION',
      selectedCardIds,
      selectableCardIds: currentSelectableCardIds,
      discardedCardIds: [],
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
      actualDrawCount,
    });
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardIds,
    {
      count: actualDrawCount,
      candidateCardIds: currentSelectableCardIds,
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'DISCARD_FAILED',
      selectedCardIds,
      selectableCardIds: currentSelectableCardIds,
      discardedCardIds: [],
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
      actualDrawCount,
    });
  }

  return finishEffect(discardResult.gameState, effect, continuePendingCardEffects, {
    step: 'DISCARD_DRAWN_COUNT_HAND_CARDS',
    selectedCardIds,
    discardedCardIds: discardResult.discardedCardIds,
    drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
    actualDrawCount,
  });
}

function finishEffect(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function isSourceOwnLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!sourceCard &&
    sourceCard.ownerId === playerId &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function getOwnStageAqoursMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, and(typeIs(CardType.MEMBER), groupAliasIs(AQOURS)));
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

function getPositiveIntegerMetadata(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function getSelectedCardIdsFromStepInput(input: {
  readonly selectedCardId?: string | null;
  readonly selectedCardIds?: readonly string[];
}): readonly string[] {
  if (input.selectedCardIds) {
    return input.selectedCardIds;
  }
  return input.selectedCardId ? [input.selectedCardId] : [];
}
