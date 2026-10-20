import {
  calculateTotalHearts,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
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
  type CardSelector,
} from '../../../effects/card-selectors.js';
import {
  HS_PR_043_LIVE_START_BOTTOM_TWO_MEMBERS_HEART_TWELVE_GAIN_BLADE_ABILITY_ID,
  SP_BP7_004_LIVE_START_BOTTOM_THREE_LIELLA_MEMBERS_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

interface Config {
  readonly abilityId: string;
  readonly stepId: string;
  readonly count: number;
  readonly selector: CardSelector;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly rewardCondition: (cards: readonly CardInstance[]) => boolean;
  readonly blade: number;
}
const CONFIGS: readonly Config[] = [
  {
    abilityId: SP_BP7_004_LIVE_START_BOTTOM_THREE_LIELLA_MEMBERS_GAIN_TWO_BLADE_ABILITY_ID,
    stepId: 'SP_BP7_004_SELECT_THREE_LIELLA_MEMBERS_TO_DECK_BOTTOM',
    count: 3,
    selector: and(typeIs(CardType.MEMBER), groupAliasIs('Liella!')),
    stepText: '可以按放置顺序选择自己休息室中的3张『Liella!』成员卡放置于卡组底。',
    selectionLabel: '按放置顺序选择3张『Liella!』成员卡',
    rewardCondition: (cards) => cards.some(not(hasBladeHeart())),
    blade: 2,
  },
  {
    abilityId: HS_PR_043_LIVE_START_BOTTOM_TWO_MEMBERS_HEART_TWELVE_GAIN_BLADE_ABILITY_ID,
    stepId: 'HS_PR_043_SELECT_TWO_MEMBERS_TO_DECK_BOTTOM',
    count: 2,
    selector: typeIs(CardType.MEMBER),
    stepText: '可以按放置顺序选择自己休息室中的2张成员卡放置于卡组底。',
    selectionLabel: '按放置顺序选择2张成员卡',
    rewardCondition: (cards) =>
      cards.reduce(
        (sum, card) => sum + (isMemberCardData(card.data) ? calculateTotalHearts(card.data) : 0),
        0
      ) >= 12,
    blade: 3,
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerOrderedWaitingMembersBottomGainBladeWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startSelection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        config
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.stepId,
      (game, input, context) =>
        finishSelection(
          game,
          input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
          context.continuePendingCardEffects,
          config
        ),
      queryCardSelection
    );
  }
}

function startSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: Config
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const candidateCardIds = getCurrentCandidates(game, player.id, config);
  if (candidateCardIds.length < config.count) {
    return finishPendingNoMove(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'INSUFFICIENT_WAITING_MEMBERS'
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: config.count,
      maxSelectableCards: config.count,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
        },
        orderedResolution,
        candidateCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_ORDERED_WAITING_MEMBERS_TO_DECK_BOTTOM',
      candidateCardIds,
    },
  });
}

function finishSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: Config
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId)
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const candidateCardIds = getStringArray(effect.metadata?.candidateCardIds);
  if (selectedCardIds.length === 0) {
    return finishEffectNoMove(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'DECLINE_BOTTOM_MEMBERS'
    );
  }
  if (
    selectedCardIds.length !== config.count ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !candidateCardIds.includes(cardId))
  ) {
    return game;
  }
  const currentCandidateSet = new Set(getCurrentCandidates(game, player.id, config));
  if (selectedCardIds.some((cardId) => !currentCandidateSet.has(cardId))) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffectNoMove(
          game,
          effect,
          player.id,
          continuePendingCardEffects,
          'STALE_WAITING_MEMBER_SELECTION',
          selectedCardIds
        )
      : game;
  }
  const moveResult = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    player.id,
    selectedCardIds,
    {
      candidateCardIds,
      minCount: config.count,
      maxCount: config.count,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moveResult || moveResult.movedCardIds.length !== config.count) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishEffectNoMove(
          game,
          effect,
          player.id,
          continuePendingCardEffects,
          'STALE_WAITING_MEMBER_SELECTION',
          selectedCardIds
        )
      : game;
  }
  const paidState = recordPayCostAction(moveResult.gameState, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    pendingAbilityId: effect.id,
    costType: 'MOVE_WAITING_ROOM_MEMBERS_TO_DECK_BOTTOM',
    movedCardIds: moveResult.movedCardIds,
    waitingRoomCardsMovedToMainDeckEventId:
      moveResult.waitingRoomCardsMovedToMainDeckEvent?.eventId,
  });
  const movedCards = moveResult.movedCardIds.flatMap((id) => {
    const card = getCardById(moveResult.gameState, id);
    return card ? [card] : [];
  });
  const rewardConditionMet =
    movedCards.length === config.count && config.rewardCondition(movedCards);
  const bladeResult =
    rewardConditionMet && isCurrentStageMemberAbilitySource(paidState, effect)
      ? addBladeLiveModifierForSourceMember(paidState, {
          playerId: player.id,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          amount: config.blade,
        })
      : null;
  const resolvedState = bladeResult?.gameState ?? paidState;
  return continuePendingCardEffects(
    addAction(resolvedState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'BOTTOM_MEMBERS_GAIN_BLADE',
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      rewardConditionMet,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getCurrentCandidates(
  game: GameState,
  playerId: string,
  config: Config
): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player
    ? player.waitingRoom.cardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && card.ownerId === player.id && config.selector(card);
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
