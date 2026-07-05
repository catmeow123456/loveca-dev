import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  getCardGroupIdentityKeys,
  hasAtLeastDifferentNamedCards,
} from '../../../../shared/utils/card-identity.js';
import { N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_MODE_STEP_ID = 'N_BP5_011_SELECT_DISTINCT_LIVE_RECOVERY_MODE';
const SELECT_RECOVERY_STEP_ID = 'N_BP5_011_SELECT_WAITING_ROOM_LIVE_TO_HAND';
const NAME_MODE_OPTION_ID = 'recover-one-different-name-live';
const GROUP_MODE_OPTION_ID = 'recover-two-different-group-live';
const DISTINCT_LIVE_THRESHOLD = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5011MiaTaylorWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
    (game, ability, options, context) =>
      startMiaDistinctLiveRecovery(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
    SELECT_MODE_STEP_ID,
    (game, input) => startMiaRecoverySelection(game, input.selectedOptionId ?? null)
  );
  registerActiveEffectStepHandler(
    N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
    SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishMiaLiveRecovery(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startMiaDistinctLiveRecovery(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (
    !player ||
    !sourceCard ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp5-011') ||
    sourceSlot === null
  ) {
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      'SOURCE_NOT_ON_STAGE',
      continuePendingCardEffects
    );
  }

  const waitingLiveCardIds = getWaitingRoomLiveCardIds(game, player.id);
  const selectableOptions = getAvailableRecoveryModeOptions(game, waitingLiveCardIds);
  if (selectableOptions.length === 0) {
    return skipPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_DISTINCT_LIVE_RECOVERY_MODE',
      continuePendingCardEffects,
      {
        waitingLiveCardIds,
        distinctNameConditionMet: false,
        distinctGroupConditionMet: false,
      }
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
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_MODE_STEP_ID,
      stepText: '请选择1个满足条件的回收模式。',
      awaitingPlayerId: player.id,
      selectableOptions,
      canSkipSelection: false,
      confirmSelectionLabel: '选择模式',
      metadata: {
        orderedResolution,
        sourceSlot,
        waitingLiveCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_CHOOSE_DISTINCT_LIVE_RECOVERY_MODE',
      selectableOptionIds: selectableOptions.map((option) => option.id),
      waitingLiveCardIds,
    },
  });
}

function startMiaRecoverySelection(game: GameState, selectedOptionId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID ||
    effect.stepId !== SELECT_MODE_STEP_ID ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingLiveCardIds = getWaitingRoomLiveCardIds(game, player.id);
  const recoveryCount = selectedOptionId === GROUP_MODE_OPTION_ID ? 2 : 1;
  if (
    recoveryCount > waitingLiveCardIds.length ||
    getAvailableRecoveryModeOptions(game, waitingLiveCardIds).some(
      (option) => option.id === selectedOptionId
    ) !== true
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_RECOVERY_STEP_ID,
        stepText:
          recoveryCount === 1
            ? '请选择自己休息室中1张LIVE卡加入手牌。'
            : '请选择自己休息室中2张LIVE卡加入手牌。',
        selectableCardIds: waitingLiveCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: recoveryCount === 1 ? 'SINGLE' : 'ORDERED_MULTI',
        minSelectableCards: recoveryCount,
        maxSelectableCards: recoveryCount,
        selectableOptions: undefined,
        selectionLabel: '选择加入手牌的LIVE',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedMode: selectedOptionId,
          recoveryCount,
          recoveryCandidateCardIds: waitingLiveCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_DISTINCT_LIVE_RECOVERY_MODE',
      selectedMode: selectedOptionId,
      recoveryCount,
      selectableCardIds: waitingLiveCardIds,
    }
  );
}

function finishMiaLiveRecovery(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID ||
    effect.stepId !== SELECT_RECOVERY_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const recoveryCount = getNumberMetadata(effect, 'recoveryCount');
  if (!player || recoveryCount <= 0) {
    return game;
  }

  const selectedIds =
    recoveryCount === 1
      ? selectedCardId
        ? [selectedCardId]
        : selectedCardIds ?? []
      : selectedCardIds ?? [];
  if (
    selectedIds.length !== recoveryCount ||
    new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some((cardId) => effect.selectableCardIds?.includes(cardId) !== true)
  ) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    selectedIds,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: recoveryCount,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_DISTINCT_LIVE_FROM_WAITING_ROOM',
      selectedMode: effect.metadata?.selectedMode,
      recoveryCount,
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>> = {}
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
      ...payload,
    }),
    orderedResolution
  );
}

function getAvailableRecoveryModeOptions(
  game: GameState,
  waitingLiveCardIds: readonly string[]
): readonly { readonly id: string; readonly label: string }[] {
  const options: { readonly id: string; readonly label: string }[] = [];
  if (hasDistinctLiveCardNames(game, waitingLiveCardIds)) {
    options.push({ id: NAME_MODE_OPTION_ID, label: '卡名不同LIVE 3张以上：回收1张LIVE' });
  }
  if (hasDistinctLiveCardGroups(game, waitingLiveCardIds)) {
    options.push({ id: GROUP_MODE_OPTION_ID, label: '团体名不同LIVE 3张以上：回收2张LIVE' });
  }
  return options;
}

function hasDistinctLiveCardNames(game: GameState, waitingLiveCardIds: readonly string[]): boolean {
  return hasAtLeastDifferentNamedCards(
    waitingLiveCardIds,
    DISTINCT_LIVE_THRESHOLD,
    (cardId) => getCardById(game, cardId)?.data ?? null,
    { getSecondaryKey: (cardId) => cardId }
  );
}

function hasDistinctLiveCardGroups(game: GameState, waitingLiveCardIds: readonly string[]): boolean {
  const groupOptions = waitingLiveCardIds.map((cardId) => {
    const card = getCardById(game, cardId);
    return card && isLiveCardData(card.data) ? getCardGroupIdentityKeys(card.data) : [];
  });
  return canAssignDistinctGroups(groupOptions, DISTINCT_LIVE_THRESHOLD, 0, new Set());
}

function canAssignDistinctGroups(
  groupOptions: readonly (readonly string[])[],
  remainingCount: number,
  startIndex: number,
  assignedGroups: Set<string>
): boolean {
  if (remainingCount === 0) {
    return true;
  }
  if (groupOptions.length - startIndex < remainingCount) {
    return false;
  }
  for (let index = startIndex; index < groupOptions.length; index += 1) {
    for (const groupKey of groupOptions[index] ?? []) {
      if (assignedGroups.has(groupKey)) {
        continue;
      }
      assignedGroups.add(groupKey);
      if (canAssignDistinctGroups(groupOptions, remainingCount - 1, index + 1, assignedGroups)) {
        return true;
      }
      assignedGroups.delete(groupKey);
    }
  }
  return false;
}

function getWaitingRoomLiveCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
}

function getNumberMetadata(
  effect: NonNullable<GameState['activeEffect']>,
  key: string
): number {
  const value = effect.metadata?.[key];
  return typeof value === 'number' ? value : 0;
}
