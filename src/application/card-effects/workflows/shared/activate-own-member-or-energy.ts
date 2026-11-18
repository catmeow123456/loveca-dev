import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import {
  EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
  PL_PB2_015_AUTO_BIBI_EFFECT_WAIT_OPPONENT_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsByOrientation } from '../../../effects/stage-targets.js';
import { unitAliasIs, type CardSelector } from '../../../effects/card-selectors.js';

interface ActivateOwnMemberOrEnergyConfig {
  readonly abilityId: string;
  readonly choiceStepId: string;
  readonly memberStepId: string;
  readonly memberSelector?: CardSelector;
  readonly memberOptionText: string;
  readonly recordTurnUse: boolean;
}
const CONFIGS: readonly ActivateOwnMemberOrEnergyConfig[] = [
  {
    abilityId: EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
    choiceStepId: 'EMMA_SELECT_ACTIVATE_TARGET_TYPE',
    memberStepId: 'EMMA_SELECT_MEMBER_TO_ACTIVATE',
    memberOptionText: '将1名存在于自己的舞台的成员变为活跃状态。',
    recordTurnUse: false,
  },
  {
    abilityId: PL_PB2_015_AUTO_BIBI_EFFECT_WAIT_OPPONENT_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
    choiceStepId: 'PL_PB2_015_SELECT_ACTIVATE_TARGET_TYPE',
    memberStepId: 'PL_PB2_015_SELECT_MEMBER_TO_ACTIVATE',
    memberSelector: unitAliasIs('BiBi'),
    memberOptionText: '将存在于自己的舞台的1名『BiBi』的成员变为活跃状态。',
    recordTurnUse: true,
  },
];
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerActivateOwnMemberOrEnergyWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      start(game, ability, config, options.orderedResolution === true)
    );
    registerActiveEffectStepHandler(config.abilityId, config.choiceStepId, (game, input, context) =>
      choose(game, input.selectedOptionId ?? null, config, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(config.abilityId, config.memberStepId, (game, input, context) =>
      activateMember(
        game,
        input.selectedCardId ?? null,
        config,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function getMembers(
  game: GameState,
  playerId: string,
  config: ActivateOwnMemberOrEnergyConfig
): readonly string[] {
  return getStageMemberCardIdsByOrientation(game, playerId, OrientationState.WAITING).filter(
    (id) => {
      const card = getCardById(game, id);
      return card !== null && (config.memberSelector?.(card) ?? true);
    }
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  config: ActivateOwnMemberOrEnergyConfig,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const waitingMemberCardIds = getMembers(game, player.id, config);
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const started = startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: ability.sourceLifecycleId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.choiceStepId,
      stepText: '请选择要执行的效果。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'member', label: config.memberOptionText },
        { id: 'energy', label: '将2张能量变为活跃状态。' },
      ],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'member', text: config.memberOptionText, selectable: true },
          { id: 'energy', text: '将2张能量变为活跃状态。', selectable: true },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
      metadata: { orderedResolution, waitingMemberCardIds, waitingEnergyCardIds },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TARGET_TYPE',
      waitingMemberCardIds,
      waitingEnergyCardIds,
    },
  });
  return config.recordTurnUse
    ? recordAbilityUseForContext(started, ability.controllerId, {
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        pendingAbilityId: ability.id,
      })
    : started;
}

function choose(
  game: GameState,
  selectedOptionId: string | null,
  config: ActivateOwnMemberOrEnergyConfig,
  continuation: Continue
): GameState {
  const effect = getCardActiveEffect(game);
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.choiceStepId)
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const waitingMemberCardIds = getMembers(game, player.id, config);
  const offered =
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) === true;
  if (offered && selectedOptionId === 'member') {
    // Public choice confirmation can outlive its target; a selected branch still resolves.
    if (waitingMemberCardIds.length === 0)
      return finish(game, effect, config, continuation, { step: 'FINISH_NO_TARGETS' });
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: config.memberStepId,
          stepText: '请选择1名要变为活跃状态的舞台成员。',
          effectChoice: undefined,
          selectableCardIds: waitingMemberCardIds,
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'SINGLE',
          minSelectableCards: undefined,
          maxSelectableCards: undefined,
          selectableOptions: undefined,
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          selectionLabel: '选择要变为活跃状态的成员',
          confirmSelectionLabel: '变为活跃状态',
          metadata: { ...effect.metadata, waitingMemberCardIds },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_MEMBER_TARGET',
        waitingMemberCardIds,
      }
    );
  }
  if (offered && selectedOptionId === 'energy') {
    const count = Math.min(
      2,
      getEnergyCardIdsByOrientation(game, player.id, OrientationState.WAITING).length
    );
    const result = activateWaitingEnergyCardsForPlayer(game, player.id, count);
    return result
      ? finish(result.gameState, effect, config, continuation, {
          step: 'ACTIVATE_ENERGY',
          activatedEnergyCardIds: result.activatedEnergyCardIds,
          previousOrientations: result.previousOrientations,
          nextOrientation: result.nextOrientation,
        })
      : game;
  }
  return game;
}

function activateMember(
  game: GameState,
  cardId: string | null,
  config: ActivateOwnMemberOrEnergyConfig,
  continuation: Continue,
  enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = getCardActiveEffect(game);
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.memberStepId ||
    cardId === null ||
    !effect.selectableCardIds?.includes(cardId)
  )
    return game;
  const currentIds = getMembers(game, effect.controllerId, config);
  if (currentIds.length === 0)
    return finish(game, effect, config, continuation, { step: 'FINISH_NO_TARGETS' });
  if (!currentIds.includes(cardId))
    return { ...game, activeEffect: { ...effect, selectableCardIds: currentIds } };
  const result = setMembersOrientation(
    game,
    effect.controllerId,
    [cardId],
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!result) return game;
  const state = enqueueMemberStateChangedTriggersFromOrientationResult(game, result, enqueue, {
    prepareGameStateBeforeEnqueue: (current, changed) =>
      finishState(current, effect, config, {
        step: 'ACTIVATE_MEMBER',
        activatedMemberCardIds: changed.updatedMemberCardIds,
        previousOrientations: changed.previousOrientations,
        nextOrientation: changed.nextOrientation,
      }),
  }).gameState;
  return continuation(state, effect.metadata?.orderedResolution === true);
}

function finishState(
  game: GameState,
  effect: ActiveEffectState,
  config: ActivateOwnMemberOrEnergyConfig,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    ...payload,
  });
}
function finish(
  game: GameState,
  effect: ActiveEffectState,
  config: ActivateOwnMemberOrEnergyConfig,
  continuation: Continue,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuation(
    finishState(game, effect, config, payload),
    effect.metadata?.orderedResolution === true
  );
}
