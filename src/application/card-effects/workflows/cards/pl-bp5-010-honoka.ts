import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const SELECT_DISCARD_STEP_ID = 'BP5_010_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_ARISE_MEMBER_STEP_ID = 'BP5_010_SELECT_ARISE_MEMBER_FROM_WAITING_ROOM';

const ariseMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('A-RISE'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerBp5010HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startBp5010HonokaLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishBp5010HonokaDiscardMillRecover(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishBp5010HonokaWithoutPayment(
            game,
            'DECLINE_DISCARD_COST',
            context.continuePendingCardEffects
          )
  );
  registerActiveEffectStepHandler(
    BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
    SELECT_ARISE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startBp5010HonokaLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  if (!player || sourceSlot === null || player.hand.cardIds.length === 0) {
    return consumePendingWithoutEffect(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      player?.hand.cardIds.length === 0 ? 'NO_HAND_TO_DISCARD' : 'SOURCE_NOT_ON_STAGE',
      { sourceSlot }
    );
  }

  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID
      ),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText:
        '可以将1张手牌放置入休息室。如此做的话，将卡组顶3张放置入休息室，之后回收1张『A-RISE』成员卡。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot,
        topCount: 3,
        effectCosts: [
          {
            kind: 'DISCARD_HAND_TO_WAITING_ROOM',
            minCount: 1,
            maxCount: 1,
            optional: true,
          },
        ],
        handToWaitingRoomCost: {
          minCount: 1,
          maxCount: 1,
          optional: true,
        },
      },
    },
  };
}

function finishBp5010HonokaWithoutPayment(
  game: GameState,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID
  ) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishBp5010HonokaDiscardMillRecover(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
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

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    discardedHandCardIds: discardResult.discardedCardIds,
  });

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    stateAfterCost,
    player.id,
    3,
    enqueueTriggeredCardEffects
  );
  if (!millResult) {
    return game;
  }

  const stateAfterMill = addAction(millResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    step: 'MILL_TOP_THREE',
    discardedHandCardIds: discardResult.discardedCardIds,
    milledCardIds: millResult.movedCardIds,
    refreshCount: millResult.refreshCount,
  });
  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterMill,
    player.id,
    ariseMemberSelector
  );
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterMill, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_ARISE_MEMBER_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
        milledCardIds: millResult.movedCardIds,
        refreshCount: millResult.refreshCount,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...stateAfterMill,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: effect.effectText,
      stepId: SELECT_ARISE_MEMBER_STEP_ID,
      stepText: '请选择自己休息室1张『A-RISE』成员卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        sourceSlot: effect.metadata?.sourceSlot,
        discardedHandCardIds: discardResult.discardedCardIds,
        milledCardIds: millResult.movedCardIds,
        refreshCount: millResult.refreshCount,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function consumePendingWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
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
      step,
      ...payload,
    }),
    orderedResolution
  );
}
