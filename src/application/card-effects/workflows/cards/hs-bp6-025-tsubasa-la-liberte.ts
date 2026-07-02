import type { CardInstance } from '../../../../domain/entities/card.js';
import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
  HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
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
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

export const HS_BP6_025_SELECT_DISCARD_STEP_ID = 'HS_BP6_025_SELECT_DISCARD';
export const HS_BP6_025_SELECT_HASUNOSORA_HEART_TARGET_STEP_ID =
  'HS_BP6_025_SELECT_HASUNOSORA_HEART_TARGET';
export const HS_BP6_025_SELECT_LOW_SCORE_LIVE_STEP_ID =
  'HS_BP6_025_SELECT_LOW_SCORE_LIVE_FROM_WAITING_ROOM';

const hasunosoraMember = and(typeIs(CardType.MEMBER), groupAliasIs('蓮ノ空'));
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp6025TsubasaLaLiberteWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
    (game, ability, options) =>
      startHsBp6025LiveStartDiscard(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
    HS_BP6_025_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startHsBp6025LiveStartTargetSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
    HS_BP6_025_SELECT_HASUNOSORA_HEART_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsBp6025LiveStartTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp6025LiveSuccessRecovery(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID,
    HS_BP6_025_SELECT_LOW_SCORE_LIVE_STEP_ID,
    (game, input, context) =>
      finishHsBp6025LiveSuccessRecovery(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp6025LiveStartDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(
        HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID
      ),
      stepId: HS_BP6_025_SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      stepText: '可以将1张手牌放置入休息室。如此做时选择1名『莲之空』成员。',
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function startHsBp6025LiveStartTargetSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID ||
    effect.stepId !== HS_BP6_025_SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const selectableCardIds = getOwnStageMemberIdsMatching(
    discardResult.gameState,
    player.id,
    hasunosoraMember
  );
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_NO_HASUNOSORA_TARGET',
        sourceSlot: effect.metadata?.sourceSlot,
        discardedCardId: discardResult.discardedCardIds[0],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: HS_BP6_025_SELECT_HASUNOSORA_HEART_TARGET_STEP_ID,
        stepText: '请选择获得[青ハート]的『莲之空』成员。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得[青ハート]的成员',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardId: discardResult.discardedCardIds[0],
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_SELECT_HASUNOSORA_TARGET',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      selectableCardIds,
    }
  );
}

function finishHsBp6025LiveStartTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID ||
    effect.stepId !== HS_BP6_025_SELECT_HASUNOSORA_HEART_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !getOwnStageMemberIdsMatching(game, player.id, hasunosoraMember).includes(selectedCardId)
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
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
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
      step: 'APPLY_HASUNOSORA_BLUE_HEART',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      targetCardId: selectedCardId,
      heartBonus: [{ color: HeartColor.BLUE, count: 1 }],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startHsBp6025LiveSuccessRecovery(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stageMemberCount = getOwnStageMemberIds(game, player.id).length;
  const selectableCardIds = getLowScoreLiveCardIds(game, player.id);
  if (stageMemberCount >= 2 && selectableCardIds.length > 0) {
    return startPendingActiveEffect(game, {
      ability,
      playerId: player.id,
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(
          HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID
        ),
        stepId: HS_BP6_025_SELECT_LOW_SCORE_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张分数3以下的LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: false,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          stageMemberCount,
          lowScoreLiveTargetCount: selectableCardIds.length,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
      actionPayload: {
        sourceCardId: ability.sourceCardId,
        step: 'START_SELECT_LOW_SCORE_LIVE',
        selectableCardIds,
        stageMemberCount,
      },
    });
  }

  const effectText = buildLiveSuccessNoOpEffectText(stageMemberCount, selectableCardIds.length);
  const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
    effectText,
    stepText:
      stageMemberCount < 2
        ? `当前自己的舞台成员为${stageMemberCount}名，未满足2名以上，不会回收。`
        : `当前休息室分数3以下LIVE为${selectableCardIds.length}张，不会回收。`,
  });
  if (confirmation) {
    return confirmation;
  }

  return skipPendingAbilityWithoutActiveEffect(
    game,
    ability,
    player.id,
    options.orderedResolution === true,
    stageMemberCount < 2 ? 'STAGE_MEMBER_COUNT_NOT_ENOUGH' : 'NO_LOW_SCORE_LIVE_TARGET',
    continuePendingCardEffects,
    {
      stageMemberCount,
      lowScoreLiveTargetCount: selectableCardIds.length,
    }
  );
}

function finishHsBp6025LiveSuccessRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID ||
    effect.stepId !== HS_BP6_025_SELECT_LOW_SCORE_LIVE_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
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
      step: 'RECOVER_LOW_SCORE_LIVE',
      selectedCardId: recoveryResult.movedCardIds[0],
      stageMemberCount: effect.metadata?.stageMemberCount ?? null,
      lowScoreLiveTargetCount: effect.metadata?.lowScoreLiveTargetCount ?? null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function buildLiveSuccessNoOpEffectText(
  stageMemberCount: number,
  lowScoreLiveTargetCount: number
): string {
  const result =
    stageMemberCount < 2
      ? '未满足舞台成员2名以上，不会回收'
      : '满足舞台成员条件，但没有分数3以下LIVE可回收';
  return `${getAbilityEffectText(
    HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID
  )}（当前舞台成员${stageMemberCount}名，休息室分数3以下LIVE ${lowScoreLiveTargetCount}张；${result}。）`;
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  extraPayload: Readonly<Record<string, unknown>> = {}
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
      ...extraPayload,
    }),
    orderedResolution
  );
}

function getLowScoreLiveCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, (card) => {
    return isLiveCardData(card.data) && card.data.score <= 3;
  });
}

function getOwnStageMemberIds(game: GameState, playerId: string): readonly string[] {
  return getOwnStageMemberIdsMatching(game, playerId, typeIs(CardType.MEMBER));
}

function getOwnStageMemberIdsMatching(
  game: GameState,
  playerId: string,
  predicate: (card: CardInstance) => boolean
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === playerId && predicate(card) ? [cardId] : [];
  });
}
