import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, SlotPosition, ZoneType } from '../../../../shared/types/enums.js';
import {
  and,
  cardNameAliasIs,
  costLte,
  groupAliasIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  S_BP7_007_LIVE_START_BOTTOM_AQOURS_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID,
} from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from '../../runtime/actions.js';
import {
  enqueueCardEffectPlacementTriggersWithStageSnapshot,
  playMemberFromZoneToStageSlotWithReplacement,
  type EnqueueCardEffectPlacementTriggers,
} from '../../runtime/play-member-to-stage.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';

const SELECT_RECOVERY_STEP_ID = 'S_BP7_007_SELECT_LOW_COST_MEMBER_TO_HAND';
const DECIDE_PLAY_STEP_ID = 'S_BP7_007_DECIDE_PLAY_RECOVERED_MEMBER';
const SELECT_PLAY_SLOT_STEP_ID = 'S_BP7_007_SELECT_EMPTY_STAGE_SLOT';
const SELECT_BOTTOM_STEP_ID = 'S_BP7_007_SELECT_AQOURS_MEMBERS_TO_DECK_BOTTOM';
const PLAY_OPTION_ID = 'play';
const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const lowCostMember = and(typeIs(CardType.MEMBER), costLte(2));
const aqoursMember = and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'));
const yoshikoName = cardNameAliasIs('津島善子');
const rubyName = cardNameAliasIs('黒澤ルビィ');

export function registerSBp7007HanamaruWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueCardEffectPlacementTriggers;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID,
    (game, ability, options, context) =>
      startRecovery(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID,
    SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishRecovery(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID,
    DECIDE_PLAY_STEP_ID,
    (game, input, context) =>
      finishPlayDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID,
    SELECT_PLAY_SLOT_STEP_ID,
    (game, input, context) =>
      finishPlayToSlot(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    S_BP7_007_LIVE_START_BOTTOM_AQOURS_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startBottomSelection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_007_LIVE_START_BOTTOM_AQOURS_MEMBERS_GAIN_BLADE_ABILITY_ID,
    SELECT_BOTTOM_STEP_ID,
    (game, input, context) =>
      finishBottomSelection(game, input.selectedCardIds ?? [], context.continuePendingCardEffects)
  );
}

function startRecovery(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = getWaitingRoomCandidateIds(game, player.id, lowCostMember);
  if (selectableCardIds.length === 0) {
    return finishPending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_LOW_COST_MEMBER_IN_WAITING_ROOM',
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_RECOVERY_STEP_ID,
      stepText: '请选择自己休息室中1张费用小于等于2的成员卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要加入手牌的成员卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'HAND',
          ordered: false,
          sourcePlayerId: player.id,
        },
        orderedResolution,
      },
    },
    actionPayload: {
      step: 'START_SELECT_LOW_COST_MEMBER_TO_HAND',
      selectableCardIds,
    },
  });
}

function finishRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID ||
    effect.stepId !== SELECT_RECOVERY_STEP_ID ||
    !selectedCardId
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || effect.selectableCardIds?.includes(selectedCardId) !== true) return game;

  const currentCandidates = getWaitingRoomCandidateIds(game, player.id, lowCostMember).filter(
    (cardId) => effect.selectableCardIds?.includes(cardId)
  );
  if (!currentCandidates.includes(selectedCardId)) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'RECOVERY_TARGET_STALE',
      selectedCardId,
    });
  }

  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: currentCandidates,
    minCount: 1,
    maxCount: 1,
  });
  if (!recovery) return game;

  const recoveredCard = getCardById(recovery.gameState, selectedCardId);
  const canOptionallyPlay =
    recoveredCard !== null &&
    isMemberCardData(recoveredCard.data) &&
    (yoshikoName(recoveredCard) || rubyName(recoveredCard));
  const emptySlots = getEmptySlots(recovery.gameState, player.id);
  const stateAfterRecovery = addAction(recovery.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'RECOVER_LOW_COST_MEMBER',
    recoveredCardId: selectedCardId,
    recoveredEligibleForPlay: canOptionallyPlay,
    emptySlots,
  });
  if (!canOptionallyPlay || emptySlots.length === 0) {
    return continuePendingCardEffects(
      { ...stateAfterRecovery, activeEffect: null },
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...stateAfterRecovery,
    activeEffect: {
      ...effect,
      stepId: DECIDE_PLAY_STEP_ID,
      stepText: '可以将刚加入手牌的成员登场至自己舞台的空成员区。',
      selectableCardIds: undefined,
      selectableCardVisibility: undefined,
      selectableCardMode: undefined,
      minSelectableCards: undefined,
      maxSelectableCards: undefined,
      selectableOptions: [{ id: PLAY_OPTION_ID, label: '登场' }],
      selectionLabel: undefined,
      confirmSelectionLabel: undefined,
      canSkipSelection: true,
      skipSelectionLabel: '不登场',
      revealedCardIds: [selectedCardId],
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        recoveredCardId: selectedCardId,
      },
    },
  };
}

function finishPlayDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueCardEffectPlacementTriggers
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID ||
    effect.stepId !== DECIDE_PLAY_STEP_ID
  ) {
    return game;
  }
  if (selectedOptionId === null) {
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'DECLINE_PLAY_RECOVERED_MEMBER',
    });
  }
  if (selectedOptionId !== PLAY_OPTION_ID) return game;

  const player = getPlayerById(game, effect.controllerId);
  const recoveredCardId = getString(effect.metadata?.recoveredCardId);
  if (
    !player ||
    !recoveredCardId ||
    !isEligibleRecoveredHandMember(game, player.id, recoveredCardId)
  ) {
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'RECOVERED_MEMBER_STALE_BEFORE_PLAY',
      recoveredCardId,
    });
  }
  const emptySlots = getEmptySlots(game, player.id);
  if (emptySlots.length === 0) {
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'NO_EMPTY_STAGE_SLOT',
      recoveredCardId,
    });
  }
  if (emptySlots.length === 1) {
    return playRecoveredMember(
      game,
      effect,
      recoveredCardId,
      emptySlots[0],
      continuePendingCardEffects,
      enqueueTriggeredCardEffects
    );
  }

  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SELECT_PLAY_SLOT_STEP_ID,
      stepText: '请选择该成员要登场的空成员区。',
      selectableOptions: undefined,
      selectableSlots: emptySlots,
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '登场',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: {
        ...effect.metadata,
        emptySlots,
      },
    },
  };
}

function finishPlayToSlot(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueCardEffectPlacementTriggers
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_007_ON_ENTER_RECOVER_LOW_COST_MEMBER_OPTIONAL_PLAY_ABILITY_ID ||
    effect.stepId !== SELECT_PLAY_SLOT_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }
  const recoveredCardId = getString(effect.metadata?.recoveredCardId);
  if (!recoveredCardId) return game;
  return playRecoveredMember(
    game,
    effect,
    recoveredCardId,
    selectedSlot,
    continuePendingCardEffects,
    enqueueTriggeredCardEffects
  );
}

function playRecoveredMember(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  recoveredCardId: string,
  selectedSlot: SlotPosition,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueCardEffectPlacementTriggers
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !isEligibleRecoveredHandMember(game, player.id, recoveredCardId) ||
    player.memberSlots.slots[selectedSlot] !== null
  ) {
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'RECOVERED_MEMBER_OR_SLOT_STALE',
      recoveredCardId,
      selectedSlot,
    });
  }
  const play = playMemberFromZoneToStageSlotWithReplacement(game, player.id, {
    cardId: recoveredCardId,
    sourceZone: ZoneType.HAND,
    toSlot: selectedSlot,
  });
  if (!play) return game;
  const stateWithResolve = addAction(
    { ...play.gameState, activeEffect: null },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLAY_RECOVERED_MEMBER_TO_EMPTY_SLOT',
      recoveredCardId,
      toSlot: selectedSlot,
    }
  );
  const stateWithTriggers = enqueueCardEffectPlacementTriggersWithStageSnapshot(
    game,
    stateWithResolve,
    play,
    enqueueTriggeredCardEffects
  );
  return continuePendingCardEffects(stateWithTriggers, effect.metadata?.orderedResolution === true);
}

function startBottomSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = getWaitingRoomCandidateIds(game, player.id, aqoursMember);
  if (selectableCardIds.length === 0) {
    return finishPending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_AQOURS_MEMBER_IN_WAITING_ROOM',
    });
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_BOTTOM_STEP_ID,
      stepText: '请选择至多3张自己休息室中的『Aqours』成员，按放置顺序选择。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      selectionLabel: '按放置顺序选择『Aqours』成员',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_BOTTOM',
          ordered: true,
          sourcePlayerId: player.id,
        },
        orderedResolution,
      },
    },
    actionPayload: {
      step: 'START_SELECT_AQOURS_MEMBERS_TO_DECK_BOTTOM',
      selectableCardIds,
    },
  });
}

function finishBottomSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_007_LIVE_START_BOTTOM_AQOURS_MEMBERS_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_BOTTOM_STEP_ID
  ) {
    return game;
  }
  if (selectedCardIds.length === 0) {
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'DECLINE_BOTTOM_AQOURS_MEMBERS',
      movedCardIds: [],
      bladeBonus: 0,
    });
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const currentCandidates = getWaitingRoomCandidateIds(game, player.id, aqoursMember).filter(
    (cardId) => effect.selectableCardIds?.includes(cardId)
  );
  const move = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardIds,
    {
      candidateCardIds: currentCandidates,
      minCount: 1,
      maxCount: 3,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!move) {
    if (!wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
    return finishActive(game, effect, continuePendingCardEffects, {
      step: 'AQOURS_MEMBER_SELECTION_STALE',
      movedCardIds: [],
      bladeBonus: 0,
    });
  }
  const blade = addBladeLiveModifierForSourceMember(move.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: move.movedCardIds.length,
  });
  return finishActive(blade?.gameState ?? move.gameState, effect, continuePendingCardEffects, {
    step: 'BOTTOM_AQOURS_MEMBERS_GAIN_BLADE',
    movedCardIds: move.movedCardIds,
    bladeBonus: blade?.bladeBonus ?? 0,
  });
}

function getWaitingRoomCandidateIds(
  game: GameState,
  playerId: string,
  predicate: (card: NonNullable<ReturnType<typeof getCardById>>) => boolean
): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.waitingRoom.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && card.ownerId === playerId && predicate(card);
    }) ?? []
  );
}

function isEligibleRecoveredHandMember(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    player?.hand.cardIds.includes(cardId) === true &&
    card !== null &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    (yoshikoName(card) || rubyName(card))
  );
}

function getEmptySlots(game: GameState, playerId: string): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  return player ? MEMBER_SLOTS.filter((slot) => player.memberSlots.slots[slot] === null) : [];
}

function finishPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
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

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
