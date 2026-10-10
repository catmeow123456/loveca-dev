import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { HS_BP8_006_ON_ENTER_DISCARD_HASUNOSORA_CHOOSE_HEART_OR_ARRANGE_ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import {
  finishArrangeInspectedDeckEdgeWorkflow,
  startArrangeInspectedDeckEdgeWorkflow,
} from '../shared/arrange-inspected-deck-edge.js';

const ABILITY_ID = HS_BP8_006_ON_ENTER_DISCARD_HASUNOSORA_CHOOSE_HEART_OR_ARRANGE_ABILITY_ID;
const DISCARD_STEP_ID = 'HS_BP8_006_DISCARD_HASUNOSORA_HAND_CARD';
const CHOOSE_EFFECT_STEP_ID = 'HS_BP8_006_CHOOSE_HEART_OR_ARRANGE';
const CHOOSE_HEART_STEP_ID = 'HS_BP8_006_CHOOSE_HEART';
const ARRANGE_STEP_ID = 'HS_BP8_006_ARRANGE_TOP_THREE';
const HEART_OPTION_ID = 'gain-heart';
const ARRANGE_OPTION_ID = 'arrange-top-three';
const hasunosoraSelector = groupAliasIs('蓮ノ空');
const HEART_OPTIONS = [
  { id: HeartColor.PINK, text: 'LIVE结束时为止，此成员获得[桃ハート]。' },
  { id: HeartColor.GREEN, text: 'LIVE结束时为止，此成员获得[緑ハート]。' },
  { id: HeartColor.BLUE, text: 'LIVE结束时为止，此成员获得[青ハート]。' },
  { id: HeartColor.PURPLE, text: 'LIVE结束时为止，此成员获得[紫ハート]。' },
] as const;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp8006HimeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startDiscardCost(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? payDiscardCost(game, input.selectedCardId, deps.enqueueTriggeredCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    CHOOSE_EFFECT_STEP_ID,
    (game, input, context) =>
      chooseEffect(
        game,
        input.selectedEffectOptionIds?.length === 1 ? input.selectedEffectOptionIds[0]! : null,
        context.continuePendingCardEffects
      ),
    queryOptionSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    CHOOSE_HEART_STEP_ID,
    (game, input, context) =>
      gainHeart(
        game,
        input.selectedEffectOptionIds?.length === 1 ? input.selectedEffectOptionIds[0]! : null,
        context.continuePendingCardEffects
      ),
    queryOptionSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    ARRANGE_STEP_ID,
    (game, input, context) =>
      finishArrangeInspectedDeckEdgeWorkflow(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    queryCardSelection
  );
}

function currentCostCandidates(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.hand.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && card.ownerId === playerId && hasunosoraSelector(card);
    }) ?? []
  );
}

function startDiscardCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = currentCostCandidates(game, player.id);
  if (selectableCardIds.length === 0)
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'NO_HASUNOSORA_HAND_CARD',
        }
      ),
      orderedResolution
    );
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      ...createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution,
        stepText:
          '可以将手牌中的1张『莲之空』卡片放置入休息室。如此做时，选择获得HEART或检视并排列卡组顶3张。',
        selectionLabel: '选择要放置入休息室的『莲之空』手牌',
        confirmSelectionLabel: '放置入休息室',
        skipSelectionLabel: '不发动',
      }),
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_DISCARD_HASUNOSORA_COST',
      selectableCardIds,
    },
  });
}

