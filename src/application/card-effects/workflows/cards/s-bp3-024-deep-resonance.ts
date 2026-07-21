import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { costLte, typeIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { CardType } from '../../../../shared/types/enums.js';
import { S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const BRANCH_STEP_ID = 'S_BP3_024_SELECT_BRANCH';
const BLADE_STEP_ID = 'S_BP3_024_SELECT_OWN_BLADE_TARGET';
const WAIT_STEP_ID = 'S_BP3_024_SELECT_OPPONENT_WAIT_TARGET';
const BLADE_OPTION_ID = 'gain-two-blade';
const WAIT_OPTION_ID = 'wait-opponent-low-cost-member';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp3024DeepResonanceWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID,
    (game, ability, options, context) =>
      startWorkflow(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID,
    BRANCH_STEP_ID,
    (game, input, context) =>
      finishBranch(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID,
    BLADE_STEP_ID,
    (game, input, context) =>
      finishBlade(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID,
    WAIT_STEP_ID,
    (game, input, context) =>
      finishWait(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution?: boolean;
    readonly manualConfirmation?: boolean;
    readonly confirmBeforeResolution?: boolean;
    readonly skipManualConfirmation?: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const context = getContext(game, ability);
  if (
    !context.sourceLiveInOwnLiveZone ||
    !context.conditionMet ||
    context.branchOptions.length === 0
  ) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: getRealtimeEffectText(game, ability),
      stepText: getRealtimeStepText(game, ability),
    });
    if (confirmation) return confirmation;
    return finishPending(
      game,
      ability,
      options.orderedResolution === true,
      context,
      continuePendingCardEffects
    );
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
      stepId: BRANCH_STEP_ID,
      stepText: '请选择「Deep Resonance」要处理的效果。',
      awaitingPlayerId: player.id,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: BLADE_OPTION_ID,
            text: 'LIVE结束时为止，存在于自己的舞台上的1名成员，获得[BLADE][BLADE]。',
            selectable: context.branchOptions.some((option) => option.id === BLADE_OPTION_ID),
          },
          {
            id: WAIT_OPTION_ID,
            text: '将存在于对方的舞台的1名费用小于等于4的成员变为待机状态。',
            selectable: context.branchOptions.some((option) => option.id === WAIT_OPTION_ID),
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: { orderedResolution: options.orderedResolution === true },
    },
    actionPayload: {
      step: 'START_SELECT_DEEP_RESONANCE_BRANCH',
      ownBladeTargetIds: context.ownBladeTargetIds,
      opponentWaitTargetIds: context.opponentWaitTargetIds,
    },
  });
}

function finishBranch(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!isEffectStep(effect, BRANCH_STEP_ID) || !selectedOptionId) return game;
  const context = getContext(game, effect);
  if (!context.sourceLiveInOwnLiveZone || !context.conditionMet)
    return finishActive(game, effect, 'CONDITION_STALE', continuePendingCardEffects, context);
  if (!context.branchOptions.some((option) => option.id === selectedOptionId)) return game;
  if (selectedOptionId === BLADE_OPTION_ID) {
    return {
      ...game,
      activeEffect: {
        ...effect,
        stepId: BLADE_STEP_ID,
        stepText: '请选择自己舞台上1名成员，使其获得[BLADE][BLADE]。',
        effectChoice: undefined,
        selectableOptions: undefined,
        selectableCardIds: context.ownBladeTargetIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得[BLADE][BLADE]的成员',
        confirmSelectionLabel: '获得[BLADE][BLADE]',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: { ...effect.metadata, selectedBranch: selectedOptionId },
      },
    };
  }
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: WAIT_STEP_ID,
      stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
      effectChoice: undefined,
      selectableOptions: undefined,
      selectableCardIds: context.opponentWaitTargetIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择对方舞台上费用小于等于4的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: { ...effect.metadata, selectedBranch: selectedOptionId },
    },
  };
}

function finishBlade(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!isEffectStep(effect, BLADE_STEP_ID) || !selectedCardId) return game;
  const context = getContext(game, effect);
  if (!context.sourceLiveInOwnLiveZone || !context.conditionMet)
    return finishActive(
      game,
      effect,
      'CONDITION_STALE_BEFORE_BLADE',
      continuePendingCardEffects,
      context
    );
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) return game;
  if (!context.ownBladeTargetIds.includes(selectedCardId))
    return finishActive(game, effect, 'BLADE_TARGET_STALE', continuePendingCardEffects, context);
  const result = addBladeLiveModifierForSourceMember(game, {
    playerId: effect.controllerId,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: 2,
  });
  if (!result)
    return finishActive(game, effect, 'BLADE_TARGET_INVALID', continuePendingCardEffects, context);
  return finishActive(result.gameState, effect, 'GRANT_TWO_BLADE', continuePendingCardEffects, {
    targetCardId: selectedCardId,
    bladeBonus: 2,
  });
}

