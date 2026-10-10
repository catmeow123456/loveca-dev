import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addLiveModifier,
  addMemberCostLiveModifierForMember,
} from '../../../../domain/rules/live-modifiers.js';
import { addMemberActivePhaseSkip } from '../../../../domain/rules/member-active-skips.js';
import { HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { sumStageMemberEffectiveCostMatching } from '../../../effects/conditions.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  HS_BP8_020_LIVE_START_WAIT_TWO_REDUCE_REQUIREMENT_SKIP_ACTIVE_ABILITY_ID as WAIT_ABILITY,
  HS_BP8_020_LIVE_START_TARGET_DOLLCHESTRA_GAIN_COST_SCORE_ABILITY_ID as COST_ABILITY,
} from '../../ability-ids.js';
import {
  startPendingActiveEffect,
  finishSkippedActiveEffect,
} from '../../runtime/active-effect.js';
import {
  getAbilitySourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
  getStageMemberLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const WAIT_STEP = 'HS_BP8_020_WAIT_TWO_FOR_REQUIREMENT';
const COST_STEP = 'HS_BP8_020_SELECT_DOLLCHESTRA_COST_TARGET';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
type Context = Pick<
  PendingAbilityState,
  'id' | 'abilityId' | 'sourceCardId' | 'controllerId' | 'sourceLifecycleId'
>;

export function registerHsBp8020IcyWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(WAIT_ABILITY, (game, ability, options, context) => {
    const ids = waitTargets(game, ability.controllerId);
    if (ids.length < 2)
      return consume(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        { step: 'NO_TWO_ACTIVE_MEMBERS_FOR_COST' }
      );
    return startSelection(game, ability, options.orderedResolution === true, ids, {
      stepId: WAIT_STEP,
      stepText: '可以将自己舞台上的2名活跃状态成员变为待机状态。',
      selectionLabel: '选择要变为待机状态的2名成员',
      confirmSelectionLabel: '变为待机状态',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
  });
  registerActiveEffectStepHandler(
    WAIT_ABILITY,
    WAIT_STEP,
    (game, input, context) => {
      const ids = input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
      return ids.length === 0
        ? finishSkippedActiveEffect(game, context.continuePendingCardEffects)
        : finishWait(
            game,
            ids,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          );
    },
    queryCardSelection
  );
  registerPendingAbilityStarterHandler(COST_ABILITY, (game, ability, options, context) =>
    startCost(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    COST_ABILITY,
    COST_STEP,
    (game, input, context) =>
      finishCost(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
}

function startSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  ids: readonly string[],
  fields: Partial<ActiveEffectState> & Pick<ActiveEffectState, 'stepId' | 'stepText'>
): GameState {
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      awaitingPlayerId: ability.controllerId,
      selectableCardIds: ids,
      selectableCardVisibility: 'PUBLIC',
      ...fields,
      metadata: {
        orderedResolution,
        targetLifecycleIds: Object.fromEntries(
          ids.map((id) => [id, getStageMemberLifecycleId(game, id)])
        ),
      },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: fields.stepId },
  });
}

function finishWait(
  game: GameState,
  ids: readonly string[],
  continuation: Continue,
  enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== WAIT_ABILITY ||
    effect.stepId !== WAIT_STEP ||
    ids.length !== 2 ||
    new Set(ids).size !== 2
  )
    return game;
  const current = waitTargets(game, effect.controllerId);
  if (ids.some((id) => !current.includes(id) || !isCapturedTarget(game, effect, id))) return game;
  const waited = setMembersOrientation(game, effect.controllerId, ids, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: effect.controllerId,
    sourceCardId: effect.sourceCardId,
    abilityId: WAIT_ABILITY,
    pendingAbilityId: effect.id,
  });
  if (!waited || waited.updatedMemberCardIds.length !== 2) return game;
  let state = waited.gameState;
  for (const memberCardId of waited.updatedMemberCardIds)
    state = addMemberActivePhaseSkip(state, {
      playerId: effect.controllerId,
      memberCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: WAIT_ABILITY,
    });
  if (isCurrentLiveSource(state, effect))
    state = addLiveModifier(state, {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
      sourceCardId: effect.sourceCardId,
      abilityId: WAIT_ABILITY,
    });
  state = recordPayCostAction(state, effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: WAIT_ABILITY,
    sourceCardId: effect.sourceCardId,
    waitedMemberCardIds: ids,
  });
  // All selected members and rewards are committed before collecting either state-change trigger.
  state = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    { ...waited, gameState: state },
    enqueue
  ).gameState;
  return continuation(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: WAIT_ABILITY,
      sourceCardId: effect.sourceCardId,
      step: 'WAIT_TWO_REDUCE_REQUIREMENT_SKIP_NEXT_ACTIVE',
      waitedMemberCardIds: ids,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startCost(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuation: Continue
): GameState {
  const ids = costTargets(game, ability.controllerId);
  if (ids.length > 0)
    return startSelection(game, ability, options.orderedResolution === true, ids, {
      stepId: COST_STEP,
      stepText: '请选择自己舞台上1名费用＋５的『DOLLCHESTRA』成员。',
      selectionLabel: '选择费用＋５的成员',
      confirmSelectionLabel: '费用＋５',
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
    });
  const total = sumStageMemberEffectiveCostMatching(
    game,
    ability.controllerId,
    groupAliasIs('蓮ノ空')
  );
  const sourceContext = {
    ...ability,
    sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
  };
  const willScore = total >= 30 && isCurrentLiveSource(game, sourceContext);
  const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
    effectText: getAbilityEffectText(COST_ABILITY),
    stepText: `没有可选择的目标。自己的舞台『莲之空』成员费用合计${total}，${willScore ? '满足条件，确认后此卡分数＋１。' : '确认后不增加分数。'}`,
  });
  if (confirmation) return confirmation;
  return consume(
    applyScore(game, sourceContext),
    ability,
    options.orderedResolution === true,
    continuation,
    {
      step: 'NO_DOLLCHESTRA_TARGET_CHECK_STAGE_COST',
      stageCostTotal: total,
      scoreBonus: willScore ? 1 : 0,
    }
  );
}

