import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  moveWaitingRoomCardsToDeckTopForPlayer,
} from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_MEMBER_STEP_ID = 'S_BP3_021_SELECT_WAITING_MEMBER_TO_DECK_TOP';
const SELECT_STAGE_MEMBER_STEP_ID = 'S_BP3_021_SELECT_STAGE_MEMBER_GAIN_BLADE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp3021OmoiYoHitotsuNiNareWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID,
    SELECT_WAITING_MEMBER_STEP_ID,
    (game, input, context) =>
      finishWaitingMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID,
    SELECT_STAGE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishStageMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  if (!player.liveZone.cardIds.includes(ability.sourceCardId)) {
    return finishPending(
      game,
      ability,
      orderedResolution,
      'SOURCE_LIVE_NOT_CURRENT',
      continuePendingCardEffects
    );
  }
  const selectableCardIds = selectWaitingRoomMemberIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return finishPending(
      game,
      ability,
      orderedResolution,
      'NO_WAITING_ROOM_MEMBER',
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
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_WAITING_MEMBER_STEP_ID,
      stepText: '可以从自己的休息室选择1张成员卡放置于卡组顶。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择放置于卡组顶的成员卡',
      confirmSelectionLabel: '放置于卡组顶',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_TOP',
          ordered: false,
          sourcePlayerId: player.id,
        },
        orderedResolution,
        sourceZone: ZoneType.WAITING_ROOM,
        destination: ZoneType.MAIN_DECK,
      },
    },
    actionPayload: { step: 'START_SELECT_WAITING_ROOM_MEMBER', selectableCardIds },
  });
}

function finishWaitingMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_MEMBER_STEP_ID
  )
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (!player.liveZone.cardIds.includes(effect.sourceCardId)) {
    return finishActive(game, effect, 'SOURCE_LIVE_NOT_CURRENT', continuePendingCardEffects);
  }
  if (selectedCardId === null) {
    return finishActive(game, effect, 'DECLINE_WAITING_ROOM_MEMBER', continuePendingCardEffects);
  }
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) return game;
  const currentCandidates = selectWaitingRoomMemberIds(game, player.id).filter((cardId) =>
    effect.selectableCardIds?.includes(cardId)
  );
  if (!currentCandidates.includes(selectedCardId)) {
    return finishActive(game, effect, 'WAITING_ROOM_MEMBER_STALE', continuePendingCardEffects);
  }
  const moveResult = moveWaitingRoomCardsToDeckTopForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: currentCandidates,
    minCount: 1,
    maxCount: 1,
  });
  if (!moveResult || moveResult.movedCardIds.length !== 1) {
    return finishActive(
      game,
      effect,
      'WAITING_ROOM_MEMBER_MOVE_FAILED',
      continuePendingCardEffects
    );
  }
  const stageMemberIds = selectOwnStageMemberIds(moveResult.gameState, player.id);
  if (stageMemberIds.length === 0) {
    return finishActive(
      moveResult.gameState,
      effect,
      'MOVED_WAITING_MEMBER_NO_STAGE_TARGET',
      continuePendingCardEffects,
      { movedCardIds: moveResult.movedCardIds }
    );
  }
  return {
    ...moveResult.gameState,
    activeEffect: {
      ...effect,
      stepId: SELECT_STAGE_MEMBER_STEP_ID,
      stepText: '请选择自己舞台上1名成员，使其获得[BLADE]。',
      selectableCardIds: stageMemberIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择获得[BLADE]的成员',
      confirmSelectionLabel: '获得[BLADE]',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      selectableOptions: undefined,
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        movedWaitingRoomCardIds: moveResult.movedCardIds,
      },
    },
  };
}

function finishStageMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP3_021_LIVE_START_WAITING_MEMBER_TO_DECK_TOP_GRANT_STAGE_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_STAGE_MEMBER_STEP_ID
  )
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (!player.liveZone.cardIds.includes(effect.sourceCardId)) {
    return finishActive(game, effect, 'SOURCE_LIVE_STALE_BEFORE_BLADE', continuePendingCardEffects);
  }
  if (!selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) return game;
  if (!selectOwnStageMemberIds(game, player.id).includes(selectedCardId)) {
    return finishActive(game, effect, 'STAGE_MEMBER_STALE', continuePendingCardEffects);
  }
  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult)
    return finishActive(game, effect, 'BLADE_TARGET_INVALID', continuePendingCardEffects);
  return finishActive(
    bladeResult.gameState,
    effect,
    'GRANT_STAGE_MEMBER_BLADE',
    continuePendingCardEffects,
    {
      targetCardId: selectedCardId,
      bladeBonus: 1,
      movedCardIds: effect.metadata?.movedWaitingRoomCardIds,
    }
  );
}

function selectWaitingRoomMemberIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  return player
    ? player.waitingRoom.cardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card?.ownerId === playerId && typeIs(CardType.MEMBER)(card);
      })
    : [];
}

function selectOwnStageMemberIds(game: GameState, playerId: string): string[] {
  return getStageMemberCardIdsMatching(game, playerId, (card) => isMemberCardData(card.data));
}

function finishPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
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
    }),
    orderedResolution
  );
}

function finishActive(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Record<string, unknown> = {}
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
