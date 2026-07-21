import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  hasBladeHeart,
  not,
  or,
  typeIs,
} from '../../../effects/card-selectors.js';
import { countCardsMatchingSelector } from '../../../effects/conditions.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import {
  N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
  N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
} from '../../ability-ids.js';
import {
  activateWaitingEnergyCardsForPlayer,
  addBladeLiveModifierForSourceMember,
} from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveExactTopDeckCardsToWaitingRoomAsCostAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import {
  finishArrangeInspectedDeckTopWorkflow,
  startArrangeInspectedDeckTopWorkflow,
} from '../shared/arrange-inspected-deck-top.js';

const INSPECT_TOP_FOUR_STEP_ID = 'N_BP7_006_ARRANGE_INSPECTED_TOP_FOUR';
const CHOOSE_ENERGY_OR_BLADE_STEP_ID = 'N_BP7_006_CHOOSE_ENERGY_OR_BLADE';
const REVEAL_MILL_COST_RESULT_STEP_ID = 'N_BP7_006_REVEAL_MILL_COST_RESULT';
const INSPECT_COUNT = 4;
const MILL_COST_COUNT = 3;
const ACTIVATE_ENERGY_OPTION_ID = 'activate-two-energy';
const GAIN_BLADE_OPTION_ID = 'gain-two-blade';

const MILL_HIT_SELECTOR = or(
  and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲')),
  and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'), not(hasBladeHeart()))
);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7006KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
}): void {
  registerActivatedAbilityHandler(
    N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
    (game, playerId, sourceCardId) => startInspectTopFour(game, playerId, sourceCardId, deps)
  );
  registerActiveEffectStepHandler(
    N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
    INSPECT_TOP_FOUR_STEP_ID,
    (game, input, context) =>
      finishArrangeInspectedDeckTopWorkflow(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerActivatedAbilityHandler(
    N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
    (game, playerId, sourceCardId) => startMillTopThree(game, playerId, sourceCardId, deps)
  );
  registerActiveEffectStepHandler(
    N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
    CHOOSE_ENERGY_OR_BLADE_STEP_ID,
    (game, input, context) =>
      finishEnergyOrBladeChoice(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
    REVEAL_MILL_COST_RESULT_STEP_ID,
    (game, _input, context) => finishMillCostPublicResult(game, context.continuePendingCardEffects)
  );
}

function startInspectTopFour(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
  }
): GameState {
  const player = getValidSourceController(game, playerId, sourceCardId);
  if (!player) return game;

  const costPayment = payImmediateEffectCosts(game, player.id, sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment || costPayment.paidEnergyCardIds.length !== 1) return game;

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
    sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
    sourceCardId,
  });

  const effectId = `${N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`;
  return startArrangeInspectedDeckTopWorkflow(
    state,
    {
      ability: {
        id: effectId,
        abilityId: N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
        sourceCardId,
        controllerId: player.id,
      },
      playerId: player.id,
      effectText: getAbilityEffectText(N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID),
      inspectCount: INSPECT_COUNT,
      stepId: INSPECT_TOP_FOUR_STEP_ID,
      stepText: '请按卡组顶从上到下的放置顺序排列实际检视到的卡牌。',
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      selectMin: 0,
      selectMax: INSPECT_COUNT,
      selectedDestination: 'MAIN_DECK_TOP',
      unselectedDestination: 'MAIN_DECK_TOP',
      requireAllInspected: true,
      orderedResolution: false,
    },
    deps.continuePendingCardEffects
  );
}

