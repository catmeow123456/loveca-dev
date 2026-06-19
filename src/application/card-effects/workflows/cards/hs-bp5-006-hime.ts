import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { getKnownCardGroupIdentityName } from '../../../../shared/utils/card-identity.js';
import { HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { discardHandCardsToWaitingRoomForPlayer } from '../../runtime/actions.js';
import {
  enqueueEnterWaitingRoomTriggersFromDiscardResult,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_BP5_006_SELECT_DISCARD_STEP_ID = 'HS_BP5_006_SELECT_SAME_GROUP_HAND_CARDS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp5006HimeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp5006HimeLiveStartDiscard(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID,
    HS_BP5_006_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardIds
        ? finishHsBp5006HimeDiscard(
            game,
            input.selectedCardIds,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsBp5006HimeLiveStartDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getSameGroupPairCandidateIds(game, player.hand.cardIds);
  if (selectableCardIds.length < 2) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_SAME_GROUP_HAND_PAIR',
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
      effectText: getAbilityEffectText(
        HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID
      ),
      stepId: HS_BP5_006_SELECT_DISCARD_STEP_ID,
      stepText: '可以选择2张持有相同团体名的手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '选择同团体名手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_SAME_GROUP_HAND_CARDS',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
    },
  });
}

function finishHsBp5006HimeDiscard(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedGroupName = getSharedGroupName(game, uniqueSelectedCardIds);
  if (
    !effect ||
    effect.abilityId !== HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID ||
    effect.stepId !== HS_BP5_006_SELECT_DISCARD_STEP_ID ||
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== 2 ||
    selectedGroupName === null ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: 2,
      candidateCardIds: effect.selectableCardIds ?? [],
    }
  );
  if (!discardResult) {
    return game;
  }
  const stateWithEnterWaitingRoomTriggers = enqueueEnterWaitingRoomTriggersFromDiscardResult(
    discardResult.gameState,
    discardResult,
    enqueueTriggeredCardEffects
  );

  const hearts = [{ color: HeartColor.PINK, count: 2 }];
  const modifierResult = addHeartLiveModifierForMember(
    { ...stateWithEnterWaitingRoomTriggers, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts,
    }
  );
  if (!modifierResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(modifierResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_SAME_GROUP_HAND_CARDS_GAIN_SOURCE_HEART',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardIds: discardResult.discardedCardIds,
      discardedGroupName: selectedGroupName,
      heartBonus: hearts,
    }),
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

function getSameGroupPairCandidateIds(
  game: GameState,
  candidateCardIds: readonly string[]
): readonly string[] {
  const groupCounts = new Map<string, number>();
  for (const cardId of candidateCardIds) {
    const groupName = getCardGroupName(game, cardId);
    if (groupName) {
      groupCounts.set(groupName, (groupCounts.get(groupName) ?? 0) + 1);
    }
  }

  return candidateCardIds.filter((cardId) => {
    const groupName = getCardGroupName(game, cardId);
    return groupName !== null && (groupCounts.get(groupName) ?? 0) >= 2;
  });
}

function getSharedGroupName(game: GameState, cardIds: readonly string[]): string | null {
  const groupNames = cardIds.map((cardId) => getCardGroupName(game, cardId));
  const firstGroupName = groupNames[0] ?? null;
  if (!firstGroupName || groupNames.some((groupName) => groupName !== firstGroupName)) {
    return null;
  }
  return firstGroupName;
}

function getCardGroupName(game: GameState, cardId: string): string | null {
  const card = getCardById(game, cardId);
  return card ? getKnownCardGroupIdentityName(card.data) : null;
}
