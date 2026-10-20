import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardNameAliasIs, groupAliasIs } from '../../../effects/card-selectors.js';
import {
  HS_BP8_004_ON_ENTER_DRAW_RELAY_KAHO_DRAW_ONE_ABILITY_ID as ON_ENTER,
  HS_BP8_004_ACTIVATED_DISCARD_LOW_COST_HASUNOSORA_GAIN_ON_ENTER_ABILITY_ID as ACTIVATED,
} from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import {
  registerPendingAbilityStarterHandler,
  type DelegatePendingAbility,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  addTemporaryOnEnterAbilityGrant,
  getCopyableOnEnterDefinitions,
  getHostEnterStageEventIds,
  getHostEnterStageMetadata,
} from '../../runtime/temporary-on-enter-ability-grants.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const DISCARD_STEP = 'HS_BP8_004_DISCARD_HAND_FOR_ON_ENTER';
const ABILITY_STEP = 'HS_BP8_004_SELECT_GRANTED_ON_ENTER';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerHsBp8004GinkoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ON_ENTER, (game, ability, options, runtime) => {
    const event = game.eventLog.find(
      ({ event }) =>
        ability.eventIds.includes(event.eventId) &&
        event.eventType === TriggerCondition.ON_ENTER_STAGE &&
        event.cardInstanceId === ability.sourceCardId
    )?.event as EnterStageEvent | undefined;
    const relayIds =
      event?.eventType === TriggerCondition.ON_ENTER_STAGE
        ? (event.relayReplacements?.map((replacement) => replacement.cardId) ??
          (event.replacedMemberCardId ? [event.replacedMemberCardId] : []))
        : [];
    const relayedFromKaho = relayIds.some((id) => {
      const card = getCardById(game, id);
      return card !== null && cardNameAliasIs('日野下花帆')(card);
    });
    const count = relayedFromKaho ? 2 : 1;
    const drawn = drawCardsForPlayer(game, ability.controllerId, count);
    const state = drawn?.gameState ?? game;
    return runtime.continuePendingCardEffects(
      addAction(
        {
          ...state,
          pendingAbilities: state.pendingAbilities.filter((item) => item.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        ability.controllerId,
        {
          pendingAbilityId: ability.id,
          abilityId: ON_ENTER,
          sourceCardId: ability.sourceCardId,
          step: 'DRAW_RELAY_KAHO_DRAW',
          requestedDrawCount: count,
          relayedFromKaho,
          drawnCardIds: drawn?.drawnCardIds ?? [],
        }
      ),
      options.orderedResolution === true
    );
  });
  registerActivatedAbilityHandler(
    ACTIVATED,
    (game, playerId, cardId) => {
      if (!canStart(game, playerId, cardId)) return game;
      const player = getPlayerById(game, playerId)!;
      return addAction(
        {
          ...game,
          activeEffect: {
            id: globalThis.crypto.randomUUID(),
            abilityId: ACTIVATED,
            sourceCardId: cardId,
            sourceLifecycleId: getStageMemberLifecycleId(game, cardId),
            controllerId: playerId,
            effectText: getAbilityEffectText(ACTIVATED),
            stepId: DISCARD_STEP,
            stepText: '请选择1张手牌放置入休息室。',
            awaitingPlayerId: playerId,
            selectableCardIds: player.hand.cardIds,
            selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
            selectableCardMode: 'SINGLE',
            minSelectableCards: 1,
            maxSelectableCards: 1,
            selectionLabel: '选择要作为费用放置入休息室的手牌',
            confirmSelectionLabel: '放置入休息室',
            canSkipSelection: false,
          },
        },
        'RESOLVE_ABILITY',
        playerId,
        { abilityId: ACTIVATED, sourceCardId: cardId, step: 'START_DISCARD_TO_GAIN_ON_ENTER' }
      );
    },
    canStart
  );
  registerActiveEffectStepHandler(
    ACTIVATED,
    DISCARD_STEP,
    (game, input, runtime) => {
      const effect = game.activeEffect;
      if (!effect || !input.selectedCardId) return game;
      const discarded = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
        game,
        effect.controllerId,
        input.selectedCardId,
        { candidateCardIds: effect.selectableCardIds ?? [] },
        deps.enqueueTriggeredCardEffects
      );
      if (!discarded) return game;
      let state = recordPayCostAction(discarded.gameState, effect.controllerId, {
        abilityId: ACTIVATED,
        sourceCardId: effect.sourceCardId,
        pendingAbilityId: effect.id,
        costType: 'DISCARD_HAND_TO_WAITING_ROOM',
        discardedCardIds: discarded.discardedCardIds,
        enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId,
      });
      state = recordAbilityUseForContext(state, effect.controllerId, {
        abilityId: ACTIVATED,
        sourceCardId: effect.sourceCardId,
        sourceLifecycleId: effect.sourceLifecycleId,
      });
      const card = getCardById(state, input.selectedCardId);
      const definitions =
        card && isMemberCardData(card.data) && card.data.cost <= 13 && groupAliasIs('蓮ノ空')(card)
          ? getCopyableOnEnterDefinitions(card.data.cardCode)
          : [];
      if (definitions.length === 0)
        return finish(
          state,
          effect,
          runtime.continuePendingCardEffects,
          'DISCARDED_CARD_HAS_NO_ELIGIBLE_ON_ENTER'
        );
      if (definitions.length === 1)
        return grantAndInvoke(
          state,
          effect,
          input.selectedCardId,
          definitions[0]!.abilityId,
          runtime.continuePendingCardEffects,
          runtime.delegatePendingAbility
        );
      return {
        ...state,
        activeEffect: {
          ...effect,
          stepId: ABILITY_STEP,
          stepText: '请选择因此放置入休息室的成员持有的1个【登场】能力。获得后立即不支付费用发动。',
          selectableCardIds: undefined,
          selectableCardVisibility: undefined,
          selectableCardMode: undefined,
          minSelectableCards: undefined,
          maxSelectableCards: undefined,
          selectableOptions: definitions.map((definition) => ({
            id: definition.abilityId,
            label: definition.effectText,
          })),
          selectionLabel: '选择要获得的登场能力',
          confirmSelectionLabel: '获得并发动',
          canSkipSelection: false,
          metadata: { discardedCardId: input.selectedCardId },
        },
      };
    },
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ACTIVATED,
    ABILITY_STEP,
    (game, input, runtime) => {
      const effect = game.activeEffect;
      const cardId = effect?.metadata?.discardedCardId;
      if (
        !effect ||
        typeof cardId !== 'string' ||
        !input.selectedOptionId ||
        !effect.selectableOptions?.some((option) => option.id === input.selectedOptionId)
      )
        return game;
      return grantAndInvoke(
        game,
        effect,
        cardId,
        input.selectedOptionId,
        runtime.continuePendingCardEffects,
        runtime.delegatePendingAbility
      );
    },
    queryOptionSelection
  );
}