function payDiscardCost(
  game: GameState,
  selectedCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== DISCARD_STEP_ID ||
    !effect.selectableCardIds?.includes(selectedCardId) ||
    !currentCostCandidates(game, effect.controllerId).includes(selectedCardId)
  )
    return game;
  const discarded = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    effect.controllerId,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discarded) return game;
  const state = recordPayCostAction(discarded.gameState, effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discarded.discardedCardIds,
  });
  return addAction(
    {
      ...state,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceLifecycleId: effect.sourceLifecycleId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: CHOOSE_EFFECT_STEP_ID,
        stepText: '请选择要结算的1项效果。',
        awaitingPlayerId: effect.controllerId,
        effectChoice: {
          mode: 'SINGLE',
          options: [
            {
              id: HEART_OPTION_ID,
              text: '选择[桃ハート]、[緑ハート]、[青ハート]或[紫ハート]中的1种，此成员获得1个所选HEART。',
            },
            {
              id: ARRANGE_OPTION_ID,
              text: '检视卡组顶3张，任意张按任意顺序放置于卡组顶，其余放置入休息室。',
            },
          ],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: '选择要结算的效果',
        confirmSelectionLabel: '结算所选效果',
        canSkipSelection: false,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          discardedCostCardIds: discarded.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_COST_CHOOSE_EFFECT',
    }
  );
}

function chooseEffect(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== CHOOSE_EFFECT_STEP_ID)
    return game;
  if (selectedOptionId === ARRANGE_OPTION_ID) {
    const arranged = startArrangeInspectedDeckEdgeWorkflow(
      { ...game, activeEffect: null },
      {
        ability: effect,
        playerId: effect.controllerId,
        effectText: effect.effectText,
        inspectCount: 3,
        requestedInspectCount: 3,
        sourceActionLabel: '登场',
        discardedCostCardIds: getDiscardedCostCardIds(effect.metadata),
        stepId: ARRANGE_STEP_ID,
        stepText: '请选择任意张数的卡片，按卡组顶从上到下的顺序排列；其余的卡片放置入休息室。',
        selectionLabel: '按放置顺序选择卡片',
        confirmSelectionLabel: '按此顺序放置于卡组顶',
        selectMin: 0,
        selectMax: 3,
        selectedDestination: 'MAIN_DECK_TOP',
        unselectedDestination: 'WAITING_ROOM',
        orderedResolution: effect.metadata?.orderedResolution === true,
      },
      continuePendingCardEffects
    );
    return arranged.activeEffect?.abilityId === effect.abilityId &&
      arranged.activeEffect.stepId === ARRANGE_STEP_ID
      ? {
          ...arranged,
          activeEffect: {
            ...arranged.activeEffect,
            canSkipSelection: true,
            skipSelectionLabel: '全部放置入休息室',
          },
        }
      : arranged;
  }
  if (selectedOptionId !== HEART_OPTION_ID) return game;
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: CHOOSE_HEART_STEP_ID,
      stepText: '请选择LIVE结束时为止此成员获得的1个HEART。',
      effectChoice: {
        mode: 'SINGLE',
        options: HEART_OPTIONS,
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择要获得的HEART',
      confirmSelectionLabel: '获得HEART',
    },
  };
}

function gainHeart(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const selected = HEART_OPTIONS.find((option) => option.id === selectedOptionId);
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== CHOOSE_HEART_STEP_ID ||
    !selected
  )
    return game;
  const result = isCurrentStageMemberAbilitySource(game, effect)
    ? addHeartLiveModifierForSourceMember(
        { ...game, activeEffect: null },
        {
          playerId: effect.controllerId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          hearts: [{ color: selected.id, count: 1 }],
        }
      )
    : null;
  return continuePendingCardEffects(
    addAction(
      result?.gameState ?? { ...game, activeEffect: null },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: result ? 'GAIN_SELECTED_HEART' : 'SOURCE_RULES_OBJECT_LEFT_STAGE',
        heartColor: selected.id,
        heartCount: result ? 1 : 0,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function getDiscardedCostCardIds(
  metadata: Readonly<Record<string, unknown>> | undefined
): readonly string[] {
  return Array.isArray(metadata?.discardedCostCardIds)
    ? metadata.discardedCostCardIds.filter((cardId): cardId is string => typeof cardId === 'string')
    : [];
}
