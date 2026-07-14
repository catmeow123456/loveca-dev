import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { GamePhase, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  S_BP3_007_ACTIVATED_PAY_ENERGY_BOTTOM_WAITING_LIVE_DRAW_ABILITY_ID,
  S_PR_041_ON_ENTER_CHOOSE_PLAYER_BOTTOM_WAITING_LIVE_DRAW_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  drawCardsForPlayer,
  moveWaitingRoomCardsToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

// Keep the original S-bp3-007 step ids for persisted activeEffect compatibility.
const SELECT_PLAYER = 'S_BP3_007_SELECT_PLAYER';
const SELECT_LIVE = 'S_BP3_007_SELECT_WAITING_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type WorkflowEntryKind = 'ACTIVATED' | 'PENDING';

interface WorkflowConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly entryKind: WorkflowEntryKind;
}

const ACTIVATED_CONFIG: WorkflowConfig = {
  abilityId: S_BP3_007_ACTIVATED_PAY_ENERGY_BOTTOM_WAITING_LIVE_DRAW_ABILITY_ID,
  baseCardCode: 'PL!S-bp3-007',
  entryKind: 'ACTIVATED',
};

const ON_ENTER_CONFIG: WorkflowConfig = {
  abilityId: S_PR_041_ON_ENTER_CHOOSE_PLAYER_BOTTOM_WAITING_LIVE_DRAW_ONE_ABILITY_ID,
  baseCardCode: 'PL!S-PR-041',
  entryKind: 'PENDING',
};

const CONFIGS = [ACTIVATED_CONFIG, ON_ENTER_CONFIG] as const;
const CONFIG_BY_ABILITY_ID = new Map(CONFIGS.map((config) => [config.abilityId, config]));

