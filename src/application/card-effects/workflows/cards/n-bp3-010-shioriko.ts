import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { moveWaitingRoomCardsToDeckBottomForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_PLAYER_STEP_ID = 'PL_N_BP3_010_SELECT_PLAYER';
const SELECT_WAITING_MEMBERS_STEP_ID = 'PL_N_BP3_010_SELECT_WAITING_MEMBERS';
const MAX_WAITING_MEMBERS = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3010ShiorikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID,
    (game, ability, options) =>
      startSelectTargetPlayer(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID,
    SELECT_PLAYER_STEP_ID,
    (game, input) => startSelectWaitingMembers(game, input.selectedOptionId ?? null)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID,
    SELECT_WAITING_MEMBERS_STEP_ID,
    (game, input, context) =>
      finishSelectWaitingMembers(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startSelectTargetPlayer(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
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
        PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID
      ),
      stepId: SELECT_PLAYER_STEP_ID,
      stepText: '请选择要处理休息室的玩家。',
      awaitingPlayerId: player.id,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      selectableOptions: [
        { id: player.id, label: '自己' },
        { id: opponent.id, label: '对方' },
      ],
      canSkipSelection: false,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TARGET_PLAYER',
      selectablePlayerIds: [player.id, opponent.id],
    },
  });
}

function startSelectWaitingMembers(game: GameState, selectedOptionId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID ||
    effect.stepId !== SELECT_PLAYER_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const targetPlayer =
    selectedOptionId === player?.id
      ? player
      : selectedOptionId === opponent?.id
        ? opponent
        : null;
  if (!player || !targetPlayer) {
    return game;
  }

  const candidateCardIds = targetPlayer.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMemberCardData(card.data);
  });

  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_WAITING_MEMBERS_STEP_ID,
      stepText:
        '请选择该玩家休息室中至多2张成员卡。选择顺序会成为放置到卡组底的顺序。',
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      selectableOptions: undefined,
      minSelectableCards: 0,
      maxSelectableCards: MAX_WAITING_MEMBERS,
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      metadata: {
        ...effect.metadata,
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
          sourcePlayerId: targetPlayer.id,
        },
        targetPlayerId: targetPlayer.id,
        candidateCardIds,
      },
    },
  };
}

function finishSelectWaitingMembers(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP3_010_LIVE_START_SELECT_PLAYER_BOTTOM_WAITING_MEMBERS_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_MEMBERS_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId = getTargetPlayerId(effect.metadata);
  const candidateCardIds = getCandidateCardIds(effect.metadata);
  if (!player || targetPlayerId === null) {
    return game;
  }

  const moveResult = moveWaitingRoomCardsToDeckBottomForPlayer(
    { ...game, activeEffect: null },
    targetPlayerId,
    selectedCardIds,
    {
      candidateCardIds,
      minCount: 0,
      maxCount: MAX_WAITING_MEMBERS,
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(moveResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_WAITING_MEMBERS_TO_DECK_BOTTOM',
      targetPlayerId,
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      remainingCandidateIds: moveResult.remainingCandidateIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getTargetPlayerId(metadata: Readonly<Record<string, unknown>> | undefined): string | null {
  return typeof metadata?.targetPlayerId === 'string' ? metadata.targetPlayerId : null;
}

function getCandidateCardIds(
  metadata: Readonly<Record<string, unknown>> | undefined
): readonly string[] {
  if (!Array.isArray(metadata?.candidateCardIds)) {
    return [];
  }
  return metadata.candidateCardIds.filter((cardId): cardId is string => typeof cardId === 'string');
}
