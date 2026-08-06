import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, SlotPosition } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_MEMBER_STEP_ID = 'S_BP7_018_SELECT_MEMBER_TO_CENTER';
const memberSelector = typeIs(CardType.MEMBER);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp7018RubyWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID,
    (game, ability, options, context) =>
      startPositionChangeToCenter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID,
    SELECT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishPositionChangeToCenter(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startPositionChangeToCenter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = getSideStageMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumePendingAbility(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_SIDE_STAGE_MEMBER_TO_MOVE_TO_CENTER',
      selectableCardIds,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_MEMBER_STEP_ID,
      stepText: '请选择自己舞台上1名成员站位变换到中央区域。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要移动到中央区域的成员',
      confirmSelectionLabel: '站位变换',
      canSkipSelection: false,
      metadata: { orderedResolution, sourceSlot: ability.sourceSlot },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_MEMBER_TO_MOVE_TO_CENTER',
      selectableCardIds,
    },
  });
}

function finishPositionChangeToCenter(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_018_ON_ENTER_STAGE_MEMBER_POSITION_CHANGE_TO_CENTER_ABILITY_ID ||
    effect.stepId !== SELECT_MEMBER_STEP_ID ||
    selectedCardId === null
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const currentCandidateIds = player ? getSideStageMemberCardIds(game, player.id) : [];
  if (
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentCandidateIds.includes(selectedCardId)
  ) {
    return game;
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    SlotPosition.CENTER,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'MOVE_STAGE_MEMBER_TO_CENTER',
          targetMemberCardId: selectedCardId,
          fromSlot: result.fromSlot,
          toSlot: result.toSlot,
          swappedCardId: result.swappedCardId,
        }),
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

function getSideStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, playerId, memberSelector).filter(
    (cardId) =>
      player.memberSlots.slots[SlotPosition.LEFT] === cardId ||
      player.memberSlots.slots[SlotPosition.RIGHT] === cardId
  );
}

function consumePendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
