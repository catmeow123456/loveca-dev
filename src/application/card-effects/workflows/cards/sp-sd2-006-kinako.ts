import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const SELECT_DISCARD_STEP_ID = 'SP_SD2_006_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_WAITING_ROOM_LIELLA_LIVE_STEP_ID = 'SP_SD2_006_SELECT_WAITING_ROOM_LIELLA_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const liellaLive = and(typeIs(CardType.LIVE), groupAliasIs('Liella!'));

export function registerSpSd2006KinakoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
    startSpSd2006KinakoActivatedEffect
  );
  registerActiveEffectStepHandler(
    SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishSpSd2006KinakoDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : game
  );
  registerActiveEffectStepHandler(
    SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
    SELECT_WAITING_ROOM_LIELLA_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startSpSd2006KinakoActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-sd2-006') ||
    !isMemberCardData(sourceCard.data) ||
    getSourceMemberSlot(game, player.id, cardId) === null ||
    player.hand.cardIds.length === 0 ||
    getActiveEnergyCardIds(player).length < 2
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '支付2张活跃能量，并选择1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '支付费用',
        canSkipSelection: false,
        metadata: {
          effectCosts: [
            { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
            {
              kind: 'DISCARD_HAND_TO_WAITING_ROOM',
              minCount: 1,
              maxCount: 1,
              optional: false,
            },
          ],
          handToWaitingRoomCost: {
            minCount: 1,
            maxCount: 1,
            optional: false,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_PAY_ENERGY_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishSpSd2006KinakoDiscardCost(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!energyPayment) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    energyPayment.gameState,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = recordAbilityUseForContext(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  state = addAction(state, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: energyPayment.paidEnergyCardIds,
    amount: energyPayment.paidEnergyCardIds.length,
    discardedHandCardIds: discardResult.discardedCardIds,
  });

  return startSpSd2006KinakoRecoverLiellaLive(
    state,
    effect,
    player.id,
    {
      discardCardId,
      paidEnergyCardIds: energyPayment.paidEnergyCardIds,
    },
    continuePendingCardEffects
  );
}

function startSpSd2006KinakoRecoverLiellaLive(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  metadata: {
    readonly discardCardId: string;
    readonly paidEnergyCardIds: readonly string[];
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const selectableCardIds = selectWaitingRoomCardIds(game, playerId, liellaLive);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_LIELLA_LIVE_TARGET_AFTER_COST',
        discardCardId: metadata.discardCardId,
        paidEnergyCardIds: metadata.paidEnergyCardIds,
      }),
      game.activeEffect?.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: SELECT_WAITING_ROOM_LIELLA_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张『Liella!』LIVE卡加入手牌。',
        awaitingPlayerId: playerId,
        selectableCardIds,
        canSkipSelection: false,
        metadata,
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_WAITING_ROOM_LIELLA_LIVE',
      selectableCardIds,
      discardCardId: metadata.discardCardId,
      paidEnergyCardIds: metadata.paidEnergyCardIds,
    }
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
