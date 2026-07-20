import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, not, typeIs } from '../../../effects/card-selectors.js';
import { getMovedToStageThisTurnStageMemberIdsMatching } from '../../../effects/conditions.js';
import { PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const PL_S_BP5_005_SELECT_DISCARD_STEP_ID = 'PL_S_BP5_005_SELECT_DISCARD';
export const PL_S_BP5_005_SELECT_HEART_STEP_ID = 'PL_S_BP5_005_SELECT_HEART';

const HEART_OPTIONS = [
  { id: HeartColor.YELLOW, label: '[黄ハート]' },
  { id: HeartColor.GREEN, label: '[緑ハート]' },
  { id: HeartColor.BLUE, label: '[青ハート]' },
] as const;

const nonAqoursMember = and(typeIs(CardType.MEMBER), not(groupAliasIs('Aqours')));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5005YouWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID,
    (game, ability, options, context) =>
      startYouDiscardCost(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID,
    PL_S_BP5_005_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishYouDiscardCostStartHeartSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'SKIP_DISCARD_CHOOSE_HEART',
          })
  );
  registerActiveEffectStepHandler(
    PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID,
    PL_S_BP5_005_SELECT_HEART_STEP_ID,
    (game, input, context) =>
      finishYouHeartSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startYouDiscardCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceOnStage = Object.values(player.memberSlots.slots).includes(ability.sourceCardId);
  if (!sourceOnStage) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      { step: 'SOURCE_NOT_ON_STAGE' },
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
      stepId: PL_S_BP5_005_SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      stepText: '可以将1张手牌放置入休息室。如此做时，选择1种 Heart 颜色。',
      selectionLabel: '选择要放置入休息室的手牌',
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_FOR_HEART',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishYouDiscardCostStartHeartSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID ||
    effect.stepId !== PL_S_BP5_005_SELECT_DISCARD_STEP_ID ||
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

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedCardId: discardResult.discardedCardIds[0],
  });

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: PL_S_BP5_005_SELECT_HEART_STEP_ID,
        stepText: '请选择1种 Heart 颜色。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableOptions: undefined,
        effectChoice: {
          mode: 'SINGLE',
          options: HEART_OPTIONS.map((option) => ({
            id: option.id,
            text: `自己舞台上这个回合登场的成员中，所有『Aqours』以外的成员获得${option.label}。`,
          })),
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: '选择 Heart 颜色',
        confirmSelectionLabel: '获得Heart',
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
      step: 'DISCARD_SELECT_HEART',
      discardedCardId: discardResult.discardedCardIds[0],
      selectableOptionIds: HEART_OPTIONS.map((option) => option.id),
      targetMemberCardIds: getEnteredNonAqoursTargetIds(stateAfterCost, player.id),
    }
  );
}

function finishYouHeartSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const selectedHeart = getSelectedHeartColor(selectedOptionId);
  if (
    !effect ||
    effect.abilityId !==
      PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID ||
    effect.stepId !== PL_S_BP5_005_SELECT_HEART_STEP_ID ||
    !player ||
    selectedHeart === null
  ) {
    return game;
  }

  const targetMemberCardIds = getEnteredNonAqoursTargetIds(game, player.id);
  let state: GameState = { ...game, activeEffect: null };
  for (const memberCardId of targetMemberCardIds) {
    const modifierResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: selectedHeart, count: 1 }],
    });
    if (!modifierResult) {
      return game;
    }
    state = modifierResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        targetMemberCardIds.length > 0
          ? 'CHOOSE_HEART_APPLY_ENTERED_NON_AQOURS_HEART'
          : 'CHOOSE_HEART_NO_TARGET_AFTER_COST',
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      selectedHeartColor: selectedHeart,
      selectedHeartLabel: HEART_OPTIONS.find((option) => option.id === selectedHeart)?.label,
      targetMemberCardIds,
      heartBonus: [{ color: selectedHeart, count: 1 }],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
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
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getEnteredNonAqoursTargetIds(game: GameState, playerId: string): readonly string[] {
  return getMovedToStageThisTurnStageMemberIdsMatching(game, playerId, nonAqoursMember);
}

function getSelectedHeartColor(value: string | null): HeartColor | null {
  return value === HeartColor.YELLOW || value === HeartColor.GREEN || value === HeartColor.BLUE
    ? value
    : null;
}
