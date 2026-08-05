import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, cardNameAliasIs, costGte, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from '../../runtime/actions.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'S_BP7_001_SELECT_DISCARD_FOR_HIGH_COST_MEMBER_RECOVERY';
const SELECT_RECOVERY_STEP_ID = 'S_BP7_001_SELECT_HIGH_COST_MEMBER_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const highCostMember = and(typeIs(CardType.MEMBER), costGte(10));
const rikoName = cardNameAliasIs('桜内梨子');
const youName = cardNameAliasIs('渡辺曜');

export function registerSBp7001ChikaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startDiscardDecision(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishDiscard(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID,
    SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishRecovery(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startDiscardDecision(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  if (player.hand.cardIds.length === 0) {
    return finishPending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_HAND_TO_DISCARD',
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: '请选择1张手牌放置入休息室。也可以选择不发动此效果。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_FOR_HIGH_COST_MEMBER_RECOVERY',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishDiscard(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discard = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discard) return game;

  const stateAfterCost = addAction(discard.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discard.discardedCardIds,
  });
  const selectableCardIds = selectWaitingRoomCardIds(stateAfterCost, player.id, highCostMember);
  if (selectableCardIds.length === 0) {
    return finishActive(
      { ...stateAfterCost, activeEffect: effect },
      effect,
      continuePendingCardEffects,
      {
        step: 'DISCARD_PAID_NO_HIGH_COST_MEMBER_TARGET',
        discardedCardIds: discard.discardedCardIds,
        recoveredCardIds: [],
        bladeBonus: 0,
      }
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_RECOVERY_STEP_ID,
        stepText: '请选择自己休息室中1张费用大于等于10的成员卡加入手牌。',
        selectionLabel: '选择要加入手牌的成员卡',
        confirmSelectionLabel: '加入手牌',
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          ...effect.metadata,
          orderedResolution: effect.metadata?.orderedResolution === true,
          discardedHandCardIds: discard.discardedCardIds,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_HIGH_COST_MEMBER_FROM_WAITING_ROOM',
      discardedCardIds: discard.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP7_001_ON_ENTER_DISCARD_RECOVER_HIGH_COST_MEMBER_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_RECOVERY_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  const currentCandidates = selectWaitingRoomCardIds(game, player.id, highCostMember).filter(
    (cardId) => effect.selectableCardIds?.includes(cardId)
  );
  if (!currentCandidates.includes(selectedCardId)) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'RECOVERY_TARGET_STALE',
      selectedCardId,
      recoveredCardIds: [],
      bladeBonus: 0,
    });
  }

  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: currentCandidates,
    exactCount: 1,
  });
  if (!recovery) return game;

  const recoveredCard = getCardById(recovery.gameState, selectedCardId);
  const grantsBlade = recoveredCard !== null && (rikoName(recoveredCard) || youName(recoveredCard));
  const blade = grantsBlade
    ? addBladeLiveModifierForSourceMember(recovery.gameState, {
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        amount: 2,
      })
    : null;
  return finishActive(blade?.gameState ?? recovery.gameState, effect, continuePendingCardEffects, {
    step: 'RECOVER_HIGH_COST_MEMBER',
    recoveredCardIds: recovery.movedCardIds,
    recoveredCardId: recovery.movedCardIds[0] ?? null,
    matchedRikoOrYou: grantsBlade,
    bladeBonus: blade?.bladeBonus ?? 0,
  });
}

function finishActive(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}
