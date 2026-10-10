import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { PL_BP8_017_ON_ENTER_REVEAL_NO_BLADE_HEART_MEMBER_BOTTOM_LOOK_FIVE_MUSE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  revealHandCardForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { moveHandCardToDeckBottomForPlayer } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection, queryConfirmSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

const ABILITY_ID =
  PL_BP8_017_ON_ENTER_REVEAL_NO_BLADE_HEART_MEMBER_BOTTOM_LOOK_FIVE_MUSE_ABILITY_ID;
const REVEAL_HAND_STEP_ID = 'PL_BP8_017_REVEAL_NO_BLADE_HEART_HAND_MEMBER';
const PLACE_BOTTOM_STEP_ID = 'PL_BP8_017_PLACE_REVEALED_MEMBER_BOTTOM';
const SELECT_MUSE_STEP_ID = 'PL_BP8_017_SELECT_INSPECTED_MUSE_CARD';
const REVEAL_MUSE_STEP_ID = 'PL_BP8_017_REVEAL_SELECTED_MUSE_CARD';
const costSelector = and(typeIs(CardType.MEMBER), not(hasBladeHeart()));
const museSelector = groupAliasIs('μ’s');
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp8017HanayoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startRevealCost(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    REVEAL_HAND_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? payRevealCost(game, input.selectedCardId)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    PLACE_BOTTOM_STEP_ID,
    (game, _input, context) =>
      placeBottomAndInspect(
        game,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    queryConfirmSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_MUSE_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        },
        isCurrentMuseSelection
      ),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    REVEAL_MUSE_STEP_ID,
    (game, _input, context) =>
      finishRevealedLookTopSelectToHandWorkflow(
        game,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        },
        isCurrentMuseSelection
      ),
    queryConfirmSelection
  );
}

function startRevealCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && costSelector(card);
  });
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'NO_HAND_MEMBER_WITHOUT_BLADE_HEART',
        }
      ),
      orderedResolution
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
      stepId: REVEAL_HAND_STEP_ID,
      stepText:
        '可以公开手牌中1张不持有BLADE HEART的成员卡以发动。展示结束后将其放置于卡组底，再检视卡组顶5张。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要公开的不持有BLADE HEART的手牌成员卡',
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_REVEAL_HAND_COST',
      selectableCardIds,
    },
  });
}

function payRevealCost(game: GameState, selectedCardId: string): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const card = getCardById(game, selectedCardId);
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== REVEAL_HAND_STEP_ID ||
    !player ||
    !effect.selectableCardIds?.includes(selectedCardId) ||
    !player.hand.cardIds.includes(selectedCardId) ||
    !card ||
    card.ownerId !== player.id ||
    !costSelector(card)
  )
    return game;

  // Only revealing is before the colon. The bottom placement is the following effect.
  const revealed = revealHandCardForActiveEffect(game, {
    effect,
    playerId: player.id,
    selectedCardId,
    nextStepId: PLACE_BOTTOM_STEP_ID,
    nextStepText: '已公开所选成员卡。展示结束后将其放置于卡组底，再检视卡组顶5张。',
    actionStep: 'REVEAL_HAND_MEMBER_AS_COST',
    metadata: { revealedCostCardId: selectedCardId },
    canSkipSelection: false,
    actionPayload: { revealedCardIds: [selectedCardId] },
  });
  return revealed === game
    ? game
    : recordPayCostAction(revealed, player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        revealedCardIds: [selectedCardId],
      });
}

function placeBottomAndInspect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== PLACE_BOTTOM_STEP_ID)
    return game;
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId = effect.metadata?.revealedCostCardId;
  if (!player || typeof selectedCardId !== 'string') return game;
  const card = getCardById(game, selectedCardId);
  const result =
    card?.ownerId === player.id
      ? moveHandCardToDeckBottomForPlayer(game, player.id, selectedCardId, {
          candidateCardIds: [selectedCardId],
        })
      : null;
  // A paid reveal is not undone if the captured card can no longer be moved.
  // Resolve the remaining independent inspection instead of reopening the dwell.
  const state = addAction(
    { ...(result?.gameState ?? game), activeEffect: null },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_REVEALED_MEMBER_TO_DECK_BOTTOM',
      movedCardIds: result ? [result.movedCardId] : [],
    }
  );
  return startLookTopSelectToHandWorkflow(
    state,
    effect,
    {
      effectText: getAbilityEffectText(effect.abilityId),
      topCount: 5,
      selector: museSelector,
      countRule: { minCount: 0, maxCount: 1 },
      revealSelectedBeforeHand: true,
      selectStepId: SELECT_MUSE_STEP_ID,
      revealStepId: REVEAL_MUSE_STEP_ID,
      selectStepText: '可以选择1张检视到的『μ’s』卡片公开并加入手牌；其余卡片放置入休息室。',
      noTargetStepText: '没有可加入手牌的『μ’s』卡片。检视的卡片将全部放置入休息室。',
      selectionLabel: '选择要公开并加入手牌的『μ’s』卡片',
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '全部放置入休息室',
      revealStepText: '已公开所选『μ’s』卡片。展示结束后加入手牌，其余检视牌放置入休息室。',
      noCardsMode: 'open-selection',
      includeInspectedCardIdsInFinishAction: true,
    },
    {
      orderedResolution: effect.metadata?.orderedResolution === true,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
    }
  );
}

function isCurrentMuseSelection(game: GameState, selectedCardIds: readonly string[]): boolean {
  return selectedCardIds.every((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === game.activeEffect?.controllerId && museSelector(card);
  });
}
