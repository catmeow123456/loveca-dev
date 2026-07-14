import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { getBaseCardCode } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_BP4_020_LIVE_START_ONLY_MUSE_STAGE_TARGET_MEMBER_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SELECT_MEMBER_STEP_ID = 'PL_BP4_020_SELECT_POSITION_CHANGE_MEMBER';
const SELECT_SLOT_STEP_ID = 'PL_BP4_020_SELECT_POSITION_CHANGE_SLOT';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const museMember = groupAliasIs("μ's");

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface LiveStartRuleState {
  readonly sourceIsValid: boolean;
  readonly stageMemberCardIds: readonly string[];
  readonly allStageMembersAreMuse: boolean;
}

export function registerPlBp4020LoveWingBellWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  const abilityId = PL_BP4_020_LIVE_START_ONLY_MUSE_STAGE_TARGET_MEMBER_POSITION_CHANGE_ABILITY_ID;
  registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
    startLoveWingBellPositionChange(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(abilityId, SELECT_MEMBER_STEP_ID, (game, input, context) =>
    resolveMemberSelection(game, input.selectedCardId, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(abilityId, SELECT_SLOT_STEP_ID, (game, input, context) =>
    resolveSlotSelection(
      game,
      input.selectedSlot,
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
}

function startLoveWingBellPositionChange(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const rule = evaluateRule(game, player.id, ability.sourceCardId);
  if (!isInteractiveRuleState(rule)) {
    const confirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options, {
      effectText: `${getAbilityEffectText(ability.abilityId)}\n${describeRuleResult(rule)}`,
      stepText: '确认当前舞台条件后继续处理。',
    });
    if (confirmation) return confirmation;
    return finishPendingWithoutMove(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'CONDITION_NOT_MET'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createMemberSelectionEffect(ability, rule.stageMemberCardIds, options),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_POSITION_CHANGE_MEMBER',
      selectableCardIds: rule.stageMemberCardIds,
    },
  });
}

function resolveMemberSelection(
  game: GameState,
  selectedCardId: string | null | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game, SELECT_MEMBER_STEP_ID);
  if (!effect) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const rule = evaluateRule(game, player.id, effect.sourceCardId);
  if (!isInteractiveRuleState(rule)) {
    return finishActiveEffectWithoutMove(game, effect, continuePendingCardEffects, 'STALE_RULE');
  }
  if (selectedCardId === null) {
    return finishActiveEffectWithoutMove(game, effect, continuePendingCardEffects, 'DECLINED');
  }
  if (selectedCardId === undefined || !rule.stageMemberCardIds.includes(selectedCardId)) {
    return refreshMemberSelection(game, effect, rule.stageMemberCardIds);
  }

  const currentSlot = findMemberSlot(player, selectedCardId);
  if (!currentSlot) return refreshMemberSelection(game, effect, rule.stageMemberCardIds);
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_SLOT_STEP_ID,
        stepText: '请选择该成员移动后的区域。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        selectableOptions: undefined,
        selectableSlots: otherSlots(currentSlot),
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        selectionLabel: '选择移动后的区域',
        confirmSelectionLabel: '站位变换',
        metadata: { ...effect.metadata, selectedMemberCardId: selectedCardId },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_POSITION_CHANGE_MEMBER',
      selectedMemberCardId: selectedCardId,
      selectableSlots: otherSlots(currentSlot),
    }
  );
}

