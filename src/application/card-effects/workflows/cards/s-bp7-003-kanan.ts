import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addMemberWaitProtectionUntilLiveEnd } from '../../../../domain/rules/member-wait-protections.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { getOtherStageMemberSlotsWithGroupMember } from '../../../effects/member-position-targets.js';
import { S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const CHOOSE_BRANCH_STEP = 'S_BP7_003_CHOOSE_EFFECT';
const CHOOSE_MOVE_SLOT_STEP = 'S_BP7_003_CHOOSE_POSITION_CHANGE_SLOT';
const PROTECT_OPTION = 'protect-aqours';
const MOVE_OPTION = 'position-change';
const TARGET_GROUPS = ['Aqours', 'SaintSnow'] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp7003KananWorkflowHandlers(deps: {
  readonly enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options) => startChooseEffect(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
    CHOOSE_BRANCH_STEP,
    (game, input, context) =>
      finishChooseEffect(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
    CHOOSE_MOVE_SLOT_STEP,
    (game, input, context) =>
      finishPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueMemberSlotMovedCardEffects
      )
  );
}

function startChooseEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const canMove =
    sourceSlot !== null &&
    getOtherStageMemberSlotsWithGroupMember(game, player.id, sourceSlot, TARGET_GROUPS).length > 0;
  const options = [
    {
      id: PROTECT_OPTION,
      label: '直到LIVE结束时，保护原本[BLADE]不超过3的『Aqours』成员',
    },
    ...(canMove
      ? [
          {
            id: MOVE_OPTION,
            label: '将此成员站位变换到有『Aqours』或『Saint Snow』成员的区域',
          },
        ]
      : []),
  ];

  return addAction(
    {
      ...removePending(game, ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: CHOOSE_BRANCH_STEP,
        stepText: '请从以下效果中选择1项。',
        awaitingPlayerId: player.id,
        selectableOptions: options,
        effectChoice: {
          mode: 'SINGLE',
          options: [
            {
              id: PROTECT_OPTION,
              text: 'LIVE结束时为止，存在于自己的舞台的原本持有的[BLADE]数量小于等于3的『Aqours』成员，不会因对方的效果变为待机状态。',
            },
            {
              id: MOVE_OPTION,
              text: '将此成员站位变换至存在『Aqours』或『Saint Snow』成员的区域。',
              selectable: canMove,
            },
          ],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: '选择要结算的效果',
        confirmSelectionLabel: '结算所选效果',
        canSkipSelection: false,
        metadata: { orderedResolution, sourceSlot: ability.sourceSlot },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_EFFECT',
      selectableOptionIds: options.map((option) => option.id),
    }
  );
}

function finishChooseEffect(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== CHOOSE_BRANCH_STEP ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  if (selectedOptionId === PROTECT_OPTION) {
    const state = addMemberWaitProtectionUntilLiveEnd(game, {
      affectedPlayerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
    return finishActiveEffect(
      state,
      effect,
      continuePendingCardEffects,
      'ESTABLISH_WAIT_PROTECTION'
    );
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? findMemberSlot(player, effect.sourceCardId) : null;
  const targetSlots =
    player && sourceSlot !== null
      ? getOtherStageMemberSlotsWithGroupMember(game, player.id, sourceSlot, TARGET_GROUPS)
      : [];
  if (targetSlots.length === 0) {
    return finishActiveEffect(
      game,
      effect,
      continuePendingCardEffects,
      'POSITION_CHANGE_NO_LONGER_LEGAL'
    );
  }
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: CHOOSE_MOVE_SLOT_STEP,
        stepText: '请选择此成员站位变换后的区域。',
        effectChoice: undefined,
        selectableOptions: undefined,
        selectableSlots: targetSlots,
        selectionLabel: '选择移动后的区域',
        confirmSelectionLabel: '站位变换',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_POSITION_CHANGE_TARGET',
      selectableSlots: targetSlots,
    }
  );
}

function finishPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== CHOOSE_MOVE_SLOT_STEP ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? findMemberSlot(player, effect.sourceCardId) : null;
  const legalTargets =
    player && sourceSlot !== null
      ? getOtherStageMemberSlotsWithGroupMember(game, player.id, sourceSlot, TARGET_GROUPS)
      : [];
  if (!player || sourceSlot === null || !legalTargets.includes(selectedSlot)) {
    return finishActiveEffect(
      game,
      effect,
      continuePendingCardEffects,
      'POSITION_CHANGE_TARGET_STALE'
    );
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    effect.sourceCardId,
    selectedSlot,
    enqueueMemberSlotMovedCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        selectionPlayerId: player.id,
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
          fromSlot: result.fromSlot,
          toSlot: result.toSlot,
          swappedCardId: result.swappedCardId,
        }),
    }
  );
  if (!moveResult) {
    return finishActiveEffect(game, effect, continuePendingCardEffects, 'POSITION_CHANGE_NOOP');
  }
  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishActiveEffect(
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
    }),
    effect.metadata?.orderedResolution === true
  );
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
