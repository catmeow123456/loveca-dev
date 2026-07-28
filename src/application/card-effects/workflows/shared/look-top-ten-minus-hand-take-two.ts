import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { PR_ON_ENTER_LOOK_TOP_TEN_MINUS_HAND_TAKE_TWO_ABILITY_ID } from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from './look-top-select-to-hand.js';

const SELECT_UP_TO_TWO_STEP_ID = 'PR_SELECT_UP_TO_TWO_FROM_TEN_MINUS_HAND';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLookTopTenMinusHandTakeTwoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PR_ON_ENTER_LOOK_TOP_TEN_MINUS_HAND_TAKE_TWO_ABILITY_ID,
    (game, ability, options, context) =>
      startLookTopTenMinusHandTakeTwo(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PR_ON_ENTER_LOOK_TOP_TEN_MINUS_HAND_TAKE_TWO_ABILITY_ID,
    SELECT_UP_TO_TWO_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
  );
}

function startLookTopTenMinusHandTakeTwo(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const lockedTopCount = Math.max(0, 10 - player.hand.cardIds.length);
  if (lockedTopCount === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'ZERO_CARDS_TO_INSPECT',
        handCountAtResolutionStart: player.hand.cardIds.length,
        requestedInspectCount: 0,
        inspectedCardIds: [],
        selectedCardIds: [],
        waitingRoomCardIds: [],
      }),
      orderedResolution
    );
  }

  return startLookTopSelectToHandWorkflow(
    game,
    ability,
    {
      effectText: getAbilityEffectText(ability.abilityId),
      topCount: lockedTopCount,
      selector: () => true,
      countRule: { minCount: 0, maxCount: Math.min(2, lockedTopCount) },
      revealSelectedBeforeHand: false,
      selectStepId: SELECT_UP_TO_TWO_STEP_ID,
      selectStepText: '请选择至多2张检视到的卡加入手牌。未选择的卡片全部放置入休息室。',
      noTargetStepText: '没有检视到卡片。确认后结束此效果。',
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      skipSelectionLabel: '全部放置入休息室',
      startActionStep: 'START_LOOK_TOP_TEN_MINUS_HAND',
      startActionPayload: {
        handCountAtResolutionStart: player.hand.cardIds.length,
        requestedInspectCount: lockedTopCount,
      },
      finishActionStep: 'TAKE_UP_TO_TWO_REST_TO_WAITING_ROOM',
      noCardsMode: 'open-selection',
      includeInspectedCardIdsInFinishAction: true,
      clampMaxCountToInspectedCount: true,
    },
    {
      orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
    }
  );
}
