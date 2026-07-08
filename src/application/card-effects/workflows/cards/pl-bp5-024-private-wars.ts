import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { LiveModifierState } from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs, memberPrintedBladeLte } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID } from '../../ability-ids.js';
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

const PRIVATE_WARS_BRANCH_STEP_ID = 'PL_BP5_024_PRIVATE_WARS_BRANCH';
const PRIVATE_WARS_ACTIVATE_WAITING_MEMBER_STEP_ID =
  'PL_BP5_024_ACTIVATE_WAITING_MEMBER_GAIN_BLADE';
const PRIVATE_WARS_WAIT_OPPONENT_MEMBER_STEP_ID = 'PL_BP5_024_WAIT_OPPONENT_LOW_BLADE_MEMBER';

const ACTIVATE_WAITING_MEMBER_OPTION_ID = 'activate-waiting-member';
const WAIT_OPPONENT_LOW_BLADE_OPTION_ID = 'wait-opponent-low-blade-member';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerBp5024PrivateWarsWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID,
    (game, ability, options, context) =>
      startPrivateWarsWorkflow(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID,
    PRIVATE_WARS_BRANCH_STEP_ID,
    (game, input, context) =>
      finishPrivateWarsBranchSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID,
    PRIVATE_WARS_ACTIVATE_WAITING_MEMBER_STEP_ID,
    (game, input, context) =>
      finishPrivateWarsActivateWaitingMember(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID,
    PRIVATE_WARS_WAIT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishPrivateWarsWaitOpponentMember(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startPrivateWarsWorkflow(
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
  if (!player) {
    return game;
  }

  const context = getPrivateWarsContext(game, ability);
  if (!context.sourceLiveInOwnLiveZone || !context.hasOwnAriseMember || context.branchOptions.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: getPrivateWarsRealtimeEffectText(game, ability),
      stepText: getPrivateWarsRealtimeStepText(game, ability),
    });
    if (confirmation) {
      return confirmation;
    }
    return finishPrivateWarsPendingNoop(
      game,
      ability,
      options.orderedResolution === true,
      {
        step: context.sourceLiveInOwnLiveZone
          ? context.hasOwnAriseMember
            ? 'NO_LEGAL_PRIVATE_WARS_BRANCH'
            : 'NO_OWN_ARISE_STAGE_MEMBER'
          : 'SOURCE_LIVE_NOT_IN_LIVE_ZONE',
        sourceLiveInOwnLiveZone: context.sourceLiveInOwnLiveZone,
        hasOwnAriseMember: context.hasOwnAriseMember,
        activateWaitingTargetCount: context.activateWaitingMemberCardIds.length,
        waitOpponentTargetCount: context.waitOpponentMemberCardIds.length,
      },
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
      stepId: PRIVATE_WARS_BRANCH_STEP_ID,
      stepText: '请选择「Private Wars」要处理的效果。',
      awaitingPlayerId: player.id,
      selectableOptions: context.branchOptions,
      canSkipSelection: false,
      metadata: {
        orderedResolution: options.orderedResolution === true,
      },
    },
    actionPayload: {
      step: 'START_SELECT_PRIVATE_WARS_BRANCH',
      sourceCardId: ability.sourceCardId,
      activateWaitingTargetIds: context.activateWaitingMemberCardIds,
      waitOpponentTargetIds: context.waitOpponentMemberCardIds,
    },
  });
}

function finishPrivateWarsBranchSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID ||
    effect.stepId !== PRIVATE_WARS_BRANCH_STEP_ID ||
    selectedOptionId === null
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const context = getPrivateWarsContext(game, effect);
  if (!context.sourceLiveInOwnLiveZone || !context.hasOwnAriseMember) {
    return finishPrivateWarsActiveNoop(
      game,
      player.id,
      effect,
      {
        step: 'PRIVATE_WARS_CONDITION_NOT_MET_AFTER_SELECTION_STARTED',
        sourceLiveInOwnLiveZone: context.sourceLiveInOwnLiveZone,
        hasOwnAriseMember: context.hasOwnAriseMember,
      },
      continuePendingCardEffects
    );
  }
  if (!context.branchOptions.some((option) => option.id === selectedOptionId)) {
    return finishPrivateWarsActiveNoop(
      game,
      player.id,
      effect,
      {
        step: 'PRIVATE_WARS_BRANCH_UNAVAILABLE',
        selectedOptionId,
        activateWaitingTargetCount: context.activateWaitingMemberCardIds.length,
        waitOpponentTargetCount: context.waitOpponentMemberCardIds.length,
      },
      continuePendingCardEffects
    );
  }

  if (selectedOptionId === ACTIVATE_WAITING_MEMBER_OPTION_ID) {
    return {
      ...game,
      activeEffect: {
        ...effect,
        stepId: PRIVATE_WARS_ACTIVATE_WAITING_MEMBER_STEP_ID,
        stepText: '请选择舞台上1名待机状态成员变为活跃状态，并使其获得[BLADE]。',
        selectableCardIds: context.activateWaitingMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: undefined,
        selectionLabel: '选择待机状态成员',
        confirmSelectionLabel: '变为活跃并获得[BLADE]',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedBranch: selectedOptionId,
        },
      },
    };
  }

  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: PRIVATE_WARS_WAIT_OPPONENT_MEMBER_STEP_ID,
      stepText: '请选择对方舞台上1名原本[BLADE]小于等于3的成员变为待机状态。',
      selectableCardIds: context.waitOpponentMemberCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableOptions: undefined,
      selectionLabel: '选择对方低原本[BLADE]成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        selectedBranch: selectedOptionId,
      },
    },
  };
}

