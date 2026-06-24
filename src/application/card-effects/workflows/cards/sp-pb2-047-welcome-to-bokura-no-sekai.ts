import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type {
  EnterWaitingRoomEvent,
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import { CardType, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'SP_PB2_047_SELECT_DISCARD';
const SELECT_OPPONENT_TARGET_STEP_ID = 'SP_PB2_047_SELECT_OPPONENT_LOW_COST_MEMBER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

const isLiellaCard = groupAliasIs('Liella!');
const opponentLowCostMemberSelector = and(typeIs(CardType.MEMBER), costLte(2));

export function registerSpPb2047WelcomeToBokuraNoSekaiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2047WelcomeLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishDiscardCostAndStartTargetSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'SKIP_DISCARD',
          })
  );
  registerActiveEffectStepHandler(
    SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    SELECT_OPPONENT_TARGET_STEP_ID,
    (game, input, context) =>
      finishOpponentTargetSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpPb2047WelcomeLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds;
  const stageCondition = getLiellaOnlyStageCondition(game, player.id);
  const targetCardIds = getLegalOpponentTargetCardIds(game, opponent.id);
  if (
    selectableCardIds.length === 0 ||
    !stageCondition.allStageMembersAreLiella ||
    targetCardIds.length === 0
  ) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      noHand: selectableCardIds.length === 0,
      allStageMembersAreLiella: stageCondition.allStageMembersAreLiella,
      ownStageMemberCardIds: stageCondition.stageMemberCardIds,
      targetPlayerId: opponent.id,
      legalTargetCardIds: targetCardIds,
      reason: getNoOpReason(selectableCardIds.length, stageCondition, targetCardIds),
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(
        SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID
      ),
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds,
      orderedResolution,
      metadata: {
        targetPlayerId: opponent.id,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      targetPlayerId: opponent.id,
      selectableCardIds,
      legalTargetCardIds: targetCardIds,
    },
  });
}

function finishDiscardCostAndStartTargetSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (!player || !targetPlayerId || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const discardedCardId = discardResult.discardedCardIds[0] ?? discardCardId;
  const stageCondition = getLiellaOnlyStageCondition(discardResult.gameState, player.id);
  const targetSelection = createOpponentTargetSelection(
    discardResult.gameState,
    createPendingAbilityFromEffect(effect),
    effect.metadata?.orderedResolution === true
  );
  if (!stageCondition.allStageMembersAreLiella || targetSelection.activeEffect === null) {
    const state = {
      ...discardResult.gameState,
      activeEffect: null,
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: stageCondition.allStageMembersAreLiella
          ? 'DISCARD_HAND_CARD_NO_TARGET'
          : 'DISCARD_HAND_CARD_CONDITION_FAILED',
        discardedCardId,
        allStageMembersAreLiella: stageCondition.allStageMembersAreLiella,
        ownStageMemberCardIds: stageCondition.stageMemberCardIds,
        targetPlayerId,
        legalTargetCardIds: targetSelection.selectableCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...targetSelection.activeEffect,
        metadata: {
          ...targetSelection.activeEffect.metadata,
          discardedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_START_SELECT_TARGET',
      discardedCardId,
      targetPlayerId,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishOpponentTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata) {
    return game;
  }

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_OPPONENT_LOW_COST_MEMBER',
            discardedCardId: effect.metadata?.discardedCardId,
            targetPlayerId: targetMetadata.targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function createOpponentTargetSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
) {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return { selectableCardIds: [], activeEffect: null };
  }

  return createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(
      SP_PB2_047_LIVE_START_DISCARD_LIELLA_STAGE_WAIT_OPPONENT_LOW_COST_ABILITY_ID
    ),
    stepId: SELECT_OPPONENT_TARGET_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    awaitingPlayerId: player.id,
    targetPlayerId: opponent.id,
    selector: opponentLowCostMemberSelector,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    orderedResolution,
  });
}

function createPendingAbilityFromEffect(
  effect: NonNullable<GameState['activeEffect']>
): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
  };
}

function getLiellaOnlyStageCondition(
  game: GameState,
  playerId: string
): {
  readonly stageMemberCardIds: readonly string[];
  readonly allStageMembersAreLiella: boolean;
} {
  const player = getPlayerById(game, playerId);
  const stageMemberCardIds = player
    ? Object.values(player.memberSlots.slots).filter((cardId): cardId is string => cardId !== null)
    : [];
  return {
    stageMemberCardIds,
    allStageMembersAreLiella:
      stageMemberCardIds.length > 0 &&
      stageMemberCardIds.every((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && isLiellaCard(card);
      }),
  };
}

function getLegalOpponentTargetCardIds(game: GameState, opponentId: string): readonly string[] {
  const opponent = getPlayerById(game, opponentId);
  if (!opponent) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, opponent.id, opponentLowCostMemberSelector).filter(
    (cardId) =>
      opponent.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
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
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'NO_OP',
      ...payload,
    }),
    orderedResolution
  );
}

function getNoOpReason(
  handCount: number,
  stageCondition: ReturnType<typeof getLiellaOnlyStageCondition>,
  targetCardIds: readonly string[]
): 'NO_HAND' | 'NON_LIELLA_STAGE' | 'NO_STAGE_MEMBERS' | 'NO_TARGET' {
  if (handCount === 0) {
    return 'NO_HAND';
  }
  if (stageCondition.stageMemberCardIds.length === 0) {
    return 'NO_STAGE_MEMBERS';
  }
  if (!stageCondition.allStageMembersAreLiella) {
    return 'NON_LIELLA_STAGE';
  }
  return targetCardIds.length === 0 ? 'NO_TARGET' : 'NO_TARGET';
}