function resolveSlotSelection(
  game: GameState,
  selectedSlot: SlotPosition | null | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = getActiveEffect(game, SELECT_SLOT_STEP_ID);
  if (!effect) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const rule = evaluateRule(game, player.id, effect.sourceCardId);
  const targetCardId =
    typeof effect.metadata?.selectedMemberCardId === 'string'
      ? effect.metadata.selectedMemberCardId
      : null;
  const currentSlot = targetCardId ? findMemberSlot(player, targetCardId) : null;
  if (!isInteractiveRuleState(rule) || !targetCardId || !currentSlot) {
    return finishActiveEffectWithoutMove(game, effect, continuePendingCardEffects, 'STALE_RULE');
  }
  const selectableSlots = otherSlots(currentSlot);
  if (!selectedSlot || !selectableSlots.includes(selectedSlot)) {
    return refreshSlotSelection(game, effect, selectableSlots);
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    targetCardId,
    selectedSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'POSITION_CHANGE',
          targetCardId,
          fromSlot: result.fromSlot,
          toSlot: result.toSlot,
          swappedCardId: result.swappedCardId,
        }),
    }
  );
  if (!moveResult) return refreshSlotSelection(game, effect, selectableSlots);
  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function evaluateRule(game: GameState, playerId: string, sourceCardId: string): LiveStartRuleState {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  const stageMemberCardIds = player
    ? MEMBER_SLOT_ORDER.flatMap((slot) => player.memberSlots.slots[slot] ?? [])
    : [];
  const museMemberCardIds = getStageMemberCardIdsMatching(game, playerId, museMember);
  return {
    sourceIsValid:
      player !== null &&
      source !== null &&
      source.ownerId === playerId &&
      isLiveCardData(source.data) &&
      getBaseCardCode(source.data.cardCode) === 'PL!-bp4-020' &&
      player.liveZone.cardIds.includes(sourceCardId),
    stageMemberCardIds,
    allStageMembersAreMuse:
      stageMemberCardIds.length > 0 && museMemberCardIds.length === stageMemberCardIds.length,
  };
}

function isInteractiveRuleState(rule: LiveStartRuleState): boolean {
  return rule.sourceIsValid && rule.allStageMembersAreMuse && rule.stageMemberCardIds.length > 0;
}

function describeRuleResult(rule: LiveStartRuleState): string {
  const count = rule.stageMemberCardIds.length;
  if (count === 0) return '（当前舞台成员0名，没有可选择的目标。）';
  if (!rule.sourceIsValid) {
    return rule.allStageMembersAreMuse
      ? `（当前舞台成员${count}名，均为『μ's』的成员，未进行站位变换。）`
      : `（当前舞台成员${count}名，不均为『μ's』的成员，未进行站位变换。）`;
  }
  return rule.allStageMembersAreMuse
    ? `（当前舞台成员${count}名，均为『μ's』的成员，可以进行站位变换。）`
    : `（当前舞台成员${count}名，不均为『μ's』的成员，未进行站位变换。）`;
}

function createMemberSelectionEffect(
  ability: PendingAbilityState,
  selectableCardIds: readonly string[],
  options: PendingAbilityStarterOptions
): ActiveEffectState {
  return {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SELECT_MEMBER_STEP_ID,
    stepText: '请选择1名自己舞台的成员进行站位变换。也可以选择不发动。',
    awaitingPlayerId: ability.controllerId,
    selectableCardIds,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: 'SINGLE',
    selectionLabel: '选择要进行站位变换的成员',
    confirmSelectionLabel: '选择成员',
    canSkipSelection: true,
    skipSelectionLabel: '不发动',
    metadata: { orderedResolution: options.orderedResolution === true },
  };
}

function refreshMemberSelection(
  game: GameState,
  effect: ActiveEffectState,
  selectableCardIds: readonly string[]
): GameState {
  return { ...game, activeEffect: { ...effect, selectableCardIds } };
}

function refreshSlotSelection(
  game: GameState,
  effect: ActiveEffectState,
  selectableSlots: readonly SlotPosition[]
): GameState {
  return { ...game, activeEffect: { ...effect, selectableSlots } };
}

function otherSlots(currentSlot: SlotPosition): SlotPosition[] {
  return MEMBER_SLOT_ORDER.filter((slot) => slot !== currentSlot);
}

function getActiveEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    PL_BP4_020_LIVE_START_ONLY_MUSE_STAGE_TARGET_MEMBER_POSITION_CHANGE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function finishPendingWithoutMove(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      moved: false,
    }),
    orderedResolution
  );
}

function finishActiveEffectWithoutMove(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      moved: false,
    }),
    effect.metadata?.orderedResolution === true
  );
}
