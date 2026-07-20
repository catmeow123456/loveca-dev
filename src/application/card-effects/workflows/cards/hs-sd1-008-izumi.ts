import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID } from '../../ability-ids.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'HS_SD1_008_LIVE_START_SELECT_HASUNOSORA_DISCARD_TWO';
const SELECT_HEART_STEP_ID = 'HS_SD1_008_LIVE_START_SELECT_HEART_COLOR';
const SELECT_TARGET_STEP_ID = 'HS_SD1_008_LIVE_START_SELECT_OTHER_HASUNOSORA_TARGET';
const DECLINE_OPTION_LABEL = '不发动';

const HEART_OPTIONS: readonly {
  readonly id: HeartColor;
  readonly label: string;
  readonly hearts: readonly { readonly color: HeartColor; readonly count: number }[];
}[] = [
  { id: HeartColor.PINK, label: '[桃ハート]', hearts: [{ color: HeartColor.PINK, count: 2 }] },
  { id: HeartColor.GREEN, label: '[緑ハート]', hearts: [{ color: HeartColor.GREEN, count: 2 }] },
  { id: HeartColor.BLUE, label: '[青ハート]', hearts: [{ color: HeartColor.BLUE, count: 2 }] },
  { id: HeartColor.PURPLE, label: '[紫ハート]', hearts: [{ color: HeartColor.PURPLE, count: 2 }] },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsSd1008IzumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1008LiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHsSd1008Discard(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
    SELECT_HEART_STEP_ID,
    (game, input, context) =>
      finishHsSd1008HeartSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID,
    SELECT_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsSd1008Target(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startHsSd1008LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const discardCandidateIds = getHasunosoraHandCardIds(game, player.id);
  const targetCardIds = getOtherHasunosoraStageMemberCardIds(game, player.id, ability.sourceCardId);
  if (discardCandidateIds.length < 2) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NOT_ENOUGH_HASUNOSORA_HAND_CARDS',
      { selectableCardIds: discardCandidateIds, targetCardIds }
    );
  }
  if (targetCardIds.length === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_OTHER_HASUNOSORA_TARGET',
      { selectableCardIds: discardCandidateIds, targetCardIds }
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
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: '可以将手牌中的2张『莲之空』卡放置入休息室。如此做时，选择1种 Heart 与目标成员。',
      awaitingPlayerId: player.id,
      selectableCardIds: discardCandidateIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '选择要放置入休息室的莲之空卡',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: DECLINE_OPTION_LABEL,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HASUNOSORA_DISCARD_TWO',
      selectableCardIds: discardCandidateIds,
      targetCardIds,
    },
  });
}

function finishHsSd1008Discard(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getHsSd1008Effect(game, SELECT_DISCARD_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  if (selectedCardIds.length === 0 && effect.canSkipSelection === true) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_DISCARD_TWO',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const currentCandidates = getHasunosoraHandCardIds(game, player.id);
  if (
    uniqueSelectedCardIds.length !== 2 ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true || !currentCandidates.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: 2,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const targetCardIds = getOtherHasunosoraStageMemberCardIds(
    discardResult.gameState,
    player.id,
    effect.sourceCardId
  );
  if (targetCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_TWO_NO_OTHER_HASUNOSORA_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_HEART_STEP_ID,
        stepText: '请选择要给予目标成员的 Heart。',
        selectableCardIds: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectableCardVisibility: undefined,
        selectableOptions: undefined,
        effectChoice: {
          mode: 'SINGLE',
          options: HEART_OPTIONS.map((option) => ({
            id: option.id,
            text: `选择的成员获得${option.label}${option.label}。`,
          })),
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: '选择目标成员要获得的Heart',
        confirmSelectionLabel: '获得Heart',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: discardResult.discardedCardIds,
          targetCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_TWO_SELECT_HEART',
      discardedHandCardIds: discardResult.discardedCardIds,
      targetCardIds,
    }
  );
}

function finishHsSd1008HeartSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getHsSd1008Effect(game, SELECT_HEART_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const selectedHeart = HEART_OPTIONS.find((option) => option.id === selectedOptionId);
  if (!effect || !player || !selectedHeart) {
    return game;
  }

  const targetCardIds = getOtherHasunosoraStageMemberCardIds(game, player.id, effect.sourceCardId);
  if (targetCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_HEART_NO_OTHER_HASUNOSORA_TARGET',
        discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
        selectedHeartColor: selectedHeart.id,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_TARGET_STEP_ID,
        stepText: `请选择此成员以外的1名『莲之空』成员。LIVE结束时为止，该成员获得${selectedHeart.label}${selectedHeart.label}。`,
        selectableCardIds: targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectableOptions: undefined,
        effectChoice: undefined,
        selectionLabel: '选择获得 Heart 的莲之空成员',
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedHeartColor: selectedHeart.id,
          selectedHeartBonus: selectedHeart.hearts,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_HEART_SELECT_TARGET',
      discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
      selectedHeartColor: selectedHeart.id,
      targetCardIds,
    }
  );
}

function finishHsSd1008Target(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getHsSd1008Effect(game, SELECT_TARGET_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const heartColor = getHeartColorMetadata(effect, 'selectedHeartColor');
  const heartOption = HEART_OPTIONS.find((option) => option.id === heartColor);
  if (
    !effect ||
    !player ||
    !selectedCardId ||
    !heartOption ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getOtherHasunosoraStageMemberCardIds(game, player.id, effect.sourceCardId).includes(
      selectedCardId
    )
  ) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: heartOption.hearts,
    }
  );
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_OTHER_HASUNOSORA_GAIN_SELECTED_HEART',
      discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
      selectedHeartColor: heartOption.id,
      targetMemberCardId: selectedCardId,
      heartBonus: heartOption.hearts,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getHsSd1008Effect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    HS_SD1_008_LIVE_START_DISCARD_TWO_HASUNOSORA_CHOOSE_HEART_TARGET_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function getHasunosoraHandCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const selector = groupAliasIs('蓮ノ空');
  return player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

function getOtherHasunosoraStageMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    (card) => card.data.cardType === CardType.MEMBER && groupAliasIs('蓮ノ空')(card)
  ).filter((cardId) => cardId !== sourceCardId);
}

function getStringArrayMetadata(effect: ActiveEffectState | null, key: string): readonly string[] {
  const value = effect?.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function getHeartColorMetadata(effect: ActiveEffectState | null, key: string): HeartColor | null {
  const value = effect?.metadata?.[key];
  return typeof value === 'string' && HEART_OPTIONS.some((option) => option.id === value)
    ? (value as HeartColor)
    : null;
}
