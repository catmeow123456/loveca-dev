import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, cardNameAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import { SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnergyReturn } from '../../runtime/energy-return.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  createOptionalEnergyReturnWindow,
  resolveOptionalEnergyReturn,
} from '../../runtime/optional-energy-return.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const BASE_CARD_CODE = 'PL!SP-bp7-026';
const RETURN_ONE_ENERGY_STEP_ID = 'SP_BP7_026_RETURN_ONE_ENERGY';
const SELECT_DISCARD_AFTER_DRAW_STEP_ID = 'SP_BP7_026_SELECT_DISCARD_AFTER_DRAW';
const REN_SELECTOR = and(typeIs(CardType.MEMBER), cardNameAliasIs('葉月恋'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnergyReturn &
  EnqueueTriggeredCardEffectsForEnterWaitingRoom;

export function registerSpBp7026DearsWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startDearsWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    RETURN_ONE_ENERGY_STEP_ID,
    (game, input, context) =>
      finishEnergyReturnStep(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    SELECT_DISCARD_AFTER_DRAW_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startDearsWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (
    !player ||
    !isValidDearsSource(game, player.id, ability.sourceCardId) ||
    player.energyZone.cardIds.length === 0
  ) {
    return finishDearsWorkflow(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_VALID_SOURCE_OR_ENERGY',
    });
  }

  return (
    createOptionalEnergyReturnWindow(game, {
      ability,
      requiredCount: 1,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: RETURN_ONE_ENERGY_STEP_ID,
      stepText: '可以将1张能量放回能量卡组并发动此效果。',
      orderedResolution,
    }) ?? game
  );
}

function finishEnergyReturnStep(
  game: GameState,
  selectedCardIds: readonly string[],
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const ability = activeEffectToPendingAbility(effect);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (!isValidDearsSource(game, effect.controllerId, effect.sourceCardId)) {
    return finishDearsWorkflow(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_INVALID_BEFORE_PAYMENT',
    });
  }

  const payment = resolveOptionalEnergyReturn(game, {
    selectedCardIds,
    selectedOptionId,
    enqueueTriggeredCardEffects,
  });
  if (!payment) {
    return game;
  }
  if (payment.declined) {
    return finishDearsWorkflow(
      payment.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'DECLINED' }
    );
  }
  if (payment.movedEnergyCardIds.length !== 1) {
    return finishDearsWorkflow(
      payment.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'INVALID_PAYMENT_RESULT',
        movedEnergyCardIds: payment.movedEnergyCardIds,
      }
    );
  }

  const hasRen = hasStageMemberMatching(payment.gameState, ability.controllerId, REN_SELECTOR);
  if (!hasRen) {
    return finishDearsWorkflow(
      payment.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'PAID_REN_NOT_ON_STAGE',
        movedEnergyCardIds: payment.movedEnergyCardIds,
        conditionMet: false,
      }
    );
  }

  return startDrawThenDiscardCardsWorkflow(payment.gameState, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    drawCount: 2,
    discardCount: 1,
    stepId: SELECT_DISCARD_AFTER_DRAW_STEP_ID,
    orderedResolution,
    continuePendingCardEffects,
    selectionLabel: '选择要放置入休息室的手牌',
    confirmSelectionLabel: '放置入休息室',
  });
}

function isValidDearsSource(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player !== null &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function activeEffectToPendingAbility(
  effect: NonNullable<GameState['activeEffect']>
): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: '',
    eventIds: [],
  };
}

function finishDearsWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    activeEffect: null,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
