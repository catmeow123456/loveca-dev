import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import { S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID } from '../../ability-ids.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_REVEALED_CHEER_MEMBER_STEP_ID =
  'S_BP5_019_SELECT_REVEALED_CHEER_MEMBER_TO_HAND';
const MAX_SELECTABLE_MEMBERS = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5019NotAloneNotHitoriWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID,
    (game, ability, options, context) =>
      startSBp5019NotAloneNotHitoriLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID,
    SELECT_REVEALED_CHEER_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSBp5019NotAloneNotHitoriSelection(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startSBp5019NotAloneNotHitoriLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const condition = evaluateSuccessZoneCondition(game, player.id, ability.sourceCardId);
  if (!condition.conditionMet) {
    const state = removePendingAbility(game, ability.id);
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
        ...condition,
      }),
      orderedResolution
    );
  }

  const selectableCardIds = selectRevealedCheerMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    const state = removePendingAbility(game, ability.id);
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_REVEALED_CHEER_MEMBER_TARGET',
        ...condition,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...removePendingAbility(game, ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_REVEALED_CHEER_MEMBER_STEP_ID,
        stepText: '请选择至多2张因声援公开的自己的成员卡加入手牌。也可以选择不加入。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(MAX_SELECTABLE_MEMBERS, selectableCardIds.length),
        selectionLabel: '选择要加入手牌的声援公开成员',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: '不加入',
        metadata: {
          orderedResolution,
          publicCardSelectionConfirmation: {
            source: 'REVEALED_CHEER',
            destination: 'HAND',
          },
          ownSuccessLiveCount: condition.ownSuccessLiveCount,
          opponentSuccessLiveCount: condition.opponentSuccessLiveCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_REVEALED_CHEER_MEMBER',
      selectableCardIds,
      ...condition,
    }
  );
}

function finishSBp5019NotAloneNotHitoriSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP5_019_LIVE_SUCCESS_SUCCESS_ZONE_TWO_REVEALED_CHEER_MEMBER_TO_HAND_ABILITY_ID ||
    effect.stepId !== SELECT_REVEALED_CHEER_MEMBER_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const maxSelectableCards = effect.maxSelectableCards ?? MAX_SELECTABLE_MEMBERS;
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > maxSelectableCards ||
    !uniqueSelectedCardIds.every((cardId) => effect.selectableCardIds?.includes(cardId) === true)
  ) {
    return game;
  }

  if (uniqueSelectedCardIds.length === 0) {
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_REVEALED_CHEER_MEMBER_SELECTION',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const moveResult = moveRevealedCheerCards(game, player.id, uniqueSelectedCardIds, 'HAND');
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...moveResult.gameState,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'MOVE_REVEALED_CHEER_MEMBER_TO_HAND',
        movedCardIds: moveResult.movedCardIds,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function evaluateSuccessZoneCondition(
  game: GameState,
  playerId: string,
  sourceCardId: string
): {
  readonly sourceIsCurrentLive: boolean;
  readonly ownSuccessLiveCount: number;
  readonly opponentSuccessLiveCount: number;
  readonly successZoneConditionMet: boolean;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, playerId);
  const opponent = game.players.find((candidate) => candidate.id !== playerId) ?? null;
  const ownSuccessLiveCount = player?.successZone.cardIds.length ?? 0;
  const opponentSuccessLiveCount = opponent?.successZone.cardIds.length ?? 0;
  const sourceIsCurrentLive = player?.liveZone.cardIds.includes(sourceCardId) === true;
  const successZoneConditionMet = ownSuccessLiveCount >= 2 || opponentSuccessLiveCount >= 2;
  return {
    sourceIsCurrentLive,
    ownSuccessLiveCount,
    opponentSuccessLiveCount,
    successZoneConditionMet,
    conditionMet: sourceIsCurrentLive && successZoneConditionMet,
  };
}

function selectRevealedCheerMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, (card) => isMemberCardData(card.data));
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
