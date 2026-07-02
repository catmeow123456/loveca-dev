import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'SP_BP5_009_REPEAT_MILL_TOP';
const MAX_ITERATIONS = 5;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5009NatsumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffectsForEnterWaitingRoom: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
  readonly enqueueTriggeredCardEffectsForMemberStateChanged: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp5009NatsumiLiveStart(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_009_LIVE_START_REPEAT_MILL_GAIN_BLADE_WAIT_IF_LIVE_ABILITY_ID,
    STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'continue'
        ? finishSpBp5009NatsumiIteration(
            game,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffectsForEnterWaitingRoom,
            deps.enqueueTriggeredCardEffectsForMemberStateChanged
          )
        : finishSpBp5009NatsumiDecline(game, context.continuePendingCardEffects)
  );
}

function startSpBp5009NatsumiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  if (!canOpenRepeatPrompt(game, ability.controllerId, ability.sourceCardId)) {
    return consumePendingWithoutPrompt(game, ability, options.orderedResolution === true, {
      step: 'NO_OP_REPEAT_MILL_TOP',
      reason: getNoPromptReason(game, ability.controllerId, ability.sourceCardId),
      refreshCount: 0,
    }, continuePendingCardEffects);
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: createRepeatPrompt(game, ability, 0, options.orderedResolution === true),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_REPEAT_MILL_TOP',
      iteration: 0,
      maxIterations: MAX_ITERATIONS,
    },
  });
}

function finishSpBp5009NatsumiDecline(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'REPEAT_MILL_TOP_DECLINED',
        iteration: getIteration(effect),
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishSpBp5009NatsumiIteration(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueEnterWaitingRoomTriggers: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  enqueueMemberStateChangedTriggers: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const iteration = getIteration(effect);
  if (!canProcessIteration(game, player.id, effect.sourceCardId, iteration)) {
    return finishNoOpActiveEffect(game, continuePendingCardEffects, {
      step: 'REPEAT_MILL_TOP_NO_OP',
      iteration,
      reason: getNoPromptReason(game, player.id, effect.sourceCardId),
      refreshCount: 0,
    });
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    1,
    enqueueEnterWaitingRoomTriggers
  );
  const milledCardId = millResult?.movedCardIds[0] ?? null;
  if (!millResult || !milledCardId) {
    return finishNoOpActiveEffect(game, continuePendingCardEffects, {
      step: 'REPEAT_MILL_TOP_NO_OP',
      iteration,
      reason: 'NO_REFRESHABLE_TOP_CARD',
      refreshCount: millResult?.refreshCount ?? 0,
    });
  }

  let state = millResult.gameState;
  const milledCard = getCardById(state, milledCardId);
  const milledLiveCard = !!milledCard && isLiveCardData(milledCard.data);
  const bladeResult = addBladeLiveModifierForSourceMember(state, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }
  state = bladeResult.gameState;

  if (milledLiveCard) {
    const waitResult = setMemberOrientation(
      state,
      player.id,
      effect.sourceCardId,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      }
    );
    if (!waitResult) {
      return finishNoOpActiveEffect(state, continuePendingCardEffects, {
        step: 'REPEAT_MILL_TOP_WAIT_SOURCE_FAILED',
        iteration,
        milledCardId,
        milledLiveCard,
        bladeBonus: 1,
        refreshCount: millResult.refreshCount,
      });
    }

    const prepared = enqueueMemberStateChangedTriggersFromOrientationResult(
      state,
      waitResult,
      enqueueMemberStateChangedTriggers,
      {}
    );
    state = prepared.gameState;
  }

  const nextIteration = iteration + 1;
  const shouldContinue =
    nextIteration < MAX_ITERATIONS &&
    canOpenRepeatPrompt(state, player.id, effect.sourceCardId);
  const stateWithAction = addAction(
    {
      ...state,
      activeEffect: shouldContinue
        ? createRepeatPromptFromEffect(state, effect, nextIteration, millResult.refreshCount)
        : null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: shouldContinue
        ? milledLiveCard
          ? 'REPEAT_MILL_TOP_GAIN_BLADE_WAIT_SOURCE_CONTINUE_PROMPT'
          : 'REPEAT_MILL_TOP_CONTINUE_PROMPT'
        : 'REPEAT_MILL_TOP_COMPLETE',
      iteration,
      nextIteration,
      milledCardId,
      milledLiveCard,
      bladeBonus: 1,
      refreshCount: millResult.refreshCount,
    }
  );

  return shouldContinue
    ? stateWithAction
    : continuePendingCardEffects(stateWithAction, effect.metadata?.orderedResolution === true);
}

function createRepeatPrompt(
  game: GameState,
  ability: PendingAbilityState,
  iteration: number,
  orderedResolution: boolean
): NonNullable<GameState['activeEffect']> {
  return {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: STEP_ID,
    stepText: `要将自己卡组顶的卡片放置入休息室并获得[BLADE]吗？ (${iteration + 1}/${MAX_ITERATIONS})`,
    awaitingPlayerId: ability.controllerId,
    selectableOptions: [
      { id: 'continue', label: '放置入休息室' },
      { id: 'decline', label: '不放置' },
    ],
    metadata: {
      orderedResolution,
      iteration,
      refreshCount: 0,
      sourceSlot: findMemberSlot(getPlayerById(game, ability.controllerId)!, ability.sourceCardId),
    },
  };
}

function createRepeatPromptFromEffect(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  iteration: number,
  refreshCount: number
): NonNullable<GameState['activeEffect']> {
  return {
    ...effect,
    stepText: `要将自己卡组顶的卡片放置入休息室并获得[BLADE]吗？ (${iteration + 1}/${MAX_ITERATIONS})`,
    selectableOptions: [
      { id: 'continue', label: '放置入休息室' },
      { id: 'decline', label: '不放置' },
    ],
    metadata: {
      ...effect.metadata,
      iteration,
      refreshCount,
      sourceSlot: findMemberSlot(getPlayerById(game, effect.controllerId)!, effect.sourceCardId),
    },
  };
}

function canProcessIteration(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  iteration: number
): boolean {
  return iteration < MAX_ITERATIONS && canOpenRepeatPrompt(game, playerId, sourceCardId);
}

function canOpenRepeatPrompt(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceSlot = player ? findMemberSlot(player, sourceCardId) : null;
  return !!(
    player &&
    sourceSlot !== null &&
    (player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0)
  );
}

function getNoPromptReason(game: GameState, playerId: string, sourceCardId: string): string {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 'MISSING_PLAYER';
  }
  const sourceSlot = findMemberSlot(player, sourceCardId);
  if (sourceSlot === null) {
    return 'SOURCE_NOT_ON_STAGE';
  }
  if (player.mainDeck.cardIds.length === 0 && player.waitingRoom.cardIds.length === 0) {
    return 'NO_REFRESHABLE_TOP_CARD';
  }
  return 'UNKNOWN';
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

function finishNoOpActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function getIteration(effect: NonNullable<GameState['activeEffect']>): number {
  const value = effect.metadata?.iteration;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