export function registerChoosePlayerBottomWaitingLiveDrawOneWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ACTIVATED_CONFIG.abilityId, startActivated);
  registerPendingAbilityStarterHandler(
    ON_ENTER_CONFIG.abilityId,
    (game, ability, options, context) =>
      startPending(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  for (const config of CONFIGS) {
    registerActiveEffectStepHandler(config.abilityId, SELECT_PLAYER, (game, input, context) =>
      choosePlayer(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(config.abilityId, SELECT_LIVE, (game, input, context) =>
      finish(
        game,
        input.selectedCardId ??
          (input.selectedCardIds?.length === 1 ? input.selectedCardIds[0] : null),
        context.continuePendingCardEffects
      )
    );
  }
}

function startActivated(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  ) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const opponent = getOpponent(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (
    !player ||
    !opponent ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, ACTIVATED_CONFIG.baseCardCode) ||
    getSourceMemberSlot(game, playerId, sourceCardId) === null
  ) {
    return game;
  }
  const payment = payImmediateEffectCosts(game, playerId, sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!payment) return game;
  let state = recordPayCostAction(payment.gameState, playerId, {
    abilityId: ACTIVATED_CONFIG.abilityId,
    sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: 1,
  });
  state = recordAbilityUseForContext(state, playerId, {
    abilityId: ACTIVATED_CONFIG.abilityId,
    sourceCardId,
  });
  return {
    ...state,
    activeEffect: createPlayerSelectionEffect({
      id: `${ACTIVATED_CONFIG.abilityId}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: ACTIVATED_CONFIG.abilityId,
      sourceCardId,
      controllerId: playerId,
      opponentId: opponent.id,
      entryKind: ACTIVATED_CONFIG.entryKind,
      orderedResolution: false,
    }),
  };
}

function startPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const source = getCardById(game, ability.sourceCardId);
  if (
    !player ||
    !opponent ||
    !source ||
    source.ownerId !== player.id ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, ON_ENTER_CONFIG.baseCardCode)
  ) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        'RESOLVE_ABILITY',
        ability.controllerId,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'SOURCE_INVALID',
        }
      ),
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createPlayerSelectionEffect({
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      opponentId: opponent.id,
      entryKind: ON_ENTER_CONFIG.entryKind,
      orderedResolution,
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_PLAYER',
    },
  });
}

function createPlayerSelectionEffect(params: {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly opponentId: string;
  readonly entryKind: WorkflowEntryKind;
  readonly orderedResolution: boolean;
}): ActiveEffectState {
  return {
    id: params.id,
    abilityId: params.abilityId,
    sourceCardId: params.sourceCardId,
    controllerId: params.controllerId,
    effectText: getAbilityEffectText(params.abilityId),
    stepId: SELECT_PLAYER,
    stepText: '请选择要处理休息室的玩家。',
    awaitingPlayerId: params.controllerId,
    selectableCardIds: [],
    selectableCardVisibility: 'PUBLIC',
    selectableOptions: [
      { id: params.controllerId, label: '自己' },
      { id: params.opponentId, label: '对方' },
    ],
    canSkipSelection: false,
    metadata: {
      entryKind: params.entryKind,
      orderedResolution: params.orderedResolution,
    },
  };
}

function choosePlayer(
  game: GameState,
  targetPlayerId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const config = effect ? CONFIG_BY_ABILITY_ID.get(effect.abilityId) : undefined;
  const controller = effect ? getPlayerById(game, effect.controllerId) : null;
  const opponent = controller ? getOpponent(game, controller.id) : null;
  if (
    !effect ||
    !config ||
    effect.stepId !== SELECT_PLAYER ||
    !controller ||
    (targetPlayerId !== controller.id && targetPlayerId !== opponent?.id)
  ) {
    return game;
  }
  const target = getPlayerById(game, targetPlayerId);
  if (!target) return game;
  const candidates = target.waitingRoom.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return card !== null && card.ownerId === target.id && isLiveCardData(card.data);
  });
  if (candidates.length === 0) {
    const resolved = addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', controller.id, {
      ...getPendingActionPayload(effect),
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'NO_LIVE_TARGET',
      targetPlayerId,
      movedCardIds: [],
      drawnCardIds: [],
    });
    return completeEntry(resolved, effect, continuePendingCardEffects);
  }
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_LIVE,
      stepText: '请选择1张LIVE卡放置于该玩家的卡组底。',
      selectableOptions: undefined,
      selectableSlots: undefined,
      selectableCardIds: candidates,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置于卡组底的LIVE卡',
      confirmSelectionLabel: '放置于卡组底',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: {
        ...effect.metadata,
        targetPlayerId,
        candidateCardIds: candidates,
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          sourcePlayerId: targetPlayerId,
        },
      },
    },
  };
}

function finish(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const config = effect ? CONFIG_BY_ABILITY_ID.get(effect.abilityId) : undefined;
  if (
    !effect ||
    !config ||
    effect.stepId !== SELECT_LIVE ||
    !selectedCardId ||
    typeof effect.metadata?.targetPlayerId !== 'string' ||
    !Array.isArray(effect.metadata.candidateCardIds)
  ) {
    return game;
  }
  const candidates = effect.metadata.candidateCardIds.filter(
    (id): id is string => typeof id === 'string'
  );
  const targetPlayer = getPlayerById(game, effect.metadata.targetPlayerId);
  const selectedCard = getCardById(game, selectedCardId);
  const selectionStillLegal =
    targetPlayer !== null &&
    candidates.includes(selectedCardId) &&
    targetPlayer.waitingRoom.cardIds.includes(selectedCardId) &&
    selectedCard !== null &&
    selectedCard.ownerId === targetPlayer.id &&
    isLiveCardData(selectedCard.data);
  if (!selectionStillLegal) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    const resolved = addAction(
      { ...game, activeEffect: null },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        ...getPendingActionPayload(effect),
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECTED_LIVE_LEFT_WAITING_ROOM',
        targetPlayerId: effect.metadata.targetPlayerId,
        selectedCardId,
        movedCardIds: [],
        drawnCardIds: [],
      }
    );
    return completeEntry(resolved, effect, continuePendingCardEffects);
  }
  const moved = moveWaitingRoomCardsToDeckBottomForPlayer(
    { ...game, activeEffect: null },
    effect.metadata.targetPlayerId,
    [selectedCardId],
    { candidateCardIds: candidates, minCount: 1, maxCount: 1 }
  );
  if (!moved || moved.movedCardIds.length !== 1) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    const resolved = addAction(
      { ...game, activeEffect: null },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        ...getPendingActionPayload(effect),
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECTED_LIVE_LEFT_WAITING_ROOM',
        targetPlayerId: effect.metadata.targetPlayerId,
        selectedCardId,
        movedCardIds: [],
        drawnCardIds: [],
      }
    );
    return completeEntry(resolved, effect, continuePendingCardEffects);
  }
  const drawn = drawCardsForPlayer(moved.gameState, effect.controllerId, 1);
  const state = drawn?.gameState ?? moved.gameState;
  const resolved = addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
    ...getPendingActionPayload(effect),
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'BOTTOM_WAITING_LIVE_DRAW',
    targetPlayerId: effect.metadata.targetPlayerId,
    cardIds: moved.movedCardIds,
    movedCardIds: moved.movedCardIds,
    fromZone: ZoneType.WAITING_ROOM,
    toZone: ZoneType.MAIN_DECK,
    drawnCardIds: drawn?.drawnCardIds ?? [],
  });
  return completeEntry(resolved, effect, continuePendingCardEffects);
}

function completeEntry(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return effect.metadata?.entryKind === 'PENDING'
    ? continuePendingCardEffects(game, effect.metadata?.orderedResolution === true)
    : game;
}

function getPendingActionPayload(effect: ActiveEffectState): Readonly<Record<string, unknown>> {
  return effect.metadata?.entryKind === 'PENDING' ? { pendingAbilityId: effect.id } : {};
}
