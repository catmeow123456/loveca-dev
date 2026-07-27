import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { canPlayMemberInStageSlotThisTurn } from '../../../../domain/rules/member-turn-state.js';
import {
  CardType,
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers } from '../../runtime/energy-below-placement-triggers.js';
import {
  enqueueCardEffectPlacementTriggersWithStageSnapshot,
  playMemberFromZoneToStageSlotWithReplacement,
  type EnqueueCardEffectPlacementTriggers,
} from '../../runtime/play-member-to-stage.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const SELECT_MEMBER = 'N_BP7_010_SELECT_WAITING_MEMBER';
const SELECT_SLOT = 'N_BP7_010_SELECT_EMPTY_SLOT';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const selector = and(typeIs(CardType.MEMBER), costLte(2), groupAliasIs('虹ヶ咲'));
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7010ShiorikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueCardEffectPlacementTriggers;
}): void {
  registerActivatedAbilityHandler(ABILITY_ID, start);
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_MEMBER, (game, input, context) =>
    selectMember(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_SLOT, (game, input, context) =>
    selectSlot(
      game,
      input.selectedSlot ?? null,
      deps.enqueueTriggeredCardEffects,
      context.continuePendingCardEffects
    )
  );
}

function start(game: GameState, playerId: string, sourceCardId: string): GameState {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  const sourceSlot = player ? getSourceMemberSlot(game, playerId, sourceCardId) : null;
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    activePlayerId !== playerId ||
    !player ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, 'PL!N-bp7-010') ||
    sourceSlot === null ||
    player.energyZone.cardIds.length < 1
  ) return game;

  const stacked = stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
    game,
    playerId,
    sourceSlot,
    1,
    { kind: 'CARD_EFFECT', playerId, sourceCardId, abilityId: ABILITY_ID }
  );
  if (!stacked || stacked.stackedEnergyCardIds.length !== 1) return game;
  let state = recordPayCostAction(stacked.gameState, playerId, {
    abilityId: ABILITY_ID,
    sourceCardId,
    sourceSlot,
    costType: 'STACK_ENERGY_BELOW',
    stackedEnergyCardIds: stacked.stackedEnergyCardIds,
  });
  state = recordAbilityUseForContext(state, playerId, { abilityId: ABILITY_ID, sourceCardId });
  const targets = getTargets(state, playerId);
  const legalSlots = getEmptyLegalSlots(state, playerId);
  if (targets.length === 0 || legalSlots.length === 0) {
    return addNoPlayAfterCost(state, {
      playerId,
      sourceCardId,
      sourceSlot,
      stackedEnergyCardIds: stacked.stackedEnergyCardIds,
      reason: targets.length === 0 ? 'NO_ELIGIBLE_WAITING_ROOM_MEMBER' : 'NO_EMPTY_LEGAL_SLOT',
    });
  }
  return {
    ...state,
    activeEffect: {
      id: `${ABILITY_ID}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: ABILITY_ID,
      sourceCardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: SELECT_MEMBER,
      stepText: '请从自己的休息室选择1张费用小于等于2的『虹咲』成员卡。',
      awaitingPlayerId: playerId,
      selectableCardIds: targets,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要登场的成员',
      confirmSelectionLabel: '选择登场区域',
      canSkipSelection: false,
      metadata: { sourceSlot, stackedEnergyCardIds: stacked.stackedEnergyCardIds },
    },
  };
}

function selectMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_MEMBER ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) return game;
  const currentTargets = getTargets(game, effect.controllerId);
  const slots = getEmptyLegalSlots(game, effect.controllerId);
  if (!currentTargets.includes(selectedCardId) || slots.length === 0) {
    return resolveNoPlay(
      game,
      effect,
      'STALE_MEMBER_OR_NO_EMPTY_SLOT',
      continuePendingCardEffects
    );
  }
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_SLOT,
      stepText: '请选择该成员要登场的空区域。',
      selectableCardIds: undefined,
      selectableSlots: slots,
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '以待机状态登场',
      metadata: { ...effect.metadata, selectedCardId },
    },
  };
}

function selectSlot(
  game: GameState,
  selectedSlot: SlotPosition | null,
  enqueue: EnqueueCardEffectPlacementTriggers,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const selectedCardId =
    typeof effect?.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_SLOT ||
    !selectedCardId ||
    selectedSlot === null ||
    !SLOTS.includes(selectedSlot) ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) return game;
  if (
    !getTargets(game, effect.controllerId).includes(selectedCardId) ||
    !getEmptyLegalSlots(game, effect.controllerId).includes(selectedSlot)
  ) {
    return resolveNoPlay(game, effect, 'STALE_MEMBER_OR_SLOT', continuePendingCardEffects);
  }

  const played = playMemberFromZoneToStageSlotWithReplacement(game, effect.controllerId, {
    cardId: selectedCardId,
    sourceZone: ZoneType.WAITING_ROOM,
    toSlot: selectedSlot,
    orientation: OrientationState.WAITING,
  });
  if (!played) {
    return resolveNoPlay(game, effect, 'PLAY_FAILED', continuePendingCardEffects);
  }
  let state = addAction({ ...played.gameState, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_WAITING_NIJIGASAKI_MEMBER',
    playedCardId: selectedCardId,
    toSlot: selectedSlot,
  });
  state = enqueueCardEffectPlacementTriggersWithStageSnapshot(game, state, played, enqueue);
  return continuePendingCardEffects(state, false);
}

function getTargets(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return player.waitingRoom.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return card?.ownerId === playerId && selector(card);
  });
}

function getEmptyLegalSlots(game: GameState, playerId: string): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return SLOTS.filter(
    (slot) =>
      player.memberSlots.slots[slot] === null &&
      canPlayMemberInStageSlotThisTurn(game, playerId, slot)
  );
}

function resolveNoPlay(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  reason: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addNoPlayAfterCost(game, {
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      stackedEnergyCardIds: stringArray(effect.metadata?.stackedEnergyCardIds),
      reason,
    }),
    false
  );
}

function addNoPlayAfterCost(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly sourceSlot: unknown;
    readonly stackedEnergyCardIds: readonly string[];
    readonly reason: string;
  }
): GameState {
  return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', options.playerId, {
    abilityId: ABILITY_ID,
    sourceCardId: options.sourceCardId,
    sourceSlot: options.sourceSlot,
    step: 'NO_PLAY_AFTER_COST',
    stackedEnergyCardIds: options.stackedEnergyCardIds,
    reason: options.reason,
  });
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
