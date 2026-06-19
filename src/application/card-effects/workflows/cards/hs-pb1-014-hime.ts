import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { CardType, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { toPlayerLocalSlotForControllerPerspective } from '../../../../shared/utils/slot-perspective.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../runtime/member-slot-moved-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_PB1_014_SELECT_OPPONENT_MEMBER_STEP_ID =
  'HS_PB1_014_SELECT_OPPONENT_MEMBER_FRONT_SLOT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly memberSlotMovedEvents?: readonly MemberSlotMovedEvent[];
  }
) => GameState;

const miraCraMember = and(typeIs(CardType.MEMBER), unitAliasIs('Mira-Cra Park!'));

export function registerHsPb1014HimeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1014HimeMoveOpponentFront(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID,
    HS_PB1_014_SELECT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsPb1014HimeMoveOpponentFront(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsPb1014HimeMoveOpponentFront(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = player
    ? (ability.sourceSlot ?? getSourceMemberSlot(game, player.id, ability.sourceCardId))
    : null;
  if (!player || !opponent || !sourceSlot) {
    return game;
  }

  if (!ownStageMembersAreOnlyMiraCra(game, player.id)) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'OWN_STAGE_NOT_ONLY_MIRACRA',
      continuePendingCardEffects
    );
  }

  const targetLocalSlot = toPlayerLocalSlotForControllerPerspective(
    sourceSlot,
    player.id,
    opponent.id
  );
  const selectableCardIds = getStageMemberCardIdsMatching(
    game,
    opponent.id,
    typeIs(CardType.MEMBER)
  );

  if (selectableCardIds.length === 0) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_OPPONENT_MEMBER_TO_MOVE_FRONT',
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID),
      stepId: HS_PB1_014_SELECT_OPPONENT_MEMBER_STEP_ID,
      stepText: '请选择要移动到此成员正面区域的对方成员。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择对方成员',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot,
        targetLocalSlot,
        targetPlayerId: opponent.id,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OPPONENT_MEMBER_FRONT_SLOT',
      sourceSlot,
      targetLocalSlot,
      targetPlayerId: opponent.id,
      selectableCardIds,
    },
  });
}

function finishHsPb1014HimeMoveOpponentFront(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PB1_014_ON_ENTER_MOVE_OPPONENT_FRONT_ABILITY_ID ||
    effect.stepId !== HS_PB1_014_SELECT_OPPONENT_MEMBER_STEP_ID ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  const sourceSlot = getSlotPosition(effect.metadata?.sourceSlot);
  const targetLocalSlot = sourceSlot
    ? toPlayerLocalSlotForControllerPerspective(sourceSlot, player?.id ?? '', targetPlayerId ?? '')
    : null;
  if (!player || !targetPlayerId || !sourceSlot || !targetLocalSlot) {
    return game;
  }

  const selectedCardLocation = findPlayerMemberSlot(game, targetPlayerId, selectedCardId);
  if (!selectedCardLocation) {
    return game;
  }

  if (selectedCardLocation === targetLocalSlot) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'MOVE_OPPONENT_MEMBER_FRONT_SLOT',
        sourceSlot,
        targetLocalSlot,
        targetPlayerId,
        targetCardId: selectedCardId,
        fromSlot: selectedCardLocation,
        toSlot: targetLocalSlot,
        noOp: true,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    targetPlayerId,
    selectedCardId,
    targetLocalSlot,
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
            step: 'MOVE_OPPONENT_MEMBER_FRONT_SLOT',
            sourceSlot,
            targetLocalSlot,
            targetPlayerId,
            targetCardId: selectedCardId,
            fromSlot: result.fromSlot,
            toSlot: result.toSlot,
            swappedCardId: result.swappedCardId,
          }
        ),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
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
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function ownStageMembersAreOnlyMiraCra(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  const stageCardIds = Object.values(player.memberSlots.slots).filter(
    (cardId): cardId is string => typeof cardId === 'string'
  );
  return (
    stageCardIds.length > 0 &&
    stageCardIds.every((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && miraCraMember(card);
    })
  );
}

function getSlotPosition(value: unknown): SlotPosition | null {
  return value === SlotPosition.LEFT ||
    value === SlotPosition.CENTER ||
    value === SlotPosition.RIGHT
    ? value
    : null;
}

function findPlayerMemberSlot(
  game: GameState,
  playerId: string,
  cardId: string
): SlotPosition | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }
  return (
    Object.values(SlotPosition).find((slot) => player.memberSlots.slots[slot] === cardId) ?? null
  );
}