function finishPrivateWarsActivateWaitingMember(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID ||
    effect.stepId !== PRIVATE_WARS_ACTIVATE_WAITING_MEMBER_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const context = getPrivateWarsContext(game, effect);
  const target = selectedCardId ? findWaitingStageMember(game, selectedCardId) : null;
  if (
    !player ||
    !context.sourceLiveInOwnLiveZone ||
    !context.hasOwnAriseMember ||
    !selectedCardId ||
    !target ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return finishPrivateWarsActiveNoop(
      game,
      effect.controllerId,
      effect,
      {
        step:
          !context.sourceLiveInOwnLiveZone || !context.hasOwnAriseMember
            ? 'PRIVATE_WARS_CONDITION_NOT_MET_AFTER_TARGET_SELECTION'
            : 'PRIVATE_WARS_ACTIVATE_TARGET_UNAVAILABLE',
        selectedCardId,
        sourceLiveInOwnLiveZone: context.sourceLiveInOwnLiveZone,
        hasOwnAriseMember: context.hasOwnAriseMember,
      },
      continuePendingCardEffects
    );
  }

  const orientationResult = setMemberOrientation(
    game,
    target.playerId,
    selectedCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationResult || orientationResult.previousOrientation !== OrientationState.WAITING) {
    return finishPrivateWarsActiveNoop(
      game,
      player.id,
      effect,
      {
        step: 'PRIVATE_WARS_ACTIVATE_TARGET_UNAVAILABLE',
        selectedCardId,
      },
      continuePendingCardEffects
    );
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterOrientation, result, memberStateChangedEvents) => {
        const bladeModifier: LiveModifierState = {
          kind: 'BLADE',
          playerId: target.playerId,
          countDelta: 1,
          sourceCardId: selectedCardId,
          abilityId: effect.abilityId,
        };
        const stateWithModifier = addLiveModifier(stateAfterOrientation, bladeModifier);
        return addAction({ ...stateWithModifier, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'PRIVATE_WARS_ACTIVATE_WAITING_MEMBER_GAIN_BLADE',
          targetPlayerId: target.playerId,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
          bladeBonus: 1,
        });
      },
    }
  );

  return continuePendingCardEffects(
    stateWithTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPrivateWarsWaitOpponentMember(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID ||
    effect.stepId !== PRIVATE_WARS_WAIT_OPPONENT_MEMBER_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const context = getPrivateWarsContext(game, effect);
  const opponent = player ? getOpponent(game, player.id) : null;
  const currentTargets = opponent ? getOpponentLowPrintedBladeTargetIds(game, opponent.id) : [];
  if (
    !player ||
    !context.sourceLiveInOwnLiveZone ||
    !context.hasOwnAriseMember ||
    !opponent ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentTargets.includes(selectedCardId)
  ) {
    return finishPrivateWarsActiveNoop(
      game,
      effect.controllerId,
      effect,
      {
        step:
          !context.sourceLiveInOwnLiveZone || !context.hasOwnAriseMember
            ? 'PRIVATE_WARS_CONDITION_NOT_MET_AFTER_TARGET_SELECTION'
            : 'PRIVATE_WARS_WAIT_TARGET_UNAVAILABLE',
        selectedCardId,
        sourceLiveInOwnLiveZone: context.sourceLiveInOwnLiveZone,
        hasOwnAriseMember: context.hasOwnAriseMember,
      },
      continuePendingCardEffects
    );
  }

  const orientationResult = setMemberOrientation(
    game,
    opponent.id,
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
  if (!orientationResult) {
    return finishPrivateWarsActiveNoop(
      game,
      player.id,
      effect,
      {
        step: 'PRIVATE_WARS_WAIT_TARGET_UNAVAILABLE',
        selectedCardId,
      },
      continuePendingCardEffects
    );
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterOrientation, result, memberStateChangedEvents) =>
        addAction({ ...stateAfterOrientation, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'PRIVATE_WARS_WAIT_OPPONENT_LOW_BLADE_MEMBER',
          targetPlayerId: opponent.id,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPrivateWarsPendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
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

function finishPrivateWarsActiveNoop(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getPrivateWarsRealtimeEffectText(game: GameState, ability: PendingAbilityState): string {
  const context = getPrivateWarsContext(game, ability);
  return `${getAbilityEffectText(ability.abilityId)}（当前：${formatPrivateWarsContext(context)}）`;
}

function getPrivateWarsRealtimeStepText(game: GameState, ability: PendingAbilityState): string {
  return `${formatPrivateWarsContext(getPrivateWarsContext(game, ability))}。确认后此效果不进行选择并结算为不处理。`;
}

function formatPrivateWarsContext(context: PrivateWarsContext): string {
  if (!context.sourceLiveInOwnLiveZone) {
    return '来源LIVE不在自己的LIVE区';
  }
  if (!context.hasOwnAriseMember) {
    return '自己舞台没有『A-RISE』成员';
  }
  return `可活跃待机成员 ${context.activateWaitingMemberCardIds.length}名，可待机对方低原本[BLADE]成员 ${context.waitOpponentMemberCardIds.length}名`;
}

interface PrivateWarsContext {
  readonly sourceLiveInOwnLiveZone: boolean;
  readonly hasOwnAriseMember: boolean;
  readonly activateWaitingMemberCardIds: readonly string[];
  readonly waitOpponentMemberCardIds: readonly string[];
  readonly branchOptions: readonly { readonly id: string; readonly label: string }[];
}

function getPrivateWarsContext(game: GameState, ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>): PrivateWarsContext {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceLiveInOwnLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const hasOwnAriseMember =
    player !== null &&
    player !== undefined &&
    getStageMemberCardIdsMatching(game, player.id, groupAliasIs('A-RISE')).length > 0;
  const activateWaitingMemberCardIds =
    player && opponent
      ? [
          ...getWaitingStageMemberCardIds(game, player.id),
          ...getWaitingStageMemberCardIds(game, opponent.id),
        ]
      : [];
  const waitOpponentMemberCardIds = opponent ? getOpponentLowPrintedBladeTargetIds(game, opponent.id) : [];
  const branchOptions = [
    ...(activateWaitingMemberCardIds.length > 0
      ? [{ id: ACTIVATE_WAITING_MEMBER_OPTION_ID, label: '待机成员变为活跃并获得[BLADE]' }]
      : []),
    ...(waitOpponentMemberCardIds.length > 0
      ? [{ id: WAIT_OPPONENT_LOW_BLADE_OPTION_ID, label: '对方低原本[BLADE]成员变为待机' }]
      : []),
  ];
  return {
    sourceLiveInOwnLiveZone,
    hasOwnAriseMember,
    activateWaitingMemberCardIds,
    waitOpponentMemberCardIds,
    branchOptions,
  };
}

function getWaitingStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, playerId, (card) => {
    const orientation = player.memberSlots.cardStates.get(card.instanceId)?.orientation;
    return isMemberCardData(card.data) && orientation === OrientationState.WAITING;
  });
}

function findWaitingStageMember(
  game: GameState,
  cardId: string
): { readonly playerId: string } | null {
  for (const player of game.players) {
    if (
      Object.values(player.memberSlots.slots).includes(cardId) &&
      player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING
    ) {
      const card = getCardById(game, cardId);
      return card && isMemberCardData(card.data) ? { playerId: player.id } : null;
    }
  }
  return null;
}

function getOpponentLowPrintedBladeTargetIds(game: GameState, opponentPlayerId: string): readonly string[] {
  const opponent = getPlayerById(game, opponentPlayerId);
  if (!opponent) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, opponentPlayerId, (card) => {
    const orientation = opponent.memberSlots.cardStates.get(card.instanceId)?.orientation;
    return orientation !== OrientationState.WAITING && memberPrintedBladeLte(3)(card);
  });
}
