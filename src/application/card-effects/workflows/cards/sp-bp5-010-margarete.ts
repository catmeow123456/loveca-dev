import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { SP_BP5_010_ON_ENTER_BOTH_CENTER_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'SP_BP5_010_CENTER_POSITION_CHANGE';
const TARGET_SLOTS = [SlotPosition.LEFT, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5010MargareteWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_010_ON_ENTER_BOTH_CENTER_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp5010MargareteOnEnter(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_010_ON_ENTER_BOTH_CENTER_POSITION_CHANGE_ABILITY_ID,
    STEP_ID,
    (game, input, context) =>
      finishSpBp5010MargaretePositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpBp5010MargareteOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const playerIds = [ability.controllerId, getOpponentPlayerId(game, ability.controllerId)].filter(
    isString
  );
  const targetIndex = findNextPlayerIndexWithCenter(game, playerIds, 0);
  if (targetIndex === null) {
    return consumePendingWithoutPrompt(game, ability, options.orderedResolution === true, {
      step: 'NO_CENTER_MEMBERS_POSITION_CHANGE',
      playerIds,
    }, continuePendingCardEffects);
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: createPositionChangePrompt(
      game,
      ability,
      playerIds,
      targetIndex,
      options.orderedResolution === true
    ),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_BOTH_CENTER_POSITION_CHANGE',
      targetPlayerId: playerIds[targetIndex],
      playerIds,
    },
  });
}

function finishSpBp5010MargaretePositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== STEP_ID) {
    return game;
  }
  if (
    selectedSlot !== SlotPosition.LEFT &&
    selectedSlot !== SlotPosition.RIGHT
  ) {
    return game;
  }

  const playerIds = getPlayerIdsFromEffect(effect);
  const targetIndex = getTargetIndex(effect);
  const targetPlayerId = playerIds[targetIndex] ?? null;
  const targetPlayer = targetPlayerId ? getPlayerById(game, targetPlayerId) : null;
  const centerCardId = targetPlayer?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  if (!targetPlayerId || !targetPlayer || !centerCardId) {
    return advanceToNextTargetOrFinish(game, continuePendingCardEffects, {
      step: 'CENTER_POSITION_CHANGE_NO_OP',
      targetPlayerId,
      reason: 'NO_CENTER_MEMBER',
    });
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    targetPlayerId,
    centerCardId,
    selectedSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        prepareStateAfterMove(state, effect, {
          step: 'CENTER_POSITION_CHANGE',
          targetPlayerId,
          movedCardId: result.movedCardId,
          fromSlot: result.fromSlot,
          toSlot: result.toSlot,
          swappedCardId: result.swappedCardId,
        }),
    }
  );

  if (!moveResult) {
    return game;
  }

  return moveResult.gameState.activeEffect === null
    ? continuePendingCardEffects(
        moveResult.gameState,
        effect.metadata?.orderedResolution === true
      )
    : moveResult.gameState;
}

function prepareStateAfterMove(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const playerIds = getPlayerIdsFromEffect(effect);
  const nextIndex = findNextPlayerIndexWithCenter(game, playerIds, getTargetIndex(effect) + 1);
  const stateWithAction = addAction(
    {
      ...game,
      activeEffect:
        nextIndex === null ? null : createPositionChangePromptFromEffect(game, effect, nextIndex),
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }
  );

  return stateWithAction;
}

function advanceToNextTargetOrFinish(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const state = prepareStateAfterMove(game, effect, payload);
  return state.activeEffect === null
    ? continuePendingCardEffects(state, effect.metadata?.orderedResolution === true)
    : state;
}

function createPositionChangePrompt(
  game: GameState,
  ability: PendingAbilityState,
  playerIds: readonly string[],
  targetIndex: number,
  orderedResolution: boolean
): NonNullable<GameState['activeEffect']> {
  return {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: STEP_ID,
    stepText: 'センターにいるメンバーを、センター以外のメンバーエリアに移動します。',
    awaitingPlayerId: playerIds[targetIndex] ?? ability.controllerId,
    selectableSlots: [...TARGET_SLOTS],
    canSkipSelection: false,
    selectionLabel: '移動先を選択',
    confirmSelectionLabel: 'ポジションチェンジ',
    metadata: {
      orderedResolution,
      playerIds: [...playerIds],
      targetIndex,
    },
  };
}

function createPositionChangePromptFromEffect(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  targetIndex: number
): NonNullable<GameState['activeEffect']> {
  const playerIds = getPlayerIdsFromEffect(effect);
  return {
    ...effect,
    awaitingPlayerId: playerIds[targetIndex] ?? effect.controllerId,
    selectableSlots: [...TARGET_SLOTS],
    metadata: {
      ...effect.metadata,
      playerIds,
      targetIndex,
      sourceStillOnStage: !!getPlayerById(game, effect.controllerId),
    },
  };
}

function consumePendingWithoutPrompt(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function findNextPlayerIndexWithCenter(
  game: GameState,
  playerIds: readonly string[],
  startIndex: number
): number | null {
  for (let index = startIndex; index < playerIds.length; index += 1) {
    const player = getPlayerById(game, playerIds[index]!);
    if (player?.memberSlots.slots[SlotPosition.CENTER]) {
      return index;
    }
  }
  return null;
}

function getOpponentPlayerId(game: GameState, playerId: string): string | null {
  return game.players.find((player) => player.id !== playerId)?.id ?? null;
}

function getPlayerIdsFromEffect(effect: NonNullable<GameState['activeEffect']>): readonly string[] {
  const playerIds = effect.metadata?.playerIds;
  return Array.isArray(playerIds) ? playerIds.filter(isString) : [effect.controllerId];
}

function getTargetIndex(effect: NonNullable<GameState['activeEffect']>): number {
  const value = effect.metadata?.targetIndex;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
