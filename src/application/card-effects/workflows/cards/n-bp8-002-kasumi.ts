import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { GamePhase, HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_BP8_002_ACTIVATED_WAITING_ROOM_PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const ABILITY_ID =
  N_BP8_002_ACTIVATED_WAITING_ROOM_PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART_ABILITY_ID;
const BASE_CARD_CODE = 'PL!N-bp8-002';
const SELECT_TARGET_STEP_ID = 'N_BP8_002_SELECT_NIJIGASAKI_MEMBER_TARGET';
const nijigasakiMember = groupAliasIs('虹ヶ咲');

export function registerNBp8002KasumiWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY_ID, startActivatedAbility);
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_TARGET_STEP_ID, (game, input, context) =>
    finishActivatedAbility(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startActivatedAbility(game: GameState, playerId: string, cardId: string): GameState {
  const player = getPlayerById(game, playerId);
  const targetMemberCardIds = getCurrentTargets(game, playerId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !isValidSourceInWaitingRoom(game, playerId, cardId) ||
    getActiveEnergyCardIds(game, playerId).length < 1 ||
    targetMemberCardIds.length === 0
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: SELECT_TARGET_STEP_ID,
        stepText: '请选择自己舞台上的1名『虹咲』成员；确认后支付[E]并将此卡放置于卡组底。',
        awaitingPlayerId: playerId,
        selectableCardIds: targetMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择获得[黄ハート]的『虹咲』成员',
        confirmSelectionLabel: '支付费用并获得[黄ハート]',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_SELECT_NIJIGASAKI_MEMBER_TARGET',
      selectableCardIds: targetMemberCardIds,
      activeEnergyCardIds: getActiveEnergyCardIds(game, playerId),
    }
  );
}

function finishActivatedAbility(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_TARGET_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !isValidSourceInWaitingRoom(game, player.id, effect.sourceCardId) ||
    !getCurrentTargets(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!payment) {
    return game;
  }
  const move = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    payment.gameState,
    player.id,
    [effect.sourceCardId],
    {
      candidateCardIds: [effect.sourceCardId],
      minCount: 1,
      maxCount: 1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
      },
    }
  );
  if (!move) {
    return game;
  }
  const stateAfterCost = recordPayCostAction(move.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
    movedCardIds: move.movedCardIds,
    destination: 'MAIN_DECK_BOTTOM',
  });
  const heart = addHeartLiveModifierForMember(stateAfterCost, {
    playerId: player.id,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: HeartColor.YELLOW, count: 1 }],
  });
  if (!heart) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heart.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART',
      paidEnergyCardIds: payment.paidEnergyCardIds,
      movedCardIds: move.movedCardIds,
      targetMemberCardId: selectedCardId,
      gainedHearts: [{ color: HeartColor.YELLOW, count: 1 }],
    }),
    false
  );
}

function getCurrentTargets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember);
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
    ) ?? []
  );
}

function isValidSourceInWaitingRoom(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return Boolean(
    player &&
    source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    player.waitingRoom.cardIds.includes(sourceCardId)
  );
}
