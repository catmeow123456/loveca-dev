import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, OrientationState, type SlotPosition } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  and,
  costLte,
  memberPrintedBladeEquals,
  type CardSelector,
  typeIs,
} from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP3_017_023_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
} from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const SOURCE_WAIT_COST_STEP_ID = 'WAIT_SELF_OPPONENT_WAIT_CHOOSE_ACTIVATION';
const OPPONENT_TARGET_STEP_ID = 'WAIT_SELF_OPPONENT_WAIT_SELECT_TARGET';
const ACTIVATE_SOURCE_WAIT_COST_OPTION_ID = 'activate';

const printedBladeFourMember = and(typeIs(CardType.MEMBER), memberPrintedBladeEquals(4));
const costLteFourMember = and(typeIs(CardType.MEMBER), costLte(4));

interface WaitSelfOpponentWaitConfig {
  readonly selector: CardSelector;
  readonly sourceStepText: string;
  readonly targetStepText: string;
  readonly selectionLabel: string;
  readonly targetKind: 'ORIGINAL_BLADE_FOUR' | 'COST_LTE_FOUR';
  readonly noTargetAfterCostStep: string;
  readonly staleNoTargetStep: string;
  readonly startTargetStep: string;
  readonly waitTargetStep: string;
  readonly targetSelectionPayload: Readonly<Record<string, unknown>>;
  readonly resolvedTargetPayload: Readonly<Record<string, unknown>>;
}

const CONFIGS = new Map<string, WaitSelfOpponentWaitConfig>([
  ...[
    PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
    PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  ].map(
    (abilityId) =>
      [
        abilityId,
        {
          selector: printedBladeFourMember,
          sourceStepText:
            '可以将此成员变为待机状态。如此做后，选择对方舞台上1名原本BLADE正好4个且当前非待机的成员变为待机状态。',
          targetStepText: '请选择对方舞台上1名原本BLADE正好4个且当前非待机的成员变为待机状态。',
          selectionLabel: '选择对方舞台上原本BLADE正好4个的成员',
          targetKind: 'ORIGINAL_BLADE_FOUR' as const,
          noTargetAfterCostStep: 'NO_OPPONENT_ORIGINAL_BLADE_FOUR_TARGET_AFTER_COST',
          staleNoTargetStep: 'STALE_NO_OPPONENT_ORIGINAL_BLADE_FOUR_TARGET',
          startTargetStep: 'START_SELECT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
          waitTargetStep: 'WAIT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
          targetSelectionPayload: {},
          resolvedTargetPayload: { targetPrintedBlade: 4 },
        },
      ] as const
  ),
  ...[
    PL_N_BP3_017_023_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
    PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
  ].map(
    (abilityId) =>
      [
        abilityId,
        {
          selector: costLteFourMember,
          sourceStepText:
            '可以将此成员变为待机状态。如此做后，选择对方舞台上1名费用小于等于4且当前非待机的成员变为待机状态。',
          targetStepText: '请选择对方舞台上1名费用小于等于4且当前非待机的成员变为待机状态。',
          selectionLabel: '选择对方舞台上费用小于等于4的成员',
          targetKind: 'COST_LTE_FOUR' as const,
          noTargetAfterCostStep: 'NO_OPPONENT_COST_LTE_FOUR_TARGET_AFTER_COST',
          staleNoTargetStep: 'STALE_NO_OPPONENT_COST_LTE_FOUR_TARGET',
          startTargetStep: 'START_SELECT_OPPONENT_COST_LTE_FOUR_MEMBER',
          waitTargetStep: 'WAIT_OPPONENT_COST_LTE_FOUR_MEMBER',
          targetSelectionPayload: { targetKind: 'COST_LTE_FOUR', targetMaxCost: 4 },
          resolvedTargetPayload: { targetKind: 'COST_LTE_FOUR', targetMaxCost: 4 },
        },
      ] as const
  ),
]);

export function registerWaitSelfOpponentWaitWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of CONFIGS.keys()) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startWaitSelfOpponentWaitEffect(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SOURCE_WAIT_COST_STEP_ID, (game, input, context) =>
      finishSourceWaitCost(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, OPPONENT_TARGET_STEP_ID, (game, input, context) =>
      finishOpponentWaitTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startWaitSelfOpponentWaitEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const config = CONFIGS.get(ability.abilityId);
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !config) {
    return game;
  }

  const sourceState = getOwnSourceState(game, ability.controllerId, ability.sourceCardId);
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (!sourceState.sourceSlot || sourceState.orientation !== OrientationState.ACTIVE) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_SOURCE_NOT_ACTIVE',
        sourceSlot: sourceState.sourceSlot,
        sourceOrientation: sourceState.orientation,
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
        stepId: SOURCE_WAIT_COST_STEP_ID,
        stepText: config.sourceStepText,
        awaitingPlayerId: player.id,
        selectableOptions: [{ id: ACTIVATE_SOURCE_WAIT_COST_OPTION_ID, label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot: sourceState.sourceSlot,
          eventIds: ability.eventIds,
          timingId: ability.timingId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_SOURCE_WAIT_COST',
      sourceSlot: sourceState.sourceSlot,
    }
  );
}

