import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { SP_BP7_004_LIVE_START_BOTTOM_THREE_LIELLA_MEMBERS_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  addBladeLiveModifierForMember,
  moveWaitingRoomCardsToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = SP_BP7_004_LIVE_START_BOTTOM_THREE_LIELLA_MEMBERS_GAIN_TWO_BLADE_ABILITY_ID;
const SELECT_STEP_ID = 'SP_BP7_004_SELECT_THREE_LIELLA_MEMBERS_TO_DECK_BOTTOM';
const REQUIRED_COUNT = 3;
const liellaMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));
const noBladeHeartSelector = not(hasBladeHeart());

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp7004SumireWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startSelection(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_STEP_ID, (game, input, context) =>
    finishSelection(
      game,
      input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
      context.continuePendingCardEffects
    )
  );
}

function startSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const candidateCardIds = getCurrentCandidates(game, player.id);
  if (candidateCardIds.length < REQUIRED_COUNT) {
    return finishPendingNoMove(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'INSUFFICIENT_LIELLA_MEMBERS'
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
      stepId: SELECT_STEP_ID,
      stepText: '可以按放置顺序选择自己休息室中的3张『Liella!』成员卡放置于卡组底。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: REQUIRED_COUNT,
      maxSelectableCards: REQUIRED_COUNT,
      selectionLabel: '按放置顺序选择3张『Liella!』成员卡',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
        },
        orderedResolution,
        candidateCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_THREE_LIELLA_MEMBERS_TO_DECK_BOTTOM',
      candidateCardIds,
    },
  });
}

function finishSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const candidateCardIds = getStringArray(effect.metadata?.candidateCardIds);
  if (selectedCardIds.length === 0) {
    return finishEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'DECLINE_BOTTOM_LIELLA_MEMBERS'
    );
  }
  if (
    selectedCardIds.length !== REQUIRED_COUNT ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !candidateCardIds.includes(cardId))
  ) {
    return game;
  }
  const currentCandidateSet = new Set(getCurrentCandidates(game, player.id));
  if (selectedCardIds.some((cardId) => !currentCandidateSet.has(cardId))) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffectNoMove(
          game,
          effect,
          player.id,
          continuePendingCardEffects,
          'STALE_LIELLA_MEMBER_SELECTION',
          selectedCardIds
        )
      : game;
  }
  const moveResult = moveWaitingRoomCardsToDeckBottomForPlayer(
    { ...game, activeEffect: null },
    player.id,
    selectedCardIds,
    { candidateCardIds, minCount: REQUIRED_COUNT, maxCount: REQUIRED_COUNT }
  );
  if (!moveResult || moveResult.movedCardIds.length !== REQUIRED_COUNT) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffectNoMove(
          game,
          effect,
          player.id,
          continuePendingCardEffects,
          'STALE_LIELLA_MEMBER_SELECTION',
          selectedCardIds
        )
      : game;
  }
  const rewardConditionMet = moveResult.movedCardIds.some((cardId) => {
    const card = getCardById(moveResult.gameState, cardId);
    return card !== null && isMemberCardData(card.data) && noBladeHeartSelector(card);
  });
  const bladeResult = rewardConditionMet
    ? addBladeLiveModifierForMember(moveResult.gameState, {
        playerId: player.id,
        memberCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        countDelta: 2,
      })
    : null;
  const resolvedState = bladeResult?.gameState ?? moveResult.gameState;
  return continuePendingCardEffects(
    addAction(resolvedState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'BOTTOM_LIELLA_MEMBERS',
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      rewardConditionMet,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getCurrentCandidates(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player
    ? player.waitingRoom.cardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && card.ownerId === player.id && liellaMemberSelector(card);
      })
    : [];
}

function finishPendingNoMove(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
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
        step,
        movedCardIds: [],
      }
    ),
    orderedResolution
  );
}

function finishEffectNoMove(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  selectedCardIds: readonly string[] = []
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedCardIds,
      movedCardIds: [],
      bladeBonus: 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}