function finishWait(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!isEffectStep(effect, WAIT_STEP_ID) || !selectedCardId) return game;
  const context = getContext(game, effect);
  if (!context.sourceLiveInOwnLiveZone || !context.conditionMet)
    return finishActive(
      game,
      effect,
      'CONDITION_STALE_BEFORE_WAIT',
      continuePendingCardEffects,
      context
    );
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) return game;
  if (!context.opponentWaitTargetIds.includes(selectedCardId) || !context.opponentId)
    return finishActive(game, effect, 'WAIT_TARGET_STALE', continuePendingCardEffects, context);
  const orientationResult = setMemberOrientation(
    game,
    context.opponentId,
    selectedCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationResult || orientationResult.previousOrientation === OrientationState.WAITING)
    return finishActive(game, effect, 'WAIT_TARGET_INVALID', continuePendingCardEffects, context);
  const withTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterOrientation, result, events) =>
        addAction(
          { ...stateAfterOrientation, activeEffect: null },
          'RESOLVE_ABILITY',
          effect.controllerId,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_OPPONENT_LOW_COST_MEMBER',
            targetPlayerId: context.opponentId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            memberStateChangedEventIds: events.map((event) => event.eventId),
          }
        ),
    }
  );
  return continuePendingCardEffects(
    withTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

interface Context {
  readonly sourceLiveInOwnLiveZone: boolean;
  readonly centerCardId: string | null;
  readonly centerIsAqours: boolean;
  readonly centerEffectiveCost: number | null;
  readonly conditionMet: boolean;
  readonly ownBladeTargetIds: readonly string[];
  readonly opponentWaitTargetIds: readonly string[];
  readonly opponentId: string | null;
  readonly branchOptions: readonly { readonly id: string; readonly label: string }[];
}
function getContext(
  game: GameState,
  source: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): Context {
  const player = getPlayerById(game, source.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const centerCardId = player?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  const centerCard = centerCardId ? getCardById(game, centerCardId) : null;
  const centerIsAqours =
    !!centerCard &&
    isMemberCardData(centerCard.data) &&
    cardBelongsToGroup(centerCard.data, 'Aqours');
  const centerEffectiveCost =
    player && centerCardId && centerCard && isMemberCardData(centerCard.data)
      ? getMemberEffectiveCost(game, player.id, centerCardId)
      : null;
  const conditionMet = centerIsAqours && centerEffectiveCost !== null && centerEffectiveCost >= 9;
  const ownBladeTargetIds = player
    ? getStageMemberCardIdsMatching(game, player.id, typeIs(CardType.MEMBER))
    : [];
  const opponentWaitTargetIds = opponent
    ? getStageMemberCardIdsMatching(
        game,
        opponent.id,
        (card) =>
          typeIs(CardType.MEMBER)(card) &&
          costLte(4)(card) &&
          opponent.memberSlots.cardStates.get(card.instanceId)?.orientation !==
            OrientationState.WAITING
      )
    : [];
  const branchOptions = [
    ...(ownBladeTargetIds.length
      ? [{ id: BLADE_OPTION_ID, label: '使自己舞台成员获得[BLADE][BLADE]' }]
      : []),
    ...(opponentWaitTargetIds.length
      ? [{ id: WAIT_OPTION_ID, label: '使对方费用小于等于4的成员变为待机状态' }]
      : []),
  ];
  return {
    sourceLiveInOwnLiveZone: player?.liveZone.cardIds.includes(source.sourceCardId) === true,
    centerCardId,
    centerIsAqours,
    centerEffectiveCost,
    conditionMet,
    ownBladeTargetIds,
    opponentWaitTargetIds,
    opponentId: opponent?.id ?? null,
    branchOptions,
  };
}

function getRealtimeEffectText(game: GameState, ability: PendingAbilityState): string {
  return `${getAbilityEffectText(ability.abilityId)}（${formatContext(getContext(game, ability))}）`;
}
function getRealtimeStepText(game: GameState, ability: PendingAbilityState): string {
  return `${formatContext(getContext(game, ability))}，实际不会处理任何目标。`;
}
function formatContext(context: Context): string {
  const center = context.centerCardId
    ? `当前中央成员${context.centerIsAqours ? '是' : '不是'}『Aqours』，当前有效费用${context.centerEffectiveCost ?? 0}，${context.conditionMet ? '满足' : '不满足'}费用9条件`
    : '当前中央不存在成员，不满足费用9条件';
  return `${center}；己方可获得[BLADE]的目标${context.ownBladeTargetIds.length}名；对方费用小于等于4且非待机状态的合法目标${context.opponentWaitTargetIds.length}名`;
}
function isEffectStep(
  effect: GameState['activeEffect'],
  stepId: string
): effect is NonNullable<GameState['activeEffect']> {
  return (
    !!effect &&
    effect.abilityId ===
      S_BP3_024_LIVE_START_CENTER_HIGH_COST_AQOURS_CHOOSE_BLADE_OR_WAIT_ABILITY_ID &&
    effect.stepId === stepId
  );
}
function finishPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  context: Context,
  continuePendingCardEffects: ContinuePendingCardEffects
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
      step: 'DEEP_RESONANCE_NOOP',
      ...context,
    }),
    orderedResolution
  );
}
function finishActive(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: object
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