function finishCost(
  game: GameState,
  selectedCardId: string | null,
  continuation: Continue
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== COST_ABILITY ||
    effect.stepId !== COST_STEP ||
    !selectedCardId ||
    !costTargets(game, effect.controllerId).includes(selectedCardId) ||
    !isCapturedTarget(game, effect, selectedCardId)
  )
    return game;
  const cost = addMemberCostLiveModifierForMember(game, {
    playerId: effect.controllerId,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: COST_ABILITY,
    countDelta: 5,
  });
  if (!cost) return game;
  const total = sumStageMemberEffectiveCostMatching(
    cost.gameState,
    effect.controllerId,
    groupAliasIs('蓮ノ空')
  );
  const scored = total >= 30 && isCurrentLiveSource(cost.gameState, effect);
  const state = applyScore(cost.gameState, effect);
  return continuation(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: COST_ABILITY,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_GAIN_COST_CHECK_STAGE_COST',
      targetCardId: selectedCardId,
      stageCostTotal: total,
      scoreBonus: scored ? 1 : 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function applyScore(game: GameState, source: Context): GameState {
  return sumStageMemberEffectiveCostMatching(game, source.controllerId, groupAliasIs('蓮ノ空')) >=
    30 && isCurrentLiveSource(game, source)
    ? addLiveModifier(game, {
        kind: 'SCORE',
        playerId: source.controllerId,
        liveCardId: source.sourceCardId,
        sourceCardId: source.sourceCardId,
        abilityId: COST_ABILITY,
        countDelta: 1,
      })
    : game;
}

function isCurrentLiveSource(game: GameState, source: Context): boolean {
  const player = getPlayerById(game, source.controllerId);
  const card = getCardById(game, source.sourceCardId);
  return (
    !!player?.liveZone.cardIds.includes(source.sourceCardId) &&
    !!card &&
    card.ownerId === source.controllerId &&
    isLiveCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!HS-bp8-020') &&
    (source.sourceLifecycleId === undefined ||
      source.sourceLifecycleId ===
        getAbilitySourceLifecycleId(game, source.abilityId, source.sourceCardId))
  );
}

function isCapturedTarget(game: GameState, effect: ActiveEffectState, cardId: string): boolean {
  const lifecycles = effect.metadata?.targetLifecycleIds as
    Readonly<Record<string, unknown>> | undefined;
  return (
    effect.selectableCardIds?.includes(cardId) === true &&
    lifecycles?.[cardId] === getStageMemberLifecycleId(game, cardId)
  );
}

function waitTargets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    (card) => card.ownerId === playerId,
    (state, id, cardId) =>
      getPlayerById(state, id)?.memberSlots.cardStates.get(cardId)?.orientation ===
      OrientationState.ACTIVE
  );
}

function costTargets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    (card) => card.ownerId === playerId && unitAliasIs('DOLLCHESTRA')(card)
  );
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuation: Continue,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuation(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
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
