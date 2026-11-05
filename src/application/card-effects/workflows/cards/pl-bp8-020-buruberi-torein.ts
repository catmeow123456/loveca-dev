import {
  addAction,
  getOpponent,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { isMemberEffectActivationProhibited } from '../../../../domain/rules/member-effect-activation-prohibitions.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { cardNameAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { PL_BP8_020_LIVE_START_ACTIVATE_KOTORI_WAIT_OPPONENT_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SELECT_KOTORI = 'PL_BP8_020_SELECT_KOTORI_TO_ACTIVE';
const SELECT_OPPONENT = 'PL_BP8_020_SELECT_OPPONENT_MEMBER_TO_WAIT';
const kotori = cardNameAliasIs('南ことり');
const member = typeIs(CardType.MEMBER);

type Invocation = Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>;
type SelectionStep = typeof SELECT_KOTORI | typeof SELECT_OPPONENT;
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerPlBp8020BuruberiToreinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const ordered = options.orderedResolution === true;
    const selection = createSelection(game, ability, SELECT_KOTORI, ordered);
    if (!selection) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        stepText: '当前没有可变为活跃状态的「南琴梨（南小鸟）」。',
      });
      if (confirmation) return confirmation;
      const state = {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      };
      return context.continuePendingCardEffects(
        recordStep(state, ability, 'NO_KOTORI_TARGET'),
        ordered
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: selection,
      actionPayload: { sourceCardId: ability.sourceCardId, step: 'SELECT_KOTORI_TO_ACTIVE' },
    });
  });

  for (const step of [SELECT_KOTORI, SELECT_OPPONENT] as const) {
    registerActiveEffectStepHandler(
      ABILITY_ID,
      step,
      (game, input, context) =>
        resolveSelection(
          game,
          step,
          input.selectedCardId,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        ),
      queryCardSelection
    );
  }
}

function createSelection(
  game: GameState,
  ability: Invocation,
  step: SelectionStep,
  ordered: boolean
): ActiveEffectState | null {
  const isKotoriStep = step === SELECT_KOTORI;
  if (isKotoriStep && isMemberEffectActivationProhibited(game, ability.controllerId)) return null;

  const targetPlayerId = isKotoriStep
    ? ability.controllerId
    : getOpponent(game, ability.controllerId)?.id;
  if (!targetPlayerId) return null;

  const selection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: step,
    stepText: isKotoriStep
      ? '请选择自己舞台上1名待机状态的「南琴梨（南小鸟）」变为活跃状态。'
      : '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    awaitingPlayerId: ability.controllerId,
    targetPlayerId,
    selector: isKotoriStep ? kotori : member,
    statePredicate: isKotoriStep
      ? undefined
      : (state, playerId, cardId) => getMemberEffectiveCost(state, playerId, cardId) <= 4,
    targetOrientation: isKotoriStep ? OrientationState.ACTIVE : OrientationState.WAITING,
    selectionLabel: isKotoriStep ? '选择要变为活跃状态的成员' : '选择要变为待机状态的成员',
    confirmSelectionLabel: isKotoriStep ? '变为活跃状态' : '变为待机状态',
    orderedResolution: ordered,
  });
  if (!selection.activeEffect) return null;

  return {
    ...selection.activeEffect,
    selectableCardVisibility: 'PUBLIC',
    metadata: {
      ...selection.activeEffect.metadata,
      targetLifecycles: Object.fromEntries(
        selection.selectableCardIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
      ),
    },
  };
}

function resolveSelection(
  game: GameState,
  step: SelectionStep,
  selectedCardId: string | null | undefined,
  continuation: Continue,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (!effect || !selectedCardId || !effect.selectableCardIds?.includes(selectedCardId))
    return game;

  const ordered = effect.metadata?.orderedResolution === true;
  const currentSelection = createSelection(game, effect, step, ordered);
  if (!currentSelection) {
    const noTargetStep = step === SELECT_KOTORI ? 'NO_KOTORI_TARGET' : 'NO_OPPONENT_TARGET';
    return continuation(recordStep({ ...game, activeEffect: null }, effect, noTargetStep), ordered);
  }

  const targetLifecycles = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  if (
    !currentSelection.selectableCardIds?.includes(selectedCardId) ||
    targetLifecycles?.[selectedCardId] !== getStageMemberLifecycleId(game, selectedCardId)
  ) {
    return { ...game, activeEffect: currentSelection };
  }

  const change = resolveStageMemberOrientationTargetSelection(
    game,
    currentSelection,
    selectedCardId
  );
  if (!change?.changed) return game;

  const isKotoriStep = step === SELECT_KOTORI;
  const { gameState } = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    change,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state) => {
        const activeEffect = isKotoriStep
          ? createSelection(state, effect, SELECT_OPPONENT, ordered)
          : null;
        return recordStep(
          { ...state, activeEffect },
          effect,
          isKotoriStep ? 'ACTIVATE_KOTORI' : 'WAIT_OPPONENT_MEMBER',
          selectedCardId
        );
      },
    }
  );
  return gameState.activeEffect ? gameState : continuation(gameState, ordered);
}

function recordStep(
  game: GameState,
  ability: Invocation,
  step: string,
  targetCardId?: string
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', ability.controllerId, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step,
    targetCardId,
  });
}
