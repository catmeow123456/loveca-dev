import type { CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  hasBladeHeart,
  not,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const SELECT_DISCARD_STEP_ID = 'PL_S_BP5_003_SELECT_NO_BLADE_HEART_MEMBERS';
const SELECT_RECOVERY_STEP_ID = 'PL_S_BP5_003_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM';
const MAX_DISCARD_COUNT = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const noBladeHeartMember = and(typeIs(CardType.MEMBER), not(hasBladeHeart()));
const aqoursLive = and(typeIs(CardType.LIVE), groupAliasIs('Aqours'));

export function registerSBp5003KananWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startDiscardMembersRecoverAqoursLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDiscardMembersStartRecovery(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID,
    SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startDiscardMembersRecoverAqoursLive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (getSourceMemberSlot(game, player.id, ability.sourceCardId) === null) {
    return finishPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
    });
  }

  const eligibleHandCardIds = getEligibleHandCardIds(game, player.id);
  const recoveryCandidateIds = getRecoveryCandidateIds(game, player.id);
  const maxDiscardCount = Math.min(
    MAX_DISCARD_COUNT,
    eligibleHandCardIds.length,
    recoveryCandidateIds.length
  );
  const selectableCardIds = maxDiscardCount > 0 ? eligibleHandCardIds : [];
  const hasSelectableCards = selectableCardIds.length > 0;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: hasSelectableCards
        ? '请选择至多2张手牌中不持有BLADE HEART的成员卡放置入休息室。也可以选择不发动。'
        : '没有可放置入休息室并回收的组合。可以不发动。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: maxDiscardCount > 1 ? 'ORDERED_MULTI' : 'SINGLE',
      minSelectableCards: maxDiscardCount > 1 ? 0 : undefined,
      maxSelectableCards: maxDiscardCount > 1 ? maxDiscardCount : undefined,
      selectionLabel: '选择要放置入休息室的成员卡',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        maxDiscardCount,
        recoveryStepId: SELECT_RECOVERY_STEP_ID,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NO_BLADE_HEART_MEMBERS',
      selectableCardIds,
      recoveryCandidateIds,
      maxDiscardCount,
    },
  });
}

function finishDiscardMembersStartRecovery(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  const selectedCardIdsList = getSelectedCardIds(selectedCardId, selectedCardIds);
  if (selectedCardIdsList.length === 0) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'SKIP_DISCARD_RECOVER_AQOURS_LIVE',
      selectedCardIds: [],
    });
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIdsList)];
  const maxDiscardCount =
    typeof effect.metadata?.maxDiscardCount === 'number'
      ? Math.floor(effect.metadata.maxDiscardCount)
      : 0;
  const currentEligibleHandCardIds = getEligibleHandCardIds(game, player.id);
  const currentRecoveryCandidateIds = getRecoveryCandidateIds(game, player.id);
  if (
    uniqueSelectedCardIds.length !== selectedCardIdsList.length ||
    uniqueSelectedCardIds.length > maxDiscardCount ||
    uniqueSelectedCardIds.length > currentRecoveryCandidateIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true ||
        !currentEligibleHandCardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: uniqueSelectedCardIds.length,
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
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const selectableCardIds = getRecoveryCandidateIds(stateAfterCost, player.id);
  if (selectableCardIds.length < discardResult.discardedCardIds.length) {
    return game;
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_RECOVERY_STEP_ID,
        stepText: `请选择自己的休息室中${discardResult.discardedCardIds.length}张『Aqours』LIVE卡加入手牌。`,
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          discardedHandCardIds: discardResult.discardedCardIds,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: discardResult.discardedCardIds.length,
          maxCount: discardResult.discardedCardIds.length,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_MEMBERS_SELECT_AQOURS_LIVE',
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = getActiveEffect(game);
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
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
      playerId,
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

function getSelectedCardIds(
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined
): readonly string[] {
  if (selectedCardIds && selectedCardIds.length > 0) {
    return selectedCardIds;
  }
  return selectedCardId ? [selectedCardId] : [];
}

function getEligibleHandCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && noBladeHeartMember(card);
  });
}

function getRecoveryCandidateIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, (card: CardInstance) => aqoursLive(card));
}

function getActiveEffect(game: GameState): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID
  ) {
    return null;
  }
  return effect;
}
