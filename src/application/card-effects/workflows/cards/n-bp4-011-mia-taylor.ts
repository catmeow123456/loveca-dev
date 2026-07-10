import {
  isLiveCardData,
  isMemberCardData,
  type BaseCardData,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  cardBelongsToGroup,
  hasAtLeastDifferentNamedCards,
} from '../../../../shared/utils/card-identity.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
  PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
} from '../../ability-ids.js';

const SELECT_LIVE_DISCARD_STEP_ID = 'PL_N_BP4_011_SELECT_HAND_LIVE_TO_DISCARD';
const SELECT_HEART_STEP_ID = 'PL_N_BP4_011_SELECT_HEART_COLOR';
const SELECT_RECOVERY_STEP_ID = 'PL_N_BP4_011_SELECT_WAITING_ROOM_NIJIGASAKI_LIVE';
const MILL_COUNT = 5;
const DISTINCT_NIJIGASAKI_LIVE_THRESHOLD = 3;

const HEART_COLOR_OPTIONS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

const HEART_COLOR_OPTION_LABELS: Readonly<Record<(typeof HEART_COLOR_OPTIONS)[number], string>> = {
  [HeartColor.PINK]: '[桃ハート]',
  [HeartColor.RED]: '[赤ハート]',
  [HeartColor.YELLOW]: '[黄ハート]',
  [HeartColor.GREEN]: '[緑ハート]',
  [HeartColor.BLUE]: '[青ハート]',
  [HeartColor.PURPLE]: '[紫ハート]',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4011MiaTaylorWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startMiaLiveStartDiscardLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
    SELECT_LIVE_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startMiaHeartSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_LIVE_CARD',
          })
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID,
    SELECT_HEART_STEP_ID,
    (game, input, context) =>
      finishMiaHeartSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startMiaLiveSuccessMillRecover(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
    SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishMiaLiveSuccessRecovery(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startMiaLiveStartDiscardLive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isMiaSourceOnStage(game, player.id, ability.sourceCardId)) {
    return consumePendingWithAction(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      'SOURCE_NOT_ON_STAGE',
      continuePendingCardEffects
    );
  }

  const selectableCardIds = getHandLiveCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumePendingWithAction(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_HAND_LIVE_CARD',
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_LIVE_DISCARD_STEP_ID,
      stepText: '可以将手牌中的1张LIVE卡放置入休息室。',
      selectableCardIds,
      orderedResolution,
      selectionLabel: '选择要放置入休息室的LIVE卡',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HAND_LIVE_TO_DISCARD',
      selectableCardIds,
    },
  });
}

function startMiaHeartSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_LIVE_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (!isMiaSourceOnStage(game, player.id, effect.sourceCardId)) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_BEFORE_DISCARD',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const discardCard = getCardById(game, discardCardId);
  if (
    !discardCard ||
    discardCard.ownerId !== player.id ||
    !isLiveCardData(discardCard.data) ||
    !player.hand.cardIds.includes(discardCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_HEART_STEP_ID,
        stepText: '请选择本次LIVE结束前获得的Heart颜色。',
        selectableCardIds: [],
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: undefined,
        selectionLabel: undefined,
        confirmSelectionLabel: '获得Heart',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        selectableOptions: HEART_COLOR_OPTIONS.map((color) => ({
          id: color,
          label: HEART_COLOR_OPTION_LABELS[color],
        })),
        metadata: {
          ...effect.metadata,
          discardedLiveCardId: discardResult.discardedCardIds[0],
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_LIVE_CARD',
      discardedCardId: discardResult.discardedCardIds[0],
    }
  );
}

function finishMiaHeartSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_011_LIVE_START_DISCARD_LIVE_GAIN_CHOSEN_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_HEART_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedColor = isSelectableHeartColor(selectedOptionId) ? selectedOptionId : null;
  if (!player || selectedColor === null) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: selectedColor, count: 1 }],
    }
  );
  const stateAfterHeart = heartResult?.gameState ?? { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(stateAfterHeart, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: heartResult ? 'APPLY_SELECTED_HEART' : 'SOURCE_MEMBER_HEART_UNAVAILABLE',
      discardedCardId: effect.metadata?.discardedLiveCardId,
      heartColor: heartResult ? selectedColor : null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startMiaLiveSuccessMillRecover(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isMiaSourceOnStage(game, player.id, ability.sourceCardId)) {
    return consumePendingWithAction(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      'SOURCE_NOT_ON_STAGE',
      continuePendingCardEffects
    );
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    MILL_COUNT,
    enqueueTriggeredCardEffects
  );
  if (!millResult) {
    return game;
  }

  const stateWithoutPending: GameState = consumePendingAbility(millResult.gameState, ability);
  const waitingNijigasakiLiveCardIds = getWaitingRoomNijigasakiLiveCardIds(
    stateWithoutPending,
    player.id
  );
  const differentNameCount = countDifferentLiveNames(
    stateWithoutPending,
    waitingNijigasakiLiveCardIds
  );
  if (
    !hasAtLeastDifferentNamedCards(
      waitingNijigasakiLiveCardIds,
      DISTINCT_NIJIGASAKI_LIVE_THRESHOLD,
      (cardId) => getCardById(stateWithoutPending, cardId)?.data ?? null,
      { getSecondaryKey: (cardId) => cardId }
    )
  ) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'MILL_FIVE_DISTINCT_NIJIGASAKI_LIVE_NOT_MET',
        milledCardIds: millResult.movedCardIds,
        refreshCount: millResult.refreshCount,
        differentNameCount,
        waitingNijigasakiLiveCardIds,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_RECOVERY_STEP_ID,
        stepText: '请选择自己休息室1张「虹ヶ咲」LIVE加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds: waitingNijigasakiLiveCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择加入手牌的虹咲LIVE',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          sourceZone: ZoneType.WAITING_ROOM,
          milledCardIds: millResult.movedCardIds,
          refreshCount: millResult.refreshCount,
          differentNameCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'MILL_FIVE_SELECT_NIJIGASAKI_LIVE_RECOVERY',
      milledCardIds: millResult.movedCardIds,
      refreshCount: millResult.refreshCount,
      differentNameCount,
      selectableCardIds: waitingNijigasakiLiveCardIds,
    }
  );
}

function finishMiaLiveSuccessRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_RECOVERY_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCard = selectedCardId ? getCardById(game, selectedCardId) : null;
  if (
    !player ||
    !selectedCard ||
    selectedCard.ownerId !== player.id ||
    !isNijigasakiLiveCard(selectedCard.data) ||
    !player.waitingRoom.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_NIJIGASAKI_LIVE_FROM_WAITING_ROOM',
      selectedCardId,
      recoveredCardIds: recoveryResult.movedCardIds,
      milledCardIds: getStringArrayMetadata(effect.metadata?.milledCardIds),
      refreshCount: getNumberMetadata(effect.metadata?.refreshCount) ?? 0,
      differentNameCount: getNumberMetadata(effect.metadata?.differentNameCount) ?? 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingWithAction(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction(consumePendingAbility(game, ability), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      ...payload,
    }),
    orderedResolution
  );
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}

function isMiaSourceOnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const sourceCard = getCardById(game, sourceCardId);
  return (
    sourceCard !== null &&
    isMemberCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp4-011') &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null
  );
}

function getHandLiveCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
}

function getWaitingRoomNijigasakiLiveCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === playerId && isNijigasakiLiveCard(card.data);
  });
}

function isNijigasakiLiveCard(data: BaseCardData): boolean {
  return isLiveCardData(data) && cardBelongsToGroup(data, '虹ヶ咲');
}

function countDifferentLiveNames(game: GameState, cardIds: readonly string[]): number {
  const names = new Set<string>();
  for (const cardId of cardIds) {
    const card = getCardById(game, cardId);
    if (card) {
      names.add(card.data.name);
    }
  }
  return names.size;
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function getNumberMetadata(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function isSelectableHeartColor(value: string | null): value is (typeof HEART_COLOR_OPTIONS)[number] {
  return HEART_COLOR_OPTIONS.some((color) => color === value);
}
