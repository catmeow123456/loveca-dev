import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, ZoneType } from '../../../../shared/types/enums.js';
import { drawCardsFromMainDeckToHand } from '../../../effects/draw.js';
import { SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID } from '../../ability-ids.js';
import { revealHandCardForActiveEffect } from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SELECT_HAND_MEMBER_STEP_ID = 'SP_BP7_003_SELECT_HAND_MEMBER_TO_REVEAL';
const REVEAL_HAND_MEMBER_STEP_ID = 'SP_BP7_003_REVEAL_HAND_MEMBER_COST';

export function registerSpBp7003ChisatoWorkflowHandlers(): void {
  registerActivatedAbilityHandler(
    SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
    startSpBp7003ChisatoActivated
  );
  registerActiveEffectStepHandler(
    SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
    SELECT_HAND_MEMBER_STEP_ID,
    (game, input) => revealSelectedHandMember(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
    REVEAL_HAND_MEMBER_STEP_ID,
    (game) => stackRevealedMemberAndDrawTwo(game)
  );
}

function startSpBp7003ChisatoActivated(
  game: GameState,
  playerId: string,
  sourceCardId: string
): GameState {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !isDirectOrRenGrantedActivatedAbilitySource(
      game,
      playerId,
      sourceCardId,
      SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
      ['PL!SP-bp7-003']
    ) ||
    getSourceMemberSlot(game, playerId, sourceCardId) === null
  ) {
    return game;
  }

  const selectableCardIds = getEligibleHandMemberIds(game, playerId);
  if (selectableCardIds.length === 0) return game;

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
        sourceCardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID
        ),
        stepId: SELECT_HAND_MEMBER_STEP_ID,
        stepText: '请选择手牌中1张费用为10或20的成员卡公开，作为此起动能力的费用。',
        awaitingPlayerId: playerId,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: '选择要公开的费用10或20成员卡',
        confirmSelectionLabel: '公开',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID,
      sourceCardId,
      step: 'SELECT_HAND_MEMBER_TO_REVEAL_AS_COST',
    }
  );
}

function revealSelectedHandMember(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID ||
    effect.stepId !== SELECT_HAND_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId) === null ||
    !isEligibleHandMember(game, effect.controllerId, selectedCardId)
  ) {
    return game;
  }

  let state = revealHandCardForActiveEffect(game, {
    effect,
    playerId: effect.controllerId,
    selectedCardId,
    nextStepId: REVEAL_HAND_MEMBER_STEP_ID,
    nextStepText: '已公开费用为10或20的成员卡。将其放置于此成员下方后，抽2张卡。',
    selectableCardIds: [],
    selectableCardVisibility: 'PUBLIC',
    canSkipSelection: false,
    confirmSelectionLabel: '放置于成员下方',
    metadata: {
      revealedHandMemberCardId: selectedCardId,
    },
    actionStep: 'REVEAL_HAND_MEMBER_AS_COST',
    actionPayload: {
      revealedHandMemberCardId: selectedCardId,
    },
  });
  if (state === game) return game;

  state = recordAbilityUseForContext(state, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  return recordPayCostAction(state, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    revealedCardIds: [selectedCardId],
  });
}

function stackRevealedMemberAndDrawTwo(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP7_003_ACTIVATED_REVEAL_COST_TEN_OR_TWENTY_MEMBER_STACK_DRAW_TWO_ABILITY_ID ||
    effect.stepId !== REVEAL_HAND_MEMBER_STEP_ID ||
    typeof effect.metadata?.revealedHandMemberCardId !== 'string'
  ) {
    return game;
  }

  const revealedCardId = effect.metadata.revealedHandMemberCardId;
  const sourceSlot = getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId);
  if (
    sourceSlot === null ||
    effect.revealedCardIds?.includes(revealedCardId) !== true ||
    !isEligibleHandMember(game, effect.controllerId, revealedCardId)
  ) {
    return game;
  }

  const stackResult = stackMemberCardBelowStageMember(game, {
    playerId: effect.controllerId,
    sourceZone: ZoneType.HAND,
    movedCardId: revealedCardId,
    hostCardId: effect.sourceCardId,
    targetSlot: sourceSlot,
  });
  if (!stackResult) return game;

  const drawResult = drawCardsFromMainDeckToHand(stackResult.gameState, effect.controllerId, 2);
  if (!drawResult) return game;

  return addAction(
    {
      ...drawResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'STACK_REVEALED_MEMBER_DRAW_TWO',
      revealedCardId,
      stackedCardId: stackResult.movedCardId,
      drawnCardIds: drawResult.drawnCardIds,
    }
  );
}

function getEligibleHandMemberIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.hand.cardIds.filter((cardId) => isEligibleHandMember(game, playerId, cardId)) ?? []
  );
}

function isEligibleHandMember(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    player?.hand.cardIds.includes(cardId) === true &&
    card?.ownerId === playerId &&
    isMemberCardData(card.data) &&
    (card.data.cost === 10 || card.data.cost === 20)
  );
}
