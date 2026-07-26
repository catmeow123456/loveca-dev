import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PB1_008_ON_ENTER_WAIT_UP_TO_THREE_MEMBERS_DRAW_PER_WAITED_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { waitStageMembersAndEnqueueTriggers } from '../../runtime/wait-stage-members.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_MEMBERS_STEP_ID = 'PL_PB1_008_SELECT_MEMBERS_TO_WAIT';
const MAX_TARGET_COUNT = 3;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb1008HanayoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    PL_PB1_008_ON_ENTER_WAIT_UP_TO_THREE_MEMBERS_DRAW_PER_WAITED_ABILITY_ID,
    (game, ability, options, context) =>
      start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_PB1_008_ON_ENTER_WAIT_UP_TO_THREE_MEMBERS_DRAW_PER_WAITED_ABILITY_ID,
    SELECT_MEMBERS_STEP_ID,
    (game, input, context) =>
      finish(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = getWaitableOwnStageMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consume(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_WAITABLE_OWN_STAGE_MEMBERS',
      selectedMemberCardIds: [],
      actuallyWaitedMemberCardIds: [],
      memberStateChangedEventIds: [],
      requestedCount: 0,
      actualWaitedCount: 0,
      drawnCardIds: [],
    });
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
      stepId: SELECT_MEMBERS_STEP_ID,
      stepText: '可以将自己舞台上至多3名成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(MAX_TARGET_COUNT, selectableCardIds.length),
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_MEMBERS_TO_WAIT',
      selectableCardIds,
      maxSelectableCards: Math.min(MAX_TARGET_COUNT, selectableCardIds.length),
    },
  });
}

function finish(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PB1_008_ON_ENTER_WAIT_UP_TO_THREE_MEMBERS_DRAW_PER_WAITED_ABILITY_ID ||
    effect.stepId !== SELECT_MEMBERS_STEP_ID
  )
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > MAX_TARGET_COUNT ||
    uniqueSelectedCardIds.some((cardId) => effect.selectableCardIds?.includes(cardId) !== true)
  )
    return game;

  const waitResult = waitStageMembersAndEnqueueTriggers(game, {
    playerId: player.id,
    memberCardIds: uniqueSelectedCardIds.filter((cardId) =>
      getWaitableOwnStageMemberCardIds(game, player.id).includes(cardId)
    ),
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
    enqueueTriggeredCardEffects,
  });
  const { actuallyWaitedMemberCardIds, memberStateChangedEventIds } = waitResult;
  const drawResult =
    actuallyWaitedMemberCardIds.length > 0
      ? drawCardsForPlayer(waitResult.gameState, player.id, actuallyWaitedMemberCardIds.length)
      : null;
  const finalState = drawResult?.gameState ?? waitResult.gameState;
  return continuePendingCardEffects(
    addAction({ ...finalState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        actuallyWaitedMemberCardIds.length > 0
          ? 'WAIT_MEMBERS_DRAW_PER_WAITED'
          : 'NO_MEMBERS_WAITED',
      selectedMemberCardIds: uniqueSelectedCardIds,
      actuallyWaitedMemberCardIds,
      memberStateChangedEventIds,
      requestedCount: uniqueSelectedCardIds.length,
      actualWaitedCount: actuallyWaitedMemberCardIds.length,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getWaitableOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, () => true).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
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