function startMillTopThree(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
  }
): GameState {
  const player = getValidSourceController(game, playerId, sourceCardId);
  if (!player || player.mainDeck.cardIds.length < MILL_COST_COUNT) return game;

  const abilityId = N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID;
  const millResult = moveExactTopDeckCardsToWaitingRoomAsCostAndEnqueueTriggers(
    game,
    player.id,
    MILL_COST_COUNT,
    deps.enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId,
        abilityId,
      },
      prepareGameStateBeforeEnqueue: (state, movedCardIds, refreshCount) =>
        recordAbilityUseForContext(
          recordPayCostAction(state, player.id, {
            abilityId,
            sourceCardId,
            movedCardIds,
            milledCardIds: movedCardIds,
            count: movedCardIds.length,
            refreshCount,
          }),
          player.id,
          { abilityId, sourceCardId }
        ),
    }
  );
  if (!millResult || millResult.movedCardIds.length !== MILL_COST_COUNT) return game;

  const hit =
    countCardsMatchingSelector(millResult.gameState, millResult.movedCardIds, MILL_HIT_SELECTOR) >
    0;
  if (!hit) {
    const effectId = `${abilityId}:${sourceCardId}:turn-${millResult.gameState.turnCount}:action-${millResult.gameState.actionHistory.length}`;
    return addAction(
      {
        ...millResult.gameState,
        activeEffect: {
          id: effectId,
          abilityId,
          sourceCardId,
          controllerId: player.id,
          effectText: getAbilityEffectText(abilityId),
          stepId: REVEAL_MILL_COST_RESULT_STEP_ID,
          stepText: '本次费用放置的卡未满足条件。',
          awaitingPlayerId: player.id,
          revealedCardIds: [...new Set(millResult.movedCardIds)],
          selectionLabel: '公开的卡片',
          confirmSelectionLabel: '确认公开结果',
          metadata: {
            movedCardIds: millResult.movedCardIds,
            refreshCount: millResult.refreshCount,
            conditionMet: false,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        abilityId,
        sourceCardId,
        step: 'REVEAL_MILL_COST_CONDITION_NOT_MET',
        movedCardIds: millResult.movedCardIds,
        refreshCount: millResult.refreshCount,
        conditionMet: false,
      }
    );
  }

  const effectId = `${abilityId}:${sourceCardId}:turn-${millResult.gameState.turnCount}:action-${millResult.gameState.actionHistory.length}`;
  return addAction(
    {
      ...millResult.gameState,
      activeEffect: {
        id: effectId,
        abilityId,
        sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(abilityId),
        stepId: CHOOSE_ENERGY_OR_BLADE_STEP_ID,
        stepText: '条件已满足，请选择1项。',
        awaitingPlayerId: player.id,
        revealedCardIds: millResult.movedCardIds,
        selectableOptions: [
          { id: ACTIVATE_ENERGY_OPTION_ID, label: '将2张能量变为活跃状态' },
          { id: GAIN_BLADE_OPTION_ID, label: '获得[BLADE][BLADE]' },
        ],
        effectChoice: {
          mode: 'SINGLE',
          options: [
            { id: ACTIVATE_ENERGY_OPTION_ID, text: '将2张能量变为活跃状态。' },
            {
              id: GAIN_BLADE_OPTION_ID,
              text: 'LIVE结束时为止，此成员获得[BLADE][BLADE]。',
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
          movedCardIds: millResult.movedCardIds,
          refreshCount: millResult.refreshCount,
          conditionMet: true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId,
      sourceCardId,
      step: 'MILL_COST_CHOOSE_EFFECT',
      movedCardIds: millResult.movedCardIds,
      refreshCount: millResult.refreshCount,
      conditionMet: true,
    }
  );
}

function finishMillCostPublicResult(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID ||
    effect.stepId !== REVEAL_MILL_COST_RESULT_STEP_ID ||
    effect.metadata?.conditionMet !== false
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  const movedCardIds = getStringArrayMetadata(effect.metadata?.movedCardIds);
  const refreshCount =
    typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0;
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_MILL_COST_CONDITION_NOT_MET',
      movedCardIds,
      refreshCount,
      conditionMet: false,
    }),
    false
  );
}

function finishEnergyOrBladeChoice(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID ||
    effect.stepId !== CHOOSE_ENERGY_OR_BLADE_STEP_ID ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  let state = game;
  let actionPayload: Readonly<Record<string, unknown>>;
  if (selectedOptionId === ACTIVATE_ENERGY_OPTION_ID) {
    const waitingEnergyCount = getEnergyCardIdsByOrientation(
      state,
      player.id,
      OrientationState.WAITING
    ).length;
    const activationResult = activateWaitingEnergyCardsForPlayer(
      state,
      player.id,
      Math.min(2, waitingEnergyCount)
    );
    if (!activationResult) return game;
    state = activationResult.gameState;
    actionPayload = {
      selectedOptionId,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    };
  } else if (selectedOptionId === GAIN_BLADE_OPTION_ID) {
    const modifierResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 2,
    });
    state = modifierResult?.gameState ?? state;
    actionPayload = {
      selectedOptionId,
      bladeAmount: modifierResult ? 2 : 0,
    };
  } else {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_SELECTED_EFFECT',
      movedCardIds: effect.metadata?.movedCardIds,
      refreshCount: effect.metadata?.refreshCount,
      conditionMet: true,
      ...actionPayload,
    }),
    false
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function getValidSourceController(
  game: GameState,
  playerId: string,
  sourceCardId: string
): ReturnType<typeof getPlayerById> {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  ) {
    return null;
  }
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (
    !player ||
    !source ||
    source.ownerId !== playerId ||
    source.data.cardCode !== 'PL!N-bp7-006-SEC' ||
    !isMemberCardData(source.data) ||
    getSourceMemberSlot(game, playerId, sourceCardId) === null
  ) {
    return null;
  }
  return player;
}
