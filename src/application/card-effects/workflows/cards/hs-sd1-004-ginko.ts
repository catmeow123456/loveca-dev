import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const HS_SD1_004_SELECT_DISCARD_STEP_ID = 'HS_SD1_004_SELECT_HASUNOSORA_HAND_DISCARD';
const HS_SD1_004_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'HS_SD1_004_SELECT_WAITING_ROOM_MEMBER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsSd1004GinkoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1004OnEnterDiscardHasunosora(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID,
    HS_SD1_004_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHsSd1004DiscardCost(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID,
    HS_SD1_004_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsSd1004OnEnterDiscardHasunosora(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const discardCandidateIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && groupAliasIs('蓮ノ空')(card);
  });
  if (discardCandidateIds.length === 0) {
    return finishWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'NO_HASUNOSORA_HAND_CARD'
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
      effectText: getAbilityEffectText(
        HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID
      ),
      stepId: HS_SD1_004_SELECT_DISCARD_STEP_ID,
      stepText: '可以将1张手牌中的「莲之空」卡片放置入休息室，之后回收1张成员卡。',
      awaitingPlayerId: player.id,
      selectableCardIds: discardCandidateIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的莲之空手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution === true,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HASUNOSORA_HAND_DISCARD',
      selectableCardIds: discardCandidateIds,
    },
  });
}

function finishHsSd1004DiscardCost(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_SD1_004_ON_ENTER_DISCARD_HASUNOSORA_RECOVER_MEMBER_ABILITY_ID ||
    effect.stepId !== HS_SD1_004_SELECT_DISCARD_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (!player) {
    return game;
  }
  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_DISCARD_COST',
      }),
      orderedResolution
    );
  }
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    [selectedCardId],
    {
      count: 1,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const selectableMemberCardIds = selectWaitingRoomCardIds(
    discardResult.gameState,
    player.id,
    and(typeIs(CardType.MEMBER), (card) => isMemberCardData(card.data))
  );
  const stateWithCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
    selectableCardIds: selectableMemberCardIds,
  });

  if (selectableMemberCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateWithCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_COST_NO_MEMBER_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      orderedResolution
    );
  }

  return {
    ...stateWithCost,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: effect.effectText,
      stepId: HS_SD1_004_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      stepText: '请选择自己的休息室中1张成员卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: selectableMemberCardIds,
      metadata: {
        orderedResolution,
        discardedHandCardIds: discardResult.discardedCardIds,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function finishWithoutEffect(
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
      step: 'CHECK_DISCARD_COST',
      conditionMet: false,
      reason,
    }),
    orderedResolution
  );
}
