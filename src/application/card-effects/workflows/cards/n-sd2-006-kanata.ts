import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForMemberStateChanged } from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { waitStageMembersAndEnqueueTriggers } from '../../runtime/wait-stage-members.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SELECT_WAIT_COST_MEMBER_STEP_ID = 'N_SD2_006_SELECT_NIJIGASAKI_MEMBER_TO_WAIT';
const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNSd2006KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    SELECT_WAIT_COST_MEMBER_STEP_ID,
    (game, input, context) =>
      finish(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = getActiveNijigasakiMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consume(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ACTIVE_NIJIGASAKI_MEMBER_FOR_COST',
      paidCostCardId: null,
      bladeBonus: 0,
      bladeApplied: false,
    });
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
      stepId: SELECT_WAIT_COST_MEMBER_STEP_ID,
      stepText: '可以将自己舞台上1名活跃状态的『虹咲』成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要用于支付费用的成员',
      confirmSelectionLabel: '支付费用',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution, sourceSlot: ability.sourceSlot },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NIJIGASAKI_MEMBER_WAIT_COST',
      selectableCardIds,
      sourceSlot: ability.sourceSlot,
    },
  });
}

function finish(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_WAIT_COST_MEMBER_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DECLINE_WAIT_COST',
        paidCostCardId: null,
        bladeBonus: 0,
        bladeApplied: false,
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getActiveNijigasakiMemberCardIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const waitResult = waitStageMembersAndEnqueueTriggers(game, {
    playerId: player.id,
    memberCardIds: [selectedCardId],
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
    enqueueTriggeredCardEffects,
  });
  if (waitResult.actuallyWaitedMemberCardIds.length !== 1) {
    return game;
  }

  const stateWithCostAction = recordPayCostAction(waitResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    paidCostCardId: selectedCardId,
    previousOrientation: OrientationState.ACTIVE,
    nextOrientation: OrientationState.WAITING,
  });
  const bladeResult = addBladeLiveModifierForSourceMember(stateWithCostAction, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 2,
  });
  const state = bladeResult?.gameState ?? stateWithCostAction;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: bladeResult ? 'PAY_WAIT_COST_GAIN_TWO_BLADE' : 'PAY_WAIT_COST_SOURCE_NO_LONGER_VALID',
      paidCostCardId: selectedCardId,
      actuallyWaitedMemberCardIds: waitResult.actuallyWaitedMemberCardIds,
      memberStateChangedEventIds: waitResult.memberStateChangedEventIds,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
      bladeApplied: bladeResult !== null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getActiveNijigasakiMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  );
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}
