import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const WAIT_SELF_COST_STEP_ID = 'PL_BP3_003_WAIT_SELF_COST';
const SELECT_MUSE_MEMBER_STEP_ID = 'PL_BP3_003_SELECT_MUSE_MEMBER_FROM_WAITING_ROOM';
const ACTIVATE_WAIT_SELF_COST_OPTION_ID = 'activate';

const museMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs("μ's"));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerPlBp3003KotoriWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startPlBp3003KotoriOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID,
    WAIT_SELF_COST_STEP_ID,
    (game, input, context) =>
      finishPlBp3003KotoriWaitSelfCost(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID,
    SELECT_MUSE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishRecoverMuseMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

export function startPlBp3003KotoriOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, ability.sourceCardId);
  const sourceState = sourceSlot
    ? player.memberSlots.cardStates.get(ability.sourceCardId)
    : undefined;
  if (!sourceSlot || sourceState?.orientation !== OrientationState.ACTIVE) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER',
        sourceSlot,
        sourceOrientation: sourceState?.orientation ?? null,
      }
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: WAIT_SELF_COST_STEP_ID,
        stepText: '可以将此成员变为待机状态。',
        awaitingPlayerId: player.id,
        selectableOptions: [{ id: ACTIVATE_WAIT_SELF_COST_OPTION_ID, label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot,
          eventIds: ability.eventIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_OPTIONAL_WAIT_SELF_COST',
    }
  );
}

export function finishPlBp3003KotoriWaitSelfCost(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID ||
    effect.stepId !== WAIT_SELF_COST_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedOptionId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DECLINE_WAIT_SELF_COST',
      }),
      orderedResolution
    );
  }
  if (
    selectedOptionId !== ACTIVATE_WAIT_SELF_COST_OPTION_ID ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  const sourceState = sourceSlot
    ? player.memberSlots.cardStates.get(effect.sourceCardId)
    : undefined;
  if (!sourceSlot || sourceState?.orientation !== OrientationState.ACTIVE) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot,
        step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER_AFTER_SELECTION',
        sourceOrientation: sourceState?.orientation ?? null,
      }),
      orderedResolution
    );
  }

  const waitResult = setMemberOrientation(
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
  if (
    !waitResult ||
    waitResult.previousOrientation !== OrientationState.ACTIVE ||
    waitResult.nextOrientation !== OrientationState.WAITING
  ) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(state, 'PAY_COST', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot,
          waitedMemberCardId: effect.sourceCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  const stateAfterCost = stateWithMemberStateTriggers.gameState;
  const selectableCardIds = selectWaitingRoomCardIds(stateAfterCost, player.id, museMemberSelector);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot,
        step: 'PAID_COST_NO_MUSE_MEMBER_TO_RECOVER',
        memberStateChangedEventIds: stateWithMemberStateTriggers.memberStateChangedEvents.map(
          (event) => event.eventId
        ),
      }),
      orderedResolution
    );
  }

  return {
    ...stateAfterCost,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(effect.abilityId),
      stepId: SELECT_MUSE_MEMBER_STEP_ID,
      stepText: "请选择自己休息室中1张『μ's』的成员卡加入手牌。",
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectionLabel: "选择要加入手牌的『μ's』成员",
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot,
        memberStateChangedEventIds: stateWithMemberStateTriggers.memberStateChangedEvents.map(
          (event) => event.eventId
        ),
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function finishRecoverMuseMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_MUSE_MEMBER_STEP_ID ||
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
    addAction(
      {
        ...recoveryResult.gameState,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'RECOVER_MUSE_MEMBER',
        selectedCardId: recoveryResult.movedCardIds[0] ?? null,
        memberStateChangedEventIds: effect.metadata?.memberStateChangedEventIds,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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