function canStart(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    !!player &&
    !!card &&
    card.ownerId === playerId &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!HS-bp8-004') &&
    findMemberSlot(player, cardId) !== null &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    player.hand.cardIds.length > 0 &&
    canUseAbilityThisTurn(game, playerId, ACTIVATED, cardId)
  );
}

function grantAndInvoke(
  game: GameState,
  effect: ActiveEffectState,
  paidCardId: string,
  abilityId: string,
  next: Continue,
  delegate: DelegatePendingAbility
): GameState {
  const paidCard = getCardById(game, paidCardId);
  const definition = paidCard
    ? getCopyableOnEnterDefinitions(paidCard.data.cardCode).find(
        (definition) => definition.abilityId === abilityId
      )
    : undefined;
  const player = getPlayerById(game, effect.controllerId);
  const slot = player ? findMemberSlot(player, effect.sourceCardId) : null;
  if (!paidCard || !definition || slot === null || !isCurrentStageMemberAbilitySource(game, effect))
    return finish(game, effect, next, 'PAID_BUT_HOST_NO_LONGER_AVAILABLE');
  const grantId = globalThis.crypto.randomUUID();
  const granted = addTemporaryOnEnterAbilityGrant(game, {
    kind: 'ON_ENTER_ABILITY_GRANT',
    grantId,
    controllerId: effect.controllerId,
    hostCardId: effect.sourceCardId,
    hostLifecycleId: effect.sourceLifecycleId!,
    definitionSourceCardCode: paidCard.data.cardCode,
    abilityId,
  });
  if (granted === game) return finish(game, effect, next, 'PAID_BUT_GRANT_NOT_AVAILABLE');
  const state = addAction(
    { ...granted, activeEffect: null },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: ACTIVATED,
      sourceCardId: effect.sourceCardId,
      step: 'GAIN_ON_ENTER_AND_INVOKE_WITHOUT_COST',
      grantId,
      grantedAbilityId: abilityId,
      discardedCardId: paidCardId,
    }
  );
  if (definition.requiredSourceSlots && !definition.requiredSourceSlots.includes(slot))
    return next(state, false);
  const child: PendingAbilityState = {
    id: globalThis.crypto.randomUUID(),
    abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: getHostEnterStageEventIds(game, effect.sourceCardId),
    sourceSlot: slot,
    metadata: getHostEnterStageMetadata(game, effect.sourceCardId),
    onEnterInvocation: {
      definitionSourceCardCode: paidCard.data.cardCode,
      waiveActivationCosts: true,
      grantId,
    },
  };
  return delegate(state, child, { skipManualConfirmation: true });
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  step: string
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ACTIVATED,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    false
  );
}