function finishSourceWaitCost(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const config = effect ? CONFIGS.get(effect.abilityId) : undefined;
  if (!effect || !config) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedOptionId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_SOURCE_WAIT_COST',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      orderedResolution
    );
  }

  if (
    selectedOptionId !== ACTIVATE_SOURCE_WAIT_COST_OPTION_ID ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const sourceState = getOwnSourceState(game, player.id, effect.sourceCardId);
  if (!sourceState.sourceSlot || sourceState.orientation !== OrientationState.ACTIVE) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_SOURCE_NOT_ACTIVE_AT_COST',
        sourceSlot: sourceState.sourceSlot,
        sourceOrientation: sourceState.orientation,
      }),
      orderedResolution
    );
  }

  const orientationChange = setMemberOrientation(
    game,
    player.id,
    effect.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithCostTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(state, 'PAY_COST', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          paidCostCardId: effect.sourceCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
        }),
    }
  );

  const targetCardIds = getEligibleOpponentMemberIds(
    stateWithCostTriggers.gameState,
    opponent.id,
    config.selector
  );
  if (targetCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        {
          ...stateWithCostTriggers.gameState,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: config.noTargetAfterCostStep,
          sourceSlot: sourceState.sourceSlot,
          paidCostCardId: effect.sourceCardId,
          targetPlayerId: opponent.id,
          ...config.targetSelectionPayload,
        }
      ),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithCostTriggers.gameState,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: OPPONENT_TARGET_STEP_ID,
        stepText: config.targetStepText,
        awaitingPlayerId: player.id,
        selectableCardIds: targetCardIds,
        selectionLabel: config.selectionLabel,
        confirmSelectionLabel: '变为待机',
        metadata: {
          orderedResolution,
          sourceSlot: sourceState.sourceSlot,
          paidCostCardId: effect.sourceCardId,
          targetPlayerId: opponent.id,
          targetKind: config.targetKind,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.startTargetStep,
      sourceSlot: sourceState.sourceSlot,
      paidCostCardId: effect.sourceCardId,
      targetPlayerId: opponent.id,
      selectableCardIds: targetCardIds,
      ...config.targetSelectionPayload,
    }
  );
}

function finishOpponentWaitTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const config = effect ? CONFIGS.get(effect.abilityId) : undefined;
  if (!effect || !config) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (!player || !targetPlayerId || selectedCardId === null) {
    return game;
  }

  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const currentTargetCardIds = getEligibleOpponentMemberIds(game, targetPlayerId, config.selector);
  if (!currentTargetCardIds.includes(selectedCardId)) {
    if (currentTargetCardIds.length > 0) {
      return {
        ...game,
        activeEffect: {
          ...effect,
          selectableCardIds: currentTargetCardIds,
        },
      };
    }
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: config.staleNoTargetStep,
        sourceSlot: effect.metadata?.sourceSlot,
        paidCostCardId:
          typeof effect.metadata?.paidCostCardId === 'string'
            ? effect.metadata.paidCostCardId
            : undefined,
        targetPlayerId,
        staleTargetCardId: selectedCardId,
        ...config.resolvedTargetPayload,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const orientationChange = setMemberOrientation(
    game,
    targetPlayerId,
    selectedCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithTargetTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: config.waitTargetStep,
            sourceSlot: effect.metadata?.sourceSlot,
            paidCostCardId:
              typeof effect.metadata?.paidCostCardId === 'string'
                ? effect.metadata.paidCostCardId
                : undefined,
            targetPlayerId,
            targetCardId: selectedCardId,
            ...config.resolvedTargetPayload,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  return continuePendingCardEffects(
    stateWithTargetTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getOwnSourceState(
  game: GameState,
  playerId: string,
  sourceCardId: string
): {
  readonly sourceSlot: SlotPosition | null;
  readonly orientation: OrientationState | null;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { sourceSlot: null, orientation: null };
  }

  const sourceSlot = findMemberSlot(player, sourceCardId);
  return {
    sourceSlot,
    orientation: sourceSlot
      ? (player.memberSlots.cardStates.get(sourceCardId)?.orientation ?? null)
      : null,
  };
}

function getEligibleOpponentMemberIds(
  game: GameState,
  opponentId: string,
  selector: CardSelector
): readonly string[] {
  const opponent = getPlayerById(game, opponentId);
  return getStageMemberCardIdsMatching(game, opponentId, selector).filter(
    (cardId) =>
      opponent?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
