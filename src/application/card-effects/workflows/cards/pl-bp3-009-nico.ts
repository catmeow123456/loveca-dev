import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
  PL_BP3_009_ON_ENTER_COST_THIRTEEN_DRAW_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-bp3-009';
const MIN_STAGE_MEMBER_COST = 13;
const SELECT_HEART_COLOR_STEP_ID = 'PL_BP3_009_SELECT_HEART_COLOR';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

const HEART_OPTIONS = [
  { id: 'PINK', label: '[桃ハート]', color: HeartColor.PINK },
  { id: 'YELLOW', label: '[黄ハート]', color: HeartColor.YELLOW },
  { id: 'PURPLE', label: '[紫ハート]', color: HeartColor.PURPLE },
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3009NicoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_009_ON_ENTER_COST_THIRTEEN_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
        game,
        ability,
        options,
        { effectText: getOnEnterConfirmationEffectText(game, ability) }
      );
      if (confirmation) {
        return confirmation;
      }
      return resolveOnEnterDraw(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );

  registerActivatedAbilityHandler(
    PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
    (game, playerId, cardId) => startActivatedChooseHeart(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
    SELECT_HEART_COLOR_STEP_ID,
    (game, input, context) =>
      finishActivatedChooseHeart(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function getOnEnterConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const qualifyingMemberCardIds = getQualifyingStageMemberCardIds(game, ability.controllerId);
  const conditionMet = qualifyingMemberCardIds.length > 0;
  const canDraw =
    !!player && (player.mainDeck.cardIds.length > 0 || player.waitingRoom.cardIds.length > 0);
  const resultText = !conditionMet
    ? '未满足条件，实际不抽卡'
    : canDraw
      ? '满足条件，实际抽1张卡'
      : '满足条件，但当前没有可抽的卡，实际抽0张卡';
  return `${getAbilityEffectText(ability.abilityId)}（当前自己舞台费用大于等于13的成员 ${qualifyingMemberCardIds.length}名，${resultText}。）`;
}

function resolveOnEnterDraw(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const qualifyingMemberCardIds = getQualifyingStageMemberCardIds(game, player.id);
  const conditionMet = qualifyingMemberCardIds.length > 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = conditionMet ? drawCardsForPlayer(stateWithoutPending, player.id, 1) : null;
  const stateAfterDraw = drawResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterDraw, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: conditionMet ? 'COST_THIRTEEN_STAGE_MEMBER_DRAW_ONE' : 'NO_QUALIFYING_STAGE_MEMBER',
      conditionMet,
      qualifyingMemberCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function getQualifyingStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const result: string[] = [];
  for (const slot of MEMBER_SLOT_ORDER) {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    if (
      cardId &&
      card &&
      isMemberCardData(card.data) &&
      card.data.cardType === CardType.MEMBER &&
      getMemberEffectiveCost(game, playerId, cardId) >= MIN_STAGE_MEMBER_COST
    ) {
      result.push(cardId);
    }
  }
  return result;
}

function startActivatedChooseHeart(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const source = getValidActivatedSource(game, playerId, cardId);
  if (!source || source.orientation !== OrientationState.ACTIVE) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', playerId, {
          abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot: source.sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  const stateAfterUse = recordAbilityUseForContext(stateWithTriggers.gameState, playerId, {
    abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...stateAfterUse,
      activeEffect: {
        id: `${PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID}:${cardId}:turn-${stateAfterUse.turnCount}:action-${stateAfterUse.actionHistory.length}`,
        abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
        ),
        stepId: SELECT_HEART_COLOR_STEP_ID,
        stepText: '请选择1种Heart。LIVE结束时为止，此成员获得1个选择的Heart。',
        awaitingPlayerId: playerId,
        selectableOptions: HEART_OPTIONS.map((option) => ({
          id: option.id,
          label: option.label,
        })),
        confirmSelectionLabel: '选择Heart',
        canSkipSelection: false,
        metadata: { sourceSlot: source.sourceSlot },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: source.sourceSlot,
      step: 'START_SELECT_HEART_COLOR',
    }
  );
}

function finishActivatedChooseHeart(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const option = HEART_OPTIONS.find((candidate) => candidate.id === selectedOptionId);
  if (
    !effect ||
    effect.abilityId !== PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_HEART_COLOR_STEP_ID ||
    !option
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_SOURCE_NOT_ON_STAGE',
        selectedHeartColor: option.color,
        heartBonus: [],
      }),
      false
    );
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    memberCardId: effect.sourceCardId,
    hearts: [{ color: option.color, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: sourceSlot,
      step: 'GAIN_SELECTED_HEART',
      selectedHeartColor: option.color,
      heartBonus: heartResult.heartBonus,
    }),
    false
  );
}

function getValidActivatedSource(
  game: GameState,
  playerId: string,
  cardId: string
): { readonly sourceSlot: SlotPosition; readonly orientation: OrientationState } | null {
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation === undefined
  ) {
    return null;
  }
  return { sourceSlot, orientation: sourceState.orientation };
}
