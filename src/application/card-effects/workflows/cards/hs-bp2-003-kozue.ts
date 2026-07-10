import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import {
  finishArrangeInspectedDeckTopWorkflow,
  startArrangeInspectedDeckTopWorkflow,
} from '../shared/arrange-inspected-deck-top.js';

const SELECT_DISCARD_STEP_ID = 'HS_BP2_003_SELECT_DISCARD_HAND';
const ARRANGE_TOP_THREE_STEP_ID = 'HS_BP2_003_ARRANGE_TOP_THREE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp2003KozueWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp2003KozueLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsBp2003DiscardHand(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID,
    ARRANGE_TOP_THREE_STEP_ID,
    (game, input, context) =>
      finishArrangeInspectedDeckTopWorkflow(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startHsBp2003KozueLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) === null) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }
  if (player.hand.cardIds.length === 0) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_HAND'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      stepText: '可以将1张手牌放置入休息室。如此做时，检视卡组顶3张。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_HAND',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishHsBp2003DiscardHand(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }
  const stateAfterCost = recordPayCostAction(discardResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });

  return startArrangeInspectedDeckTopWorkflow(
    { ...stateAfterCost, activeEffect: null },
    {
      ability: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
      },
      playerId: player.id,
      effectText: getAbilityEffectText(effect.abilityId),
      inspectCount: 3,
      requestedInspectCount: 3,
      sourceActionLabel: 'LIVE开始',
      discardedCostCardIds: discardResult.discardedCardIds,
      stepId: ARRANGE_TOP_THREE_STEP_ID,
      stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
      selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
      selectMin: 0,
      selectMax: 3,
      selectedDestination: 'MAIN_DECK_TOP',
      unselectedDestination: 'WAITING_ROOM',
      orderedResolution: effect.metadata?.orderedResolution === true,
    },
    continuePendingCardEffects
  );
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
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
      step: 'LIVE_START_DISCARD_ARRANGE_NO_OP',
      reason,
    }),
    orderedResolution
  );
}
