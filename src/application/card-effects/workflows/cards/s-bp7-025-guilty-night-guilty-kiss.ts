import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addMemberActivePhaseSkip } from '../../../../domain/rules/member-active-skips.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!S-bp7-025';
const CHOOSE_EFFECT_STEP_ID = 'S_BP7_025_CHOOSE_LIVE_SUCCESS_EFFECT';
const SELECT_WAIT_TARGETS_STEP_ID = 'S_BP7_025_SELECT_WAIT_TARGETS';
const WAIT_OPTION_ID = 'wait-up-to-two-low-cost-members';
const DRAW_OPTION_ID = 'draw-one-card';
const PRINTED_OPTION_IDS = [WAIT_OPTION_ID, DRAW_OPTION_ID] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp7025GuiltyNightGuiltyKissWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startChooseEffect(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID,
    CHOOSE_EFFECT_STEP_ID,
    (game, input, context) =>
      finishEffectChoice(
        game,
        input.selectedEffectOptionIds ?? [],
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID,
    SELECT_WAIT_TARGETS_STEP_ID,
    (game, input, context) =>
      finishWaitTargets(
        game,
        input.selectedCardIds ?? [],
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startChooseEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (!isOwnLiveSourceForBase(game, player.id, ability.sourceCardId)) {
    return finishPendingAsNoOp(game, ability, orderedResolution, continuePendingCardEffects);
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_EFFECT_STEP_ID,
      stepText: '请选择要处理的LIVE成功效果。',
      awaitingPlayerId: player.id,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: WAIT_OPTION_ID,
            text: '将存在于对方的舞台的至多2名费用小于等于4的成员变为待机状态。那些成员在下个回合的活跃阶段不会变为活跃状态。',
            selectable: true,
          },
          {
            id: DRAW_OPTION_ID,
            text: '抽1张卡。',
            selectable: true,
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_EFFECT_CHOICE',
    },
  });
}

function finishEffectChoice(
  game: GameState,
  selectedOptionIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !isEffectStep(effect, CHOOSE_EFFECT_STEP_ID) ||
    selectedOptionIds.length !== 1 ||
    !PRINTED_OPTION_IDS.includes(selectedOptionIds[0] as (typeof PRINTED_OPTION_IDS)[number])
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (!isOwnLiveSourceForBase(game, player.id, effect.sourceCardId)) {
    return finishActiveEffect(
      game,
      effect,
      'SOURCE_NOT_IN_LIVE_ZONE_NO_OP',
      continuePendingCardEffects,
      { selectedOptionIds }
    );
  }

  const selectedOptionId = selectedOptionIds[0]!;
  if (selectedOptionId === DRAW_OPTION_ID) {
    const drawResult = drawCardsForPlayer(game, player.id, 1);
    if (!drawResult) {
      return finishActiveEffect(game, effect, 'DRAW_ONE_NO_OP', continuePendingCardEffects, {
        selectedOptionIds,
        drawnCardIds: [],
      });
    }
    return finishActiveEffect(
      drawResult.gameState,
      effect,
      'DRAW_ONE',
      continuePendingCardEffects,
      {
        selectedOptionIds,
        drawnCardIds: drawResult.drawnCardIds,
      }
    );
  }

  const opponent = getOpponent(game, player.id);
  if (!opponent) {
    return finishActiveEffect(game, effect, 'NO_OPPONENT_NO_OP', continuePendingCardEffects, {
      selectedOptionIds,
    });
  }
  const targetCardIds = getWaitTargetCardIds(game, opponent.id);
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_WAIT_TARGETS_STEP_ID,
      stepText: '请选择对方舞台上至多2名费用小于等于4的成员变为待机状态。',
      awaitingPlayerId: player.id,
      effectChoice: undefined,
      selectableOptions: undefined,
      selectableCardIds: targetCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(2, targetCardIds.length),
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: {
        ...effect.metadata,
        selectedOptionId,
        targetPlayerId: opponent.id,
      },
    },
  };
}

function finishWaitTargets(
  game: GameState,
  selectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!isEffectStep(effect, SELECT_WAIT_TARGETS_STEP_ID)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  const opponent = targetPlayerId ? getPlayerById(game, targetPlayerId) : null;
  if (!player || !opponent || opponent.id === player.id) {
    return game;
  }
  if (!isOwnLiveSourceForBase(game, player.id, effect.sourceCardId)) {
    return finishActiveEffect(
      game,
      effect,
      'SOURCE_NOT_IN_LIVE_ZONE_NO_OP',
      continuePendingCardEffects,
      {
        selectedOptionIds: [WAIT_OPTION_ID],
        selectedCardIds: [],
        waitingMemberCardIds: [],
      }
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const currentTargetCardIds = getWaitTargetCardIds(game, opponent.id);
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > 2 ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true ||
        !currentTargetCardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const orientationResult = setMembersOrientation(
    game,
    opponent.id,
    uniqueSelectedCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      selectionPlayerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationResult) {
    return game;
  }

  let stateWithSkipMarkers = orientationResult.gameState;
  for (const memberCardId of orientationResult.updatedMemberCardIds) {
    stateWithSkipMarkers = addMemberActivePhaseSkip(stateWithSkipMarkers, {
      playerId: opponent.id,
      memberCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }
  const withTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    {
      ...orientationResult,
      gameState: stateWithSkipMarkers,
    },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, events) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'WAIT_UP_TO_TWO_LOW_COST_MEMBERS',
          selectedOptionIds: [WAIT_OPTION_ID],
          selectedCardIds: uniqueSelectedCardIds,
          waitingMemberCardIds: result.updatedMemberCardIds,
          blockedMemberCardIds: result.blockedMemberCardIds ?? [],
          memberStateChangedEventIds: events.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(
    withTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAsNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_IN_LIVE_ZONE_NO_OP',
      }
    ),
    orderedResolution
  );
}

function finishActiveEffect(
  game: GameState,
  effect: ActiveEffectState,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== effect.id),
      },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function isEffectStep(
  effect: GameState['activeEffect'],
  stepId: string
): effect is ActiveEffectState {
  return (
    effect?.abilityId === S_BP7_025_LIVE_SUCCESS_CHOOSE_WAIT_TWO_LOW_COST_OR_DRAW_ONE_ABILITY_ID &&
    effect.stepId === stepId
  );
}

function getWaitTargetCardIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return getStageMemberCardIdsMatching(
    game,
    player.id,
    and(typeIs(CardType.MEMBER), costLte(4))
  ).filter((cardId) => {
    const cardState = player.memberSlots.cardStates.get(cardId);
    return cardState !== undefined && cardState.orientation !== OrientationState.WAITING;
  });
}

function isOwnLiveSourceForBase(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player?.liveZone.cardIds.includes(sourceCardId) === true &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE)
  );
}
