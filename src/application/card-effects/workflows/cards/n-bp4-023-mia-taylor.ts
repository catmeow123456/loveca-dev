import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type {
  EnterWaitingRoomEvent,
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import { CardType, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAIT_TARGET_STEP_ID = 'N_BP4_023_SELECT_WAIT_NIJIGASAKI_MEMBER';
const SELECT_DISCARD_STEP_ID = 'N_BP4_023_SELECT_DISCARD_HAND';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

const nijigasakiMember = (card: CardInstance): boolean =>
  typeIs(CardType.MEMBER)(card) && groupAliasIs('虹ヶ咲')(card);

export function registerNBp4023MiaTaylorWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
    (game, ability, options, context) =>
      startNBp4023MiaTaylorOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
    SELECT_WAIT_TARGET_STEP_ID,
    (game, input, context) =>
      finishWaitTargetSelection(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDiscardSelection(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startNBp4023MiaTaylorOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return game;
  }

  const selectableCardIds = getWaitTargetIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OP_NO_NIJIGASAKI_STAGE_MEMBER',
        selectableCardIds,
      }
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_WAIT_TARGET_STEP_ID,
        stepText: '可以将自己舞台上1名「虹ヶ咲」成员变为待机状态：抽1张卡，将1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择变为待机状态的虹咲成员',
        confirmSelectionLabel: '变为待机状态',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot: ability.sourceSlot,
          eventIds: ability.eventIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_WAIT_NIJIGASAKI_MEMBER',
      selectableCardIds,
    }
  );
}

function finishWaitTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID ||
    effect.stepId !== SELECT_WAIT_TARGET_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DECLINE_WAIT_NIJIGASAKI_MEMBER',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getWaitTargetIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(
    game,
    player.id,
    selectedCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  if (!waitResult || waitResult.previousOrientation === OrientationState.WAITING) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'WAIT_NIJIGASAKI_MEMBER',
          waitedMemberCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  const drawResult = drawCardsForPlayer(stateWithMemberStateTriggers.gameState, player.id, 1);
  if (!drawResult) {
    return game;
  }

  const stateAfterDraw = addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    step: 'DRAW_ONE_AFTER_WAIT',
    waitedMemberCardId: selectedCardId,
    drawnCardIds: drawResult.drawnCardIds,
  });
  const currentPlayer = getPlayerById(stateAfterDraw, player.id);
  const discardCandidates = currentPlayer?.hand.cardIds ?? [];
  if (discardCandidates.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterDraw, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DRAW_ONE_NO_HAND_TO_DISCARD',
        waitedMemberCardId: selectedCardId,
        drawnCardIds: drawResult.drawnCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...stateAfterDraw,
    activeEffect: {
      ...effect,
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: '请选择1张手牌放置入休息室。',
      selectableCardIds: discardCandidates,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: {
        ...effect.metadata,
        waitedMemberCardId: selectedCardId,
        drawnCardIds: drawResult.drawnCardIds,
      },
    },
  };
}

function finishDiscardSelection(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'DISCARD_ONE_AFTER_DRAW',
      waitedMemberCardId: effect.metadata?.waitedMemberCardId,
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
      discardedCardIds: discardResult.discardedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingNoOp(
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
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}

function getWaitTargetIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    if (cardId === null) {
      return false;
    }
    const card = getCardById(game, cardId);
    const state = player.memberSlots.cardStates.get(cardId);
    return (
      card !== null &&
      card.ownerId === player.id &&
      nijigasakiMember(card) &&
      state?.orientation !== OrientationState.WAITING
    );
  });
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
