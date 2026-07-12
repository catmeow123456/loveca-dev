import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckTopForPlayer } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';

const PAY_ENERGY_OPTION_STEP_ID = 'HS_PR_020_PAY_ENERGY_STACK_WAITING_MEMBERS';
const SELECT_WAITING_MEMBERS_STEP_ID = 'HS_PR_020_SELECT_WAITING_MEMBERS_TO_DECK_TOP';
const DECLINE_OPTION_LABEL = '不发动';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLiveStartPayEnergyStackWaitingMembersToDeckTopWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID,
    (game, ability, options, context) =>
      startPayEnergyStackWaitingMembersWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID,
    PAY_ENERGY_OPTION_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishPayEnergyForStackWaitingMembers(game)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID,
    SELECT_WAITING_MEMBERS_STEP_ID,
    (game, input, context) =>
      input.selectedCardIds
        ? finishStackWaitingMembersToDeckTop(
            game,
            input.selectedCardIds,
            context.continuePendingCardEffects
          )
        : game
  );
}

function startPayEnergyStackWaitingMembersWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getWaitingRoomMemberCardIds(game, player.id);
  if (selectableCardIds.length < 2) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_WAITING_ROOM_MEMBER_PAIR',
      continuePendingCardEffects
    );
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  if (activeEnergyCardIds.length < 1) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'CANNOT_PAY',
      continuePendingCardEffects
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
      stepId: PAY_ENERGY_OPTION_STEP_ID,
      stepText: '可以支付1张活跃能量，将休息室2张成员卡按选择顺序放置到卡组顶。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'pay', label: '支付1能量' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ],
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      sourceSlot: ability.sourceSlot,
      activeEnergyCardIds,
      selectableCardIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
    },
  });
}

function finishPayEnergyForStackWaitingMembers(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_OPTION_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getWaitingRoomMemberCardIds(game, player.id);
  if (selectableCardIds.length < 2) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_WAITING_MEMBERS_STEP_ID,
        stepText: '请选择休息室中2张成员卡，按选择顺序放置到卡组顶。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        selectionLabel: '选择休息室成员',
        confirmSelectionLabel: '放置到卡组顶',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          publicCardSelectionConfirmation: {
            destination: 'MAIN_DECK_TOP',
            ordered: true,
          },
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_SELECT_WAITING_ROOM_MEMBERS',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
    }
  );
}

function finishStackWaitingMembersToDeckTop(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    effect &&
    effect.abilityId ===
      HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID &&
    effect.stepId === SELECT_WAITING_MEMBERS_STEP_ID &&
    player &&
    getWaitingRoomMemberCardIds(game, player.id).length < 2
  ) {
    return finishNoWaitingRoomMemberPairAfterPayment(game, effect, player.id, continuePendingCardEffects);
  }

  if (
    !effect ||
    effect.abilityId !==
      HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_MEMBERS_STEP_ID ||
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== 2 ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId) &&
        isWaitingRoomMember(game, player.id, cardId)
    )
  ) {
    return game;
  }

  const moveResult = moveWaitingRoomCardsToDeckTopForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: 2,
      maxCount: 2,
    }
  );
  if (!moveResult) return game;

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'STACK_WAITING_ROOM_MEMBERS_TO_DECK_TOP',
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
      selectedCardIds: uniqueSelectedCardIds,
      movedCardIds: uniqueSelectedCardIds,
      destination: 'MAIN_DECK_TOP',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishNoWaitingRoomMemberPairAfterPayment(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'NO_WAITING_ROOM_MEMBER_PAIR_AFTER_PAYMENT',
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function getWaitingRoomMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.waitingRoom.cardIds.filter((cardId) => isWaitingRoomMember(game, playerId, cardId));
}

function isWaitingRoomMember(game: GameState, playerId: string, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return card?.ownerId === playerId && isMemberCardData(card.data);
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
